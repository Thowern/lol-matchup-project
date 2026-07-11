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

  const PHASES = [
    { key: 'early_0_10', label: '0–10', title: 'Primi 10 minuti' },
    { key: 'lane_10_15', label: '10–15', title: 'Minuti 10–15' },
    { key: 'mid_15_25', label: '15–25', title: 'Metà partita, minuti 15–25' },
    { key: 'late_25_plus', label: '25+', title: 'Dopo il minuto 25' }
  ];

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
    'avg_level6_minute',
    'avg_event_kills',
    'avg_event_deaths',
    'avg_kills_0_10m',
    'avg_deaths_0_10m',
    'avg_kills_0_15m',
    'avg_deaths_0_15m',
    'avg_bounty_gained',
    'avg_bounty_given',
    'avg_bounty_net',
    'avg_bounty_net_0_15m',
    'avg_bounty_per_kill',
    'avg_bounty_given_per_death',
    'avg_kill_streak_on_kill',
    'shutdown_collected_rate',
    'shutdown_given_rate'
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
    'tower_fall_diff_min_a_minus_b',
    'avg_kill_diff_15m_a_minus_b',
    'avg_death_diff_15m_a_minus_b',
    'avg_bounty_net_diff_15m_a_minus_b',
    'early_kd_pressure_15m_a_minus_b',
    'excess_kill_diff_15m_a_minus_b',
    'excess_death_diff_15m_a_minus_b',
    'excess_bounty_net_diff_15m_a_minus_b',
    'excess_early_kd_pressure_15m_a_minus_b',
    'gold_diff_without_bounty_15m_a_minus_b',
    'resource_winpct_pressure_estimate_a_15m',
    'monster_sequence_control_score_a',
    'monster_sequence_diff_total_a_minus_b'
  ];

  const TIMELINE_MODES = {
    gold: {
      label: 'Oro',
      field: 'gold_diff_by_minute',
      at15: 'gold15',
      suffix: ' oro',
      note: 'Somma il vantaggio in oro delle corsie con dati diretti. Positivo favorisce Team 1, negativo Team 2.'
    },
    xp: {
      label: 'XP',
      field: 'xp_diff_by_minute',
      at15: 'xp15',
      suffix: ' XP',
      note: 'Somma il vantaggio in esperienza delle corsie con dati diretti. Positivo favorisce Team 1, negativo Team 2.'
    },
    excessGold: {
      label: 'Oro specifico matchup',
      field: 'excess_gold_diff_by_minute',
      at15: 'excessGold15',
      suffix: ' oro',
      note: 'Mostra la parte del vantaggio in oro che nasce dagli accoppiamenti scelti, oltre a quella normalmente attesa dai campioni.'
    },
    excessXp: {
      label: 'XP specifica matchup',
      field: 'excess_xp_diff_by_minute',
      at15: 'excessXp15',
      suffix: ' XP',
      note: 'Mostra la parte del vantaggio in esperienza che nasce dagli accoppiamenti scelti, oltre a quella normalmente attesa dai campioni.'
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

  function pulseMotion(el, cls = 'is-spinning') {
    if (!el) return;
    el.classList.remove(cls);
    // Force reflow so repeated clicks replay the same motion consistently.
    void el.offsetWidth;
    el.classList.add(cls);
    window.setTimeout(() => el.classList.remove(cls), 620);
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
    if (Array.isArray(fromMeta) && fromMeta.length) return [...fromMeta].sort((a, b) => {
      const pa = DATA?.championProfiles?.[role]?.[a]?.coverage || {};
      const pb = DATA?.championProfiles?.[role]?.[b]?.coverage || {};
      return (safeNumber(pb.n_matchups) ?? 0) - (safeNumber(pa.n_matchups) ?? 0)
        || (safeNumber(pb.total_games) ?? 0) - (safeNumber(pa.total_games) ?? 0)
        || localeSort(a, b);
    });

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


  function profileComebackRisk(profile) {
    if (!profile) return null;
    const net = safeNumber(profile.avg_bounty_net);
    const shutdownRate = safeNumber(profile.shutdown_given_rate);
    if (net === null || shutdownRate === null) return null;
    return Math.max(0, net) * shutdownRate;
  }

  function weightedAverage(rows, valueFn, weightFn) {
    let total = 0;
    let weight = 0;
    rows.forEach((row) => {
      const value = safeNumber(valueFn(row));
      const w = Math.max(0, safeNumber(weightFn(row)) ?? 0);
      if (value === null || !w) return;
      total += value * w;
      weight += w;
    });
    return weight ? total / weight : null;
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

    if (!direct) {
      // Swap every real A/B pair present in the export, including fields added
      // by future dataset versions: no manually maintained partial list.
      Object.keys(raw).forEach((key) => {
        if (!key.endsWith('_a')) return;
        const bKey = `${key.slice(0, -2)}_b`;
        if (bKey in raw) {
          out[key] = raw[bKey] ?? null;
          out[bKey] = raw[key] ?? null;
        }
      });

      for (const field of SIGNED_ARRAY_FIELDS) out[field] = negateArray(raw[field]);

      const invariantDiffFields = new Set([
        'gold_per_kill_diff_15m_a_minus_b',
        'xp_per_kill_diff_15m_a_minus_b'
      ]);
      Object.keys(raw).forEach((key) => {
        if (key.endsWith('_a_minus_b') && !invariantDiffFields.has(key)) out[key] = negate(raw[key]);
      });

      [
        'resource_winpct_pressure_estimate_a_15m',
        'objective_conversion_score_a',
        'monster_sequence_control_score_a'
      ].forEach((key) => {
        if (key in raw) out[key] = negate(raw[key]);
      });

      Object.keys(raw).forEach((key) => {
        if (key.startsWith('pct_champion_a_') || key.startsWith('pct_a_')) out[key] = invertPct(raw[key]);
      });
      if ('monster_sequence_control_avg_a' in raw) out.monster_sequence_control_avg_a = invertPct(raw.monster_sequence_control_avg_a);

      // Gli eventi first-kill/first-death sono speculari, non complementari:
      // gli esiti senza kill restano fuori da entrambe le quote.
      if ('pct_a_first_kill_in_pair' in raw || 'pct_a_first_death_in_pair' in raw) {
        out.pct_a_first_kill_in_pair = safeNumber(raw.pct_a_first_death_in_pair);
        out.pct_a_first_death_in_pair = safeNumber(raw.pct_a_first_kill_in_pair);
      }
      // Il dataset non espone la quota avversaria né i pareggi per queste due
      // probabilità. Evitiamo quindi il falso complemento 1-p sul lato inverso.
      if ('pct_a_kill_adv_15m' in raw) out.pct_a_kill_adv_15m = null;
      if ('pct_a_bounty_net_adv_15m' in raw) out.pct_a_bounty_net_adv_15m = null;

      // Correlation, quality, conversion gap, volatility and kill-value ratios
      // are invariant when both the side and the outcome are mirrored.
      if ('winrate_a_when_ahead_15m' in raw || 'winrate_a_when_behind_15m' in raw) {
        out.winrate_a_when_ahead_15m = invertPct(raw.winrate_a_when_behind_15m);
        out.winrate_a_when_behind_15m = invertPct(raw.winrate_a_when_ahead_15m);
      }
    }

    // L'export corrente contiene first blood sempre a zero: zero non viene
    // interpretato come un 0% reale e non alimenta grafici o insight.
    if (safeNumber(out.pct_champion_a_first_blood) === 0) out.pct_champion_a_first_blood = null;
    out.comeback_risk_a = profileComebackRisk(out.team1Profile);
    out.comeback_risk_b = profileComebackRisk(out.team2Profile);
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
      const sequence = safeNumber(lane.monster_sequence_control_score_a);
      if (sequence !== null) values.push(sequence);

      getMonsterPctKeys(lane).forEach((key) => {
        const n = safeNumber(lane[key]);
        if (n !== null) values.push(n - 0.5);
      });

      Object.keys(lane).forEach((key) => {
        if (!key.startsWith('pct_a_secures_monster_')) return;
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

  function killPhaseFor(role, champion, phase) {
    return DATA?.killPhaseSummary?.[role]?.[champion]?.[phase] || null;
  }

  function phaseMetric(profile, field) {
    return safeNumber(profile?.[field]);
  }

  function aggregateKillPhaseForTeam(lanes, side) {
    const championKey = side === 1 ? 'team1Champion' : 'team2Champion';
    const result = {};
    PHASES.forEach((phase) => {
      const rows = lanes
        .map((lane) => killPhaseFor(lane.role, lane[championKey], phase.key))
        .filter(Boolean);

      result[phase.key] = {
        killEvents: sum(rows.map((r) => phaseMetric(r, 'kill_events_per_match'))),
        deathEvents: sum(rows.map((r) => phaseMetric(r, 'death_events_per_match'))),
        kdDiff: sum(rows.map((r) => phaseMetric(r, 'kill_death_event_diff_per_match'))),
        killWinrate: average(rows.map((r) => phaseMetric(r, 'kill_event_winrate'))),
        deathWinrate: average(rows.map((r) => phaseMetric(r, 'death_event_winrate'))),
        killBounty: average(rows.map((r) => phaseMetric(r, 'kill_avg_bounty'))),
        deathBounty: average(rows.map((r) => phaseMetric(r, 'death_avg_bounty'))),
        killStreak: average(rows.map((r) => phaseMetric(r, 'kill_avg_streak'))),
        bountyNet: sum(rows.map((r) => phaseMetric(r, 'bounty_net_per_match')))
      };
    });
    return result;
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

    let damageMix = damageWeighted.weight > 0 ? {
      physical: damageWeighted.physical / damageWeighted.weight,
      magic: damageWeighted.magic / damageWeighted.weight,
      true: damageWeighted.true / damageWeighted.weight
    } : {
      physical: average(damageSimple.physical),
      magic: average(damageSimple.magic),
      true: average(damageSimple.true)
    };
    const rawMixSum = sum([damageMix.physical, damageMix.magic, damageMix.true]);
    if (rawMixSum && rawMixSum > 0) damageMix = {
      physical: (damageMix.physical ?? 0) / rawMixSum,
      magic: (damageMix.magic ?? 0) / rawMixSum,
      true: (damageMix.true ?? 0) / rawMixSum
    };

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
      generalWinrate: average(profiles.map((p) => profileValue(p, 'general_winrate'))),
      eventKills: sum(profiles.map((p) => profileValue(p, 'avg_event_kills'))),
      eventDeaths: sum(profiles.map((p) => profileValue(p, 'avg_event_deaths'))),
      kills10: sum(profiles.map((p) => profileValue(p, 'avg_kills_0_10m'))),
      deaths10: sum(profiles.map((p) => profileValue(p, 'avg_deaths_0_10m'))),
      kills15: sum(profiles.map((p) => profileValue(p, 'avg_kills_0_15m'))),
      deaths15: sum(profiles.map((p) => profileValue(p, 'avg_deaths_0_15m'))),
      bountyGained: sum(profiles.map((p) => profileValue(p, 'avg_bounty_gained'))),
      bountyGiven: sum(profiles.map((p) => profileValue(p, 'avg_bounty_given'))),
      bountyNet: sum(profiles.map((p) => profileValue(p, 'avg_bounty_net'))),
      bountyNet15: sum(profiles.map((p) => profileValue(p, 'avg_bounty_net_0_15m'))),
      bountyPerKill: average(profiles.map((p) => profileValue(p, 'avg_bounty_per_kill'))),
      bountyPerDeath: average(profiles.map((p) => profileValue(p, 'avg_bounty_given_per_death'))),
      killStreak: average(profiles.map((p) => profileValue(p, 'avg_kill_streak_on_kill'))),
      shutdownCollected: average(profiles.map((p) => profileValue(p, 'shutdown_collected_rate'))),
      shutdownGiven: average(profiles.map((p) => profileValue(p, 'shutdown_given_rate'))),
      comebackRisk: sum(profiles.map(profileComebackRisk))
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
      level6: average(profiles.map((p) => profilePercentile(p, 'avg_level6_minute', true))),
      kill: average(profiles.map((p) => profilePercentile(p, 'avg_kills_0_15m'))),
      safety: average(profiles.map((p) => profilePercentile(p, 'avg_deaths_0_15m', true))),
      bounty: average(profiles.map((p) => profilePercentile(p, 'avg_bounty_net'))),
      bountyEfficiency: average(profiles.map((p) => profilePercentile(p, 'avg_bounty_per_kill'))),
      streak: average(profiles.map((p) => profilePercentile(p, 'avg_kill_streak_on_kill'))),
      shutdown: average(profiles.map((p) => profilePercentile(p, 'shutdown_collected_rate'))),
      shutdownSafety: average(profiles.map((p) => profilePercentile(p, 'shutdown_given_rate', true)))
    };

    return { side, count: profiles.length, entries, damageMix, metrics, radar, profileScore: average(Object.values(radar)) };
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

    const team1Profile = buildTeamProfile(lanes, 1);
    const team2Profile = buildTeamProfile(lanes, 2);
    const scalar = {
      gold15: valueFromTimeline(timelines.gold.points, REFERENCE_MINUTE),
      xp15: valueFromTimeline(timelines.xp.points, REFERENCE_MINUTE),
      excessGold15: valueFromTimeline(timelines.excessGold.points, REFERENCE_MINUTE),
      excessXp15: valueFromTimeline(timelines.excessXp.points, REFERENCE_MINUTE),
      avgDiffWinrate: average(exact.map((lane) => safeNumber(lane.diff_winrate_a))),
      avgMatchupWinrateEdge: average(exact.map((lane) => {
        const wr = safeNumber(lane.winrate_a); return wr === null ? null : wr - 0.5;
      })),
      avgSnowball: average(exact.map((lane) => safeNumber(lane.snowball_corr_15m))),
      avgSnowballQuality: average(exact.map((lane) => safeNumber(lane.snowball_quality_15m_a))),
      avgSnowballConversion: average(exact.map((lane) => safeNumber(lane.snowball_conversion_15m_a))),
      avgVolatility: average(exact.map((lane) => safeNumber(lane.gold_diff_std_15m))),
      volatilityIndex: average(exact.map((lane) => safeNumber(lane.volatility_15m_a))),
      objectiveEdge: average(exact.map(objectiveEdgeForLane)),
      firstBloodEdge: average(exact.map((lane) => {
        const p = safeNumber(lane.pct_champion_a_first_blood); return p === null ? null : p - 0.5;
      })),
      firstKillEdge: weightedAverage(exact, (lane) => {
        const first = safeNumber(lane.pct_a_first_kill_in_pair);
        const conceded = safeNumber(lane.pct_a_first_death_in_pair);
        return first === null || conceded === null ? null : first - conceded;
      }, (lane) => lane.n_matches),
      ahead15Edge: average(exact.map((lane) => {
        const p = safeNumber(lane.pct_a_ahead_15m); return p === null ? null : p - 0.5;
      })),
      towerRaceEdge: average(exact.map((lane) => {
        const p = safeNumber(lane.pct_champion_a_wins_tower_race); return p === null ? null : p - 0.5;
      })),
      towerTimingEdge: weightedAverage(exact, (lane) => lane.avg_tower_fall_diff_min_a_minus_b, (lane) => lane.n_matches),
      level6TimingEdge: sum(exact.map((lane) => {
        const a = safeNumber(lane.avg_level6_minute_a), b = safeNumber(lane.avg_level6_minute_b);
        return a === null || b === null ? null : b - a;
      })),
      goldDependencyEdge: sum(exact.map((lane) => safeNumber(lane.goldxp_gold_dependency_diff_a_minus_b))),
      xpDependencyEdge: sum(exact.map((lane) => safeNumber(lane.goldxp_xp_dependency_diff_a_minus_b))),
      killDiff15: sum(exact.map((lane) => safeNumber(lane.avg_kill_diff_15m_a_minus_b))),
      deathDiff15: sum(exact.map((lane) => safeNumber(lane.avg_death_diff_15m_a_minus_b))),
      bountyNetDiff15: sum(exact.map((lane) => safeNumber(lane.avg_bounty_net_diff_15m_a_minus_b))),
      kdPressure15: sum(exact.map((lane) => safeNumber(lane.early_kd_pressure_15m_a_minus_b))),
      excessKillDiff15: sum(exact.map((lane) => safeNumber(lane.excess_kill_diff_15m_a_minus_b))),
      excessDeathDiff15: sum(exact.map((lane) => safeNumber(lane.excess_death_diff_15m_a_minus_b))),
      excessBountyNet15: sum(exact.map((lane) => safeNumber(lane.excess_bounty_net_diff_15m_a_minus_b))),
      excessKdPressure15: sum(exact.map((lane) => safeNumber(lane.excess_early_kd_pressure_15m_a_minus_b))),
      goldWithoutBounty15: sum(exact.map((lane) => safeNumber(lane.gold_diff_without_bounty_15m_a_minus_b))),
      bountyShare: average(exact.map((lane) => safeNumber(lane.bounty_share_of_gold_diff_15m))),
      resourcePressure: sum(exact.map((lane) => safeNumber(lane.resource_winpct_pressure_estimate_a_15m))),
      goldPerKillEfficiency: weightedAverage(exact, (lane) => lane.gold_per_kill_diff_15m_a_minus_b, (lane) => lane.n_matches),
      xpPerKillEfficiency: weightedAverage(exact, (lane) => lane.xp_per_kill_diff_15m_a_minus_b, (lane) => lane.n_matches),
      killValueEfficiency: weightedAverage(exact, (lane) => lane.kill_value_efficiency_15m_a, (lane) => lane.n_matches),
      objectiveConversion: weightedAverage(exact, (lane) => lane.objective_conversion_score_a, (lane) => lane.n_matches),
      monsterSequenceControl: weightedAverage(exact, (lane) => lane.monster_sequence_control_score_a, (lane) => lane.monster_sequence_event_count_total),
      monsterSequenceDiff: sum(exact.map((lane) => safeNumber(lane.monster_sequence_diff_total_a_minus_b))),
      monsterSequenceEvents: sum(exact.map((lane) => safeNumber(lane.monster_sequence_event_count_total))),
      comebackRiskEdge: diffNullable(team1Profile.metrics.comebackRisk, team2Profile.metrics.comebackRisk),
      shutdownCollectionEdge: diffNullable(team1Profile.metrics.shutdownCollected, team2Profile.metrics.shutdownCollected),
      shutdownExposureEdge: diffNullable(team1Profile.metrics.shutdownGiven, team2Profile.metrics.shutdownGiven),
      streakEdge: diffNullable(team1Profile.metrics.killStreak, team2Profile.metrics.killStreak),
      aucEdge: diffNullable(team1Profile.metrics.auc, team2Profile.metrics.auc)
    };

    // La quota bounty aggregata va calcolata sul lead totale, non come media
    // semplice di rapporti lane-by-lane (instabile quando un gold diff è vicino a zero).
    if (safeNumber(scalar.gold15) !== null && Math.abs(scalar.gold15) >= 1 && safeNumber(scalar.goldWithoutBounty15) !== null) {
      scalar.bountyShare = (scalar.gold15 - scalar.goldWithoutBounty15) / scalar.gold15;
    }

    const killPhase = { team1: aggregateKillPhaseForTeam(lanes, 1), team2: aggregateKillPhaseForTeam(lanes, 2) };
    const profileEdge = edgeFromTeamProfiles(team1Profile, team2Profile);
    const outlook = computeDraftOutlook({ lanes, exact, fallback, missing, scalar, team1Profile, team2Profile, profileEdge });
    const analysis = { lanes, exact, fallback, missing, timelines, scalar, team1Profile, team2Profile, killPhase, profileEdge, outlook };
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
      { id: 'killPressure', value: normalizeComponent(ctx.scalar.kdPressure15, 10) },
      { id: 'excessKillPressure', value: normalizeComponent(ctx.scalar.excessKdPressure15, 8) },
      { id: 'bountyNet', value: normalizeComponent(ctx.scalar.bountyNetDiff15, 1800) },
      { id: 'resourcePressure', value: normalizeComponent(ctx.scalar.resourcePressure, 35) },
      { id: 'objectiveEdge', value: normalizeComponent(ctx.scalar.objectiveEdge, 0.12) },
      { id: 'objectiveConversion', value: normalizeComponent(ctx.scalar.objectiveConversion, 0.12) },
      { id: 'monsterSequence', value: normalizeComponent(ctx.scalar.monsterSequenceControl, 0.24) },
      { id: 'comebackSafety', value: normalizeComponent(negate(ctx.scalar.comebackRiskEdge), 1800) },
      { id: 'profileEdge', value: normalizeComponent(ctx.profileEdge, 0.35) }
    ].filter((component) => component.value !== null);

    const score = average(components.map((component) => component.value)) ?? 0;
    const abs = Math.abs(score);
    let label, tone;
    if (score >= 0.45) { label = 'Team 1 nettamente favorito dai dati'; tone = 'team-a'; }
    else if (score >= 0.15) { label = 'Team 1 leggermente favorito'; tone = 'team-a'; }
    else if (score <= -0.45) { label = 'Team 2 nettamente favorito dai dati'; tone = 'team-b'; }
    else if (score <= -0.15) { label = 'Team 2 leggermente favorito'; tone = 'team-b'; }
    else { label = 'Draft molto equilibrato'; tone = 'balanced'; }
    return { score, label, tone, strength: abs >= 0.45 ? 'chiaro' : abs >= 0.15 ? 'leggero' : 'sottile', components };
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
      byId('emptyState').textContent = 'Seleziona almeno una corsia completa.';
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
    const lowSamplePenalty = exact.length && exact.filter((lane) => lane.low_sample).length / exact.length >= 0.5 ? 8 : 0;
    const add = (tag, title, text, priority, tone = 'info', impact = null) => {
      if (!text) return;
      const adjusted = tag === 'Affidabilità' ? priority : Math.max(0, priority - lowSamplePenalty);
      items.push({ tag, title, text, priority: adjusted, rawPriority: priority, tone, impact: impact || impactLabel(adjusted) });
    };
    const toneFromValue = (value, inverse = false) => {
      const n = safeNumber(value); if (n === null || Math.abs(n) < 0.0001) return 'info';
      const t1 = inverse ? n < 0 : n > 0; return t1 ? 'team-a' : 'team-b';
    };
    const sideFromValue = (value, inverse = false) => {
      const n = safeNumber(value); if (n === null || Math.abs(n) < 0.0001) return 'nessun team';
      const t1 = inverse ? n < 0 : n > 0; return t1 ? 'Team 1' : 'Team 2';
    };
    const sameSign = (a, b) => safeNumber(a) !== null && safeNumber(b) !== null && Math.sign(a) === Math.sign(b) && Math.abs(a) > 0.0001 && Math.abs(b) > 0.0001;

    const componentLabels = {
      diffWinrate: 'quanto il matchup cambia il rendimento abituale', matchupWinrate: 'risultati dei confronti diretti', gold15: 'vantaggio totale in oro al minuto 15',
      xp15: 'vantaggio totale in XP al minuto 15', excessGold15: 'oro che nasce dagli accoppiamenti scelti al minuto 15', killPressure: 'saldo kill-morti',
      excessKillPressure: 'saldo degli scontri che nasce dagli accoppiamenti scelti', bountyNet: 'saldo delle taglie', resourcePressure: 'quanto bene la squadra trasforma oro e livelli in vittorie',
      objectiveEdge: 'controllo delle prime azioni e degli obiettivi', objectiveConversion: 'quanto spesso la pressione diventa torri o obiettivi', monsterSequence: 'controllo della sequenza di obiettivi neutrali',
      comebackSafety: 'quanto poco oro viene esposto alle taglie da campioni in serie', profileEdge: 'punti forti complessivi dei dieci campioni'
    };
    const topComponent = [...(analysis.outlook.components || [])]
      .filter((c) => safeNumber(c.value) !== null)
      .sort((a, b) => Math.abs(safeNumber(b.value)) - Math.abs(safeNumber(a.value)))[0];
    if (topComponent && Math.abs(safeNumber(topComponent.value)) >= 0.18) {
      add('Motivo principale', `${componentLabels[topComponent.id] || topComponent.id} pesa più degli altri segnali`,
        `${sideFromValue(topComponent.value)} è favorito soprattutto da ${componentLabels[topComponent.id] || topComponent.id}. Usalo come punto di partenza per il piano partita, poi controlla se corsie, oro, XP e obiettivi raccontano la stessa storia.`,
        99, toneFromValue(topComponent.value), 'Molto alto');
    }

    const laneScores = analysis.lanes.map((lane) => ({ lane, score: lanePressureScore(lane) }))
      .filter((x) => safeNumber(x.score) !== null)
      .sort((a, b) => Math.abs(safeNumber(b.score)) - Math.abs(safeNumber(a.score)));
    const topLane = laneScores[0];
    if (topLane && Math.abs(safeNumber(topLane.score)) >= 0.26) {
      add('Corsia chiave', `${roleLabel(topLane.lane.role)} è la corsia più importante del draft`,
        `${sideFromValue(topLane.score)} mostra il vantaggio più chiaro in ${roleLabel(topLane.lane.role)}. ${topLane.lane.data_status === 'fallback' ? 'La stima usa il rendimento generale dei campioni perché non ci sono abbastanza partite dirette.' : 'Il risultato combina percentuale di vittorie, oro, XP, scambi e controllo della mappa.'}`,
        97, toneFromValue(topLane.score), 'Molto alto');
    }
    const strongLanes = laneScores.filter((x) => Math.abs(safeNumber(x.score)) >= 0.22);
    const t1Strong = strongLanes.filter((x) => safeNumber(x.score) > 0);
    const t2Strong = strongLanes.filter((x) => safeNumber(x.score) < 0);
    if (t1Strong.length >= 2 || t2Strong.length >= 2) {
      const group = t1Strong.length >= t2Strong.length ? t1Strong : t2Strong;
      const side = group === t1Strong ? 'Team 1' : 'Team 2';
      add('Mappa', `${side} può giocare da più corsie`, `${group.slice(0, 3).map((x) => roleLabel(x.lane.role)).join(', ')} mostrano segnali coerenti. È più stabile di una sola lane forte e riduce la dipendenza da un unico piano.`, 92, group === t1Strong ? 'team-a' : 'team-b', 'Alto');
    } else if (t1Strong.length && t2Strong.length) {
      add('Mappa', 'Le due squadre hanno vantaggi in corsie diverse', `${roleLabel(t1Strong[0].lane.role)} tende verso Team 1, mentre ${roleLabel(t2Strong[0].lane.role)} tende verso Team 2. Il primo movimento può ridisegnare l’intera mappa.`, 88, 'info', 'Alto');
    }

    const snow = snowballLeader(analysis);
    if (snow) {
      const sensitivity = laneSnowballSensitivity(snow.lane);
      const pressure = lanePressureScore(snow.lane);
      if (safeNumber(sensitivity) !== null && sensitivity >= 0.12) {
        add('Primo vantaggio', `${roleLabel(snow.lane.role)} punisce di più chi resta indietro`,
          `Essere avanti invece che indietro al minuto 15 cambia la percentuale di vittorie di ${formatPpAbs(sensitivity)}. ${Math.abs(safeNumber(pressure) ?? 0) >= 0.14 ? `In questa corsia i dati favoriscono ${sideFromValue(pressure)}.` : 'Il valore mostra quanto pesa il primo vantaggio, ma da solo non favorisce una squadra.'}`,
          sensitivity >= 0.22 ? 97 : 90, snowballToneClass(sensitivity), sensitivity >= 0.22 ? 'Molto alto' : 'Alto');
      }
    }
    if (safeNumber(analysis.scalar.avgSnowballQuality) !== null && analysis.scalar.avgSnowballQuality >= 40 && safeNumber(analysis.scalar.avgSnowballConversion) !== null && analysis.scalar.avgSnowballConversion >= 0.22) {
      add('Solidità del vantaggio', 'Il draft sfrutta bene i vantaggi ottenuti nei primi minuti', `Quando una corsia va avanti, mantiene il vantaggio e lo trasforma in vittorie più spesso del normale. Il margine tende quindi a restare utile anche nella parte centrale della partita.`, 86, 'warning', 'Alto');
    }

    const gold15 = safeNumber(analysis.scalar.gold15);
    const excess = safeNumber(analysis.scalar.excessGold15);
    const goldNoBounty = safeNumber(analysis.scalar.goldWithoutBounty15);
    if (gold15 !== null && Math.abs(gold15) >= 650) {
      const driver = strongestLaneBy(exact, (lane) => valueAtMinute(lane.gold_diff_by_minute, lane.minutes), Math.sign(gold15));
      add('Economia', `${sideFromValue(gold15)} arriva mediamente avanti in oro al minuto 15`, `${intFmt(gold15, 'g')} sommando le corsie con dati diretti${driver ? `, soprattutto grazie a ${roleLabel(driver.role)}` : ''}. Il valore specifico dei matchup indica quanto di questo vantaggio nasce davvero dagli accoppiamenti scelti.`, 87, toneFromValue(gold15), 'Alto');
    }
    if (gold15 !== null && excess !== null && Math.abs(excess) >= 450) {
      if (sameSign(gold15, excess)) add('Vantaggio specifico', 'Il vantaggio in oro nasce anche dai matchup scelti', `${sideFromValue(excess)} resta avanti anche dopo aver considerato il rendimento abituale dei campioni.`, 85, toneFromValue(excess), 'Alto');
      else if (Math.abs(gold15) >= 450) add('Vantaggio specifico', 'L’oro totale e il vantaggio specifico raccontano storie diverse', `${sideFromValue(gold15)} è avanti nell’oro totale, ma il dato corretto non conferma lo stesso lato: il margine può derivare più dalla forza abituale dei campioni che dagli accoppiamenti diretti.`, 91, 'warning', 'Alto');
    }
    if (gold15 !== null && goldNoBounty !== null && Math.abs(gold15) >= 700) {
      if (Math.sign(gold15) !== Math.sign(goldNoBounty)) add('Attenzione alle taglie', 'Le taglie cambiano completamente il vantaggio in oro', `Con le taglie il vantaggio è ${intFmt(gold15)}, senza taglie sarebbe ${intFmt(goldNoBounty)}. Il margine è fragile e può cambiare con una sola morte ad alto valore.`, 96, 'danger', 'Molto alto');
      else if (safeNumber(analysis.scalar.bountyShare) !== null && Math.abs(analysis.scalar.bountyShare) >= 0.9) add('Attenzione alle taglie', 'Gran parte del vantaggio in oro dipende dalle taglie', `Le taglie spiegano in media ${signedPct(analysis.scalar.bountyShare)} del vantaggio; senza taglie il margine è ${intFmt(goldNoBounty)}. La squadra avanti deve evitare morti isolate, perché una sola taglia importante può riaprire la partita.`, 88, 'warning', 'Alto');
    }

    const kd = safeNumber(analysis.scalar.kdPressure15);
    const exKd = safeNumber(analysis.scalar.excessKdPressure15);
    if (kd !== null && Math.abs(kd) >= 3) {
      const clean = exKd !== null && Math.abs(exKd) >= 2 && sameSign(kd, exKd);
      add('Scambi', `${sideFromValue(kd)} ottiene scambi migliori nei primi 15 minuti`, `Il saldo kill-morti complessivo è ${signedDecimal(kd, 2)}${exKd !== null ? `; la parte specifica dei matchup è ${signedDecimal(exKd, 2)}` : ''}. ${clean ? 'Anche dopo aver considerato il rendimento abituale dei campioni, il vantaggio resta.' : 'Una parte del risultato può dipendere dalle caratteristiche generali dei campioni.'}`, clean ? 92 : 84, toneFromValue(kd), clean ? 'Alto' : 'Medio-alto');
    } else if (kd !== null && exKd !== null && Math.sign(kd) !== Math.sign(exKd) && Math.abs(exKd) >= 2) {
      add('Scambi', 'Guardare soltanto il numero di kill può ingannare', 'Il numero totale di kill e l’effetto reale degli accoppiamenti favoriscono lati diversi: guarda anche morti, oro e taglie prima di scegliere come giocare.', 89, 'warning', 'Alto');
    }

    const bountyNet = safeNumber(analysis.scalar.bountyNetDiff15);
    const excessBounty = safeNumber(analysis.scalar.excessBountyNet15);
    if (bountyNet !== null && Math.abs(bountyNet) >= 350) add('Taglie', `${sideFromValue(bountyNet)} ottiene più oro utile dalle taglie`, `Il saldo taglie al minuto 15 è ${intFmt(bountyNet)}${excessBounty !== null ? `; la parte specifica dei matchup è ${intFmt(excessBounty)}` : ''}. Questo dato misura l’oro prodotto dagli scontri, non soltanto quante kill vengono fatte.`, 83, toneFromValue(bountyNet), 'Medio-alto');

    const resource = safeNumber(analysis.scalar.resourcePressure);
    if (resource !== null && Math.abs(resource) >= 8) add('Risorse', `${sideFromValue(resource)} sfrutta meglio il vantaggio di oro e XP`, `Oro e livelli spostano maggiormente le possibilità di vittoria verso ${sideFromValue(resource)}. Tiene conto sia di chi ottiene più oro e XP sia di quanto i campioni scelti riescono normalmente a trasformarli in vittorie.`, Math.abs(resource) >= 18 ? 92 : 84, toneFromValue(resource), 'Alto');

    const firstKillEdge = safeNumber(analysis.scalar.firstKillEdge);
    if (firstKillEdge !== null && Math.abs(firstKillEdge) >= 0.055) {
      add('Primo evento', `${sideFromValue(firstKillEdge)} apre più spesso il duello`, `Margine di prima kill nella coppia ${signedPct(firstKillEdge)}. Gli esiti senza kill non vengono forzati nel confronto.`, Math.abs(firstKillEdge) >= 0.12 ? 87 : 73, toneFromValue(firstKillEdge), Math.abs(firstKillEdge) >= 0.12 ? 'Alto' : 'Medio');
    }

    const level6 = safeNumber(analysis.scalar.level6TimingEdge);
    if (level6 !== null && Math.abs(level6) >= 0.35) {
      add('Timing', `${sideFromValue(level6)} raggiunge prima il livello 6`, `Vantaggio aggregato di timing ${Math.abs(level6).toFixed(2)} minuti. È una finestra concreta per contest, roam e primo reset coordinato.`, Math.abs(level6) >= 0.8 ? 86 : 72, toneFromValue(level6), Math.abs(level6) >= 0.8 ? 'Alto' : 'Medio');
    }

    const towerTiming = safeNumber(analysis.scalar.towerTimingEdge);
    if (towerTiming !== null && Math.abs(towerTiming) >= 1.5) {
      add('Strutture', `${sideFromValue(towerTiming)} tende a mantenere le torri più a lungo`, `Differenza media di caduta ${minutesFmt(towerTiming)}. Il segnale descrive tenuta della struttura e accesso anticipato alla mappa.`, Math.abs(towerTiming) >= 3.5 ? 82 : 69, toneFromValue(towerTiming), 'Medio');
    }

    const goldDep = safeNumber(analysis.scalar.goldDependencyEdge);
    const xpDep = safeNumber(analysis.scalar.xpDependencyEdge);
    if ((goldDep !== null && Math.abs(goldDep) >= 12) || (xpDep !== null && Math.abs(xpDep) >= 12)) {
      const driver = Math.abs(goldDep ?? 0) >= Math.abs(xpDep ?? 0) ? goldDep : xpDep;
      const resourceName = driver === goldDep ? 'oro' : 'XP';
      add('Dipendenza', `${sideFromValue(driver)} è più dipendente da ${resourceName}`, `Differenza complessiva nell’impatto dell’oro ${signedDecimal(goldDep, 1)} · dell’XP ${signedDecimal(xpDep, 1)}. Se quel lato perde accesso alle risorse, la composizione perde efficacia più rapidamente.`, 74, 'warning', 'Medio');
    }

    const goldPerKill = safeNumber(analysis.scalar.goldPerKillEfficiency);
    const xpPerKill = safeNumber(analysis.scalar.xpPerKillEfficiency);
    if ((goldPerKill !== null && Math.abs(goldPerKill) >= 950) || (xpPerKill !== null && Math.abs(xpPerKill) >= 950)) {
      add('Impatto di una kill', 'Una singola kill può spostare molte risorse', `Oro ottenuto per ogni kill in più rispetto alle morti ${compactNumber(goldPerKill)} · XP ottenuta ${compactNumber(xpPerKill)}. È un indicatore neutro: mostra quanto uno scontro può spostare la partita, non chi lo vincerà.`, 78, 'warning', 'Medio-alto');
    }

    const objective = safeNumber(analysis.scalar.objectiveEdge);
    const sequence = safeNumber(analysis.scalar.monsterSequenceControl);
    if (sequence !== null && Math.abs(sequence) >= 0.08 && (analysis.scalar.monsterSequenceEvents ?? 0) >= 8) add('Sequenza degli obiettivi', `${sideFromValue(sequence)} controlla meglio la serie di obiettivi neutrali`, `L’indicatore di controllo è ${signedDecimal(sequence, 3)}, con una differenza totale di ${signedDecimal(analysis.scalar.monsterSequenceDiff, 1)} obiettivi su ${compactNumber(analysis.scalar.monsterSequenceEvents)} eventi.`, Math.abs(sequence) >= 0.18 ? 91 : 81, toneFromValue(sequence), 'Alto');
    else if (objective !== null && Math.abs(objective) >= 0.025) add('Prime azioni importanti', `${sideFromValue(objective)} controlla più spesso le prime azioni della partita`, `Il margine medio è ${signedPct(objective)} considerando prima kill, prima torre e obiettivi disponibili.`, 77, toneFromValue(objective), 'Medio');

    const jungle = exact.find((lane) => lane.role === 'JUNGLE');
    if (jungle) {
      const monsterDriver = Object.keys(jungle)
        .filter((key) => key.startsWith('pct_a_secures_monster_') && safeNumber(jungle[key]) !== null)
        .map((key) => {
          const suffix = key.replace('pct_a_secures_monster_', '');
          return { key, edge: safeNumber(jungle[key]) - 0.5, events: safeNumber(jungle[`event_count_${suffix}`]), label: monsterDisplayName(key) };
        })
        .filter((row) => (row.events ?? 0) >= 10)
        .sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge))[0];
      if (monsterDriver && Math.abs(monsterDriver.edge) >= 0.075) {
        add('Obiettivo più sbilanciato', `${monsterDriver.label} è l’obiettivo con la differenza più chiara`, `${sideFromValue(monsterDriver.edge)} lo conquista nel ${pct(0.5 + Math.abs(monsterDriver.edge), 0)} dei casi considerati, su ${compactNumber(monsterDriver.events)} eventi.`, Math.abs(monsterDriver.edge) >= 0.15 ? 84 : 71, toneFromValue(monsterDriver.edge), 'Medio-alto');
      }
    }

    const comeback = safeNumber(analysis.scalar.comebackRiskEdge);
    if (comeback !== null && Math.abs(comeback) >= 500) add('Rischio di rimonta', `${sideFromValue(comeback)} rischia di regalare più oro con una taglia importante`, `Il valore potenzialmente esposto è ${compactNumber(analysis.team1Profile.metrics.comebackRisk)} per Team 1 e ${compactNumber(analysis.team2Profile.metrics.comebackRisk)} per Team 2. La squadra più esposta deve evitare morti isolate, richiami in base rischiosi e corsie laterali senza copertura.`, Math.abs(comeback) >= 1200 ? 89 : 76, toneFromValue(comeback, true), 'Alto');

    const shutdownExposure = safeNumber(analysis.scalar.shutdownExposureEdge);
    const shutdownCollection = safeNumber(analysis.scalar.shutdownCollectionEdge);
    if ((shutdownExposure !== null && Math.abs(shutdownExposure) >= 0.055) || (shutdownCollection !== null && Math.abs(shutdownCollection) >= 0.055)) {
      const riskSide = shutdownExposure !== null && Math.abs(shutdownExposure) >= 0.055 ? shutdownExposure : negate(shutdownCollection);
      add('Gestione delle taglie', `${sideFromValue(riskSide)} ha il profilo di taglie più rischioso`, `Differenza nelle taglie importanti regalate ${signedPct(shutdownExposure)} · incassate ${signedPct(shutdownCollection)}. Quando il campione più importante ha una taglia alta, proteggerlo vale spesso più di forzare uno scontro poco importante.`, 70, 'warning', 'Medio');
    }

    const volatile = maxBy(exact, (lane) => safeNumber(lane.volatility_15m_a) ?? safeNumber(lane.gold_diff_std_15m));
    const volatileIndex = safeNumber(volatile?.volatility_15m_a);
    const volatileStd = safeNumber(volatile?.gold_diff_std_15m);
    if (volatile && ((volatileIndex !== null && volatileIndex >= 9) || (volatileStd !== null && volatileStd >= 1700))) add('Partite variabili', `${roleLabel(volatile.role)} è la corsia che può cambiare di più da una partita all’altra`, `L’oro oscilla mediamente di ${compactNumber(volatileStd)} tra una partita e l’altra. Prepara più di un piano: questa corsia può diventare favorevole o difficile molto rapidamente.`, 76, 'warning', 'Medio');

    const phaseEdges = PHASES.map((phase) => ({
      phase,
      kd: diffNullable(analysis.killPhase.team1[phase.key]?.kdDiff, analysis.killPhase.team2[phase.key]?.kdDiff),
      bounty: diffNullable(analysis.killPhase.team1[phase.key]?.bountyNet, analysis.killPhase.team2[phase.key]?.bountyNet)
    })).sort((a, b) => (Math.abs(b.kd ?? 0) + Math.abs(b.bounty ?? 0) / 300) - (Math.abs(a.kd ?? 0) + Math.abs(a.bounty ?? 0) / 300));
    const phaseDriver = phaseEdges[0];
    if (phaseDriver && (Math.abs(phaseDriver.kd ?? 0) >= 0.45 || Math.abs(phaseDriver.bounty ?? 0) >= 180)) {
      const phaseValue = Math.abs(phaseDriver.kd ?? 0) >= 0.45 ? phaseDriver.kd : phaseDriver.bounty;
      add('Fase chiave', `${phaseDriver.phase.title} è la fase in cui le squadre differiscono di più`, `${sideFromValue(phaseValue)} va meglio in questa fase: il saldo kill-morti per partita è ${signedDecimal(phaseDriver.kd, 2)} e la differenza nel saldo taglie è ${intFmt(phaseDriver.bounty)}.`, 80, toneFromValue(phaseValue), 'Medio-alto');
    }

    const ccDiff = diffMetric(analysis.team1Profile, analysis.team2Profile, 'ccTotal');
    const visionDiff = diffMetric(analysis.team1Profile, analysis.team2Profile, 'vision');
    if (ccDiff !== null && Math.abs(ccDiff) >= 25) add('Combattimenti', `${sideFromValue(ccDiff)} ha più strumenti per fermare e ingaggiare i nemici`, `La squadra ha più stun, root, rallentamenti e altri controlli: è quindi più facile iniziare uno scontro, bloccare un bersaglio e combattere in modo coordinato.`, 72, toneFromValue(ccDiff), 'Medio');
    if (visionDiff !== null && Math.abs(visionDiff) >= 28) add('Visione', `${sideFromValue(visionDiff)} tende ad avere più controllo della visione`, 'È una tendenza media dei campioni scelti: può facilitare preparazione degli obiettivi e controllo degli ingressi, ma non misura la qualità reale delle ward dei giocatori.', 68, toneFromValue(visionDiff), 'Medio');

    const addDamageInsight = (teamName, mix, tone) => {
      const phys = safeNumber(mix.physical), magic = safeNumber(mix.magic), pure = safeNumber(mix.true);
      if (phys !== null && phys >= 0.66) add('Danni', `${teamName} infligge soprattutto danno fisico`, `Il ${pct(phys, 0)} del danno è fisico: l’armatura avversaria diventa particolarmente efficace.`, 66, tone, 'Medio');
      else if (magic !== null && magic >= 0.58) add('Danni', `${teamName} infligge soprattutto danno magico`, `Il ${pct(magic, 0)} del danno è magico: la resistenza magica avversaria acquista più valore.`, 66, tone, 'Medio');
      else if (pure !== null && pure >= 0.11) add('Danni', `${teamName} ha una quota importante di danno puro`, `Il ${pct(pure, 0)} del danno è puro e ignora armatura e resistenza magica, quindi è più difficile ridurlo con una sola difesa.`, 62, tone, 'Medio-basso');
    };
    addDamageInsight('Team 1', analysis.team1Profile.damageMix, 'team-a');
    addDamageInsight('Team 2', analysis.team2Profile.damageMix, 'team-b');

    const lowRoles = exact.filter((lane) => lane.low_sample).map((lane) => roleLabel(lane.role));
    if (lowRoles.length) add('Affidabilità', `${lowRoles.join(', ')} ${lowRoles.length === 1 ? 'ha' : 'hanno'} poche partite disponibili`, 'I consigli basati su queste corsie ricevono meno peso, perché il risultato può cambiare più facilmente con nuove partite.', 64, 'warning', 'Medio');
    if (!items.length) add('Sintesi', 'Nessun aspetto favorisce nettamente una squadra', 'Il draft è equilibrato: usa le sezioni per trovare finestre specifiche, come una corsia sensibile al primo vantaggio o una composizione troppo dipendente da un solo tipo di danno.', 50, 'info', 'Medio');

    const ranked = items.sort((a, b) => b.priority - a.priority || b.rawPriority - a.rawPriority);
    const veryHigh = ranked.filter((item) => item.priority >= 92).length;
    const limit = veryHigh >= 6 ? 6 : 5;
    const selected = [];
    const tags = new Set();
    ranked.forEach((item) => {
      if (selected.length >= limit || item.priority < 61 || tags.has(item.tag)) return;
      selected.push(item); tags.add(item.tag);
    });
    ranked.forEach((item) => {
      if (selected.length >= limit || selected.includes(item)) return;
      if (item.priority >= 61 || selected.length < 4) selected.push(item);
    });
    return selected.slice(0, limit);
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
    renderAdvancedMetrics(analysis);
    renderKillPhase(analysis);
    renderRadar(analysis);
    renderInsights(analysis);
    renderWarnings(analysis);
    renderRaw(analysis);
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
          <div class="micro-label">Sintesi del draft</div>
          <h2 class="outlook-title" id="outlookTitle">${esc(analysis.outlook.label)}</h2>
          <p class="outlook-copy">${esc(copy)}</p>
        </div>
        <div class="outlook-score ${esc(analysis.outlook.tone)}" title="Bilancio tra più segnali del draft. Non è una percentuale di vittoria.">
          <div>
            <strong>${signedDecimal(score, 2)}</strong>
            <span>bilancio del draft</span>
          </div>
        </div>
      </div>
      <p class="plain-language-note"><strong>Come leggere il bilancio:</strong> combina fino a 14 segnali — corsie, oro, XP, scontri, taglie, obiettivi e caratteristiche dei campioni — dopo averli portati sulla stessa scala. Ogni segnale disponibile conta allo stesso modo; i valori estremi vengono limitati e i dati mancanti non vengono inventati. Il risultato va da −1 a +1: vicino a 0 significa equilibrio. Non è una probabilità di vittoria.</p>
      <div class="kpi-grid">
        ${kpiHtml('Oro @15', intFmt(analysis.scalar.gold15, 'g'), teamNameFromValue(analysis.scalar.gold15), toneClass(analysis.scalar.gold15))}
        ${kpiHtml('XP @15', intFmt(analysis.scalar.xp15), teamNameFromValue(analysis.scalar.xp15), toneClass(analysis.scalar.xp15))}
        ${kpiHtml('Saldo kill-morti', signedDecimal(analysis.scalar.kdPressure15, 2), teamNameFromValue(analysis.scalar.kdPressure15), toneClass(analysis.scalar.kdPressure15))}
        ${kpiHtml('Saldo taglie', intFmt(analysis.scalar.bountyNetDiff15), teamNameFromValue(analysis.scalar.bountyNetDiff15), toneClass(analysis.scalar.bountyNetDiff15))}
        ${kpiHtml('Oro dovuto ai matchup', intFmt(analysis.scalar.excessGold15, 'g'), teamNameFromValue(analysis.scalar.excessGold15), toneClass(analysis.scalar.excessGold15))}
        ${kpiHtml('Peso del primo vantaggio', snowballKpiValue(analysis), snowballKpiSub(analysis), snowballKpiClass(analysis))}
      </div>
    `;
  }

  function outlookCopy(analysis) {
    const parts = [];
    const leader = analysis.outlook.tone === 'team-a' ? 'Team 1' : analysis.outlook.tone === 'team-b' ? 'Team 2' : null;
    if (leader) parts.push(`${leader} è favorito con un vantaggio ${analysis.outlook.strength}, costruito confrontando corsie, risorse, obiettivi e caratteristiche della composizione.`);
    else parts.push('Il draft è vicino all’equilibrio: nessuna squadra è nettamente favorita dall’insieme dei dati.');

    if (safeNumber(analysis.scalar.gold15) !== null) parts.push(`Differenza totale di oro al minuto 15: ${intFmt(analysis.scalar.gold15, 'g')}.`);
    if (safeNumber(analysis.scalar.kdPressure15) !== null) parts.push(`Saldo kill-morti al minuto 15: ${signedDecimal(analysis.scalar.kdPressure15, 2)}.`);
    if (safeNumber(analysis.scalar.bountyNetDiff15) !== null) parts.push(`Differenza nel saldo delle taglie al minuto 15: ${intFmt(analysis.scalar.bountyNetDiff15)}.`);
    if (safeNumber(analysis.scalar.objectiveEdge) !== null) parts.push(`Vantaggio medio nelle prime azioni e negli obiettivi: ${signedPct(analysis.scalar.objectiveEdge)}.`);
    return parts.join(' ');
  }


  function snowballLaneSwing(lane) {
    const ahead = safeNumber(lane?.winrate_a_when_ahead_15m);
    const behind = safeNumber(lane?.winrate_a_when_behind_15m);
    if (ahead === null || behind === null) return null;
    return ahead - behind;
  }

  function laneSnowballSensitivity(lane) {
    const conversion = safeNumber(lane?.snowball_conversion_15m_a);
    if (conversion !== null) return Math.abs(conversion);

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
        corr: safeNumber(lane.snowball_corr_15m),
        volatility: safeNumber(lane.volatility_15m_a),
        quality: safeNumber(lane.snowball_quality_15m_a)
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
      target.innerHTML = '<div class="empty-note">Non ci sono abbastanza dati per misurare quanto pesa il primo vantaggio nelle corsie selezionate.</div>';
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
        <div class="micro-label">Peso del primo vantaggio</div>
        <strong class="snowball-value ${esc(avgTone)}">${esc(avgSensitivity === null ? '—' : `${(avgSensitivity * 100).toFixed(1)}pp`)}</strong>
        <p>Misura quanto cambia la percentuale di vittorie tra arrivare avanti e arrivare indietro al minuto 15. Non sceglie da sola il team favorito: mostra quanto può costare il primo errore.</p>
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
      ? `legame vantaggio-vittoria ${Math.abs(corr ?? 0).toFixed(2)}`
      : `${formatPpAbs(sensitivity)} · ${snowballTierLabel(sensitivity)}`;

    return `
      <article class="snowball-lane-card">
        <div class="snowball-lane-role">${esc(roleLabel(lane.role))}</div>
        <div class="snowball-bars">
          <div class="snowball-meta"><span>Vittorie se avanti ${esc(pct(ahead, 0))}</span><span>Vittorie se indietro ${esc(pct(behind, 0))}</span></div>
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
        normalizeComponent(lane.early_kd_pressure_15m_a_minus_b, 0.65),
        normalizeComponent(lane.avg_bounty_net_diff_15m_a_minus_b, 240),
        ahead === null ? null : normalizeComponent(ahead - 0.5, 0.10),
        normalizeComponent(objectiveEdgeForLane(lane), 0.12),
        normalizeComponent(lane.monster_sequence_control_score_a, 0.18),
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
        normalizeComponent(diffNullable(profileValue(p1, 'avg_kills_0_15m'), profileValue(p2, 'avg_kills_0_15m')), 0.9),
        normalizeComponent(diffNullable(profileValue(p1, 'avg_bounty_net'), profileValue(p2, 'avg_bounty_net')), 260),
        normalizeComponent(diffNullable(profileValue(p2, 'avg_deaths_0_15m'), profileValue(p1, 'avg_deaths_0_15m')), 0.9),
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
      ['Corsie', normalizeComponent(analysis.scalar.avgMatchupWinrateEdge, 0.08)],
      ['Oro 15', normalizeComponent(analysis.scalar.gold15, 3500)],
      ['XP 15', normalizeComponent(analysis.scalar.xp15, 3500)],
      ['Vantaggio specifico', normalizeComponent(analysis.scalar.excessGold15, 2500)],
      ['Scontri', normalizeComponent(analysis.scalar.kdPressure15, 1.8)],
      ['Taglie', normalizeComponent(analysis.scalar.bountyNetDiff15, 650)],
      ['Obiettivi', normalizeComponent(analysis.scalar.objectiveEdge, 0.12)],
      ['Pressione → obiettivi', normalizeComponent(analysis.scalar.objectiveConversion, 0.12)],
      ['Combattimenti', radarEdge('damage', 'durability', 'cc', 'kill', 'safety')],
      ['Visione', radarEdge('vision')],
      ['Economia', radarEdge('gold', 'xp', 'auc', 'bounty', 'bountyEfficiency')],
      ['Arrivo al livello 6', radarEdge('level6')]
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
            ${signalChip('Vittorie', pct(lane.winrate_a), toneClass((safeNumber(lane.winrate_a) ?? 0.5) - 0.5))}
            ${signalChip('Oro', intFmt(gold15, 'g'), toneClass(gold15))}
            ${signalChip('XP', intFmt(xp15), toneClass(xp15))}
            ${signalChip('Vantaggio specifico', intFmt(excess15, 'g'), toneClass(excess15))}
            ${signalChip('Saldo scontri', signedDecimal(lane.early_kd_pressure_15m_a_minus_b, 2), toneClass(lane.early_kd_pressure_15m_a_minus_b))}
            ${signalChip('Taglie', intFmt(lane.avg_bounty_net_diff_15m_a_minus_b), toneClass(lane.avg_bounty_net_diff_15m_a_minus_b))}
            ${signalChip('Livello 6', minutesFmt(level6Diff(lane)), toneClass(level6Diff(lane), true))}
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
    if (!lane.team1Champion || !lane.team2Champion) return 'seleziona entrambi i campioni';
    if (lane.reason === 'same_champion') return 'lo stesso campione non può essere in entrambe le squadre';
    if (lane.data_status === 'exact') {
      const sample = isFiniteNumber(lane.n_matches) ? `${Math.round(lane.n_matches)} partite dirette` : 'numero di partite non disponibile';
      return `${sample}${lane.low_sample ? ' · risultato da leggere con cautela' : ''}${lane.orientation === 'reverse' ? ' · dati mostrati dal punto di vista di Team 1' : ''}`;
    }
    if (lane.data_status === 'fallback') return 'stima dal rendimento generale dei campioni, non da partite dirette';
    return 'dati non sufficienti per un confronto';
  }

  function laneStatusLabel(lane) {
    if (lane.data_status === 'exact') return lane.low_sample ? 'dati diretti · poche partite' : 'dati diretti';
    if (lane.data_status === 'fallback') return 'stima dalle prestazioni abituali dei campioni';
    return 'dati non disponibili';
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
    const t1 = analysis.team1Profile.metrics;
    const t2 = analysis.team2Profile.metrics;
    const hero = combatHeroData(analysis);

    byId('damageComposition').innerHTML = `
      <article class="combat-hero-card ${esc(hero.tone)}">
        <div class="combat-hero-top">
          <div>
            <div class="micro-label">Sintesi rapida dei fight</div>
            <h3 class="combat-hero-title">${esc(hero.title)}</h3>
            <p class="combat-hero-copy">${esc(hero.copy)}</p>
          </div>
          <div class="combat-hero-badge ${esc(hero.tone)}">
            <strong>${esc(hero.badge)}</strong>
            <span>${esc(hero.badgeSub)}</span>
          </div>
        </div>
        <div class="combat-hero-reasons">
          ${hero.reasons.map(combatReasonChipHtml).join('')}
        </div>
      </article>
      <div class="combat-summary-grid">
        ${combatSummaryCardHtml('Potenza nei fight', diffNullable(t1.damageOutput, t2.damageOutput), 12000, compactNumber, 'Chi tende a fare più danni negli scontri standard.')}
        ${combatSummaryCardHtml('Tenuta', diffNullable(t1.damageTaken, t2.damageTaken), 9000, compactNumber, 'Chi riesce più spesso a reggere danni e restare dentro al fight.')}
        ${combatSummaryCardHtml('Controlli', diffNullable(t1.ccTotal, t2.ccTotal), 45, (v) => signedDecimal(v, 1), 'Stun, root, slow e altri effetti utili per iniziare o fermare uno scontro.')}
        ${combatSummaryCardHtml('Visione', diffNullable(t1.vision, t2.vision), 22, (v) => signedDecimal(v, 1), 'Controllo medio della mappa: aiuta a preparare obiettivi e imboscate.')}
      </div>
      <div class="combat-team-grid">
        ${combatTeamIdentityHtml('Team 1', analysis.team1Profile, 'team-a')}
        ${combatTeamIdentityHtml('Team 2', analysis.team2Profile, 'team-b')}
      </div>
    `;

    byId('teamProfileStats').innerHTML = `
      <div class="combat-band-grid">
        ${combatBandHtml(
          'Scontri nei primi minuti',
          'Una lettura rapida di chi tende a trovare vantaggi o a esporsi troppo prima del minuto 15.',
          [
            metricCompareBar('Kill 0–10', t1.kills10, t2.kills10, (v) => signedDecimal(v, 2)),
            metricCompareBar('Kill 0–15', t1.kills15, t2.kills15, (v) => signedDecimal(v, 2)),
            metricCompareBar('Morti 0–10', t1.deaths10, t2.deaths10, (v) => signedDecimal(v, 2)),
            metricCompareBar('Morti 0–15', t1.deaths15, t2.deaths15, (v) => signedDecimal(v, 2))
          ]
        )}
        ${combatBandHtml(
          'Taglie e rischio',
          'Non conta solo chi fa kill: conta anche quanto oro utile entra o può essere restituito all’avversario.',
          [
            metricCompareBar('Saldo taglie', t1.bountyNet, t2.bountyNet, compactNumber),
            metricCompareBar('Taglie importanti incassate', t1.shutdownCollected, t2.shutdownCollected, (v) => pct(v, 1)),
            metricCompareBar('Taglie importanti regalate', t1.shutdownGiven, t2.shutdownGiven, (v) => pct(v, 1)),
            metricCompareBar('Rischio di rimonta', t1.comebackRisk, t2.comebackRisk, compactNumber)
          ]
        )}
        ${combatBandHtml(
          'Come rendono oro e livelli',
          'Serve a capire chi sfrutta meglio le risorse e quanto pesa un vantaggio economico o di esperienza.',
          [
            metricCompareBar('Quanto conta l’oro per vincere', t1.goldDependency, t2.goldDependency, (v) => signedDecimal(v, 2)),
            metricCompareBar('Quanto contano i livelli per vincere', t1.xpDependency, t2.xpDependency, (v) => signedDecimal(v, 2)),
            metricCompareBar('Taglia media per kill', t1.bountyPerKill, t2.bountyPerKill, compactNumber),
            metricCompareBar('Oro preso dalle taglie', t1.bountyGained, t2.bountyGained, compactNumber)
          ]
        )}
      </div>
    `;
  }

  function combatHeroData(analysis) {
    const t1 = analysis.team1Profile.metrics;
    const t2 = analysis.team2Profile.metrics;
    const fightDelta = diffNullable((safeNumber(t1.kills15) ?? 0) - (safeNumber(t1.deaths15) ?? 0), (safeNumber(t2.kills15) ?? 0) - (safeNumber(t2.deaths15) ?? 0));
    const reasons = [
      {
        key: 'damage', icon: '⚔', label: 'Potenza nei fight',
        delta: diffNullable(t1.damageOutput, t2.damageOutput), scale: 12000,
        good: 'tende a fare più danni quando parte lo scontro'
      },
      {
        key: 'durability', icon: '🛡', label: 'Tenuta',
        delta: diffNullable(t1.damageTaken, t2.damageTaken), scale: 9000,
        good: 'ha più margine per reggere e continuare il fight'
      },
      {
        key: 'cc', icon: '✦', label: 'Controlli',
        delta: diffNullable(t1.ccTotal, t2.ccTotal), scale: 45,
        good: 'ha più strumenti per bloccare o iniziare lo scontro'
      },
      {
        key: 'vision', icon: '◉', label: 'Visione',
        delta: diffNullable(t1.vision, t2.vision), scale: 22,
        good: 'arriva più spesso preparato agli obiettivi e agli ingaggi'
      },
      {
        key: 'early', icon: '↗', label: 'Primi scambi',
        delta: fightDelta, scale: 4,
        good: 'tende a uscire meglio dagli scontri nei primi 15 minuti'
      }
    ].map((item) => {
      const normalized = normalizeComponent(item.delta, item.scale);
      return {
        ...item,
        normalized,
        abs: Math.abs(safeNumber(normalized) ?? 0),
        leader: normalized === null || Math.abs(normalized) < 0.06 ? 'Equilibrio' : (normalized > 0 ? 'Team 1' : 'Team 2')
      };
    }).sort((a, b) => b.abs - a.abs);

    const available = reasons.filter((item) => item.normalized !== null);
    const total = available.reduce((sum, item) => sum + item.normalized, 0);
    const tone = total > 0.12 ? 'team-a' : total < -0.12 ? 'team-b' : 'neutral';
    const strength = Math.abs(total);
    const title = tone === 'team-a'
      ? 'Team 1 sembra più pronto a vincere i fight'
      : tone === 'team-b'
        ? 'Team 2 sembra più pronto a vincere i fight'
        : 'I fight tra le due squadre sembrano molto vicini';
    const badge = tone === 'team-a' ? 'Team 1 avanti' : tone === 'team-b' ? 'Team 2 avanti' : 'Fight in equilibrio';
    const badgeSub = strength >= 1.4 ? 'vantaggio molto chiaro' : strength >= 0.65 ? 'vantaggio leggibile' : 'margine ridotto';

    const topReasons = available.slice(0, 3).map((item) => ({
      icon: item.icon,
      label: item.label,
      leader: item.leader,
      tone: item.leader === 'Team 1' ? 'team-a' : item.leader === 'Team 2' ? 'team-b' : 'neutral',
      copy: item.leader === 'Equilibrio' ? 'dato abbastanza vicino tra le due squadre' : `${item.leader} · ${item.good}`
    }));

    let copy = 'La sintesi mette insieme danno, tenuta, controlli, visione e comportamento negli scontri iniziali.';
    if (tone === 'team-a') copy = 'Nel complesso Team 1 unisce meglio danno, tenuta e preparazione dei fight. Sotto trovi subito i tre motivi più importanti.';
    else if (tone === 'team-b') copy = 'Nel complesso Team 2 unisce meglio danno, tenuta e preparazione dei fight. Sotto trovi subito i tre motivi più importanti.';
    else copy = 'Le due squadre partono con strumenti simili: per leggere bene i fight conviene guardare i tre segnali sotto e poi il dettaglio essenziale.';

    return { title, copy, badge, badgeSub, tone, reasons: topReasons };
  }

  function combatReasonChipHtml(reason) {
    return `
      <article class="combat-reason-chip ${esc(reason.tone)}">
        <span class="combat-reason-icon" aria-hidden="true">${esc(reason.icon)}</span>
        <div>
          <strong>${esc(reason.label)}</strong>
          <p>${esc(reason.copy)}</p>
        </div>
      </article>
    `;
  }

  function combatSummaryCardHtml(label, delta, scale, formatter, description) {
    const n = safeNumber(delta);
    const tone = toneClass(n);
    const width = n === null ? 0 : Math.min(100, Math.abs(n) / Math.max(scale || 1, 0.0001) * 100);
    const leader = n === null || Math.abs(n) < 0.0001 ? 'Equilibrio' : (n > 0 ? 'Team 1' : 'Team 2');
    return `
      <article class="combat-summary-card ${esc(tone || 'neutral')}">
        <div class="combat-summary-head">
          <span>${esc(label)}</span>
          <strong>${esc(n === null ? '—' : formatter(n))}</strong>
        </div>
        <div class="combat-summary-track"><span style="width:${width.toFixed(1)}%"></span></div>
        <p><strong>${esc(leader)}</strong> · ${esc(description)}</p>
      </article>
    `;
  }

  function dominantDamageText(mix) {
    const physical = safeNumber(mix?.physical) ?? 0;
    const magic = safeNumber(mix?.magic) ?? 0;
    const pure = safeNumber(mix?.true) ?? 0;
    const entries = [
      { key: 'physical', value: physical, label: 'danno soprattutto fisico' },
      { key: 'magic', value: magic, label: 'danno soprattutto magico' },
      { key: 'true', value: pure, label: 'quota di danno puro sopra la media' }
    ].sort((a, b) => b.value - a.value);
    if (!entries[0] || entries[0].value <= 0) return 'profilo di danno non disponibile';
    if (entries[0].value < 0.45) return 'profilo di danno piuttosto misto';
    return entries[0].label;
  }

  function combatPillHtml(label, value, suffix = '/100') {
    const n = safeNumber(value);
    return `
      <div class="combat-pill">
        <span>${esc(label)}</span>
        <strong>${esc(n === null ? '—' : Math.round(n))}${esc(n === null ? '' : suffix)}</strong>
      </div>
    `;
  }

  function combatTeamIdentityHtml(label, profileBundle, cls) {
    const metrics = profileBundle.metrics || {};
    const radar = profileBundle.radar || {};
    const mix = profileBundle.damageMix || { physical: 0, magic: 0, true: 0 };
    const pressure = diffNullable(metrics.kills15, metrics.deaths15);
    const pressureText = pressure === null ? 'pressione sui fight non disponibile' : pressure >= 0 ? 'tende a uscire dagli scontri con un saldo positivo' : 'tende a pagare di più gli scontri prolungati';
    return `
      <article class="combat-team-card ${esc(cls)}">
        <div class="combat-team-head">
          <div>
            <span class="micro-label">${esc(label)}</span>
            <h3>${esc(label)} · identità di combattimento</h3>
          </div>
          <span class="status-badge ${esc(cls)}">${esc(dominantDamageText(mix))}</span>
        </div>
        ${stackRowHtml('Tipo di danno', mix, cls)}
        <p class="combat-style-line">${esc(pressureText)}. Il profilo sotto riassume danno, tenuta, controlli e visione.</p>
        <div class="combat-pill-grid">
          ${combatPillHtml('Danno', radar.damage)}
          ${combatPillHtml('Tenuta', radar.durability)}
          ${combatPillHtml('Controlli', radar.cc)}
          ${combatPillHtml('Visione', radar.vision)}
        </div>
      </article>
    `;
  }

  function combatBandHtml(title, copy, items) {
    return `
      <article class="combat-band">
        <div class="combat-band-head">
          <h3 class="combat-band-title">${esc(title)}</h3>
          <p class="combat-band-copy">${esc(copy)}</p>
        </div>
        <div class="metric-bars compact">
          ${items.join('')}
        </div>
      </article>
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


  function advancedLeader(value, inverse = false, threshold = 0) {
    const n = safeNumber(value);
    if (n === null || Math.abs(n) <= threshold) return 'Equilibrio';
    const team1 = inverse ? n < 0 : n > 0;
    return team1 ? 'Team 1' : 'Team 2';
  }

  function advancedEdgeCard(label, value, scale, formatter, description, options = {}) {
    const n = safeNumber(value);
    const inverse = !!options.inverse;
    const neutral = !!options.neutral;
    const strength = n === null ? 0 : Math.min(100, Math.abs(n) / Math.max(scale || 1, 0.0001) * 100);
    const leader = neutral ? (options.neutralLabel || 'Indicatore di contesto') : advancedLeader(n, inverse, options.threshold || 0);
    const toneValue = inverse ? negate(n) : n;
    const tone = neutral || n === null ? 'neutral' : toneClass(toneValue);
    return `
      <article class="advanced-signal ${esc(tone)}">
        <div class="advanced-signal-head">
          <span>${esc(label)}</span>
          <strong>${esc(n === null ? '—' : formatter(n))}</strong>
        </div>
        <div class="advanced-axis ${neutral ? 'neutral-axis' : ''}" style="--strength:${strength.toFixed(1)}%">
          <i class="left"></i><b></b><i class="right"></i><em class="${esc(tone)}"></em>
        </div>
        <div class="advanced-signal-meta"><em>${esc(leader)}</em><p>${esc(description)}</p></div>
      </article>`;
  }

  function laneFirstKillEdge(lane) {
    const first = safeNumber(lane?.pct_a_first_kill_in_pair);
    const conceded = safeNumber(lane?.pct_a_first_death_in_pair);
    return first === null || conceded === null ? null : first - conceded;
  }

  function advancedLanePill(label, value, scale, formatter, inverse = false, neutral = false) {
    const n = safeNumber(value);
    const strength = n === null ? 0 : Math.min(100, Math.abs(n) / Math.max(scale || 1, 0.0001) * 100);
    const tone = neutral || n === null ? 'neutral' : toneClass(inverse ? negate(n) : n);
    return `<div class="advanced-lane-pill ${esc(tone)}"><span>${esc(label)}</span><strong>${esc(n === null ? '—' : formatter(n))}</strong><i style="--fill:${strength.toFixed(1)}%"></i></div>`;
  }

  function monsterDisplayName(key) {
    return String(key || '')
      .replace(/^pct_a_secures_monster_/, '')
      .replace(/^avg_monster_kill_diff_a_minus_b_/, '')
      .replace(/^event_count_/, '')
      .replace(/^dragon_/, '')
      .replaceAll('_', ' ')
      .replace(/\b\w/g, (m) => m.toUpperCase());
  }

  function renderAdvancedMonsterPanel(analysis) {
    const jungle = analysis.exact.find((lane) => lane.role === 'JUNGLE');
    if (!jungle) return '';
    const rows = Object.keys(jungle)
      .filter((key) => key.startsWith('pct_a_secures_monster_') && safeNumber(jungle[key]) !== null)
      .map((key) => {
        const suffix = key.replace('pct_a_secures_monster_', '');
        const pctValue = safeNumber(jungle[key]);
        const diff = safeNumber(jungle[`avg_monster_kill_diff_a_minus_b_${suffix}`]);
        const events = safeNumber(jungle[`event_count_${suffix}`]);
        return { key, label: monsterDisplayName(key), pctValue, diff, events, edge: pctValue - 0.5 };
      })
      .sort((a, b) => (b.events ?? 0) - (a.events ?? 0));
    if (!rows.length) return '';
    return `
      <article class="advanced-map-card">
        <div class="advanced-card-head"><div><span>Jungle objective network</span><h3>Controllo per sottotipo di mostro</h3></div><em>${esc(jungle.team1Champion)} vs ${esc(jungle.team2Champion)}</em></div>
        <div class="advanced-monster-grid">
          ${rows.map((row) => {
            const a = Math.max(0, Math.min(100, row.pctValue * 100));
            const b = Math.max(0, 100 - a);
            return `<div class="advanced-monster-row">
              <div><strong>${esc(row.label)}</strong><span>${esc(compactNumber(row.events))} eventi</span></div>
              <div class="advanced-monster-balance"><i class="a" style="width:${a.toFixed(1)}%"></i><i class="b" style="width:${b.toFixed(1)}%"></i></div>
              <div><b class="a">${esc(pct(row.pctValue, 0))}</b><em>${esc(row.diff === null ? '—' : signedDecimal(row.diff, 2))}</em></div>
            </div>`;
          }).join('')}
        </div>
      </article>`;
  }

  function renderAdvancedMetrics(analysis) {
    const target = byId('advancedMetrics');
    if (!target) return;
    const s = analysis.scalar;
    const leadQuality = safeNumber(s.gold15) !== null && safeNumber(s.goldWithoutBounty15) !== null
      ? Math.abs(s.gold15) < 1 ? null : s.goldWithoutBounty15 / s.gold15
      : null;

    const signals = [
      advancedEdgeCard('Oro senza bounty @15', s.goldWithoutBounty15, 2400, (v) => intFmt(v, 'g'), 'Isola la parte del vantaggio che non dipende dalle taglie.'),
      advancedEdgeCard('Quota strutturale del lead', leadQuality, 1.25, (v) => `${(v * 100).toFixed(0)}%`, 'Rapporto tra oro senza bounty e oro totale: vicino al 100% indica un lead più stabile.', { neutral: true, neutralLabel: 'Qualità del lead' }),
      advancedEdgeCard('Resource pressure', s.resourcePressure, 35, (v) => `${signedDecimal(v, 1)} pp`, 'Stima quanto oro e XP disponibili si trasformano in probabilità di vittoria.'),
      advancedEdgeCard('Prima kill nella coppia', s.firstKillEdge, 0.18, (v) => signedPct(v, 1), 'Differenza tra quota di prima kill di Team 1 e quota concessa al Team 2.'),
      advancedEdgeCard('Timing livello 6', s.level6TimingEdge, 1.5, (v) => `${signedDecimal(v, 2)} min`, 'Valore positivo: Team 1 raggiunge complessivamente il livello 6 prima.'),
      advancedEdgeCard('Tenuta delle torri', s.towerTimingEdge, 5, (v) => minutesFmt(v), 'Valore positivo: le torri di Team 1 cadono mediamente più tardi.'),
      advancedEdgeCard('Quanto il vantaggio iniziale porta alla vittoria', s.avgSnowballConversion, 0.55, (v) => signedDecimal(v, 3), 'Mostra quanto cambia l’esito quando una squadra arriva avanti al minuto 15. Non indica da sola quale team sarà avanti.', { neutral: true, neutralLabel: 'Quanto pesa arrivare avanti' }),
      advancedEdgeCard('Volatilità @15', s.volatilityIndex, 12, (v) => signedDecimal(v, 2), 'Indice di instabilità dei matchup: più alto significa più varianza e meno script rigidi.', { neutral: true, neutralLabel: 'Rischio di varianza' }),
      advancedEdgeCard('Gold per net kill', s.goldPerKillEfficiency, 1200, (v) => compactNumber(v), 'Ampiezza economica associata a una kill netta; non identifica da sola il team favorito.', { neutral: true, neutralLabel: 'Amplificazione economica' }),
      advancedEdgeCard('Affidabilità del dato sul vantaggio iniziale', s.avgSnowballQuality, 60, (v) => signedDecimal(v, 1), 'Quanto è stabile il collegamento tra vantaggio al minuto 15 e risultato finale nelle corsie con abbastanza partite.', { neutral: true, neutralLabel: 'Solidità del dato' })
    ].join('');

    const lanes = analysis.exact.map((lane) => `
      <article class="advanced-lane-card">
        <header><div><span>${esc(roleLabel(lane.role))}</span><strong>${esc(lane.team1Champion)} <em>vs</em> ${esc(lane.team2Champion)}</strong></div><b>${esc(compactNumber(lane.n_matches))} game</b></header>
        <div class="advanced-lane-pills">
          ${advancedLanePill('No-bounty gold', lane.gold_diff_without_bounty_15m_a_minus_b, 700, (v) => intFmt(v, 'g'))}
          ${advancedLanePill('Excess K-D', lane.excess_early_kd_pressure_15m_a_minus_b, 0.8, (v) => signedDecimal(v, 2))}
          ${advancedLanePill('Resource', lane.resource_winpct_pressure_estimate_a_15m, 12, (v) => `${signedDecimal(v, 1)}pp`)}
          ${advancedLanePill('First kill', laneFirstKillEdge(lane), 0.18, (v) => signedPct(v, 1))}
          ${advancedLanePill('Conversion', lane.snowball_conversion_15m_a, 0.55, (v) => signedDecimal(v, 2), false, true)}
          ${advancedLanePill('Volatility', lane.volatility_15m_a, 12, (v) => signedDecimal(v, 1), false, true)}
        </div>
      </article>`).join('');

    target.innerHTML = `
      <div class="advanced-overview">
        <div class="advanced-intro-copy">
          <div class="micro-label">Signal stack</div>
          <h3>Dal dato grezzo al piano di partita.</h3>
          <p>Le carte distinguono vantaggio, stabilità e rischio. Gli indicatori neutri descrivono quanto il draft amplifica gli eventi, senza attribuire artificialmente il merito a un team.</p>
        </div>
        <div class="advanced-signal-grid">${signals}</div>
      </div>
      <div class="advanced-lanes-head"><div><span>Lane intelligence</span><h3>Dove nascono i segnali avanzati</h3></div><p>Ogni corsia espone solo le metriche operative più utili; l’atlante completo conserva tutti i campi.</p></div>
      <div class="advanced-lane-grid">${lanes || '<div class="empty-note">Nessun matchup diretto disponibile.</div>'}</div>
      ${renderAdvancedMonsterPanel(analysis)}
    `;
  }

  function renderKillPhase(analysis) {
    const target = byId('killPhaseTeam');
    if (!target) return;
    target.innerHTML = PHASES.map((phase) => {
      const t1 = analysis.killPhase.team1[phase.key] || {};
      const t2 = analysis.killPhase.team2[phase.key] || {};
      const kdEdge = diffNullable(t1.kdDiff, t2.kdDiff);
      const bountyEdge = diffNullable(t1.bountyNet, t2.bountyNet);
      return `
        <article class="phase-team-card">
          <div class="phase-team-head"><strong>${esc(phase.title)}</strong><span class="${esc(toneClass(kdEdge))}">${esc(teamNameFromValue(kdEdge))}</span></div>
          <div class="phase-team-grid phase-team-grid-complete">
            <div><span>Kill per partita · T1 / T2</span><strong>${esc(signedDecimal(t1.killEvents, 2))} / ${esc(signedDecimal(t2.killEvents, 2))}</strong></div>
            <div><span>Morti per partita · T1 / T2</span><strong>${esc(signedDecimal(t1.deathEvents, 2))} / ${esc(signedDecimal(t2.deathEvents, 2))}</strong></div>
            <div><span>Saldo kill-morti · T1 / T2</span><strong>${esc(signedDecimal(t1.kdDiff, 2))} / ${esc(signedDecimal(t2.kdDiff, 2))}</strong></div>
            <div><span>Differenza nel saldo taglie</span><strong class="${esc(toneClass(bountyEdge))}">${esc(intFmt(bountyEdge))}</strong></div>
            <div><span>Vittorie nelle partite con una kill in questa fase</span><strong>${esc(pct(t1.killWinrate, 0))} / ${esc(pct(t2.killWinrate, 0))}</strong></div>
            <div><span>Vittorie nelle partite con una morte in questa fase</span><strong>${esc(pct(t1.deathWinrate, 0))} / ${esc(pct(t2.deathWinrate, 0))}</strong></div>
            <div><span>Oro medio ottenuto per kill</span><strong>${esc(intFmt(t1.killBounty))} / ${esc(intFmt(t2.killBounty))}</strong></div>
            <div><span>Oro medio regalato per morte</span><strong>${esc(intFmt(t1.deathBounty))} / ${esc(intFmt(t2.deathBounty))}</strong></div>
            <div><span>Serie media di kill</span><strong>${esc(signedDecimal(t1.killStreak, 2))} / ${esc(signedDecimal(t2.killStreak, 2))}</strong></div>
            <div><span>Saldo taglie per partita</span><strong>${esc(intFmt(t1.bountyNet))} / ${esc(intFmt(t2.bountyNet))}</strong></div>
          </div>
          <div class="phase-team-bars"><div class="phase-bar"><span class="team-a" style="width:${Math.min(100, Math.abs(safeNumber(t1.kdDiff) ?? 0) * 28).toFixed(1)}%"></span></div><div class="phase-bar"><span class="team-b" style="width:${Math.min(100, Math.abs(safeNumber(t2.kdDiff) ?? 0) * 28).toFixed(1)}%"></span></div></div>
        </article>`;
    }).join('');
  }

  function renderRadar(analysis) {
    const radarSets = [
      {
        title: 'Identità generale',
        note: 'Confronto da 0 a 100 delle caratteristiche medie dei cinque campioni.',
        axes: [
          ['winrate', 'Vittorie'],
          ['damage', 'Danno'],
          ['durability', 'Resistenza'],
          ['cc', 'Controlli (CC)'],
          ['vision', 'Visione'],
          ['gold', 'Oro'],
          ['xp', 'XP'],
          ['level6', 'Livello 6'],
          ['kill', 'Scontri'],
          ['bounty', 'Taglie']
        ]
      },
      {
        title: 'Combattimenti e controllo',
        note: 'Danno, capacità di resistere, controlli e visione.',
        axes: [
          ['damage', 'Danno'],
          ['durability', 'Resistenza'],
          ['cc', 'Controlli (CC)'],
          ['vision', 'Visione'],
          ['kill', 'Scontri'],
          ['safety', 'Sicurezza'],
          ['shutdown', 'Taglie incassate']
        ]
      },
      {
        title: 'Risorse e momenti di forza',
        note: 'Quanto oro e XP diventano vittorie e quanto presto arrivano le ultimate.',
        axes: [
          ['winrate', 'Vittorie'],
          ['gold', 'Oro'],
          ['xp', 'XP'],
          ['auc', 'Risorse → vittoria'],
          ['level6', 'Livello 6'],
          ['bounty', 'Taglie'],
          ['bountyEfficiency', 'Taglia media per kill']
        ]
      },
      {
        title: 'Scontri, taglie e rischio',
        note: 'Confronta scontri, valore delle taglie e rischio di regalare una rimonta, su scala 0–100.',
        axes: [
          ['kill', 'Scontri'],
          ['safety', 'Sicurezza'],
          ['bounty', 'Taglie'],
          ['bountyEfficiency', 'Taglia media per kill'],
          ['streak', 'Serie di kill'],
          ['shutdown', 'Taglie incassate'],
          ['shutdownSafety', 'Poche taglie regalate']
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

  function buildRadarSvg(axes, aValues, bValues, title = 'Punti forti delle squadre') {
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


  const PLAIN_METRIC_LABELS = {
    n_matches: 'Partite dirette analizzate',
    low_sample: 'Poche partite disponibili',
    winrate_a: 'Percentuale di vittorie di Team 1 nel matchup',
    general_winrate_a: 'Percentuale di vittorie abituale nel ruolo',
    diff_winrate_a: 'Quanto il matchup cambia il rendimento abituale',
    pct_a_ahead_15m: 'Probabilità che Team 1 sia avanti al minuto 15',
    winrate_a_when_ahead_15m: 'Vittorie di Team 1 quando è avanti al minuto 15',
    winrate_a_when_behind_15m: 'Vittorie di Team 1 quando è indietro al minuto 15',
    snowball_corr_15m: 'Legame tra vantaggio al minuto 15 e vittoria',
    snowball_quality_15m_a: 'Solidità del vantaggio iniziale',
    snowball_conversion_15m_a: 'Capacità di trasformare il vantaggio iniziale',
    volatility_15m_a: 'Quanto il matchup varia tra le partite',
    gold_diff_without_bounty_15m_a_minus_b: 'Differenza di oro senza taglie al minuto 15',
    bounty_share_of_gold_diff_15m: 'Quota del vantaggio in oro dovuta alle taglie',
    early_kd_pressure_15m_a_minus_b: 'Saldo kill-morti al minuto 15',
    excess_early_kd_pressure_15m_a_minus_b: 'Saldo kill-morti specifico del matchup',
    avg_bounty_net_diff_15m_a_minus_b: 'Differenza nel saldo taglie al minuto 15',
    resource_winpct_pressure_estimate_a_15m: 'Impatto stimato di oro e XP sull’esito',
    objective_conversion_score_a: 'Capacità di trasformare pressione in obiettivi',
    monster_sequence_control_score_a: 'Controllo della sequenza di obiettivi neutrali',
    comeback_risk_a: 'Valore esposto a una possibile rimonta'
  };

  function plainMetricDescription(key) {
    const k = String(key || '').toLowerCase();
    if (/excess_(gold|xp)_diff_by_minute/.test(k)) return 'Vantaggio di oro o XP che nasce dagli specifici matchup, oltre a quello normalmente atteso dai campioni.';
    if (/(gold|xp)_diff_by_minute/.test(k)) return 'Differenza di risorse nel tempo: positivo favorisce Team 1, negativo Team 2.';
    if (/snowball|when_ahead|when_behind/.test(k)) return 'Quanto il primo vantaggio cambia l’esito e quanto è difficile recuperare quando si resta indietro.';
    if (/bounty|shutdown/.test(k)) return 'Oro ottenuto o concesso tramite taglie e rischio di restituire il vantaggio con una morte importante.';
    if (/kill|death|streak/.test(k)) return 'Come vanno gli scontri: kill, morti, serie di uccisioni e saldo tra eventi positivi e negativi.';
    if (/goldxp|resource|auc|winpct_per_1k/.test(k)) return 'Quanto oro e XP incidono sul risultato e quanto bene i campioni riescono a trasformare le risorse in vittorie.';
    if (/tower/.test(k)) return 'Chi prende più spesso la prima torre e con quale anticipo medio.';
    if (/monster|dragon|baron|riftherald|horde/.test(k)) return 'Controllo degli obiettivi neutrali e della loro sequenza nel corso della partita.';
    if (/vision/.test(k)) return 'Contributo medio al controllo della visione e della mappa.';
    if (/damage|physical|magic|true/.test(k)) return 'Quantità e tipo di danno prodotto o assorbito dalla composizione.';
    if (/cc|time_cc/.test(k)) return 'Tempo medio in cui i nemici vengono limitati da stun, root, slow e altri controlli.';
    if (/level6/.test(k)) return 'Minuto medio del livello 6: più basso significa accesso anticipato alla ultimate.';
    if (/winrate|diff_winrate/.test(k)) return 'Confronta le vittorie nel matchup con il rendimento abituale dei campioni nel ruolo.';
    if (/percentile/.test(k)) return 'Posizione da 0 a 100 rispetto agli altri campioni dello stesso ruolo.';
    if (/n_matches|coverage|total_games|low_sample/.test(k)) return 'Quante partite sostengono il dato: più partite significano una lettura generalmente più stabile.';
    return 'Dato di supporto da leggere insieme alle altre metriche, non come verdetto isolato.';
  }

  function auditHumanLabel(key) {
    if (PLAIN_METRIC_LABELS[key]) return PLAIN_METRIC_LABELS[key];
    return String(key || '').replace(/_a_minus_b$/g, ' (differenza Team 1 − Team 2)').replace(/_a$/g, ' Team 1').replace(/_b$/g, ' Team 2').replaceAll('_', ' ').replace(/\b\w/g, (m) => m.toUpperCase());
  }
  function auditRaw(value) {
    if (Array.isArray(value)) return JSON.stringify(value);
    if (value === null || value === undefined) return '';
    return String(value);
  }
  function auditDisplay(key, value) {
    if (Array.isArray(value)) {
      if (!value.length) return '[]';
      const picks = [0, 5, 10, 15, value.length - 1].filter((v, i, a) => v < value.length && a.indexOf(v) === i);
      return `${picks.map((i) => `${i}: ${intFmt(value[i])}`).join(' · ')} · ${value.length} punti`;
    }
    if (value === null || value === undefined) return '—';
    if (typeof value === 'boolean') return value ? 'Sì' : 'No';
    const n = safeNumber(value);
    if (n === null) return String(value);
    if (/^pct_|winrate|_rate($|_)/.test(key)) return pct(n, 2);
    if (/auc|corr|score|quality|conversion|volatility|efficiency|pressure/.test(key)) return signedDecimal(n, 4);
    if (/n_matches|event_count|_total$|max_kill_streak/.test(key)) return compactNumber(n);
    return Math.abs(n) >= 100 ? compactNumber(n) : signedDecimal(n, 3);
  }
  function auditLaneValues(lane, col, has) {
    if (!lane || lane.data_status !== 'exact') return [null, null];
    if (col.endsWith('_a') && has.has(`${col.slice(0, -2)}_b`)) return [lane[col], lane[`${col.slice(0, -2)}_b`]];
    if (col === 'winrate_a_when_ahead_15m') return [lane.winrate_a_when_ahead_15m, lane.winrate_b_when_ahead_15m ?? invertPct(lane.winrate_a_when_behind_15m)];
    if (col === 'winrate_a_when_behind_15m') return [lane.winrate_a_when_behind_15m, lane.winrate_b_when_behind_15m ?? invertPct(lane.winrate_a_when_ahead_15m)];
    if (col === 'comeback_risk_a') return [lane.comeback_risk_a, lane.comeback_risk_b];
    if (col === 'pct_a_first_kill_in_pair') return [lane.pct_a_first_kill_in_pair, lane.pct_a_first_death_in_pair];
    if (col === 'pct_a_first_death_in_pair') return [lane.pct_a_first_death_in_pair, lane.pct_a_first_kill_in_pair];
    if (col === 'pct_a_kill_adv_15m' || col === 'pct_a_bounty_net_adv_15m') return [lane[col], null];
    if (col.startsWith('pct_champion_a_') || col.startsWith('pct_a_') || col === 'monster_sequence_control_avg_a') return [lane[col], invertPct(lane[col])];
    const invariantDiff = col === 'gold_per_kill_diff_15m_a_minus_b' || col === 'xp_per_kill_diff_15m_a_minus_b';
    const signedPerspective = ['resource_winpct_pressure_estimate_a_15m', 'objective_conversion_score_a', 'monster_sequence_control_score_a'].includes(col);
    if ((col.endsWith('_a_minus_b') && !invariantDiff) || signedPerspective) return [lane[col], negate(lane[col])];
    if (SIGNED_ARRAY_FIELDS.includes(col)) return [lane[col], negateArray(lane[col])];
    return [lane[col], null];
  }
  function auditLaneCell(lane, col, has) {
    if (!lane || lane.data_status !== 'exact') return '<span class="audit-empty">—</span>';
    const [a, b] = auditLaneValues(lane, col, has);
    const source = auditRaw(a);
    const right = b === null || b === undefined ? '' : auditRaw(b);
    return `<span class="audit-pair" title="${esc(`T1=${source}${right ? ` | T2=${right}` : ''}`)}"><b>${esc(auditDisplay(col, a))}</b>${b === null || b === undefined ? '' : `<em>${esc(auditDisplay(col, b))}</em>`}</span>`;
  }
  function profileAuditFields() {
    const sampleRole = roleOrder().find((role) => Object.keys(DATA?.championProfiles?.[role] || {}).length);
    const sample = sampleRole ? Object.values(DATA.championProfiles[sampleRole])[0] : null;
    if (!sample) return [];
    const base = Object.keys(sample).filter((key) => !['percentiles', 'coverage'].includes(key)).map((key) => ({ key, label: auditHumanLabel(key) }));
    const percentileRows = Object.keys(sample.percentiles || {}).map((key) => ({ key: `percentiles.${key}`, label: `${auditHumanLabel(key)} — confronto con il ruolo` }));
    return base.concat(percentileRows, [{ key: 'coverage.n_matchups', label: 'Avversari con dati disponibili' }, { key: 'coverage.total_games', label: 'Partite disponibili nel profilo' }, { key: 'comeback_risk', label: 'Rischio di rimonta stimato' }]);
  }
  function nestedValue(obj, key) {
    return key.split('.').reduce((acc, part) => acc == null ? null : acc[part], obj);
  }
  function profileAuditCell(lane, role, field) {
    if (!lane) return '<span class="audit-empty">—</span>';
    const p1 = lane.team1Profile, p2 = lane.team2Profile;
    let a = field.key === 'comeback_risk' ? profileComebackRisk(p1) : nestedValue(p1, field.key);
    let b = field.key === 'comeback_risk' ? profileComebackRisk(p2) : nestedValue(p2, field.key);
    const bench = DATA?.roleBenchmarks?.[role]?.[field.key];
    const med = bench ? bench.median : null;
    return `<span class="audit-pair"><b>${esc(auditDisplay(field.key, a))}</b><em>${esc(auditDisplay(field.key, b))}</em>${med === null || med === undefined ? '' : `<small>med ${esc(auditDisplay(field.key, med))}</small>`}</span>`;
  }
  function bindAuditFilter(inputId, selector, attr) {
    const input = byId(inputId); if (!input) return;
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      $$(selector).forEach((row) => { row.hidden = Boolean(q && !row.getAttribute(attr).includes(q)); });
    });
  }

  const DRAFT_ATLAS_FAMILIES = [
    { id: 'outcome', title: 'Risultati & affidabilità', short: 'Risultati', test: (key) => /^(n_matches|low_sample|winrate_|general_winrate_|diff_winrate_)/.test(key) },
    { id: 'timeline', title: 'Risorse nel tempo', short: 'Risorse', test: (key) => /gold_diff|xp_diff|excess_gold|excess_xp/.test(key) && !/per_kill|without_bounty/.test(key) },
    { id: 'combat', title: 'Danno, controlli & visione', short: 'Combattimento', test: (key) => /pct_(physical|magic|true)_dmg|avg_damage|avg_time_cc|avg_total_time_cc|vision/.test(key) },
    { id: 'models', title: 'Dipendenza dalle risorse', short: 'Risorse → vittoria', test: (key) => /goldxp_|resource_winpct|auc|level6/.test(key) },
    { id: 'kill', title: 'Scontri, taglie & rischi', short: 'Scontri', test: (key) => /kill|death|bounty|streak|shutdown/.test(key) && !/monster_kill/.test(key) },
    { id: 'map', title: 'Torri & prime azioni', short: 'Mappa', test: (key) => /tower|first_blood|first_dragon|first_baron|first_horde|first_riftherald|n_matches_(dragon|baron|horde|riftherald)/.test(key) },
    { id: 'snowball', title: 'Peso del vantaggio & rimonta', short: 'Vantaggio', test: (key) => /ahead_15m|when_ahead|when_behind|snowball|volatility|comeback|gold_diff_std/.test(key) },
    { id: 'monsters', title: 'Mostri & sequenze', short: 'Mostri', test: (key) => /monster|event_count_/.test(key) },
    { id: 'advanced', title: 'Efficienza & vantaggio specifico', short: 'Approfondimenti', test: (key) => /early_kd|excess_|per_kill|without_bounty|bounty_share|kill_value|objective_conversion/.test(key) },
    { id: 'other', title: 'Altri dati utili', short: 'Altro', test: () => true }
  ];

  const DRAFT_ATLAS_ESSENTIAL = new Set([
    'n_matches','low_sample','winrate_a','general_winrate_a','diff_winrate_a',
    'gold_diff_by_minute','xp_diff_by_minute','excess_gold_diff_by_minute','excess_xp_diff_by_minute',
    'gold_diff_15m_a_minus_b','xp_diff_15m_a_minus_b','vision_diff_a_minus_b',
    'goldxp_gold_dependency_diff_a_minus_b','goldxp_xp_dependency_diff_a_minus_b','avg_level6_minute_a',
    'avg_kill_diff_15m_a_minus_b','avg_death_diff_15m_a_minus_b','avg_bounty_net_diff_15m_a_minus_b',
    'pct_a_first_kill_in_pair','pct_a_first_death_in_pair','pct_champion_a_wins_tower_race','avg_tower_fall_diff_min_a_minus_b',
    'pct_a_ahead_15m','winrate_a_when_ahead_15m','winrate_a_when_behind_15m','snowball_corr_15m','gold_diff_std_15m',
    'early_kd_pressure_15m_a_minus_b','excess_early_kd_pressure_15m_a_minus_b','gold_diff_without_bounty_15m_a_minus_b',
    'bounty_share_of_gold_diff_15m','resource_winpct_pressure_estimate_a_15m','snowball_quality_15m_a',
    'snowball_conversion_15m_a','volatility_15m_a','kill_value_efficiency_15m_a','comeback_risk_a',
    'monster_sequence_control_score_a','monster_sequence_diff_total_a_minus_b'
  ]);

  function atlasFamilyFor(key) {
    return DRAFT_ATLAS_FAMILIES.find((family) => family.test(key)) || DRAFT_ATLAS_FAMILIES[DRAFT_ATLAS_FAMILIES.length - 1];
  }

  function atlasSparkline(values) {
    if (!Array.isArray(values) || !values.length) return '';
    const nums = values.map(safeNumber);
    const finite = nums.filter((v) => v !== null);
    if (!finite.length) return '';
    const w = 250, h = 38, pad = 3;
    const min = Math.min(...finite, 0), max = Math.max(...finite, 0), range = Math.max(1, max - min);
    const points = nums.map((v, i) => {
      if (v === null) return null;
      const x = pad + (i / Math.max(1, nums.length - 1)) * (w - pad * 2);
      const y = pad + (1 - (v - min) / range) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).filter(Boolean).join(' ');
    const zero = pad + (1 - (0 - min) / range) * (h - pad * 2);
    return `<svg class="draft-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><line x1="0" y1="${zero.toFixed(1)}" x2="${w}" y2="${zero.toFixed(1)}"></line><polyline points="${points}"></polyline></svg>`;
  }

  function atlasLaneVisual(lane, row, has) {
    if (!lane || lane.data_status !== 'exact') return `<div class="draft-atlas-lane is-missing"><span>${esc(roleLabel(lane?.role || ''))}</span><em>dato non disponibile</em></div>`;
    const value = lane[row.col];
    if (Array.isArray(value)) {
      const at15 = valueAtMinute(value, lane.minutes, REFERENCE_MINUTE);
      return `<div class="draft-atlas-lane is-series"><span>${esc(roleLabel(lane.role))}</span>${atlasSparkline(value)}<strong>${esc(at15 === null ? '—' : intFmt(at15))}</strong><small>@15 · ${value.length} punti</small></div>`;
    }
    const [a, b] = auditLaneValues(lane, row.col, has);
    if (b !== null && b !== undefined && !Array.isArray(b)) {
      const av = safeNumber(a), bv = safeNumber(b);
      const max = Math.max(Math.abs(av ?? 0), Math.abs(bv ?? 0), 0.0001);
      const aw = av === null ? 0 : Math.min(100, Math.abs(av) / max * 100);
      const bw = bv === null ? 0 : Math.min(100, Math.abs(bv) / max * 100);
      return `<div class="draft-atlas-lane"><span>${esc(roleLabel(lane.role))}</span><div class="draft-lane-values"><strong class="a">${esc(auditDisplay(row.col, a))}</strong><em>vs</em><strong class="b">${esc(auditDisplay(row.col, b))}</strong><div class="draft-lane-balance"><i class="a" style="--lane-fill:${aw.toFixed(1)}"></i><i class="b" style="--lane-fill:${bw.toFixed(1)}"></i></div></div><small>${esc(lane.team1Champion)} · ${esc(lane.team2Champion)}</small></div>`;
    }
    return `<div class="draft-atlas-lane is-single"><span>${esc(roleLabel(lane.role))}</span><em>${esc(lane.team1Champion)}</em><strong>${esc(auditDisplay(row.col, a))}</strong></div>`;
  }

  function atlasMetricCard(row, lanes, has, index) {
    return `<article class="draft-metric-card" data-atlas-search="${esc(`${row.label} ${row.source} ${row.family.title}`.toLowerCase())}"><header><span>${esc(row.family.short)}</span><em>${String(index + 1).padStart(2, '0')}</em></header><h4>${esc(row.label)}</h4><p class="metric-help">${esc(plainMetricDescription(row.source))}</p><div class="draft-lane-scan">${lanes.map((lane) => atlasLaneVisual(lane, row, has)).join('')}</div><details><summary>Nome tecnico nel dataset</summary><code>${esc(row.source)}</code></details></article>`;
  }

  function atlasProfileLane(lane, field) {
    if (!lane) return `<div class="draft-atlas-lane is-missing"><span>—</span><em>dato non disponibile</em></div>`;
    const p1 = lane.team1Profile, p2 = lane.team2Profile;
    const a = field.key === 'comeback_risk' ? profileComebackRisk(p1) : nestedValue(p1, field.key);
    const b = field.key === 'comeback_risk' ? profileComebackRisk(p2) : nestedValue(p2, field.key);
    if ((a === null || a === undefined) && (b === null || b === undefined)) return `<div class="draft-atlas-lane is-missing"><span>${esc(roleLabel(lane.role))}</span><em>dato non disponibile</em></div>`;
    const av = safeNumber(a), bv = safeNumber(b), max = Math.max(Math.abs(av ?? 0), Math.abs(bv ?? 0), 0.0001);
    const aw = av === null ? 0 : Math.min(100, Math.abs(av) / max * 100), bw = bv === null ? 0 : Math.min(100, Math.abs(bv) / max * 100);
    return `<div class="draft-atlas-lane"><span>${esc(roleLabel(lane.role))}</span><div class="draft-lane-values"><strong class="a">${esc(auditDisplay(field.key, a))}</strong><em>vs</em><strong class="b">${esc(auditDisplay(field.key, b))}</strong><div class="draft-lane-balance"><i class="a" style="--lane-fill:${aw.toFixed(1)}"></i><i class="b" style="--lane-fill:${bw.toFixed(1)}"></i></div></div><small>${esc(lane.team1Champion || '—')} · ${esc(lane.team2Champion || '—')}</small></div>`;
  }

  function atlasProfileCard(field, lanes, index) {
    return `<article class="draft-metric-card profile" data-atlas-search="${esc(`${field.label} ${field.key} profilo benchmark`.toLowerCase())}"><header><span>Profilo</span><em>${String(index + 1).padStart(2, '0')}</em></header><h4>${esc(field.label)}</h4><p class="metric-help">${esc(plainMetricDescription(field.key))}</p><div class="draft-lane-scan">${lanes.map((lane) => atlasProfileLane(lane, field)).join('')}</div><details><summary>Nome tecnico nel profilo</summary><code>${esc(field.key)}</code></details></article>`;
  }

  function renderRaw(analysis) {
    const target = byId('datasetAudit');
    if (!target) return;
    const lanes = analysis.lanes;
    const columns = DATA?.matchupColumns || [];
    const has = new Set(columns);
    const logical = [];
    columns.forEach((col) => {
      if (col.endsWith('_b') && has.has(`${col.slice(0, -2)}_a`)) return;
      const source = col.endsWith('_a') && has.has(`${col.slice(0, -2)}_b`) ? `${col} / ${col.slice(0, -2)}_b` : col;
      logical.push({ col, source, label: auditHumanLabel(col), family: atlasFamilyFor(col) });
    });
    const profileFields = profileAuditFields();
    let mode = 'essential';
    let family = 'all';
    let query = '';

    target.innerHTML = `<div class="draft-atlas-v2"><section class="draft-atlas-intro"><div><div class="micro-label">Tutti i dati del draft</div><h3>Tutte le metriche, organizzate corsia per corsia.</h3><p>La vista Essenziale mostra prima i dati che aiutano maggiormente a preparare il piano partita. La vista Completa permette di approfondire tutte le ${columns.length} metriche e i profili dei campioni, mantenendo sempre il confronto Team 1 / Team 2.</p></div><div class="draft-atlas-score"><span>Metriche disponibili</span><strong>${columns.length}/${columns.length}</strong><em>dati organizzati</em></div></section><div class="draft-atlas-command"><label><span class="visually-hidden">Cerca metrica</span><input id="draftAtlasSearch" type="search" placeholder="Cerca kill, taglie, livello 6, torre o drago…"></label><div class="draft-atlas-mode"><button type="button" data-mode="essential" class="active">Essenziale</button><button type="button" data-mode="complete">Completa</button></div></div><div class="draft-atlas-chips" id="draftAtlasChips"></div><div class="draft-atlas-status" id="draftAtlasStatus"></div><div class="draft-atlas-groups" id="draftAtlasGroups"></div></div>`;

    const chipTarget = byId('draftAtlasChips');
    chipTarget.innerHTML = `<button type="button" data-family="all" class="active">Tutte</button>${DRAFT_ATLAS_FAMILIES.filter((f) => f.id !== 'other').map((f) => `<button type="button" data-family="${esc(f.id)}">${esc(f.short)}</button>`).join('')}<button type="button" data-family="profile">Profili</button>`;

    function draw() {
      const q = query.trim().toLowerCase();
      const visibleRows = logical.filter((row) => {
        if (mode === 'essential' && !DRAFT_ATLAS_ESSENTIAL.has(row.col)) return false;
        if (family !== 'all' && family !== row.family.id) return false;
        return !q || `${row.label} ${row.source} ${row.family.title}`.toLowerCase().includes(q);
      });
      const showProfiles = (family === 'all' || family === 'profile') && (!q || profileFields.some((f) => `${f.label} ${f.key}`.toLowerCase().includes(q)));
      const groups = DRAFT_ATLAS_FAMILIES.map((fam) => ({ fam, rows: visibleRows.filter((row) => row.family.id === fam.id) })).filter((group) => group.rows.length);
      let html = groups.map((group, groupIndex) => `<details class="draft-atlas-family" ${groupIndex < 2 ? 'open' : ''}><summary><div><span>${String(groupIndex + 1).padStart(2, '0')}</span><strong>${esc(group.fam.title)}</strong></div><em>${group.rows.length} carte</em></summary><div class="draft-metric-grid">${group.rows.map((row, i) => atlasMetricCard(row, lanes, has, i)).join('')}</div></details>`).join('');
      if (showProfiles) {
        const filteredProfiles = profileFields.filter((field) => !q || `${field.label} ${field.key}`.toLowerCase().includes(q)).filter((field) => mode === 'complete' || ['general_winrate','avg_damage_to_champs','avg_damage_taken','avg_total_time_cc_dealt','vision_score','goldxp_winpct_per_1k_gold','goldxp_winpct_per_1k_xp','goldxp_auc','avg_level6_minute','avg_kills_0_15m','avg_deaths_0_15m','avg_bounty_net','shutdown_collected_rate','shutdown_given_rate','comeback_risk'].some((key) => field.key === key || field.key.endsWith(`.${key}`)));
        if (filteredProfiles.length) html += `<div class="draft-atlas-divider">Profili & confronto con il ruolo</div><details class="draft-atlas-family" ${family === 'profile' ? 'open' : ''}><summary><div><span>P</span><strong>Caratteristiche dei campioni</strong></div><em>${filteredProfiles.length} carte</em></summary><div class="draft-metric-grid">${filteredProfiles.map((field, i) => atlasProfileCard(field, lanes, i)).join('')}</div></details>`;
      }
      byId('draftAtlasGroups').innerHTML = html || '<div class="empty-note">Nessuna metrica corrisponde al filtro.</div>';
      byId('draftAtlasStatus').innerHTML = `<strong>${visibleRows.length}</strong><span>carte matchup</span><i></i><span>${mode === 'essential' ? 'dati principali' : `${columns.length} colonne sorgente`}</span>`;
    }

    byId('draftAtlasSearch').addEventListener('input', (event) => { query = event.target.value; draw(); });
    $$('.draft-atlas-mode button', target).forEach((button) => button.addEventListener('click', () => {
      mode = button.dataset.mode;
      $$('.draft-atlas-mode button', target).forEach((b) => b.classList.toggle('active', b === button));
      draw();
    }));
    $$('#draftAtlasChips button', target).forEach((button) => button.addEventListener('click', () => {
      family = button.dataset.family;
      $$('#draftAtlasChips button', target).forEach((b) => b.classList.toggle('active', b === button));
      draw();
    }));
    draw();
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

  function directOpponentRows(role, champion) {
    const rows = DATA?.adjacency?.[role]?.[champion] || [];
    return rows.map((row) => ({ champ: row[0], games: safeNumber(row[1]) ?? 0, low: !!row[2] }))
      .sort((a, b) => b.games - a.games || localeSort(a.champ, b.champ));
  }

  function pickerOptions(role, team) {
    const champions = championsForRole(role);
    if (team === 2 && state.team1[role]) {
      const direct = directOpponentRows(role, state.team1[role]);
      const directMap = new Map(direct.map((row) => [row.champ, row]));
      const rest = champions.filter((champ) => !directMap.has(champ) && champ !== state.team1[role]);
      return direct.concat(rest.map((champ) => {
        const coverage = DATA?.championProfiles?.[role]?.[champ]?.coverage || {};
        return { champ, games: 0, low: false, coverage: safeNumber(coverage.total_games) ?? 0 };
      }));
    }
    return champions.map((champ) => {
      const coverage = DATA?.championProfiles?.[role]?.[champ]?.coverage || {};
      return { champ, games: 0, low: false, matchupCount: safeNumber(coverage.n_matchups) ?? 0, coverage: safeNumber(coverage.total_games) ?? 0 };
    });
  }

  function createCombobox(box) {
    const input = $('input', box);
    const list = $('.combo-list', box);
    const role = box.dataset.role;
    const team = Number(box.dataset.team);
    let activeIndex = -1;
    let visible = [];

    function selectedMap() {
      return team === 1 ? state.team1 : state.team2;
    }

    function select(champion) {
      selectedMap()[role] = champion;
      input.value = champion;
      if (team === 1 && state.team2[role] === champion) delete state.team2[role];
      close();
      syncInputsFromState();
      if (state.lastAnalysis) analyzeDraft();
      if (team === 1) {
        window.setTimeout(() => {
          const next = document.querySelector(`.team-combobox[data-role="${role}"][data-team="2"] input`);
          if (next) {
            next.focus({ preventScroll: true });
            next.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }, 0);
      }
    }

    function render(query = '') {
      const q = query.trim().toLowerCase();
      visible = pickerOptions(role, team)
        .map((item, rank) => ({ ...item, rank, score: scoreChampion(item.champ, q) }))
        .filter((item) => !q || item.score > 0)
        .sort((a, b) => q ? (b.score - a.score || a.rank - b.rank) : a.rank - b.rank)
        .slice(0, 80);

      activeIndex = visible.length ? 0 : -1;
      list.innerHTML = visible.length
        ? visible.map((item, index) => optionHtml(item, index === activeIndex, team, !!state.team1[role])).join('')
        : '<div class="combo-empty">Nessun campione trovato.</div>';
      list.classList.add('open');
      input.setAttribute('aria-expanded', 'true');
    }

    function close() {
      list.classList.remove('open');
      input.setAttribute('aria-expanded', 'false');
      activeIndex = -1;
    }

    function normalizeTypedValue() {
      const typed = input.value.trim();
      const options = championsForRole(role);
      if (!typed) {
        delete selectedMap()[role];
        input.value = '';
        updateCounts();
        return;
      }
      const exact = options.find((champ) => champ.toLowerCase() === typed.toLowerCase());
      if (exact) {
        selectedMap()[role] = exact;
        input.value = exact;
      } else {
        delete selectedMap()[role];
      }
      updateCounts();
    }

    input.addEventListener('input', () => {
      normalizeTypedValue();
      render(input.value);
    });

    input.addEventListener('focus', () => render(input.value));
    input.addEventListener('blur', () => {
      window.setTimeout(() => {
        normalizeTypedValue();
        if (!selectedMap()[role]) input.value = '';
      }, 80);
    });

    input.addEventListener('keydown', (event) => {
      if (!list.classList.contains('open') && ['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) {
        render(input.value);
        if (event.key !== 'Enter') { event.preventDefault(); return; }
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
        if (visible[activeIndex]) select(visible[activeIndex].champ);
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

  function optionHtml(item, active, team, hasPrimary) {
    const direct = team === 2 && hasPrimary && item.games > 0;
    const meta = direct
      ? `${compactNumber(item.games)} partite dirette${item.low ? ' · sample ridotto' : ''}`
      : team === 1
        ? `${compactNumber(item.matchupCount)} matchup · ${compactNumber(item.coverage)} game`
        : item.coverage
          ? `${compactNumber(item.coverage)} game profilo`
          : 'profilo disponibile';
    return `
      <div class="combo-option ${active ? 'active' : ''} ${item.low ? 'low' : ''}" role="option" data-champion="${esc(item.champ)}">
        <span>${esc(item.champ)}</span>
        <span class="meta">${esc(meta)}</span>
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
    byId('emptyState').textContent = 'Seleziona almeno una corsia completa.';
  }

  function bindActions() {
    
    byId('swapTeamsBtn')?.addEventListener('click', () => {
      pulseMotion(byId('swapTeamsBtn'));
      swapTeams();
    });
    byId('clearDraftBtn')?.addEventListener('click', clearDraft);
    byId('analyzeDraftBtn')?.addEventListener('click', analyzeDraft);
    bindTabs();
  }

  /* ------------------------------------------------------------------ *
   * Tab (identica alla logica di app.js, per coerenza tra le due pagine)
   * ------------------------------------------------------------------ */
  function bindTabs() {
    const bar = byId('tabBar');
    if (!bar) return;
    bar.addEventListener('click', function (e) {
      var btn = e.target.closest('.tab-btn');
      if (!btn) return;
      var tab = btn.getAttribute('data-tab');
      document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.toggle('active', b === btn); });
      document.querySelectorAll('.tab-panel').forEach(function (p) { p.classList.toggle('active', p.id === 'panel-' + tab); });
    });
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
    byId('footerStats').textContent = `Team DraftLab · ${total ? Math.round(total).toLocaleString('it-IT') : '—'} matchup disponibili`;
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


  function syncTopbarHeight() {
    const topbar = document.querySelector('.topbar');
    if (!topbar) return;
    const apply = () => document.documentElement.style.setProperty('--topbar-height', `${Math.ceil(topbar.getBoundingClientRect().height || 72)}px`);
    apply();
    window.addEventListener('resize', apply, { passive: true });
    if (window.ResizeObserver) new ResizeObserver(apply).observe(topbar);
  }

  function init() {
    syncTopbarHeight();
    if (!DATA || !DATA.matchups || !DATA.matchupColumns) {
      fail('Dataset non disponibile: impossibile inizializzare Team DraftLab.');
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