(() => {
  'use strict';

  const DATA = window.MATCHUP_APP_DATA;

  const ROLE_ORDER_FALLBACK = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
  const ROLE_LABELS_FALLBACK = {
    TOP: 'Top',
    JUNGLE: 'Jungle',
    MIDDLE: 'Mid',
    BOTTOM: 'BOT',
    UTILITY: 'Support'
  };

  // Display labels intentionally differ from the raw dataset keys.
  // Keep role keys unchanged internally: TOP, JUNGLE, MIDDLE, BOTTOM, UTILITY.
  const ROLE_DISPLAY_LABELS = {
    TOP: 'Top',
    JUNGLE: 'Jungle',
    MIDDLE: 'Mid',
    BOTTOM: 'BOT',
    UTILITY: 'Support'
  };

  const OBJECTIVE_KEYS = ['dragon', 'riftherald', 'baron', 'baron_nashor', 'horde'];
  const REFERENCE_MINUTE = 15;

  const SWAP_BASES = [
    'winrate',
    'general_winrate',
    'diff_winrate',
    'pct_physical_dmg',
    'pct_magic_dmg',
    'pct_true_dmg',
    'avg_damage_to_champs',
    'avg_damage_taken',
    'avg_time_ccing_others',
    'avg_total_time_cc_dealt',
    'vision_score',
    'goldxp_n_matches',
    'goldxp_winpct_per_1k_gold',
    'goldxp_winpct_per_1k_xp',
    'goldxp_auc',
    'goldxp_auc_is_cv',
    'avg_level6_minute'
  ];

  const SIGNED_ARRAY_FIELDS = [
    'gold_diff_by_minute',
    'xp_diff_by_minute',
    'excess_gold_diff_by_minute',
    'excess_xp_diff_by_minute'
  ];

  const SIGNED_FIELDS = [
    'vision_diff_a_minus_b',
    'goldxp_gold_dependency_diff_a_minus_b',
    'goldxp_xp_dependency_diff_a_minus_b',
    'avg_tower_fall_diff_min_a_minus_b',
    'tower_fall_diff_min_a_minus_b'
  ];

  const TIMELINE_MODES = {
    gold: {
      label: 'Oro',
      field: 'gold_diff_by_minute',
      at15: 'gold15',
      suffix: ' oro',
      note: 'Differenziale oro aggregato: valori positivi favoriscono Team 1, valori negativi favoriscono Team 2.'
    },
    xp: {
      label: 'XP',
      field: 'xp_diff_by_minute',
      at15: 'xp15',
      suffix: ' XP',
      note: 'Differenziale esperienza aggregato sulle corsie con matchup diretto disponibile.'
    },
    excessGold: {
      label: 'Excess oro',
      field: 'excess_gold_diff_by_minute',
      at15: 'excessGold15',
      suffix: ' oro',
      note: 'Excess oro: vantaggio specifico dei matchup, al netto della baseline generale dei campioni.'
    },
    excessXp: {
      label: 'Excess XP',
      field: 'excess_xp_diff_by_minute',
      at15: 'excessXp15',
      suffix: ' XP',
      note: 'Excess XP: differenziale esperienza che supera o manca le aspettative di baseline.'
    }
  };

  const state = {
    team1: {},
    team2: {},
    timelineMode: 'gold',
    lastAnalysis: null,
    comboControllers: []
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const byId = (id) => document.getElementById(id);

  function esc(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function safeNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function isFiniteNumber(value) {
    return safeNumber(value) !== null;
  }

  function clamp(value, min, max) {
    const n = safeNumber(value);
    if (n === null) return null;
    return Math.max(min, Math.min(max, n));
  }

  function diffNullable(a, b) {
    const x = safeNumber(a);
    const y = safeNumber(b);
    return x === null || y === null ? null : x - y;
  }

  function average(values) {
    const nums = values.map(safeNumber).filter((v) => v !== null);
    if (!nums.length) return null;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
  }

  function sum(values) {
    const nums = values.map(safeNumber).filter((v) => v !== null);
    if (!nums.length) return null;
    return nums.reduce((a, b) => a + b, 0);
  }

  function pct(value, digits = 1) {
    const n = safeNumber(value);
    return n === null ? '—' : `${(n * 100).toFixed(digits)}%`;
  }

  function intFmt(value, suffix = '') {
    const n = safeNumber(value);
    if (n === null) return '—';
    const rounded = Math.round(n);
    return `${rounded > 0 ? '+' : ''}${rounded.toLocaleString('it-IT')}${suffix}`;
  }

  function signedDecimal(value, digits = 2) {
    const n = safeNumber(value);
    if (n === null) return '—';
    return `${n > 0 ? '+' : ''}${n.toFixed(digits)}`;
  }

  function signedPct(value, digits = 1) {
    const n = safeNumber(value);
    if (n === null) return '—';
    return `${n > 0 ? '+' : ''}${(n * 100).toFixed(digits)}pp`;
  }

  function minutesFmt(value) {
    const n = safeNumber(value);
    if (n === null) return '—';
    return `${n > 0 ? '+' : ''}${n.toFixed(2)} min`;
  }

  function toneClass(value, inverse = false, threshold = 0) {
    const n = safeNumber(value);
    if (n === null || Math.abs(n) <= threshold) return '';
    const teamOneGood = inverse ? n < 0 : n > 0;
    return teamOneGood ? 'team-a' : 'team-b';
  }

  function teamNameFromValue(value, inverse = false, threshold = 0) {
    const n = safeNumber(value);
    if (n === null || Math.abs(n) <= threshold) return 'Equilibrio';
    const t1 = inverse ? n < 0 : n > 0;
    return t1 ? 'Team 1' : 'Team 2';
  }

  function negate(value) {
    const n = safeNumber(value);
    return n === null ? null : -n;
  }

  function negateArray(arr) {
    return Array.isArray(arr) ? arr.map((v) => negate(v)) : [];
  }

  function invertPct(value) {
    const n = safeNumber(value);
    return n === null ? null : 1 - n;
  }

  function objectFromColumns(columns, values) {
    if (!values) return null;
    if (!Array.isArray(values) && typeof values === 'object') return { ...values };
    if (!Array.isArray(columns) || !Array.isArray(values)) return null;
    const out = {};
    columns.forEach((col, index) => {
      out[col] = values[index];
    });
    return out;
  }

  function roleOrder() {
    const fromMeta = DATA?.meta?.roles || DATA?.meta?.role_order || DATA?.roleOrder;
    const roles = Array.isArray(fromMeta) && fromMeta.length ? fromMeta : ROLE_ORDER_FALLBACK;
    return ROLE_ORDER_FALLBACK.filter((r) => roles.includes(r)).concat(roles.filter((r) => !ROLE_ORDER_FALLBACK.includes(r)));
  }

  function roleLabel(role) {
    return ROLE_DISPLAY_LABELS[role]
      || DATA?.meta?.role_labels?.[role]
      || DATA?.roleLabels?.[role]
      || ROLE_LABELS_FALLBACK[role]
      || role;
  }

  function roleOptionCount(role) {
    return championsForRole(role).length;
  }

  function matchupsForRole(role) {
    return DATA?.matchups?.[role] || {};
  }

  function championsForRole(role) {
    const fromMeta = DATA?.meta?.roles_champions?.[role]
      || DATA?.meta?.rolesChampions?.[role]
      || DATA?.championsByRole?.[role];
    if (Array.isArray(fromMeta) && fromMeta.length) return [...fromMeta].sort(localeSort);

    const names = new Set();
    Object.keys(DATA?.championProfiles?.[role] || {}).forEach((name) => names.add(name));
    Object.keys(matchupsForRole(role)).forEach((name) => {
      names.add(name);
      Object.keys(matchupsForRole(role)[name] || {}).forEach((opp) => names.add(opp));
    });
    return Array.from(names).sort(localeSort);
  }

  function localeSort(a, b) {
    return String(a).localeCompare(String(b), 'it', { sensitivity: 'base' });
  }

  function getChampionProfile(role, champion) {
    if (!role || !champion) return null;
    const profile = DATA?.championProfiles?.[role]?.[champion];
    return profile ? { ...profile } : null;
  }

  function getMatchupRaw(role, championA, championB) {
    const values = DATA?.matchups?.[role]?.[championA]?.[championB];
    return objectFromColumns(DATA?.matchupColumns, values);
  }

  function swapAB(out, raw, base) {
    const aKey = `${base}_a`;
    const bKey = `${base}_b`;
    if (aKey in raw || bKey in raw) {
      out[aKey] = raw[bKey] ?? null;
      out[bKey] = raw[aKey] ?? null;
    }
  }

  function orientMatchup(raw, direction, role, team1Champion, team2Champion) {
    const direct = direction === 'direct';
    const out = { ...raw };

    out.role = role;
    out.team1Champion = team1Champion;
    out.team2Champion = team2Champion;
    out.data_status = 'exact';
    out.orientation = direction;
    out.team1Profile = getChampionProfile(role, team1Champion);
    out.team2Profile = getChampionProfile(role, team2Champion);

    if (direct) return out;

    for (const base of SWAP_BASES) swapAB(out, raw, base);

    for (const field of SIGNED_ARRAY_FIELDS) {
      out[field] = negateArray(raw[field]);
    }

    for (const field of SIGNED_FIELDS) {
      out[field] = negate(raw[field]);
    }

    Object.keys(raw).forEach((key) => {
      if (key.startsWith('pct_champion_a_first_')) {
        out[key] = invertPct(raw[key]);
      }
    });

    if ('pct_champion_a_wins_tower_race' in raw) {
      out.pct_champion_a_wins_tower_race = invertPct(raw.pct_champion_a_wins_tower_race);
    }

    if ('pct_a_ahead_15m' in raw) {
      out.pct_a_ahead_15m = invertPct(raw.pct_a_ahead_15m);
    }

    if ('winrate_a_when_ahead_15m' in raw || 'winrate_a_when_behind_15m' in raw) {
      out.winrate_a_when_ahead_15m = invertPct(raw.winrate_a_when_behind_15m);
      out.winrate_a_when_behind_15m = invertPct(raw.winrate_a_when_ahead_15m);
    }

    return out;
  }

  function getOrientedMatchup(role, team1Champion, team2Champion) {
    if (!role || !team1Champion || !team2Champion) {
      return {
        role,
        team1Champion,
        team2Champion,
        data_status: 'missing',
        reason: 'incomplete_input'
      };
    }

    if (team1Champion === team2Champion) {
      const profile = getChampionProfile(role, team1Champion);
      return {
        role,
        team1Champion,
        team2Champion,
        team1Profile: profile,
        team2Profile: profile,
        data_status: 'missing',
        reason: 'same_champion'
      };
    }

    const direct = getMatchupRaw(role, team1Champion, team2Champion);
    if (direct) return orientMatchup(direct, 'direct', role, team1Champion, team2Champion);

    const reverse = getMatchupRaw(role, team2Champion, team1Champion);
    if (reverse) return orientMatchup(reverse, 'reverse', role, team1Champion, team2Champion);

    const team1Profile = getChampionProfile(role, team1Champion);
    const team2Profile = getChampionProfile(role, team2Champion);

    if (team1Profile && team2Profile) {
      return {
        role,
        team1Champion,
        team2Champion,
        team1Profile,
        team2Profile,
        data_status: 'fallback',
        n_matches: null,
        low_sample: false,
        winrate_a: team1Profile.general_winrate ?? null,
        winrate_b: team2Profile.general_winrate ?? null,
        general_winrate_a: team1Profile.general_winrate ?? null,
        general_winrate_b: team2Profile.general_winrate ?? null,
        diff_winrate_a: null,
        diff_winrate_b: null
      };
    }

    return {
      role,
      team1Champion,
      team2Champion,
      team1Profile,
      team2Profile,
      data_status: 'missing',
      reason: 'insufficient_data'
    };
  }

  function valueAtMinute(series, minutes, minute = REFERENCE_MINUTE) {
    if (!Array.isArray(series) || !series.length) return null;
    if (Array.isArray(minutes)) {
      const idx = minutes.map(Number).indexOf(minute);
      if (idx >= 0 && idx < series.length) return safeNumber(series[idx]);
    }
    if (minute >= 0 && minute < series.length) return safeNumber(series[minute]);
    return null;
  }

  function getMonsterPctKeys(lane) {
    return Object.keys(lane || {}).filter((key) => {
      if (!key.startsWith('pct_champion_a_first_')) return false;
      if (key === 'pct_champion_a_first_blood') return false;
      return isFiniteNumber(lane[key]);
    });
  }

  function objectiveEdgeForLane(lane) {
    if (!lane || lane.data_status !== 'exact') return null;
    const values = [];

    const firstBlood = safeNumber(lane.pct_champion_a_first_blood);
    if (firstBlood !== null) values.push(firstBlood - 0.5);

    if (lane.role === 'JUNGLE') {
      getMonsterPctKeys(lane).forEach((key) => {
        const n = safeNumber(lane[key]);
        if (n !== null) values.push(n - 0.5);
      });
    } else {
      const tower = safeNumber(lane.pct_champion_a_wins_tower_race);
      if (tower !== null) values.push(tower - 0.5);
    }

    return average(values);
  }

  function compactLaneStats(lane) {
    if (!lane) return lane;
    return {
      role: lane.role,
      team1Champion: lane.team1Champion,
      team2Champion: lane.team2Champion,
      data_status: lane.data_status,
      orientation: lane.orientation,
      n_matches: lane.n_matches ?? null,
      low_sample: !!lane.low_sample,
      winrate_a: lane.winrate_a ?? null,
      diff_winrate_a: lane.diff_winrate_a ?? null,
      gold15: valueAtMinute(lane.gold_diff_by_minute, lane.minutes),
      xp15: valueAtMinute(lane.xp_diff_by_minute, lane.minutes),
      excessGold15: valueAtMinute(lane.excess_gold_diff_by_minute, lane.minutes),
      snowball_corr_15m: lane.snowball_corr_15m ?? null,
      gold_diff_std_15m: lane.gold_diff_std_15m ?? null,
      reason: lane.reason ?? null
    };
  }

  function aggregateTimeline(lanes, field) {
    const map = new Map();
    let exactCount = 0;
    const missing = [];

    lanes.forEach((lane) => {
      if (lane.data_status !== 'exact') return;
      const series = lane[field];
      if (!Array.isArray(series) || !series.length) {
        missing.push(lane.role);
        return;
      }
      exactCount += 1;
      const minutes = Array.isArray(lane.minutes) ? lane.minutes : series.map((_, i) => i);
      series.forEach((value, index) => {
        const minute = Number(minutes[index] ?? index);
        const n = safeNumber(value);
        if (!Number.isFinite(minute) || n === null) return;
        map.set(minute, (map.get(minute) || 0) + n);
      });
    });

    const points = Array.from(map.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([minute, value]) => ({ minute, value }));

    return { points, exactCount, missing };
  }

  function profileValue(profile, field) {
    if (!profile) return null;
    if (profile.profile && field in profile.profile) return safeNumber(profile.profile[field]);
    return safeNumber(profile[field]);
  }

  function profilePercentile(profile, field, invert = false) {
    if (!profile?.percentiles) return null;
    const val = safeNumber(profile.percentiles[field]);
    if (val === null) return null;
    return invert ? 100 - val : val;
  }

  function buildTeamProfile(lanes, side) {
    const key = side === 1 ? 'team1Profile' : 'team2Profile';
    const championKey = side === 1 ? 'team1Champion' : 'team2Champion';

    const entries = lanes
      .filter((lane) => lane[championKey] && lane[key])
      .map((lane) => ({ role: lane.role, champion: lane[championKey], profile: lane[key] }));

    const profiles = entries.map((entry) => entry.profile);

    const damageWeighted = { physical: 0, magic: 0, true: 0, weight: 0 };
    const damageSimple = { physical: [], magic: [], true: [] };

    profiles.forEach((profile) => {
      const dmg = profileValue(profile, 'avg_damage_to_champs');
      const phys = profileValue(profile, 'pct_physical_dmg');
      const magic = profileValue(profile, 'pct_magic_dmg');
      const pure = profileValue(profile, 'pct_true_dmg');

      if (phys !== null) damageSimple.physical.push(phys);
      if (magic !== null) damageSimple.magic.push(magic);
      if (pure !== null) damageSimple.true.push(pure);

      if (dmg !== null && dmg > 0 && phys !== null && magic !== null && pure !== null) {
        damageWeighted.physical += dmg * phys;
        damageWeighted.magic += dmg * magic;
        damageWeighted.true += dmg * pure;
        damageWeighted.weight += dmg;
      }
    });

    let damageMix;
    if (damageWeighted.weight > 0) {
      damageMix = {
        physical: damageWeighted.physical / damageWeighted.weight,
        magic: damageWeighted.magic / damageWeighted.weight,
        true: damageWeighted.true / damageWeighted.weight
      };
    } else {
      damageMix = {
        physical: average(damageSimple.physical),
        magic: average(damageSimple.magic),
        true: average(damageSimple.true)
      };
    }

    const rawMixSum = sum([damageMix.physical, damageMix.magic, damageMix.true]);
    if (rawMixSum && rawMixSum > 0) {
      damageMix = {
        physical: (damageMix.physical ?? 0) / rawMixSum,
        magic: (damageMix.magic ?? 0) / rawMixSum,
        true: (damageMix.true ?? 0) / rawMixSum
      };
    }

    const metrics = {
      damageOutput: sum(profiles.map((p) => profileValue(p, 'avg_damage_to_champs'))),
      damageTaken: sum(profiles.map((p) => profileValue(p, 'avg_damage_taken'))),
      ccTime: sum(profiles.map((p) => profileValue(p, 'avg_time_ccing_others'))),
      ccTotal: sum(profiles.map((p) => profileValue(p, 'avg_total_time_cc_dealt'))),
      vision: sum(profiles.map((p) => profileValue(p, 'vision_score'))),
      goldDependency: average(profiles.map((p) => profileValue(p, 'goldxp_winpct_per_1k_gold'))),
      xpDependency: average(profiles.map((p) => profileValue(p, 'goldxp_winpct_per_1k_xp'))),
      auc: average(profiles.map((p) => profileValue(p, 'goldxp_auc'))),
      level6: average(profiles.map((p) => profileValue(p, 'avg_level6_minute'))),
      generalWinrate: average(profiles.map((p) => profileValue(p, 'general_winrate')))
    };

    const radar = {
      winrate: average(profiles.map((p) => profilePercentile(p, 'general_winrate'))),
      damage: average(profiles.map((p) => profilePercentile(p, 'avg_damage_to_champs'))),
      durability: average(profiles.map((p) => profilePercentile(p, 'avg_damage_taken'))),
      cc: average(profiles.map((p) => profilePercentile(p, 'avg_total_time_cc_dealt'))),
      vision: average(profiles.map((p) => profilePercentile(p, 'vision_score'))),
      gold: average(profiles.map((p) => profilePercentile(p, 'goldxp_winpct_per_1k_gold'))),
      xp: average(profiles.map((p) => profilePercentile(p, 'goldxp_winpct_per_1k_xp'))),
      auc: average(profiles.map((p) => profilePercentile(p, 'goldxp_auc'))),
      level6: average(profiles.map((p) => profilePercentile(p, 'avg_level6_minute', true)))
    };

    const profileScore = average(Object.values(radar));

    return {
      side,
      count: profiles.length,
      entries,
      damageMix,
      metrics,
      radar,
      profileScore
    };
  }

  function aggregateAnalysis(lanes) {
    const exact = lanes.filter((lane) => lane.data_status === 'exact');
    const fallback = lanes.filter((lane) => lane.data_status === 'fallback');
    const missing = lanes.filter((lane) => lane.data_status === 'missing');

    const timelines = {
      gold: aggregateTimeline(lanes, 'gold_diff_by_minute'),
      xp: aggregateTimeline(lanes, 'xp_diff_by_minute'),
      excessGold: aggregateTimeline(lanes, 'excess_gold_diff_by_minute'),
      excessXp: aggregateTimeline(lanes, 'excess_xp_diff_by_minute')
    };

    const scalar = {
      gold15: valueFromTimeline(timelines.gold.points, REFERENCE_MINUTE),
      xp15: valueFromTimeline(timelines.xp.points, REFERENCE_MINUTE),
      excessGold15: valueFromTimeline(timelines.excessGold.points, REFERENCE_MINUTE),
      excessXp15: valueFromTimeline(timelines.excessXp.points, REFERENCE_MINUTE),
      avgDiffWinrate: average(exact.map((lane) => safeNumber(lane.diff_winrate_a))),
      avgMatchupWinrateEdge: average(exact.map((lane) => {
        const wr = safeNumber(lane.winrate_a);
        return wr === null ? null : wr - 0.5;
      })),
      avgSnowball: average(exact.map((lane) => safeNumber(lane.snowball_corr_15m))),
      avgVolatility: average(exact.map((lane) => safeNumber(lane.gold_diff_std_15m))),
      objectiveEdge: average(exact.map(objectiveEdgeForLane))
    };

    const team1Profile = buildTeamProfile(lanes, 1);
    const team2Profile = buildTeamProfile(lanes, 2);

    const profileEdge = edgeFromTeamProfiles(team1Profile, team2Profile);
    const outlook = computeDraftOutlook({ lanes, exact, fallback, missing, scalar, team1Profile, team2Profile, profileEdge });

    const analysis = {
      lanes,
      exact,
      fallback,
      missing,
      timelines,
      scalar,
      team1Profile,
      team2Profile,
      profileEdge,
      outlook
    };

    analysis.insights = generateInsights(analysis);
    analysis.warnings = generateWarnings(analysis);

    return analysis;
  }

  function valueFromTimeline(points, minute) {
    const point = points.find((p) => p.minute === minute);
    return point ? safeNumber(point.value) : null;
  }

  function normalizeComponent(value, scale) {
    const n = safeNumber(value);
    if (n === null || !scale) return null;
    return Math.max(-1, Math.min(1, n / scale));
  }

  function edgeFromTeamProfiles(team1, team2) {
    const score1 = safeNumber(team1.profileScore);
    const score2 = safeNumber(team2.profileScore);
    if (score1 === null || score2 === null) return null;
    return (score1 - score2) / 100;
  }

  function computeDraftOutlook(ctx) {
    const components = [
      { id: 'diffWinrate', value: normalizeComponent(ctx.scalar.avgDiffWinrate, 0.08) },
      { id: 'matchupWinrate', value: normalizeComponent(ctx.scalar.avgMatchupWinrateEdge, 0.08) },
      { id: 'gold15', value: normalizeComponent(ctx.scalar.gold15, 3500) },
      { id: 'xp15', value: normalizeComponent(ctx.scalar.xp15, 3500) },
      { id: 'excessGold15', value: normalizeComponent(ctx.scalar.excessGold15, 2500) },
      { id: 'objectiveEdge', value: normalizeComponent(ctx.scalar.objectiveEdge, 0.12) },
      { id: 'profileEdge', value: normalizeComponent(ctx.profileEdge, 0.35) }
    ].filter((component) => component.value !== null);

    const score = average(components.map((component) => component.value)) ?? 0;
    const abs = Math.abs(score);

    let label;
    let tone;
    if (score >= 0.45) {
      label = 'Team 1 edge netto';
      tone = 'team-a';
    } else if (score >= 0.15) {
      label = 'Team 1 leggermente avanti';
      tone = 'team-a';
    } else if (score <= -0.45) {
      label = 'Team 2 edge netto';
      tone = 'team-b';
    } else if (score <= -0.15) {
      label = 'Team 2 leggermente avanti';
      tone = 'team-b';
    } else {
      label = 'Partita bilanciata';
      tone = 'balanced';
    }

    const strength = abs >= 0.45 ? 'chiaro' : abs >= 0.15 ? 'leggero' : 'sottile';

    return { score, label, tone, strength, components };
  }

  function selectedLanes() {
    return roleOrder().map((role) => {
      const team1Champion = state.team1[role] || '';
      const team2Champion = state.team2[role] || '';
      return getOrientedMatchup(role, team1Champion, team2Champion);
    });
  }

  function analyzeDraft() {
    const lanes = selectedLanes();
    const hasAnyPair = lanes.some((lane) => lane.team1Champion && lane.team2Champion);

    if (!hasAnyPair) {
      byId('analysisRegion').hidden = true;
      byId('emptyState').hidden = false;
      byId('emptyState').textContent = 'Seleziona almeno una coppia di campioni nella stessa corsia per iniziare.';
      return null;
    }

    const analysis = aggregateAnalysis(lanes);
    state.lastAnalysis = analysis;
    renderAnalysis(analysis);
    return analysis;
  }

  function generateInsights(analysis) {
    const items = [];
    const exact = analysis.exact;

    const add = (tag, title, text, priority, tone = 'info', impact = null) => {
      if (!text) return;
      items.push({
        tag,
        title,
        text,
        priority,
        tone,
        impact: impact || impactLabel(priority)
      });
    };

    const toneFromValue = (value, inverse = false) => {
      const n = safeNumber(value);
      if (n === null || Math.abs(n) < 0.0001) return 'info';
      const t1 = inverse ? n < 0 : n > 0;
      return t1 ? 'team-a' : 'team-b';
    };

    const sideFromValue = (value, inverse = false) => {
      const n = safeNumber(value);
      if (n === null || Math.abs(n) < 0.0001) return 'nessun team';
      const t1 = inverse ? n < 0 : n > 0;
      return t1 ? 'Team 1' : 'Team 2';
    };

    const componentLabels = {
      diffWinrate: 'scarto matchup vs baseline',
      matchupWinrate: 'winrate diretto medio',
      gold15: 'oro aggregato @15',
      xp15: 'XP aggregata @15',
      excessGold15: 'excess oro @15',
      objectiveEdge: 'prime azioni / obiettivi',
      profileEdge: 'profilo composizione'
    };

    const topComponent = [...(analysis.outlook.components || [])]
      .filter((c) => safeNumber(c.value) !== null)
      .sort((a, b) => Math.abs(safeNumber(b.value)) - Math.abs(safeNumber(a.value)))[0];

    if (topComponent && Math.abs(safeNumber(topComponent.value)) >= 0.18) {
      const side = sideFromValue(topComponent.value);
      add(
        'Driver',
        `${componentLabels[topComponent.id] || topComponent.id} è il segnale più pesante`,
        `${side} non emerge da una singola statistica isolata: il driver più forte dell’indice è ${componentLabels[topComponent.id] || topComponent.id}. Usalo come priorità di lettura, non come probabilità di vittoria.`,
        98,
        toneFromValue(topComponent.value),
        'Molto alto'
      );
    }

    const laneScores = analysis.lanes
      .map((lane) => ({ lane, score: lanePressureScore(lane) }))
      .filter((x) => safeNumber(x.score) !== null)
      .sort((a, b) => Math.abs(safeNumber(b.score)) - Math.abs(safeNumber(a.score)));

    const topLane = laneScores[0];
    if (topLane && Math.abs(safeNumber(topLane.score)) >= 0.26) {
      const side = sideFromValue(topLane.score);
      const status = topLane.lane.data_status === 'fallback'
        ? 'Il segnale qui viene dal profilo generale dei campioni, non da un matchup diretto.'
        : 'Il segnale combina matchup, oro/XP, pressione e obiettivi disponibili.';
      add(
        'Lane plan',
        `${roleLabel(topLane.lane.role)} è la corsia da pesare di più`,
        `${side} ha il vantaggio più netto in ${roleLabel(topLane.lane.role)}. ${status} È la lane che più probabilmente deve guidare il piano iniziale o ricevere copertura se il game si apre lì.`,
        96,
        toneFromValue(topLane.score),
        'Molto alto'
      );
    }

    const strongLanes = laneScores.filter((x) => Math.abs(safeNumber(x.score)) >= 0.22);
    const t1Strong = strongLanes.filter((x) => safeNumber(x.score) > 0);
    const t2Strong = strongLanes.filter((x) => safeNumber(x.score) < 0);
    if (t1Strong.length >= 2 || t2Strong.length >= 2) {
      const group = t1Strong.length >= t2Strong.length ? t1Strong : t2Strong;
      const side = group === t1Strong ? 'Team 1' : 'Team 2';
      add(
        'Mappa',
        `${side} può giocare da più corsie`,
        `${group.slice(0, 3).map((x) => roleLabel(x.lane.role)).join(', ')} mostrano segnali coerenti per ${side}. Questo pesa più di una singola lane forte: permette piani con pressione incrociata invece di dipendere da un solo matchup.`,
        91,
        group === t1Strong ? 'team-a' : 'team-b',
        'Alto'
      );
    } else if (t1Strong.length && t2Strong.length) {
      add(
        'Mappa',
        'Il game sembra diviso per corsie',
        `${roleLabel(t1Strong[0].lane.role)} tende verso Team 1, mentre ${roleLabel(t2Strong[0].lane.role)} tende verso Team 2. In questo scenario conta molto dove viene giocato il primo movimento: il draft non indica una sola direzione naturale.`,
        88,
        'info',
        'Alto'
      );
    }

    const snow = snowballLeader(analysis);
    if (snow) {
      const sensitivity = laneSnowballSensitivity(snow.lane);
      const pressure = lanePressureScore(snow.lane);
      if (safeNumber(sensitivity) !== null && sensitivity >= 0.12) {
        const side = safeNumber(pressure) === null || Math.abs(pressure) < 0.14 ? null : sideFromValue(pressure);
        const sideCopy = side
          ? `Il segnale lane attuale favorisce ${side}: se quel vantaggio arriva davvero al minuto 15, il suo valore strategico è più alto del normale.`
          : 'Il dato non assegna il vantaggio a un team: dice soprattutto che questa corsia punisce molto chi resta indietro.';
        add(
          'Snowball',
          `${roleLabel(snow.lane.role)} ha la sensibilità snowball più alta`,
          `Il gap tra winrate quando avanti e quando indietro @15 è ${formatPpAbs(sensitivity)}. ${sideCopy} Questa è la corsia dove protezione, wave state e primo reset possono valere più di una piccola differenza di winrate.`,
          sensitivity >= 0.22 ? 97 : 90,
          snowballToneClass(sensitivity),
          sensitivity >= 0.22 ? 'Molto alto' : 'Alto'
        );
      }
    }

    const gold15 = safeNumber(analysis.scalar.gold15);
    const excess = safeNumber(analysis.scalar.excessGold15);
    if (gold15 !== null && Math.abs(gold15) >= 650) {
      const driver = strongestLaneBy(exact, (lane) => valueAtMinute(lane.gold_diff_by_minute, lane.minutes), Math.sign(gold15));
      const side = gold15 > 0 ? 'Team 1' : 'Team 2';
      add(
        'Economia',
        `${side} ha pressione oro aggregata @15`,
        `${intFmt(gold15, 'g')} di oro aggregato sulle lane exact${driver ? `, trainato soprattutto da ${roleLabel(driver.role)}` : ''}. Questo è un segnale concreto di tempo early, ma va letto insieme all’excess: l’oro grezzo può riflettere anche la baseline naturale dei campioni.`,
        86,
        toneFromValue(gold15),
        'Alto'
      );
    }

    if (gold15 !== null && excess !== null && Math.abs(excess) >= 450) {
      if (Math.sign(gold15) === Math.sign(excess)) {
        add(
          'Excess',
          'Il vantaggio economico è confermato dall’excess gold',
          `${sideFromValue(excess)} non è avanti solo perché i suoi campioni tendono naturalmente a generare più oro: l’excess va nella stessa direzione del gold diff. Questo rende il segnale più interessante per il piano matchup.`,
          84,
          toneFromValue(excess),
          'Medio-alto'
        );
      } else if (Math.abs(gold15) >= 450) {
        add(
          'Excess',
          'Oro grezzo ed excess raccontano due cose diverse',
          `${sideFromValue(gold15)} ha il gold diff grezzo, ma l’excess non lo conferma. Questo suggerisce cautela: parte del vantaggio potrebbe dipendere dalla baseline dei campioni più che dal matchup specifico.`,
          89,
          'warning',
          'Alto'
        );
      }
    }

    const xp15 = safeNumber(analysis.scalar.xp15);
    if (xp15 !== null && Math.abs(xp15) >= 650) {
      add(
        'Tempo',
        `${sideFromValue(xp15)} ha un segnale XP utile per i timing`,
        `Il vantaggio XP aggregato @15 (${intFmt(xp15)}) non equivale automaticamente a vittoria, ma può cambiare finestre di fight, livello 6 e priorità sugli obiettivi. Cercare fight prima o dopo questi spike è più importante del numero grezzo.`,
        78,
        toneFromValue(xp15),
        'Medio'
      );
    }

    const objective = safeNumber(analysis.scalar.objectiveEdge);
    if (objective !== null && Math.abs(objective) >= 0.025) {
      add(
        'Obiettivi',
        `${sideFromValue(objective)} ha il segnale migliore sulle prime azioni`,
        `Il margine medio su first blood, tower race e obiettivi disponibili è ${signedPct(objective)}. Non è una previsione 5v5: indica dove il draft sembra più predisposto a convertire priorità iniziale in eventi di mappa.`,
        76,
        toneFromValue(objective),
        'Medio'
      );
    }

    const volatile = maxBy(exact, (lane) => safeNumber(lane.gold_diff_std_15m));
    const volatileStd = safeNumber(volatile?.gold_diff_std_15m);
    if (volatile && volatileStd !== null && volatileStd >= 850) {
      add(
        'Volatilità',
        `${roleLabel(volatile.role)} è la corsia più instabile`,
        `La deviazione standard del gold diff @15 è ${compactNumber(volatileStd)}: in questa lane lo stesso matchup tende ad aprirsi in modi molto diversi. È un segnale per non pianificare tutto su uno script rigido.`,
        74,
        'warning',
        'Medio'
      );
    }

    const ccDiff = diffMetric(analysis.team1Profile, analysis.team2Profile, 'ccTotal');
    const takenDiff = diffMetric(analysis.team1Profile, analysis.team2Profile, 'damageTaken');
    if (ccDiff !== null && Math.abs(ccDiff) >= 25) {
      const side = sideFromValue(ccDiff);
      const fightCopy = takenDiff !== null && Math.sign(takenDiff) === Math.sign(ccDiff) && Math.abs(takenDiff) >= 8000
        ? ' Lo stesso lato mostra anche più damage taken medio: può indicare strumenti migliori per fight front-to-back o ingaggi prolungati.'
        : '';
      add(
        'Fight',
        `${side} ha più strumenti di controllo`,
        `Il profilo CC aggregato è più marcato per ${side}. Questo non significa danno maggiore, ma rende più credibili pick, setup sugli obiettivi e fight coordinati.${fightCopy}`,
        72,
        toneFromValue(ccDiff),
        'Medio'
      );
    }

    const visionDiff = diffMetric(analysis.team1Profile, analysis.team2Profile, 'vision');
    if (visionDiff !== null && Math.abs(visionDiff) >= 28) {
      add(
        'Visione',
        `${sideFromValue(visionDiff)} ha un profilo visione superiore`,
        `Il vantaggio visione aggregato suggerisce più strumenti per controllare ingressi, setup e transizioni. È un dato champion-level: descrive tendenza del draft, non decisioni reali dei giocatori.`,
        68,
        toneFromValue(visionDiff),
        'Medio'
      );
    }

    const goldDepDiff = diffMetric(analysis.team1Profile, analysis.team2Profile, 'goldDependency');
    const xpDepDiff = diffMetric(analysis.team1Profile, analysis.team2Profile, 'xpDependency');
    if (goldDepDiff !== null && Math.abs(goldDepDiff) >= 0.9) {
      add(
        'Risorse',
        `${sideFromValue(goldDepDiff)} tende a convertire meglio il gold lead`,
        `La dipendenza/conversione da +1000 oro è più alta per ${sideFromValue(goldDepDiff)}. Se quel team va avanti, le risorse extra dovrebbero pesare di più; se resta indietro, il draft può perdere una parte importante del proprio valore.`,
        70,
        toneFromValue(goldDepDiff),
        'Medio'
      );
    }
    if (xpDepDiff !== null && Math.abs(xpDepDiff) >= 0.9 && (goldDepDiff === null || Math.sign(xpDepDiff) !== Math.sign(goldDepDiff))) {
      add(
        'Risorse',
        `${sideFromValue(xpDepDiff)} ha migliore leva sull’esperienza`,
        `La conversione da XP non segue lo stesso segnale del gold. Questo può indicare draft che non devono solo accumulare oro: timing di livelli e spike possono essere una finestra separata.`,
        63,
        toneFromValue(xpDepDiff),
        'Medio-basso'
      );
    }

    const addDamageInsight = (teamName, mix, tone) => {
      const phys = safeNumber(mix.physical);
      const magic = safeNumber(mix.magic);
      const pure = safeNumber(mix.true);
      if (phys !== null && phys >= 0.64) {
        add('Danni', `${teamName} è molto fisico`, `La composizione danno è sbilanciata sul fisico (${pct(phys, 0)}). Questo rende l’itemizzazione armor più efficiente e può ridurre il valore del draft se non crea vantaggi prima che le difese entrino online.`, 66, tone, 'Medio');
      } else if (magic !== null && magic >= 0.56) {
        add('Danni', `${teamName} è molto magico`, `La composizione danno è sbilanciata sul magico (${pct(magic, 0)}). Il draft può diventare più leggibile in itemizzazione MR, soprattutto se non accompagna il danno con CC o pressione obiettivi.`, 66, tone, 'Medio');
      } else if (pure !== null && pure >= 0.11) {
        add('Danni', `${teamName} ha una quota di danno puro rilevante`, `La presenza di true damage (${pct(pure, 0)}) rende meno lineare la risposta difensiva. Non è da sola una win condition, ma aumenta la qualità del profilo danni.`, 61, tone, 'Medio-basso');
      }
    };
    addDamageInsight('Team 1', analysis.team1Profile.damageMix, 'team-a');
    addDamageInsight('Team 2', analysis.team2Profile.damageMix, 'team-b');

    const lowRoles = exact.filter((lane) => lane.low_sample).map((lane) => roleLabel(lane.role));
    if (lowRoles.length) {
      add(
        'Affidabilità',
        `${lowRoles.join(', ')} ${lowRoles.length === 1 ? 'ha' : 'hanno'} campione ridotto`,
        'Il dato resta utile per orientarsi, ma non dovrebbe essere il driver principale del piano. Se un insight dipende proprio da queste corsie, va declassato di priorità.',
        58,
        'warning',
        'Medio-basso'
      );
    }

    if (!items.length) {
      add('Sintesi', 'Nessun segnale domina davvero il draft', 'La lettura resta distribuita: non c’è una corsia, risorsa o categoria che separi nettamente i team. In questo caso conviene usare la pagina per individuare rischi specifici, non per cercare un verdetto forte.', 50, 'info', 'Medio');
    }

    return items
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 12);
  }

  function impactLabel(priority) {
    if (priority >= 94) return 'Molto alto';
    if (priority >= 82) return 'Alto';
    if (priority >= 66) return 'Medio';
    return 'Basso';
  }

  function formatPpAbs(value) {
    const n = safeNumber(value);
    return n === null ? '—' : `${Math.abs(n * 100).toFixed(1)}pp`;
  }

  function generateWarnings(analysis) {
    const out = [];

    analysis.lanes.forEach((lane) => {
      const label = roleLabel(lane.role).toUpperCase();
      if (!lane.team1Champion && !lane.team2Champion) return;
      if (!lane.team1Champion || !lane.team2Champion) {
        out.push({ level: 'critical', text: `${label}: selezione incompleta, corsia esclusa dagli aggregati.` });
        return;
      }
      if (lane.reason === 'same_champion') {
        out.push({ level: 'critical', text: `${label}: stesso campione selezionato da entrambi i team.` });
        return;
      }
      if (lane.data_status === 'fallback') {
        out.push({ level: 'warning', text: `${label}: matchup diretto non disponibile, lettura basata sui profili generali dei campioni.` });
      }
      if (lane.data_status === 'missing') {
        out.push({ level: 'critical', text: `${label}: dati insufficienti per questa corsia.` });
      }
      if (lane.low_sample) {
        out.push({ level: 'warning', text: `${label}: campione ridotto, dato utile ma non conclusivo.` });
      }
      if (lane.data_status === 'exact') {
        for (const field of SIGNED_ARRAY_FIELDS) {
          if (!Array.isArray(lane[field]) || !lane[field].length) {
            out.push({ level: 'warning', text: `${label}: serie temporale ${field.replaceAll('_', ' ')} assente.` });
          }
        }
        if (lane.role === 'JUNGLE' && !getMonsterPctKeys(lane).length) {
          out.push({ level: 'warning', text: `${label}: metriche obiettivi mostro non disponibili.` });
        }
      }
    });

    if (!analysis.exact.length) {
      out.push({ level: 'critical', text: 'Nessun matchup diretto disponibile: timeline e segnali lane-specific sono limitati.' });
    }

    if (!out.length) {
      out.push({ level: 'ok', text: 'Affidabilità buona: nessun warning critico emerso nelle corsie selezionate.' });
    }

    return out.slice(0, 14);
  }

  function diffMetric(team1, team2, field) {
    const a = safeNumber(team1.metrics[field]);
    const b = safeNumber(team2.metrics[field]);
    if (a === null || b === null) return null;
    return a - b;
  }

  function maxBy(items, fn) {
    let best = null;
    let bestVal = null;
    items.forEach((item) => {
      const val = safeNumber(fn(item));
      if (val === null) return;
      if (bestVal === null || val > bestVal) {
        best = item;
        bestVal = val;
      }
    });
    return best;
  }

  function strongestLaneBy(lanes, fn, sign) {
    let best = null;
    let bestAbs = 0;
    lanes.forEach((lane) => {
      const val = safeNumber(fn(lane));
      if (val === null || Math.sign(val) !== sign) return;
      const abs = Math.abs(val);
      if (abs > bestAbs) {
        best = lane;
        bestAbs = abs;
      }
    });
    return best;
  }

  function renderAnalysis(analysis) {
    byId('emptyState').hidden = true;
    byId('analysisRegion').hidden = false;

    renderOutlook(analysis);
    renderVisualSummary(analysis);
    renderSnowball(analysis);
    renderTimelineControls(analysis);
    renderTimeline(analysis);
    renderLaneMatrix(analysis);
    renderDamageAndProfile(analysis);
    renderRadar(analysis);
    renderInsights(analysis);
    renderWarnings(analysis);
  }

  function renderOutlook(analysis) {
    const exactCount = analysis.exact.length;
    const fallbackCount = analysis.fallback.length;
    const missingCount = analysis.missing.filter((lane) => lane.team1Champion || lane.team2Champion).length;
    const lowCount = analysis.exact.filter((lane) => lane.low_sample).length;
    const score = analysis.outlook.score;

    const copy = outlookCopy(analysis);

    byId('outlookHero').innerHTML = `
      <div class="outlook-top">
        <div>
          <div class="micro-label">Draft outlook</div>
          <h2 class="outlook-title" id="outlookTitle">${esc(analysis.outlook.label)}</h2>
          <p class="outlook-copy">${esc(copy)}</p>
        </div>
        <div class="outlook-score ${esc(analysis.outlook.tone)}">
          <div>
            <strong>${signedDecimal(score, 2)}</strong>
            <span>indice euristico</span>
          </div>
        </div>
      </div>
      <div class="kpi-grid">
        ${kpiHtml('Oro @15', intFmt(analysis.scalar.gold15, 'g'), teamNameFromValue(analysis.scalar.gold15), toneClass(analysis.scalar.gold15))}
        ${kpiHtml('XP @15', intFmt(analysis.scalar.xp15), teamNameFromValue(analysis.scalar.xp15), toneClass(analysis.scalar.xp15))}
        ${kpiHtml('Excess oro', intFmt(analysis.scalar.excessGold15, 'g'), teamNameFromValue(analysis.scalar.excessGold15), toneClass(analysis.scalar.excessGold15))}
        ${kpiHtml('Snowball', snowballKpiValue(analysis), snowballKpiSub(analysis), snowballKpiClass(analysis))}
      </div>
    `;
  }

  function outlookCopy(analysis) {
    const parts = [];
    const leader = analysis.outlook.tone === 'team-a' ? 'Team 1' : analysis.outlook.tone === 'team-b' ? 'Team 2' : null;
    if (leader) parts.push(`${leader} emerge con un vantaggio ${analysis.outlook.strength}, costruito da segnali lane-by-lane e profilo composizione.`);
    else parts.push('Il draft resta vicino al centro: nessun team separa nettamente l’altro sul segnale aggregato.');

    if (safeNumber(analysis.scalar.gold15) !== null) parts.push(`Oro aggregato @15: ${intFmt(analysis.scalar.gold15, 'g')}.`);
    if (safeNumber(analysis.scalar.objectiveEdge) !== null) parts.push(`Obiettivi/prime azioni: ${signedPct(analysis.scalar.objectiveEdge)} medio.`);
    return parts.join(' ');
  }


  function snowballLaneSwing(lane) {
    const ahead = safeNumber(lane?.winrate_a_when_ahead_15m);
    const behind = safeNumber(lane?.winrate_a_when_behind_15m);
    if (ahead === null || behind === null) return null;
    return ahead - behind;
  }

  function laneSnowballSensitivity(lane) {
    const swing = snowballLaneSwing(lane);
    if (swing !== null) return Math.abs(swing);

    // Fallback visuale: la correlazione non è una differenza di winrate,
    // ma può ancora dire se il vantaggio oro @15 è informativo per l'esito.
    const corr = safeNumber(lane?.snowball_corr_15m);
    if (corr === null) return null;
    return Math.min(0.35, Math.abs(corr) * 0.30);
  }

  function snowballToneClass(value) {
    const n = safeNumber(value);
    if (n === null) return 'neutral';
    if (n >= 0.25) return 'danger';
    if (n >= 0.16) return 'warning';
    if (n >= 0.08) return 'info';
    return 'neutral';
  }

  function snowballTierLabel(value) {
    const n = safeNumber(value);
    if (n === null) return 'dato parziale';
    if (n >= 0.25) return 'esplosiva';
    if (n >= 0.16) return 'alta';
    if (n >= 0.08) return 'media';
    return 'bassa';
  }

  function snowballLanes(analysis) {
    return analysis.exact
      .map((lane) => ({
        lane,
        swing: snowballLaneSwing(lane),
        sensitivity: laneSnowballSensitivity(lane),
        corr: safeNumber(lane.snowball_corr_15m)
      }))
      .filter((item) => item.sensitivity !== null || item.corr !== null);
  }

  function snowballLeader(analysis) {
    const items = snowballLanes(analysis);
    if (!items.length) return null;
    return items.reduce((best, item) => {
      const score = (item.sensitivity ?? 0) + Math.abs(item.corr ?? 0) * 0.08;
      const bestScore = (best.sensitivity ?? 0) + Math.abs(best.corr ?? 0) * 0.08;
      return score > bestScore ? item : best;
    }, items[0]);
  }

  function avgSnowballSwing(analysis) {
    return average(snowballLanes(analysis).map((item) => item.sensitivity));
  }

  function snowballKpiValue(analysis) {
    const avg = avgSnowballSwing(analysis);
    return avg === null ? '—' : `${(avg * 100).toFixed(1)}pp`;
  }

  function snowballKpiSub(analysis) {
    const lead = snowballLeader(analysis);
    if (!lead) return 'dato non disponibile';
    const sensitivity = lead.sensitivity;
    return `${roleLabel(lead.lane.role)} · ${snowballTierLabel(sensitivity)}`;
  }

  function snowballKpiClass(analysis) {
    return snowballToneClass(avgSnowballSwing(analysis));
  }

  function kpiHtml(label, value, sub, cls = '') {
    return `
      <div class="kpi-card ${esc(cls)}">
        <span>${esc(label)}</span>
        <strong>${esc(value)}</strong>
        <p>${esc(sub || '—')}</p>
      </div>
    `;
  }


  function renderVisualSummary(analysis) {
    const map = byId('lanePressureMap');
    if (map) map.innerHTML = analysis.lanes.map((lane) => lanePressureRowHtml(lane)).join('');

    const heat = byId('draftHeatmap');
    if (heat) heat.innerHTML = heatmapItems(analysis).map(heatCellHtml).join('');
  }


  function renderSnowball(analysis) {
    const target = byId('snowballPanel');
    if (!target) return;

    const items = snowballLanes(analysis);
    if (!items.length) {
      target.innerHTML = '<div class="empty-note">Dato snowball non disponibile per le corsie selezionate.</div>';
      return;
    }

    const leader = snowballLeader(analysis);
    const avgSensitivity = avgSnowballSwing(analysis);
    const leaderRole = leader ? roleLabel(leader.lane.role) : '—';
    const leaderSensitivity = leader?.sensitivity;
    const leaderTone = snowballToneClass(leaderSensitivity);
    const avgTone = snowballToneClass(avgSensitivity);

    target.innerHTML = `
      <article class="snowball-hero-card">
        <div class="micro-label">Sensibilità snowball</div>
        <strong class="snowball-value ${esc(avgTone)}">${esc(avgSensitivity === null ? '—' : `${(avgSensitivity * 100).toFixed(1)}pp`)}</strong>
        <p>Misura neutra: quanto cambia il winrate tra essere avanti e indietro al minuto 15. Non indica quale team è favorito; indica quanto quella condizione pesa sul risultato.</p>
        <p><strong>${esc(leaderRole)}</strong> è la corsia più sensibile${leaderSensitivity === null ? '.' : `: ${esc(formatPpAbs(leaderSensitivity))}, livello ${esc(snowballTierLabel(leaderSensitivity))}.`}</p>
      </article>
      <div class="snowball-lane-grid">
        ${items.map(snowballLaneHtml).join('')}
      </div>
    `;
  }

  function snowballLaneHtml(item) {
    const lane = item.lane;
    const ahead = safeNumber(lane.winrate_a_when_ahead_15m);
    const behind = safeNumber(lane.winrate_a_when_behind_15m);
    const sensitivity = item.sensitivity;
    const corr = item.corr;
    const aheadW = ahead === null ? 0 : Math.max(0, Math.min(100, ahead * 100));
    const behindW = behind === null ? 0 : Math.max(0, Math.min(100, behind * 100));
    const cls = snowballToneClass(sensitivity);
    const deltaLabel = sensitivity === null
      ? `corr ${Math.abs(corr ?? 0).toFixed(2)}`
      : `${formatPpAbs(sensitivity)} · ${snowballTierLabel(sensitivity)}`;

    return `
      <article class="snowball-lane-card">
        <div class="snowball-lane-role">${esc(roleLabel(lane.role))}</div>
        <div class="snowball-bars">
          <div class="snowball-meta"><span>WR avanti @15 ${esc(pct(ahead, 0))}</span><span>WR indietro @15 ${esc(pct(behind, 0))}</span></div>
          <div class="snowball-bar ahead"><span style="width:${aheadW.toFixed(1)}%"></span></div>
          <div class="snowball-bar behind"><span style="width:${behindW.toFixed(1)}%"></span></div>
        </div>
        <div class="snowball-delta ${esc(cls)}">${esc(deltaLabel)}</div>
      </article>
    `;
  }

  function lanePressureScore(lane) {
    if (!lane || !lane.team1Champion || !lane.team2Champion || lane.reason === 'same_champion') return null;

    if (lane.data_status === 'exact') {
      const gold15 = valueAtMinute(lane.gold_diff_by_minute, lane.minutes);
      const xp15 = valueAtMinute(lane.xp_diff_by_minute, lane.minutes);
      const excess15 = valueAtMinute(lane.excess_gold_diff_by_minute, lane.minutes);
      const wr = safeNumber(lane.winrate_a);
      const ahead = safeNumber(lane.pct_a_ahead_15m);
      const lvl6 = level6Diff(lane);
      const comps = [
        wr === null ? null : normalizeComponent(wr - 0.5, 0.08),
        normalizeComponent(lane.diff_winrate_a, 0.08),
        normalizeComponent(gold15, 1400),
        normalizeComponent(xp15, 1400),
        normalizeComponent(excess15, 900),
        ahead === null ? null : normalizeComponent(ahead - 0.5, 0.10),
        normalizeComponent(objectiveEdgeForLane(lane), 0.12),
        normalizeComponent(lvl6 === null ? null : -lvl6, 1.15)
      ];
      return average(comps);
    }

    if (lane.data_status === 'fallback') {
      const p1 = lane.team1Profile;
      const p2 = lane.team2Profile;
      const comps = [
        normalizeComponent(diffNullable(profileValue(p1, 'general_winrate'), profileValue(p2, 'general_winrate')), 0.08),
        normalizeComponent(diffNullable(profileValue(p1, 'avg_damage_to_champs'), profileValue(p2, 'avg_damage_to_champs')), 12000),
        normalizeComponent(diffNullable(profileValue(p1, 'vision_score'), profileValue(p2, 'vision_score')), 22),
        normalizeComponent(diffNullable(profileValue(p1, 'avg_total_time_cc_dealt'), profileValue(p2, 'avg_total_time_cc_dealt')), 45),
        normalizeComponent(diffNullable(profileValue(p2, 'avg_level6_minute'), profileValue(p1, 'avg_level6_minute')), 1.15)
      ];
      return average(comps);
    }

    return null;
  }

  function lanePressureRowHtml(lane) {
    const score = lanePressureScore(lane);
    const cls = score === null ? '' : score >= 0 ? 'team-a' : 'team-b';
    const width = score === null ? 0 : Math.min(100, Math.abs(score) * 100);
    const label = score === null ? '—' : score >= 0 ? `Team 1 ${Math.round(width)}` : `Team 2 ${Math.round(width)}`;
    return `
      <div class="lane-pressure-row">
        <div class="pressure-role">${esc(roleLabel(lane.role))}</div>
        <div class="pressure-track">
          <span class="pressure-fill ${esc(cls)}" style="width:${width.toFixed(1)}%"></span>
        </div>
        <div class="pressure-label ${esc(cls)}">${esc(label)}</div>
      </div>
    `;
  }

  function heatmapItems(analysis) {
    const r1 = analysis.team1Profile.radar || {};
    const r2 = analysis.team2Profile.radar || {};
    const radarEdge = (...keys) => average(keys.map((key) => {
      const a = safeNumber(r1[key]);
      const b = safeNumber(r2[key]);
      return a === null || b === null ? null : (a - b) / 100;
    }));

    return [
      ['Lane', normalizeComponent(analysis.scalar.avgMatchupWinrateEdge, 0.08)],
      ['Oro 15', normalizeComponent(analysis.scalar.gold15, 3500)],
      ['XP 15', normalizeComponent(analysis.scalar.xp15, 3500)],
      ['Excess', normalizeComponent(analysis.scalar.excessGold15, 2500)],
      ['Obiettivi', normalizeComponent(analysis.scalar.objectiveEdge, 0.12)],
      ['Fight', radarEdge('damage', 'durability', 'cc')],
      ['Vision', radarEdge('vision')],
      ['Economia', radarEdge('gold', 'xp', 'auc')],
      ['Tempo 6', radarEdge('level6')]
    ];
  }

  function heatCellHtml([label, value]) {
    const n = safeNumber(value);
    const cls = n === null ? '' : n >= 0 ? 'team-a' : 'team-b';
    const width = n === null ? 0 : Math.min(100, Math.abs(n) * 100);
    const valueLabel = n === null ? '—' : n >= 0 ? `T1 ${Math.round(width)}` : `T2 ${Math.round(width)}`;
    return `
      <div class="heat-cell">
        <div class="heat-label">${esc(label)}</div>
        <div class="heat-track"><span class="heat-fill ${esc(cls)}" style="width:${width.toFixed(1)}%"></span></div>
        <div class="heat-value ${esc(cls)}">${esc(valueLabel)}</div>
      </div>
    `;
  }

  function renderTimelineControls(analysis) {
    byId('timelineControls').innerHTML = Object.entries(TIMELINE_MODES).map(([key, mode]) => `
      <button class="timeline-btn ${state.timelineMode === key ? 'active' : ''}" type="button" data-mode="${esc(key)}">${esc(mode.label)}</button>
    `).join('');

    $$('.timeline-btn', byId('timelineControls')).forEach((button) => {
      button.addEventListener('click', () => {
        state.timelineMode = button.dataset.mode;
        renderTimelineControls(analysis);
        renderTimeline(analysis);
      });
    });
  }

  function renderTimeline(analysis) {
    const mode = TIMELINE_MODES[state.timelineMode] || TIMELINE_MODES.gold;
    const data = analysis.timelines[state.timelineMode] || analysis.timelines.gold;
    const at15 = analysis.scalar[mode.at15];

    byId('timelineNote').textContent = `${mode.note} Valore @15: ${intFmt(at15, mode.suffix)}.`;
    byId('timelineChart').innerHTML = buildTimelineSvg(data.points, mode.suffix);
    byId('timelineLegend').innerHTML = `
      <span><i style="background:var(--champ-a)"></i>Team 1 sopra zero</span>
      <span><i style="background:var(--champ-b)"></i>Team 2 sotto zero</span>
      <span>${data.exactCount} corsie exact incluse</span>
    `;
  }

  function buildTimelineSvg(points, suffix) {
    if (!Array.isArray(points) || points.length < 2) {
      return '<div class="empty-note">Timeline non disponibile per le corsie selezionate.</div>';
    }

    const width = 920;
    const height = 300;
    const pad = { l: 52, r: 28, t: 28, b: 38 };
    const xs = points.map((p) => p.minute).filter(Number.isFinite);
    const ys = points.map((p) => safeNumber(p.value)).filter((v) => v !== null);
    if (xs.length < 2 || ys.length < 2) {
      return '<div class="empty-note">Timeline non disponibile per le corsie selezionate.</div>';
    }

    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const maxAbs = Math.max(1, ...ys.map((v) => Math.abs(v)));
    const yMax = maxAbs * 1.18;
    const yMin = -yMax;

    const x = (minute) => pad.l + ((minute - minX) / Math.max(1, maxX - minX)) * (width - pad.l - pad.r);
    const y = (value) => pad.t + ((yMax - value) / Math.max(1, yMax - yMin)) * (height - pad.t - pad.b);
    const zeroY = y(0);

    const cleanPoints = points
      .map((p) => ({ minute: safeNumber(p.minute), value: safeNumber(p.value) }))
      .filter((p) => p.minute !== null && p.value !== null);

    const linePath = cleanPoints
      .map((p, i) => `${i ? 'L' : 'M'}${x(p.minute).toFixed(1)},${y(p.value).toFixed(1)}`)
      .join(' ');

    const areaPath = `${linePath} L${x(cleanPoints[cleanPoints.length - 1].minute).toFixed(1)},${zeroY.toFixed(1)} L${x(cleanPoints[0].minute).toFixed(1)},${zeroY.toFixed(1)} Z`;

    const yTicks = [-1, -0.5, 0, 0.5, 1].map((mul) => mul * yMax);
    const grid = yTicks.map((tick) => `
      <line class="timeline-grid" x1="${pad.l}" x2="${width - pad.r}" y1="${y(tick).toFixed(1)}" y2="${y(tick).toFixed(1)}"></line>
      <text class="timeline-axis" x="${pad.l - 10}" y="${(y(tick) + 4).toFixed(1)}" text-anchor="end">${compactNumber(tick)}</text>
    `).join('');

    const xTicks = [minX, 10, 15, 20, 30, maxX].filter((v, i, arr) => Number.isFinite(v) && v >= minX && v <= maxX && arr.indexOf(v) === i);
    const xGrid = xTicks.map((tick) => `
      <line class="timeline-grid" x1="${x(tick).toFixed(1)}" x2="${x(tick).toFixed(1)}" y1="${pad.t}" y2="${height - pad.b}" opacity=".55"></line>
      <text class="timeline-axis" x="${x(tick).toFixed(1)}" y="${height - 12}" text-anchor="middle">${tick}m</text>
    `).join('');

    const p15 = cleanPoints.find((p) => p.minute === REFERENCE_MINUTE);
    const markerTone = p15 && p15.value < 0 ? 'b' : 'a';
    const marker = p15 ? `
      <line class="timeline-marker-line" x1="${x(REFERENCE_MINUTE).toFixed(1)}" x2="${x(REFERENCE_MINUTE).toFixed(1)}" y1="${pad.t}" y2="${height - pad.b}"></line>
      <circle class="timeline-marker timeline-marker-${markerTone}" cx="${x(REFERENCE_MINUTE).toFixed(1)}" cy="${y(p15.value).toFixed(1)}" r="6"></circle>
      <text class="timeline-axis timeline-marker-label" x="${x(REFERENCE_MINUTE).toFixed(1)}" y="${Math.max(16, y(p15.value) - 12).toFixed(1)}" text-anchor="middle">15m ${intFmt(p15.value, suffix)}</text>
    ` : '';

    const clipLeft = pad.l;
    const clipWidth = width - pad.l - pad.r;
    const posHeight = Math.max(0, zeroY - pad.t);
    const negHeight = Math.max(0, height - pad.b - zeroY);

    return `
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Timeline aggregata">
        <defs>
          <clipPath id="timelinePositiveClip">
            <rect x="${clipLeft}" y="${pad.t}" width="${clipWidth}" height="${posHeight}"></rect>
          </clipPath>
          <clipPath id="timelineNegativeClip">
            <rect x="${clipLeft}" y="${zeroY}" width="${clipWidth}" height="${negHeight}"></rect>
          </clipPath>
          <linearGradient id="timelineBgSheen" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stop-color="var(--champ-a-faint)"></stop>
            <stop offset="52%" stop-color="transparent"></stop>
            <stop offset="100%" stop-color="var(--champ-b-faint)"></stop>
          </linearGradient>
        </defs>
        <rect class="timeline-bg" x="${pad.l}" y="${pad.t}" width="${width - pad.l - pad.r}" height="${height - pad.t - pad.b}" rx="18"></rect>
        <rect class="timeline-bg-sheen" x="${pad.l}" y="${pad.t}" width="${width - pad.l - pad.r}" height="${height - pad.t - pad.b}" rx="18"></rect>
        ${grid}
        ${xGrid}
        <line class="timeline-zero" x1="${pad.l}" x2="${width - pad.r}" y1="${zeroY.toFixed(1)}" y2="${zeroY.toFixed(1)}"></line>
        <path class="timeline-area-a" clip-path="url(#timelinePositiveClip)" d="${areaPath}"></path>
        <path class="timeline-area-b" clip-path="url(#timelineNegativeClip)" d="${areaPath}"></path>
        <path class="timeline-trace-glow-a" clip-path="url(#timelinePositiveClip)" d="${linePath}"></path>
        <path class="timeline-trace-glow-b" clip-path="url(#timelineNegativeClip)" d="${linePath}"></path>
        <path class="timeline-trace-a" clip-path="url(#timelinePositiveClip)" d="${linePath}"></path>
        <path class="timeline-trace-b" clip-path="url(#timelineNegativeClip)" d="${linePath}"></path>
        ${marker}
      </svg>
    `;
  }

  function compactNumber(value) {
    const n = safeNumber(value);
    if (n === null) return '—';
    const abs = Math.abs(n);
    if (abs >= 1000) return `${n > 0 ? '+' : ''}${(n / 1000).toFixed(1)}k`;
    return `${n > 0 ? '+' : ''}${Math.round(n)}`;
  }

  function renderLaneMatrix(analysis) {
    byId('laneMatrix').innerHTML = analysis.lanes.map((lane) => laneCardHtml(lane)).join('');
  }

  function laneCardHtml(lane) {
    const status = laneStatusLabel(lane);
    const gold15 = valueAtMinute(lane.gold_diff_by_minute, lane.minutes);
    const xp15 = valueAtMinute(lane.xp_diff_by_minute, lane.minutes);
    const excess15 = valueAtMinute(lane.excess_gold_diff_by_minute, lane.minutes);
    const score = lanePressureScore(lane);
    const scoreCls = score === null ? '' : score >= 0 ? 'team-a' : 'team-b';
    const scoreWidth = score === null ? 0 : Math.min(100, Math.abs(score) * 100);

    return `
      <article class="lane-card ${esc(lane.data_status)}">
        <div class="lane-role-badge">${esc(roleLabel(lane.role))}</div>
        <div class="lane-versus">
          <strong>
            <span class="t1">${esc(lane.team1Champion || '—')}</span>
            <span class="vs">vs</span>
            <span class="t2">${esc(lane.team2Champion || '—')}</span>
          </strong>
          <span>${esc(laneSubline(lane))}</span>
        </div>
        <div class="lane-visual">
          <div class="lane-pressure-track">
            <span class="lane-pressure-fill ${esc(scoreCls)}" style="width:${scoreWidth.toFixed(1)}%"></span>
          </div>
          <div class="lane-signal-row">
            ${signalChip('WR', pct(lane.winrate_a), toneClass((safeNumber(lane.winrate_a) ?? 0.5) - 0.5))}
            ${signalChip('Oro', intFmt(gold15, 'g'), toneClass(gold15))}
            ${signalChip('XP', intFmt(xp15), toneClass(xp15))}
            ${signalChip('Excess', intFmt(excess15, 'g'), toneClass(excess15))}
            ${signalChip('Lvl 6', minutesFmt(level6Diff(lane)), toneClass(level6Diff(lane), true))}
          </div>
        </div>
        <div><span class="status-badge ${esc(lane.data_status)}">${esc(status)}</span></div>
      </article>
    `;
  }

  function signalChip(label, value, cls) {
    return `<span class="signal-chip ${esc(cls || '')}">${esc(label)} ${esc(value)}</span>`;
  }

  function level6Diff(lane) {
    const a = safeNumber(lane.avg_level6_minute_a);
    const b = safeNumber(lane.avg_level6_minute_b);
    if (a !== null && b !== null) return a - b;
    const pa = profileValue(lane.team1Profile, 'avg_level6_minute');
    const pb = profileValue(lane.team2Profile, 'avg_level6_minute');
    if (pa !== null && pb !== null) return pa - pb;
    return null;
  }

  function laneSubline(lane) {
    if (!lane.team1Champion || !lane.team2Champion) return 'selezione incompleta';
    if (lane.reason === 'same_champion') return 'input non valido';
    if (lane.data_status === 'exact') {
      const sample = isFiniteNumber(lane.n_matches) ? `${Math.round(lane.n_matches)} partite` : 'sample n/d';
      return `${sample}${lane.low_sample ? ' · campione ridotto' : ''}${lane.orientation === 'reverse' ? ' · orientato' : ''}`;
    }
    if (lane.data_status === 'fallback') return 'profilo campione, non matchup diretto';
    return 'dati insufficienti';
  }

  function laneStatusLabel(lane) {
    if (lane.data_status === 'exact') return lane.low_sample ? 'exact · low' : 'exact';
    if (lane.data_status === 'fallback') return 'fallback';
    return 'missing';
  }

  function laneMetric(label, value, cls) {
    return `
      <div class="lane-metric ${esc(cls || '')}">
        <span>${esc(label)}</span>
        <strong>${esc(value)}</strong>
      </div>
    `;
  }

  function renderDamageAndProfile(analysis) {
    byId('damageComposition').innerHTML = `
      ${stackRowHtml('Team 1', analysis.team1Profile.damageMix, 'team-a')}
      ${stackRowHtml('Team 2', analysis.team2Profile.damageMix, 'team-b')}
      <div class="dmg-legend">
        <span><i style="background:var(--dmg-phys)"></i>Fisico</span>
        <span><i style="background:var(--dmg-magic)"></i>Magico</span>
        <span><i style="background:var(--dmg-true)"></i>Puro</span>
      </div>
    `;

    const t1 = analysis.team1Profile.metrics;
    const t2 = analysis.team2Profile.metrics;
    byId('teamProfileStats').innerHTML = `
      <div class="metric-bars">
        ${metricCompareBar('Damage', t1.damageOutput, t2.damageOutput, compactNumber)}
        ${metricCompareBar('Frontline', t1.damageTaken, t2.damageTaken, compactNumber)}
        ${metricCompareBar('CC', t1.ccTotal, t2.ccTotal, compactNumber)}
        ${metricCompareBar('Vision', t1.vision, t2.vision, compactNumber)}
        ${metricCompareBar('Gold dep.', t1.goldDependency, t2.goldDependency, (v) => signedDecimal(v, 2))}
        ${metricCompareBar('XP dep.', t1.xpDependency, t2.xpDependency, (v) => signedDecimal(v, 2))}
      </div>
    `;
  }

  function stackRowHtml(label, mix, cls) {
    const phys = safeNumber(mix.physical) ?? 0;
    const magic = safeNumber(mix.magic) ?? 0;
    const pure = safeNumber(mix.true) ?? 0;
    const total = phys + magic + pure || 1;
    const p1 = phys / total;
    const p2 = magic / total;
    const p3 = pure / total;

    return `
      <div class="stack-row ${esc(cls)}">
        <div class="stack-row-head">
          <strong>${esc(label)}</strong>
          <span>${pct(p1, 0)} fisico · ${pct(p2, 0)} magico · ${pct(p3, 0)} puro</span>
        </div>
        <div class="stack-track">
          <div class="stack-seg" style="width:${Math.max(0, p1 * 100)}%;background:var(--dmg-phys)">${p1 >= 0.09 ? pct(p1, 0) : ''}</div>
          <div class="stack-seg" style="width:${Math.max(0, p2 * 100)}%;background:var(--dmg-magic)">${p2 >= 0.09 ? pct(p2, 0) : ''}</div>
          <div class="stack-seg" style="width:${Math.max(0, p3 * 100)}%;background:var(--dmg-true)">${p3 >= 0.09 ? pct(p3, 0) : ''}</div>
        </div>
      </div>
    `;
  }

  function metricCompareBar(label, valueA, valueB, formatter = compactNumber) {
    const a = safeNumber(valueA);
    const b = safeNumber(valueB);
    const max = Math.max(Math.abs(a ?? 0), Math.abs(b ?? 0), 1);
    const aw = a === null ? 0 : Math.min(100, Math.abs(a) / max * 100);
    const bw = b === null ? 0 : Math.min(100, Math.abs(b) / max * 100);
    return `
      <div class="metric-compare">
        <div class="metric-compare-label">${esc(label)}</div>
        <div class="metric-compare-bars">
          <div class="metric-mini-track"><span class="metric-mini-fill team-a" style="width:${aw.toFixed(1)}%"></span></div>
          <div class="metric-mini-track"><span class="metric-mini-fill team-b" style="width:${bw.toFixed(1)}%"></span></div>
        </div>
        <div class="metric-compare-value">${esc(formatter(a))}<br>${esc(formatter(b))}</div>
      </div>
    `;
  }

  function minutesPlain(value) {
    const n = safeNumber(value);
    return n === null ? '—' : `${n.toFixed(2)}m`;
  }

  function renderRadar(analysis) {
    const radarSets = [
      {
        title: 'Identità globale',
        note: 'Profilo medio normalizzato dei cinque pick.',
        axes: [
          ['winrate', 'WR'],
          ['damage', 'Danno'],
          ['durability', 'Tank'],
          ['cc', 'CC'],
          ['vision', 'Vision'],
          ['gold', 'Gold'],
          ['xp', 'XP'],
          ['level6', 'Lvl 6']
        ]
      },
      {
        title: 'Fight & controllo',
        note: 'Danno, durability, CC e visione.',
        axes: [
          ['damage', 'Danno'],
          ['durability', 'Tank'],
          ['cc', 'CC'],
          ['vision', 'Vision']
        ]
      },
      {
        title: 'Economia & tempo',
        note: 'Conversione risorse, AUC e timing livello 6.',
        axes: [
          ['winrate', 'WR'],
          ['gold', 'Gold'],
          ['xp', 'XP'],
          ['auc', 'AUC'],
          ['level6', 'Lvl 6']
        ]
      }
    ];

    byId('teamRadar').innerHTML = radarSets.map((set) => `
      <article class="radar-card">
        <div class="radar-card-head">
          <div>
            <h3>${esc(set.title)}</h3>
            <p>${esc(set.note)}</p>
          </div>
        </div>
        ${buildRadarSvg(set.axes, analysis.team1Profile.radar, analysis.team2Profile.radar, set.title)}
      </article>
    `).join('');
  }

  function buildRadarSvg(axes, aValues, bValues, title = 'Radar profilo team') {
    const width = 640;
    const height = 500;
    const cx = width / 2;
    const cy = height / 2 + 36;
    const radius = 168;

    const angleFor = (i) => -Math.PI / 2 + (i / axes.length) * Math.PI * 2;
    const point = (i, value) => {
      const pctVal = Math.max(0, Math.min(100, safeNumber(value) ?? 0)) / 100;
      const angle = angleFor(i);
      return [cx + Math.cos(angle) * radius * pctVal, cy + Math.sin(angle) * radius * pctVal];
    };

    const polygon = (values) => axes
      .map(([key], i) => point(i, values?.[key]).map((n) => n.toFixed(1)).join(','))
      .join(' ');

    const rings = [25, 50, 75, 100].map((r) => {
      const pts = axes.map((_, i) => {
        const angle = angleFor(i);
        return [
          cx + Math.cos(angle) * radius * (r / 100),
          cy + Math.sin(angle) * radius * (r / 100)
        ].map((n) => n.toFixed(1)).join(',');
      }).join(' ');
      return `<polygon points="${pts}" fill="none" stroke="var(--line-soft)" stroke-width="1"></polygon>`;
    }).join('');

    const spokes = axes.map(([key, label], i) => {
      const angle = angleFor(i);
      const x2 = cx + Math.cos(angle) * radius;
      const y2 = cy + Math.sin(angle) * radius;
      const lx = cx + Math.cos(angle) * (radius + 34);
      const ly = cy + Math.sin(angle) * (radius + 34);
      const anchor = Math.abs(Math.cos(angle)) < 0.25 ? 'middle' : Math.cos(angle) > 0 ? 'start' : 'end';
      return `
        <line x1="${cx}" y1="${cy}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="var(--line-soft)"></line>
        <text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" fill="var(--ink-faint)" font-size="13" font-weight="850" text-anchor="${anchor}">${esc(label)}</text>
      `;
    }).join('');

    const dots = (values, cls) => axes.map(([key], i) => {
      const [px, py] = point(i, values?.[key]);
      return `<circle class="radar-dot ${cls}" cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="4.8"></circle>`;
    }).join('');

    return `
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}">
        <text x="26" y="28" fill="var(--champ-a)" font-size="13" font-weight="850">Team 1</text>
        <text x="${width - 26}" y="28" fill="var(--champ-b)" font-size="13" font-weight="850" text-anchor="end">Team 2</text>
        ${rings}
        ${spokes}
        <polygon class="radar-fill-a" points="${polygon(aValues)}"></polygon>
        <polygon class="radar-fill-b" points="${polygon(bValues)}"></polygon>
        <polygon class="radar-line-a" points="${polygon(aValues)}"></polygon>
        <polygon class="radar-line-b" points="${polygon(bValues)}"></polygon>
        ${dots(aValues, 'team-a')}
        ${dots(bValues, 'team-b')}
      </svg>
    `;
  }

  function renderInsights(analysis) {
    const items = Array.isArray(analysis.insights) ? analysis.insights : [];
    byId('insightList').innerHTML = items.map((item) => {
      if (typeof item === 'string') {
        return `<div class="insight-item"><p>${esc(item)}</p></div>`;
      }
      const tone = item.tone || 'info';
      return `
        <article class="insight-item ${esc(tone)}">
          <div class="insight-top">
            <span class="insight-tag">${esc(item.tag || 'Insight')}</span>
            <span class="insight-impact">${esc(item.impact || '')}</span>
          </div>
          <strong>${esc(item.title || '')}</strong>
          <p>${esc(item.text || '')}</p>
        </article>
      `;
    }).join('');
  }

  function renderWarnings(analysis) {
    byId('warningList').innerHTML = analysis.warnings.map((item) => `
      <div class="warning-item ${item.level === 'critical' ? 'critical' : ''}">${esc(item.text)}</div>
    `).join('');
  }

  function renderRaw() {
    // Dettaglio tecnico rimosso dalla UI: manteniamo no-op per compatibilità.
  }

  function renderInputs() {
    const roles = roleOrder();
    byId('team1Slots').innerHTML = roles.map((role) => lanePickerHtml(role, 1)).join('');
    byId('team2Slots').innerHTML = roles.map((role) => lanePickerHtml(role, 2)).join('');

    state.comboControllers.forEach((ctrl) => ctrl.destroy?.());
    state.comboControllers = [];

    $$('.team-combobox').forEach((box) => {
      state.comboControllers.push(createCombobox(box));
    });
    syncInputsFromState();
  }

  function lanePickerHtml(role, team) {
    const placeholder = team === 1 ? 'Campione Team 1…' : 'Campione Team 2…';
    return `
      <div class="lane-picker" data-role="${esc(role)}" data-team="${team}">
        <div class="lane-role"><span>${esc(roleLabel(role))}</span></div>
        <div class="team-combobox" data-role="${esc(role)}" data-team="${team}">
          <input type="text" role="combobox" aria-expanded="false" aria-autocomplete="list" placeholder="${esc(placeholder)}" autocomplete="off">
          <div class="combo-list" role="listbox"></div>
        </div>
      </div>
    `;
  }

  function createCombobox(box) {
    const input = $('input', box);
    const list = $('.combo-list', box);
    const role = box.dataset.role;
    const team = Number(box.dataset.team);
    const options = championsForRole(role);
    let activeIndex = -1;
    let visible = [];

    function selectedMap() {
      return team === 1 ? state.team1 : state.team2;
    }

    function select(champion) {
      selectedMap()[role] = champion;
      input.value = champion;
      close();
      updateCounts();
      if (state.lastAnalysis) analyzeDraft();
    }

    function render(query = '') {
      const q = query.trim().toLowerCase();
      visible = options
        .map((champ) => ({ champ, score: scoreChampion(champ, q) }))
        .filter((item) => !q || item.score > 0)
        .sort((a, b) => b.score - a.score || localeSort(a.champ, b.champ))
        .slice(0, 80)
        .map((item) => item.champ);

      activeIndex = visible.length ? 0 : -1;
      list.innerHTML = visible.length
        ? visible.map((champ, index) => optionHtml(champ, index === activeIndex)).join('')
        : '<div class="combo-empty">Nessun campione trovato.</div>';
      list.classList.add('open');
      input.setAttribute('aria-expanded', 'true');
    }

    function close() {
      list.classList.remove('open');
      input.setAttribute('aria-expanded', 'false');
      activeIndex = -1;
    }

    input.addEventListener('input', () => {
      const exact = options.find((champ) => champ.toLowerCase() === input.value.trim().toLowerCase());
      if (!input.value.trim()) {
        delete selectedMap()[role];
        updateCounts();
      } else if (exact) {
        selectedMap()[role] = exact;
        updateCounts();
      }
      render(input.value);
    });

    input.addEventListener('focus', () => render(input.value));

    input.addEventListener('keydown', (event) => {
      if (!list.classList.contains('open') && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
        render(input.value);
        event.preventDefault();
        return;
      }
      if (event.key === 'ArrowDown') {
        activeIndex = Math.min(visible.length - 1, activeIndex + 1);
        paintActive(list, activeIndex);
        event.preventDefault();
      } else if (event.key === 'ArrowUp') {
        activeIndex = Math.max(0, activeIndex - 1);
        paintActive(list, activeIndex);
        event.preventDefault();
      } else if (event.key === 'Enter') {
        if (visible[activeIndex]) select(visible[activeIndex]);
        event.preventDefault();
      } else if (event.key === 'Escape') {
        close();
      }
    });

    list.addEventListener('mousedown', (event) => {
      const opt = event.target.closest('.combo-option');
      if (!opt) return;
      event.preventDefault();
      select(opt.dataset.champion);
    });

    document.addEventListener('mousedown', outside);

    function outside(event) {
      if (!box.contains(event.target)) close();
    }

    return {
      destroy() {
        document.removeEventListener('mousedown', outside);
      }
    };
  }

  function scoreChampion(champion, query) {
    const name = champion.toLowerCase();
    if (!query) return 1;
    if (name === query) return 100;
    if (name.startsWith(query)) return 80;
    if (name.includes(query)) return 45;
    const compact = name.replace(/[^a-z0-9]/g, '');
    const qCompact = query.replace(/[^a-z0-9]/g, '');
    return compact.includes(qCompact) ? 25 : 0;
  }

  function optionHtml(champion, active) {
    return `
      <div class="combo-option ${active ? 'active' : ''}" role="option" data-champion="${esc(champion)}">
        <span>${esc(champion)}</span>
        <span class="meta">pick</span>
      </div>
    `;
  }

  function paintActive(list, activeIndex) {
    $$('.combo-option', list).forEach((opt, index) => {
      opt.classList.toggle('active', index === activeIndex);
      if (index === activeIndex) opt.scrollIntoView({ block: 'nearest' });
    });
  }

  function syncInputsFromState() {
    $$('.team-combobox').forEach((box) => {
      const team = Number(box.dataset.team);
      const role = box.dataset.role;
      const input = $('input', box);
      input.value = (team === 1 ? state.team1[role] : state.team2[role]) || '';
    });
    updateCounts();
  }

  function updateCounts() {
    byId('team1Count').textContent = `${Object.values(state.team1).filter(Boolean).length} / ${roleOrder().length}`;
    byId('team2Count').textContent = `${Object.values(state.team2).filter(Boolean).length} / ${roleOrder().length}`;
  }

  function setSampleDraft() {
    const roles = roleOrder();
    roles.forEach((role) => {
      const top = topMatchupsForRole(role)[0];
      if (top) {
        state.team1[role] = top.champion_1 || top.championA || top.a;
        state.team2[role] = top.champion_2 || top.championB || top.b;
      } else {
        const opts = championsForRole(role);
        state.team1[role] = opts[0] || '';
        state.team2[role] = opts[1] || '';
      }
    });
    syncInputsFromState();
    analyzeDraft();
  }

  function topMatchupsForRole(role) {
    const top = DATA?.meta?.top_matchups_by_role?.[role] || DATA?.meta?.topMatchupsByRole?.[role];
    if (Array.isArray(top) && top.length) return top;

    const rows = [];
    Object.entries(matchupsForRole(role)).forEach(([a, opponents]) => {
      Object.entries(opponents || {}).forEach(([b, values]) => {
        const raw = objectFromColumns(DATA?.matchupColumns, values);
        rows.push({ champion_1: a, champion_2: b, n_matches: safeNumber(raw?.n_matches) ?? 0 });
      });
    });
    return rows.sort((x, y) => y.n_matches - x.n_matches).slice(0, 12);
  }

  function swapTeams() {
    const old1 = { ...state.team1 };
    state.team1 = { ...state.team2 };
    state.team2 = old1;
    syncInputsFromState();
    if (state.lastAnalysis) analyzeDraft();
  }

  function clearDraft() {
    state.team1 = {};
    state.team2 = {};
    state.lastAnalysis = null;
    syncInputsFromState();
    byId('analysisRegion').hidden = true;
    byId('emptyState').hidden = false;
    byId('emptyState').textContent = 'Seleziona almeno una coppia di campioni nella stessa corsia per iniziare.';
  }

  function bindActions() {
    byId('sampleDraftBtn')?.addEventListener('click', setSampleDraft);
    byId('swapTeamsBtn')?.addEventListener('click', swapTeams);
    byId('clearDraftBtn')?.addEventListener('click', clearDraft);
    byId('analyzeDraftBtn')?.addEventListener('click', analyzeDraft);
  }

  function setDataStatus(type, text) {
    const el = byId('dataStatus');
    if (!el) return;
    el.classList.remove('ready', 'error');
    if (type) el.classList.add(type);
    el.textContent = text;
  }

  function renderMeta() {
    const total = DATA?.meta?.total_matchups ?? DATA?.meta?.total_canonical_matchups ?? countCanonicalMatchups();
    const heroDataset = byId('heroDatasetCount');
    if (heroDataset) heroDataset.textContent = total ? Math.round(total).toLocaleString('it-IT') : '—';
    const heroRoles = byId('heroRoleCount');
    if (heroRoles) heroRoles.textContent = roleOrder().length;
    byId('footerStats').textContent = `Team Draft Lab · ${total ? Math.round(total).toLocaleString('it-IT') : '—'} matchup disponibili`;
  }

  function countCanonicalMatchups() {
    let count = 0;
    Object.values(DATA?.matchups || {}).forEach((roleMap) => {
      Object.values(roleMap || {}).forEach((oppMap) => {
        count += Object.keys(oppMap || {}).length;
      });
    });
    return count;
  }

  function fail(message) {
    setDataStatus('error', 'Dati assenti');
    byId('emptyState').hidden = false;
    byId('emptyState').textContent = message;
    byId('analysisRegion').hidden = true;
  }

  function init() {
    if (!DATA || !DATA.matchups || !DATA.matchupColumns) {
      fail('Dataset non disponibile: impossibile inizializzare Team Draft Lab.');
      return;
    }
    setDataStatus('ready', 'Dataset pronto');
    renderMeta();
    renderInputs();
    bindActions();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
