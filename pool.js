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
  // FILE MAP
  // 1) utilities and data access
  // 2) individual matchup calculation and coverage aggregation
  // 3) champion strength, style, damage, and reliability
  // 4) score for the next recommended champion
  // 5) final pool evaluation
  // 6) interface rendering and interactions
  //
  // All editable numbers are in pool.config.js. Only formulas remain here.
  // --------------------------------------------------------------------------
  const PROFILE_VECTOR_FIELDS = CONFIG?.profileDiversity?.fields || [];
  const RECOMMENDATION_LIMIT = Math.max(1, Math.round(safeNumber(CONFIG?.recommendation?.limit) ?? 7));
  const MATCHUP_NEUTRAL = CONFIG?.matchup?.neutralWinrate ?? 0.50;
  const POOL_COUNTER_QUANTILE = clamp(CONFIG?.counterTable?.opponentQuantile ?? 0.50, 0, 1);
  const BAN_RECOMMENDATION_QUANTILE = clamp(CONFIG?.banRecommendation?.candidateQuantile ?? 0.50, 0, 1);
  const BAN_RECOMMENDATION_LIMIT = Math.max(1, Math.round(safeNumber(CONFIG?.banRecommendation?.limit) ?? 10));
  const BAN_RECOMMENDATION_MAX_LIMIT = Math.max(BAN_RECOMMENDATION_LIMIT, Math.round(safeNumber(CONFIG?.banRecommendation?.maxLimit) ?? 30));
  const DEFAULT_POOL_COUNTER_CONFIDENCE = Number(CONFIG?.counterTable?.defaultWilsonConfidence ?? 99);
  const POOL_SIZES = Array.from(new Set((CONFIG?.ui?.poolSizes || [2, 3, 4, 5])
    .map((value) => Math.round(safeNumber(value) ?? 0))
    .filter((value) => value >= 1 && value <= 10))).sort((a, b) => a - b);
  const COMBO_OPTION_LIMIT = Math.max(10, Math.round(safeNumber(CONFIG?.ui?.comboOptionLimit) ?? 60));
  const POOL_COUNTER_QUANTILE_LABEL = `Q${Math.round(POOL_COUNTER_QUANTILE * 100)}`;
  const BAN_RECOMMENDATION_QUANTILE_LABEL = `Q${Math.round(BAN_RECOMMENDATION_QUANTILE * 100)}`;
  const WILSON_Z = {
    90: 1.6448536269514722,
    95: 1.959963984540054,
    99: 2.5758293035489004
  };
  const POOL_COUNTER_METRICS = {
    wilson: {
      label: 'Conservative Wilson',
      description: 'Sorts by the Wilson lower bound: rewards win rate but automatically penalizes matchups with few matches.'
    },
    decision: {
      label: 'Pool Builder Index',
      description: 'Uses the same index as the builder: combines win rate, difference from usual performance, and shrinkage toward 50% when the statistical sample is small.'
    },
    winrate: {
      label: 'Win rate matchup',
      description: 'Sorts directly by the pool champion\'s win rate against the specified opponent.'
    },
    diff: {
      label: 'Difference from usual WR',
      description: 'Rewards champions who outperform their overall win rate specifically in this matchup.'
    },
    games: {
      label: 'Number of matches',
      description: 'Shows matchups with the largest statistical sample first.'
    }
  };

  const state = {
    role: null,
    size: POOL_SIZES.includes(3) ? 3 : (POOL_SIZES[0] || 3),
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
    counterConfidence: [90, 95, 99].includes(DEFAULT_POOL_COUNTER_CONFIDENCE) ? DEFAULT_POOL_COUNTER_CONFIDENCE : 99,
    counterQuery: '',
    banScope: 'q50',
    banLimit: BAN_RECOMMENDATION_LIMIT,
    banRows: [],
    quickRole: null,
    quickPool: [],
    quickScope: 'q50',
    quickMetric: 'wilson',
    quickConfidence: [90, 95, 99].includes(DEFAULT_POOL_COUNTER_CONFIDENCE) ? DEFAULT_POOL_COUNTER_CONFIDENCE : 99,
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

  // How likely you are to actually encounter this opponent in the lane, based
  // on how many total matches they have played there (a proxy for pick rate/popularity).
  // A heavily played opponent weighs more in coverage and weaknesses
  // than an extremely rare one, even if the direct matchup against them is
  // statistically solid. This is independent of the reliability of the individual data point
  // (which remains handled by evidenceWeight).
  function opponentLikelihoodWeight(role, opponent) {
    const exponent = Math.max(0, safeNumber(CONFIG?.matchup?.opponentLikelihoodExponent) ?? 0.35);
    if (exponent === 0) return 1;
    const games = Math.max(0.0001, profileGames(role, opponent));
    return games ** exponent;
  }

  function normalizedRecommendationMetric(absoluteScore, percentileScore) {
    const absolute = clamp(absoluteScore, 0, 100);
    if (absolute <= 0) return 0;
    const relativeBlend = clamp(CONFIG?.recommendation?.relativeRankBlend ?? 0.20, 0, 1);
    const centeredRank = (clamp(percentileScore, 0, 100) - 50) / 50;
    return clamp(absolute * (1 + relativeBlend * centeredRank), 0, 100);
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

  // Main format: TOP — Singed / Irelia / Nasus
  // Hyphens, colons, commas, semicolons, and multiple lines are also accepted.
  function parseQuickPoolText(rawText) {
    const text = String(rawText ?? '').trim();
    if (!text) return { role: null, pool: [], unknown: [], error: 'Paste a lane and at least one champion first.' };
    const match = text.match(/^\s*([A-Za-zÀ-ÿ]+)\s*(?:—|–|-|:|\|)\s*([\s\S]+)$/);
    if (!match) {
      return {
        role: null,
        pool: [],
        unknown: [],
        error: 'Unrecognized format. For example, use: TOP — Singed / Irelia / Nasus'
      };
    }

    const role = resolveRoleAlias(match[1]);
    if (!role) {
      return {
        role: null,
        pool: [],
        unknown: [],
        error: `Lane “${match[1].trim()}” not recognized. Use Top, Jungle, Mid, BOT, or Support.`
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
        error: `No champion recognized for lane ${roleLabel(role)}.`
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
  // 2. MATCHUP: INTERPRETATION, SAMPLE ADJUSTMENT, AND AGGREGATION
  // ==========================================================================

  function objectFromColumns(values) {
    if (!values) return null;
    if (!Array.isArray(values) && typeof values === 'object') return { ...values };
    if (!Array.isArray(DATA?.matchupColumns) || !Array.isArray(values)) return null;
    const output = {};
    DATA.matchupColumns.forEach((column, index) => { output[column] = values[index]; });
    return output;
  }

  function firstRawNumber(raw, keys) {
    for (const key of keys) {
      const value = safeNumber(raw?.[key]);
      if (value !== null) return value;
    }
    return null;
  }

  function snowballMetricsFromRaw(raw, side = 'a') {
    if (!raw) return { sensitivity: null, pressure: null, source: null, directionKnown: false };

    const conversion = firstRawNumber(raw, [
      `snowball_conversion_15m_${side}`,
      `${side}_snowball_conversion_15m`
    ]);
    if (conversion !== null) {
      return {
        sensitivity: Math.abs(conversion),
        pressure: Math.max(0, conversion),
        source: 'conversion',
        directionKnown: true
      };
    }

    const ahead = firstRawNumber(raw, [
      `winrate_${side}_when_${side}_ahead_15m`,
      `winrate_${side}_when_ahead_15m`,
      `${side}_winrate_when_ahead_15m`
    ]);
    const behind = firstRawNumber(raw, [
      `winrate_${side}_when_${side}_behind_15m`,
      `winrate_${side}_when_behind_15m`,
      `${side}_winrate_when_behind_15m`
    ]);
    if (ahead !== null && behind !== null) {
      const swing = ahead - behind;
      return {
        sensitivity: Math.abs(swing),
        pressure: Math.max(0, swing),
        source: 'winrate-swing',
        directionKnown: true
      };
    }

    const correlation = firstRawNumber(raw, [
      `snowball_corr_15m_${side}`,
      `${side}_snowball_corr_15m`,
      'snowball_corr_15m'
    ]);
    if (correlation !== null) {
      const fallback = Math.min(0.35, Math.abs(correlation) * 0.30);
      return {
        sensitivity: fallback,
        pressure: fallback,
        source: 'correlation-fallback',
        directionKnown: false
      };
    }
    return { sensitivity: null, pressure: null, source: null, directionKnown: false };
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

    // The decisionScore is the value used EVERYWHERE to compare two answers:
    // selecting the best champion, explanations, and pool aggregates.
    // This prevents a tiny sample from generating a false explanation.
    const shrinkageGames = Math.max(0, safeNumber(CONFIG?.matchup?.shrinkageGames) ?? 20);
    const reliability = shrinkageGames === 0 ? 1 : games / (games + shrinkageGames);
    const decisionScore = MATCHUP_NEUTRAL + (matchupScore - MATCHUP_NEUTRAL) * reliability;
    const snowball = snowballMetricsFromRaw(raw, side);

    return {
      champion, opponent, orientation, winrate, generalWinrate, diff, games,
      matchupScore, decisionScore, reliability,
      snowballSensitivity: snowball.sensitivity,
      snowballPressure: snowball.pressure,
      snowballDirectionKnown: snowball.directionKnown,
      snowballSource: snowball.source
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

  // Public function: accepts a pool in the same format as state.selected.
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


  function percentileRank(value, values) {
    const number = safeNumber(value);
    const sorted = values.map(safeNumber).filter((item) => item !== null).sort((a, b) => a - b);
    if (number === null || !sorted.length) return 0;
    if (sorted.length === 1) return 100;
    let below = 0;
    let equal = 0;
    sorted.forEach((item) => {
      if (item < number) below += 1;
      else if (item === number) equal += 1;
    });
    return clamp(((below + Math.max(0, equal - 1) / 2) / (sorted.length - 1)) * 100, 0, 100);
  }

  function banMatchupThreat(matchup) {
    if (!matchup) return null;
    const relativePerformance = matchup.diff === null
      ? MATCHUP_NEUTRAL
      : clamp(MATCHUP_NEUTRAL + matchup.diff, 0, 1);
    const rawThreat = weightedScore(
      { directWinrate: matchup.winrate, relativeToGeneral: relativePerformance },
      CONFIG?.banRecommendation?.matchupWeights || { directWinrate: 65, relativeToGeneral: 35 }
    );
    const shrinkageGames = Math.max(0, safeNumber(CONFIG?.banRecommendation?.shrinkageGames) ?? 40);
    const reliability = shrinkageGames === 0 ? 1 : matchup.games / (matchup.games + shrinkageGames);
    return MATCHUP_NEUTRAL + (rawThreat - MATCHUP_NEUTRAL) * reliability;
  }

  function buildBanRecommendations(pool = state.selected, options = {}) {
    const role = options.role || state.role;
    const normalizedPool = normalizePoolForRole(pool, role);
    const scope = options.scope === 'all' ? 'all' : 'q50';
    const requestedLimit = Math.round(safeNumber(options.limit) ?? BAN_RECOMMENDATION_LIMIT);
    const limit = Math.max(1, Math.min(BAN_RECOMMENDATION_MAX_LIMIT, requestedLimit));
    if (!role || !normalizedPool.length) {
      return { role, pool: normalizedPool, scope, limit, q50Threshold: 0, q50Count: 0, allCount: 0, rows: [] };
    }

    const q50 = calculateRoleQuantileSet(role, BAN_RECOMMENDATION_QUANTILE);
    const source = scope === 'all' ? q50.all : q50.eligible;
    const candidates = source.filter((candidate) => !normalizedPool.includes(candidate));
    const allPopularityValues = q50.all.map((candidate) => profileGames(role, candidate));
    const maxGames = Math.max(1, ...allPopularityValues);
    const banConfig = CONFIG?.banRecommendation || {};
    const neutralThreat = safeNumber(banConfig.neutralThreat) ?? 0.50;
    const fullThreatAt = Math.max(neutralThreat + 0.001, safeNumber(banConfig.fullThreatAt) ?? 0.60);
    const unknownThreatPrior = clamp(safeNumber(banConfig.unknownThreatPrior) ?? neutralThreat, 0, 1);
    const fullSnowballAt = Math.max(0.01, safeNumber(banConfig.fullSnowballAt) ?? 0.25);
    const safeAnswerThreatMax = clamp(safeNumber(banConfig.safeAnswerThreatMax) ?? 0.525, 0, 1);
    const popularityGateFloor = clamp(safeNumber(banConfig.popularityThreatGateFloor) ?? 0.20, 0, 1);
    const snowballGateFloor = clamp(safeNumber(banConfig.snowballThreatGateFloor) ?? 0.30, 0, 1);

    const rows = candidates.map((candidate) => {
      const matchupRows = normalizedPool.map((playerChampion) => {
        const matchup = getMatchup(role, candidate, playerChampion);
        if (!matchup) {
          return {
            candidate,
            playerChampion,
            hasData: false,
            threat: unknownThreatPrior,
            winrate: null,
            diff: null,
            games: null,
            reliability: 0,
            snowballSensitivity: null,
            snowballPressure: null
          };
        }
        return {
          ...matchup,
          candidate,
          playerChampion,
          hasData: true,
          threat: banMatchupThreat(matchup)
        };
      });

      const knownRows = matchupRows.filter((row) => row.hasData && safeNumber(row.threat) !== null);
      if (!knownRows.length) return null;

      const threatValues = matchupRows.map((row) => safeNumber(row.threat) ?? unknownThreatPrior);
      // Unknown rows may influence the aggregate through the configured prior,
      // but they can never masquerade as the pool's best known answer.
      const bestAnswerThreat = Math.min(...knownRows.map((row) => row.threat));
      const averagePressure = threatValues.reduce((sum, value) => sum + value, 0) / threatValues.length;
      const worstExposure = Math.max(...threatValues);
      const poolThreatWeights = banConfig.poolThreatWeights || { bestAnswerThreat: 50, averagePressure: 15, worstExposure: 35 };
      const aggregateThreat = weightedScore(
        { bestAnswerThreat, averagePressure, worstExposure },
        {
          bestAnswerThreat: poolThreatWeights.bestAnswerThreat ?? poolThreatWeights.noSafeAnswer,
          averagePressure: poolThreatWeights.averagePressure,
          worstExposure: poolThreatWeights.worstExposure
        }
      );
      const matchupThreat = clamp((aggregateThreat - neutralThreat) / (fullThreatAt - neutralThreat) * 100, 0, 100);
      const threatGate = matchupThreat / 100;

      const candidateGames = profileGames(role, candidate);
      const popularityPercentile = percentileRank(candidateGames, allPopularityValues);
      const popularityLogarithmic = clamp(Math.log1p(candidateGames) / Math.log1p(maxGames) * 100, 0, 100);
      const rawPopularity = weightedScore(
        { percentile: popularityPercentile, logarithmic: popularityLogarithmic },
        banConfig.popularityWeights || { percentile: 50, logarithmic: 50 }
      );
      const popularity = rawPopularity * (popularityGateFloor + (1 - popularityGateFloor) * threatGate);

      const snowballRows = knownRows.filter((row) => safeNumber(row.snowballPressure) !== null);
      const pressureWeightedAverage = weightedAverage(
        snowballRows,
        (row) => row.snowballPressure,
        (row) => 1 + clamp((row.threat - MATCHUP_NEUTRAL) / 0.10, 0, 1) * 2
      );
      const worstSnowball = snowballRows.length
        ? Math.max(...snowballRows.map((row) => row.snowballPressure))
        : null;
      const aggregateSnowball = pressureWeightedAverage === null && worstSnowball === null
        ? null
        : weightedScore(
          { pressureWeightedAverage, worstCase: worstSnowball },
          banConfig.snowballWeights || { pressureWeightedAverage: 70, worstCase: 30 }
        );
      const rawSnowball = aggregateSnowball === null ? 0 : clamp(aggregateSnowball / fullSnowballAt * 100, 0, 100);
      const snowball = rawSnowball * (snowballGateFloor + (1 - snowballGateFloor) * threatGate);

      const score = weightedScore(
        { matchupThreat, popularity, snowball },
        banConfig.weights || { matchupThreat: 72, popularity: 18, snowball: 10 }
      );
      const bestResponse = knownRows.slice().sort((a, b) => a.threat - b.threat || b.games - a.games || localeSort(a.playerChampion, b.playerChampion))[0] || null;
      const worstMatchup = knownRows.slice().sort((a, b) => b.threat - a.threat || b.games - a.games || localeSort(a.playerChampion, b.playerChampion))[0] || null;
      const safeResponses = knownRows.filter((row) => row.threat <= safeAnswerThreatMax);
      const hasSafeAnswer = safeResponses.length > 0;

      return {
        candidate,
        candidateGames,
        matchupRows,
        knownCount: knownRows.length,
        totalCount: normalizedPool.length,
        knownRatio: knownRows.length / normalizedPool.length,
        bestAnswerThreat,
        noSafeAnswer: bestAnswerThreat,
        averagePressure,
        worstExposure,
        aggregateThreat,
        matchupThreat,
        popularity,
        rawPopularity,
        popularityPercentile,
        popularityLogarithmic,
        aggregateSnowball,
        snowball,
        rawSnowball,
        score,
        averageEnemyWinrate: average(knownRows, (row) => row.winrate),
        averageEnemyDiff: average(knownRows, (row) => row.diff),
        totalDirectGames: knownRows.reduce((sum, row) => sum + (safeNumber(row.games) ?? 0), 0),
        safeAnswerThreatMax,
        safeResponses,
        hasSafeAnswer,
        bestResponse,
        worstMatchup
      };
    }).filter(Boolean);

    rows.sort((a, b) => b.score - a.score
      || b.matchupThreat - a.matchupThreat
      || b.worstExposure - a.worstExposure
      || b.popularity - a.popularity
      || b.snowball - a.snowball
      || b.aggregateThreat - a.aggregateThreat
      || b.candidateGames - a.candidateGames
      || localeSort(a.candidate, b.candidate));

    return {
      role,
      pool: normalizedPool,
      scope,
      limit,
      q50Threshold: q50.threshold,
      q50Count: q50.eligible.length,
      allCount: q50.all.length,
      rows: rows.slice(0, limit),
      allRows: rows
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

  function relevantOpponents() {
    return state.opponents.slice();
  }

  function bestPoolAnswers(pool) {
    const map = new Map();
    relevantOpponents().forEach((opponent) => {
      const rows = pool
        .filter((champion) => champion !== opponent)
        .map((champion) => getMatchup(state.role, champion, opponent))
        .filter((row) => row && row.decisionScore !== null);
      rows.sort((a, b) => b.decisionScore - a.decisionScore || b.games - a.games || localeSort(a.champion, b.champion));
      map.set(opponent, rows[0] || null);
    });
    return map;
  }

  function weaknessControlFromScore(score) {
    const floor = clamp(CONFIG?.matchup?.weaknessScoreFloor ?? 0.40, 0, 1);
    const fullAt = clamp(CONFIG?.matchup?.weaknessScoreFullAt ?? 0.52, floor + 0.001, 1);
    return clamp((score - floor) / (fullAt - floor), 0, 1);
  }

  function conservativeCompletenessAdjustment(observed, prior, completeness) {
    const value = safeNumber(observed);
    if (value === null) return prior;
    if (value <= prior) return value;
    const exponent = Math.max(0.01, safeNumber(CONFIG?.matchup?.completenessShrinkExponent) ?? 1);
    const retainedSignal = clamp(completeness, 0, 1) ** exponent;
    return prior + (value - prior) * retainedSignal;
  }

  function evaluateMatchupCore(pool) {
    const opponents = relevantOpponents();
    const answers = bestPoolAnswers(pool);
    const known = [];
    opponents.forEach((opponent) => {
      const answer = answers.get(opponent);
      if (!answer || answer.decisionScore === null || answer.games <= 0) return;
      known.push({
        opponent,
        champion: answer.champion,
        score: answer.decisionScore,
        rawScore: answer.matchupScore,
        games: answer.games,
        evidenceWeight: evidenceWeight(answer.games) * opponentLikelihoodWeight(state.role, opponent),
        weaknessControl: weaknessControlFromScore(answer.decisionScore)
      });
    });

    const evidenceWeightedCoverage = weightedAverage(known, (row) => row.score, (row) => row.evidenceWeight);
    const opponentBalancedCoverage = average(known, (row) => row.score);
    const worstTailCoverage = tailAverage(known, (row) => row.score, CONFIG?.matchup?.worstTailShare ?? 0.15);
    const observedCoverage = known.length
      ? weightedScore({ evidenceWeighted: evidenceWeightedCoverage, opponentBalanced: opponentBalancedCoverage, worstTail: worstTailCoverage },
        CONFIG?.matchup?.coverageBlendWeights || { evidenceWeighted: 45, opponentBalanced: 35, worstTail: 20 })
      : null;

    const evidenceWeightedWeakness = weightedAverage(known, (row) => row.weaknessControl, (row) => row.evidenceWeight);
    const worstTailWeakness = tailAverage(known, (row) => row.weaknessControl, CONFIG?.matchup?.worstTailShare ?? 0.15);
    const observedWeaknessControl = known.length
      ? weightedScore({ evidenceWeighted: evidenceWeightedWeakness, worstTail: worstTailWeakness },
        CONFIG?.matchup?.weaknessBlendWeights || { evidenceWeighted: 25, worstTail: 75 })
      : null;

    const totalMatchupGames = known.reduce((sum, row) => sum + row.games, 0);
    const completeness = opponents.length ? known.length / opponents.length : 1;
    const unknownMatchupScore = clamp(CONFIG?.matchup?.unknownMatchupScore ?? 0.48, 0, 1);
    const coveragePrior = unknownMatchupScore;
    const weaknessPrior = weaknessControlFromScore(unknownMatchupScore);
    const matchupCoverage = conservativeCompletenessAdjustment(observedCoverage, coveragePrior, completeness);
    const weaknessControl = conservativeCompletenessAdjustment(observedWeaknessControl, weaknessPrior, completeness);

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
        completeness,
        coveragePrior,
        weaknessPrior,
        observedCoverage,
        observedWeaknessControl,
        evidenceWeightedCoverage,
        opponentBalancedCoverage,
        worstTailCoverage,
        evidenceWeightedWeakness,
        worstTailWeakness
      }
    };
  }

  // ==========================================================================
  // 3. CHAMPION METRICS: STYLE, DAMAGE, STRENGTH, AND RELIABILITY
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

  function profileVectorCompleteness(champion) {
    const vector = profileVector(champion);
    if (!vector || !PROFILE_VECTOR_FIELDS.length) return 0;
    const known = PROFILE_VECTOR_FIELDS.filter((field) => safeNumber(vector[field]) !== null).length;
    return known / PROFILE_VECTOR_FIELDS.length;
  }

  function vectorDistance(championA, championB) {
    const a = profileVector(championA);
    const b = profileVector(championB);
    if (!a || !b || !PROFILE_VECTOR_FIELDS.length) return null;
    const squares = [];
    PROFILE_VECTOR_FIELDS.forEach((field) => {
      const x = safeNumber(a[field]);
      const y = safeNumber(b[field]);
      if (x === null || y === null) return;
      squares.push(((x - y) / 100) ** 2);
    });
    const minimumFields = Math.max(1, Math.round(safeNumber(CONFIG?.profileDiversity?.minimumComparableFields) ?? 3));
    if (squares.length < Math.min(minimumFields, PROFILE_VECTOR_FIELDS.length)) return null;
    const rawDistance = Math.sqrt(squares.reduce((sum, value) => sum + value, 0) / squares.length);
    const comparableRatio = squares.length / PROFILE_VECTOR_FIELDS.length;
    const missingPrior = clamp(CONFIG?.profileDiversity?.missingDistancePrior ?? 0.18, 0, 1);
    return clamp(rawDistance * comparableRatio + missingPrior * (1 - comparableRatio), 0, 1);
  }

  function candidateProfileDiversity(candidate, pool) {
    const missingPrior = clamp(CONFIG?.profileDiversity?.missingDistancePrior ?? 0.18, 0, 1);
    if (!pool.length) return 0.5;
    const distances = pool.map((champion) => vectorDistance(candidate, champion)).filter((value) => value !== null);
    return distances.length ? Math.min(...distances) : missingPrior;
  }

  function poolProfileDiversity(pool) {
    const unknownScore = clamp(CONFIG?.profileDiversity?.unknownPoolScore ?? 20, 0, 100);
    if (pool.length < 2) return 50;
    const distances = [];
    for (let i = 0; i < pool.length; i += 1) {
      for (let j = i + 1; j < pool.length; j += 1) {
        const distance = vectorDistance(pool[i], pool[j]);
        if (distance !== null) distances.push(distance);
      }
    }
    return distances.length
      ? clamp((distances.reduce((sum, value) => sum + value, 0) / distances.length) * 100, 0, 100)
      : unknownScore;
  }

  function damageProfile(champion) {
    const profile = profilesForRole()?.[champion] || {};
    const rawPhysical = safeNumber(profile.pct_physical_dmg);
    const rawMagic = safeNumber(profile.pct_magic_dmg);
    const rawTrueDamage = safeNumber(profile.pct_true_dmg);
    const knownValues = [rawPhysical, rawMagic, rawTrueDamage].filter((value) => value !== null);
    const positiveTotal = knownValues.reduce((sum, value) => sum + Math.max(0, value), 0);
    if (!knownValues.length || positiveTotal <= 0) {
      return { physical: null, magic: null, trueDamage: null, type: 'unknown', trueRelevant: false, known: false };
    }

    const physicalShare = Math.max(0, rawPhysical ?? 0) / positiveTotal;
    const magicShare = Math.max(0, rawMagic ?? 0) / positiveTotal;
    const trueShare = Math.max(0, rawTrueDamage ?? 0) / positiveTotal;
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
    if (type === 'physical') return 'physical';
    if (type === 'magic') return 'magic';
    if (type === 'unknown') return 'data unavailable';
    return 'hybrid';
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
    if (types.has('physical') && types.has('magic')) {
      knownScore = profiles.some((profile) => profile.trueRelevant)
        ? (scores.physicalMagicAndTrue ?? scores.physicalAndMagic ?? 100)
        : (scores.physicalAndMagic ?? 100);
    }
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
    if (!pool.length) return { tone: '', html: 'Add the first champion to analyze damage.' };
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
      text = '<strong>Damage data unavailable.</strong> Variety is not estimated artificially and receives a score of 0.';
    } else if (physical.length && magic.length) {
      tone = 'ok';
      text = '<strong>Well-diversified damage.</strong> The pool contains at least one clear physical option and one clear magic option.';
    } else if (physical.length && !magic.length) {
      text = '<strong>No true magic-damage option.</strong> The pool is predominantly physical and may make it easier for opponents to adapt their defenses.';
    } else if (magic.length && !physical.length) {
      text = '<strong>No true physical-damage option.</strong> The pool is predominantly magic and may make it easier for opponents to adapt their defenses.';
    } else {
      text = '<strong>Primarily hybrid pool.</strong> It offers partial flexibility, but is not always equivalent to having both a physical specialist and a magic specialist.';
    }
    if (hybrid.length) text += ` ${hybrid.length} ${hybrid.length === 1 ? 'champion has' : 'champions have'} a hybrid profile.`;
    if (trueDamage.length) text += ` Significant true damage: ${trueDamage.map((profile) => esc(profile.champion)).join(', ')}.`;
    if (unknown.length) text += ` Missing data: ${unknown.map((profile) => esc(profile.champion)).join(', ')}; the score is penalized.`;
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
    const relativeCoverage = state.rigorousThreshold > 0
      ? clamp(games / state.rigorousThreshold, 0, 1)
      : (games > 0 ? 1 : 0);
    const absoluteTarget = Math.max(1, safeNumber(CONFIG?.confidence?.profileSampleTarget) ?? 500);
    const absoluteCoverage = clamp(games / absoluteTarget, 0, 1);
    const profileCoverage = Math.sqrt(relativeCoverage * absoluteCoverage);
    const profileCompleteness = profileVectorCompleteness(champion);

    const opponents = relevantOpponents().filter((opponent) => opponent !== champion);
    const directRows = opponents.map((opponent) => getMatchup(state.role, champion, opponent)).filter(Boolean);
    const knownCoverage = opponents.length ? directRows.length / opponents.length : 1;
    const target = Math.max(1, safeNumber(CONFIG?.confidence?.matchupSampleTarget) ?? 30);
    const matchupSample = directRows.length
      ? directRows.reduce((sum, row) => sum + clamp(row.games / target, 0, 1), 0) / directRows.length
      : 0;
    return weightedScore({
      profileGames: profileCoverage,
      profileCompleteness,
      knownOpponents: knownCoverage,
      matchupSamples: matchupSample
    }, CONFIG?.confidence?.championWeights || {
      profileGames: 30, profileCompleteness: 15, knownOpponents: 35, matchupSamples: 20
    }) * 100;
  }

  // ==========================================================================
  // 4. NEXT-CHAMPION RECOMMENDATION
  // ==========================================================================

  function candidateRawMetrics(candidate, pool, currentCore, currentEvaluation = null) {
    const afterPool = [...pool, candidate];
    const afterCore = evaluateMatchupCore(afterPool);
    const comparisonOpponents = relevantOpponents();
    let improvedCount = 0;
    let fixedCount = 0;
    let newCoverageCount = 0;
    let knownCount = 0;
    const minDelta = CONFIG?.matchup?.improvementMinDelta ?? 0.005;
    const weakBelow = CONFIG?.matchup?.weakBelow ?? 0.48;
    const fixedAbove = CONFIG?.matchup?.fixedAbove ?? 0.52;

    comparisonOpponents.forEach((opponent) => {
      const directCandidate = opponent === candidate ? null : getMatchup(state.role, candidate, opponent);
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
    }, CONFIG?.recommendation?.matchupComplementWeights || { coverageGain: 55, weaknessGain: 45 });

    const beforeDamage = poolDamageVariety(pool);
    const afterDamage = poolDamageVariety(afterPool);
    const fullDamageGainAt = Math.max(1, safeNumber(CONFIG?.recommendation?.fullDamageGainAt) ?? 60);
    const damageImprovement = clamp((afterDamage - beforeDamage) / fullDamageGainAt, 0, 1);

    const beforeEvaluation = currentEvaluation || evaluatePool(pool);
    const afterEvaluation = evaluatePool(afterPool);
    const projectedPoolDelta = (afterEvaluation?.finalScore ?? 0) - (beforeEvaluation?.finalScore ?? 0);

    return {
      candidate,
      projectedPoolGain: Math.max(0, projectedPoolDelta) / 100,
      projectedPoolDelta,
      projectedFinalScore: afterEvaluation?.finalScore ?? null,
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
      relevantOpponentCount: comparisonOpponents.filter((opponent) => opponent !== candidate).length,
      afterDamage,
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
    const currentEvaluation = evaluatePool(pool);
    const allRemaining = championsForRole().filter((champion) => !pool.includes(champion));
    const candidateMode = CONFIG?.dataSelection?.recommendationCandidates || 'rigorous-first';
    let recommendationPool = candidateMode === 'all'
      ? allRemaining
      : allRemaining.filter((champion) => state.rigorousChampions.includes(champion));
    if (recommendationPool.length < RECOMMENDATION_LIMIT) {
      const supplements = allRemaining.filter((champion) => !recommendationPool.includes(champion));
      recommendationPool = [...recommendationPool, ...supplements];
    }

    const rows = recommendationPool.map((candidate) => candidateRawMetrics(candidate, pool, currentCore, currentEvaluation));
    ['projectedPoolGain', 'matchupComplement', 'strength', 'damageImprovement', 'profileDiversity', 'confidence'].forEach((key) => percentileRanks(rows, key));
    rows.forEach(applyRecommendationScore);
    rows.sort((a, b) => b.score - a.score
      || b.projectedPoolDelta - a.projectedPoolDelta
      || b.matchupComplement - a.matchupComplement
      || b.strength - a.strength
      || profileGames(state.role, b.candidate) - profileGames(state.role, a.candidate)
      || localeSort(a.candidate, b.candidate));
    return rows;
  }

  function applyRecommendationScore(row) {
    const fullMatchupGainAt = Math.max(0.0001, safeNumber(CONFIG?.recommendation?.fullMatchupGainAt) ?? 0.035);
    const fullPoolScoreGainAt = Math.max(0.1, safeNumber(CONFIG?.recommendation?.fullPoolScoreGainAt) ?? 10);
    const absolute = {
      projectedPoolGain: clamp(Math.max(0, row.projectedPoolDelta) / fullPoolScoreGainAt, 0, 1) * 100,
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
      projectedPoolGain: 48, matchupComplement: 34, strength: 4,
      damageImprovement: 4, profileDiversity: 5, confidence: 5
    });
    return row;
  }

  // ==========================================================================
  // 5. FINAL POOL EVALUATION
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
    const rawFinalScore = weightedScore(parts, CONFIG?.poolEvaluation?.weights || {
      matchupCoverage: 42, weaknessControl: 28, averageChampionStrength: 8,
      damageVariety: 8, profileDiversity: 5, dataConfidence: 9
    });
    const confidenceFloor = clamp(CONFIG?.poolEvaluation?.confidenceMultiplierFloor ?? 0.88, 0, 1);
    const confidenceMultiplier = confidenceFloor + (1 - confidenceFloor) * clamp(dataConfidence / 100, 0, 1);
    const finalScore = clamp(rawFinalScore * confidenceMultiplier, 0, 100);
    return {
      ...parts,
      rawFinalScore,
      confidenceMultiplier,
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
    return sorted.find((entry) => score >= (safeNumber(entry.min) ?? 0))?.text || 'Pool to evaluate';
  }

  function toneForScore(score) {
    if (score >= 75) return 'tone-good';
    if (score >= 45) return 'tone-mid';
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
    if (Math.abs(row.projectedPoolDelta) >= 0.05) {
      reasons.push({
        type: row.projectedPoolDelta > 0 ? 'plus' : 'minus',
        text: `Projected final pool score: ${row.projectedPoolDelta > 0 ? '+' : ''}${row.projectedPoolDelta.toFixed(1)} points.`
      });
    }
    if (row.fixedCount > 0) reasons.push({ type: 'plus', text: `Resolves ${row.fixedCount} ${row.fixedCount === 1 ? 'weakness' : 'weaknesses'} with sufficient statistical evidence.` });
    if (row.improvedCount > 0) reasons.push({ type: 'plus', text: `Becomes the best answer against ${row.improvedCount} relevant opponents.` });
    if (row.newCoverageCount > 0) reasons.push({ type: 'plus', text: `Adds a known answer against ${row.newCoverageCount} ${row.newCoverageCount === 1 ? 'previously uncovered opponent' : 'previously uncovered opponents'}.` });
    const damage = damageProfile(row.candidate);
    const currentTypes = new Set(state.selected.map((champion) => damageProfile(champion).type));
    if (damage.type === 'magic' && !currentTypes.has('magic')) reasons.push({ type: 'plus', text: 'Adds a clear magic-damage option.' });
    else if (damage.type === 'physical' && !currentTypes.has('physical')) reasons.push({ type: 'plus', text: 'Adds a clear physical-damage option.' });
    else if (damage.type === 'hybrid') reasons.push({ type: 'info', text: 'Adds a hybrid damage profile.' });
    else if (damage.type === 'unknown') reasons.push({ type: 'minus', text: 'Damage profile unavailable in the dataset.' });
    const diversityHigh = CONFIG?.recommendation?.diversityHigh ?? 0.35;
    const diversityLow = CONFIG?.recommendation?.diversityLow ?? 0.16;
    if (row.profileDiversity >= diversityHigh) reasons.push({ type: 'plus', text: 'Profile has little overlap with the champions already selected.' });
    else if (row.profileDiversity < diversityLow) reasons.push({ type: 'minus', text: 'Profile is similar to a choice already present or is insufficiently documented.' });
    if (row.belowRigorous) reasons.push({ type: 'minus', text: 'Statistical coverage below the Rigorous threshold.' });
    else reasons.push({ type: 'info', text: `Rigorous coverage: ${integer(profileGames(state.role, row.candidate))} matches in the role.` });
    const warningRatio = CONFIG?.recommendation?.knownOpponentWarningRatio ?? 0.65;
    if (row.knownCount < Math.ceil(row.relevantOpponentCount * warningRatio)) reasons.push({ type: 'minus', text: 'Several direct matchups are unavailable: the projection is conservatively penalized.' });
    return reasons.slice(0, 5);
  }

  // ==========================================================================
  // 6. INTERFACE AND INTERACTIONS
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
    byId('sizeGrid').innerHTML = POOL_SIZES.map((size) => `<button class="choice${state.size === size ? ' selected' : ''}" type="button" data-size="${size}" aria-pressed="${state.size === size ? 'true' : 'false'}">${size}</button>`).join('');
  }

  function renderThreshold() {
    const box = byId('thresholdBox');
    if (!state.role) {
      box.textContent = 'Select a lane to calculate the threshold.';
      return;
    }
    const allCount = championsForRole().length;
    const coverage = allCount ? state.rigorousChampions.length / allCount : 0;
    const scope = CONFIG?.dataSelection?.evaluationOpponents === 'rigorous'
      ? 'The evaluation covers only this statistically robust group.'
      : 'The evaluation covers the entire lane; the Rigorous group is used mainly for recommendations.';
    box.innerHTML = `<strong>Rigorous Filter:</strong> at least ${integer(state.rigorousThreshold)} matches in the role. The filter is passed by ${state.rigorousChampions.length}/${allCount} champions (${pct(coverage, 0)}). ${esc(scope)}`;
  }

  function updateStartButton() {
    byId('startBtn').disabled = !state.role || !state.size || !championsForRole().length;
  }

  function setRole(role) {
    state.role = role;
    const rigorous = calculateRigorousSet(role);
    state.rigorousThreshold = rigorous.threshold;
    state.rigorousChampions = rigorous.eligible;
    state.opponents = CONFIG?.dataSelection?.evaluationOpponents === 'rigorous'
      ? rigorous.eligible.slice()
      : rigorous.all.slice();
    state.firstChampion = null;
    byId('firstChampion').value = '';
    byId('firstChampion').setAttribute('aria-invalid', 'false');
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
      filtered = options.filter((option) => option.label.toLocaleLowerCase('it').includes(term)).slice(0, COMBO_OPTION_LIMIT);
      activeIndex = Math.min(activeIndex, filtered.length - 1);
      list.innerHTML = filtered.length ? filtered.map((option, index) => `
        <div id="${inputId}-option-${index}" class="combo-option${option.low ? ' low' : ''}${index === activeIndex ? ' active' : ''}" role="option" aria-selected="${index === activeIndex ? 'true' : 'false'}" data-value="${esc(option.value)}">
          <strong>${champHtml(option.label, 'sm')}</strong><small>${esc(option.meta || '')}</small>
        </div>`).join('') : '<div class="combo-empty">No champion found.</div>';
      setExpanded(document.activeElement === input);
      if (activeIndex >= 0 && filtered[activeIndex]) input.setAttribute('aria-activedescendant', `${inputId}-option-${activeIndex}`);
      else input.removeAttribute('aria-activedescendant');
    }

    function commit(option) {
      if (!option) return;
      input.value = option.label;
      setExpanded(false);
      activeIndex = -1;
      input.setAttribute('aria-invalid', 'false');
      onSelect(option.value);
    }

    input.addEventListener('focus', () => {
      if (excludeSelected) setOptions(championOptions(true));
      render(input.value);
      setExpanded(true);
    });
    input.addEventListener('input', () => {
      onSelect(null, true);
      if (inputId === 'firstChampion') { const validation = byId('firstValidation'); if (validation) validation.hidden = true; input.setAttribute('aria-invalid', 'false'); }
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
    byId('poolTitle').textContent = `${roleLabel(state.role)} · ${state.selected.length}/${state.size} champions`;
    byId('poolSubtitle').textContent = state.selected.length < state.size ? 'Add the next pick to complete the pool.' : 'Pool complete: final evaluation available.';
    byId('slots').innerHTML = Array.from({ length: state.size }, (_, index) => {
      const champion = state.selected[index];
      if (!champion) return `<div class="slot"><div class="slot-index">Pick ${index + 1}</div><div class="slot-name" style="color:var(--ink-faint)">Empty</div></div>`;
      const profile = profilesForRole()?.[champion] || {};
      const damage = damageProfile(champion);
      const canRemove = state.selected.length > 1;
      return `<div class="slot filled"><div class="slot-index">Pick ${index + 1}</div><div class="slot-name">${champHtml(champion, 'md')}</div><div class="slot-meta">WR ${pct(profile.general_winrate)} · ${esc(damageTypeLabel(damage.type))}</div>${canRemove ? `<button class="slot-remove" type="button" data-remove-index="${index}">Remove</button>` : ''}</div>`;
    }).join('');

    const scoreItems = [
      ['Current evaluation', evaluation?.finalScore, `Reliability-adjusted score; raw weighted score ${scoreFmt(evaluation?.rawFinalScore)}.`],
      ['Matchup coverage', evaluation?.matchupCoverage, `Fixed opponent universe; optimistic values are pulled toward the configured prior when matchup coverage is incomplete.`],
      ['Weakness control', evaluation?.weaknessControl, `Calibrated from ${pct(CONFIG?.matchup?.weaknessScoreFloor ?? 0.40, 0)} to ${pct(CONFIG?.matchup?.weaknessScoreFullAt ?? 0.52, 0)}, with the worst tail dominant.`],
      ['Overall strength', evaluation?.averageChampionStrength, 'Individual strength of the champions.'],
      ['Damage variety', evaluation?.damageVariety, 'Physical, magic, and hybrid options; missing data penalizes the value.'],
      ['Reliability', evaluation?.dataConfidence, `${evaluation?.knownMatchups ?? 0}/${evaluation?.totalOpponents ?? 0} opponents with a known answer.`]
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
    byId('recoCount').textContent = `Choice ${state.selected.length + 1} of ${state.size}`;
    byId('recommendations').innerHTML = top.length ? top.map((row, index) => {
      const reasons = recommendationReasons(row);
      return `<article class="reco"><div class="reco-rank">${index + 1}</div><div><h3>${champHtml(row.candidate, 'md')}</h3><div class="reco-sub">WR ${pct(profilesForRole()?.[row.candidate]?.general_winrate)} · ${integer(profileGames(state.role, row.candidate))} matches · projected ${row.projectedPoolDelta >= 0 ? '+' : ''}${row.projectedPoolDelta.toFixed(1)}</div></div><div class="reco-score ${toneForScore(row.score)}">${scoreFmt(row.score)}<div class="reco-sub">index /100</div></div><div class="reco-reasons">${reasons.map((reason) => `<div class="reason ${reason.type}">${esc(reason.text)}</div>`).join('')}</div><button type="button" data-add-champion="${esc(row.candidate)}">Add</button></article>`;
    }).join('') : '<div class="notice warn">No other champions are available for this lane.</div>';
    panel.hidden = false;
    customPanel.hidden = false;
    state.comboControllers.forEach((controller) => controller.setOptions(championOptions(true)));
    updateCustomPreview();
  }

  function customCandidateRow(champion) {
    if (!champion || state.selected.includes(champion)) return null;
    const currentCore = evaluateMatchupCore(state.selected);
    const currentEvaluation = evaluatePool(state.selected);
    const rows = buildCandidateRows(state.selected);
    const found = rows.find((row) => row.candidate === champion);
    if (found) return found;
    const raw = candidateRawMetrics(champion, state.selected, currentCore, currentEvaluation);
    const comparison = [...rows, raw];
    ['projectedPoolGain', 'matchupComplement', 'strength', 'damageImprovement', 'profileDiversity', 'confidence'].forEach((key) => percentileRanks(comparison, key));
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
    const warning = row.belowRigorous ? ' Personal choice below the Rigorous threshold: less reliable evaluation.' : '';
    const damage = damageProfile(row.candidate);
    preview.innerHTML = `<div class="preview-card"><div><h3>${champHtml(row.candidate, 'md')}</h3><p>Addition Index ${scoreFmt(row.score)}/100 · projected final-score change ${row.projectedPoolDelta >= 0 ? '+' : ''}${row.projectedPoolDelta.toFixed(1)}. Becomes the best answer in ${row.improvedCount} matchups, resolves ${row.fixedCount} of them, and adds ${row.newCoverageCount} previously missing answers.${esc(warning)} Damage profile: ${esc(damageTypeLabel(damage.type))}.</p></div><div class="preview-score ${toneForScore(row.score)}">${scoreFmt(row.score)}</div></div>`;
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
      return `<td><div class="quick-table-counter unavailable"><span>#${rank}</span><strong>${champHtml(answer.champion, 'xs')}</strong><em>N/D</em><small>Matchup missing</small></div></td>`;
    }
    const deepLink = `./visual.html?role=${encodeURIComponent(state.quickRole)}&a=${encodeURIComponent(answer.champion)}&b=${encodeURIComponent(target)}`;
    return `<td><a class="quick-table-counter" href="${esc(deepLink)}" title="Open ${esc(answer.champion)} against ${esc(target)}"><span>#${rank}</span><strong>${champHtml(answer.champion, 'xs')}</strong><em>${esc(poolCounterMetricFormat(answer, state.quickMetric))}</em><small>WR ${pct(answer.winrate, 1)} · Δ ${signedPct(answer.diff, 1)} · ${integer(answer.games)} game</small></a></td>`;
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
      if (q50Option) q50Option.textContent = `${POOL_COUNTER_QUANTILE_LABEL} · ${matrix.q50Count}`;
      if (allOption) allOption.textContent = `All · ${matrix.allCount}`;
    }
    if (metricSelect) metricSelect.value = state.quickMetric;
    if (confidenceSelect) confidenceSelect.value = String(state.quickConfidence);
    if (confidenceField) confidenceField.hidden = state.quickMetric !== 'wilson';
    if (searchInput && searchInput.value !== state.quickQuery) searchInput.value = state.quickQuery;

    const metric = POOL_COUNTER_METRICS[state.quickMetric] || POOL_COUNTER_METRICS.wilson;
    const scopeText = state.quickScope === 'all'
      ? `all ${matrix.allCount} champions in the role`
      : `${matrix.q50Count} ${POOL_COUNTER_QUANTILE_LABEL} champions with at least ${integer(matrix.q50Threshold)} matches`;
    byId('quickCounterSummary').innerHTML = `<strong>${esc(roleLabel(state.quickRole))}</strong> · Pool: <strong>${state.quickPool.map(esc).join(' / ')}</strong> · ${esc(scopeText)} · sorting: <strong>${esc(metric.label)}</strong>.`;
    byId('quickCounterCount').textContent = `${matrix.rows.length} ${matrix.rows.length === 1 ? 'row' : 'rows'}`;
    const download = byId('quickDownloadBtn');
    if (download) download.disabled = !matrix.rows.length;

    const maxRanks = Math.max(1, state.quickPool.length);
    const head = byId('quickCounterTableHead');
    const body = byId('quickCounterTableBody');
    head.innerHTML = `<tr><th scope="col">Lane champion</th><th scope="col">Role matches</th><th scope="col">Status</th>${Array.from({ length: maxRanks }, (_, index) => `<th scope="col">#${index + 1} from the pool</th>`).join('')}</tr>`;

    if (!matrix.rows.length) {
      body.innerHTML = `<tr><td class="quick-table-no-results" colspan="${3 + maxRanks}">No champion matches the search.</td></tr>`;
      return;
    }

    body.innerHTML = matrix.rows.map((row) => {
      const cells = Array.from({ length: maxRanks }, (_, index) => quickCounterCell(row.counters[index], index + 1, row.target)).join('');
      return `<tr><th scope="row"><strong>${champHtml(row.target, 'xs')}</strong></th><td class="quick-number">${integer(row.targetGames)}</td><td>${row.inPool ? '<span class="quick-pool-badge">In pool</span>' : '<span class="quick-out-badge">Opponent</span>'}</td>${cells}</tr>`;
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
      setQuickValidation(`Table generated. Champions ignored because they were not found in ${roleLabel(parsed.role)}: ${parsed.unknown.join(', ')}.`, 'warning');
    } else {
      setQuickValidation(`Recognized ${parsed.pool.length} champions in ${roleLabel(parsed.role)}.`, 'success');
    }
    renderQuickCounterTable();
    byId('quickCounterResults')?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    announce(`Counter table generated for ${roleLabel(parsed.role)} con ${parsed.pool.length} champions.`);
  }

  function csvCell(value) {
    let text = String(value ?? '');
    if (/^[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  }

  function downloadQuickCounterCsv() {
    const matrix = state.quickMatrix;
    if (!matrix?.rows?.length) return;
    const maxRanks = Math.max(1, state.quickPool.length);
    const metric = POOL_COUNTER_METRICS[state.quickMetric] || POOL_COUNTER_METRICS.wilson;
    const headers = ['Role champion', 'Role matches', 'In pool'];
    for (let rank = 1; rank <= maxRanks; rank += 1) {
      headers.push(`#${rank} counter`, `#${rank} ${metric.label}`, `#${rank} WR`, `#${rank} WR diff`, `#${rank} matches`);
    }

    const rows = matrix.rows.map((row) => {
      const values = [row.target, Math.round(row.targetGames || 0), row.inPool ? 'Yes' : 'No'];
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
    announce(`CSV table downloaded with ${matrix.rows.length} rows.`);
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

  function snowballTierLabel(value) {
    const number = safeNumber(value);
    if (number === null) return 'partial data';
    if (number >= 0.25) return 'explosive';
    if (number >= 0.16) return 'high';
    if (number >= 0.08) return 'medium';
    return 'low';
  }

  function banCoverageLabel(row) {
    return row.hasSafeAnswer ? 'Covered' : 'Not covered';
  }

  function banCoverageClass(row) {
    return row.hasSafeAnswer ? 'covered' : 'uncovered';
  }

  function banToneClass(row) {
    if (row.bestAnswerThreat >= 0.55 || row.aggregateThreat >= 0.56) return 'danger';
    if (row.aggregateThreat >= 0.53 || row.worstExposure >= 0.57) return 'warning';
    if (row.aggregateThreat >= 0.51) return 'info';
    return 'neutral';
  }

  function renderBanRecommendations() {
    const panel = byId('banRecommendationPanel');
    if (!panel) return;
    if (!state.started || !state.selected.length) {
      panel.hidden = true;
      return;
    }

    const result = buildBanRecommendations(state.selected, {
      role: state.role,
      scope: state.banScope,
      limit: state.banLimit
    });
    state.banRows = result.rows;

    const scopeSelect = byId('banScopeSelect');
    const limitSelect = byId('banLimitSelect');
    if (scopeSelect) {
      scopeSelect.value = state.banScope;
      const q50Option = scopeSelect.querySelector('option[value="q50"]');
      const allOption = scopeSelect.querySelector('option[value="all"]');
      if (q50Option) q50Option.textContent = `${BAN_RECOMMENDATION_QUANTILE_LABEL} · ${result.q50Count} champions`;
      if (allOption) allOption.textContent = `All · ${result.allCount} champions`;
    }
    if (limitSelect) {
      if (!limitSelect.querySelector(`option[value="${state.banLimit}"]`)) {
        const option = document.createElement('option');
        option.value = String(state.banLimit);
        option.textContent = `Top ${state.banLimit}`;
        limitSelect.appendChild(option);
      }
      limitSelect.value = String(state.banLimit);
    }

    const scopeText = state.banScope === 'all'
      ? `all ${result.allCount} available champions`
      : `the ${result.q50Count} ${BAN_RECOMMENDATION_QUANTILE_LABEL} champions with at least ${integer(result.q50Threshold)} matches`;
    const poolText = result.pool.join(' / ');
    byId('banRecommendationSummary').innerHTML = `<strong>${esc(roleLabel(state.role))} · ${esc(poolText)}:</strong> comparison ${esc(scopeText)}. Results are sorted by the final ban index. Matchup danger is dominant; popularity and candidate-oriented snowball pressure are gated by that danger. No candidate is removed because of a single favorable matchup.`;
    byId('banResultCount').textContent = `${result.rows.length} ban`;

    const list = byId('banRecommendationRows');
    if (!result.rows.length) {
      list.innerHTML = '<div class="counter-empty">No candidate has enough direct matchup data for a reliable ban evaluation.</div>';
      panel.hidden = false;
      return;
    }

    list.innerHTML = result.rows.map((row, index) => {
      const worst = row.worstMatchup;
      const best = row.bestResponse;
      const deepLink = worst
        ? `./visual.html?role=${encodeURIComponent(state.role)}&a=${encodeURIComponent(worst.playerChampion)}&b=${encodeURIComponent(row.candidate)}`
        : null;
      const bestCopy = best
        ? `Best answer: ${best.playerChampion} · opponent WR ${pct(best.winrate, 1)}`
        : 'No pool answer with direct data';
      const worstCopy = worst
        ? `Most exposed: ${worst.playerChampion} · WR ${pct(worst.winrate, 1)} · Δ ${signedPct(worst.diff, 1)}`
        : 'Worst matchup unavailable';
      const snowCopy = row.aggregateSnowball === null
        ? 'Snowball N/D'
        : `Snowball ${pct(row.aggregateSnowball, 1)} · ${snowballTierLabel(row.aggregateSnowball)}`;
      const content = `
        <article class="ban-card ${banToneClass(row)}">
          <div class="ban-rank">#${index + 1}</div>
          <div class="ban-card-main">
            <div><h3>${champHtml(row.candidate, 'md')}</h3><p>${integer(row.candidateGames)} matches in the role · ${row.knownCount}/${row.totalCount} known matchups</p></div>
            <div class="ban-score"><strong>${scoreFmt(row.score)}</strong><span>ban index</span></div>
          </div>
          <div class="ban-label ${banCoverageClass(row)}">${esc(banCoverageLabel(row))}</div>
          <div class="ban-metrics">
            <div><span>WR/Δ threat</span><strong>${scoreFmt(row.matchupThreat)}</strong><small>average WR ${pct(row.averageEnemyWinrate, 1)} · Δ ${signedPct(row.averageEnemyDiff, 1)} · ${integer(row.totalDirectGames)} direct matches</small></div>
            <div><span>Popularity</span><strong>${scoreFmt(row.popularity)}</strong><small>${integer(row.candidateGames)} total matches</small></div>
            <div><span>Snowball</span><strong>${scoreFmt(row.snowball)}</strong><small>${esc(snowCopy)}</small></div>
          </div>
          <div class="ban-detail"><span>${esc(bestCopy)}</span><span>${esc(worstCopy)}</span></div>
          ${deepLink ? `<a class="ban-matchup-link" href="${esc(deepLink)}">Open the most critical matchup</a>` : ''}
        </article>`;
      return content;
    }).join('');
    panel.hidden = false;
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
      if (q50Option) q50Option.textContent = `${POOL_COUNTER_QUANTILE_LABEL} · ${matrix.q50Count} champions`;
      if (allOption) allOption.textContent = `All · ${matrix.allCount} champions`;
    }
    if (metricSelect) metricSelect.value = state.counterMetric;
    if (confidenceSelect) confidenceSelect.value = String(state.counterConfidence);
    if (confidenceField) confidenceField.hidden = state.counterMetric !== 'wilson';
    if (searchInput && searchInput.value !== state.counterQuery) searchInput.value = state.counterQuery;

    const scopeText = state.counterScope === 'all'
      ? `all ${matrix.allCount} champions available in the role`
      : `the ${matrix.q50Count} ${POOL_COUNTER_QUANTILE_LABEL} champions with at least ${integer(matrix.q50Threshold)} matches in the role`;
    byId('counterCoverageSummary').innerHTML = `<strong>${esc(roleLabel(state.role))}:</strong> analyzing ${esc(scopeText)}. For each opponent, the pool champions are ranked by <strong>${esc(metric.label)}</strong>. When the champion in the row is already in the pool, it cannot counter itself.`;
    byId('counterMetricNote').textContent = state.counterMetric === 'wilson'
      ? `${metric.description} Selected confidence level: ${state.counterConfidence}%.`
      : metric.description;
    byId('counterResultCount').textContent = `${matrix.rows.length} ${matrix.rows.length === 1 ? 'champion' : 'champions'}`;

    const list = byId('counterCoverageRows');
    if (!matrix.rows.length) {
      list.innerHTML = '<div class="counter-empty">No champion matches the search filter.</div>';
      panel.hidden = false;
      return;
    }

    list.innerHTML = matrix.rows.map((row) => {
      const answers = row.counters.length ? row.counters.map((answer, index) => {
        const rank = index + 1;
        if (!answer.hasData) {
          return `<div class="pool-counter-answer unavailable"><span class="counter-answer-rank">#${rank}</span><strong>${champHtml(answer.champion, 'xs')}</strong><span class="counter-answer-primary">N/A</span><small>Matchup not present in the dataset</small></div>`;
        }
        const deepLink = `./visual.html?role=${encodeURIComponent(state.role)}&a=${encodeURIComponent(answer.champion)}&b=${encodeURIComponent(row.target)}`;
        const metricValue = poolCounterMetricFormat(answer, state.counterMetric);
        const meta = `WR ${pct(answer.winrate, 1)} · Δ ${signedPct(answer.diff, 1)} · ${integer(answer.games)} matches`;
        return `<a class="pool-counter-answer" href="${esc(deepLink)}" title="Open ${esc(answer.champion)} against ${esc(row.target)} in Matchup Lab"><span class="counter-answer-rank">#${rank}</span><strong>${champHtml(answer.champion, 'xs')}</strong><span class="counter-answer-primary">${esc(metricValue)}</span><small>${esc(meta)}</small></a>`;
      }).join('') : '<div class="counter-no-answer">No other champion in the pool can be compared with this row.</div>';

      const poolBadge = row.inPool ? '<span class="counter-badge in-pool">In pool</span>' : '';
      return `<article class="pool-counter-target"><div class="counter-target-head"><div><h3>${champHtml(row.target, 'sm')}</h3><p>${integer(row.targetGames)} matches in the role</p></div>${poolBadge}</div><div class="counter-answer-list">${answers}</div></article>`;
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
      ['Matchup coverage', evaluation.matchupCoverage, weights.matchupCoverage],
      ['Weakness control', evaluation.weaknessControl, weights.weaknessControl],
      ['Overall strength', evaluation.averageChampionStrength, weights.averageChampionStrength],
      ['Damage variety', evaluation.damageVariety, weights.damageVariety],
      ['Profile diversity', evaluation.profileDiversity, weights.profileDiversity],
      ['Data reliability', evaluation.dataConfidence, weights.dataConfidence]
    ];
    const copyText = `${roleLabel(state.role).toUpperCase()} — ${state.selected.join(' / ')}`;
    byId('finalContent').innerHTML = `
      <div class="final-hero"><div class="final-score">${scoreFmt(evaluation.finalScore)}</div><div><div class="micro-label">Final statistical evaluation</div><h2>${esc(finalLabel(evaluation.finalScore))}</h2><p>The score describes statistical pool quality, not personal mastery. It uses a fixed opponent universe, conservative missing-data adjustment, and a reliability multiplier (${(evaluation.confidenceMultiplier * 100).toFixed(1)}% of the raw weighted score).</p></div></div>
      <div class="breakdown">${fields.map(([label, value, weight]) => `<div class="metric"><div class="metric-top"><span>${esc(label)}</span><strong>${scoreFmt(value)} · ${Math.round(weight || 0)}%</strong></div><div class="bar"><span style="width:${clamp(value, 0, 100)}%"></span></div></div>`).join('')}</div>
      <div class="copy-box"><textarea id="copyOutput" readonly>${esc(copyText)}</textarea><button id="copyBtn" class="secondary" type="button">Copy the pool</button></div>`;
    panel.hidden = false;
    byId('copyBtn').addEventListener('click', copyPool);
  }

  function renderWorkspace() {
    byId('emptyState').hidden = state.started;
    byId('poolPanel').hidden = !state.started;
    if (!state.started) {
      const counterPanel = byId('counterCoveragePanel');
      const banPanel = byId('banRecommendationPanel');
      if (counterPanel) counterPanel.hidden = true;
      if (banPanel) banPanel.hidden = true;
      return;
    }
    renderPool();
    renderBanRecommendations();
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
    announce(`${champion} added. ${state.selected.length} champions out of ${state.size}.`);
    if (state.selected.length >= state.size) {
      const smooth = CONFIG?.ui?.smoothScroll !== false && !prefersReducedMotion();
      byId('finalPanel').scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
    }
  }

  function removeAt(index) {
    if (state.selected.length <= 1 || index < 0 || index >= state.selected.length) return;
    const [removed] = state.selected.splice(index, 1);
    renderWorkspace();
    announce(`${removed} removed from the pool.`);
  }

  function startBuilder() {
    if (!state.role || !state.size) return;
    const typed = byId('firstChampion').value.trim();
    const exact = championsForRole().find((champion) => champion.toLocaleLowerCase('it') === typed.toLocaleLowerCase('it'));
    const validation = byId('firstValidation');
    if (typed && !state.firstChampion && !exact) {
      if (validation) validation.hidden = false;
      byId('firstChampion').setAttribute('aria-invalid', 'true');
      byId('firstChampion').focus();
      announce('Select a valid champion from the list or leave the field empty.');
      return;
    }
    if (validation) validation.hidden = true;
    byId('firstChampion').setAttribute('aria-invalid', 'false');
    const first = state.firstChampion || exact || bestAutomaticFirst();
    if (!first) return;
    state.selected = [first];
    state.started = true;
    state.customChampion = null;
    renderWorkspace();
    const automatic = !state.firstChampion && !exact;
    announce(`${first} selected as the first champion${automatic ? ' automatically' : ''}.`);
  }

  function resetBuilder() {
    state.selected = [];
    state.started = false;
    state.customChampion = null;
    state.recommendationRows = [];
    state.banRows = [];
    byId('customChampion').value = '';
    renderWorkspace();
    announce('Pool Builder reset.');
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
      button.textContent = 'Copied';
      window.setTimeout(() => { button.textContent = 'Copy the pool'; }, 1300);
    }
    announce('Champion pool copied to the clipboard.');
  }

  function validateConfiguration() {
    const errors = [];
    const warnings = [];
    const weightGroups = [
      ['matchup.rawScoreWeights', CONFIG?.matchup?.rawScoreWeights],
      ['matchup.coverageBlendWeights', CONFIG?.matchup?.coverageBlendWeights],
      ['matchup.weaknessBlendWeights', CONFIG?.matchup?.weaknessBlendWeights],
      ['recommendation.weights', CONFIG?.recommendation?.weights],
      ['recommendation.matchupComplementWeights', CONFIG?.recommendation?.matchupComplementWeights],
      ['poolEvaluation.weights', CONFIG?.poolEvaluation?.weights],
      ['banRecommendation.weights', CONFIG?.banRecommendation?.weights],
      ['banRecommendation.matchupWeights', CONFIG?.banRecommendation?.matchupWeights],
      ['banRecommendation.poolThreatWeights', CONFIG?.banRecommendation?.poolThreatWeights],
      ['banRecommendation.popularityWeights', CONFIG?.banRecommendation?.popularityWeights],
      ['banRecommendation.snowballWeights', CONFIG?.banRecommendation?.snowballWeights]
    ];
    weightGroups.forEach(([name, weights]) => {
      const total = Object.values(weights || {}).reduce((sum, value) => sum + Math.max(0, safeNumber(value) ?? 0), 0);
      if (total <= 0) errors.push(`${name}: enter at least one weight greater than zero.`);
    });

    const requireRange = (name, value, min, max) => {
      const number = safeNumber(value);
      if (number === null || number < min || number > max) errors.push(`${name} must be between ${min} and ${max}.`);
    };
    const requirePositive = (name, value) => {
      const number = safeNumber(value);
      if (number === null || number <= 0) errors.push(`${name} must be greater than zero.`);
    };

    requireRange('dataSelection.rigorousQuantile', CONFIG?.dataSelection?.rigorousQuantile, 0, 1);
    if (!['all', 'rigorous'].includes(CONFIG?.dataSelection?.evaluationOpponents)) {
      errors.push("dataSelection.evaluationOpponents must be 'all' or 'rigorous'.");
    }
    requireRange('matchup.neutralWinrate', CONFIG?.matchup?.neutralWinrate, 0, 1);
    requireRange('matchup.worstTailShare', CONFIG?.matchup?.worstTailShare, 0.01, 1);
    requireRange('matchup.unknownMatchupScore', CONFIG?.matchup?.unknownMatchupScore, 0, 1);
    requireRange('matchup.weaknessScoreFloor', CONFIG?.matchup?.weaknessScoreFloor, 0, 1);
    requireRange('matchup.weaknessScoreFullAt', CONFIG?.matchup?.weaknessScoreFullAt, 0, 1);
    if ((safeNumber(CONFIG?.matchup?.weaknessScoreFullAt) ?? 0) <= (safeNumber(CONFIG?.matchup?.weaknessScoreFloor) ?? 1)) {
      errors.push('matchup.weaknessScoreFullAt must be greater than weaknessScoreFloor.');
    }
    if ((safeNumber(CONFIG?.matchup?.fixedAbove) ?? 0) <= (safeNumber(CONFIG?.matchup?.weakBelow) ?? 1)) {
      errors.push('matchup.fixedAbove must be greater than weakBelow.');
    }
    ['shrinkageGames', 'evidenceWeightExponent', 'opponentLikelihoodExponent', 'completenessShrinkExponent'].forEach((key) => {
      const number = safeNumber(CONFIG?.matchup?.[key]);
      if (number === null || number < 0) errors.push(`matchup.${key} must be zero or greater.`);
    });

    const floor = safeNumber(CONFIG?.championStrength?.winrateFloor);
    const ceiling = safeNumber(CONFIG?.championStrength?.winrateCeiling);
    if (floor === null || ceiling === null || ceiling <= floor) errors.push('championStrength.winrateCeiling must be greater than winrateFloor.');

    if (!Array.isArray(CONFIG?.profileDiversity?.fields) || !CONFIG.profileDiversity.fields.length) {
      errors.push('profileDiversity.fields must contain at least one field.');
    }
    requirePositive('confidence.profileSampleTarget', CONFIG?.confidence?.profileSampleTarget);
    requirePositive('confidence.matchupSampleTarget', CONFIG?.confidence?.matchupSampleTarget);
    requirePositive('recommendation.fullMatchupGainAt', CONFIG?.recommendation?.fullMatchupGainAt);
    requirePositive('recommendation.fullPoolScoreGainAt', CONFIG?.recommendation?.fullPoolScoreGainAt);
    requirePositive('recommendation.fullDamageGainAt', CONFIG?.recommendation?.fullDamageGainAt);
    requireRange('recommendation.relativeRankBlend', CONFIG?.recommendation?.relativeRankBlend, 0, 1);
    requireRange('poolEvaluation.confidenceMultiplierFloor', CONFIG?.poolEvaluation?.confidenceMultiplierFloor, 0, 1);

    requireRange('banRecommendation.neutralThreat', CONFIG?.banRecommendation?.neutralThreat, 0, 1);
    requireRange('banRecommendation.fullThreatAt', CONFIG?.banRecommendation?.fullThreatAt, 0, 1);
    if ((safeNumber(CONFIG?.banRecommendation?.fullThreatAt) ?? 0) <= (safeNumber(CONFIG?.banRecommendation?.neutralThreat) ?? 1)) {
      errors.push('banRecommendation.fullThreatAt must be greater than neutralThreat.');
    }
    requireRange('banRecommendation.safeAnswerThreatMax', CONFIG?.banRecommendation?.safeAnswerThreatMax, 0, 1);
    requireRange('banRecommendation.unknownThreatPrior', CONFIG?.banRecommendation?.unknownThreatPrior, 0, 1);
    requirePositive('banRecommendation.fullSnowballAt', CONFIG?.banRecommendation?.fullSnowballAt);

    if (!POOL_SIZES.length) errors.push('ui.poolSizes must contain at least one integer between 1 and 10.');
    const labels = CONFIG?.poolEvaluation?.labels;
    if (!Array.isArray(labels) || !labels.length) errors.push('poolEvaluation.labels must contain at least one label.');
    else {
      labels.forEach((entry, index) => {
        requireRange(`poolEvaluation.labels[${index}].min`, entry?.min, 0, 100);
        if (!String(entry?.text || '').trim()) errors.push(`poolEvaluation.labels[${index}].text cannot be empty.`);
      });
    }

    errors.forEach((message) => console.error(`[Pool Builder config] ${message}`));
    warnings.forEach((message) => console.warn(`[Pool Builder config] ${message}`));
    return { errors, warnings };
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
        <div class="pool-method-item"><span>${Math.round(matchupTotal)}%</span><strong>Matchups and weaknesses</strong></div>
        <div class="pool-method-item"><span>${Math.round(compositionTotal)}%</span><strong>Strength and composition</strong></div>
        <div class="pool-method-item"><span>${Math.round(weights.dataConfidence || 0)}%</span><strong>Data reliability</strong></div>`;
    }
  }

  function exposeDebugApi() {
    window.POOL_BUILDER_API = {
      config: CONFIG,
      getState: () => ({ ...state, selected: state.selected.slice(), opponents: state.opponents.slice() }),
      getMatchup: (role, champion, opponent) => getMatchup(role, champion, opponent),
      evaluateCurrentPool: () => evaluatePool(state.selected),
      evaluatePool: (pool = state.selected) => evaluatePool(normalizePoolForRole(pool, state.role)),
      evaluateMatchups: (pool = state.selected) => evaluateMatchupCore(normalizePoolForRole(pool, state.role)),
      buildRecommendations: (pool = state.selected) => buildCandidateRows(normalizePoolForRole(pool, state.role)).map((row) => ({ ...row })),
      buildCounterMatrix: (pool = state.selected, options = {}) => buildPoolCounterMatrix(pool, options),
      buildBanRecommendations: (pool = state.selected, options = {}) => buildBanRecommendations(pool, options),
      parseQuickPool: (text) => parseQuickPoolText(text),
      recommendationRows: () => state.recommendationRows.map((row) => ({ ...row })),
      validateConfig: () => validateConfiguration()
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
    byId('banScopeSelect').addEventListener('change', (event) => {
      state.banScope = event.target.value === 'all' ? 'all' : 'q50';
      renderBanRecommendations();
      announce(`Ban recommendations updated: ${state.banScope === 'all' ? 'all champions' : `${BAN_RECOMMENDATION_QUANTILE_LABEL} champions`}.`);
    });
    byId('banLimitSelect').addEventListener('change', (event) => {
      state.banLimit = Math.max(1, Math.min(BAN_RECOMMENDATION_MAX_LIMIT, Number(event.target.value) || BAN_RECOMMENDATION_LIMIT));
      renderBanRecommendations();
      announce(`Showing ${state.banLimit} ban recommendations.`);
    });
    byId('counterScopeSelect').addEventListener('change', (event) => {
      state.counterScope = event.target.value === 'all' ? 'all' : 'q50';
      renderCounterCoverage();
      announce(`Counter coverage updated: ${state.counterScope === 'all' ? 'all champions' : `${POOL_COUNTER_QUANTILE_LABEL} champions`}.`);
    });
    byId('counterMetricSelect').addEventListener('change', (event) => {
      state.counterMetric = POOL_COUNTER_METRICS[event.target.value] ? event.target.value : 'wilson';
      renderCounterCoverage();
      announce(`Counter sorting updated: ${POOL_COUNTER_METRICS[state.counterMetric].label}.`);
    });
    byId('counterConfidenceSelect').addEventListener('change', (event) => {
      const confidence = Number(event.target.value);
      state.counterConfidence = Object.prototype.hasOwnProperty.call(WILSON_Z, confidence) ? confidence : DEFAULT_POOL_COUNTER_CONFIDENCE;
      renderCounterCoverage();
      announce(`Wilson confidence set to ${state.counterConfidence}%.`);
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
        if (input.id === 'firstChampion') { state.firstChampion = null; input.setAttribute('aria-invalid', 'false'); const validation = byId('firstValidation'); if (validation) validation.hidden = true; }
        if (input.id === 'customChampion') { state.customChampion = null; updateCustomPreview(); }
      });
    });
  }

  function init() {
    if (!CONFIG) {
      setDataStatus('error', 'Config missing');
      byId('emptyState').innerHTML = '<div class="pool-empty-monogram">!</div><h3>Configuration unavailable</h3><p>Load <code>pool.config.js</code> before <code>pool.js</code>.</p>';
      return;
    }
    if (!DATA || !DATA.matchups || !Array.isArray(DATA.matchupColumns) || !DATA.championProfiles) {
      setDataStatus('error', 'Dataset missing');
      byId('emptyState').innerHTML = '<div class="pool-empty-monogram">!</div><h3>Dataset unavailable</h3><p>Place <code>matchup_data.js</code> in the same folder and load it before <code>pool.js</code>.</p>';
      return;
    }
    const configValidation = validateConfiguration();
    if (configValidation.errors.length) {
      setDataStatus('error', 'Invalid config');
      byId('emptyState').innerHTML = `<div class="pool-empty-monogram">!</div><h3>Invalid configuration</h3><p>${esc(configValidation.errors.join(' '))}</p>`;
      return;
    }
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
    setDataStatus('ready', `Dataset ready`);
    updateStartButton();
  }

  init();
})();