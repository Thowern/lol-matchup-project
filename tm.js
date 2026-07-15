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
    { key: 'early_0_10', label: '0–10', title: 'First 10 minutes' },
    { key: 'lane_10_15', label: '10–15', title: 'Minutes 10–15' },
    { key: 'mid_15_25', label: '15–25', title: 'Mid game, minutes 15–25' },
    { key: 'late_25_plus', label: '25+', title: 'After 25 minutes' }
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
      label: 'Gold',
      field: 'gold_diff_by_minute',
      at15: 'gold15',
      suffix: ' gold',
      note: 'Sums the gold advantage of lanes with direct data. Positive favors Team 1; negative favors Team 2.'
    },
    xp: {
      label: 'XP',
      field: 'xp_diff_by_minute',
      at15: 'xp15',
      suffix: ' XP',
      note: 'Sums the experience advantage of lanes with direct data. Positive favors Team 1; negative favors Team 2.'
    },
    excessGold: {
      label: 'Matchup-specific gold',
      field: 'excess_gold_diff_by_minute',
      at15: 'excessGold15',
      suffix: ' gold',
      note: 'Shows the portion of the gold advantage created by the selected pairings, beyond what is normally expected from the champions.'
    },
    excessXp: {
      label: 'Matchup-specific XP',
      field: 'excess_xp_diff_by_minute',
      at15: 'excessXp15',
      suffix: ' XP',
      note: 'Shows the portion of the experience advantage created by the selected pairings, beyond what is normally expected from the champions.'
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

  function champHtml(name, size = 'sm', className = '') {
    if (!name) return '—';
    return window.ChampionIcons?.html
      ? window.ChampionIcons.html(name, { size, className })
      : esc(name);
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
    if (n === null || Math.abs(n) <= threshold) return 'Balance';
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

      // First-kill/first-death events are mirrored, not complementary:
      // outcomes with no kill are excluded from both shares.
      if ('pct_a_first_kill_in_pair' in raw || 'pct_a_first_death_in_pair' in raw) {
        out.pct_a_first_kill_in_pair = safeNumber(raw.pct_a_first_death_in_pair);
        out.pct_a_first_death_in_pair = safeNumber(raw.pct_a_first_kill_in_pair);
      }
      // The dataset exports neither the opponent's share nor ties for these two
      // probabilities. We therefore avoid the false complement 1-p on the reversed side.
      if ('pct_a_kill_adv_15m' in raw) out.pct_a_kill_adv_15m = null;
      if ('pct_a_bounty_net_adv_15m' in raw) out.pct_a_bounty_net_adv_15m = null;

      // Correlation, quality, conversion gap, volatility and kill-value ratios
      // are invariant when both the side and the outcome are mirrored.
      if ('winrate_a_when_ahead_15m' in raw || 'winrate_a_when_behind_15m' in raw) {
        out.winrate_a_when_ahead_15m = invertPct(raw.winrate_a_when_behind_15m);
        out.winrate_a_when_behind_15m = invertPct(raw.winrate_a_when_ahead_15m);
      }
    }

    // The current export contains first blood values that are always zero: zero is not
    // interpreted as an actual 0% and does not feed charts or insights.
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
    const numericMinutes = Array.isArray(minutes)
      ? minutes.map(safeNumber)
      : series.map((_, index) => index);
    const exactIndex = numericMinutes.indexOf(minute);
    if (exactIndex >= 0 && exactIndex < series.length) return safeNumber(series[exactIndex]);

    // Some exports omit minute 15 or use a shifted timeline. Fall back to the
    // closest available minute instead of silently returning an empty value.
    let nearestIndex = -1;
    let nearestDistance = Infinity;
    numericMinutes.forEach((candidate, index) => {
      if (candidate === null || index >= series.length || safeNumber(series[index]) === null) return;
      const distance = Math.abs(candidate - minute);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });
    return nearestIndex >= 0 ? safeNumber(series[nearestIndex]) : null;
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

    // The aggregate bounty share must be calculated from the total lead, not as a
    // simple average of lane-by-lane ratios (which is unstable when a gold difference is near zero).
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
    if (score >= 0.45) { label = 'Team 1 clearly favored by the data'; tone = 'team-a'; }
    else if (score >= 0.15) { label = 'Team 1 slightly favored'; tone = 'team-a'; }
    else if (score <= -0.45) { label = 'Team 2 clearly favored by the data'; tone = 'team-b'; }
    else if (score <= -0.15) { label = 'Team 2 slightly favored'; tone = 'team-b'; }
    else { label = 'Very balanced draft'; tone = 'balanced'; }
    return { score, label, tone, strength: abs >= 0.45 ? 'clear' : abs >= 0.15 ? 'light' : 'subtle', components };
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
      byId('emptyState').textContent = 'Complete at least one lane.';
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
      const adjusted = tag === 'Reliability' ? priority : Math.max(0, priority - lowSamplePenalty);
      items.push({ tag, title, text, priority: adjusted, rawPriority: priority, tone, impact: impact || impactLabel(adjusted) });
    };
    const toneFromValue = (value, inverse = false) => {
      const n = safeNumber(value); if (n === null || Math.abs(n) < 0.0001) return 'info';
      const t1 = inverse ? n < 0 : n > 0; return t1 ? 'team-a' : 'team-b';
    };
    const sideFromValue = (value, inverse = false) => {
      const n = safeNumber(value); if (n === null || Math.abs(n) < 0.0001) return 'neither team';
      const t1 = inverse ? n < 0 : n > 0; return t1 ? 'Team 1' : 'Team 2';
    };
    const sameSign = (a, b) => safeNumber(a) !== null && safeNumber(b) !== null && Math.sign(a) === Math.sign(b) && Math.abs(a) > 0.0001 && Math.abs(b) > 0.0001;

    const componentLabels = {
      diffWinrate: 'how much the matchup changes usual performance', matchupWinrate: 'direct-matchup results', gold15: 'total gold advantage at 15 minutes',
      xp15: 'total XP advantage at 15 minutes', excessGold15: 'gold created by the selected pairings at 15 minutes', killPressure: 'kill-death balance',
      excessKillPressure: 'fight balance created by the selected pairings', bountyNet: 'bounty balance', resourcePressure: 'how effectively the team converts gold and levels into wins',
      objectiveEdge: 'control of the first actions and objectives', objectiveConversion: 'how often pressure becomes turrets or objectives', monsterSequence: 'control of the neutral-objective sequence',
      comebackSafety: 'how little gold is exposed through bounties on champions with kill streaks', profileEdge: 'overall strengths of the ten champions'
    };
    const topComponent = [...(analysis.outlook.components || [])]
      .filter((c) => safeNumber(c.value) !== null)
      .sort((a, b) => Math.abs(safeNumber(b.value)) - Math.abs(safeNumber(a.value)))[0];
    if (topComponent && Math.abs(safeNumber(topComponent.value)) >= 0.18) {
      add('Main reason', `${componentLabels[topComponent.id] || topComponent.id} carries more weight than the other signals`,
        `${sideFromValue(topComponent.value)} is favored mainly by ${componentLabels[topComponent.id] || topComponent.id}. Use it as the starting point for the game plan, then check whether lanes, gold, XP, and objectives tell the same story.`,
        99, toneFromValue(topComponent.value), 'Very high');
    }

    const laneScores = analysis.lanes.map((lane) => ({ lane, score: lanePressureScore(lane) }))
      .filter((x) => safeNumber(x.score) !== null)
      .sort((a, b) => Math.abs(safeNumber(b.score)) - Math.abs(safeNumber(a.score)));
    const topLane = laneScores[0];
    if (topLane && Math.abs(safeNumber(topLane.score)) >= 0.26) {
      add('Key lane', `${roleLabel(topLane.lane.role)} is the most important lane in the draft`,
        `${sideFromValue(topLane.score)} shows the clearest advantage in ${roleLabel(topLane.lane.role)}. ${topLane.lane.data_status === 'fallback' ? 'The estimate uses the champions\' overall performance because there are not enough direct matches.' : 'The result combines win rate, gold, XP, fights, and map control.'}`,
        97, toneFromValue(topLane.score), 'Very high');
    }
    const strongLanes = laneScores.filter((x) => Math.abs(safeNumber(x.score)) >= 0.22);
    const t1Strong = strongLanes.filter((x) => safeNumber(x.score) > 0);
    const t2Strong = strongLanes.filter((x) => safeNumber(x.score) < 0);
    if (t1Strong.length >= 2 || t2Strong.length >= 2) {
      const group = t1Strong.length >= t2Strong.length ? t1Strong : t2Strong;
      const side = group === t1Strong ? 'Team 1' : 'Team 2';
      add('Map', `${side} can play through multiple lanes`, `${group.slice(0, 3).map((x) => roleLabel(x.lane.role)).join(', ')} show consistent signals. This is more stable than a single strong lane and reduces dependence on one plan.`, 92, group === t1Strong ? 'team-a' : 'team-b', 'High');
    } else if (t1Strong.length && t2Strong.length) {
      add('Map', 'The two teams have advantages in different lanes', `${roleLabel(t1Strong[0].lane.role)} tends toward Team 1, while ${roleLabel(t2Strong[0].lane.role)} leans toward Team 2. The first move can reshape the entire map.`, 88, 'info', 'High');
    }

    const snow = snowballLeader(analysis);
    if (snow) {
      const sensitivity = laneSnowballSensitivity(snow.lane);
      const pressure = lanePressureScore(snow.lane);
      if (safeNumber(sensitivity) !== null && sensitivity >= 0.12) {
        add('First advantage', `${roleLabel(snow.lane.role)} punishes falling behind more severely`,
          `Being ahead rather than behind at 15 minutes changes the win rate by ${formatPpAbs(sensitivity)}. ${Math.abs(safeNumber(pressure) ?? 0) >= 0.14 ? `In this lane, the data favors ${sideFromValue(pressure)}.` : 'The value shows how much the first advantage matters, but by itself it does not favor either team.'}`,
          sensitivity >= 0.22 ? 97 : 90, snowballToneClass(sensitivity), sensitivity >= 0.22 ? 'Very high' : 'High');
      }
    }
    if (safeNumber(analysis.scalar.avgSnowballQuality) !== null && analysis.scalar.avgSnowballQuality >= 40 && safeNumber(analysis.scalar.avgSnowballConversion) !== null && analysis.scalar.avgSnowballConversion >= 0.22) {
      add('Advantage stability', 'The draft capitalizes effectively on advantages gained in the opening minutes', `When a lane gets ahead, it maintains the advantage and converts it into wins more often than normal. The margin therefore tends to remain useful into the mid game.`, 86, 'warning', 'High');
    }

    const gold15 = safeNumber(analysis.scalar.gold15);
    const excess = safeNumber(analysis.scalar.excessGold15);
    const goldNoBounty = safeNumber(analysis.scalar.goldWithoutBounty15);
    if (gold15 !== null && Math.abs(gold15) >= 650) {
      const driver = strongestLaneBy(exact, (lane) => valueAtMinute(lane.gold_diff_by_minute, lane.minutes), Math.sign(gold15));
      add('Economy', `${sideFromValue(gold15)} is ahead in gold on average at 15 minutes`, `${intFmt(gold15, 'g')} across lanes with direct data${driver ? `, mainly thanks to ${roleLabel(driver.role)}` : ''}. The matchup-specific value indicates how much of this advantage truly comes from the selected pairings.`, 87, toneFromValue(gold15), 'High');
    }
    if (gold15 !== null && excess !== null && Math.abs(excess) >= 450) {
      if (sameSign(gold15, excess)) add('Matchup-specific advantage', 'The gold advantage also comes from the selected matchups', `${sideFromValue(excess)} remains ahead even after accounting for the champions' usual performance.`, 85, toneFromValue(excess), 'High');
      else if (Math.abs(gold15) >= 450) add('Matchup-specific advantage', 'Total gold and the matchup-specific advantage tell different stories', `${sideFromValue(gold15)} is ahead in total gold, but the adjusted value does not confirm the same side: the margin may come more from the champions' usual strength than from the direct pairings.`, 91, 'warning', 'High');
    }
    if (gold15 !== null && goldNoBounty !== null && Math.abs(gold15) >= 700) {
      if (Math.sign(gold15) !== Math.sign(goldNoBounty)) add('Watch the bounties', 'Bounties completely change the gold advantage', `With bounties, the advantage is ${intFmt(gold15)}; without bounties, it would be ${intFmt(goldNoBounty)}. The margin is fragile and can change with a single high-value death.`, 96, 'danger', 'Very high');
      else if (safeNumber(analysis.scalar.bountyShare) !== null && Math.abs(analysis.scalar.bountyShare) >= 0.9) add('Watch the bounties', 'Most of the gold advantage depends on bounties', `Bounties account for an average of ${signedPct(analysis.scalar.bountyShare)} of the advantage; without bounties, the margin is ${intFmt(goldNoBounty)}. The team ahead must avoid isolated deaths, because one major bounty can reopen the match.`, 88, 'warning', 'High');
    }

    const kd = safeNumber(analysis.scalar.kdPressure15);
    const exKd = safeNumber(analysis.scalar.excessKdPressure15);
    if (kd !== null && Math.abs(kd) >= 3) {
      const clean = exKd !== null && Math.abs(exKd) >= 2 && sameSign(kd, exKd);
      add('Trades', `${sideFromValue(kd)} gets better trades in the first 15 minutes`, `The overall kill-death balance is ${signedDecimal(kd, 2)}${exKd !== null ? `; the matchup-specific component is ${signedDecimal(exKd, 2)}` : ''}. ${clean ? 'The advantage remains even after accounting for the champions\' usual performance.' : 'Part of the result may depend on the champions\' overall characteristics.'}`, clean ? 92 : 84, toneFromValue(kd), clean ? 'High' : 'Medium-high');
    } else if (kd !== null && exKd !== null && Math.sign(kd) !== Math.sign(exKd) && Math.abs(exKd) >= 2) {
      add('Trades', 'Looking only at the number of kills can be misleading', 'The total number of kills and the actual effect of the pairings favor different sides: also examine deaths, gold, and bounties before choosing how to play.', 89, 'warning', 'High');
    }

    const bountyNet = safeNumber(analysis.scalar.bountyNetDiff15);
    const excessBounty = safeNumber(analysis.scalar.excessBountyNet15);
    if (bountyNet !== null && Math.abs(bountyNet) >= 350) add('Bounties', `${sideFromValue(bountyNet)} gains more useful gold from bounties`, `The bounty balance at 15 minutes is ${intFmt(bountyNet)}${excessBounty !== null ? `; the matchup-specific component is ${intFmt(excessBounty)}` : ''}. This metric measures the gold produced by fights, not only how many kills occur.`, 83, toneFromValue(bountyNet), 'Medium-high');

    const resource = safeNumber(analysis.scalar.resourcePressure);
    if (resource !== null && Math.abs(resource) >= 8) add('Resources', `${sideFromValue(resource)} makes better use of the gold and XP advantage`, `Gold and levels shift win probability more toward ${sideFromValue(resource)}. This accounts for both who gains more gold and XP and how effectively the selected champions normally convert those resources into wins.`, Math.abs(resource) >= 18 ? 92 : 84, toneFromValue(resource), 'High');

    const firstKillEdge = safeNumber(analysis.scalar.firstKillEdge);
    if (firstKillEdge !== null && Math.abs(firstKillEdge) >= 0.055) {
      add('First event', `${sideFromValue(firstKillEdge)} starts the duel more often`, `First-kill margin in the pair ${signedPct(firstKillEdge)}. Outcomes with no kill are not forced into the comparison.`, Math.abs(firstKillEdge) >= 0.12 ? 87 : 73, toneFromValue(firstKillEdge), Math.abs(firstKillEdge) >= 0.12 ? 'High' : 'Medium');
    }

    const level6 = safeNumber(analysis.scalar.level6TimingEdge);
    if (level6 !== null && Math.abs(level6) >= 0.35) {
      add('Timing', `${sideFromValue(level6)} reaches level 6 earlier`, `Aggregate timing advantage ${Math.abs(level6).toFixed(2)} minutes. This is a concrete window for contests, roams, and the first coordinated reset.`, Math.abs(level6) >= 0.8 ? 86 : 72, toneFromValue(level6), Math.abs(level6) >= 0.8 ? 'High' : 'Medium');
    }

    const towerTiming = safeNumber(analysis.scalar.towerTimingEdge);
    if (towerTiming !== null && Math.abs(towerTiming) >= 1.5) {
      add('Structures', `${sideFromValue(towerTiming)} tends to keep turrets standing longer`, `Average takedown-time difference ${minutesFmt(towerTiming)}. The signal describes structural durability and earlier access to the map.`, Math.abs(towerTiming) >= 3.5 ? 82 : 69, toneFromValue(towerTiming), 'Medium');
    }

    const goldDep = safeNumber(analysis.scalar.goldDependencyEdge);
    const xpDep = safeNumber(analysis.scalar.xpDependencyEdge);
    if ((goldDep !== null && Math.abs(goldDep) >= 12) || (xpDep !== null && Math.abs(xpDep) >= 12)) {
      const driver = Math.abs(goldDep ?? 0) >= Math.abs(xpDep ?? 0) ? goldDep : xpDep;
      const resourceName = driver === goldDep ? 'gold' : 'XP';
      add('Dependency', `${sideFromValue(driver)} is more dependent on ${resourceName}`, `Overall difference in the impact of gold ${signedDecimal(goldDep, 1)} · XP ${signedDecimal(xpDep, 1)}. If that side loses access to resources, the composition loses effectiveness more quickly.`, 74, 'warning', 'Medium');
    }

    const goldPerKill = safeNumber(analysis.scalar.goldPerKillEfficiency);
    const xpPerKill = safeNumber(analysis.scalar.xpPerKillEfficiency);
    if ((goldPerKill !== null && Math.abs(goldPerKill) >= 950) || (xpPerKill !== null && Math.abs(xpPerKill) >= 950)) {
      add('Impact of a kill', 'A single kill can shift a large amount of resources', `Gold gained for each kill above deaths ${compactNumber(goldPerKill)} · XP gained ${compactNumber(xpPerKill)}. This is a neutral indicator: it shows how much a fight can shift the match, not who will win it.`, 78, 'warning', 'Medium-high');
    }

    const objective = safeNumber(analysis.scalar.objectiveEdge);
    const sequence = safeNumber(analysis.scalar.monsterSequenceControl);
    if (sequence !== null && Math.abs(sequence) >= 0.08 && (analysis.scalar.monsterSequenceEvents ?? 0) >= 8) add('Objective sequence', `${sideFromValue(sequence)} controls the sequence of neutral objectives better`, `The control indicator is ${signedDecimal(sequence, 3)}, with a total difference of ${signedDecimal(analysis.scalar.monsterSequenceDiff, 1)} objectives across ${compactNumber(analysis.scalar.monsterSequenceEvents)} events.`, Math.abs(sequence) >= 0.18 ? 91 : 81, toneFromValue(sequence), 'High');
    else if (objective !== null && Math.abs(objective) >= 0.025) add('Important early actions', `${sideFromValue(objective)} controls the first actions of the match more often`, `The average margin is ${signedPct(objective)} considering first kill, first tower, and available objectives.`, 77, toneFromValue(objective), 'Medium');

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
        add('Most one-sided objective', `${monsterDriver.label} is the objective with the clearest difference`, `${sideFromValue(monsterDriver.edge)} captures it in ${pct(0.5 + Math.abs(monsterDriver.edge), 0)} of the cases considered, across ${compactNumber(monsterDriver.events)} events.`, Math.abs(monsterDriver.edge) >= 0.15 ? 84 : 71, toneFromValue(monsterDriver.edge), 'Medium-high');
      }
    }

    const comeback = safeNumber(analysis.scalar.comebackRiskEdge);
    if (comeback !== null && Math.abs(comeback) >= 500) add('Comeback risk', `${sideFromValue(comeback)} is more likely to give away more gold through a major bounty`, `The value potentially at risk is ${compactNumber(analysis.team1Profile.metrics.comebackRisk)} for Team 1 and ${compactNumber(analysis.team2Profile.metrics.comebackRisk)} for Team 2. The more exposed team must avoid isolated deaths, risky recalls, and uncovered side lanes.`, Math.abs(comeback) >= 1200 ? 89 : 76, toneFromValue(comeback, true), 'High');

    const shutdownExposure = safeNumber(analysis.scalar.shutdownExposureEdge);
    const shutdownCollection = safeNumber(analysis.scalar.shutdownCollectionEdge);
    if ((shutdownExposure !== null && Math.abs(shutdownExposure) >= 0.055) || (shutdownCollection !== null && Math.abs(shutdownCollection) >= 0.055)) {
      const riskSide = shutdownExposure !== null && Math.abs(shutdownExposure) >= 0.055 ? shutdownExposure : negate(shutdownCollection);
      add('Bounty management', `${sideFromValue(riskSide)} has the riskiest bounty profile`, `Difference in major bounties given away ${signedPct(shutdownExposure)} · collected ${signedPct(shutdownCollection)}. When the most important champion has a large bounty, protecting them is often worth more than forcing a low-value fight.`, 70, 'warning', 'Medium');
    }

    const volatile = maxBy(exact, (lane) => safeNumber(lane.volatility_15m_a) ?? safeNumber(lane.gold_diff_std_15m));
    const volatileIndex = safeNumber(volatile?.volatility_15m_a);
    const volatileStd = safeNumber(volatile?.gold_diff_std_15m);
    if (volatile && ((volatileIndex !== null && volatileIndex >= 9) || (volatileStd !== null && volatileStd >= 1700))) add('Variable matches', `${roleLabel(volatile.role)} is the lane that can change the most from one match to another`, `Gold fluctuates by an average of ${compactNumber(volatileStd)} from one match to another. Prepare more than one plan: this lane can become favorable or difficult very quickly.`, 76, 'warning', 'Medium');

    const phaseEdges = PHASES.map((phase) => ({
      phase,
      kd: diffNullable(analysis.killPhase.team1[phase.key]?.kdDiff, analysis.killPhase.team2[phase.key]?.kdDiff),
      bounty: diffNullable(analysis.killPhase.team1[phase.key]?.bountyNet, analysis.killPhase.team2[phase.key]?.bountyNet)
    })).sort((a, b) => (Math.abs(b.kd ?? 0) + Math.abs(b.bounty ?? 0) / 300) - (Math.abs(a.kd ?? 0) + Math.abs(a.bounty ?? 0) / 300));
    const phaseDriver = phaseEdges[0];
    if (phaseDriver && (Math.abs(phaseDriver.kd ?? 0) >= 0.45 || Math.abs(phaseDriver.bounty ?? 0) >= 180)) {
      const phaseValue = Math.abs(phaseDriver.kd ?? 0) >= 0.45 ? phaseDriver.kd : phaseDriver.bounty;
      add('Key phase', `${phaseDriver.phase.title} is the phase in which the teams differ the most`, `${sideFromValue(phaseValue)} performs better in this phase: the kill-death balance per match is ${signedDecimal(phaseDriver.kd, 2)} and the difference in bounty balance is ${intFmt(phaseDriver.bounty)}.`, 80, toneFromValue(phaseValue), 'Medium-high');
    }

    const ccDiff = diffMetric(analysis.team1Profile, analysis.team2Profile, 'ccTotal');
    const visionDiff = diffMetric(analysis.team1Profile, analysis.team2Profile, 'vision');
    if (ccDiff !== null && Math.abs(ccDiff) >= 25) add('Combat', `${sideFromValue(ccDiff)} has more tools to stop and engage enemies`, `The team has more stuns, roots, slows, and other crowd control, making it easier to start a fight, lock down a target, and fight in a coordinated way.`, 72, toneFromValue(ccDiff), 'Medium');
    if (visionDiff !== null && Math.abs(visionDiff) >= 28) add('Vision', `${sideFromValue(visionDiff)} tends to have more vision control`, 'This is an average tendency of the selected champions: it can make objective setup and entrance control easier, but it does not measure the players\' actual warding quality.', 68, toneFromValue(visionDiff), 'Medium');

    const addDamageInsight = (teamName, mix, tone) => {
      const phys = safeNumber(mix.physical), magic = safeNumber(mix.magic), pure = safeNumber(mix.true);
      if (phys !== null && phys >= 0.66) add('Damage', `${teamName} deals mostly physical damage`, `${pct(phys, 0)} of the damage is physical: enemy armor becomes particularly effective.`, 66, tone, 'Medium');
      else if (magic !== null && magic >= 0.58) add('Damage', `${teamName} deals mostly magic damage`, `${pct(magic, 0)} of the damage is magic: enemy magic resistance becomes more valuable.`, 66, tone, 'Medium');
      else if (pure !== null && pure >= 0.11) add('Damage', `${teamName} has a significant share of true damage`, `${pct(pure, 0)} of the damage is true and ignores armor and magic resistance, so it is harder to reduce with a single defense type.`, 62, tone, 'Medium-low');
    };
    addDamageInsight('Team 1', analysis.team1Profile.damageMix, 'team-a');
    addDamageInsight('Team 2', analysis.team2Profile.damageMix, 'team-b');

    const lowRoles = exact.filter((lane) => lane.low_sample).map((lane) => roleLabel(lane.role));
    if (lowRoles.length) add('Reliability', `${lowRoles.join(', ')} ${lowRoles.length === 1 ? 'has' : 'have'} few matches available`, 'Recommendations based on these lanes receive less weight because the result can change more easily as new matches are added.', 64, 'warning', 'Medium');
    if (!items.length) add('Summary', 'No aspect clearly favors either team', 'The draft is balanced: use the sections to find specific windows, such as a lane that is sensitive to the first advantage or a composition that depends too heavily on one damage type.', 50, 'info', 'Medium');

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
    if (priority >= 94) return 'Very high';
    if (priority >= 82) return 'High';
    if (priority >= 66) return 'Medium';
    return 'Low';
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
        out.push({ level: 'critical', text: `${label}: incomplete selection, lane excluded from aggregates.` });
        return;
      }
      if (lane.reason === 'same_champion') {
        out.push({ level: 'critical', text: `${label}: the same champion is selected by both teams.` });
        return;
      }
      if (lane.data_status === 'fallback') {
        out.push({ level: 'warning', text: `${label}: direct matchup unavailable; analysis is based on the champions' general profiles.` });
      }
      if (lane.data_status === 'missing') {
        out.push({ level: 'critical', text: `${label}: insufficient data for this lane.` });
      }
      if (lane.low_sample) {
        out.push({ level: 'warning', text: `${label}: champion data reduced; useful but not conclusive.` });
      }
      if (lane.data_status === 'exact') {
        for (const field of SIGNED_ARRAY_FIELDS) {
          if (!Array.isArray(lane[field]) || !lane[field].length) {
            out.push({ level: 'warning', text: `${label}: time series ${field.replaceAll('_', ' ')} missing.` });
          }
        }
        if (lane.role === 'JUNGLE' && !getMonsterPctKeys(lane).length) {
          out.push({ level: 'warning', text: `${label}: monster-objective metrics unavailable.` });
        }
      }
    });

    if (!analysis.exact.length) {
      out.push({ level: 'critical', text: 'No direct matchup is available: the timeline and lane-specific signals are limited.' });
    }

    if (!out.length) {
      out.push({ level: 'ok', text: 'Good reliability: no critical warnings emerged in the selected lanes.' });
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

    [
      ['outlook', renderOutlook],
      ['visual summary', renderVisualSummary],
      ['snowball', renderSnowball],
      ['timeline controls', renderTimelineControls],
      ['timeline', renderTimeline],
      ['lane matrix', renderLaneMatrix],
      ['damage and profiles', renderDamageAndProfile],
      ['advanced metrics', renderAdvancedMetrics],
      ['kill phases', renderKillPhase],
      ['radar', renderRadar],
      ['insights', renderInsights],
      ['warnings', renderWarnings],
      ['dataset atlas', renderRaw]
    ].forEach(([label, renderer]) => {
      try {
        renderer(analysis);
      } catch (error) {
        console.error(`[Team DraftLab] Rendering failed in ${label}.`, error);
      }
    });
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
          <div class="micro-label">Draft summary</div>
          <h2 class="outlook-title" id="outlookTitle">${esc(analysis.outlook.label)}</h2>
          <p class="outlook-copy">${esc(copy)}</p>
        </div>
        <div class="outlook-score ${esc(analysis.outlook.tone)}" title="Balance across multiple draft signals. This is not a win probability.">
          <div>
            <strong>${signedDecimal(score, 2)}</strong>
            <span>draft balance</span>
          </div>
        </div>
      </div>
      <p class="plain-language-note"><strong>How to read the balance:</strong> it combines up to 14 signals—lanes, gold, XP, fights, bounties, objectives, and champion characteristics—after placing them on the same scale. Each available signal counts equally; extreme values are capped, and missing data is not invented. The result ranges from −1 to +1: a value near 0 means balance. It is not a win probability.</p>
      <div class="kpi-grid">
        ${kpiHtml('Gold @15', intFmt(analysis.scalar.gold15, 'g'), teamNameFromValue(analysis.scalar.gold15), toneClass(analysis.scalar.gold15))}
        ${kpiHtml('XP @15', intFmt(analysis.scalar.xp15), teamNameFromValue(analysis.scalar.xp15), toneClass(analysis.scalar.xp15))}
        ${kpiHtml('Kill-death balance', signedDecimal(analysis.scalar.kdPressure15, 2), teamNameFromValue(analysis.scalar.kdPressure15), toneClass(analysis.scalar.kdPressure15))}
        ${kpiHtml('Bounty balance', intFmt(analysis.scalar.bountyNetDiff15), teamNameFromValue(analysis.scalar.bountyNetDiff15), toneClass(analysis.scalar.bountyNetDiff15))}
        ${kpiHtml('Gold attributable to matchups', intFmt(analysis.scalar.excessGold15, 'g'), teamNameFromValue(analysis.scalar.excessGold15), toneClass(analysis.scalar.excessGold15))}
        ${kpiHtml('Impact of the first advantage', snowballKpiValue(analysis), snowballKpiSub(analysis), snowballKpiClass(analysis))}
      </div>
    `;
  }

  function outlookCopy(analysis) {
    const parts = [];
    const leader = analysis.outlook.tone === 'team-a' ? 'Team 1' : analysis.outlook.tone === 'team-b' ? 'Team 2' : null;
    if (leader) parts.push(`${leader} is favored with a ${analysis.outlook.strength}advantage, built by comparing lanes, resources, objectives, and composition characteristics.`);
    else parts.push('The draft is close to balanced: neither team is clearly favored by the data as a whole.');

    if (safeNumber(analysis.scalar.gold15) !== null) parts.push(`Total gold difference at 15 minutes: ${intFmt(analysis.scalar.gold15, 'g')}.`);
    if (safeNumber(analysis.scalar.kdPressure15) !== null) parts.push(`Kill-death balance at 15 minutes: ${signedDecimal(analysis.scalar.kdPressure15, 2)}.`);
    if (safeNumber(analysis.scalar.bountyNetDiff15) !== null) parts.push(`Difference in bounty balance at 15 minutes: ${intFmt(analysis.scalar.bountyNetDiff15)}.`);
    if (safeNumber(analysis.scalar.objectiveEdge) !== null) parts.push(`Average advantage in early actions and objectives: ${signedPct(analysis.scalar.objectiveEdge)}.`);
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

    // Visual fallback: correlation is not a win-rate difference,
    // but it can still show whether the gold advantage at 15 is informative about the outcome.
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
    if (n === null) return 'partial data';
    if (n >= 0.25) return 'explosive';
    if (n >= 0.16) return 'high';
    if (n >= 0.08) return 'medium';
    return 'low';
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
    if (!lead) return 'data unavailable';
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
      target.innerHTML = '<div class="empty-note">There is not enough data to measure how much the first advantage matters in the selected lanes.</div>';
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
        <div class="micro-label">Impact of the first advantage</div>
        <strong class="snowball-value ${esc(avgTone)}">${esc(avgSensitivity === null ? '—' : `${(avgSensitivity * 100).toFixed(1)}pp`)}</strong>
        <p>Measures how much the win rate changes between being ahead and being behind at 15 minutes. It does not choose the favored team by itself: it shows how costly the first mistake can be.</p>
        <p><strong>${esc(leaderRole)}</strong> is the most sensitive lane${leaderSensitivity === null ? '.' : `: ${esc(formatPpAbs(leaderSensitivity))}, level ${esc(snowballTierLabel(leaderSensitivity))}.`}</p>
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
      ? `advantage-to-win link ${Math.abs(corr ?? 0).toFixed(2)}`
      : `${formatPpAbs(sensitivity)} · ${snowballTierLabel(sensitivity)}`;

    return `
      <article class="snowball-lane-card">
        <div class="snowball-lane-role">${esc(roleLabel(lane.role))}</div>
        <div class="snowball-bars">
          <div class="snowball-meta"><span>Wins when ahead ${esc(pct(ahead, 0))}</span><span>Wins when behind ${esc(pct(behind, 0))}</span></div>
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
      ['Lanes', normalizeComponent(analysis.scalar.avgMatchupWinrateEdge, 0.08)],
      ['Gold 15', normalizeComponent(analysis.scalar.gold15, 3500)],
      ['XP 15', normalizeComponent(analysis.scalar.xp15, 3500)],
      ['Matchup-specific advantage', normalizeComponent(analysis.scalar.excessGold15, 2500)],
      ['Fights', normalizeComponent(analysis.scalar.kdPressure15, 1.8)],
      ['Bounties', normalizeComponent(analysis.scalar.bountyNetDiff15, 650)],
      ['Objectives', normalizeComponent(analysis.scalar.objectiveEdge, 0.12)],
      ['Pressure → objectives', normalizeComponent(analysis.scalar.objectiveConversion, 0.12)],
      ['Combat', radarEdge('damage', 'durability', 'cc', 'kill', 'safety')],
      ['Vision', radarEdge('vision')],
      ['Economy', radarEdge('gold', 'xp', 'auc', 'bounty', 'bountyEfficiency')],
      ['Time to level 6', radarEdge('level6')]
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

    byId('timelineNote').textContent = `${mode.note} Value @15: ${intFmt(at15, mode.suffix)}.`;
    byId('timelineChart').innerHTML = buildTimelineSvg(data.points, mode.suffix);
    byId('timelineLegend').innerHTML = `
      <span><i style="background:var(--champ-a)"></i>Team 1 above zero</span>
      <span><i style="background:var(--champ-b)"></i>Team 2 below zero</span>
      <span>${data.exactCount} exact lanes included</span>
    `;
  }

  function buildTimelineSvg(points, suffix) {
    if (!Array.isArray(points) || points.length < 2) {
      return '<div class="empty-note">Timeline unavailable for the selected lanes.</div>';
    }

    const width = 920;
    const height = 300;
    const pad = { l: 52, r: 28, t: 28, b: 38 };
    const xs = points.map((p) => p.minute).filter(Number.isFinite);
    const ys = points.map((p) => safeNumber(p.value)).filter((v) => v !== null);
    if (xs.length < 2 || ys.length < 2) {
      return '<div class="empty-note">Timeline unavailable for the selected lanes.</div>';
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
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Aggregated timeline">
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
            <span class="t1">${lane.team1Champion ? champHtml(lane.team1Champion, 'sm') : '—'}</span>
            <span class="vs">vs</span>
            <span class="t2">${lane.team2Champion ? champHtml(lane.team2Champion, 'sm') : '—'}</span>
          </strong>
          <span>${esc(laneSubline(lane))}</span>
        </div>
        <div class="lane-visual">
          <div class="lane-pressure-track">
            <span class="lane-pressure-fill ${esc(scoreCls)}" style="width:${scoreWidth.toFixed(1)}%"></span>
          </div>
          <div class="lane-signal-row">
            ${signalChip('Wins', pct(lane.winrate_a), toneClass((safeNumber(lane.winrate_a) ?? 0.5) - 0.5))}
            ${signalChip('Gold', intFmt(gold15, 'g'), toneClass(gold15))}
            ${signalChip('XP', intFmt(xp15), toneClass(xp15))}
            ${signalChip('Matchup-specific advantage', intFmt(excess15, 'g'), toneClass(excess15))}
            ${signalChip('Fight balance', signedDecimal(lane.early_kd_pressure_15m_a_minus_b, 2), toneClass(lane.early_kd_pressure_15m_a_minus_b))}
            ${signalChip('Bounties', intFmt(lane.avg_bounty_net_diff_15m_a_minus_b), toneClass(lane.avg_bounty_net_diff_15m_a_minus_b))}
            ${signalChip('Level 6', minutesFmt(level6Diff(lane)), toneClass(level6Diff(lane), true))}
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
    if (!lane.team1Champion || !lane.team2Champion) return 'select both champions';
    if (lane.reason === 'same_champion') return 'the same champion cannot be on both teams';
    if (lane.data_status === 'exact') {
      const sample = isFiniteNumber(lane.n_matches) ? `${Math.round(lane.n_matches)} direct matches` : 'number of matches unavailable';
      return `${sample}${lane.low_sample ? ' · result should be interpreted with caution' : ''}${lane.orientation === 'reverse' ? ' · data shown from Team 1\'s perspective' : ''}`;
    }
    if (lane.data_status === 'fallback') return 'estimate based on the champions\' general performance, not direct matches';
    return 'insufficient data for a comparison';
  }

  function laneStatusLabel(lane) {
    if (lane.data_status === 'exact') return lane.low_sample ? 'direct data · few matches' : 'direct data';
    if (lane.data_status === 'fallback') return 'estimate based on the champions\' typical performance';
    return 'data unavailable';
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
            <div class="micro-label">Quick fight summary</div>
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
        ${combatSummaryCardHtml('Fight power', diffNullable(t1.damageOutput, t2.damageOutput), 12000, compactNumber, 'Who tends to deal more damage in standard fights.')}
        ${combatSummaryCardHtml('Durability', diffNullable(t1.damageTaken, t2.damageTaken), 9000, compactNumber, 'Who is more often able to absorb damage and remain in the fight.')}
        ${combatSummaryCardHtml('Crowd control', diffNullable(t1.ccTotal, t2.ccTotal), 45, (v) => signedDecimal(v, 1), 'Stuns, roots, slows, and other effects useful for starting or stopping a fight.')}
        ${combatSummaryCardHtml('Vision', diffNullable(t1.vision, t2.vision), 22, (v) => signedDecimal(v, 1), 'Average map control: helps prepare objectives and ambushes.')}
      </div>
      <div class="combat-team-grid">
        ${combatTeamIdentityHtml('Team 1', analysis.team1Profile, 'team-a')}
        ${combatTeamIdentityHtml('Team 2', analysis.team2Profile, 'team-b')}
      </div>
    `;

    byId('teamProfileStats').innerHTML = `
      <div class="combat-band-grid">
        ${combatBandHtml(
          'Early-game fights',
          'A quick reading of who tends to gain advantages or overexpose themselves before 15 minutes.',
          [
            metricCompareBar('Kill 0–10', t1.kills10, t2.kills10, (v) => signedDecimal(v, 2)),
            metricCompareBar('Kill 0–15', t1.kills15, t2.kills15, (v) => signedDecimal(v, 2)),
            metricCompareBar('Deaths 0–10', t1.deaths10, t2.deaths10, (v) => signedDecimal(v, 2)),
            metricCompareBar('Deaths 0–15', t1.deaths15, t2.deaths15, (v) => signedDecimal(v, 2))
          ]
        )}
        ${combatBandHtml(
          'Bounties and risk',
          'It is not only about who gets kills: the amount of useful gold gained or potentially returned to the opponent also matters.',
          [
            metricCompareBar('Bounty balance', t1.bountyNet, t2.bountyNet, compactNumber),
            metricCompareBar('Major bounties collected', t1.shutdownCollected, t2.shutdownCollected, (v) => pct(v, 1)),
            metricCompareBar('Major bounties given up', t1.shutdownGiven, t2.shutdownGiven, (v) => pct(v, 1)),
            metricCompareBar('Comeback risk', t1.comebackRisk, t2.comebackRisk, compactNumber)
          ]
        )}
        ${combatBandHtml(
          'How gold and levels perform',
          'Helps explain who uses resources better and how much an economic or experience advantage matters.',
          [
            metricCompareBar('How much gold matters for winning', t1.goldDependency, t2.goldDependency, (v) => signedDecimal(v, 2)),
            metricCompareBar('How much levels matter for winning', t1.xpDependency, t2.xpDependency, (v) => signedDecimal(v, 2)),
            metricCompareBar('Average bounty per kill', t1.bountyPerKill, t2.bountyPerKill, compactNumber),
            metricCompareBar('Gold collected from bounties', t1.bountyGained, t2.bountyGained, compactNumber)
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
        key: 'damage', icon: '⚔', label: 'Fight power',
        delta: diffNullable(t1.damageOutput, t2.damageOutput), scale: 12000,
        good: 'tends to deal more damage when the fight starts'
      },
      {
        key: 'durability', icon: '🛡', label: 'Durability',
        delta: diffNullable(t1.damageTaken, t2.damageTaken), scale: 9000,
        good: 'has more room to absorb damage and stay in the fight'
      },
      {
        key: 'cc', icon: '✦', label: 'Crowd control',
        delta: diffNullable(t1.ccTotal, t2.ccTotal), scale: 45,
        good: 'has more tools to lock down targets or start the fight'
      },
      {
        key: 'vision', icon: '◉', label: 'Vision',
        delta: diffNullable(t1.vision, t2.vision), scale: 22,
        good: 'arrives better prepared for objectives and engages more often'
      },
      {
        key: 'early', icon: '↗', label: 'Early trades',
        delta: fightDelta, scale: 4,
        good: 'tends to come out ahead in fights during the first 15 minutes'
      }
    ].map((item) => {
      const normalized = normalizeComponent(item.delta, item.scale);
      return {
        ...item,
        normalized,
        abs: Math.abs(safeNumber(normalized) ?? 0),
        leader: normalized === null || Math.abs(normalized) < 0.06 ? 'Balance' : (normalized > 0 ? 'Team 1' : 'Team 2')
      };
    }).sort((a, b) => b.abs - a.abs);

    const available = reasons.filter((item) => item.normalized !== null);
    const total = available.reduce((sum, item) => sum + item.normalized, 0);
    const tone = total > 0.12 ? 'team-a' : total < -0.12 ? 'team-b' : 'neutral';
    const strength = Math.abs(total);
    const title = tone === 'team-a'
      ? 'Team 1 appears better prepared to win fights'
      : tone === 'team-b'
        ? 'Team 2 appears better prepared to win fights'
        : 'Fights between the two teams appear very close';
    const badge = tone === 'team-a' ? 'Team 1 ahead' : tone === 'team-b' ? 'Team 2 ahead' : 'Balanced fights';
    const badgeSub = strength >= 1.4 ? 'very clear advantage' : strength >= 0.65 ? 'noticeable advantage' : 'narrow margin';

    const topReasons = available.slice(0, 3).map((item) => ({
      icon: item.icon,
      label: item.label,
      leader: item.leader,
      tone: item.leader === 'Team 1' ? 'team-a' : item.leader === 'Team 2' ? 'team-b' : 'neutral',
      copy: item.leader === 'Balance' ? 'fairly close result between the two teams' : `${item.leader} · ${item.good}`
    }));

    let copy = 'The summary combines damage, durability, crowd control, vision, and early-fight behavior.';
    if (tone === 'team-a') copy = 'Overall, Team 1 combines damage, durability, and fight preparation better. The three most important reasons are shown immediately below.';
    else if (tone === 'team-b') copy = 'Overall, Team 2 combines damage, durability, and fight preparation better. The three most important reasons are shown immediately below.';
    else copy = 'The two teams start with similar tools: to interpret the fights properly, review the three signals below and then the essential details.';

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
    const leader = n === null || Math.abs(n) < 0.0001 ? 'Balance' : (n > 0 ? 'Team 1' : 'Team 2');
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
      { key: 'physical', value: physical, label: 'mostly physical damage' },
      { key: 'magic', value: magic, label: 'mostly magic damage' },
      { key: 'true', value: pure, label: 'above-average true-damage share' }
    ].sort((a, b) => b.value - a.value);
    if (!entries[0] || entries[0].value <= 0) return 'damage profile unavailable';
    if (entries[0].value < 0.45) return 'fairly mixed damage profile';
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
    const pressureText = pressure === null ? 'fight-pressure data unavailable' : pressure >= 0 ? 'tends to come out of fights with a positive balance' : 'tends to pay a higher price in prolonged fights';
    return `
      <article class="combat-team-card ${esc(cls)}">
        <div class="combat-team-head">
          <div>
            <span class="micro-label">${esc(label)}</span>
            <h3>${esc(label)} · combat identity</h3>
          </div>
          <span class="status-badge ${esc(cls)}">${esc(dominantDamageText(mix))}</span>
        </div>
        ${stackRowHtml('Damage type', mix, cls)}
        <p class="combat-style-line">${esc(pressureText)}. The profile below summarizes damage, durability, crowd control, and vision.</p>
        <div class="combat-pill-grid">
          ${combatPillHtml('Damage', radar.damage)}
          ${combatPillHtml('Durability', radar.durability)}
          ${combatPillHtml('Crowd control', radar.cc)}
          ${combatPillHtml('Vision', radar.vision)}
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
          <span>${pct(p1, 0)} physical · ${pct(p2, 0)} magic · ${pct(p3, 0)} true</span>
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
    if (n === null || Math.abs(n) <= threshold) return 'Balance';
    const team1 = inverse ? n < 0 : n > 0;
    return team1 ? 'Team 1' : 'Team 2';
  }

  function advancedEdgeCard(label, value, scale, formatter, description, options = {}) {
    const n = safeNumber(value);
    const inverse = !!options.inverse;
    const neutral = !!options.neutral;
    const strength = n === null ? 0 : Math.min(100, Math.abs(n) / Math.max(scale || 1, 0.0001) * 100);
    const leader = neutral ? (options.neutralLabel || 'Context indicator') : advancedLeader(n, inverse, options.threshold || 0);
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
        <div class="advanced-card-head"><div><span>Jungle objective network</span><h3>Control by monster subtype</h3></div><em>${champHtml(jungle.team1Champion, 'xs')} <span>vs</span> ${champHtml(jungle.team2Champion, 'xs')}</em></div>
        <div class="advanced-monster-grid">
          ${rows.map((row) => {
            const a = Math.max(0, Math.min(100, row.pctValue * 100));
            const b = Math.max(0, 100 - a);
            return `<div class="advanced-monster-row">
              <div><strong>${esc(row.label)}</strong><span>${esc(compactNumber(row.events))} events</span></div>
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
      advancedEdgeCard('Gold excluding bounties @15', s.goldWithoutBounty15, 2400, (v) => intFmt(v, 'g'), 'Isolates the portion of the advantage that does not depend on bounties.'),
      advancedEdgeCard('Structural share of the lead', leadQuality, 1.25, (v) => `${(v * 100).toFixed(0)}%`, 'Ratio of gold excluding bounties to total gold: a value near 100% indicates a more stable lead.', { neutral: true, neutralLabel: 'Lead quality' }),
      advancedEdgeCard('Resource pressure', s.resourcePressure, 35, (v) => `${signedDecimal(v, 1)} pp`, 'Estimates how available gold and XP translate into win probability.'),
      advancedEdgeCard('First kill in the pair', s.firstKillEdge, 0.18, (v) => signedPct(v, 1), 'Difference between Team 1\'s first-kill share and the share conceded to Team 2.'),
      advancedEdgeCard('Level 6 timing', s.level6TimingEdge, 1.5, (v) => `${signedDecimal(v, 2)} min`, 'Positive value: Team 1 reaches level 6 earlier overall.'),
      advancedEdgeCard('Tower durability', s.towerTimingEdge, 5, (v) => minutesFmt(v), 'Positive value: Team 1\'s towers fall later on average.'),
      advancedEdgeCard('How much an early advantage leads to victory', s.avgSnowballConversion, 0.55, (v) => signedDecimal(v, 3), 'Shows how the outcome changes when a team is ahead at 15 minutes. By itself, it does not indicate which team will be ahead.', { neutral: true, neutralLabel: 'Impact of being ahead' }),
      advancedEdgeCard('Volatility @15', s.volatilityIndex, 12, (v) => signedDecimal(v, 2), 'Matchup instability index: a higher value means greater variance and fewer rigid scripts.', { neutral: true, neutralLabel: 'Variance risk' }),
      advancedEdgeCard('Gold per net kill', s.goldPerKillEfficiency, 1200, (v) => compactNumber(v), 'Economic impact associated with one net kill; by itself, it does not identify the favored team.', { neutral: true, neutralLabel: 'Economic amplification' }),
      advancedEdgeCard('Reliability of early-advantage data', s.avgSnowballQuality, 60, (v) => signedDecimal(v, 1), 'How stable the relationship is between the advantage at 15 minutes and the final outcome in lanes with enough matches.', { neutral: true, neutralLabel: 'Data robustness' })
    ].join('');

    const lanes = analysis.exact.map((lane) => `
      <article class="advanced-lane-card">
        <header><div><span>${esc(roleLabel(lane.role))}</span><strong>${champHtml(lane.team1Champion, 'xs')} <em>vs</em> ${champHtml(lane.team2Champion, 'xs')}</strong></div><b>${esc(compactNumber(lane.n_matches))} game</b></header>
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
          <h3>From raw data to a game plan.</h3>
          <p>The cards distinguish advantage, stability, and risk. Neutral indicators describe how much the draft amplifies events without artificially crediting either team.</p>
        </div>
        <div class="advanced-signal-grid">${signals}</div>
      </div>
      <div class="advanced-lanes-head"><div><span>Lane intelligence</span><h3>Where advanced signals originate</h3></div><p>Each lane shows only the most useful operational metrics; the complete atlas retains every field.</p></div>
      <div class="advanced-lane-grid">${lanes || '<div class="empty-note">No direct matchup available.</div>'}</div>
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
            <div><span>Kills per match · T1 / T2</span><strong>${esc(signedDecimal(t1.killEvents, 2))} / ${esc(signedDecimal(t2.killEvents, 2))}</strong></div>
            <div><span>Deaths per match · T1 / T2</span><strong>${esc(signedDecimal(t1.deathEvents, 2))} / ${esc(signedDecimal(t2.deathEvents, 2))}</strong></div>
            <div><span>Kill-death balance · T1 / T2</span><strong>${esc(signedDecimal(t1.kdDiff, 2))} / ${esc(signedDecimal(t2.kdDiff, 2))}</strong></div>
            <div><span>Difference in bounty balance</span><strong class="${esc(toneClass(bountyEdge))}">${esc(intFmt(bountyEdge))}</strong></div>
            <div><span>Wins in matches with a kill during this phase</span><strong>${esc(pct(t1.killWinrate, 0))} / ${esc(pct(t2.killWinrate, 0))}</strong></div>
            <div><span>Wins in matches with a death during this phase</span><strong>${esc(pct(t1.deathWinrate, 0))} / ${esc(pct(t2.deathWinrate, 0))}</strong></div>
            <div><span>Average gold gained per kill</span><strong>${esc(intFmt(t1.killBounty))} / ${esc(intFmt(t2.killBounty))}</strong></div>
            <div><span>Average gold given away per death</span><strong>${esc(intFmt(t1.deathBounty))} / ${esc(intFmt(t2.deathBounty))}</strong></div>
            <div><span>Average kill streak</span><strong>${esc(signedDecimal(t1.killStreak, 2))} / ${esc(signedDecimal(t2.killStreak, 2))}</strong></div>
            <div><span>Bounty balance per match</span><strong>${esc(intFmt(t1.bountyNet))} / ${esc(intFmt(t2.bountyNet))}</strong></div>
          </div>
          <div class="phase-team-bars"><div class="phase-bar"><span class="team-a" style="width:${Math.min(100, Math.abs(safeNumber(t1.kdDiff) ?? 0) * 28).toFixed(1)}%"></span></div><div class="phase-bar"><span class="team-b" style="width:${Math.min(100, Math.abs(safeNumber(t2.kdDiff) ?? 0) * 28).toFixed(1)}%"></span></div></div>
        </article>`;
    }).join('');
  }

  function renderRadar(analysis) {
    const radarSets = [
      {
        title: 'Overall identity',
        note: 'Comparison from 0 to 100 of the five champions\' average characteristics.',
        axes: [
          ['winrate', 'Wins'],
          ['damage', 'Damage'],
          ['durability', 'Durability'],
          ['cc', 'Crowd control (CC)'],
          ['vision', 'Vision'],
          ['gold', 'Gold'],
          ['xp', 'XP'],
          ['level6', 'Level 6'],
          ['kill', 'Fights'],
          ['bounty', 'Bounties']
        ]
      },
      {
        title: 'Combat and control',
        note: 'Damage, durability, crowd control, and vision.',
        axes: [
          ['damage', 'Damage'],
          ['durability', 'Durability'],
          ['cc', 'Crowd control (CC)'],
          ['vision', 'Vision'],
          ['kill', 'Fights'],
          ['safety', 'Safety'],
          ['shutdown', 'Bounties collected']
        ]
      },
      {
        title: 'Resources and power spikes',
        note: 'How gold and XP become wins and how early ultimates become available.',
        axes: [
          ['winrate', 'Wins'],
          ['gold', 'Gold'],
          ['xp', 'XP'],
          ['auc', 'Resources → winning'],
          ['level6', 'Level 6'],
          ['bounty', 'Bounties'],
          ['bountyEfficiency', 'Average bounty per kill']
        ]
      },
      {
        title: 'Fights, bounties, and risk',
        note: 'Compares fights, bounty value, and the risk of giving away a comeback, on a 0–100 scale.',
        axes: [
          ['kill', 'Fights'],
          ['safety', 'Safety'],
          ['bounty', 'Bounties'],
          ['bountyEfficiency', 'Average bounty per kill'],
          ['streak', 'Kill streak'],
          ['shutdown', 'Bounties collected'],
          ['shutdownSafety', 'Few bounties given away']
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

  function buildRadarSvg(axes, aValues, bValues, title = 'Team strengths') {
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
    n_matches: 'Direct matches analyzed',
    low_sample: 'Few matches available',
    winrate_a: 'Team 1 win rate in the matchup',
    general_winrate_a: 'Usual win rate in the role',
    diff_winrate_a: 'How much the matchup changes usual performance',
    pct_a_ahead_15m: 'Probability that Team 1 is ahead at 15 minutes',
    winrate_a_when_ahead_15m: 'Team 1 wins when ahead at 15 minutes',
    winrate_a_when_behind_15m: 'Team 1 wins when behind at 15 minutes',
    snowball_corr_15m: 'Relationship between the advantage at 15 minutes and winning',
    snowball_quality_15m_a: 'Stability of the early advantage',
    snowball_conversion_15m_a: 'Ability to convert an early advantage',
    volatility_15m_a: 'How much the matchup varies between matches',
    gold_diff_without_bounty_15m_a_minus_b: 'Gold difference excluding bounties at 15 minutes',
    bounty_share_of_gold_diff_15m: 'Share of the gold advantage due to bounties',
    early_kd_pressure_15m_a_minus_b: 'Kill-death balance at 15 minutes',
    excess_early_kd_pressure_15m_a_minus_b: 'Matchup-specific kill-death balance',
    avg_bounty_net_diff_15m_a_minus_b: 'Difference in bounty balance at 15 minutes',
    resource_winpct_pressure_estimate_a_15m: 'Estimated impact of gold and XP on the result',
    objective_conversion_score_a: 'Ability to convert pressure into objectives',
    monster_sequence_control_score_a: 'Control of the neutral-objective sequence',
    comeback_risk_a: 'Value exposed to a potential comeback'
  };

  function plainMetricDescription(key) {
    const k = String(key || '').toLowerCase();
    if (/excess_(gold|xp)_diff_by_minute/.test(k)) return 'Gold or XP advantage produced by the specific matchups, beyond what is normally expected from the champions.';
    if (/(gold|xp)_diff_by_minute/.test(k)) return 'Resource difference over time: positive favors Team 1, negative favors Team 2.';
    if (/snowball|when_ahead|when_behind/.test(k)) return 'How much the first advantage changes the outcome and how difficult it is to recover after falling behind.';
    if (/bounty|shutdown/.test(k)) return 'Gold gained or conceded through bounties and the risk of returning the advantage through a major death.';
    if (/kill|death|streak/.test(k)) return 'How fights develop: kills, deaths, kill streaks, and the balance between positive and negative events.';
    if (/goldxp|resource|auc|winpct_per_1k/.test(k)) return 'How much gold and XP affect the outcome and how well champions convert resources into wins.';
    if (/tower/.test(k)) return 'Who takes the first tower more often and by what average margin.';
    if (/monster|dragon|baron|riftherald|horde/.test(k)) return 'Control of neutral objectives and their sequence throughout the match.';
    if (/vision/.test(k)) return 'Average contribution to vision and map control.';
    if (/damage|physical|magic|true/.test(k)) return 'Amount and type of damage dealt or absorbed by the composition.';
    if (/cc|time_cc/.test(k)) return 'Average time enemies are restricted by stuns, roots, slows, and other crowd control.';
    if (/level6/.test(k)) return 'Average time to level 6: a lower value means earlier access to the ultimate.';
    if (/winrate|diff_winrate/.test(k)) return 'Compares matchup wins with the champions\' typical performance in the role.';
    if (/percentile/.test(k)) return 'Position from 0 to 100 relative to other champions in the same role.';
    if (/n_matches|coverage|total_games|low_sample/.test(k)) return 'How many matches support the data: more matches generally mean a more stable reading.';
    return 'Supporting data to be read alongside the other metrics, not as an isolated verdict.';
  }

  function auditHumanLabel(key) {
    if (PLAIN_METRIC_LABELS[key]) return PLAIN_METRIC_LABELS[key];
    return String(key || '').replace(/_a_minus_b$/g, ' (Team 1 − Team 2 difference)').replace(/_a$/g, ' Team 1').replace(/_b$/g, ' Team 2').replaceAll('_', ' ').replace(/\b\w/g, (m) => m.toUpperCase());
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
      return `${picks.map((i) => `${i}: ${intFmt(value[i])}`).join(' · ')} · ${value.length} points`;
    }
    if (value === null || value === undefined) return '—';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
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
    const baseKeys = new Set();
    const percentileKeys = new Set();
    roleOrder().forEach((role) => {
      Object.values(DATA?.championProfiles?.[role] || {}).forEach((profile) => {
        Object.keys(profile || {}).forEach((key) => {
          if (!['percentiles', 'coverage'].includes(key)) baseKeys.add(key);
        });
        Object.keys(profile?.percentiles || {}).forEach((key) => percentileKeys.add(key));
      });
    });
    const base = Array.from(baseKeys).sort(localeSort).map((key) => ({ key, label: auditHumanLabel(key) }));
    const percentileRows = Array.from(percentileKeys).sort(localeSort).map((key) => ({ key: `percentiles.${key}`, label: `${auditHumanLabel(key)} — comparison with the role` }));
    return base.concat(percentileRows, [{ key: 'coverage.n_matchups', label: 'Opponents with available data' }, { key: 'coverage.total_games', label: 'Matches available in the profile' }, { key: 'comeback_risk', label: 'Estimated comeback risk' }]);
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
    { id: 'outcome', title: 'Results & reliability', short: 'Results', test: (key) => /^(n_matches|low_sample|winrate_|general_winrate_|diff_winrate_)/.test(key) },
    { id: 'timeline', title: 'Resources over time', short: 'Resources', test: (key) => /gold_diff|xp_diff|excess_gold|excess_xp/.test(key) && !/per_kill|without_bounty/.test(key) },
    { id: 'combat', title: 'Damage, crowd control & vision', short: 'Combat', test: (key) => /pct_(physical|magic|true)_dmg|avg_damage|avg_time_cc|avg_total_time_cc|vision/.test(key) },
    { id: 'models', title: 'Resource dependence', short: 'Resources → winning', test: (key) => /goldxp_|resource_winpct|auc|level6/.test(key) },
    { id: 'kill', title: 'Fights, bounties & risks', short: 'Fights', test: (key) => /kill|death|bounty|streak|shutdown/.test(key) && !/monster_kill/.test(key) },
    { id: 'map', title: 'Towers & early actions', short: 'Map', test: (key) => /tower|first_blood|first_dragon|first_baron|first_horde|first_riftherald|n_matches_(dragon|baron|horde|riftherald)/.test(key) },
    { id: 'snowball', title: 'Impact of the advantage & comeback', short: 'Advantage', test: (key) => /ahead_15m|when_ahead|when_behind|snowball|volatility|comeback|gold_diff_std/.test(key) },
    { id: 'monsters', title: 'Monsters & sequences', short: 'Monsters', test: (key) => /monster|event_count_/.test(key) },
    { id: 'advanced', title: 'Efficiency & matchup-specific advantage', short: 'Deep dives', test: (key) => /early_kd|excess_|per_kill|without_bounty|bounty_share|kill_value|objective_conversion/.test(key) },
    { id: 'other', title: 'Other useful data', short: 'Other', test: () => true }
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
    if (!lane || lane.data_status !== 'exact') return `<div class="draft-atlas-lane is-missing"><span>${esc(roleLabel(lane?.role || ''))}</span><em>data unavailable</em></div>`;
    const value = lane[row.col];
    if (Array.isArray(value)) {
      const at15 = valueAtMinute(value, lane.minutes, REFERENCE_MINUTE);
      return `<div class="draft-atlas-lane is-series"><span>${esc(roleLabel(lane.role))}</span>${atlasSparkline(value)}<strong>${esc(at15 === null ? '—' : intFmt(at15))}</strong><small>@15 · ${value.length} points</small></div>`;
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
    return `<article class="draft-metric-card" data-atlas-search="${esc(`${row.label} ${row.source} ${row.family.title}`.toLowerCase())}"><header><span>${esc(row.family.short)}</span><em>${String(index + 1).padStart(2, '0')}</em></header><h4>${esc(row.label)}</h4><p class="metric-help">${esc(plainMetricDescription(row.source))}</p><div class="draft-lane-scan">${lanes.map((lane) => atlasLaneVisual(lane, row, has)).join('')}</div><details><summary>Technical name in the dataset</summary><code>${esc(row.source)}</code></details></article>`;
  }

  function atlasProfileLane(lane, field) {
    if (!lane) return `<div class="draft-atlas-lane is-missing"><span>—</span><em>data unavailable</em></div>`;
    const p1 = lane.team1Profile, p2 = lane.team2Profile;
    const a = field.key === 'comeback_risk' ? profileComebackRisk(p1) : nestedValue(p1, field.key);
    const b = field.key === 'comeback_risk' ? profileComebackRisk(p2) : nestedValue(p2, field.key);
    if ((a === null || a === undefined) && (b === null || b === undefined)) return `<div class="draft-atlas-lane is-missing"><span>${esc(roleLabel(lane.role))}</span><em>data unavailable</em></div>`;
    const av = safeNumber(a), bv = safeNumber(b), max = Math.max(Math.abs(av ?? 0), Math.abs(bv ?? 0), 0.0001);
    const aw = av === null ? 0 : Math.min(100, Math.abs(av) / max * 100), bw = bv === null ? 0 : Math.min(100, Math.abs(bv) / max * 100);
    return `<div class="draft-atlas-lane"><span>${esc(roleLabel(lane.role))}</span><div class="draft-lane-values"><strong class="a">${esc(auditDisplay(field.key, a))}</strong><em>vs</em><strong class="b">${esc(auditDisplay(field.key, b))}</strong><div class="draft-lane-balance"><i class="a" style="--lane-fill:${aw.toFixed(1)}"></i><i class="b" style="--lane-fill:${bw.toFixed(1)}"></i></div></div><small>${esc(lane.team1Champion || '—')} · ${esc(lane.team2Champion || '—')}</small></div>`;
  }

  function atlasProfileCard(field, lanes, index) {
    return `<article class="draft-metric-card profile" data-atlas-search="${esc(`${field.label} ${field.key} benchmark profile`.toLowerCase())}"><header><span>Profile</span><em>${String(index + 1).padStart(2, '0')}</em></header><h4>${esc(field.label)}</h4><p class="metric-help">${esc(plainMetricDescription(field.key))}</p><div class="draft-lane-scan">${lanes.map((lane) => atlasProfileLane(lane, field)).join('')}</div><details><summary>Technical name in the profile</summary><code>${esc(field.key)}</code></details></article>`;
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

    target.innerHTML = `<div class="draft-atlas-v2"><section class="draft-atlas-intro"><div><div class="micro-label">All draft data</div><h3>Every metric, organized lane by lane.</h3><p>The Essential view shows first the data that helps most with preparing the game plan. The Complete view lets you explore all ${columns.length} metrics and champion profiles in depth while always preserving the Team 1 / Team 2 comparison.</p></div><div class="draft-atlas-score"><span>Available metrics</span><strong>${columns.length}/${columns.length}</strong><em>organized data</em></div></section><div class="draft-atlas-command"><label><span class="visually-hidden">Search metric</span><input id="draftAtlasSearch" type="search" placeholder="Search kills, bounties, level 6, tower, or dragon…"></label><div class="draft-atlas-mode"><button type="button" data-mode="essential" class="active">Essential</button><button type="button" data-mode="complete">Complete</button></div></div><div class="draft-atlas-chips" id="draftAtlasChips"></div><div class="draft-atlas-status" id="draftAtlasStatus"></div><div class="draft-atlas-groups" id="draftAtlasGroups"></div></div>`;

    const chipTarget = byId('draftAtlasChips');
    chipTarget.innerHTML = `<button type="button" data-family="all" class="active">All</button>${DRAFT_ATLAS_FAMILIES.filter((f) => f.id !== 'other').map((f) => `<button type="button" data-family="${esc(f.id)}">${esc(f.short)}</button>`).join('')}<button type="button" data-family="profile">Profiles</button>`;

    function draw() {
      const q = query.trim().toLowerCase();
      const visibleRows = logical.filter((row) => {
        if (mode === 'essential' && !DRAFT_ATLAS_ESSENTIAL.has(row.col)) return false;
        if (family !== 'all' && family !== row.family.id) return false;
        return !q || `${row.label} ${row.source} ${row.family.title}`.toLowerCase().includes(q);
      });
      const showProfiles = (family === 'all' || family === 'profile') && (!q || profileFields.some((f) => `${f.label} ${f.key}`.toLowerCase().includes(q)));
      const groups = DRAFT_ATLAS_FAMILIES.map((fam) => ({ fam, rows: visibleRows.filter((row) => row.family.id === fam.id) })).filter((group) => group.rows.length);
      let html = groups.map((group, groupIndex) => `<details class="draft-atlas-family" ${groupIndex < 2 ? 'open' : ''}><summary><div><span>${String(groupIndex + 1).padStart(2, '0')}</span><strong>${esc(group.fam.title)}</strong></div><em>${group.rows.length} cards</em></summary><div class="draft-metric-grid">${group.rows.map((row, i) => atlasMetricCard(row, lanes, has, i)).join('')}</div></details>`).join('');
      if (showProfiles) {
        const filteredProfiles = profileFields.filter((field) => !q || `${field.label} ${field.key}`.toLowerCase().includes(q)).filter((field) => mode === 'complete' || ['general_winrate','avg_damage_to_champs','avg_damage_taken','avg_total_time_cc_dealt','vision_score','goldxp_winpct_per_1k_gold','goldxp_winpct_per_1k_xp','goldxp_auc','avg_level6_minute','avg_kills_0_15m','avg_deaths_0_15m','avg_bounty_net','shutdown_collected_rate','shutdown_given_rate','comeback_risk'].some((key) => field.key === key || field.key.endsWith(`.${key}`)));
        if (filteredProfiles.length) html += `<div class="draft-atlas-divider">Profiles & comparison with the role</div><details class="draft-atlas-family" ${family === 'profile' ? 'open' : ''}><summary><div><span>P</span><strong>Champion characteristics</strong></div><em>${filteredProfiles.length} cards</em></summary><div class="draft-metric-grid">${filteredProfiles.map((field, i) => atlasProfileCard(field, lanes, i)).join('')}</div></details>`;
      }
      byId('draftAtlasGroups').innerHTML = html || '<div class="empty-note">No metric matches the filter.</div>';
      byId('draftAtlasStatus').innerHTML = `<strong>${visibleRows.length}</strong><span>matchup cards</span><i></i><span>${mode === 'essential' ? 'main data' : `${columns.length} source columns`}</span>`;
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
    const placeholder = team === 1 ? 'Team 1 champion…' : 'Team 2 champion…';
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

  function invalidateStaleAnalysis() {
    if (!state.lastAnalysis) return;
    state.lastAnalysis = null;
    const region = byId('analysisRegion');
    const empty = byId('emptyState');
    if (region) region.hidden = true;
    if (empty) {
      empty.hidden = false;
      empty.textContent = 'The selection has changed. Press “Analyze draft” to update the dossier.';
    }
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
        : '<div class="combo-empty">No champion found.</div>';
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
      invalidateStaleAnalysis();
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
      ? `${compactNumber(item.games)} direct matches${item.low ? ' · sample ridotto' : ''}`
      : team === 1
        ? `${compactNumber(item.matchupCount)} matchup · ${compactNumber(item.coverage)} game`
        : item.coverage
          ? `${compactNumber(item.coverage)} game profile`
          : 'profile available';
    return `
      <div class="combo-option ${active ? 'active' : ''} ${item.low ? 'low' : ''}" role="option" data-champion="${esc(item.champ)}">
        ${champHtml(item.champ, 'sm')}
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
    byId('emptyState').textContent = 'Complete at least one lane.';
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
   * Tab (same logic as app.js, for consistency between the two pages)
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
    byId('footerStats').textContent = `Team DraftLab · ${total ? Math.round(total).toLocaleString('it-IT') : '—'} available matchups`;
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
    setDataStatus('error', 'Missing data');
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
      fail('Dataset unavailable: unable to initialize Team DraftLab.');
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