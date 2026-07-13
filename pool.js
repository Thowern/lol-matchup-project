(() => {
  'use strict';

  const DATA = window.MATCHUP_APP_DATA;
  const CONFIG = window.POOL_BUILDER_CONFIG;
  const ROLE_ORDER_FALLBACK = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
  const ROLE_LABELS = { TOP: 'Top', JUNGLE: 'Jungle', MIDDLE: 'Mid', BOTTOM: 'BOT', UTILITY: 'Support' };
  const ROLE_ALIASES = {
    top: 'TOP',
    jungle: 'JUNGLE', jgl: 'JUNGLE', jungler: 'JUNGLE',
    middle: 'MIDDLE', mid: 'MIDDLE',
    bottom: 'BOTTOM', bot: 'BOTTOM', adc: 'BOTTOM', carry: 'BOTTOM',
    utility: 'UTILITY', support: 'UTILITY', supp: 'UTILITY', sup: 'UTILITY'
  };

  // --------------------------------------------------------------------------
  // MAPPA DEL FILE
  // 1) utility e lettura dati
  // 2) calcolo del singolo matchup e aggregazione della copertura
  // 3) forza, stile, danno e affidabilità del campione
  // 4) punteggio del prossimo campione consigliato
  // 5) valutazione finale della pool
  // 6) rendering e interazioni dell'interfaccia
  //
  // Tutti i numeri modificabili sono in pool.config.js. Qui restano le formule.
  // --------------------------------------------------------------------------
  const PROFILE_VECTOR_FIELDS = CONFIG?.profileDiversity?.fields || [];
  const RECOMMENDATION_LIMIT = CONFIG?.recommendation?.limit ?? 7;
  const MATCHUP_NEUTRAL = CONFIG?.matchup?.neutralWinrate ?? 0.50;
  const POOL_COUNTER_QUANTILE = 0.50;
  const DEFAULT_POOL_COUNTER_CONFIDENCE = 99;
  const WILSON_Z = {
    90: 1.6448536269514722,
    95: 1.959963984540054,
    99: 2.5758293035489004
  };
  const POOL_COUNTER_METRICS = {
    wilson: {
      label: 'Wilson prudenziale',
      description: 'Ordina per il limite inferiore Wilson: premia il win rate ma penalizza automaticamente i matchup con poche partite.'
    },
    decision: {
      label: 'Indice Pool Builder',
      description: 'Usa lo stesso indice del builder: combina win rate, scarto dal rendimento abituale e riduzione verso il 50% quando il campione statistico è piccolo.'
    },
    winrate: {
      label: 'Win rate matchup',
      description: 'Ordina direttamente per percentuale di vittorie del campione della pool contro l’avversario indicato.'
    },
    diff: {
      label: 'Scarto dal WR abituale',
      description: 'Premia chi rende meglio del proprio win rate generale proprio in questo matchup.'
    },
    games: {
      label: 'Numero di partite',
      description: 'Mostra per primi i confronti con il campione statistico più ampio.'
    }
  };

  const state = {
    role: null,
    size: 3,
    firstChampion: null,
    selected: [],
    started: false,
    rigorousThreshold: null,
    rigorousChampions: [],
    opponents: [],
    recommendationRows: [],
    customChampion: null,
    comboControllers: [],
    counterScope: 'q50',
    counterMetric: 'wilson',
    counterConfidence: DEFAULT_POOL_COUNTER_CONFIDENCE,
    counterQuery: '',
    quickRole: null,
    quickPool: [],
    quickScope: 'q50',
    quickMetric: 'wilson',
    quickConfidence: DEFAULT_POOL_COUNTER_CONFIDENCE,
    quickQuery: '',
    quickMatrix: null,
    quickUnknownChampions: []
  };

  const byId = (id) => document.getElementById(id);
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  function safeNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function clamp(value, min, max) {
    const number = safeNumber(value);
    if (number === null) return min;
    return Math.max(min, Math.min(max, number));
  }

  function weightedScore(values, weights) {
    let total = 0;
    let weightTotal = 0;
    Object.entries(weights || {}).forEach(([key, rawWeight]) => {
      const value = safeNumber(values?.[key]);
      const weight = Math.max(0, safeNumber(rawWeight) ?? 0);
      if (value === null || weight <= 0) return;
      total += value * weight;
      weightTotal += weight;
    });
    return weightTotal > 0 ? total / weightTotal : 0;
  }

  function weightPercentages(weights) {
    const entries = Object.entries(weights || {});
    const total = entries.reduce((sum, [, value]) => sum + Math.max(0, safeNumber(value) ?? 0), 0);
    return Object.fromEntries(entries.map(([key, value]) => [key, total > 0 ? Math.max(0, safeNumber(value) ?? 0) / total * 100 : 0]));
  }

  function average(rows, valueFn) {
    const values = rows.map(valueFn).map(safeNumber).filter((value) => value !== null);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  }

  function tailAverage(rows, valueFn, share = 0.20) {
    if (!rows.length) return null;
    const sorted = rows.map(valueFn).map(safeNumber).filter((value) => value !== null).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const count = Math.max(1, Math.ceil(sorted.length * clamp(share, 0.01, 1)));
    return sorted.slice(0, count).reduce((sum, value) => sum + value, 0) / count;
  }

  function evidenceWeight(games) {
    const exponent = safeNumber(CONFIG?.matchup?.evidenceWeightExponent) ?? 0.5;
    return Math.max(0, safeNumber(games) ?? 0) ** Math.max(0, exponent);
  }

  // Quanto è probabile incontrare davvero questo avversario nella lane, in base
  // a quante partite totali ha giocato lì (proxy di pick rate/popolarità).
  // Un avversario giocatissimo pesa di più nella copertura e nelle debolezze
  // rispetto a uno rarissimo, anche se il matchup diretto contro di lui è
  // statisticamente solido. Indipendente dalla affidabilità del singolo dato
  // (quella resta gestita da evidenceWeight).
  function opponentLikelihoodWeight(role, opponent) {
    const exponent = safeNumber(CONFIG?.matchup?.opponentLikelihoodExponent) ?? 0.6;
    let weight = 1;
    if (exponent > 0) {
      const games = Math.max(0.0001, profileGames(role, opponent));
      weight = games ** exponent;
    }
    if (CONFIG?.dataSelection?.evaluationOpponents === 'blend') {
      const blend = clamp(CONFIG?.dataSelection?.rigorousBlendWeight ?? 0.6, 0, 1);
      const isRigorous = state.rigorousChampions.includes(opponent);
      if (!isRigorous) weight *= (1 - blend);
    }
    return weight;
  }

  function normalizedRecommendationMetric(absoluteScore, percentileScore) {
    const relativeBlend = clamp(CONFIG?.recommendation?.relativeRankBlend ?? 0.35, 0, 1);
    return (1 - relativeBlend) * clamp(absoluteScore, 0, 100) + relativeBlend * clamp(percentileScore, 0, 100);
  }

  function prefersReducedMotion() {
    return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  }

  function esc(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }

  function champHtml(name, size = 'sm', className = '') {
    if (!name) return '—';
    return window.ChampionIcons?.html
      ? window.ChampionIcons.html(name, { size, className })
      : esc(name);
  }

  function localeSort(a, b) {
    return String(a).localeCompare(String(b), 'it', { sensitivity: 'base' });
  }

  function pct(value, digits = 1) {
    const number = safeNumber(value);
    return number === null ? '—' : `${(number * 100).toFixed(digits)}%`;
  }

  function signedPct(value, digits = 1) {
    const number = safeNumber(value);
    if (number === null) return '—';
    return `${number > 0 ? '+' : ''}${(number * 100).toFixed(digits)}pp`;
  }

  function integer(value) {
    const number = safeNumber(value);
    return number === null ? '—' : Math.round(number).toLocaleString('it-IT');
  }

  function scoreFmt(value) {
    const number = safeNumber(value);
    return number === null ? '—' : Math.round(number).toString();
  }

  function setDataStatus(kind, text) {
    const element = byId('dataStatus');
    if (!element) return;
    element.className = `data-status-pill ${kind || ''}`.trim();
    element.textContent = text;
  }

  function announce(text) {
    const live = byId('liveRegion');
    if (!live) return;
    live.textContent = '';
    window.setTimeout(() => { live.textContent = text; }, 20);
  }

  function roleOrder() {
    const roles = DATA?.meta?.roles || DATA?.meta?.role_order || DATA?.roleOrder;
    const source = Array.isArray(roles) && roles.length ? roles : ROLE_ORDER_FALLBACK;
    return ROLE_ORDER_FALLBACK.filter((role) => source.includes(role))
      .concat(source.filter((role) => !ROLE_ORDER_FALLBACK.includes(role)));
  }

  function roleLabel(role) {
    return ROLE_LABELS[role] || DATA?.meta?.role_labels?.[role] || DATA?.roleLabels?.[role] || role;
  }

  function profilesForRole(role = state.role) {
    return DATA?.championProfiles?.[role] || {};
  }

  function championsForRole(role = state.role) {
    const names = new Set(DATA?.meta?.roles_champions?.[role] || DATA?.meta?.rolesChampions?.[role] || DATA?.championsByRole?.[role] || []);
    Object.keys(profilesForRole(role)).forEach((name) => names.add(name));
    const roleMap = DATA?.matchups?.[role] || {};
    Object.entries(roleMap).forEach(([name, opponents]) => {
      names.add(name);
      Object.keys(opponents || {}).forEach((opponent) => names.add(opponent));
    });
    return Array.from(names).filter((name) => profilesForRole(role)[name]).sort(localeSort);
  }


  function normalizeLookup(value) {
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('it')
      .replace(/[^a-z0-9]+/g, '');
  }

  function resolveRoleAlias(value) {
    const normalized = normalizeLookup(value);
    const direct = ROLE_ALIASES[normalized];
    if (direct && roleOrder().includes(direct)) return direct;
    return roleOrder().find((role) => normalizeLookup(role) === normalized || normalizeLookup(roleLabel(role)) === normalized) || null;
  }

  function resolveChampionName(role, value) {
    const typed = String(value ?? '').trim();
    if (!typed) return null;
    const champions = championsForRole(role);
    const exact = champions.find((champion) => champion.toLocaleLowerCase('it') === typed.toLocaleLowerCase('it'));
    if (exact) return exact;
    const normalized = normalizeLookup(typed);
    return champions.find((champion) => normalizeLookup(champion) === normalized) || null;
  }

  // Formato principale: TOP — Singed / Irelia / Nasus
  // Sono accettati anche trattino, due punti, virgole, punto e virgola e righe multiple.
  function parseQuickPoolText(rawText) {
    const text = String(rawText ?? '').trim();
    if (!text) return { role: null, pool: [], unknown: [], error: 'Incolla prima una lane e almeno un campione.' };
    const match = text.match(/^\s*([A-Za-zÀ-ÿ]+)\s*(?:—|–|-|:|\|)\s*([\s\S]+)$/);
    if (!match) {
      return {
        role: null,
        pool: [],
        unknown: [],
        error: 'Formato non riconosciuto. Usa per esempio: TOP — Singed / Irelia / Nasus'
      };
    }

    const role = resolveRoleAlias(match[1]);
    if (!role) {
      return {
        role: null,
        pool: [],
        unknown: [],
        error: `Lane “${match[1].trim()}” non riconosciuta. Usa Top, Jungle, Mid, BOT oppure Support.`
      };
    }

    const tokens = match[2]
      .split(/[\/,;\n]+/)
      .map((token) => token.trim())
      .filter(Boolean);
    const pool = [];
    const unknown = [];
    tokens.forEach((token) => {
      const champion = resolveChampionName(role, token);
      if (!champion) {
        unknown.push(token);
        return;
      }
      if (!pool.includes(champion)) pool.push(champion);
    });

    if (!pool.length) {
      return {
        role,
        pool: [],
        unknown,
        error: `Nessun campione riconosciuto per la lane ${roleLabel(role)}.`
      };
    }
    return { role, pool, unknown, error: null };
  }

  function quantile(sortedValues, q) {
    if (!sortedValues.length) return null;
    if (sortedValues.length === 1) return sortedValues[0];
    const position = clamp(q, 0, 1) * (sortedValues.length - 1);
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper) return sortedValues[lower];
    const weight = position - lower;
    return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
  }

  function profileGames(role, champion) {
    const coverage = profilesForRole(role)?.[champion]?.coverage || {};
    return safeNumber(coverage.total_games) ?? safeNumber(coverage.n_games) ?? safeNumber(coverage.matches) ?? 0;
  }

  function profileMatchups(role, champion) {
    const coverage = profilesForRole(role)?.[champion]?.coverage || {};
    return safeNumber(coverage.n_matchups) ?? safeNumber(coverage.matchups) ?? 0;
  }

  function calculateRoleQuantileSet(role, rawQuantile) {
    const champions = championsForRole(role);
    const values = champions.map((champion) => profileGames(role, champion)).filter((value) => value > 0).sort((a, b) => a - b);
    const selectedQuantile = clamp(rawQuantile, 0, 1);
    const threshold = quantile(values, selectedQuantile) ?? 0;
    const eligible = champions.filter((champion) => profileGames(role, champion) >= threshold && profileGames(role, champion) > 0)
      .sort((a, b) => profileGames(role, b) - profileGames(role, a) || localeSort(a, b));
    const all = champions.slice().sort((a, b) => profileGames(role, b) - profileGames(role, a) || localeSort(a, b));
    return { quantile: selectedQuantile, threshold, eligible, all };
  }

  function calculateRigorousSet(role) {
    const configuredQuantile = CONFIG?.dataSelection?.rigorousQuantile ?? 0.75;
    return calculateRoleQuantileSet(role, configuredQuantile);
  }

  // ==========================================================================
  // 2. MATCHUP: LETTURA, CORREZIONE DEL CAMPIONE E AGGREGAZIONE
  // ==========================================================================

  function objectFromColumns(values) {
    if (!values) return null;
    if (!Array.isArray(values) && typeof values === 'object') return { ...values };
    if (!Array.isArray(DATA?.matchupColumns) || !Array.isArray(values)) return null;
    const output = {};
    DATA.matchupColumns.forEach((column, index) => { output[column] = values[index]; });
    return output;
  }

  function getMatchup(role, champion, opponent) {
    if (!role || !champion || !opponent || champion === opponent) return null;
    const roleMap = DATA?.matchups?.[role] || {};
    const direct = objectFromColumns(roleMap?.[champion]?.[opponent]);
    const reverse = objectFromColumns(roleMap?.[opponent]?.[champion]);
    let raw = direct;
    let side = 'a';
    let otherSide = 'b';
    let orientation = 'direct';
    if (!raw && reverse) {
      raw = reverse;
      side = 'b';
      otherSide = 'a';
      orientation = 'reverse';
    }
    if (!raw) return null;

    const otherWinrate = safeNumber(raw[`winrate_${otherSide}`]);
    const winrate = safeNumber(raw[`winrate_${side}`]) ?? (otherWinrate === null ? null : 1 - otherWinrate);
    const generalWinrate = safeNumber(raw[`general_winrate_${side}`])
      ?? safeNumber(profilesForRole(role)?.[champion]?.general_winrate);
    const diff = safeNumber(raw[`diff_winrate_${side}`])
      ?? (winrate !== null && generalWinrate !== null ? winrate - generalWinrate : null);
    const games = safeNumber(raw.n_matches);
    if (winrate === null || games === null || games <= 0) return null;

    const relativePerformance = diff === null ? MATCHUP_NEUTRAL : clamp(MATCHUP_NEUTRAL + diff, 0, 1);
    const matchupScore = weightedScore(
      { directWinrate: winrate, relativeToGeneral: relativePerformance },
      CONFIG?.matchup?.rawScoreWeights || { directWinrate: 75, relativeToGeneral: 25 }
    );

    // Il decisionScore è il valore usato OVUNQUE per confrontare due risposte:
    // scelta del miglior campione, spiegazioni e aggregati della pool.
    // In questo modo una micro-sample non può generare una motivazione falsa.
    const shrinkageGames = Math.max(0, safeNumber(CONFIG?.matchup?.shrinkageGames) ?? 20);
    const reliability = shrinkageGames === 0 ? 1 : games / (games + shrinkageGames);
    const decisionScore = MATCHUP_NEUTRAL + (matchupScore - MATCHUP_NEUTRAL) * reliability;

    return {
      champion, opponent, orientation, winrate, generalWinrate, diff, games,
      matchupScore, decisionScore, reliability
    };
  }


  function wilsonLowerBound(rate, games, confidence = DEFAULT_POOL_COUNTER_CONFIDENCE) {
    const p = safeNumber(rate);
    const n = safeNumber(games);
    if (p === null || n === null || n <= 0) return null;
    const z = WILSON_Z[confidence] ?? WILSON_Z[DEFAULT_POOL_COUNTER_CONFIDENCE];
    const z2 = z * z;
    const denominator = 1 + z2 / n;
    const centre = p + z2 / (2 * n);
    const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
    return clamp((centre - margin) / denominator, 0, 1);
  }

  function poolCounterMetricValue(row, metric) {
    if (!row?.hasData) return null;
    if (metric === 'decision') return safeNumber(row.decisionScore);
    if (metric === 'winrate') return safeNumber(row.winrate);
    if (metric === 'diff') return safeNumber(row.diff);
    if (metric === 'games') return safeNumber(row.games);
    return safeNumber(row.wilson);
  }

  function poolCounterMetricFormat(row, metric) {
    const value = poolCounterMetricValue(row, metric);
    if (metric === 'diff') return signedPct(value, 1);
    if (metric === 'games') return integer(value);
    return pct(value, 1);
  }

  function normalizePoolForRole(pool, role) {
    const available = new Set(championsForRole(role));
    return Array.from(new Set(Array.isArray(pool) ? pool : []))
      .filter((champion) => available.has(champion));
  }

  // Funzione pubblica: riceve una pool nello stesso formato di state.selected.
  // options: { role, scope: 'q50'|'all', metric, confidence, query }.
  function buildPoolCounterMatrix(pool = state.selected, options = {}) {
    const role = options.role || state.role;
    const normalizedPool = normalizePoolForRole(pool, role);
    const scope = options.scope === 'all' ? 'all' : 'q50';
    const metric = POOL_COUNTER_METRICS[options.metric] ? options.metric : 'wilson';
    const requestedConfidence = Number(options.confidence ?? DEFAULT_POOL_COUNTER_CONFIDENCE);
    const confidence = Object.prototype.hasOwnProperty.call(WILSON_Z, requestedConfidence)
      ? requestedConfidence
      : DEFAULT_POOL_COUNTER_CONFIDENCE;
    const query = String(options.query || '').trim().toLocaleLowerCase('it');
    const q50 = calculateRoleQuantileSet(role, POOL_COUNTER_QUANTILE);
    const targetSource = scope === 'all' ? q50.all : q50.eligible;
    const targets = query
      ? targetSource.filter((champion) => champion.toLocaleLowerCase('it').includes(query))
      : targetSource;

    const rows = targets.map((target) => {
      const counters = normalizedPool
        .filter((champion) => champion !== target)
        .map((champion) => {
          const matchup = getMatchup(role, champion, target);
          if (!matchup) {
            return {
              champion,
              target,
              hasData: false,
              winrate: null,
              generalWinrate: safeNumber(profilesForRole(role)?.[champion]?.general_winrate),
              diff: null,
              games: null,
              decisionScore: null,
              wilson: null
            };
          }
          return {
            ...matchup,
            target,
            hasData: true,
            wilson: wilsonLowerBound(matchup.winrate, matchup.games, confidence)
          };
        });

      counters.sort((a, b) => {
        const av = poolCounterMetricValue(a, metric);
        const bv = poolCounterMetricValue(b, metric);
        if (av === null && bv === null) return localeSort(a.champion, b.champion);
        if (av === null) return 1;
        if (bv === null) return -1;
        return bv - av
          || (safeNumber(b.decisionScore) ?? -1) - (safeNumber(a.decisionScore) ?? -1)
          || (safeNumber(b.games) ?? -1) - (safeNumber(a.games) ?? -1)
          || localeSort(a.champion, b.champion);
      });

      return {
        target,
        targetGames: profileGames(role, target),
        inPool: normalizedPool.includes(target),
        counters
      };
    });

    return {
      role,
      pool: normalizedPool,
      scope,
      metric,
      confidence,
      q50Threshold: q50.threshold,
      q50Count: q50.eligible.length,
      allCount: q50.all.length,
      rows
    };
  }

  function weightedAverage(rows, valueFn, weightFn = () => 1) {
    let total = 0;
    let weightTotal = 0;
    rows.forEach((row) => {
      const value = safeNumber(valueFn(row));
      const weight = Math.max(0, safeNumber(weightFn(row)) ?? 0);
      if (value === null || weight <= 0) return;
      total += value * weight;
      weightTotal += weight;
    });
    return weightTotal > 0 ? total / weightTotal : null;
  }

  function shrunkMatchupScore(row) {
    return safeNumber(row?.decisionScore) ?? MATCHUP_NEUTRAL;
  }

  function relevantOpponents(pool = []) {
    const unavailable = new Set(pool);
    return state.opponents.filter((opponent) => !unavailable.has(opponent));
  }

  function bestPoolAnswers(pool) {
    const map = new Map();
    relevantOpponents(pool).forEach((opponent) => {
      const rows = pool
        .map((champion) => getMatchup(state.role, champion, opponent))
        .filter((row) => row && row.decisionScore !== null);
      rows.sort((a, b) => b.decisionScore - a.decisionScore || b.games - a.games || localeSort(a.champion, b.champion));
      map.set(opponent, rows[0] || null);
    });
    return map;
  }

  function evaluateMatchupCore(pool) {
    const opponents = relevantOpponents(pool);
    const answers = bestPoolAnswers(pool);
    const known = [];
    opponents.forEach((opponent) => {
      const answer = answers.get(opponent);
      if (!answer || answer.decisionScore === null || answer.games <= 0) return;
      const weaknessControl = answer.decisionScore >= MATCHUP_NEUTRAL
        ? 1
        : clamp(answer.decisionScore / MATCHUP_NEUTRAL, 0, 1);
      known.push({
        opponent,
        champion: answer.champion,
        score: answer.decisionScore,
        rawScore: answer.matchupScore,
        games: answer.games,
        evidenceWeight: evidenceWeight(answer.games) * opponentLikelihoodWeight(state.role, opponent),
        weaknessControl
      });
    });

    const evidenceWeightedCoverage = weightedAverage(known, (row) => row.score, (row) => row.evidenceWeight);
    const opponentBalancedCoverage = average(known, (row) => row.score);
    const worstTailCoverage = tailAverage(known, (row) => row.score, CONFIG?.matchup?.worstTailShare ?? 0.20);
    const matchupCoverage = weightedScore({
      evidenceWeighted: evidenceWeightedCoverage ?? 0,
      opponentBalanced: opponentBalancedCoverage ?? 0,
      worstTail: worstTailCoverage ?? 0
    }, CONFIG?.matchup?.coverageBlendWeights || { evidenceWeighted: 55, opponentBalanced: 30, worstTail: 15 });

    const evidenceWeightedWeakness = weightedAverage(known, (row) => row.weaknessControl, (row) => row.evidenceWeight);
    const worstTailWeakness = tailAverage(known, (row) => row.weaknessControl, CONFIG?.matchup?.worstTailShare ?? 0.20);
    const weaknessControl = weightedScore({
      evidenceWeighted: evidenceWeightedWeakness ?? 0,
      worstTail: worstTailWeakness ?? 0
    }, CONFIG?.matchup?.weaknessBlendWeights || { evidenceWeighted: 65, worstTail: 35 });

    const totalMatchupGames = known.reduce((sum, row) => sum + row.games, 0);
    const completeness = opponents.length ? known.length / opponents.length : 1;

    return {
      answers,
      known,
      matchupCoverage,
      weaknessSeverity: 1 - weaknessControl,
      weaknessControl,
      totalMatchupGames,
      completeness,
      totalOpponents: opponents.length,
      diagnostics: {
        evidenceWeightedCoverage,
        opponentBalancedCoverage,
        worstTailCoverage,
        evidenceWeightedWeakness,
        worstTailWeakness
      }
    };
  }

  // ==========================================================================
  // 3. METRICHE DEL CAMPIONE: STILE, DANNO, FORZA E AFFIDABILITÀ
  // ==========================================================================

  function percentileValue(profile, field) {
    let value = safeNumber(profile?.percentiles?.[field]);
    if (value === null) return null;
    if (value >= 0 && value <= 1) value *= 100;
    return clamp(value, 0, 100);
  }

  function profileVector(champion) {
    const profile = profilesForRole()?.[champion];
    if (!profile) return null;
    const vector = {};
    PROFILE_VECTOR_FIELDS.forEach((field) => { vector[field] = percentileValue(profile, field); });
    return vector;
  }

  function vectorDistance(championA, championB) {
    const a = profileVector(championA);
    const b = profileVector(championB);
    if (!a || !b) return null;
    const squares = [];
    PROFILE_VECTOR_FIELDS.forEach((field) => {
      const x = safeNumber(a[field]);
      const y = safeNumber(b[field]);
      if (x === null || y === null) return;
      squares.push(((x - y) / 100) ** 2);
    });
    if (!squares.length) return null;
    return clamp(Math.sqrt(squares.reduce((sum, value) => sum + value, 0) / squares.length), 0, 1);
  }

  function candidateProfileDiversity(candidate, pool) {
    if (!pool.length) return 0.5;
    const distances = pool.map((champion) => vectorDistance(candidate, champion)).filter((value) => value !== null);
    return distances.length ? Math.min(...distances) : 0.5;
  }

  function poolProfileDiversity(pool) {
    if (pool.length < 2) return 50;
    const distances = [];
    for (let i = 0; i < pool.length; i += 1) {
      for (let j = i + 1; j < pool.length; j += 1) {
        const distance = vectorDistance(pool[i], pool[j]);
        if (distance !== null) distances.push(distance);
      }
    }
    return distances.length ? clamp((distances.reduce((sum, value) => sum + value, 0) / distances.length) * 100, 0, 100) : 50;
  }

  function damageProfile(champion) {
    const profile = profilesForRole()?.[champion] || {};
    const physical = safeNumber(profile.pct_physical_dmg);
    const magic = safeNumber(profile.pct_magic_dmg);
    const trueDamage = safeNumber(profile.pct_true_dmg);
    const knownValues = [physical, magic, trueDamage].filter((value) => value !== null);
    if (!knownValues.length || knownValues.reduce((sum, value) => sum + Math.max(0, value), 0) <= 0) {
      return { physical: null, magic: null, trueDamage: null, type: 'unknown', trueRelevant: false, known: false };
    }

    const physicalShare = physical ?? 0;
    const magicShare = magic ?? 0;
    const trueShare = trueDamage ?? 0;
    const specialistMin = CONFIG?.damage?.specialistShareMin ?? 0.60;
    const gapMin = CONFIG?.damage?.specialistGapMin ?? 0.20;
    let type = 'hybrid';
    if (physicalShare >= specialistMin && physicalShare - magicShare >= gapMin) type = 'physical';
    else if (magicShare >= specialistMin && magicShare - physicalShare >= gapMin) type = 'magic';
    return {
      physical: physicalShare,
      magic: magicShare,
      trueDamage: trueShare,
      type,
      trueRelevant: trueShare >= (CONFIG?.damage?.trueDamageRelevantShare ?? 0.20),
      known: true
    };
  }

  function damageTypeLabel(type) {
    if (type === 'physical') return 'fisico';
    if (type === 'magic') return 'magico';
    if (type === 'unknown') return 'dati non disponibili';
    return 'ibrido';
  }

  function poolDamageVariety(pool) {
    if (!pool.length) return 0;
    const allProfiles = pool.map(damageProfile);
    const profiles = allProfiles.filter((profile) => profile.known);
    if (!profiles.length) return 0;

    const scores = CONFIG?.damage?.varietyScores || {};
    const types = new Set(profiles.map((profile) => profile.type));
    const secondaryShare = CONFIG?.damage?.meaningfulSecondaryShare ?? 0.35;
    let knownScore = 60;
    if (types.has('physical') && types.has('magic')) knownScore = scores.physicalAndMagic ?? 100;
    else if (types.has('hybrid') && (types.has('physical') || types.has('magic'))) knownScore = scores.specialistAndHybrid ?? 80;
    else if (types.size === 1 && types.has('hybrid')) knownScore = scores.hybridOnly ?? 60;
    else if (types.size === 1 && types.has('physical')) {
      knownScore = profiles.some((profile) => profile.magic >= secondaryShare)
        ? (scores.singleSpecialistWithSecondary ?? 60)
        : (scores.singleSpecialist ?? 30);
    } else if (types.size === 1 && types.has('magic')) {
      knownScore = profiles.some((profile) => profile.physical >= secondaryShare)
        ? (scores.singleSpecialistWithSecondary ?? 60)
        : (scores.singleSpecialist ?? 30);
    }

    const knownRatio = profiles.length / allProfiles.length;
    const maxPenalty = clamp(CONFIG?.damage?.unknownDataMaxPenalty ?? 0.35, 0, 1);
    const dataMultiplier = 1 - maxPenalty * (1 - knownRatio);
    const trueDamageBonus = profiles.some((profile) => profile.trueRelevant)
      ? Math.max(0, safeNumber(CONFIG?.damage?.trueDamageBonus) ?? 0)
      : 0;
    return clamp(knownScore * dataMultiplier + trueDamageBonus, 0, 100);
  }

  function damageDescription(pool) {
    if (!pool.length) return { tone: '', html: 'Aggiungi il primo campione per analizzare il danno.' };
    const profiles = pool.map((champion) => ({ champion, ...damageProfile(champion) }));
    const known = profiles.filter((profile) => profile.known);
    const unknown = profiles.filter((profile) => !profile.known);
    const physical = known.filter((profile) => profile.type === 'physical');
    const magic = known.filter((profile) => profile.type === 'magic');
    const hybrid = known.filter((profile) => profile.type === 'hybrid');
    const trueDamage = known.filter((profile) => profile.trueRelevant);
    let tone = 'warn';
    let text;
    if (!known.length) {
      text = '<strong>Dati sul danno non disponibili.</strong> La varietà non viene stimata artificialmente e riceve punteggio 0.';
    } else if (physical.length && magic.length) {
      tone = 'ok';
      text = '<strong>Danno ben diversificato.</strong> La pool contiene almeno un’opzione fisica e una magica chiare.';
    } else if (physical.length && !magic.length) {
      text = '<strong>Manca una vera opzione magica.</strong> La pool è prevalentemente fisica e può facilitare l’adattamento delle difese avversarie.';
    } else if (magic.length && !physical.length) {
      text = '<strong>Manca una vera opzione fisica.</strong> La pool è prevalentemente magica e può facilitare l’adattamento delle difese avversarie.';
    } else {
      text = '<strong>Pool principalmente ibrida.</strong> Offre flessibilità parziale, ma non equivale sempre a possedere uno specialista fisico e uno magico.';
    }
    if (hybrid.length) text += ` ${hybrid.length} ${hybrid.length === 1 ? 'campione ha' : 'campioni hanno'} un profilo ibrido.`;
    if (trueDamage.length) text += ` Danno puro rilevante: ${trueDamage.map((profile) => esc(profile.champion)).join(', ')}.`;
    if (unknown.length) text += ` Dati mancanti: ${unknown.map((profile) => esc(profile.champion)).join(', ')}; il punteggio viene penalizzato.`;
    return { tone, html: text };
  }

  function championAbsoluteStrength(champion) {
    const profile = profilesForRole()?.[champion] || {};
    const winrate = safeNumber(profile.general_winrate);
    if (winrate === null) return 50;
    const floor = CONFIG?.championStrength?.winrateFloor ?? 0.45;
    const ceiling = CONFIG?.championStrength?.winrateCeiling ?? 0.55;
    if (ceiling <= floor) return 50;
    return clamp((winrate - floor) / (ceiling - floor), 0, 1) * 100;
  }

  function championDataConfidence(champion) {
    const games = profileGames(state.role, champion);
    const profileCoverage = state.rigorousThreshold > 0
      ? clamp(games / state.rigorousThreshold, 0, 1)
      : (games > 0 ? 1 : 0);
    const opponents = relevantOpponents([champion]);
    const directRows = opponents.map((opponent) => getMatchup(state.role, champion, opponent)).filter(Boolean);
    const knownCoverage = opponents.length ? directRows.length / opponents.length : 1;
    const target = Math.max(1, safeNumber(CONFIG?.confidence?.matchupSampleTarget) ?? 25);
    const matchupSample = directRows.length
      ? directRows.reduce((sum, row) => sum + clamp(row.games / target, 0, 1), 0) / directRows.length
      : 0;
    return weightedScore({
      profileGames: profileCoverage,
      knownOpponents: knownCoverage,
      matchupSamples: matchupSample
    }, CONFIG?.confidence?.championWeights || { profileGames: 40, knownOpponents: 40, matchupSamples: 20 }) * 100;
  }

  // ==========================================================================
  // 4. RACCOMANDAZIONE DEL PROSSIMO CAMPIONE
  // ==========================================================================

  function candidateRawMetrics(candidate, pool, currentCore) {
    const afterCore = evaluateMatchupCore([...pool, candidate]);
    const comparisonOpponents = relevantOpponents([...pool, candidate]);
    let improvedCount = 0;
    let fixedCount = 0;
    let newCoverageCount = 0;
    let knownCount = 0;
    const minDelta = CONFIG?.matchup?.improvementMinDelta ?? 0.005;
    const weakBelow = CONFIG?.matchup?.weakBelow ?? 0.48;
    const fixedAbove = CONFIG?.matchup?.fixedAbove ?? 0.52;

    comparisonOpponents.forEach((opponent) => {
      const directCandidate = getMatchup(state.role, candidate, opponent);
      if (directCandidate) knownCount += 1;
      const before = currentCore.answers.get(opponent);
      const after = afterCore.answers.get(opponent);
      if (!after || after.champion !== candidate) return;
      if (!before) {
        newCoverageCount += 1;
        return;
      }
      if (after.decisionScore > before.decisionScore + minDelta) improvedCount += 1;
      if (before.decisionScore < weakBelow && after.decisionScore > fixedAbove) fixedCount += 1;
    });

    const beforeCoverage = currentCore.matchupCoverage ?? 0;
    const afterCoverage = afterCore.matchupCoverage ?? beforeCoverage;
    const beforeWeaknessControl = currentCore.weaknessControl ?? 0;
    const afterWeaknessControl = afterCore.weaknessControl ?? beforeWeaknessControl;
    const marginalCoverageGain = Math.max(0, afterCoverage - beforeCoverage);
    const weaknessFix = Math.max(0, afterWeaknessControl - beforeWeaknessControl);
    const matchupComplement = weightedScore({
      coverageGain: marginalCoverageGain,
      weaknessGain: weaknessFix
    }, CONFIG?.recommendation?.matchupComplementWeights || { coverageGain: 70, weaknessGain: 30 });
    const beforeDamage = poolDamageVariety(pool);
    const afterDamage = poolDamageVariety([...pool, candidate]);
    const fullDamageGainAt = Math.max(1, safeNumber(CONFIG?.recommendation?.fullDamageGainAt) ?? 70);
    const damageImprovement = clamp((afterDamage - beforeDamage) / fullDamageGainAt, 0, 1);

    return {
      candidate,
      matchupComplement,
      marginalCoverageGain,
      weaknessFix,
      strength: championAbsoluteStrength(candidate) / 100,
      damageImprovement,
      profileDiversity: candidateProfileDiversity(candidate, pool),
      confidence: championDataConfidence(candidate) / 100,
      improvedCount,
      fixedCount,
      newCoverageCount,
      knownCount,
      relevantOpponentCount: comparisonOpponents.length,
      afterDamage,
      weightedMatchupGames: afterCore.totalMatchupGames,
      belowRigorous: state.rigorousThreshold > 0 && profileGames(state.role, candidate) < state.rigorousThreshold
    };
  }

  function percentileRanks(rows, key) {
    const values = rows.map((row) => safeNumber(row[key])).filter((value) => value !== null).sort((a, b) => a - b);
    const uniqueRange = values.length > 1 && values[0] !== values[values.length - 1];
    rows.forEach((row) => {
      const value = safeNumber(row[key]);
      if (value === null || !values.length) {
        row[`${key}Pct`] = 50;
        return;
      }
      if (!uniqueRange) {
        row[`${key}Pct`] = 50;
        return;
      }
      let below = 0;
      let equal = 0;
      values.forEach((candidate) => {
        if (candidate < value) below += 1;
        else if (candidate === value) equal += 1;
      });
      row[`${key}Pct`] = ((below + Math.max(0, equal - 1) / 2) / (values.length - 1)) * 100;
    });
  }

  function buildCandidateRows(pool) {
    const currentCore = evaluateMatchupCore(pool);
    const allRemaining = championsForRole().filter((champion) => !pool.includes(champion));
    const candidateMode = CONFIG?.dataSelection?.recommendationCandidates || 'rigorous-first';
    let recommendationPool = candidateMode === 'all'
      ? allRemaining
      : allRemaining.filter((champion) => state.rigorousChampions.includes(champion));
    if (recommendationPool.length < RECOMMENDATION_LIMIT) {
      const supplements = allRemaining.filter((champion) => !recommendationPool.includes(champion));
      recommendationPool = [...recommendationPool, ...supplements];
    }

    const rows = recommendationPool.map((candidate) => candidateRawMetrics(candidate, pool, currentCore));
    ['matchupComplement', 'strength', 'damageImprovement', 'profileDiversity', 'confidence'].forEach((key) => percentileRanks(rows, key));
    rows.forEach(applyRecommendationScore);
    rows.sort((a, b) => b.score - a.score
      || b.matchupComplement - a.matchupComplement
      || b.strength - a.strength
      || profileGames(state.role, b.candidate) - profileGames(state.role, a.candidate)
      || localeSort(a.candidate, b.candidate));
    return rows;
  }

  function applyRecommendationScore(row) {
    const fullMatchupGainAt = Math.max(0.0001, safeNumber(CONFIG?.recommendation?.fullMatchupGainAt) ?? 0.035);
    const absolute = {
      matchupComplement: clamp(row.matchupComplement / fullMatchupGainAt, 0, 1) * 100,
      strength: clamp(row.strength, 0, 1) * 100,
      damageImprovement: clamp(row.damageImprovement, 0, 1) * 100,
      profileDiversity: clamp(row.profileDiversity, 0, 1) * 100,
      confidence: clamp(row.confidence, 0, 1) * 100
    };
    row.componentScores = {};
    Object.keys(absolute).forEach((key) => {
      row.componentScores[key] = normalizedRecommendationMetric(absolute[key], row[`${key}Pct`] ?? 50);
    });
    row.score = weightedScore(row.componentScores, CONFIG?.recommendation?.weights || {
      matchupComplement: 50, strength: 20, damageImprovement: 15, profileDiversity: 10, confidence: 5
    });
    return row;
  }

  // ==========================================================================
  // 5. VALUTAZIONE FINALE DELLA POOL
  // ==========================================================================

  function evaluatePool(pool) {
    if (!pool.length) return null;
    const matchupCore = evaluateMatchupCore(pool);
    const averageChampionStrength = pool.reduce((sum, champion) => sum + championAbsoluteStrength(champion), 0) / pool.length;
    const damageVariety = poolDamageVariety(pool);
    const profileDiversity = poolProfileDiversity(pool);
    const selectedProfileConfidence = pool.reduce((sum, champion) => sum + championDataConfidence(champion), 0) / pool.length;
    const matchupCompleteness = matchupCore.completeness * 100;
    const dataConfidence = weightedScore({
      selectedChampions: selectedProfileConfidence,
      matchupCompleteness
    }, CONFIG?.confidence?.poolWeights || { selectedChampions: 60, matchupCompleteness: 40 });

    const parts = {
      matchupCoverage: (matchupCore.matchupCoverage ?? 0) * 100,
      weaknessSeverity: (matchupCore.weaknessSeverity ?? 1) * 100,
      weaknessControl: (matchupCore.weaknessControl ?? 0) * 100,
      averageChampionStrength,
      damageVariety,
      profileDiversity,
      dataConfidence
    };
    const finalScore = weightedScore(parts, CONFIG?.poolEvaluation?.weights || {
      matchupCoverage: 30, weaknessControl: 25, averageChampionStrength: 15,
      damageVariety: 15, profileDiversity: 5, dataConfidence: 10
    });
    return {
      ...parts,
      finalScore,
      knownMatchups: matchupCore.known.length,
      totalOpponents: matchupCore.totalOpponents,
      totalMatchupGames: matchupCore.totalMatchupGames,
      matchupDiagnostics: matchupCore.diagnostics
    };
  }

  function finalLabel(score) {
    const labels = Array.isArray(CONFIG?.poolEvaluation?.labels) ? CONFIG.poolEvaluation.labels : [];
    const sorted = labels.slice().sort((a, b) => (safeNumber(b.min) ?? 0) - (safeNumber(a.min) ?? 0));
    return sorted.find((entry) => score >= (safeNumber(entry.min) ?? 0))?.text || 'Pool da valutare';
  }

  function toneForScore(score) {
    if (score >= 70) return 'tone-good';
    if (score >= 50) return 'tone-mid';
    return 'tone-bad';
  }

  function bestAutomaticFirst() {
    const pool = state.rigorousChampions.length ? state.rigorousChampions : championsForRole();
    const weights = CONFIG?.championStrength?.automaticFirstPickWeights || { strength: 80, confidence: 20 };
    return pool.slice().sort((a, b) => {
      const scoreA = weightedScore({ strength: championAbsoluteStrength(a), confidence: championDataConfidence(a) }, weights);
      const scoreB = weightedScore({ strength: championAbsoluteStrength(b), confidence: championDataConfidence(b) }, weights);
      return scoreB - scoreA
        || profileGames(state.role, b) - profileGames(state.role, a)
        || localeSort(a, b);
    })[0] || null;
  }

  function recommendationReasons(row) {
    const reasons = [];
    if (row.fixedCount > 0) reasons.push({ type: 'plus', text: `Risolve ${row.fixedCount} ${row.fixedCount === 1 ? 'debolezza' : 'debolezze'} con evidenza statistica sufficiente.` });
    if (row.improvedCount > 0) reasons.push({ type: 'plus', text: `Diventa la risposta migliore contro ${row.improvedCount} avversari rilevanti.` });
    if (row.newCoverageCount > 0) reasons.push({ type: 'plus', text: `Aggiunge una risposta nota contro ${row.newCoverageCount} ${row.newCoverageCount === 1 ? 'avversario prima scoperto' : 'avversari prima scoperti'}.` });
    const damage = damageProfile(row.candidate);
    const currentTypes = new Set(state.selected.map((champion) => damageProfile(champion).type));
    if (damage.type === 'magic' && !currentTypes.has('magic')) reasons.push({ type: 'plus', text: 'Aggiunge una vera opzione di danno magico.' });
    else if (damage.type === 'physical' && !currentTypes.has('physical')) reasons.push({ type: 'plus', text: 'Aggiunge una vera opzione di danno fisico.' });
    else if (damage.type === 'hybrid') reasons.push({ type: 'info', text: 'Aggiunge un profilo di danno ibrido.' });
    else if (damage.type === 'unknown') reasons.push({ type: 'minus', text: 'Profilo del danno non disponibile nel dataset.' });
    const diversityHigh = CONFIG?.recommendation?.diversityHigh ?? 0.35;
    const diversityLow = CONFIG?.recommendation?.diversityLow ?? 0.16;
    if (row.profileDiversity >= diversityHigh) reasons.push({ type: 'plus', text: 'Profilo poco sovrapposto ai campioni già scelti.' });
    else if (row.profileDiversity < diversityLow) reasons.push({ type: 'minus', text: 'Profilo simile a una scelta già presente.' });
    if (row.belowRigorous) reasons.push({ type: 'minus', text: 'Copertura statistica sotto la soglia Rigorosa.' });
    else reasons.push({ type: 'info', text: `Copertura Rigorosa: ${integer(profileGames(state.role, row.candidate))} partite nel ruolo.` });
    const warningRatio = CONFIG?.recommendation?.knownOpponentWarningRatio ?? 0.60;
    if (row.knownCount < Math.ceil(row.relevantOpponentCount * warningRatio)) reasons.push({ type: 'minus', text: 'Diversi matchup diretti non sono disponibili: valutazione meno affidabile.' });
    return reasons.slice(0, 4);
  }

  // ==========================================================================
  // 6. INTERFACCIA E INTERAZIONI
  // ==========================================================================

  function updateHeroStats() {
    const roleCount = roleOrder().length;
    const championCount = state.role ? championsForRole().length : 0;
    const roleEl = byId('heroRoleCount');
    const championEl = byId('heroChampionCount');
    if (roleEl) roleEl.textContent = integer(roleCount);
    if (championEl) championEl.textContent = state.role ? integer(championCount) : '—';
  }

  function renderRoleChoices() {
    byId('roleGrid').innerHTML = roleOrder().map((role) => `<button class="choice${state.role === role ? ' selected' : ''}" type="button" data-role="${esc(role)}" aria-pressed="${state.role === role ? 'true' : 'false'}">${esc(roleLabel(role))}</button>`).join('');
  }

  function renderSizeChoices() {
    byId('sizeGrid').innerHTML = [2, 3, 4, 5].map((size) => `<button class="choice${state.size === size ? ' selected' : ''}" type="button" data-size="${size}" aria-pressed="${state.size === size ? 'true' : 'false'}">${size}</button>`).join('');
  }

  function renderThreshold() {
    const box = byId('thresholdBox');
    if (!state.role) {
      box.textContent = 'Seleziona una lane per calcolare la soglia.';
      return;
    }
    const allCount = championsForRole().length;
    const coverage = allCount ? state.rigorousChampions.length / allCount : 0;
    const scope = CONFIG?.dataSelection?.evaluationOpponents === 'rigorous'
      ? 'La valutazione copre soltanto questo gruppo.'
      : CONFIG?.dataSelection?.evaluationOpponents === 'blend'
        ? 'La valutazione copre tutta la lane, ma pesa di più gli avversari Rigorosi e quelli più popolari.'
        : 'La valutazione copre tutta la lane; il gruppo Rigoroso serve soprattutto per i consigli.';
    box.innerHTML = `<strong>Filtro Rigoroso:</strong> almeno ${integer(state.rigorousThreshold)} partite nel ruolo. Superano il filtro ${state.rigorousChampions.length}/${allCount} campioni (${pct(coverage, 0)}). ${esc(scope)}`;
  }

  function updateStartButton() {
    byId('startBtn').disabled = !state.role || !state.size || !championsForRole().length;
  }

  function setRole(role) {
    state.role = role;
    const rigorous = calculateRigorousSet(role);
    state.rigorousThreshold = rigorous.threshold;
    state.rigorousChampions = rigorous.eligible;
    // 'blend' usa l'intera lane come 'all': il bilanciamento verso il gruppo
    // Rigoroso avviene tramite il peso (opponentLikelihoodWeight), non
    // escludendo avversari dall'insieme valutato.
    state.opponents = CONFIG?.dataSelection?.evaluationOpponents === 'rigorous'
      ? rigorous.eligible.slice()
      : rigorous.all.slice();
    state.firstChampion = null;
    byId('firstChampion').value = '';
    const firstValidation = byId('firstValidation');
    if (firstValidation) firstValidation.hidden = true;
    state.customChampion = null;
    byId('customChampion').value = '';
    state.counterQuery = '';
    const counterSearch = byId('counterSearchInput');
    if (counterSearch) counterSearch.value = '';
    state.comboControllers.forEach((controller) => controller.setOptions(championOptions()));
    renderRoleChoices();
    renderThreshold();
    updateHeroStats();
    updateStartButton();
  }

  function championOptions(excludeSelected = false) {
    if (!state.role) return [];
    return championsForRole().filter((champion) => !excludeSelected || !state.selected.includes(champion)).map((champion) => ({
      value: champion,
      label: champion,
      low: profileGames(state.role, champion) < state.rigorousThreshold,
      meta: `${pct(profilesForRole()?.[champion]?.general_winrate, 1)} · ${integer(profileGames(state.role, champion))}`
    }));
  }

  function createCombobox(root, inputId, onSelect, excludeSelected = false) {
    const input = byId(inputId);
    const list = $('.combo-list', root);
    const listId = `${inputId}-listbox`;
    list.id = listId;
    input.setAttribute('aria-controls', listId);
    let options = [];
    let filtered = [];
    let activeIndex = -1;
    const elevatedAncestors = Array.from(new Set([
      root,
      root.closest('.builder-step'),
      root.closest('.pool-setup-card'),
      root.closest('.pool-work-card'),
      root.closest('.pool-workspace'),
      root.closest('.pool-builder-grid')
    ].filter(Boolean)));

    function setExpanded(open) {
      list.hidden = !open;
      input.setAttribute('aria-expanded', String(open));
      root.classList.toggle('combo-open', open);
      elevatedAncestors.slice(1).forEach((element) => {
        if (open) element.classList.add('combo-open');
        else if (!element.querySelector('.pool-field.combo-open')) element.classList.remove('combo-open');
      });
    }

    function setOptions(next) {
      options = Array.isArray(next) ? next : [];
      render(input.value);
    }

    function render(query = '') {
      const term = String(query).trim().toLocaleLowerCase('it');
      filtered = options.filter((option) => option.label.toLocaleLowerCase('it').includes(term)).slice(0, 60);
      activeIndex = Math.min(activeIndex, filtered.length - 1);
      list.innerHTML = filtered.length ? filtered.map((option, index) => `
        <button type="button" id="${inputId}-option-${index}" class="combo-option${option.low ? ' low' : ''}${index === activeIndex ? ' active' : ''}" role="option" tabindex="-1" aria-selected="${index === activeIndex ? 'true' : 'false'}" data-value="${esc(option.value)}">
          <strong>${champHtml(option.label, 'sm')}</strong><small>${esc(option.meta || '')}</small>
        </button>`).join('') : '<div class="combo-empty">Nessun campione trovato.</div>';
      setExpanded(document.activeElement === input);
      if (activeIndex >= 0 && filtered[activeIndex]) input.setAttribute('aria-activedescendant', `${inputId}-option-${activeIndex}`);
      else input.removeAttribute('aria-activedescendant');
    }

    function commit(option) {
      if (!option) return;
      input.value = option.label;
      setExpanded(false);
      activeIndex = -1;
      onSelect(option.value);
    }

    input.addEventListener('focus', () => {
      if (excludeSelected) setOptions(championOptions(true));
      render(input.value);
      setExpanded(true);
    });
    input.addEventListener('input', () => {
      onSelect(null, true);
      if (inputId === 'firstChampion') { const validation = byId('firstValidation'); if (validation) validation.hidden = true; }
      if (excludeSelected) options = championOptions(true);
      render(input.value);
      setExpanded(true);
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault(); activeIndex = Math.min(filtered.length - 1, activeIndex + 1); render(input.value); setExpanded(true);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault(); activeIndex = Math.max(0, activeIndex - 1); render(input.value); setExpanded(true);
      } else if (event.key === 'Enter') {
        const exact = filtered.find((option) => option.label.toLocaleLowerCase('it') === input.value.trim().toLocaleLowerCase('it'));
        const option = activeIndex >= 0 ? filtered[activeIndex] : exact;
        if (option) { event.preventDefault(); commit(option); }
      } else if (event.key === 'Escape') {
        setExpanded(false);
      }
    });
    list.addEventListener('mousedown', (event) => event.preventDefault());
    list.addEventListener('click', (event) => {
      const button = event.target.closest('[data-value]');
      if (!button) return;
      commit(options.find((option) => option.value === button.dataset.value));
    });
    input.addEventListener('blur', () => window.setTimeout(() => setExpanded(false), 120));

    const controller = { setOptions };
    state.comboControllers.push(controller);
    setOptions(championOptions(excludeSelected));
    return controller;
  }

  function renderPool() {
    const evaluation = evaluatePool(state.selected);
    byId('poolTitle').textContent = `${roleLabel(state.role)} · ${state.selected.length}/${state.size} campioni`;
    byId('poolSubtitle').textContent = state.selected.length < state.size ? 'Aggiungi il prossimo pick per completare la pool.' : 'Pool completata: valutazione finale disponibile.';
    byId('slots').innerHTML = Array.from({ length: state.size }, (_, index) => {
      const champion = state.selected[index];
      if (!champion) return `<div class="slot"><div class="slot-index">Pick ${index + 1}</div><div class="slot-name" style="color:var(--ink-faint)">Vuoto</div></div>`;
      const profile = profilesForRole()?.[champion] || {};
      const damage = damageProfile(champion);
      const canRemove = state.selected.length > 1;
      return `<div class="slot filled"><div class="slot-index">Pick ${index + 1}</div><div class="slot-name">${champHtml(champion, 'md')}</div><div class="slot-meta">WR ${pct(profile.general_winrate)} · ${esc(damageTypeLabel(damage.type))}</div>${canRemove ? `<button class="slot-remove" type="button" data-remove-index="${index}">Rimuovi</button>` : ''}</div>`;
    }).join('');

    const scoreItems = [
      ['Valutazione corrente', evaluation?.finalScore, 'Punteggio ricalcolato sull’intera pool.'],
      ['Copertura matchup', evaluation?.matchupCoverage, `Sintesi di media statistica, media per avversario e ${Math.round((CONFIG?.matchup?.worstTailShare ?? 0.20) * 100)}% peggiore.`],
      ['Controllo debolezze', evaluation?.weaknessControl, 'Premia la tenuta media ma conserva peso per i matchup peggiori.'],
      ['Forza generale', evaluation?.averageChampionStrength, 'Solidità individuale dei campioni.'],
      ['Varietà danno', evaluation?.damageVariety, 'Opzioni fisiche, magiche e ibride; i dati mancanti penalizzano il valore.'],
      ['Affidabilità', evaluation?.dataConfidence, `${evaluation?.knownMatchups ?? 0}/${evaluation?.totalOpponents ?? 0} avversari con risposta nota.`]
    ];
    byId('currentScores').innerHTML = scoreItems.map(([label, value, note]) => `<div class="score-card"><div class="score-label">${esc(label)}</div><div class="score-value ${toneForScore(value)}">${scoreFmt(value)}</div><div class="score-note">${esc(note)}</div></div>`).join('');
    const damage = damageDescription(state.selected);
    const notice = byId('damageNotice');
    notice.className = `notice ${damage.tone}`.trim();
    notice.innerHTML = `<span aria-hidden="true">◆</span><div>${damage.html}</div>`;
    byId('undoBtn').disabled = state.selected.length <= 1;
  }

  function renderRecommendations() {
    const panel = byId('recommendationPanel');
    const customPanel = byId('customPanel');
    if (state.selected.length >= state.size) {
      panel.hidden = true;
      customPanel.hidden = true;
      return;
    }
    state.recommendationRows = buildCandidateRows(state.selected);
    const top = state.recommendationRows.slice(0, RECOMMENDATION_LIMIT);
    byId('recoCount').textContent = `Scelta ${state.selected.length + 1} di ${state.size}`;
    byId('recommendations').innerHTML = top.length ? top.map((row, index) => {
      const reasons = recommendationReasons(row);
      return `<article class="reco"><div class="reco-rank">${index + 1}</div><div><h3>${champHtml(row.candidate, 'md')}</h3><div class="reco-sub">WR ${pct(profilesForRole()?.[row.candidate]?.general_winrate)} · ${integer(profileGames(state.role, row.candidate))} partite</div></div><div class="reco-score ${toneForScore(row.score)}">${scoreFmt(row.score)}<div class="reco-sub">indice /100</div></div><div class="reco-reasons">${reasons.map((reason) => `<div class="reason ${reason.type}">${esc(reason.text)}</div>`).join('')}</div><button type="button" data-add-champion="${esc(row.candidate)}">Aggiungi</button></article>`;
    }).join('') : '<div class="notice warn">Non ci sono altri campioni disponibili per questa lane.</div>';
    panel.hidden = false;
    customPanel.hidden = false;
    state.comboControllers.forEach((controller) => controller.setOptions(championOptions(true)));
    updateCustomPreview();
  }

  function customCandidateRow(champion) {
    if (!champion || state.selected.includes(champion)) return null;
    const currentCore = evaluateMatchupCore(state.selected);
    const rows = buildCandidateRows(state.selected);
    const found = rows.find((row) => row.candidate === champion);
    if (found) return found;
    const raw = candidateRawMetrics(champion, state.selected, currentCore);
    const comparison = [...rows, raw];
    ['matchupComplement', 'strength', 'damageImprovement', 'profileDiversity', 'confidence'].forEach((key) => percentileRanks(comparison, key));
    applyRecommendationScore(raw);
    return raw;
  }

  function updateCustomPreview() {
    const preview = byId('customPreview');
    const addButton = byId('addCustomBtn');
    const row = customCandidateRow(state.customChampion);
    addButton.disabled = !row;
    if (!row) {
      preview.hidden = true;
      preview.innerHTML = '';
      return;
    }
    const warning = row.belowRigorous ? ' Scelta personale sotto la soglia Rigorosa: valutazione meno affidabile.' : '';
    const damage = damageProfile(row.candidate);
    preview.innerHTML = `<div class="preview-card"><div><h3>${champHtml(row.candidate, 'md')}</h3><p>Indice di aggiunta ${scoreFmt(row.score)}/100. Diventa la risposta migliore in ${row.improvedCount} matchup, ne risolve ${row.fixedCount} e aggiunge ${row.newCoverageCount} risposte prima mancanti.${esc(warning)} Profilo danno: ${esc(damageTypeLabel(damage.type))}.</p></div><div class="preview-score ${toneForScore(row.score)}">${scoreFmt(row.score)}</div></div>`;
    preview.hidden = false;
  }



  function setQuickValidation(message = '', kind = 'error') {
    const element = byId('quickPoolValidation');
    if (!element) return;
    element.hidden = !message;
    element.textContent = message;
    element.className = `quick-validation ${kind}`;
  }

  function quickCounterCell(answer, rank, target) {
    if (!answer) return '<td class="quick-counter-empty">—</td>';
    if (!answer.hasData) {
      return `<td><div class="quick-table-counter unavailable"><span>#${rank}</span><strong>${champHtml(answer.champion, 'xs')}</strong><em>N/D</em><small>Matchup assente</small></div></td>`;
    }
    const deepLink = `./visual.html?role=${encodeURIComponent(state.quickRole)}&a=${encodeURIComponent(answer.champion)}&b=${encodeURIComponent(target)}`;
    return `<td><a class="quick-table-counter" href="${esc(deepLink)}" title="Apri ${esc(answer.champion)} contro ${esc(target)}"><span>#${rank}</span><strong>${champHtml(answer.champion, 'xs')}</strong><em>${esc(poolCounterMetricFormat(answer, state.quickMetric))}</em><small>WR ${pct(answer.winrate, 1)} · Δ ${signedPct(answer.diff, 1)} · ${integer(answer.games)} game</small></a></td>`;
  }

  function renderQuickCounterTable() {
    const results = byId('quickCounterResults');
    if (!results) return;
    if (!state.quickRole || !state.quickPool.length) {
      results.hidden = true;
      state.quickMatrix = null;
      return;
    }

    const matrix = buildPoolCounterMatrix(state.quickPool, {
      role: state.quickRole,
      scope: state.quickScope,
      metric: state.quickMetric,
      confidence: state.quickConfidence,
      query: state.quickQuery
    });
    state.quickMatrix = matrix;
    results.hidden = false;

    const scopeSelect = byId('quickScopeSelect');
    const metricSelect = byId('quickMetricSelect');
    const confidenceSelect = byId('quickConfidenceSelect');
    const confidenceField = byId('quickConfidenceField');
    const searchInput = byId('quickSearchInput');
    if (scopeSelect) {
      scopeSelect.value = state.quickScope;
      const q50Option = scopeSelect.querySelector('option[value="q50"]');
      const allOption = scopeSelect.querySelector('option[value="all"]');
      if (q50Option) q50Option.textContent = `Q50 · ${matrix.q50Count}`;
      if (allOption) allOption.textContent = `Tutti · ${matrix.allCount}`;
    }
    if (metricSelect) metricSelect.value = state.quickMetric;
    if (confidenceSelect) confidenceSelect.value = String(state.quickConfidence);
    if (confidenceField) confidenceField.hidden = state.quickMetric !== 'wilson';
    if (searchInput && searchInput.value !== state.quickQuery) searchInput.value = state.quickQuery;

    const metric = POOL_COUNTER_METRICS[state.quickMetric] || POOL_COUNTER_METRICS.wilson;
    const scopeText = state.quickScope === 'all'
      ? `tutti i ${matrix.allCount} campioni del ruolo`
      : `${matrix.q50Count} campioni Q50 con almeno ${integer(matrix.q50Threshold)} partite`;
    byId('quickCounterSummary').innerHTML = `<strong>${esc(roleLabel(state.quickRole))}</strong> · Pool: <strong>${state.quickPool.map(esc).join(' / ')}</strong> · ${esc(scopeText)} · ordinamento: <strong>${esc(metric.label)}</strong>.`;
    byId('quickCounterCount').textContent = `${matrix.rows.length} ${matrix.rows.length === 1 ? 'riga' : 'righe'}`;
    const download = byId('quickDownloadBtn');
    if (download) download.disabled = !matrix.rows.length;

    const maxRanks = Math.max(1, state.quickPool.length);
    const head = byId('quickCounterTableHead');
    const body = byId('quickCounterTableBody');
    head.innerHTML = `<tr><th scope="col">Campione della lane</th><th scope="col">Partite ruolo</th><th scope="col">Stato</th>${Array.from({ length: maxRanks }, (_, index) => `<th scope="col">#${index + 1} della pool</th>`).join('')}</tr>`;

    if (!matrix.rows.length) {
      body.innerHTML = `<tr><td class="quick-table-no-results" colspan="${3 + maxRanks}">Nessun campione corrisponde alla ricerca.</td></tr>`;
      return;
    }

    body.innerHTML = matrix.rows.map((row) => {
      const cells = Array.from({ length: maxRanks }, (_, index) => quickCounterCell(row.counters[index], index + 1, row.target)).join('');
      return `<tr><th scope="row"><strong>${champHtml(row.target, 'xs')}</strong></th><td class="quick-number">${integer(row.targetGames)}</td><td>${row.inPool ? '<span class="quick-pool-badge">Nella pool</span>' : '<span class="quick-out-badge">Avversario</span>'}</td>${cells}</tr>`;
    }).join('');
  }

  function generateQuickCounterTable() {
    const parsed = parseQuickPoolText(byId('quickPoolInput')?.value);
    if (parsed.error) {
      state.quickRole = null;
      state.quickPool = [];
      state.quickMatrix = null;
      renderQuickCounterTable();
      setQuickValidation(parsed.error, 'error');
      announce(parsed.error);
      return;
    }

    state.quickRole = parsed.role;
    state.quickPool = parsed.pool;
    state.quickUnknownChampions = parsed.unknown;
    state.quickQuery = '';
    const search = byId('quickSearchInput');
    if (search) search.value = '';
    if (parsed.unknown.length) {
      setQuickValidation(`Tabella generata. Campioni ignorati perché non trovati in ${roleLabel(parsed.role)}: ${parsed.unknown.join(', ')}.`, 'warning');
    } else {
      setQuickValidation(`Riconosciuti ${parsed.pool.length} campioni in ${roleLabel(parsed.role)}.`, 'success');
    }
    renderQuickCounterTable();
    byId('quickCounterResults')?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    announce(`Tabella counter generata per ${roleLabel(parsed.role)} con ${parsed.pool.length} campioni.`);
  }

  function csvCell(value) {
    const text = String(value ?? '');
    return `"${text.replaceAll('"', '""')}"`;
  }

  function downloadQuickCounterCsv() {
    const matrix = state.quickMatrix;
    if (!matrix?.rows?.length) return;
    const maxRanks = Math.max(1, state.quickPool.length);
    const metric = POOL_COUNTER_METRICS[state.quickMetric] || POOL_COUNTER_METRICS.wilson;
    const headers = ['Campione ruolo', 'Partite ruolo', 'Nella pool'];
    for (let rank = 1; rank <= maxRanks; rank += 1) {
      headers.push(`#${rank} counter`, `#${rank} ${metric.label}`, `#${rank} WR`, `#${rank} WR diff`, `#${rank} partite`);
    }

    const rows = matrix.rows.map((row) => {
      const values = [row.target, Math.round(row.targetGames || 0), row.inPool ? 'Sì' : 'No'];
      for (let index = 0; index < maxRanks; index += 1) {
        const answer = row.counters[index];
        if (!answer) {
          values.push('', '', '', '', '');
        } else if (!answer.hasData) {
          values.push(answer.champion, 'N/D', 'N/D', 'N/D', 'N/D');
        } else {
          values.push(
            answer.champion,
            poolCounterMetricFormat(answer, state.quickMetric),
            pct(answer.winrate, 2),
            signedPct(answer.diff, 2),
            Math.round(answer.games || 0)
          );
        }
      }
      return values;
    });

    const csv = '\uFEFF' + [headers, ...rows].map((row) => row.map(csvCell).join(';')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `pool-counter-${String(state.quickRole).toLocaleLowerCase('it')}-${state.quickScope}-${state.quickMetric}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    announce(`Tabella CSV scaricata con ${matrix.rows.length} righe.`);
  }

  function clearQuickCounter() {
    const input = byId('quickPoolInput');
    if (input) input.value = '';
    state.quickRole = null;
    state.quickPool = [];
    state.quickQuery = '';
    state.quickMatrix = null;
    state.quickUnknownChampions = [];
    setQuickValidation();
    renderQuickCounterTable();
    input?.focus();
  }

  function renderCounterCoverage() {
    const panel = byId('counterCoveragePanel');
    if (!panel) return;
    if (!state.started || state.selected.length < 2) {
      panel.hidden = true;
      return;
    }

    const matrix = buildPoolCounterMatrix(state.selected, {
      role: state.role,
      scope: state.counterScope,
      metric: state.counterMetric,
      confidence: state.counterConfidence,
      query: state.counterQuery
    });
    const metric = POOL_COUNTER_METRICS[state.counterMetric] || POOL_COUNTER_METRICS.wilson;
    const scopeSelect = byId('counterScopeSelect');
    const metricSelect = byId('counterMetricSelect');
    const confidenceSelect = byId('counterConfidenceSelect');
    const confidenceField = byId('counterConfidenceField');
    const searchInput = byId('counterSearchInput');

    if (scopeSelect) {
      scopeSelect.value = state.counterScope;
      const q50Option = scopeSelect.querySelector('option[value="q50"]');
      const allOption = scopeSelect.querySelector('option[value="all"]');
      if (q50Option) q50Option.textContent = `Q50 · ${matrix.q50Count} campioni`;
      if (allOption) allOption.textContent = `Tutti · ${matrix.allCount} campioni`;
    }
    if (metricSelect) metricSelect.value = state.counterMetric;
    if (confidenceSelect) confidenceSelect.value = String(state.counterConfidence);
    if (confidenceField) confidenceField.hidden = state.counterMetric !== 'wilson';
    if (searchInput && searchInput.value !== state.counterQuery) searchInput.value = state.counterQuery;

    const scopeText = state.counterScope === 'all'
      ? `tutti i ${matrix.allCount} campioni disponibili nel ruolo`
      : `i ${matrix.q50Count} campioni Q50 con almeno ${integer(matrix.q50Threshold)} partite nel ruolo`;
    byId('counterCoverageSummary').innerHTML = `<strong>${esc(roleLabel(state.role))}:</strong> analizzo ${esc(scopeText)}. Per ogni avversario ordino i campioni della pool con <strong>${esc(metric.label)}</strong>. Il campione della riga, quando è già nella pool, non può counterare sé stesso.`;
    byId('counterMetricNote').textContent = state.counterMetric === 'wilson'
      ? `${metric.description} Livello di prudenza selezionato: ${state.counterConfidence}%.`
      : metric.description;
    byId('counterResultCount').textContent = `${matrix.rows.length} ${matrix.rows.length === 1 ? 'campione' : 'campioni'}`;

    const list = byId('counterCoverageRows');
    if (!matrix.rows.length) {
      list.innerHTML = '<div class="counter-empty">Nessun campione corrisponde al filtro di ricerca.</div>';
      panel.hidden = false;
      return;
    }

    list.innerHTML = matrix.rows.map((row) => {
      const answers = row.counters.length ? row.counters.map((answer, index) => {
        const rank = index + 1;
        if (!answer.hasData) {
          return `<div class="pool-counter-answer unavailable"><span class="counter-answer-rank">#${rank}</span><strong>${champHtml(answer.champion, 'xs')}</strong><span class="counter-answer-primary">N/D</span><small>Matchup non presente nel dataset</small></div>`;
        }
        const deepLink = `./visual.html?role=${encodeURIComponent(state.role)}&a=${encodeURIComponent(answer.champion)}&b=${encodeURIComponent(row.target)}`;
        const metricValue = poolCounterMetricFormat(answer, state.counterMetric);
        const meta = `WR ${pct(answer.winrate, 1)} · Δ ${signedPct(answer.diff, 1)} · ${integer(answer.games)} partite`;
        return `<a class="pool-counter-answer" href="${esc(deepLink)}" title="Apri ${esc(answer.champion)} contro ${esc(row.target)} nel Matchup Lab"><span class="counter-answer-rank">#${rank}</span><strong>${champHtml(answer.champion, 'xs')}</strong><span class="counter-answer-primary">${esc(metricValue)}</span><small>${esc(meta)}</small></a>`;
      }).join('') : '<div class="counter-no-answer">Nessun altro campione della pool può essere confrontato con questa riga.</div>';

      const poolBadge = row.inPool ? '<span class="counter-badge in-pool">Nella pool</span>' : '';
      return `<article class="pool-counter-target"><div class="counter-target-head"><div><h3>${champHtml(row.target, 'sm')}</h3><p>${integer(row.targetGames)} partite nel ruolo</p></div>${poolBadge}</div><div class="counter-answer-list">${answers}</div></article>`;
    }).join('');
    panel.hidden = false;
  }

  function renderFinal() {
    const panel = byId('finalPanel');
    if (state.selected.length < state.size) {
      panel.hidden = true;
      return;
    }
    const evaluation = evaluatePool(state.selected);
    const weights = weightPercentages(CONFIG?.poolEvaluation?.weights || {});
    const fields = [
      ['Copertura matchup', evaluation.matchupCoverage, weights.matchupCoverage],
      ['Controllo debolezze', evaluation.weaknessControl, weights.weaknessControl],
      ['Forza generale', evaluation.averageChampionStrength, weights.averageChampionStrength],
      ['Varietà danno', evaluation.damageVariety, weights.damageVariety],
      ['Diversità profili', evaluation.profileDiversity, weights.profileDiversity],
      ['Affidabilità dati', evaluation.dataConfidence, weights.dataConfidence]
    ];
    const copyText = `${roleLabel(state.role).toUpperCase()} — ${state.selected.join(' / ')}`;
    byId('finalContent').innerHTML = `
      <div class="final-hero"><div class="final-score">${scoreFmt(evaluation.finalScore)}</div><div><div class="micro-label">Valutazione statistica finale</div><h2>${esc(finalLabel(evaluation.finalScore))}</h2><p>Il punteggio descrive la completezza statistica della pool, non la padronanza personale. I pesi mostrati qui provengono direttamente da <code>pool.config.js</code>.</p></div></div>
      <div class="breakdown">${fields.map(([label, value, weight]) => `<div class="metric"><div class="metric-top"><span>${esc(label)}</span><strong>${scoreFmt(value)} · ${Math.round(weight || 0)}%</strong></div><div class="bar"><span style="width:${clamp(value, 0, 100)}%"></span></div></div>`).join('')}</div>
      <div class="copy-box"><textarea id="copyOutput" readonly>${esc(copyText)}</textarea><button id="copyBtn" class="secondary" type="button">Copia la pool</button></div>`;
    panel.hidden = false;
    byId('copyBtn').addEventListener('click', copyPool);
  }

  function renderWorkspace() {
    byId('emptyState').hidden = state.started;
    byId('poolPanel').hidden = !state.started;
    if (!state.started) {
      const counterPanel = byId('counterCoveragePanel');
      if (counterPanel) counterPanel.hidden = true;
      return;
    }
    renderPool();
    renderRecommendations();
    renderFinal();
    renderCounterCoverage();
  }

  function addChampion(champion) {
    if (!champion || state.selected.includes(champion) || state.selected.length >= state.size) return;
    state.selected.push(champion);
    state.customChampion = null;
    byId('customChampion').value = '';
    renderWorkspace();
    announce(`${champion} aggiunto. ${state.selected.length} campioni su ${state.size}.`);
    if (state.selected.length >= state.size) {
      const smooth = CONFIG?.ui?.smoothScroll !== false && !prefersReducedMotion();
      byId('finalPanel').scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
    }
  }

  function removeAt(index) {
    if (state.selected.length <= 1 || index < 0 || index >= state.selected.length) return;
    const [removed] = state.selected.splice(index, 1);
    renderWorkspace();
    announce(`${removed} rimosso dalla pool.`);
  }

  function startBuilder() {
    if (!state.role || !state.size) return;
    const typed = byId('firstChampion').value.trim();
    const exact = championsForRole().find((champion) => champion.toLocaleLowerCase('it') === typed.toLocaleLowerCase('it'));
    const validation = byId('firstValidation');
    if (typed && !state.firstChampion && !exact) {
      if (validation) validation.hidden = false;
      byId('firstChampion').focus();
      announce('Seleziona un campione valido dall’elenco oppure lascia il campo vuoto.');
      return;
    }
    if (validation) validation.hidden = true;
    const first = state.firstChampion || exact || bestAutomaticFirst();
    if (!first) return;
    state.selected = [first];
    state.started = true;
    state.customChampion = null;
    renderWorkspace();
    const automatic = !state.firstChampion && !exact;
    announce(`${first} selezionato come primo campione${automatic ? ' automaticamente' : ''}.`);
  }

  function resetBuilder() {
    state.selected = [];
    state.started = false;
    state.customChampion = null;
    state.recommendationRows = [];
    byId('customChampion').value = '';
    renderWorkspace();
    announce('Pool Builder azzerato.');
  }

  async function copyPool() {
    const textarea = byId('copyOutput');
    if (!textarea) return;
    const text = textarea.value;
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      textarea.focus();
      textarea.select();
      document.execCommand('copy');
    }
    const button = byId('copyBtn');
    if (button) {
      button.textContent = 'Copiata';
      window.setTimeout(() => { button.textContent = 'Copia la pool'; }, 1300);
    }
    announce('Champion pool copiata negli appunti.');
  }

  function validateConfiguration() {
    const warnings = [];
    const weightGroups = [
      ['matchup.rawScoreWeights', CONFIG?.matchup?.rawScoreWeights],
      ['matchup.coverageBlendWeights', CONFIG?.matchup?.coverageBlendWeights],
      ['matchup.weaknessBlendWeights', CONFIG?.matchup?.weaknessBlendWeights],
      ['recommendation.weights', CONFIG?.recommendation?.weights],
      ['poolEvaluation.weights', CONFIG?.poolEvaluation?.weights]
    ];
    weightGroups.forEach(([name, weights]) => {
      const total = Object.values(weights || {}).reduce((sum, value) => sum + Math.max(0, safeNumber(value) ?? 0), 0);
      if (total <= 0) warnings.push(`${name}: inserisci almeno un peso maggiore di zero.`);
    });
    const quantile = safeNumber(CONFIG?.dataSelection?.rigorousQuantile);
    if (quantile === null || quantile < 0 || quantile > 1) warnings.push('dataSelection.rigorousQuantile deve essere compreso tra 0 e 1.');
    const floor = safeNumber(CONFIG?.championStrength?.winrateFloor);
    const ceiling = safeNumber(CONFIG?.championStrength?.winrateCeiling);
    if (floor === null || ceiling === null || ceiling <= floor) warnings.push('championStrength.winrateCeiling deve essere maggiore di winrateFloor.');
    if (!['all', 'rigorous', 'blend'].includes(CONFIG?.dataSelection?.evaluationOpponents)) warnings.push("dataSelection.evaluationOpponents deve essere 'all', 'rigorous' oppure 'blend'.");
    warnings.forEach((warning) => console.warn(`[Pool Builder config] ${warning}`));
    return warnings;
  }

  function renderConfigurationSummary() {
    const quantile = clamp(CONFIG?.dataSelection?.rigorousQuantile ?? 0.75, 0, 1);
    const quantileLabel = `Q${Math.round(quantile * 100)}`;
    const filterEl = byId('heroFilterMode');
    if (filterEl) filterEl.textContent = quantileLabel;

    const strip = byId('methodStrip');
    if (strip) {
      const weights = weightPercentages(CONFIG?.poolEvaluation?.weights || {});
      const matchupTotal = (weights.matchupCoverage || 0) + (weights.weaknessControl || 0);
      const compositionTotal = (weights.averageChampionStrength || 0) + (weights.damageVariety || 0) + (weights.profileDiversity || 0);
      strip.innerHTML = `
        <div class="pool-method-item"><span>${Math.round(matchupTotal)}%</span><strong>Matchup e debolezze</strong></div>
        <div class="pool-method-item"><span>${Math.round(compositionTotal)}%</span><strong>Forza e composizione</strong></div>
        <div class="pool-method-item"><span>${Math.round(weights.dataConfidence || 0)}%</span><strong>Affidabilità dati</strong></div>`;
    }
  }

  function exposeDebugApi() {
    window.POOL_BUILDER_API = {
      config: CONFIG,
      getState: () => ({ ...state, selected: state.selected.slice(), opponents: state.opponents.slice() }),
      getMatchup: (role, champion, opponent) => getMatchup(role, champion, opponent),
      evaluateCurrentPool: () => evaluatePool(state.selected),
      buildCounterMatrix: (pool = state.selected, options = {}) => buildPoolCounterMatrix(pool, options),
      parseQuickPool: (text) => parseQuickPoolText(text),
      recommendationRows: () => state.recommendationRows.map((row) => ({ ...row })),
      validateConfig: () => validateConfiguration().slice()
    };
  }

  function bindEvents() {
    byId('quickAnalyzeBtn').addEventListener('click', generateQuickCounterTable);
    byId('quickExampleBtn').addEventListener('click', () => {
      byId('quickPoolInput').value = 'TOP — Singed / Irelia / Nasus';
      generateQuickCounterTable();
    });
    byId('quickClearBtn').addEventListener('click', clearQuickCounter);
    byId('quickDownloadBtn').addEventListener('click', downloadQuickCounterCsv);
    byId('quickPoolInput').addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        generateQuickCounterTable();
      }
    });
    byId('quickScopeSelect').addEventListener('change', (event) => {
      state.quickScope = event.target.value === 'all' ? 'all' : 'q50';
      renderQuickCounterTable();
    });
    byId('quickMetricSelect').addEventListener('change', (event) => {
      state.quickMetric = POOL_COUNTER_METRICS[event.target.value] ? event.target.value : 'wilson';
      renderQuickCounterTable();
    });
    byId('quickConfidenceSelect').addEventListener('change', (event) => {
      const confidence = Number(event.target.value);
      state.quickConfidence = Object.prototype.hasOwnProperty.call(WILSON_Z, confidence) ? confidence : DEFAULT_POOL_COUNTER_CONFIDENCE;
      renderQuickCounterTable();
    });
    byId('quickSearchInput').addEventListener('input', (event) => {
      state.quickQuery = event.target.value;
      renderQuickCounterTable();
    });

    byId('roleGrid').addEventListener('click', (event) => {
      const button = event.target.closest('[data-role]');
      if (!button) return;
      setRole(button.dataset.role);
      if (state.started) resetBuilder();
    });
    byId('sizeGrid').addEventListener('click', (event) => {
      const button = event.target.closest('[data-size]');
      if (!button) return;
      state.size = Number(button.dataset.size);
      renderSizeChoices();
      if (state.started) resetBuilder();
    });
    byId('startBtn').addEventListener('click', startBuilder);
    byId('recommendations').addEventListener('click', (event) => {
      const button = event.target.closest('[data-add-champion]');
      if (button) addChampion(button.dataset.addChampion);
    });
    byId('addCustomBtn').addEventListener('click', () => addChampion(state.customChampion));
    byId('slots').addEventListener('click', (event) => {
      const button = event.target.closest('[data-remove-index]');
      if (button) removeAt(Number(button.dataset.removeIndex));
    });
    byId('undoBtn').addEventListener('click', () => removeAt(state.selected.length - 1));
    byId('resetBtn').addEventListener('click', resetBuilder);
    byId('counterScopeSelect').addEventListener('change', (event) => {
      state.counterScope = event.target.value === 'all' ? 'all' : 'q50';
      renderCounterCoverage();
      announce(`Copertura counter aggiornata: ${state.counterScope === 'all' ? 'tutti i campioni' : 'campioni Q50'}.`);
    });
    byId('counterMetricSelect').addEventListener('change', (event) => {
      state.counterMetric = POOL_COUNTER_METRICS[event.target.value] ? event.target.value : 'wilson';
      renderCounterCoverage();
      announce(`Ordinamento counter aggiornato: ${POOL_COUNTER_METRICS[state.counterMetric].label}.`);
    });
    byId('counterConfidenceSelect').addEventListener('change', (event) => {
      const confidence = Number(event.target.value);
      state.counterConfidence = Object.prototype.hasOwnProperty.call(WILSON_Z, confidence) ? confidence : DEFAULT_POOL_COUNTER_CONFIDENCE;
      renderCounterCoverage();
      announce(`Prudenza Wilson impostata al ${state.counterConfidence}%.`);
    });
    byId('counterSearchInput').addEventListener('input', (event) => {
      state.counterQuery = event.target.value;
      renderCounterCoverage();
    });
    $$('[data-clear]').forEach((button) => {
      button.addEventListener('click', () => {
        const input = byId(button.dataset.clear);
        if (!input) return;
        input.value = '';
        input.focus();
        if (input.id === 'firstChampion') { state.firstChampion = null; const validation = byId('firstValidation'); if (validation) validation.hidden = true; }
        if (input.id === 'customChampion') { state.customChampion = null; updateCustomPreview(); }
      });
    });
  }

  function init() {
    if (!CONFIG) {
      setDataStatus('error', 'Config assente');
      byId('emptyState').innerHTML = '<div class="pool-empty-monogram">!</div><h3>Configurazione non disponibile</h3><p>Carica <code>pool.config.js</code> prima di <code>pool.js</code>.</p>';
      return;
    }
    if (!DATA || !DATA.matchups || !Array.isArray(DATA.matchupColumns) || !DATA.championProfiles) {
      setDataStatus('error', 'Dataset assente');
      byId('emptyState').innerHTML = '<div class="pool-empty-monogram">!</div><h3>Dataset non disponibile</h3><p>Inserisci <code>matchup_data.js</code> nella stessa cartella e caricalo prima di <code>pool.js</code>.</p>';
      return;
    }
    validateConfiguration();
    renderConfigurationSummary();
    renderRoleChoices();
    renderSizeChoices();
    updateHeroStats();
    const firstController = createCombobox(byId('firstCombo'), 'firstChampion', (champion) => { state.firstChampion = champion; }, false);
    const customController = createCombobox(byId('customCombo'), 'customChampion', (champion) => { state.customChampion = champion; updateCustomPreview(); }, true);
    state.comboControllers = [firstController, customController];
    const defaultRole = roleOrder().find((role) => championsForRole(role).length) || roleOrder()[0];
    if (defaultRole) setRole(defaultRole);
    bindEvents();
    exposeDebugApi();
    setDataStatus('ready', `Dataset printo`);
    updateStartButton();
  }

  init();
})();