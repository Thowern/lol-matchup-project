(() => {
  'use strict';

  const DATA = window.MATCHUP_APP_DATA;
  const ROLE_ORDER_FALLBACK = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
  const ROLE_LABELS = { TOP: 'Top', JUNGLE: 'Jungle', MIDDLE: 'Mid', BOTTOM: 'BOT', UTILITY: 'Support' };
  const DEFAULT_ROLE_THRESHOLD = 100;
  const DEFAULT_COUNTER_THRESHOLD = 25;
  const DEFAULT_WILSON_CONFIDENCE = 99;
  const WILSON_LEVELS = {
    90: {
      z: 1.6448536269514722,
      label: '90%',
      name: 'Esplorativo',
      description: 'Più permissivo: riduce la penalizzazione dei matchup con pochi dati. Utile per esplorare, meno prudente nelle conclusioni.'
    },
    95: {
      z: 1.959963984540054,
      label: '95%',
      name: 'Bilanciato',
      description: 'Compromesso statistico classico tra prudenza e sensibilità. Penalizza i campioni poco osservati senza essere eccessivamente severo.'
    },
    99: {
      z: 2.5758293035489004,
      label: '99%',
      name: 'Prudente',
      description: 'Impostazione predefinita e più prudente: richiede evidenza più forte e penalizza maggiormente i risultati ottenuti su pochi matchup.'
    }
  };

  const METRICS = [
    {
      key: 'general_winrate',
      label: 'Win rate',
      short: 'WR',
      description: 'Percentuale di vittorie complessiva del campione nel ruolo.',
      format: (v) => pct(v, 1),
      higherIsBetter: true
    },
    {
      key: 'avg_damage_to_champs',
      label: 'Danni ai campioni',
      short: 'Danni',
      description: 'Danno medio inflitto ai campioni avversari.',
      format: (v) => integer(v),
      higherIsBetter: true
    },
    {
      key: 'avg_damage_taken',
      label: 'Danni subiti',
      short: 'Resistenza',
      description: 'Danno medio assorbito. Non è sempre un valore positivo: dipende dal ruolo e dallo stile del campione.',
      format: (v) => integer(v),
      higherIsBetter: true
    },
    {
      key: 'vision_score',
      label: 'Vision score',
      short: 'Visione',
      description: 'Vision score medio nelle partite del ruolo.',
      format: (v) => decimal(v, 1),
      higherIsBetter: true
    },
    {
      key: 'avg_total_time_cc_dealt',
      label: 'Controllo totale',
      short: 'CC',
      description: 'Tempo medio complessivo di crowd control applicato.',
      format: (v) => decimal(v, 1),
      higherIsBetter: true
    },
    {
      key: 'avg_time_ccing_others',
      label: 'CC sugli avversari',
      short: 'CC diretto',
      description: 'Tempo medio durante il quale gli avversari restano controllati.',
      format: (v) => decimal(v, 1),
      higherIsBetter: true
    },
    {
      key: 'avg_event_kills',
      label: 'Kill medie',
      short: 'Kill',
      description: 'Kill medie registrate negli eventi del dataset.',
      format: (v) => decimal(v, 2),
      higherIsBetter: true
    },
    {
      key: 'avg_bounty_net',
      label: 'Saldo taglie',
      short: 'Taglie',
      description: 'Oro medio ottenuto tramite taglie meno quello concesso morendo.',
      format: (v) => signed(v, 1),
      higherIsBetter: true
    },
    {
      key: 'avg_level6_minute',
      label: 'Timing livello 6',
      short: 'Livello 6',
      description: 'Minuto medio in cui viene raggiunto il livello 6. Un valore più basso indica un timing più rapido.',
      format: (v) => `${decimal(v, 2)} min`,
      higherIsBetter: false
    },
    {
      key: 'shutdown_collected_rate',
      label: 'Shutdown incassati',
      short: 'Shutdown +',
      description: 'Frequenza con cui il campione incassa una taglia importante.',
      format: (v) => pct(v, 1),
      higherIsBetter: true
    },
    {
      key: 'shutdown_given_rate',
      label: 'Shutdown concessi',
      short: 'Shutdown −',
      description: 'Frequenza con cui il campione concede una taglia importante. Più basso è meglio.',
      format: (v) => pct(v, 1),
      higherIsBetter: false
    }
  ];

  const COUNTER_SORTS = {
    winrate: {
      label: 'Win rate nel matchup',
      description: 'Ordina gli avversari per percentuale di vittorie contro il campione selezionato.',
      value: (row) => row.winrate,
      format: (v) => pct(v, 1),
      higherIsBetter: true
    },
    diff: {
      label: 'Scarto dal WR abituale',
      description: 'Premia i campioni che rendono meglio del proprio win rate medio proprio contro il campione selezionato.',
      value: (row) => row.diff,
      format: (v) => signedPct(v, 1),
      higherIsBetter: true
    },
    wilson: {
      label: 'WR corretto per affidabilità',
      description: 'Usa il limite inferiore Wilson configurabile: penalizza automaticamente i risultati ottenuti su pochissime partite.',
      value: (row) => row.wilson,
      format: (v) => pct(v, 1),
      higherIsBetter: true
    },
    matches: {
      label: 'Numero di partite',
      description: 'Mostra prima i matchup con il campione statistico più ampio.',
      value: (row) => row.games,
      format: (v) => integer(v),
      higherIsBetter: true
    }
  };

  const legacyThreshold = readNumberSetting('rankingsThreshold', null);
  const state = {
    mode: 'role',
    role: null,
    metric: 'general_winrate',
    counterSort: 'winrate',
    counterChampion: null,
    thresholds: {
      role: readNumberSetting('rankingsRoleThreshold', legacyThreshold),
      counter: readNumberSetting('rankingsCounterThreshold', legacyThreshold)
    },
    thresholdContextKeys: {
      role: readStringSetting('rankingsRoleThresholdContext', null),
      counter: readStringSetting('rankingsCounterThresholdContext', null)
    },
    includeLowSample: readBoolSetting('rankingsIncludeLowSample', true),
    wilsonConfidence: readChoiceSetting('rankingsWilsonConfidence', [90, 95, 99], DEFAULT_WILSON_CONFIDENCE),
    query: ''
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const byId = (id) => document.getElementById(id);

  function safeNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function esc(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function pct(value, digits = 1) {
    const n = safeNumber(value);
    return n === null ? '—' : `${(n * 100).toLocaleString('it-IT', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
  }

  function signedPct(value, digits = 1) {
    const n = safeNumber(value);
    if (n === null) return '—';
    const rendered = (n * 100).toLocaleString('it-IT', { minimumFractionDigits: digits, maximumFractionDigits: digits });
    return `${n > 0 ? '+' : ''}${rendered} pp`;
  }

  function decimal(value, digits = 1) {
    const n = safeNumber(value);
    return n === null ? '—' : n.toLocaleString('it-IT', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  function signed(value, digits = 1) {
    const n = safeNumber(value);
    if (n === null) return '—';
    return `${n > 0 ? '+' : ''}${decimal(n, digits)}`;
  }

  function integer(value) {
    const n = safeNumber(value);
    return n === null ? '—' : Math.round(n).toLocaleString('it-IT');
  }

  function localeSort(a, b) {
    return String(a).localeCompare(String(b), 'it', { sensitivity: 'base' });
  }

  function readNumberSetting(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null || raw === '') return fallback;
      const parsed = Number(raw);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function readChoiceSetting(key, choices, fallback) {
    const value = readNumberSetting(key, fallback);
    return choices.includes(value) ? value : fallback;
  }

  function readStringSetting(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? fallback : raw;
    } catch (_) {
      return fallback;
    }
  }

  function readBoolSetting(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? fallback : raw === 'true';
    } catch (_) {
      return fallback;
    }
  }

  function writeSetting(key, value) {
    try { window.localStorage.setItem(key, String(value)); } catch (_) { /* storage opzionale */ }
  }

  function removeSetting(key) {
    try { window.localStorage.removeItem(key); } catch (_) { /* storage opzionale */ }
  }

  function roleOrder() {
    const roles = DATA?.meta?.roles || DATA?.meta?.role_order || DATA?.roleOrder;
    const source = Array.isArray(roles) && roles.length ? roles : ROLE_ORDER_FALLBACK;
    return ROLE_ORDER_FALLBACK.filter((role) => source.includes(role))
      .concat(source.filter((role) => !ROLE_ORDER_FALLBACK.includes(role)));
  }

  function roleLabel(role) {
    return ROLE_LABELS[role] || DATA?.meta?.role_labels?.[role] || role;
  }

  function profilesForRole(role) {
    return DATA?.championProfiles?.[role] || {};
  }

  function championsForRole(role) {
    const names = new Set(DATA?.meta?.roles_champions?.[role] || []);
    Object.keys(profilesForRole(role)).forEach((name) => names.add(name));
    const roleMap = DATA?.matchups?.[role] || {};
    Object.entries(roleMap).forEach(([name, opponents]) => {
      names.add(name);
      Object.keys(opponents || {}).forEach((opponent) => names.add(opponent));
    });
    return Array.from(names).sort(localeSort);
  }

  function thresholdStorageKey(mode) {
    return mode === 'counter' ? 'rankingsCounterThreshold' : 'rankingsRoleThreshold';
  }

  function activeThreshold() {
    const fallback = state.mode === 'counter' ? DEFAULT_COUNTER_THRESHOLD : DEFAULT_ROLE_THRESHOLD;
    return safeNumber(state.thresholds[state.mode]) ?? fallback;
  }

  function setActiveThreshold(value, persist = true) {
    const next = clamp(Math.round(safeNumber(value) ?? 0), 0, 1000000);
    state.thresholds[state.mode] = next;
    if (persist) writeSetting(thresholdStorageKey(state.mode), next);
    return next;
  }

  function thresholdContextKey(mode = state.mode) {
    return mode === 'counter'
      ? `counter:${state.role || ''}:${state.counterChampion || '*'}`
      : `role:${state.role || ''}`;
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

  function niceStep(value, mode = state.mode) {
    const n = Math.abs(safeNumber(value) ?? 0);
    if (n <= 10) return 1;
    if (mode === 'role') {
      if (n <= 100) return 10;
      if (n <= 500) return 50;
      if (n <= 1000) return 100;
      if (n <= 5000) return 250;
      if (n <= 20000) return 500;
      if (n <= 100000) return 2500;
      return 5000;
    }
    if (n <= 20) return 5;
    if (n <= 100) return 10;
    if (n <= 500) return 25;
    if (n <= 2000) return 50;
    if (n <= 10000) return 100;
    if (n <= 50000) return 500;
    return 1000;
  }

  function niceThreshold(value, mode = state.mode) {
    const n = Math.max(0, safeNumber(value) ?? 0);
    if (n <= 10) {
      const compact = [1, 2, 5, 10];
      return compact.reduce((best, candidate) => Math.abs(candidate - n) < Math.abs(best - n) ? candidate : best, compact[0]);
    }
    const step = niceStep(n, mode);
    return Math.max(step, Math.round(n / step) * step);
  }

  function thresholdSampleSizes(mode = state.mode) {
    if (mode === 'role') {
      return Object.values(profilesForRole(state.role))
        .map((profile) => safeNumber(profile?.coverage?.total_games))
        .filter((value) => value !== null && value > 0)
        .sort((a, b) => a - b);
    }

    const roleMap = DATA?.matchups?.[state.role] || {};
    const values = [];
    if (state.counterChampion) {
      const opponents = new Set(Object.keys(roleMap?.[state.counterChampion] || {}));
      Object.entries(roleMap).forEach(([name, matchupMap]) => {
        if (matchupMap?.[state.counterChampion]) opponents.add(name);
      });
      opponents.forEach((opponent) => {
        if (opponent === state.counterChampion) return;
        const record = getCounterRecord(state.role, state.counterChampion, opponent);
        const games = safeNumber(record?.games);
        if (games !== null && games > 0) values.push(games);
      });
    } else {
      Object.values(roleMap).forEach((matchupMap) => {
        Object.values(matchupMap || {}).forEach((rawValues) => {
          const games = safeNumber(objectFromColumns(rawValues)?.n_matches);
          if (games !== null && games > 0) values.push(games);
        });
      });
    }
    return values.sort((a, b) => a - b);
  }

  function adaptiveThresholdPresets(mode = state.mode) {
    const values = thresholdSampleSizes(mode);
    const fallback = mode === 'counter' ? [10, 25, 50, 100] : [100, 250, 500, 1000];
    if (!values.length) {
      return {
        values: fallback.map((value, index) => ({ value, coverage: null, label: ['Inclusiva', 'Consigliata', 'Solida', 'Rigorosa'][index], recommended: index === 1 })),
        recommended: fallback[1],
        sampleCount: 0
      };
    }

    const targets = [
      { q: 0.10, label: 'Inclusiva' },
      { q: 0.25, label: 'Consigliata', recommended: true },
      { q: 0.50, label: 'Solida' },
      { q: 0.75, label: 'Rigorosa' }
    ];
    const maxValue = values[values.length - 1];
    const median = quantile(values, 0.5) ?? maxValue;
    const desired = targets.map((target) => Math.min(maxValue, niceThreshold(quantile(values, target.q), mode)));
    const candidatePool = [
      ...desired,
      ...[0.05, 0.15, 0.20, 0.30, 0.40, 0.60, 0.70, 0.80, 0.90, 0.95].map((q) => niceThreshold(quantile(values, q), mode)),
      ...[0.25, 0.5, 0.75, 1, 1.25].map((factor) => niceThreshold(median * factor, mode)),
      niceThreshold(values[0], mode),
      niceThreshold(maxValue, mode)
    ].filter((value) => value > 0 && value <= maxValue);

    const selected = [];
    targets.forEach((target, index) => {
      const wanted = desired[index];
      const available = candidatePool
        .filter((candidate) => !selected.includes(candidate))
        .sort((a, b) => Math.abs(a - wanted) - Math.abs(b - wanted) || a - b);
      if (available.length) selected.push(available[0]);
    });
    candidatePool.sort((a, b) => a - b).forEach((candidate) => {
      if (selected.length < 4 && !selected.includes(candidate)) selected.push(candidate);
    });

    const sorted = Array.from(new Set(selected)).sort((a, b) => a - b).slice(0, 4);
    const recommendedRaw = desired[1];
    const recommended = sorted.reduce((best, candidate) => Math.abs(candidate - recommendedRaw) < Math.abs(best - recommendedRaw) ? candidate : best, sorted[0]);
    const recommendedIndex = sorted.indexOf(recommended);
    return {
      values: sorted.map((value, index) => {
        let label;
        if (index === recommendedIndex) label = 'Consigliata';
        else if (index < recommendedIndex) label = index === 0 ? 'Inclusiva' : 'Ampia';
        else if (index === recommendedIndex + 1) label = 'Solida';
        else label = 'Rigorosa';
        return {
          value,
          label,
          recommended: value === recommended,
          coverage: values.filter((sample) => sample >= value).length / values.length
        };
      }),
      recommended,
      sampleCount: values.length
    };
  }

  function syncThresholdContext(force = false) {
    const mode = state.mode;
    const key = thresholdContextKey(mode);
    const presets = adaptiveThresholdPresets(mode);
    if (force || state.thresholdContextKeys[mode] !== key || safeNumber(state.thresholds[mode]) === null) {
      state.thresholdContextKeys[mode] = key;
      writeSetting(mode === 'counter' ? 'rankingsCounterThresholdContext' : 'rankingsRoleThresholdContext', key);
      setActiveThreshold(presets.recommended);
    }
    return presets;
  }

  function wilsonLevel() {
    return WILSON_LEVELS[state.wilsonConfidence] || WILSON_LEVELS[DEFAULT_WILSON_CONFIDENCE];
  }

  function counterSortDescription(key = state.counterSort) {
    if (key === 'wilson') {
      const level = wilsonLevel();
      return `Limite inferiore Wilson al ${level.label}: ${level.description}`;
    }
    return COUNTER_SORTS[key]?.description || '';
  }

  function countCanonicalMatchups() {
    const fromMeta = safeNumber(DATA?.meta?.total_matchups ?? DATA?.meta?.total_canonical_matchups);
    if (fromMeta !== null) return fromMeta;
    let count = 0;
    Object.values(DATA?.matchups || {}).forEach((roleMap) => {
      Object.values(roleMap || {}).forEach((opponents) => { count += Object.keys(opponents || {}).length; });
    });
    return count;
  }

  function availableMetrics(role) {
    const profiles = Object.values(profilesForRole(role));
    return METRICS.filter((metric) => profiles.some((profile) => safeNumber(profile?.[metric.key]) !== null));
  }

  function metricByKey(key) {
    return METRICS.find((metric) => metric.key === key) || METRICS[0];
  }

  function profileValue(profile, metric) {
    return safeNumber(profile?.[metric.key]);
  }

  function confidence(games) {
    const n = safeNumber(games) ?? 0;
    const threshold = activeThreshold();
    if (n < threshold) return { level: 'low', label: 'Sotto soglia' };
    if (n < Math.max(threshold * 3, state.mode === 'counter' ? 100 : 300)) return { level: 'mid', label: 'Campione discreto' };
    return { level: 'high', label: 'Campione solido' };
  }

  function wilsonLowerBound(rate, games, confidence = state.wilsonConfidence) {
    const p = safeNumber(rate);
    const n = safeNumber(games);
    if (p === null || n === null || n <= 0) return null;
    const z = WILSON_LEVELS[confidence]?.z ?? WILSON_LEVELS[DEFAULT_WILSON_CONFIDENCE].z;
    const z2 = z * z;
    const denominator = 1 + z2 / n;
    const centre = p + z2 / (2 * n);
    const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
    return clamp((centre - margin) / denominator, 0, 1);
  }

  function objectFromColumns(values) {
    if (!values) return null;
    if (!Array.isArray(values) && typeof values === 'object') return { ...values };
    if (!Array.isArray(DATA?.matchupColumns) || !Array.isArray(values)) return null;
    const output = {};
    DATA.matchupColumns.forEach((column, index) => { output[column] = values[index]; });
    return output;
  }

  function getCounterRecord(role, selectedChampion, opponent) {
    const roleMap = DATA?.matchups?.[role] || {};
    const opponentFirst = objectFromColumns(roleMap?.[opponent]?.[selectedChampion]);
    const selectedFirst = objectFromColumns(roleMap?.[selectedChampion]?.[opponent]);
    let raw = null;
    let side = null;
    let targetSide = null;
    let orientation = null;

    if (opponentFirst) {
      raw = opponentFirst;
      side = 'a';
      targetSide = 'b';
      orientation = 'direct';
    } else if (selectedFirst) {
      raw = selectedFirst;
      side = 'b';
      targetSide = 'a';
      orientation = 'reverse';
    }
    if (!raw) return null;

    const oppositeWinrate = safeNumber(raw[`winrate_${targetSide}`]);
    const sideWinrate = safeNumber(raw[`winrate_${side}`]);
    const winrate = sideWinrate ?? (oppositeWinrate === null ? null : 1 - oppositeWinrate);
    const targetWinrate = oppositeWinrate ?? (winrate === null ? null : 1 - winrate);
    const generalWinrate = safeNumber(raw[`general_winrate_${side}`])
      ?? safeNumber(profilesForRole(role)?.[opponent]?.general_winrate);
    const diff = safeNumber(raw[`diff_winrate_${side}`])
      ?? (winrate !== null && generalWinrate !== null ? winrate - generalWinrate : null);
    const games = safeNumber(raw.n_matches);

    return {
      champion: opponent,
      selectedChampion,
      role,
      orientation,
      winrate,
      targetWinrate,
      generalWinrate,
      diff,
      games,
      wilson: wilsonLowerBound(winrate, games),
      lowSampleExport: Boolean(raw.low_sample),
      profileGames: safeNumber(profilesForRole(role)?.[opponent]?.coverage?.total_games),
      profileMatchups: safeNumber(profilesForRole(role)?.[opponent]?.coverage?.n_matchups)
    };
  }

  function buildRoleRows() {
    const metric = metricByKey(state.metric);
    const rows = Object.entries(profilesForRole(state.role)).map(([champion, profile]) => ({
      champion,
      value: profileValue(profile, metric),
      generalWinrate: safeNumber(profile?.general_winrate),
      games: safeNumber(profile?.coverage?.total_games),
      matchups: safeNumber(profile?.coverage?.n_matchups),
      percentile: safeNumber(profile?.percentiles?.[metric.key])
    })).filter((row) => row.value !== null);

    rows.sort((a, b) => {
      const delta = metric.higherIsBetter ? b.value - a.value : a.value - b.value;
      return delta || (b.games ?? -1) - (a.games ?? -1) || localeSort(a.champion, b.champion);
    });
    rows.forEach((row, index) => { row.absoluteRank = index + 1; });
    return rows;
  }

  function buildCounterRows() {
    if (!state.counterChampion) return [];
    const opponents = new Set();
    const roleMap = DATA?.matchups?.[state.role] || {};
    Object.keys(roleMap?.[state.counterChampion] || {}).forEach((name) => opponents.add(name));
    Object.entries(roleMap).forEach(([name, values]) => {
      if (values && values[state.counterChampion]) opponents.add(name);
    });

    const rows = Array.from(opponents)
      .filter((name) => name !== state.counterChampion)
      .map((name) => getCounterRecord(state.role, state.counterChampion, name))
      .filter((row) => row && row.winrate !== null);

    const sort = COUNTER_SORTS[state.counterSort] || COUNTER_SORTS.winrate;
    rows.sort((a, b) => {
      const av = sort.value(a);
      const bv = sort.value(b);
      if (av === null && bv === null) return localeSort(a.champion, b.champion);
      if (av === null) return 1;
      if (bv === null) return -1;
      const delta = sort.higherIsBetter ? bv - av : av - bv;
      return delta || (b.games ?? -1) - (a.games ?? -1) || localeSort(a.champion, b.champion);
    });
    rows.forEach((row, index) => { row.absoluteRank = index + 1; });
    return rows;
  }

  function visibleRows(rows) {
    const query = state.query.trim().toLocaleLowerCase('it');
    return rows.filter((row) => {
      if (!state.includeLowSample && (safeNumber(row.games) ?? 0) < activeThreshold()) return false;
      if (query && !row.champion.toLocaleLowerCase('it').includes(query)) return false;
      return true;
    });
  }

  function setDataStatus(type, text) {
    const element = byId('dataStatus');
    if (!element) return;
    element.className = `data-status-pill ${type || 'loading'}`;
    element.textContent = text;
  }

  function fail(message) {
    setDataStatus('error', 'Dati assenti');
    byId('rankingsOutput').hidden = true;
    const empty = byId('emptyState');
    empty.hidden = false;
    empty.innerHTML = `<h3>Dataset non disponibile</h3><p>${esc(message)}</p>`;
  }

  function renderMeta() {
    const totalMatchups = countCanonicalMatchups();
    byId('heroDatasetCount').textContent = integer(totalMatchups);
    byId('heroRoleCount').textContent = integer(roleOrder().length);
    byId('heroThreshold').textContent = integer(activeThreshold());
    byId('footerStats').textContent = `Rankings Lab · ${integer(totalMatchups)} matchup disponibili`;
  }

  function renderRolePills() {
    const container = byId('rolePills');
    container.innerHTML = roleOrder().map((role) => (
      `<button class="role-pill${role === state.role ? ' active' : ''}" type="button" data-role="${esc(role)}" aria-pressed="${role === state.role}">${esc(roleLabel(role))}</button>`
    )).join('');
  }

  function renderModeControls() {
    document.body.classList.toggle('mode-ranking', state.mode === 'role');
    document.body.classList.toggle('mode-counter', state.mode === 'counter');

    $$('.mode-btn').forEach((button) => {
      const active = button.dataset.mode === state.mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    byId('roleMetricField').hidden = state.mode !== 'role';
    byId('counterChampionField').hidden = state.mode !== 'counter';
    byId('counterSortField').hidden = state.mode !== 'counter';
    byId('wilsonField').hidden = state.mode !== 'counter';
    byId('thresholdContext').textContent = state.mode === 'role'
      ? 'partite complessive nel ruolo'
      : 'partite del singolo matchup';
  }

  function renderMetricOptions() {
    const available = availableMetrics(state.role);
    if (!available.some((metric) => metric.key === state.metric)) {
      state.metric = available[0]?.key || 'general_winrate';
    }
    byId('metricSelect').innerHTML = available.map((metric) => (
      `<option value="${esc(metric.key)}"${metric.key === state.metric ? ' selected' : ''}>${esc(metric.label)}</option>`
    )).join('');

    byId('counterSortSelect').innerHTML = Object.entries(COUNTER_SORTS).map(([key, sort]) => {
      const label = key === 'wilson' ? `${sort.label} (${wilsonLevel().label})` : sort.label;
      return `<option value="${esc(key)}"${key === state.counterSort ? ' selected' : ''}>${esc(label)}</option>`;
    }).join('');
  }

  function renderThresholdControls() {
    const presets = syncThresholdContext();
    const threshold = activeThreshold();
    const input = byId('thresholdInput');
    input.value = String(threshold);
    input.step = String(niceStep(quantile(thresholdSampleSizes(), 0.5) ?? threshold, state.mode));
    byId('includeLowSample').checked = state.includeLowSample;
    byId('thresholdPresets').innerHTML = presets.values.map((preset) => {
      const coverage = preset.coverage === null ? '' : `${Math.round(preset.coverage * 100)}% coperto`;
      const title = `${preset.label}: almeno ${integer(preset.value)} partite${coverage ? ` · ${coverage}` : ''}`;
      return `<button class="threshold-preset${preset.value === threshold ? ' active' : ''}${preset.recommended ? ' recommended' : ''}" type="button" data-value="${preset.value}" title="${esc(title)}"><strong>${integer(preset.value)}</strong><small>${esc(preset.label)}</small></button>`;
    }).join('');
    const contextName = state.mode === 'role' ? 'campioni del ruolo' : (state.counterChampion ? `matchup contro ${state.counterChampion}` : 'matchup del ruolo');
    byId('thresholdPresetMeta').textContent = presets.sampleCount
      ? `Preset calcolati su ${integer(presets.sampleCount)} ${contextName}. “Consigliata” mantiene in genere circa tre quarti dei risultati; Ranking e Counter conservano soglie indipendenti.`
      : 'Preset di riserva: il dataset non espone ancora campioni statistici utilizzabili per questo contesto.';
  }

  function renderWilsonControls() {
    const level = wilsonLevel();
    $$('.wilson-level').forEach((button) => {
      const active = Number(button.dataset.confidence) === state.wilsonConfidence;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    byId('wilsonCurrent').textContent = level.label;
    byId('wilsonDescription').textContent = level.description;
  }

  function renderChampionPicker() {
    const input = byId('counterChampionInput');
    input.value = state.counterChampion || '';
    renderChampionList('');
  }

  function renderChampionList(filter) {
    const list = byId('counterChampionList');
    const query = String(filter || '').trim().toLocaleLowerCase('it');
    const profiles = profilesForRole(state.role);
    const champions = championsForRole(state.role)
      .filter((name) => !query || name.toLocaleLowerCase('it').includes(query))
      .sort((a, b) => {
        const ag = safeNumber(profiles?.[a]?.coverage?.total_games) ?? 0;
        const bg = safeNumber(profiles?.[b]?.coverage?.total_games) ?? 0;
        return bg - ag || localeSort(a, b);
      });

    list.innerHTML = champions.length ? champions.map((name) => {
      const games = safeNumber(profiles?.[name]?.coverage?.total_games);
      return `<button class="counter-option" type="button" role="option" data-champion="${esc(name)}"><span>${esc(name)}</span><em>${integer(games)} partite</em></button>`;
    }).join('') : '<div class="counter-option-empty">Nessun campione trovato.</div>';
  }

  function openChampionPicker() {
    const list = byId('counterChampionList');
    list.classList.add('open');
    byId('counterChampionInput').setAttribute('aria-expanded', 'true');
  }

  function closeChampionPicker() {
    byId('counterChampionList').classList.remove('open');
    byId('counterChampionInput').setAttribute('aria-expanded', 'false');
  }

  function chooseCounterChampion(champion) {
    if (!championsForRole(state.role).includes(champion)) return;
    state.counterChampion = champion;
    byId('counterChampionInput').value = champion;
    closeChampionPicker();
    renderResults();
  }

  function rowTone(value, neutral = 0) {
    const n = safeNumber(value);
    if (n === null || Math.abs(n - neutral) < 0.00001) return 'neutral';
    return n > neutral ? 'positive' : 'negative';
  }

  function progressWidth(value, min, max, higherIsBetter = true) {
    if (value === null || max === min) return 50;
    let ratio = (value - min) / (max - min);
    if (!higherIsBetter) ratio = 1 - ratio;
    return clamp(ratio * 100, 4, 100);
  }

  function renderSummary(allRows, rows) {
    const metric = state.mode === 'role' ? metricByKey(state.metric) : COUNTER_SORTS[state.counterSort];
    const values = allRows.map((row) => state.mode === 'role' ? row.value : metric.value(row)).filter((value) => value !== null).sort((a, b) => a - b);
    const median = values.length ? values[Math.floor(values.length / 2)] : null;
    const reliable = allRows.filter((row) => (safeNumber(row.games) ?? 0) >= activeThreshold()).length;
    const low = allRows.length - reliable;

    byId('summaryTitle').textContent = state.mode === 'role'
      ? `${metric.label} · ${roleLabel(state.role)}`
      : state.counterChampion ? `Counter di ${state.counterChampion} · ${roleLabel(state.role)}` : `Scegli un campione · ${roleLabel(state.role)}`;
    byId('summaryCopy').textContent = state.mode === 'role'
      ? metric.description
      : counterSortDescription();
    byId('summaryTotal').textContent = integer(allRows.length);
    byId('summaryReliable').textContent = integer(reliable);
    byId('summaryLow').textContent = integer(low);
    byId('summaryMedian').textContent = median === null ? '—' : metric.format(median);
    byId('visibleCount').textContent = `${integer(rows.length)} righe visibili`;
  }

  function podiumCard(row, position, metric) {
    const low = (safeNumber(row.games) ?? 0) < activeThreshold();
    const value = state.mode === 'role' ? row.value : metric.value(row);
    const detail = state.mode === 'role'
      ? `${integer(row.games)} partite · ${integer(row.matchups)} matchup`
      : `${integer(row.games)} partite · ${signedPct(row.diff, 1)} vs WR abituale`;
    return `<article class="podium-card position-${position}${low ? ' low-sample' : ''}">
      <div class="podium-rank">${position}</div>
      <div class="podium-copy"><span>${esc(row.champion)}</span><strong>${metric.format(value)}</strong><em>${esc(detail)}</em></div>
      ${low ? '<span class="sample-badge low">Sotto soglia</span>' : '<span class="sample-badge high">Affidabile</span>'}
    </article>`;
  }

  function renderPodium(rows) {
    const metric = state.mode === 'role' ? metricByKey(state.metric) : COUNTER_SORTS[state.counterSort];
    const top = rows.slice(0, 3);
    byId('podium').innerHTML = top.length
      ? top.map((row, index) => podiumCard(row, index + 1, metric)).join('')
      : '<div class="empty-inline">Nessun risultato disponibile con i filtri correnti.</div>';
  }

  function roleTable(rows, allRows) {
    const metric = metricByKey(state.metric);
    const values = allRows.map((row) => row.value).filter((value) => value !== null);
    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 1;

    const body = rows.map((row) => {
      const conf = confidence(row.games);
      const low = conf.level === 'low';
      const width = progressWidth(row.value, min, max, metric.higherIsBetter);
      const deepLink = `./visual.html?role=${encodeURIComponent(state.role)}&a=${encodeURIComponent(row.champion)}`;
      return `<tr class="ranking-row${low ? ' low-sample' : ''}">
        <td class="rank-cell"><span>${integer(row.absoluteRank)}</span></td>
        <td class="champion-cell"><strong>${esc(row.champion)}</strong><em>${pct(row.generalWinrate, 1)} WR generale</em></td>
        <td class="metric-cell">
          <div class="metric-line"><strong>${metric.format(row.value)}</strong>${row.percentile !== null ? `<span>p${integer(row.percentile)}</span>` : ''}</div>
          <div class="metric-track" aria-hidden="true"><i style="width:${width.toFixed(1)}%"></i></div>
        </td>
        <td>${integer(row.games)}</td>
        <td>${integer(row.matchups)}</td>
        <td><span class="confidence-pill ${conf.level}">${esc(conf.label)}</span></td>
        <td class="action-cell"><a class="table-action" href="${deepLink}">Apri 1v1</a></td>
      </tr>`;
    }).join('');

    return `<div class="table-scroll"><table class="ranking-table">
      <caption class="visually-hidden">Classifica dei campioni ${esc(roleLabel(state.role))} per ${esc(metric.label)}</caption>
      <thead><tr><th>#</th><th>Campione</th><th>${esc(metric.label)}</th><th>Partite</th><th>Matchup</th><th>Affidabilità</th><th></th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>`;
  }

  function counterTable(rows, allRows) {
    const sort = COUNTER_SORTS[state.counterSort] || COUNTER_SORTS.winrate;
    const values = allRows.map((row) => row.winrate).filter((value) => value !== null);
    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 1;

    const body = rows.map((row) => {
      const conf = confidence(row.games);
      const low = conf.level === 'low';
      const width = progressWidth(row.winrate, min, max, true);
      const deepLink = `./visual.html?role=${encodeURIComponent(state.role)}&a=${encodeURIComponent(row.champion)}&b=${encodeURIComponent(state.counterChampion)}`;
      return `<tr class="ranking-row${low ? ' low-sample' : ''}">
        <td class="rank-cell"><span>${integer(row.absoluteRank)}</span></td>
        <td class="champion-cell"><strong>${esc(row.champion)}</strong><em>contro ${esc(state.counterChampion)}</em></td>
        <td class="metric-cell">
          <div class="metric-line"><strong>${pct(row.winrate, 1)}</strong><span>${row.targetWinrate === null ? '' : `${pct(row.targetWinrate, 1)} al bersaglio`}</span></div>
          <div class="metric-track" aria-hidden="true"><i style="width:${width.toFixed(1)}%"></i></div>
        </td>
        <td class="wilson-cell"><strong>${pct(row.wilson, 1)}</strong><small>${state.wilsonConfidence}% prudenziale</small></td>
        <td class="signed-cell ${rowTone(row.diff)}">${signedPct(row.diff, 1)}</td>
        <td>${pct(row.generalWinrate, 1)}</td>
        <td>${integer(row.games)}</td>
        <td><span class="confidence-pill ${conf.level}">${esc(conf.label)}</span></td>
        <td class="action-cell"><a class="table-action" href="${deepLink}">Analizza</a></td>
      </tr>`;
    }).join('');

    return `<div class="table-scroll"><table class="ranking-table counter-table">
      <caption class="visually-hidden">Counter di ${esc(state.counterChampion)} nel ruolo ${esc(roleLabel(state.role))}</caption>
      <thead><tr><th>#</th><th>Counter</th><th>WR matchup</th><th>Wilson ${state.wilsonConfidence}%</th><th>Diff WR</th><th>WR abituale</th><th>Partite</th><th>Affidabilità</th><th></th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>`;
  }

  function renderMethodNote(allRows) {
    const note = byId('methodNote');
    if (state.mode === 'role') {
      const metric = metricByKey(state.metric);
      note.innerHTML = `<strong>Come leggere la classifica:</strong> il valore principale è <b>${esc(metric.label)}</b>. Le righe sotto ${integer(activeThreshold())} partite complessive nel ruolo vengono attenuate e marcate; i preset sono ricavati dalla distribuzione reale del ruolo corrente.`;
    } else if (state.counterChampion) {
      const level = wilsonLevel();
      note.innerHTML = `<strong>Che cosa significa “counter” qui:</strong> ogni riga mostra il rendimento contro <b>${esc(state.counterChampion)}</b>. I risultati sotto ${integer(activeThreshold())} partite del singolo matchup sono attenuati. Il Wilson ${esc(level.label)} è il limite prudenziale del WR: più il campione statistico è piccolo, più il valore viene ridotto.`;
    } else {
      note.innerHTML = '<strong>Seleziona un campione:</strong> la pagina cercherà tutte le righe matchup dirette o inverse disponibili nel dataset, senza inventare avversari mancanti.';
    }
    const exportedLow = allRows.filter((row) => row.lowSampleExport).length;
    byId('datasetWarnings').textContent = exportedLow ? `${integer(exportedLow)} righe risultano già marcate low_sample dal dataset.` : '';
  }

  function renderResults() {
    renderThresholdControls();
    renderWilsonControls();
    const allRows = state.mode === 'role' ? buildRoleRows() : buildCounterRows();
    const rows = visibleRows(allRows);
    const output = byId('rankingsOutput');
    const empty = byId('emptyState');

    renderSummary(allRows, rows);
    renderPodium(rows);
    renderMethodNote(allRows);
    renderMeta();

    if (state.mode === 'counter' && !state.counterChampion) {
      output.hidden = true;
      empty.hidden = false;
      empty.innerHTML = '<h3>Scegli il campione da contrastare</h3><p>La classifica mostrerà tutti gli avversari coperti dal dataset, ordinati per win rate o per differenza rispetto al loro rendimento abituale.</p>';
      return;
    }

    if (!allRows.length) {
      output.hidden = true;
      empty.hidden = false;
      empty.innerHTML = '<h3>Nessun dato disponibile</h3><p>Il dataset non contiene valori utilizzabili per questa combinazione di ruolo, metrica e campione.</p>';
      return;
    }

    output.hidden = false;
    empty.hidden = true;
    byId('rankingTableHost').innerHTML = rows.length
      ? (state.mode === 'role' ? roleTable(rows, allRows) : counterTable(rows, allRows))
      : '<div class="empty-inline">Nessuna riga soddisfa la ricerca o il filtro di affidabilità.</div>';
  }

  function csvEscape(value) {
    const text = String(value ?? '');
    return /[;"\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }

  function exportCsv() {
    const allRows = state.mode === 'role' ? buildRoleRows() : buildCounterRows();
    const rows = visibleRows(allRows);
    if (!rows.length) return;

    let header;
    let lines;
    if (state.mode === 'role') {
      const metric = metricByKey(state.metric);
      header = ['rank', 'role', 'champion', metric.key, 'general_winrate', 'total_games', 'n_matchups', 'below_threshold'];
      lines = rows.map((row) => [row.absoluteRank, state.role, row.champion, row.value, row.generalWinrate, row.games, row.matchups, (row.games ?? 0) < activeThreshold()]);
    } else {
      header = ['rank', 'role', 'selected_champion', 'counter', 'matchup_winrate', 'winrate_diff', 'general_winrate', 'n_matches', `wilson_lower_${state.wilsonConfidence}`, 'below_threshold'];
      lines = rows.map((row) => [row.absoluteRank, state.role, state.counterChampion, row.champion, row.winrate, row.diff, row.generalWinrate, row.games, row.wilson, (row.games ?? 0) < activeThreshold()]);
    }

    const csv = [header, ...lines].map((line) => line.map(csvEscape).join(';')).join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = state.mode === 'role'
      ? `ranking_${state.role}_${state.metric}.csv`
      : `counter_${state.role}_${state.counterChampion}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function setRole(role) {
    if (!roleOrder().includes(role)) return;
    state.role = role;
    state.counterChampion = null;
    const available = availableMetrics(role);
    if (!available.some((metric) => metric.key === state.metric)) state.metric = available[0]?.key || 'general_winrate';
    renderRolePills();
    renderMetricOptions();
    renderChampionPicker();
    renderResults();
  }

  function syncTopbarHeight() {
    const topbar = $('.topbar');
    if (!topbar) return;
    const apply = () => document.documentElement.style.setProperty('--topbar-height', `${Math.ceil(topbar.getBoundingClientRect().height || 72)}px`);
    apply();
    window.addEventListener('resize', apply, { passive: true });
    if (window.ResizeObserver) new ResizeObserver(apply).observe(topbar);
  }

  function bindEvents() {
    byId('rolePills').addEventListener('click', (event) => {
      const button = event.target.closest('[data-role]');
      if (button) setRole(button.dataset.role);
    });

    $$('.mode-btn').forEach((button) => button.addEventListener('click', () => {
      state.mode = button.dataset.mode;
      state.query = '';
      byId('tableSearch').value = '';
      renderModeControls();
      renderResults();
      if (state.mode === 'counter' && !state.counterChampion) byId('counterChampionInput').focus();
    }));

    byId('metricSelect').addEventListener('change', (event) => {
      state.metric = event.target.value;
      renderResults();
    });

    byId('counterSortSelect').addEventListener('change', (event) => {
      state.counterSort = event.target.value;
      renderResults();
    });

    byId('thresholdInput').addEventListener('change', (event) => {
      setActiveThreshold(safeNumber(event.target.value) ?? activeThreshold());
      renderResults();
    });

    byId('thresholdPresets').addEventListener('click', (event) => {
      const button = event.target.closest('.threshold-preset');
      if (!button) return;
      setActiveThreshold(Number(button.dataset.value));
      renderResults();
    });

    byId('wilsonLevels').addEventListener('click', (event) => {
      const button = event.target.closest('.wilson-level');
      if (!button) return;
      const confidence = Number(button.dataset.confidence);
      if (!WILSON_LEVELS[confidence]) return;
      state.wilsonConfidence = confidence;
      writeSetting('rankingsWilsonConfidence', confidence);
      renderMetricOptions();
      renderResults();
    });

    byId('includeLowSample').addEventListener('change', (event) => {
      state.includeLowSample = event.target.checked;
      writeSetting('rankingsIncludeLowSample', state.includeLowSample);
      renderResults();
    });

    byId('tableSearch').addEventListener('input', (event) => {
      state.query = event.target.value;
      renderResults();
    });

    byId('counterChampionInput').addEventListener('focus', (event) => {
      renderChampionList(event.target.value);
      openChampionPicker();
    });
    byId('counterChampionInput').addEventListener('click', (event) => {
      renderChampionList(event.target.value);
      openChampionPicker();
    });
    byId('counterChampionInput').addEventListener('input', (event) => {
      state.counterChampion = null;
      renderChampionList(event.target.value);
      openChampionPicker();
      renderResults();
    });
    byId('counterChampionInput').addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeChampionPicker();
      if (event.key === 'Enter') {
        const first = $('.counter-option', byId('counterChampionList'));
        if (first) {
          event.preventDefault();
          chooseCounterChampion(first.dataset.champion);
        }
      }
    });
    byId('counterChampionList').addEventListener('mousedown', (event) => {
      const option = event.target.closest('.counter-option');
      if (!option) return;
      event.preventDefault();
      chooseCounterChampion(option.dataset.champion);
    });
    document.addEventListener('click', (event) => {
      if (!event.target.closest('.counter-combobox')) closeChampionPicker();
    });

    byId('exportCsvBtn')?.addEventListener('click', exportCsv);
    byId('resetFiltersBtn').addEventListener('click', () => {
      state.thresholds.role = null;
      state.thresholds.counter = null;
      state.thresholdContextKeys.role = null;
      state.thresholdContextKeys.counter = null;
      state.includeLowSample = true;
      state.wilsonConfidence = DEFAULT_WILSON_CONFIDENCE;
      state.query = '';
      removeSetting('rankingsThreshold');
      removeSetting('rankingsRoleThreshold');
      removeSetting('rankingsCounterThreshold');
      removeSetting('rankingsRoleThresholdContext');
      removeSetting('rankingsCounterThresholdContext');
      writeSetting('rankingsWilsonConfidence', state.wilsonConfidence);
      writeSetting('rankingsIncludeLowSample', state.includeLowSample);
      byId('tableSearch').value = '';
      renderMetricOptions();
      renderResults();
    });
  }

  function applyUrlState() {
    const params = new URLSearchParams(window.location.search);
    const role = String(params.get('role') || '').toUpperCase();
    const mode = params.get('mode');
    const champion = params.get('champion');
    if (roleOrder().includes(role)) state.role = role;
    if (mode === 'counter' || mode === 'role') state.mode = mode;
    if (champion && championsForRole(state.role).includes(champion)) state.counterChampion = champion;
  }

  function init() {
    syncTopbarHeight();
    if (!DATA || !DATA.matchups || !DATA.matchupColumns || !DATA.championProfiles) {
      fail('Controlla che matchup_data.js sia nella stessa cartella e venga caricato prima di rankings.js.');
      return;
    }

    state.role = roleOrder()[0] || 'TOP';
    applyUrlState();
    setDataStatus('ready', 'Dataset pronto');
    renderRolePills();
    renderModeControls();
    renderMetricOptions();
    renderThresholdControls();
    renderChampionPicker();
    renderMeta();
    bindEvents();
    renderResults();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();