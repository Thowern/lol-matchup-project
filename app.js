(function () {
  'use strict';

  function setDataStatus(kind, text) {
    var el = document.getElementById('dataStatus');
    if (!el) return;
    el.className = 'data-status-pill ' + (kind || 'loading');
    el.textContent = text || 'Loading data';
  }

  function showDatasetError(message) {
    var empty = document.getElementById('emptyState');
    var dossier = document.getElementById('dossier');
    if (dossier) dossier.hidden = true;
    if (!empty) return;
    empty.hidden = false;
    empty.innerHTML = '<h3>Dataset unavailable</h3><p>' + message + '</p>';
  }

  setDataStatus('loading', 'Loading data');

  var DATA = window.MATCHUP_APP_DATA;
  if (!DATA || !Array.isArray(DATA.matchupColumns) || !DATA.matchups) {
    setDataStatus('error', 'Missing data');
    showDatasetError('Make sure matchup_data.js is in the same folder and is loaded before app.js.');
    throw new Error('[Matchup Lab] MATCHUP_APP_DATA is unavailable or incomplete.');
  }

  var COLS = {};
  DATA.matchupColumns.forEach(function (c, i) { COLS[c] = i; });

  var ROLE_LABELS = { TOP: 'Top', JUNGLE: 'Jungle', MIDDLE: 'Mid', BOTTOM: 'Bot', UTILITY: 'Support' };
  var ROLE_LONG = {
    TOP: 'Top Lane', JUNGLE: 'Jungle', MIDDLE: 'Mid Lane',
    BOTTOM: 'Bottom Lane (Bot)', UTILITY: 'Support'
  };
  var ROLE_ORDER = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];

  var OBJECTIVES = [
    { key: 'dragon', label: 'First Dragon' },
    { key: 'baron_nashor', label: 'First Baron Nashor' },
    { key: 'riftherald', label: 'First Rift Herald' },
    { key: 'horde', label: 'First Void Grub Camp' },
  ];

  var PHASES = [
    { key: 'early_0_10', label: '0–10', long: 'Early 0–10' },
    { key: 'lane_10_15', label: '10–15', long: 'Lane 10–15' },
    { key: 'mid_15_25', label: '15–25', long: 'Mid 15–25' },
    { key: 'late_25_plus', label: '25+', long: 'Late 25+' }
  ];

  var KILL_BOUNTY_PROFILE_FIELDS = [
    'avg_event_kills', 'avg_event_deaths',
    'avg_kills_0_10m', 'avg_deaths_0_10m',
    'avg_kills_0_15m', 'avg_deaths_0_15m',
    'avg_bounty_gained', 'avg_bounty_given', 'avg_bounty_net', 'avg_bounty_net_0_15m',
    'avg_bounty_per_kill', 'avg_bounty_given_per_death',
    'avg_kill_streak_on_kill', 'shutdown_collected_rate', 'shutdown_given_rate'
  ];

  function dataColumnsStarting(prefix) {
    return DATA.matchupColumns.filter(function (c) { return c.indexOf(prefix) === 0; });
  }

  function humanMonsterLabel(key) {
    return String(key || '')
      .replace(/^pct_a_secures_monster_/, '')
      .replace(/^avg_monster_kill_diff_a_minus_b_/, '')
      .replace(/^event_count_/, '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, function (m) { return m.toUpperCase(); });
  }

  function killPhase(role, champ, phase) {
    return DATA.killPhaseSummary &&
      DATA.killPhaseSummary[role] &&
      DATA.killPhaseSummary[role][champ] &&
      DATA.killPhaseSummary[role][champ][phase] || null;
  }

  var state = { role: null, champA: null, champB: null, trajMode: 'gold' };

  /* ------------------------------------------------------------------ *
   * Formatting
   * ------------------------------------------------------------------ */
  function isNum(v) { return typeof v === 'number' && !isNaN(v); }

  function fmtInt(v) {
    if (!isNum(v)) return '—';
    return Math.round(v).toLocaleString('it-IT');
  }
  function fmtDec(v, d) {
    if (d === undefined) d = 1;
    if (!isNum(v)) return '—';
    return v.toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function fmtPct(v, d) {
    if (d === undefined) d = 1;
    if (!isNum(v)) return '—';
    return (v * 100).toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d }) + '%';
  }
  function fmtSignedPct(v, d) {
    if (!isNum(v)) return '—';
    var s = v > 0 ? '+' : '';
    return s + fmtPct(v, d);
  }
  function fmtSigned(v, d, suffix) {
    if (suffix === undefined) suffix = '';
    if (!isNum(v)) return '—';
    var s = v > 0 ? '+' : '';
    return s + fmtDec(v, d) + suffix;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function champHtml(name, size, className) {
    if (!name) return '—';
    if (window.ChampionIcons && typeof window.ChampionIcons.html === 'function') {
      return window.ChampionIcons.html(name, { size: size || 'sm', className: className || '' });
    }
    return esc(name);
  }

  function confidence(n) {
    if (n >= DATA.meta.min_matches_solid) return { level: 'high', label: 'Many matches available' };
    if (n >= DATA.meta.min_matches_confident) return { level: 'mid', label: 'Fair number of matches' };
    return { level: 'low', label: 'Few matches available' };
  }

  function magnitudeWord(ppAbs) {
    if (ppAbs < 2) return 'a marginal advantage';
    if (ppAbs < 6) return 'a moderate advantage';
    return 'a clear advantage';
  }

  /* ------------------------------------------------------------------ *
   * Raw data lookup
   * ------------------------------------------------------------------ */
  function getMatchup(role, x, y) {
    var roleData = DATA.matchups[role];
    if (!roleData) return null;
    if (roleData[x] && roleData[x][y]) return { a: x, b: y, values: roleData[x][y] };
    if (roleData[y] && roleData[y][x]) return { a: y, b: x, values: roleData[y][x] };
    return null;
  }
  function val(rec, col) {
    var i = COLS[col];
    if (i === undefined) return undefined;
    return rec.values[i];
  }

  /* Normalize the retrieved row in terms of left (champA selected
   * by the user) / right (champB), regardless of storage order. */
  function normalizeMatchup(rec, leftName) {
    var leftIsA = rec.a === leftName;

    function pair(base) {
      var av = val(rec, base + '_a'), bv = val(rec, base + '_b');
      return leftIsA ? [av, bv] : [bv, av];
    }
    function diffAB(col) {
      var v = val(rec, col);
      if (!isNum(v)) return null;
      return leftIsA ? v : -v;
    }
    function pctA(col) {
      var v = val(rec, col);
      if (!isNum(v)) return null;
      if (leftIsA) return v;
      // First kill and first death are mirrored, not complementary, events:
      // B first kill = A first death (outcomes with no kill must not be invented).
      if (col === 'pct_a_first_kill_in_pair') {
        var firstDeath = val(rec, 'pct_a_first_death_in_pair');
        return isNum(firstDeath) ? firstDeath : null;
      }
      if (col === 'pct_a_first_death_in_pair') {
        var firstKill = val(rec, 'pct_a_first_kill_in_pair');
        return isNum(firstKill) ? firstKill : null;
      }
      // For these two shares, the dataset exports neither the opponent's share nor
      // ties: 1-p would be technically incorrect when reversing sides.
      if (col === 'pct_a_kill_adv_15m' || col === 'pct_a_bounty_net_adv_15m') return null;
      return 1 - v;
    }
    function arrAB(col) {
      var arr = val(rec, col);
      if (!arr) return null;
      if (leftIsA) return arr;
      return arr.map(function (v) { return isNum(v) ? -v : null; });
    }
    function direct(col) { return val(rec, col); }

    function snowballPerspective() {
      var wAhead = val(rec, 'winrate_a_when_ahead_15m');
      var wBehind = val(rec, 'winrate_a_when_behind_15m');
      if (!isNum(wAhead) || !isNum(wBehind)) return null;
      if (leftIsA) {
        return { leftAhead: wAhead, leftBehind: wBehind, rightAhead: 1 - wBehind, rightBehind: 1 - wAhead };
      }
      return { leftAhead: 1 - wBehind, leftBehind: 1 - wAhead, rightAhead: wAhead, rightBehind: wBehind };
    }

    return { leftIsA: leftIsA, pair: pair, diffAB: diffAB, pctA: pctA, arrAB: arrAB, direct: direct, snowballPerspective: snowballPerspective };
  }

  /* ------------------------------------------------------------------ *
   * Global tooltip
   * ------------------------------------------------------------------ */
  var tipEl = document.getElementById('tooltip');
  function showTip(x, y, html) {
    tipEl.innerHTML = html;
    tipEl.classList.add('show');
    var rect = tipEl.getBoundingClientRect();
    var vx = Math.min(x + 14, window.innerWidth - rect.width - 12);
    var vy = Math.min(y + 14, window.innerHeight - rect.height - 12);
    tipEl.style.left = Math.max(8, vx) + 'px';
    tipEl.style.top = Math.max(8, vy) + 'px';
  }
  function hideTip() { tipEl.classList.remove('show'); }

  document.addEventListener('mouseover', function (e) {
    var t = e.target.closest('[data-tip]');
    if (t) showTip(e.clientX, e.clientY, t.getAttribute('data-tip'));
  });
  document.addEventListener('mousemove', function (e) {
    if (tipEl.classList.contains('show') && e.target.closest('[data-tip]')) {
      showTip(e.clientX, e.clientY, tipEl.innerHTML);
    }
  });
  document.addEventListener('mouseout', function (e) {
    if (e.target.closest('[data-tip]')) hideTip();
  });
  document.addEventListener('focusin', function (e) {
    var t = e.target.closest('[data-tip]');
    if (t) {
      var r = t.getBoundingClientRect();
      showTip(r.left, r.bottom, t.getAttribute('data-tip'));
    }
  });
  document.addEventListener('focusout', function (e) {
    if (e.target.closest('[data-tip]')) hideTip();
  });

  // Compatibility: some V2 render functions call bindTips(scope).
  // Actual tooltip handling is already delegated to document through [data-tip],
  // so this function keeps the calls safe without duplicating listeners.
  function bindTips(scope) {
    return scope;
  }


  /* ------------------------------------------------------------------ *
   * Champion search combobox
   * ------------------------------------------------------------------ */
  function createCombobox(rootEl, opts) {
    var input = rootEl.querySelector('input');
    var list = rootEl.querySelector('.combobox-list');
    var options = [];
    var activeIndex = -1;

    // Stable fix: the list stays inside the combobox and opens in normal flow.
    // It does not use a portal, fixed positioning, or a stacking trick: it always appears below
    // the correct field and pushes the following content down, so it cannot be
    // covered/clipped by the cockpit, empty state, or dossier farther down.

    function setOptions(newOptions) {
      options = newOptions;
    }

    function renderList(filterText) {
      var q = (filterText || '').trim().toLowerCase();
      var filtered = options.filter(function (o) {
        return o.label.toLowerCase().indexOf(q) !== -1;
      });
      if (!filtered.length) {
        list.innerHTML = '<div class="combobox-empty">No champion found.</div>';
      } else {
        list.innerHTML = filtered.map(function (o, i) {
          var cls = 'combobox-option' + (o.low ? ' low' : '') + (i === activeIndex ? ' active' : '');
          var meta = o.meta !== undefined ? '<span class="n">' + esc(o.meta) + '</span>' : '';
          return '<div class="' + cls + '" role="option" data-value="' + esc(o.value) + '">' +
            champHtml(o.label, 'sm', 'combobox-champion') + meta + '</div>';
        }).join('');
      }
      list._filtered = filtered;
      list.classList.add('open');
      rootEl.classList.add('open');
      var slotEl = rootEl.closest('.slot');
      if (slotEl) slotEl.classList.add('combo-open');
      var pickerEl = rootEl.closest('.picker');
      if (pickerEl) pickerEl.classList.add('picker-open');
      input.setAttribute('aria-expanded', 'true');
    }

    function close() {
      list.classList.remove('open');
      rootEl.classList.remove('open');
      var slotEl = rootEl.closest('.slot');
      if (slotEl) slotEl.classList.remove('combo-open');
      var pickerEl = rootEl.closest('.picker');
      if (pickerEl && !pickerEl.querySelector('.combobox-list.open')) pickerEl.classList.remove('picker-open');
      input.setAttribute('aria-expanded', 'false');
      activeIndex = -1;
    }

    input.addEventListener('focus', function () { if (!input.disabled) renderList(input.value); });
    input.addEventListener('input', function () { activeIndex = -1; renderList(input.value); });
    input.addEventListener('keydown', function (e) {
      if (!list.classList.contains('open')) return;
      var items = list._filtered || [];
      if (e.key === 'ArrowDown') { e.preventDefault(); activeIndex = Math.min(items.length - 1, activeIndex + 1); renderList(input.value); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); activeIndex = Math.max(0, activeIndex - 1); renderList(input.value); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        var pick = items[activeIndex] || items[0];
        if (pick) { input.value = pick.label; close(); opts.onSelect(pick.value); }
      } else if (e.key === 'Escape') { close(); }
    });
    list.addEventListener('mousedown', function (e) {
      var opt = e.target.closest('.combobox-option');
      if (!opt) return;
      e.preventDefault();
      var v = opt.getAttribute('data-value');
      var found = options.find(function (o) { return o.value === v; });
      input.value = found ? found.label : v;
      close();
      opts.onSelect(v);
    });
    document.addEventListener('click', function (e) {
      if (!rootEl.contains(e.target) && !list.contains(e.target)) close();
    });

    return {
      setOptions: setOptions,
      setValue: function (label) { input.value = label || ''; },
      setEnabled: function (enabled, placeholder) {
        input.disabled = !enabled;
        if (placeholder) input.placeholder = placeholder;
        if (!enabled) { input.value = ''; close(); }
      },
      open: function () {
        if (!input.disabled) renderList(input.value);
      },
      focusAndOpen: function () {
        if (input.disabled) return;
        input.focus({ preventScroll: true });
        renderList(input.value);
      },
      clear: function () { input.value = ''; }
    };
  }

  var comboA = createCombobox(document.getElementById('comboA'), {
    onSelect: function (v) { selectChampion('A', v); }
  });
  var comboB = createCombobox(document.getElementById('comboB'), {
    onSelect: function (v) { selectChampion('B', v); }
  });

  /* ------------------------------------------------------------------ *
   * Roles, champion selection, shortcuts
   * ------------------------------------------------------------------ */
  function championOptionsFor(role) {
    var champs = DATA.meta.roles_champions[role] || [];
    var profiles = DATA.championProfiles[role] || {};
    return champs.slice().sort(function (a, b) {
      var ga = (profiles[a] && profiles[a].coverage.total_games) || 0;
      var gb = (profiles[b] && profiles[b].coverage.total_games) || 0;
      return gb - ga;
    }).map(function (name) {
      var cov = profiles[name] ? profiles[name].coverage : null;
      return { value: name, label: name, meta: cov ? cov.n_matchups + ' matchup' : '' };
    });
  }

  function opponentOptionsFor(role, champ) {
    var list = (DATA.adjacency[role] && DATA.adjacency[role][champ]) || [];
    return list.map(function (row) {
      return { value: row[0], label: row[0], meta: fmtInt(row[1]) + ' matches', low: row[2] };
    });
  }

  function populateRolePills() {
    var wrap = document.getElementById('rolePills');
    wrap.innerHTML = ROLE_ORDER.filter(function (r) { return DATA.meta.roles.indexOf(r) !== -1; })
      .map(function (r) {
        return '<button class="role-pill" data-role="' + r + '">' + ROLE_LABELS[r] + '</button>';
      }).join('');
    wrap.querySelectorAll('.role-pill').forEach(function (btn) {
      btn.addEventListener('click', function () { setRole(btn.getAttribute('data-role')); });
    });
  }

  function setRole(role) {
    state.role = role;
    state.champA = null;
    state.champB = null;
    document.querySelectorAll('.role-pill').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-role') === role);
    });
    comboA.setOptions(championOptionsFor(role));
    comboA.clear();
    comboB.setOptions([]);
    comboB.setEnabled(false, 'Choose Champion A first');
    render();
  }

  function applySelection(a, b) {
    state.champA = a; state.champB = b;
    comboA.setValue(a);
    comboB.setOptions(opponentOptionsFor(state.role, a));
    comboB.setEnabled(true, 'Search for the opponent…');
    comboB.setValue(b);
    render();
  }

  function selectChampion(slot, name) {
    if (slot === 'A') {
      state.champA = name;
      state.champB = null;
      comboB.setOptions(opponentOptionsFor(state.role, name));
      comboB.setEnabled(true, 'Search for the opponent…');
      comboB.clear();
      render();
      // Keyboard UX: the second dropdown actually opens after selecting A.
      // requestAnimationFrame prevents the keydown used for A from being reused
      // accidentally by the new combobox, while the second Enter selects
      // the most-played direct matchup immediately (the first sorted option).
      window.requestAnimationFrame(function () { comboB.focusAndOpen(); });
    } else {
      state.champB = name;
      render();
    }
  }

  function pulseMotion(el, cls) {
    if (!el) return;
    cls = cls || 'is-spinning';
    el.classList.remove(cls);
    // Force reflow so repeated clicks replay the same motion consistently.
    void el.offsetWidth;
    el.classList.add(cls);
    window.setTimeout(function () { el.classList.remove(cls); }, 620);
  }

  document.getElementById('swapBtn').addEventListener('click', function () {
    pulseMotion(document.getElementById('swapBtn'));
    if (!state.champA || !state.champB) return;
    var a = state.champA, b = state.champB;
    // We rebuild B's options based on the new Champion A for consistency,
    // then apply the swap: it is a left/right label change,
    // the data will be automatically re-normalized by normalizeMatchup().
    state.champA = b; state.champB = a;
    comboA.setValue(b);
    comboB.setOptions(opponentOptionsFor(state.role, b));
    comboB.setEnabled(true);
    comboB.setValue(a);
    render();
  });



  function renderSelectionHints() {
    var hintA = document.getElementById('hintA');
    var hintB = document.getElementById('hintB');
    var roleLabelText = state.role ? ROLE_LABELS[state.role] : 'role';
    var pa = state.role && state.champA ? ((DATA.championProfiles[state.role] || {})[state.champA] || null) : null;
    var pb = state.role && state.champB ? ((DATA.championProfiles[state.role] || {})[state.champB] || null) : null;
    if (hintA) {
      if (state.champA && pa && pa.coverage) {
        hintA.innerHTML = '<strong>' + champHtml(state.champA, 'xs') + '</strong> · ' + fmtInt(pa.coverage.n_matchups) + ' matchup · ' + fmtInt(pa.coverage.total_games) + ' matches as ' + roleLabelText;
      } else if (state.role) {
        hintA.textContent = 'Choose the first champion in the role ' + roleLabelText + '.';
      } else {
        hintA.textContent = 'Choose a role first to filter the champions.';
      }
    }
    if (hintB) {
      if (state.champB && pb && pb.coverage) {
        hintB.innerHTML = '<strong>' + champHtml(state.champB, 'xs') + '</strong> · ' + fmtInt(pb.coverage.n_matchups) + ' matchup · ' + fmtInt(pb.coverage.total_games) + ' matches as ' + roleLabelText;
      } else if (state.champA) {
        hintB.textContent = 'Now choose an opponent with direct data against ' + state.champA + '.';
      } else {
        hintB.textContent = 'The slot unlocks after Champion A.';
      }
    }
  }

  function setCockpitText(id, text, htmlMode) {
    var el = document.getElementById(id);
    if (!el) return;
    if (htmlMode) el.innerHTML = text;
    else el.textContent = text;
  }

  function renderToolCockpit(M, rec) {
    renderSelectionHints();
    var roleLabelText = state.role ? ROLE_LABELS[state.role] : 'role';
    var champA = state.champA || 'Champion A';
    var champB = state.champB || 'Champion B';
    var pa = state.role && state.champA ? ((DATA.championProfiles[state.role] || {})[state.champA] || null) : null;
    var pb = state.role && state.champB ? ((DATA.championProfiles[state.role] || {})[state.champB] || null) : null;

    setCockpitText('cockpitATitle', state.champA || 'Pending');
    setCockpitText('cockpitBTitle', state.champB || 'Pending');
    setCockpitText('cockpitACopy', pa && pa.coverage ? fmtPct(pa.general_winrate, 1) + ' average win rate · data against ' + fmtInt(pa.coverage.n_matchups) + ' opponents in the role ' + roleLabelText + '.' : 'Choose the reference side.');
    setCockpitText('cockpitBCopy', pb && pb.coverage ? fmtPct(pb.general_winrate, 1) + ' average win rate · data against ' + fmtInt(pb.coverage.n_matchups) + ' opponents in the role ' + roleLabelText + '.' : (state.champA ? 'Choose a real opponent from the dataset to activate the dossier.' : 'Unlocks after Champion A.'));

    if (!state.champA || !state.champB) {
      setCockpitText('cockpitTitle', 'No active matchup.');
      setCockpitText('cockpitCopy', state.champA ? 'The second champion is missing: once you choose it, you will see who starts stronger, the average situation at 15 minutes, and how reliable the data is.' : 'Select two champions: the key points of the matchup will appear here immediately.');
      setCockpitText('cockpitFocus', state.champA ? state.champA + ' selected · opponent missing.' : '—');
      setCockpitText('cockpitMethod', state.role ? 'Context: ' + roleLabelText + '.' : '—');
      setCockpitText('cockpitTrustTitle', 'Pending');
      setCockpitText('cockpitTrustCopy', 'Confidence depends on the direct sample.');
      setCockpitText('cockpitNextTitle', state.champA ? 'Complete side B' : 'Choose side A');
      setCockpitText('cockpitNextCopy', state.champA ? 'Opponents filtered using the dataset.' : 'No data is invented before the pair is selected.');
      var meterIdle = document.getElementById('cockpitMeter');
      if (meterIdle) meterIdle.style.setProperty('--meter', state.champA ? '58%' : '34%');
      return;
    }

    if (!M || !rec) {
      setCockpitText('cockpitTitle', champA + ' vs ' + champB + ': no direct data.');
      setCockpitText('cockpitCopy', 'The pair is available as a selection, but it has no matchup row in the selected role.');
      setCockpitText('cockpitFocus', 'An advantage cannot be estimated.');
      setCockpitText('cockpitMethod', 'Change the opponent or role.');
      setCockpitText('cockpitTrustTitle', 'No coverage');
      setCockpitText('cockpitTrustCopy', 'No synthetic metric is invented.');
      setCockpitText('cockpitNextTitle', 'Matchup not covered');
      setCockpitText('cockpitNextCopy', 'A direct dataset row is required.');
      var meterMissing = document.getElementById('cockpitMeter');
      if (meterMissing) meterMissing.style.setProperty('--meter', '18%');
      return;
    }

    var n = M.direct('n_matches');
    var conf = confidence(n);
    var wr = M.pair('winrate');
    var diffWr = M.pair('diff_winrate');
    var gold15 = seriesAtMinute(M, 'gold_diff_by_minute', 15);
    var xp15 = seriesAtMinute(M, 'xp_diff_by_minute', 15);
    var favored = wr[0] >= wr[1] ? champA : champB;
    var edge = Math.abs((wr[0] || 0) - 0.5);
    var meter = Math.max(22, Math.min(100, 44 + edge * 120 + (conf.level === 'high' ? 18 : conf.level === 'mid' ? 9 : -4)));
    var meterEl = document.getElementById('cockpitMeter');
    if (meterEl) meterEl.style.setProperty('--meter', meter.toFixed(0) + '%');

    setCockpitText('cockpitTitle', favored + ' is the stronger side.');
    setCockpitText('cockpitCopy', champA + ' vs ' + champB + ' · ' + roleLabelText + '. Summary: who is favored, the average situation at 15 minutes, and data reliability.');
    setCockpitText('cockpitFocus', fmtPct(Math.max(wr[0], wr[1]), 1) + ' win rate in the matchup · ' + fmtSignedPct(wr[0] >= wr[1] ? diffWr[0] : diffWr[1], 1) + ' compared with usual performance.');
    setCockpitText('cockpitMethod', signedSideText(gold15, ' gold', 20) + ' · ' + signedSideText(xp15, ' XP', 20) + ' @15.');
    setCockpitText('cockpitTrustTitle', conf.label);
    setCockpitText('cockpitTrustCopy', fmtInt(n) + ' matches in the matchup. ' + (conf.level === 'low' ? 'Read it as a directional signal, not a certainty.' : 'Fairly stable sample.'));
    setCockpitText('cockpitNextTitle', 'Read the main recommendations');
    setCockpitText('cockpitNextCopy', 'Start with the first recommendations: they are the ones most likely to change how you play the lane.');
  }


  /* ------------------------------------------------------------------ *
   * Main rendering
   * ------------------------------------------------------------------ */
  function render() {
    var emptyEl = document.getElementById('emptyState');
    var dossierEl = document.getElementById('dossier');

    if (!state.champA || !state.champB) {
      dossierEl.hidden = true;
      emptyEl.hidden = false;
      emptyEl.innerHTML = '<h3>No active matchup</h3><p>The dossier appears when A and B have a valid data row.</p>';
      renderToolCockpit(null, null);
      return;
    }

    var rec = getMatchup(state.role, state.champA, state.champB);
    if (!rec) {
      dossierEl.hidden = true;
      emptyEl.hidden = false;
      var opts = opponentOptionsFor(state.role, state.champA).slice(0, 10);
      var sugg = opts.map(function (o) {
        return '<button class="chip" data-b="' + esc(o.value) + '">' + esc(o.value) + ' <span class="n">' + esc(o.meta) + '</span></button>';
      }).join('');
      emptyEl.innerHTML = '<h3>No direct data</h3>' +
        '<p>No direct row for <strong>' + esc(state.champA) + '</strong> vs <strong>' + esc(state.champB) + '</strong> in ' + ROLE_LABELS[state.role] + '.' +
        (opts.length ? ' Available opponents for ' + esc(state.champA) + ':' : '') + '</p>' +
        '<div class="suggestions">' + sugg + '</div>';
      emptyEl.querySelectorAll('.chip[data-b]').forEach(function (btn) {
        btn.addEventListener('click', function () { selectChampion('B', btn.getAttribute('data-b')); });
      });
      renderToolCockpit(null, null);
      return;
    }

    emptyEl.hidden = true;
    dossierEl.hidden = false;

    var M = normalizeMatchup(rec, state.champA);
    renderToolCockpit(M, rec);

    function safeRender(label, panelId, fn) {
      try {
        fn(M);
      } catch (err) {
        console.error('[Matchup Lab] Error in section ' + label + ':', err);
        var panel = document.getElementById(panelId);
        if (panel) {
          panel.innerHTML = '<div class="empty-note full-span"><strong>' + esc(label) + '</strong><br>This section was not rendered because of a local error. The other sections remain available; check the console for details.</div>';
        }
      }
    }

    safeRender('Verdict', 'verdictBand', renderVerdict);
    safeRender('Overview', 'panel-overview', renderOverview);
    safeRender('Match progression', 'panel-trajectory', renderTrajectory);
    safeRender('Combat', 'panel-combat', renderCombat);
    safeRender('Kills, deaths, and bounties', 'panel-kill', renderKillBounty);
    safeRender('Gold, XP, and the impact of an advantage', 'panel-economy', renderEconomy);
    safeRender('Objectives / Turrets', 'panel-objectives', renderObjectives);
    safeRender('Details', 'panel-raw', renderRaw);
  }

  /* ------------------------------------------------------------------ *
   * Verdict (top band, always visible)
   * ------------------------------------------------------------------ */
  function renderVerdict(M) {
    var champA = state.champA, champB = state.champB, role = state.role;
    var n = M.direct('n_matches');
    var conf = confidence(n);
    var wr = M.pair('winrate');
    var genWr = M.pair('general_winrate');
    var diffWr = M.pair('diff_winrate');

    var favoredIsLeft = wr[0] >= wr[1];
    var favoredName = favoredIsLeft ? champA : champB;
    var favoredWr = favoredIsLeft ? wr[0] : wr[1];
    var favoredDiff = favoredIsLeft ? diffWr[0] : diffWr[1];

    var sentence = '<strong>' + esc(favoredName) + '</strong> wins this matchup in ' + fmtPct(favoredWr, 1) + ' of matches';
    if (isNum(favoredDiff) && Math.abs(favoredDiff) >= 0.005) {
      sentence += ', ' + magnitudeWord(Math.abs(favoredDiff * 100)) + ' (' + fmtSignedPct(favoredDiff, 1) + ') compared with their average win rate as ' + ROLE_LABELS[role] + '.';
    } else {
      sentence += ', in line with their average win rate as ' + ROLE_LABELS[role] + '.';
    }
    if (conf.level === 'low') {
      sentence += ' The sample is small (' + fmtInt(n) + ' matches): treat this as an indication, not as statistical certainty.';
    }

    var html = '';
    html += '<div class="verdict-top">';
    html += '<div><div class="matchup-title"><span class="name-a">' + champHtml(champA, 'md') + '</span><span class="vs-x">vs</span><span class="name-b">' + champHtml(champB, 'md') + '</span></div>';
    html += '<div class="role-tag">' + ROLE_LONG[role] + '</div></div>';
    html += '<div class="sample-badge ' + conf.level + '"><span class="dot"></span>' + conf.label + ' — ' + fmtInt(n) + ' matches</div>';
    html += '</div>';

    html += '<div class="winrate-bar"><div class="tick50"></div>' +
      '<div class="fill-a" style="width:' + (wr[0] * 100) + '%">' + fmtPct(wr[0], 1) + '</div>' +
      '<div class="fill-b" style="width:' + (wr[1] * 100) + '%">' + fmtPct(wr[1], 1) + '</div></div>';

    html += '<div class="verdict-foot">';
    html += '<div class="verdict-col a"><div class="champ-name">' + champHtml(champA, 'sm') + '</div>' +
      '<div class="row"><span>Win rate in this matchup</span><span class="v">' + fmtPct(wr[0], 1) + '</span></div>' +
      '<div class="row"><span>Usual win rate as ' + ROLE_LABELS[role] + '</span><span class="v">' + fmtPct(genWr[0], 1) + '</span></div>' +
      '<div class="row"><span>Difference</span><span class="v">' + fmtSignedPct(diffWr[0], 1) + '</span></div></div>';
    html += '<div class="verdict-col b"><div class="champ-name">' + champHtml(champB, 'sm') + '</div>' +
      '<div class="row"><span>Win rate in this matchup</span><span class="v">' + fmtPct(wr[1], 1) + '</span></div>' +
      '<div class="row"><span>Usual win rate as ' + ROLE_LABELS[role] + '</span><span class="v">' + fmtPct(genWr[1], 1) + '</span></div>' +
      '<div class="row"><span>Difference</span><span class="v">' + fmtSignedPct(diffWr[1], 1) + '</span></div></div>';
    html += '</div>';

    html += '<div class="verdict-sentence">' + sentence + '</div>';

    document.getElementById('verdictBand').innerHTML = html;
  }

  /* ------------------------------------------------------------------ *
   * Overview: profile of both champions with role percentiles
   * ------------------------------------------------------------------ */
  var OVERVIEW_FIELDS = [
    { key: 'general_winrate', label: 'Usual win rate in the role', fmt: function (v) { return fmtPct(v, 1); } },
    { key: 'avg_damage_to_champs', label: 'Average damage to champions', fmt: function (v) { return fmtInt(v); } },
    { key: 'avg_damage_taken', label: 'Average damage taken', fmt: function (v) { return fmtInt(v); } },
    { key: 'vision_score', label: 'Average vision score', fmt: function (v) { return fmtDec(v, 1); } },
    { key: 'avg_total_time_cc_dealt', label: 'Total CC generated', fmt: function (v) { return fmtDec(v, 1) + 's'; } },
    { key: 'avg_level6_minute', label: 'Average level 6 time', fmt: function (v) { return fmtDec(v, 2) + ' min'; } },
    { key: 'goldxp_auc', label: 'Predictive power of the resource advantage', fmt: function (v) { return fmtDec(v, 3); } }
  ];

  function renderOverview(M) {
    var role = state.role, champA = state.champA, champB = state.champB;
    var profiles = DATA.championProfiles[role] || {};
    var pa = profiles[champA] || {}, pb = profiles[champB] || {};

    var rows = OVERVIEW_FIELDS.map(function (f) {
      var va = pa[f.key], vb = pb[f.key];
      var pca = pa.percentiles ? pa.percentiles[f.key] : null;
      var pcb = pb.percentiles ? pb.percentiles[f.key] : null;
      var markerA = isNum(pca) ? '<div class="pct-marker a" style="left:' + pca + '%" data-tip="<div class=\'tt-title\'>' + esc(champA) + '</div>' + esc(f.label) + ': ' + esc(f.fmt(va)) + ' — ' + fmtDec(pca, 0) + 'th percentile in the role"></div>' : '';
      var markerB = isNum(pcb) ? '<div class="pct-marker b" style="left:' + pcb + '%" data-tip="<div class=\'tt-title\'>' + esc(champB) + '</div>' + esc(f.label) + ': ' + esc(f.fmt(vb)) + ' — ' + fmtDec(pcb, 0) + 'th percentile in the role"></div>' : '';
      return '<div class="pct-row">' +
        '<div class="pct-row-head"><span class="stat-label">' + f.label + ' <span class="info-icon" tabindex="0" data-tip="Position relative to all champions ' + ROLE_LABELS[role] + ' in the dataset. 50th percentile = role average.">i</span></span></div>' +
        '<div class="pct-track">' + markerA + markerB + '</div>' +
        '<div class="pct-vals"><span class="va">' + esc(champA) + ': ' + f.fmt(va) + (isNum(pca) ? ' (p' + fmtDec(pca, 0) + ')' : '') + '</span>' +
        '<span class="vb">' + esc(champB) + ': ' + f.fmt(vb) + (isNum(pcb) ? ' (p' + fmtDec(pcb, 0) + ')' : '') + '</span></div>' +
        '</div>';
    }).join('');

    var covA = pa.coverage || { n_matchups: 0, total_games: 0 };
    var covB = pb.coverage || { n_matchups: 0, total_games: 0 };

    var html = '<div class="panel-grid">';
    html += '<div class="card full-span"><div class="card-head"><h3>Profile of both champions in the role</h3>' +
      '<span class="card-sub">Percentile calculated across ' + (DATA.meta.roles_champions[role] || []).length + ' champions ' + ROLE_LABELS[role] + '</span></div>' + rows + '</div>';

    html += '<div class="card"><div class="card-head"><h3>' + champHtml(champA, 'sm') + '</h3></div>' +
      '<div class="stat-grid">' +
      '<div class="stat-card"><div class="label">Recorded matchups</div><div class="value a">' + fmtInt(covA.n_matchups) + '</div></div>' +
      '<div class="stat-card"><div class="label">Total matches (role)</div><div class="value a">' + fmtInt(covA.total_games) + '</div></div>' +
      '</div></div>';
    html += '<div class="card"><div class="card-head"><h3>' + champHtml(champB, 'sm') + '</h3></div>' +
      '<div class="stat-grid">' +
      '<div class="stat-card"><div class="label">Recorded matchups</div><div class="value b">' + fmtInt(covB.n_matchups) + '</div></div>' +
      '<div class="stat-card"><div class="label">Total matches (role)</div><div class="value b">' + fmtInt(covB.total_games) + '</div></div>' +
      '</div></div>';
    html += '</div>';

    document.getElementById('panel-overview').innerHTML = html;
  }

  /* ------------------------------------------------------------------ *
   * "River" chart: mirrored area around zero, drawn manually
   * in SVG for full control over shape, color, and interaction.
   * ------------------------------------------------------------------ */
  function niceStep(rough) {
    if (!isFinite(rough) || rough <= 0) return 1;
    var pow = Math.pow(10, Math.floor(Math.log(rough) / Math.LN10));
    var n = rough / pow;
    var step = n < 1.5 ? 1 : (n < 3 ? 2 : (n < 7 ? 5 : 10));
    return step * pow;
  }

  function buildRiverSVG(minutes, values) {
    var W = 1000, H = 320, L = 54, R = 20, T = 18, B = 34;
    var plotW = W - L - R, plotH = H - T - B;
    var centerY = T + plotH / 2;

    var pts = [];
    for (var i = 0; i < minutes.length; i++) {
      if (isNum(values[i])) pts.push({ m: minutes[i], v: values[i] });
    }
    if (!pts.length) return null;

    var maxAbs = 0;
    pts.forEach(function (p) { maxAbs = Math.max(maxAbs, Math.abs(p.v)); });
    var domainMax = Math.max(1, maxAbs * 1.18);
    var maxMinute = minutes[minutes.length - 1] || 1;

    function xAt(m) { return L + (m / maxMinute) * plotW; }
    function yAt(v) { return centerY - (v / domainMax) * (plotH / 2); }

    var linePath = pts.map(function (p, i) {
      return (i === 0 ? 'M' : 'L') + xAt(p.m).toFixed(1) + ',' + yAt(p.v).toFixed(1);
    }).join(' ');

    var posPts = pts.map(function (p) { return xAt(p.m).toFixed(1) + ',' + yAt(Math.max(0, p.v)).toFixed(1); });
    var negPts = pts.map(function (p) { return xAt(p.m).toFixed(1) + ',' + yAt(Math.min(0, p.v)).toFixed(1); });
    var xFirst = xAt(pts[0].m).toFixed(1), xLast = xAt(pts[pts.length - 1].m).toFixed(1);
    var posArea = 'M' + xFirst + ',' + centerY.toFixed(1) + ' L' + posPts.join(' L') + ' L' + xLast + ',' + centerY.toFixed(1) + ' Z';
    var negArea = 'M' + xFirst + ',' + centerY.toFixed(1) + ' L' + negPts.join(' L') + ' L' + xLast + ',' + centerY.toFixed(1) + ' Z';

    var step = niceStep(domainMax / 2);
    var gridSvg = '';
    for (var g = step; g <= domainMax; g += step) {
      var yTop = yAt(g), yBot = yAt(-g);
      gridSvg += '<line x1="' + L + '" x2="' + (L + plotW) + '" y1="' + yTop.toFixed(1) + '" y2="' + yTop.toFixed(1) + '" stroke="var(--line)" stroke-width="1"/>';
      gridSvg += '<text x="' + (L - 8) + '" y="' + (yTop + 4).toFixed(1) + '" text-anchor="end" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">+' + fmtInt(g) + '</text>';
      gridSvg += '<line x1="' + L + '" x2="' + (L + plotW) + '" y1="' + yBot.toFixed(1) + '" y2="' + yBot.toFixed(1) + '" stroke="var(--line)" stroke-width="1"/>';
      gridSvg += '<text x="' + (L - 8) + '" y="' + (yBot + 4).toFixed(1) + '" text-anchor="end" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">-' + fmtInt(g) + '</text>';
    }

    var tickStep = maxMinute > 20 ? 10 : 5;
    var xTicksSvg = '';
    for (var tm = 0; tm <= maxMinute; tm += tickStep) {
      xTicksSvg += '<text x="' + xAt(tm).toFixed(1) + '" y="' + (H - 10) + '" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">' + tm + '\'</text>';
    }

    var gid = 'rg' + Math.random().toString(36).slice(2, 9);

    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" data-river="1" data-l="' + L + '" data-t="' + T + '" data-plotw="' + plotW + '" data-ploth="' + plotH + '" data-maxminute="' + maxMinute + '">' +
      '<defs>' +
      '<linearGradient id="' + gid + 'pos" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="var(--champ-a)" stop-opacity="0.55"/><stop offset="100%" stop-color="var(--champ-a)" stop-opacity="0.04"/>' +
      '</linearGradient>' +
      '<linearGradient id="' + gid + 'neg" x1="0" y1="1" x2="0" y2="0">' +
      '<stop offset="0%" stop-color="var(--champ-b)" stop-opacity="0.55"/><stop offset="100%" stop-color="var(--champ-b)" stop-opacity="0.04"/>' +
      '</linearGradient>' +
      '</defs>' +
      '<g>' + gridSvg + '</g>' +
      '<line x1="' + L + '" x2="' + (L + plotW) + '" y1="' + centerY + '" y2="' + centerY + '" stroke="var(--ink-faint)" stroke-dasharray="3,4" stroke-width="1"/>' +
      '<path d="' + posArea + '" fill="url(#' + gid + 'pos)"/>' +
      '<path d="' + negArea + '" fill="url(#' + gid + 'neg)"/>' +
      '<path class="riv-trace" d="' + linePath + '" fill="none" stroke="rgba(234,242,243,0.8)" stroke-width="1.6"/>' +
      xTicksSvg +
      '<g class="riv-hover" style="display:none">' +
      '<line class="riv-hover-line" y1="' + T + '" y2="' + (T + plotH) + '" stroke="var(--ink-dim)" stroke-width="1"/>' +
      '<circle class="riv-hover-dot" r="4.5" fill="var(--ink)"/>' +
      '</g>' +
      '<rect class="riv-capture" x="' + L + '" y="' + T + '" width="' + plotW + '" height="' + plotH + '" fill="transparent"/>' +
      '</svg>';

    return { svg: svg, pts: pts, xAt: xAt, yAt: yAt };
  }

  function attachRiverInteractivity(wrapEl, chart, unitLabel) {
    var svg = wrapEl.querySelector('svg[data-river]');
    if (!svg) return;
    var capture = svg.querySelector('.riv-capture');
    var hoverG = svg.querySelector('.riv-hover');
    var hoverLine = svg.querySelector('.riv-hover-line');
    var hoverDot = svg.querySelector('.riv-hover-dot');

    capture.addEventListener('mousemove', function (e) {
      var rect = svg.getBoundingClientRect();
      var vb = svg.viewBox.baseVal;
      var scaleX = vb.width / rect.width;
      var x = (e.clientX - rect.left) * scaleX;
      var L = parseFloat(svg.getAttribute('data-l'));
      var plotW = parseFloat(svg.getAttribute('data-plotw'));
      var maxMinute = parseFloat(svg.getAttribute('data-maxminute'));
      var mAtX = ((x - L) / plotW) * maxMinute;

      var nearest = chart.pts[0], bestDist = Infinity;
      chart.pts.forEach(function (p) {
        var d = Math.abs(p.m - mAtX);
        if (d < bestDist) { bestDist = d; nearest = p; }
      });
      var px = chart.xAt(nearest.m), py = chart.yAt(nearest.v);
      hoverG.style.display = '';
      hoverLine.setAttribute('x1', px); hoverLine.setAttribute('x2', px);
      hoverDot.setAttribute('cx', px); hoverDot.setAttribute('cy', py);

      var leader = nearest.v > 0.0001 ? state.champA : (nearest.v < -0.0001 ? state.champB : null);
      var screenX = rect.left + (px / vb.width) * rect.width;
      var screenY = rect.top + (py / vb.height) * rect.height;
      var body = fmtSigned(nearest.v, 0, unitLabel) + (leader ? ' in favor of ' + esc(leader) : ' — tied');
      showTip(screenX, screenY, '<div class="tt-title">Minute ' + Math.round(nearest.m) + '</div>' + body);
    });
    capture.addEventListener('mouseleave', function () { hoverG.style.display = 'none'; hideTip(); });
  }

  function animateTrace(svgEl) {
    var path = svgEl.querySelector('.riv-trace');
    if (!path) return;
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;
    try {
      var len = path.getTotalLength();
      path.style.strokeDasharray = len;
      path.style.strokeDashoffset = len;
      path.getBoundingClientRect();
      path.style.transition = 'stroke-dashoffset .9s cubic-bezier(.22,.61,.36,1)';
      requestAnimationFrame(function () { path.style.strokeDashoffset = '0'; });
    } catch (err) { /* getTotalLength may fail if the path is empty: ignore it */ }
  }

  /* ------------------------------------------------------------------ *
   * Match progression
   * ------------------------------------------------------------------ */
  var TRAJ_MODES = {
    gold: {
      col: 'gold_diff_by_minute', label: 'Gold', unit: ' gold',
      explain: function (a, b) { return 'Cumulative gold difference between ' + a + ' e ' + b + ', minute by minute.'; }
    },
    xp: {
      col: 'xp_diff_by_minute', label: 'XP', unit: ' xp',
      explain: function (a, b) { return 'Cumulative experience difference between ' + a + ' e ' + b + ', minute by minute.'; }
    },
    excessGold: {
      col: 'excess_gold_diff_by_minute', label: 'Matchup-specific gold', unit: ' gold',
      explain: function (a, b) { return 'Gold advantage attributable to the specific matchup between ' + a + ' e ' + b + ', net of what is expected from the individual strength of the two champions in the role.'; }
    },
    excessXp: {
      col: 'excess_xp_diff_by_minute', label: 'Matchup-specific XP', unit: ' xp',
      explain: function (a, b) { return 'Experience advantage attributable to the specific matchup between ' + a + ' e ' + b + ', net of what is expected from the individual strength of the two champions in the role.'; }
    }
  };

  function renderTrajectory(M) {
    var role = state.role, champA = state.champA, champB = state.champB;

    var html = '<div class="card full-span">';
    html += '<div class="card-head"><h3>Game progression</h3>' +
      '<span class="card-sub">Positive = advantage for <span style="color:var(--champ-a)">' + esc(champA) + '</span> · Negative = advantage for <span style="color:var(--champ-b)">' + esc(champB) + '</span></span></div>';
    html += '<div class="river-controls" id="trajControls">' + Object.keys(TRAJ_MODES).map(function (k) {
      return '<button class="river-btn' + (state.trajMode === k ? ' active' : '') + '" data-mode="' + k + '">' + TRAJ_MODES[k].label + '</button>';
    }).join('') + '</div>';
    html += '<div class="river-note" id="trajNote"></div>';
    html += '<div class="river-svg-wrap" id="trajSvgWrap"></div>';
    html += '<div class="river-legend"><span><i style="background:var(--champ-a)"></i>' + esc(champA) + '</span><span><i style="background:var(--champ-b)"></i>' + esc(champB) + '</span></div>';
    html += '</div>';

    var profiles = DATA.championProfiles[role] || {};
    var pa = profiles[champA] || {}, pb = profiles[champB] || {};
    var l6a = pa.avg_level6_minute, l6b = pb.avg_level6_minute;
    html += '<div class="card full-span" style="margin-top:20px;">' +
      '<div class="card-head"><h3>Level 6 timing</h3><span class="info-icon" tabindex="0" data-tip="Average minute when the champion reaches level 6, calculated across all matches in the role (not only this matchup).">i</span></div>';
    if (isNum(l6a) || isNum(l6b)) {
      var maxAx = Math.max(12, (l6a || 0) + 1, (l6b || 0) + 1);
      html += '<div class="axis-mini"><div class="line"></div>';
      if (isNum(l6a)) html += '<div class="pt a" style="left:' + (l6a / maxAx * 100) + '%"><div class="dot"></div><div class="lbl">' + esc(champA) + ' · ' + fmtDec(l6a, 2) + '\'</div></div>';
      if (isNum(l6b)) html += '<div class="pt b" style="left:' + (l6b / maxAx * 100) + '%"><div class="dot"></div><div class="lbl">' + esc(champB) + ' · ' + fmtDec(l6b, 2) + '\'</div></div>';
      html += '</div>';
    } else {
      html += '<div class="empty-note">Data unavailable for at least one of the two champions.</div>';
    }
    html += '</div>';

    document.getElementById('panel-trajectory').innerHTML = html;

    document.querySelectorAll('#trajControls .river-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.trajMode = btn.getAttribute('data-mode');
        document.querySelectorAll('#trajControls .river-btn').forEach(function (b) { b.classList.toggle('active', b === btn); });
        drawTrajChart(M);
      });
    });
    drawTrajChart(M);
  }

  function drawTrajChart(M) {
    var mode = TRAJ_MODES[state.trajMode];
    var arr = M.arrAB(mode.col);
    var noteEl = document.getElementById('trajNote');
    var wrap = document.getElementById('trajSvgWrap');
    if (!noteEl || !wrap) return;
    noteEl.textContent = mode.explain(state.champA, state.champB);
    if (!arr || !arr.some(isNum)) {
      wrap.innerHTML = '<div class="empty-note">Insufficient data to calculate this series for this matchup.</div>';
      return;
    }
    var minutes = arr.map(function (_, i) { return i; });
    var chart = buildRiverSVG(minutes, arr);
    if (!chart) { wrap.innerHTML = '<div class="empty-note">Insufficient data.</div>'; return; }
    wrap.innerHTML = chart.svg;
    var svgEl = wrap.querySelector('svg');
    attachRiverInteractivity(wrap, chart, mode.unit);
    animateTrace(svgEl);
  }

  /* ------------------------------------------------------------------ *
   * Reusable comparison components
   * ------------------------------------------------------------------ */
  function compareBarRow(label, tip, leftVal, rightVal, leftName, rightName, decimals, unit, sharedMax) {
    var max = sharedMax || (Math.max(Math.abs(leftVal || 0), Math.abs(rightVal || 0)) * 1.15) || 1;
    function pct(v) { return isNum(v) ? Math.max(0, Math.min(100, (Math.abs(v) / max) * 100)) : 0; }
    function fmtV(v) { return isNum(v) ? fmtDec(v, decimals) + unit : '—'; }
    var infoHtml = tip ? (' <span class="info-icon" tabindex="0" data-tip="' + esc(tip) + '">i</span>') : '';
    return '<div class="compare-bar">' +
      '<div class="compare-bar-label">' + label + infoHtml + '</div>' +
      '<div class="compare-bar-row a"><span class="name">' + esc(leftName) + '</span><div class="compare-track"><div class="compare-fill a" style="width:' + pct(leftVal) + '%"></div></div><span class="value">' + fmtV(leftVal) + '</span></div>' +
      '<div class="compare-bar-row b"><span class="name">' + esc(rightName) + '</span><div class="compare-track"><div class="compare-fill b" style="width:' + pct(rightVal) + '%"></div></div><span class="value">' + fmtV(rightVal) + '</span></div>' +
      '</div>';
  }

  function damageStackRow(sideClass, champName, physV, magicV, trueV) {
    var segs = [
      { v: physV, color: 'var(--dmg-phys)', label: 'Physical' },
      { v: magicV, color: 'var(--dmg-magic)', label: 'Magic' },
      { v: trueV, color: 'var(--dmg-true)', label: 'True' }
    ];
    var segHtml = segs.map(function (s) {
      var w = isNum(s.v) ? (s.v * 100) : 0;
      if (w <= 0.4) return '';
      var tip = s.label + ': ' + fmtPct(s.v, 1);
      return '<div class="stack-seg" style="width:' + w + '%;background:' + s.color + '" data-tip="' + esc(tip) + '">' + (w > 12 ? fmtPct(s.v, 0) : '') + '</div>';
    }).join('');
    return '<div class="stack-row ' + sideClass + '"><div class="stack-row-label">' + esc(champName) + '</div><div class="stack-track">' + segHtml + '</div></div>';
  }

  /* ------------------------------------------------------------------ *
   * Combat
   * ------------------------------------------------------------------ */
  function renderCombat(M) {
    var champA = state.champA, champB = state.champB;
    var phys = M.pair('pct_physical_dmg'), magic = M.pair('pct_magic_dmg'), truep = M.pair('pct_true_dmg');
    var dealt = M.pair('avg_damage_to_champs'), taken = M.pair('avg_damage_taken');
    var ccOthers = M.pair('avg_time_ccing_others'), ccTotal = M.pair('avg_total_time_cc_dealt');
    var vision = M.pair('vision_score');
    var visionDiff = M.diffAB('vision_diff_a_minus_b');

    var html = '<div class="panel-grid">';

    html += '<div class="card"><div class="card-head"><h3>Damage composition</h3></div>' +
      damageStackRow('a', champA, phys[0], magic[0], truep[0]) +
      damageStackRow('b', champB, phys[1], magic[1], truep[1]) +
      '<div class="dmg-legend"><span><i style="background:var(--dmg-phys)"></i>Physical</span><span><i style="background:var(--dmg-magic)"></i>Magic</span><span><i style="background:var(--dmg-true)"></i>True</span></div>' +
      '</div>';

    var maxDmg = (Math.max(dealt[0] || 0, dealt[1] || 0, taken[0] || 0, taken[1] || 0) * 1.15) || 1;
    html += '<div class="card"><div class="card-head"><h3>Damage dealt and taken</h3></div>' +
      compareBarRow('Average damage to champions', null, dealt[0], dealt[1], champA, champB, 0, '', maxDmg) +
      compareBarRow('Average damage taken', null, taken[0], taken[1], champA, champB, 0, '', maxDmg) +
      '</div>';

    var ccTip = "Average number of seconds during which the champion controls enemies (stuns, slows, immobilizations, and similar effects) over the course of the match.";
    var ccTotalTip = "Total amount of crowd-control time generated by the champion across all enemies over the course of the match.";
    html += '<div class="card"><div class="card-head"><h3>Crowd control (CC)</h3></div>' +
      compareBarRow('Average CC time on enemies', ccTip, ccOthers[0], ccOthers[1], champA, champB, 1, 's') +
      compareBarRow('Total CC time generated', ccTotalTip, ccTotal[0], ccTotal[1], champA, champB, 1, 's') +
      '</div>';

    html += '<div class="card"><div class="card-head"><h3>Vision</h3></div>' +
      compareBarRow('Average vision score', null, vision[0], vision[1], champA, champB, 1, '') +
      '<div class="stat-grid" style="margin-top:14px;"><div class="stat-card"><div class="label">Difference (' + esc(champA) + ' minus ' + esc(champB) + ')</div><div class="value">' + fmtSigned(visionDiff, 1) + '</div></div></div>' +
      '</div>';

    html += '</div>';
    document.getElementById('panel-combat').innerHTML = html;
  }

  /* ------------------------------------------------------------------ *
   * Gold, XP, and Snowball
   * ------------------------------------------------------------------ */
  function renderEconomy(M) {
    var champA = state.champA, champB = state.champB;
    var wpg = M.pair('goldxp_winpct_per_1k_gold'), wpx = M.pair('goldxp_winpct_per_1k_xp');
    var auc = M.pair('goldxp_auc'), nGX = M.pair('goldxp_n_matches');
    var depGold = M.diffAB('goldxp_gold_dependency_diff_a_minus_b');
    var depXp = M.diffAB('goldxp_xp_dependency_diff_a_minus_b');

    var html = '<div class="panel-grid">';

    if (isNum(wpg[0]) || isNum(wpg[1])) {
      var depTip = "Increase in win probability, in percentage points, for every 1,000 gold (or 1,000 experience) of advantage accumulated by 15 minutes.";
      html += '<div class="card"><div class="card-head"><h3>Dependence on the resource advantage</h3>' +
        '<span class="info-icon" tabindex="0" data-tip="' + esc(depTip) + '">i</span></div>' +
        compareBarRow('Effect of 1,000 gold on win probability', null, wpg[0], wpg[1], champA, champB, 2, ' pp') +
        compareBarRow('Effect of 1,000 XP on win probability', null, wpx[0], wpx[1], champA, champB, 2, ' pp') +
        '</div>';
    } else {
      html += '<div class="card"><div class="card-head"><h3>Dependence on the resource advantage</h3></div>' +
        '<div class="empty-note">Data unavailable for at least one of the two champions in this role.</div></div>';
    }

    if (isNum(auc[0]) || isNum(auc[1])) {
      var aucTip = "How strongly the resource advantage at 15 minutes predicts the final result. 0.50 means no predictive power; values close to 1 indicate a champion whose wins almost always depend on having a resource advantage.";
      html += '<div class="card"><div class="card-head"><h3>How much gold and XP help secure a win</h3>' +
        '<span class="info-icon" tabindex="0" data-tip="' + esc(aucTip) + '">i</span></div>' +
        compareBarRow('Relationship between resources and winning', null, auc[0], auc[1], champA, champB, 3, '', 1) +
        '<div class="card-sub" style="margin-top:10px;">Champion: ' + fmtInt(nGX[0]) + ' matches (' + esc(champA) + ') · ' + fmtInt(nGX[1]) + ' matches (' + esc(champB) + ')</div>' +
        '</div>';
    }

    if (isNum(depGold) || isNum(depXp)) {
      var leaderGold = isNum(depGold) ? (depGold >= 0 ? champA : champB) : null;
      var leaderXp = isNum(depXp) ? (depXp >= 0 ? champA : champB) : null;
      html += '<div class="card full-span"><div class="card-head"><h3>Who capitalizes more in this matchup</h3></div>' +
        '<div class="stat-grid">' +
        '<div class="stat-card"><div class="label">Gold-dependency difference</div><div class="value">' + fmtSigned(depGold, 2, ' pp') + '</div><div class="sub">' + (leaderGold ? 'In favor of ' + esc(leaderGold) : '—') + '</div></div>' +
        '<div class="stat-card"><div class="label">XP-dependency difference</div><div class="value">' + fmtSigned(depXp, 2, ' pp') + '</div><div class="sub">' + (leaderXp ? 'In favor of ' + esc(leaderXp) : '—') + '</div></div>' +
        '</div></div>';
    }

    var pctAhead = M.pctA('pct_a_ahead_15m');
    var corr = M.direct('snowball_corr_15m');
    var std = M.direct('gold_diff_std_15m');
    var sb = M.snowballPerspective();

    html += '<div class="card full-span"><div class="card-head"><h3>How much being ahead at 15 minutes matters</h3>' +
      '<span class="info-icon" tabindex="0" data-tip="Metrics calculated only for matchups with a sufficiently large sample: they measure how much a gold advantage at 15 minutes translates into victory.">i</span></div>';

    if (isNum(pctAhead) && sb) {
      var pctBehind = 1 - pctAhead;
      var deg = pctAhead * 360;
      html += '<div class="donut-wrap">' +
        '<div class="donut" style="background:conic-gradient(var(--champ-a) 0deg ' + deg + 'deg, var(--champ-b) ' + deg + 'deg 360deg)">' +
        '<div class="donut-center"><div class="big">' + fmtPct(pctAhead, 0) + '</div><div class="small">matches with ' + esc(champA) + ' ahead at 15</div></div></div>' +
        '<div class="donut-legend">' +
        '<div class="row"><i style="background:var(--champ-a)"></i>' + esc(champA) + ' ahead: ' + fmtPct(pctAhead, 1) + '</div>' +
        '<div class="row"><i style="background:var(--champ-b)"></i>' + esc(champB) + ' ahead: ' + fmtPct(pctBehind, 1) + '</div>' +
        '</div></div>';

      html += '<div class="stat-grid" style="margin-top:18px;">' +
        '<div class="stat-card"><div class="label">Wins by ' + esc(champA) + ' when ahead</div><div class="value a">' + fmtPct(sb.leftAhead, 1) + '</div></div>' +
        '<div class="stat-card"><div class="label">Wins by ' + esc(champA) + ' when behind</div><div class="value a">' + fmtPct(sb.leftBehind, 1) + '</div></div>' +
        '<div class="stat-card"><div class="label">Wins by ' + esc(champB) + ' when ahead</div><div class="value b">' + fmtPct(sb.rightAhead, 1) + '</div></div>' +
        '<div class="stat-card"><div class="label">Wins by ' + esc(champB) + ' when behind</div><div class="value b">' + fmtPct(sb.rightBehind, 1) + '</div></div>' +
        '</div>';

      var corrLabel = !isNum(corr) ? '—' : (Math.abs(corr) < 0.15 ? 'weak correlation' : (Math.abs(corr) < 0.4 ? 'moderate correlation' : 'strong correlation'));
      html += '<div class="stat-grid" style="margin-top:14px;">' +
        '<div class="stat-card"><div class="label">Gold-win correlation</div><div class="value">' + fmtDec(corr, 3) + '</div><div class="sub">' + corrLabel + '</div></div>' +
        '<div class="stat-card"><div class="label">How much the advantage varies from one match to another</div><div class="value">' + fmtInt(std) + '</div><div class="sub">typical fluctuation in gold at 15 minutes</div></div>' +
        '</div>';
    } else {
      html += '<div class="empty-note">Snowball metrics at 15 minutes require a larger sample than is available for this matchup (generally several dozen matches).</div>';
    }
    html += '</div>';

    html += '</div>';
    document.getElementById('panel-economy').innerHTML = html;
  }

  /* ------------------------------------------------------------------ *
   * Objectives & Turrets
   * ------------------------------------------------------------------ */
  function objectiveDonutCard(title, sub, pctLeft, champA, champB, centerNote) {
    var pctRight = 1 - pctLeft;
    var deg = pctLeft * 360;
    return '<div class="card"><div class="card-head"><h3>' + title + '</h3>' + (sub ? '<span class="card-sub">' + sub + '</span>' : '') + '</div>' +
      '<div class="donut-wrap"><div class="donut" style="background:conic-gradient(var(--champ-a) 0deg ' + deg + 'deg, var(--champ-b) ' + deg + 'deg 360deg)">' +
      '<div class="donut-center"><div class="big">' + fmtPct(pctLeft, 0) + '</div><div class="small">' + centerNote + '</div></div></div>' +
      '<div class="donut-legend">' +
      '<div class="row"><i style="background:var(--champ-a)"></i>' + esc(champA) + ': ' + fmtPct(pctLeft, 1) + '</div>' +
      '<div class="row"><i style="background:var(--champ-b)"></i>' + esc(champB) + ': ' + fmtPct(pctRight, 1) + '</div>' +
      '</div></div></div>';
  }

  function renderObjectives(M) {
    var role = state.role, champA = state.champA, champB = state.champB;
    var html = '';

    if (role === 'JUNGLE') {
      var rows = OBJECTIVES.map(function (o) {
        var pct = M.pctA('pct_champion_a_first_' + o.key);
        var n = M.direct('n_matches_' + o.key);
        return isNum(pct) ? { label: o.label, pct: pct, n: n } : null;
      }).filter(Boolean);

      if (rows.length) {
        html += '<div class="panel-grid">' + rows.map(function (r) {
          return objectiveDonutCard(r.label, fmtInt(r.n) + ' recorded occurrences', r.pct, champA, champB, esc(champA) + ' first');
        }).join('') + '</div>';
      } else {
        html += '<div class="empty-note">No objective data is available for this specific matchup.</div>';
      }
    } else if (role === 'TOP' || role === 'MIDDLE' || role === 'BOTTOM') {
      var towerPct = M.pctA('pct_champion_a_wins_tower_race');
      var towerFallDiff = M.diffAB('avg_tower_fall_diff_min_a_minus_b');
      if (isNum(towerPct)) {
        html += '<div class="panel-grid">';
        html += objectiveDonutCard('Race to first turret', null, towerPct, champA, champB, esc(champA) + ' takes it first');
        html += '<div class="card"><div class="card-head"><h3>Difference in turret takedown time</h3>' +
          '<span class="info-icon" tabindex="0" data-tip="Difference, in minutes, associated with the timing of the first lane tower falling between the two champions. The sign reflects the convention used by the source dataset.">i</span></div>';
        if (isNum(towerFallDiff)) {
          html += '<div class="stat-grid"><div class="stat-card"><div class="label">Difference (' + esc(champA) + ' minus ' + esc(champB) + ')</div><div class="value">' + fmtSigned(towerFallDiff, 2, ' min') + '</div></div></div>';
        } else {
          html += '<div class="empty-note">Data unavailable.</div>';
        }
        html += '</div></div>';
      } else {
        html += '<div class="empty-note">No race-to-turret data is available for this specific matchup.</div>';
      }
    } else {
      html += '<div class="empty-note">Epic-objective metrics (dragons, Rift Herald, Baron, Void Grubs) are calculated only for the Jungle role; race-to-turret metrics only for solo lanes (Top, Mid, ADC). For Support, the dataset does not include objective-specific metrics.</div>';
    }

    document.getElementById('panel-objectives').innerHTML = html;
  }

  /* ------------------------------------------------------------------ *
   * Raw data
   * ------------------------------------------------------------------ */
  var RAW_FIELDS = [
    { kind: 'direct', col: 'n_matches', label: 'Matches analyzed', fmt: fmtInt },
    { kind: 'direct', col: 'low_sample', label: 'Few matches available', fmt: function (v) { return v ? 'Yes' : 'No'; } },
    { kind: 'pair', base: 'winrate', label: 'Win rate in the matchup', fmt: function (v) { return fmtPct(v, 2); } },
    { kind: 'pair', base: 'general_winrate', label: 'Usual win rate in the role', fmt: function (v) { return fmtPct(v, 2); } },
    { kind: 'pair', base: 'diff_winrate', label: 'Difference vs general win rate', fmt: function (v) { return fmtSignedPct(v, 2); } },
    { kind: 'pair', base: 'pct_physical_dmg', label: 'Physical damage (%)', fmt: function (v) { return fmtPct(v, 1); } },
    { kind: 'pair', base: 'pct_magic_dmg', label: 'Magic damage (%)', fmt: function (v) { return fmtPct(v, 1); } },
    { kind: 'pair', base: 'pct_true_dmg', label: 'True damage (%)', fmt: function (v) { return fmtPct(v, 1); } },
    { kind: 'pair', base: 'avg_damage_to_champs', label: 'Average damage to champions', fmt: fmtInt },
    { kind: 'pair', base: 'avg_damage_taken', label: 'Average damage taken', fmt: fmtInt },
    { kind: 'pair', base: 'avg_time_ccing_others', label: 'Average CC on enemies (s)', fmt: function (v) { return fmtDec(v, 1); } },
    { kind: 'pair', base: 'avg_total_time_cc_dealt', label: 'Total CC generated (s)', fmt: function (v) { return fmtDec(v, 1); } },
    { kind: 'pair', base: 'vision_score', label: 'Average vision score', fmt: function (v) { return fmtDec(v, 1); } },
    { kind: 'diff', col: 'vision_diff_a_minus_b', label: 'Vision-score difference', fmt: function (v) { return fmtSigned(v, 1); } },
    { kind: 'pair', base: 'avg_level6_minute', label: 'Average level 6 time', fmt: function (v) { return fmtDec(v, 2); } },
    { kind: 'pair', base: 'goldxp_n_matches', label: 'Matches with gold/XP data', fmt: fmtInt },
    { kind: 'pair', base: 'goldxp_winpct_per_1k_gold', label: 'How much 1,000 gold changes win probability', fmt: function (v) { return fmtDec(v, 2); } },
    { kind: 'pair', base: 'goldxp_winpct_per_1k_xp', label: 'How much 1,000 XP changes win probability', fmt: function (v) { return fmtDec(v, 2); } },
    { kind: 'pair', base: 'goldxp_auc', label: 'Overall relationship between resources and winning', fmt: function (v) { return fmtDec(v, 3); } },
    { kind: 'diff', col: 'goldxp_gold_dependency_diff_a_minus_b', label: 'Gold-dependency difference', fmt: function (v) { return fmtSigned(v, 2); } },
    { kind: 'diff', col: 'goldxp_xp_dependency_diff_a_minus_b', label: 'XP-dependency difference', fmt: function (v) { return fmtSigned(v, 2); } },
    { kind: 'pairFromPctA', col: 'pct_champion_a_wins_tower_race', label: 'Race-to-turret win', fmt: function (v) { return fmtPct(v, 1); } },
    { kind: 'diff', col: 'avg_tower_fall_diff_min_a_minus_b', label: 'Tower-fall difference (min)', fmt: function (v) { return fmtSigned(v, 2); } },
    { kind: 'pairFromPctA', col: 'pct_a_ahead_15m', label: 'Matches ahead at 15 minutes', fmt: function (v) { return fmtPct(v, 1); } },
    { kind: 'pairFromSnowballAhead', label: 'Win rate when ahead at 15 minutes', fmt: function (v) { return fmtPct(v, 1); } },
    { kind: 'pairFromSnowballBehind', label: 'Win rate when behind at 15 minutes', fmt: function (v) { return fmtPct(v, 1); } },
    { kind: 'direct', col: 'snowball_corr_15m', label: 'Gold-win correlation at 15 minutes', fmt: function (v) { return fmtDec(v, 3); } },
    { kind: 'direct', col: 'gold_diff_std_15m', label: 'Gold standard deviation at 15 minutes', fmt: fmtInt }
  ];
  [
    { kind: 'pair', base: 'avg_kills_0_15m', label: 'Average kills 0–15', fmt: function (v) { return fmtDec(v, 3); } },
    { kind: 'pair', base: 'avg_deaths_0_15m', label: 'Average deaths 0–15', fmt: function (v) { return fmtDec(v, 3); } },
    { kind: 'pair', base: 'avg_bounty_net', label: 'Average bounty balance', fmt: function (v) { return fmtSigned(v, 1); } },
    { kind: 'pair', base: 'avg_bounty_net_0_15m', label: 'Bounty balance in the first 15 minutes', fmt: function (v) { return fmtSigned(v, 1); } },
    { kind: 'pair', base: 'avg_bounty_per_kill', label: 'Average bounty gold per kill', fmt: function (v) { return fmtDec(v, 1); } },
    { kind: 'pair', base: 'avg_bounty_given_per_death', label: 'Average gold given up on death', fmt: function (v) { return fmtDec(v, 1); } },
    { kind: 'pair', base: 'avg_kill_streak_on_kill', label: 'Average kill streak', fmt: function (v) { return fmtDec(v, 2); } },
    { kind: 'pair', base: 'shutdown_collected_rate', label: 'Rate of collecting a bounty', fmt: function (v) { return fmtPct(v, 1); } },
    { kind: 'pair', base: 'shutdown_given_rate', label: 'Rate of giving up a bounty', fmt: function (v) { return fmtPct(v, 1); } },
    { kind: 'diff', col: 'avg_kill_diff_15m_a_minus_b', label: 'Matchup kill diff 15m', fmt: function (v) { return fmtSigned(v, 3); } },
    { kind: 'diff', col: 'avg_death_diff_15m_a_minus_b', label: 'Matchup death diff 15m', fmt: function (v) { return fmtSigned(v, 3); } },
    { kind: 'diff', col: 'avg_bounty_net_diff_15m_a_minus_b', label: 'Matchup bounty net diff 15m', fmt: function (v) { return fmtSigned(v, 1); } },
    { kind: 'diff', col: 'early_kd_pressure_15m_a_minus_b', label: 'Kill-death balance at 15 minutes', fmt: function (v) { return fmtSigned(v, 3); } },
    { kind: 'diff', col: 'excess_early_kd_pressure_15m_a_minus_b', label: 'Matchup-specific kill-death balance', fmt: function (v) { return fmtSigned(v, 3); } },
    { kind: 'pairFromPctA', col: 'pct_a_kill_adv_15m', label: 'Probability of having more kills at 15 minutes', fmt: function (v) { return fmtPct(v, 1); } },
    { kind: 'pairFromPctA', col: 'pct_a_bounty_net_adv_15m', label: 'Probability of having greater bounty value at 15 minutes', fmt: function (v) { return fmtPct(v, 1); } },
    { kind: 'pairFromPctA', col: 'pct_a_first_kill_in_pair', label: 'First kill in pair', fmt: function (v) { return fmtPct(v, 1); } },
    { kind: 'pairFromPctA', col: 'pct_a_first_death_in_pair', label: 'First death in pair', fmt: function (v) { return fmtPct(v, 1); } },
    { kind: 'direct', col: 'snowball_conversion_15m_a', label: 'Ability to convert an early advantage', fmt: function (v) { return fmtSignedPct(v, 1); } },
    { kind: 'direct', col: 'volatility_15m_a', label: 'Matchup variability at 15 minutes', fmt: function (v) { return fmtDec(v, 3); } },
    { kind: 'direct', col: 'kill_value_efficiency_15m_a', label: 'Value gained from fights at 15 minutes', fmt: function (v) { return fmtDec(v, 1); } },
    { kind: 'direct', col: 'objective_conversion_score_a', label: 'Ability to convert an advantage into objectives', fmt: function (v) { return fmtSigned(v, 4); } },
    { kind: 'diff', col: 'monster_sequence_control_score_a', label: 'Monster sequence control score', fmt: function (v) { return fmtSigned(v, 4); } }
  ].forEach(function (f) { RAW_FIELDS.push(f); });

  OBJECTIVES.forEach(function (o) {
    RAW_FIELDS.push({ kind: 'pairFromPctA', col: 'pct_champion_a_first_' + o.key, label: o.label + ' (%)', fmt: function (v) { return fmtPct(v, 1); } });
    RAW_FIELDS.push({ kind: 'direct', col: 'n_matches_' + o.key, label: o.label + ' — matches observed', fmt: fmtInt });
  });

  function renderRaw(M) {
    var champA = state.champA, champB = state.champB;

    var rows = RAW_FIELDS.map(function (f) {
      var leftV = null, rightV = null;
      if (f.kind === 'pair') { var p = M.pair(f.base); leftV = p[0]; rightV = p[1]; }
      else if (f.kind === 'pairFromPctA') { var pv = M.pctA(f.col); leftV = pv; rightV = isNum(pv) ? 1 - pv : null; }
      else if (f.kind === 'pairFromSnowballAhead') { var sb = M.snowballPerspective(); leftV = sb ? sb.leftAhead : null; rightV = sb ? sb.rightAhead : null; }
      else if (f.kind === 'pairFromSnowballBehind') { var sb2 = M.snowballPerspective(); leftV = sb2 ? sb2.leftBehind : null; rightV = sb2 ? sb2.rightBehind : null; }
      else if (f.kind === 'diff') { leftV = M.diffAB(f.col); rightV = null; }
      else { leftV = M.direct(f.col); rightV = null; }
      return { label: f.label, a: f.fmt(leftV), b: (rightV !== null ? f.fmt(rightV) : '—') };
    });

    var tableRows = rows.map(function (r) {
      return '<tr><td class="metric">' + esc(r.label) + '</td><td class="va">' + esc(r.a) + '</td><td class="vb">' + esc(r.b) + '</td></tr>';
    }).join('');

    var html = '<div class="card full-span">' +
      '<table class="raw-table"><thead><tr><th>Metric</th><th>' + esc(champA) + '</th><th>' + esc(champB) + '</th></tr></thead><tbody>' + tableRows + '</tbody></table>' +
      '<div class="empty-note" style="margin-top:10px;">The minute-by-minute series (gold, XP, and the matchup-specific component) are in the Game Progression tab.</div>' +
      '</div>';

    document.getElementById('panel-raw').innerHTML = html;

  }

  /* ------------------------------------------------------------------ *
   * Tab
   * ------------------------------------------------------------------ */
  document.getElementById('tabBar').addEventListener('click', function (e) {
    var btn = e.target.closest('.tab-btn');
    if (!btn) return;
    var tab = btn.getAttribute('data-tab');
    document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.toggle('active', b === btn); });
    document.querySelectorAll('.tab-panel').forEach(function (p) { p.classList.toggle('active', p.id === 'panel-' + tab); });
  });

  /* ------------------------------------------------------------------ *
   * Glossary
   * ------------------------------------------------------------------ */
  var GLOSSARY = [
    { q: 'How much can I trust the result?', a: 'Look first at the number of direct matches. With many matches, the trend is more stable; with few matches, just a handful of different results can change the percentages substantially. That is why recommendations automatically carry less weight when data is scarce.' },
    { q: 'What does a champion\'s “usual performance” mean?', a: 'It is how the champion normally performs in that role against all opponents. The site uses it as a starting point to determine whether the selected matchup is genuinely favorable or whether the champion is simply strong overall.' },
    { q: 'What does “matchup-specific advantage” mean?', a: 'It is the portion of gold, XP, kills, or bounties that exceeds what we would generally expect from the two champions. In practice, it attempts to isolate the effect of the pairing: not “this champion is strong,” but “this champion tends to perform better specifically against this opponent.”' },
    { q: 'How should I read positive and negative values?', a: 'In centered bars and differentials, a positive value favors the champion on the left; a negative value favors the one on the right. Percentages, by contrast, directly indicate how often an event occurs.' },
    { q: 'What does the advantage at 15 minutes measure?', a: 'It summarizes the lane state near the end of the early game: gold, XP, kills, deaths, and bounties. It does not mean the match is already won, but it shows who more often reaches the mid game with more resources or pressure.' },
    { q: 'What does “how much the first advantage matters” mean?', a: 'It compares how often the champion wins when ahead at 15 minutes with how often they manage to recover when behind. If the difference is large, the first mistake, a gank, or a poor reset can matter much more than usual.' },
    { q: 'What does matchup variability indicate?', a: 'It shows how differently matches with this pairing can develop. A high value suggests an unpredictable lane where it is better to adapt than to follow the same plan every time.' },
    { q: 'What are the kill-death balance and bounty balance?', a: 'The kill-death balance compares positive and negative fight events. The bounty balance instead looks at the extra gold gained from kills and the gold given away by dying. Two matchups with the same number of kills can therefore have a very different economic impact.' },
    { q: 'What does comeback risk mean?', a: 'It estimates how much value can be returned to the opponent through a shutdown. A champion who often builds up large bounties but dies with some frequency can create a substantial lead while also offering an important comeback window.' },
    { q: 'How should I read the level 6 timing?', a: 'It is the average minute when the champion reaches level 6 in the role. Whoever reaches their ultimate first may have a brief window to look for an all-in, force a reset, or move around the map.' },
    { q: 'What does the role percentile indicate?', a: 'It is a position from 0 to 100 relative to the other champions in the same role. For example, 90 in damage means that the champion ranks above roughly 90% of the other champions in that role for that statistic.' },
    { q: 'What does the relationship between gold/XP and winning measure?', a: 'It shows how strongly the matchup result depends on a resource advantage. If the relationship is strong, the side ahead in gold or levels tends to convert that margin into a win more often; if it is weak, the matchup may remain recoverable.' },
    { q: 'What do vision and crowd control indicate?', a: 'Vision summarizes the average contribution from wards, ward removal, and map control. Crowd-control metrics measure how long the champion restricts enemies with stuns, roots, slows, and other effects.' },
    { q: 'How should I read the damage profile?', a: 'It shows how much of the damage is physical, magic, or true. This helps identify which resistances may be more effective: armor against physical damage, magic resistance against magic damage, while true damage ignores both.' },
    { q: 'What do turrets and objectives show?', a: 'For lanes, it measures who takes the first turret more often and how much earlier. In Jungle, it measures who more often controls dragons, Rift Herald, Baron, and the overall sequence of neutral objectives.' }
  ];

  function renderGlossary() {
    var wrap = document.getElementById('glossaryList');
    wrap.innerHTML = GLOSSARY.map(function (g, i) {
      return '<div class="gloss-item" data-i="' + i + '"><button class="gloss-q" aria-expanded="false">' + esc(g.q) + '<span class="chev">+</span></button>' +
        '<div class="gloss-a"><p>' + esc(g.a) + '</p></div></div>';
    }).join('');
    wrap.querySelectorAll('.gloss-item').forEach(function (item) {
      var btn = item.querySelector('.gloss-q');
      var body = item.querySelector('.gloss-a');
      btn.addEventListener('click', function () {
        var isOpen = item.classList.toggle('open');
        btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        body.style.maxHeight = isOpen ? body.scrollHeight + 'px' : '0px';
      });
    });
  }

  /* ------------------------------------------------------------------ *
   * Footer & initialization
   * ------------------------------------------------------------------ */
  function renderFooterStats() {
    var total = DATA.meta.total_matchups;
    var roles = Array.isArray(DATA.meta.roles) ? DATA.meta.roles.length : ROLE_ORDER.length;
    var heroDataset = document.getElementById('heroDatasetCount');
    var heroRoles = document.getElementById('heroRoleCount');
    if (heroDataset) heroDataset.textContent = fmtInt(total);
    if (heroRoles) heroRoles.textContent = fmtInt(roles);
    document.getElementById('footerStats').textContent =
      fmtInt(total) + ' matchups analyzed across ' + fmtInt(roles) + ' roles · ' +
      fmtInt(DATA.meta.total_low_sample) + ' with a small sample (< ' + DATA.meta.min_matches_confident + ' matches)';
  }


  /* ====================================================================== *
   * MATCHUP LAB V2 — visual interpretation + weighted insights
   * ----------------------------------------------------------------------
   * These functions override some original render functions without
   * changing the data structure or the contract with matchup_data.js.
   * ====================================================================== */

  function clamp01(v) {
    if (!isNum(v)) return 0;
    return Math.max(0, Math.min(1, v));
  }
  function clampAbs(v, max) {
    if (!isNum(v) || !max) return 0;
    return Math.max(0, Math.min(1, Math.abs(v) / max));
  }
  function fmtPP(v, d) {
    if (d === undefined) d = 1;
    return isNum(v) ? (v * 100).toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d }) + ' pp' : '—';
  }
  function fmtSignedPP(v, d) {
    if (d === undefined) d = 1;
    if (!isNum(v)) return '—';
    var n = v * 100;
    return (n > 0 ? '+' : '') + n.toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d }) + ' pp';
  }
  function toneFromSigned(v, deadzone) {
    if (!isNum(deadzone)) deadzone = 0;
    if (!isNum(v) || Math.abs(v) <= deadzone) return 'neutral';
    return v > 0 ? 'a' : 'b';
  }
  function sideName(tone) {
    if (tone === 'a') return state.champA;
    if (tone === 'b') return state.champB;
    return 'Both';
  }
  function signedSideText(v, unit, deadzone) {
    var tone = toneFromSigned(v, deadzone || 0);
    if (tone === 'neutral') return 'balance';
    return (tone === 'a' ? state.champA : state.champB) + ' +' + fmtInt(Math.abs(v)) + (unit || '');
  }
  function seriesAtMinute(M, col, minute) {
    // Important robustness note: across different exports, the timeline may be
    // indexed with an explicit minutes array, with index 0 = minute 0, or
    // with index 0 = minute 1. We therefore avoid false `—` values when the data exists.
    var directAt15 = {
      gold_diff_by_minute: 'gold_diff_15m_a_minus_b',
      xp_diff_by_minute: 'xp_diff_15m_a_minus_b',
      excess_gold_diff_by_minute: 'excess_gold_diff_15m_a_minus_b',
      excess_xp_diff_by_minute: 'excess_xp_diff_15m_a_minus_b'
    };

    if (minute === 15 && directAt15[col]) {
      var direct = M.diffAB(directAt15[col]);
      if (isNum(direct)) return direct;
    }

    var arr = M.arrAB(col) || [];
    if (!Array.isArray(arr) || !arr.length) return null;

    function toFinite(v) {
      var n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    function valueAt(i) {
      return i >= 0 && i < arr.length && isNum(arr[i]) ? arr[i] : null;
    }

    var minutes = M.direct('minutes') || [];
    if (Array.isArray(minutes) && minutes.length) {
      var exactIdx = -1;
      for (var i = 0; i < minutes.length; i++) {
        if (toFinite(minutes[i]) === minute) { exactIdx = i; break; }
      }
      var exactVal = valueAt(exactIdx);
      if (isNum(exactVal)) return exactVal;

      // If minute 15 is not present exactly, use the nearest point
      // within a narrow window. Real nearby data is better than a false empty value.
      var bestIdx = -1, bestDist = Infinity;
      for (var j = 0; j < minutes.length; j++) {
        var m = toFinite(minutes[j]);
        if (m === null) continue;
        var d = Math.abs(m - minute);
        if (d < bestDist && isNum(valueAt(j))) { bestDist = d; bestIdx = j; }
      }
      if (bestIdx >= 0 && bestDist <= 1) return valueAt(bestIdx);
    }

    // Fallback for series without a minutes array: try both zero-based and one-based indexing.
    var zeroBased = valueAt(minute);
    if (isNum(zeroBased)) return zeroBased;

    var oneBased = valueAt(minute - 1);
    if (isNum(oneBased)) return oneBased;

    return null;
  }
  function profile(role, champ) {
    return (DATA.championProfiles[role] || {})[champ] || {};
  }
  function pctile(p, key, invert) {
    var v = p && p.percentiles ? p.percentiles[key] : null;
    if (!isNum(v)) return null;
    return invert ? 100 - v : v;
  }
  function meanNums(values) {
    var vals = values.filter(isNum);
    if (!vals.length) return null;
    return vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
  }
  function maxAbsLane(items) {
    var best = null;
    items.forEach(function (x) {
      if (!x || !isNum(x.value)) return;
      if (!best || Math.abs(x.value) > Math.abs(best.value)) best = x;
    });
    return best;
  }

  function snowballRead(M) {
    var sb = M.snowballPerspective();
    if (!sb || !isNum(sb.leftAhead) || !isNum(sb.leftBehind)) return null;
    var sensitivity = Math.abs(sb.leftAhead - sb.leftBehind);
    var corr = M.direct('snowball_corr_15m');
    var vol = M.direct('gold_diff_std_15m');
    var aheadPct = M.pctA('pct_a_ahead_15m');
    return {
      leftAhead: sb.leftAhead,
      leftBehind: sb.leftBehind,
      rightAhead: sb.rightAhead,
      rightBehind: sb.rightBehind,
      sensitivity: sensitivity,
      corr: isNum(corr) ? Math.abs(corr) : null,
      vol: vol,
      aheadPct: aheadPct
    };
  }
  function snowballTier(sensitivity) {
    if (!isNum(sensitivity)) return { cls: 'neutral', label: 'unavailable', copy: 'Snowball sensitivity is unavailable for this matchup.' };
    if (sensitivity >= 0.25) return { cls: 'danger', label: 'explosive', copy: 'Being ahead or behind at 15 minutes drastically changes how the match should be read.' };
    if (sensitivity >= 0.16) return { cls: 'warning', label: 'high', copy: 'The early advantage matters greatly: the lane can determine the pace of the match.' };
    if (sensitivity >= 0.08) return { cls: 'info', label: 'media', copy: 'The early advantage matters, but it does not determine the matchup on its own.' };
    return { cls: 'neutral', label: 'low', copy: 'The lane tends to leave more room for recovery, scaling, or macro play.' };
  }

  function objectiveEdge(M) {
    if (state.role === 'JUNGLE') {
      var best = null;
      OBJECTIVES.forEach(function (o) {
        var pct = M.pctA('pct_champion_a_first_' + o.key);
        if (!isNum(pct)) return;
        var edge = pct - 0.5;
        if (!best || Math.abs(edge) > Math.abs(best.edge)) best = { label: o.label, edge: edge, pct: pct };
      });
      return best;
    }
    var tower = M.pctA('pct_champion_a_wins_tower_race');
    if (isNum(tower)) return { label: 'First turret', edge: tower - 0.5, pct: tower };
    return null;
  }


  function profileComebackRisk(p) {
    if (!p) return null;
    var net = p.avg_bounty_net;
    var rate = p.shutdown_given_rate;
    if (!isNum(net) || !isNum(rate)) return null;
    return Math.max(0, net) * rate;
  }

  function selectTopInsightCards(items) {
    var ranked = items.slice().sort(function (a, b) {
      return b.weight - a.weight || b.rawWeight - a.rawWeight;
    });
    if (!ranked.length) return [];

    var veryHigh = ranked.filter(function (it) { return it.weight >= 92; }).length;
    var limit = veryHigh >= 6 ? 6 : 5;
    var selected = [];
    var usedTags = {};

    ranked.forEach(function (it) {
      if (selected.length >= limit || it.weight < 61 || usedTags[it.tag]) return;
      selected.push(it);
      usedTags[it.tag] = true;
    });
    ranked.forEach(function (it) {
      if (selected.length >= limit || selected.indexOf(it) !== -1) return;
      if (it.weight >= 61 || selected.length < 3) selected.push(it);
    });
    return selected.slice(0, limit);
  }

  function buildInsightCards(M) {
    var champA = state.champA, champB = state.champB;
    var wr = M.pair('winrate');
    var diff = M.pair('diff_winrate');
    var n = M.direct('n_matches');
    var gold15 = seriesAtMinute(M, 'gold_diff_by_minute', 15);
    var xp15 = seriesAtMinute(M, 'xp_diff_by_minute', 15);
    var exGold15 = seriesAtMinute(M, 'excess_gold_diff_by_minute', 15);
    var exXp15 = seriesAtMinute(M, 'excess_xp_diff_by_minute', 15);
    var snow = snowballRead(M);
    var obj = objectiveEdge(M);
    var l6 = M.pair('avg_level6_minute');
    var level6 = isNum(l6[0]) && isNum(l6[1]) ? l6[0] - l6[1] : null;
    var kdPressure = M.diffAB('early_kd_pressure_15m_a_minus_b');
    var excessKd = M.diffAB('excess_early_kd_pressure_15m_a_minus_b');
    var killDiff = M.diffAB('avg_kill_diff_15m_a_minus_b');
    var deathDiff = M.diffAB('avg_death_diff_15m_a_minus_b');
    var bountyDiff = M.diffAB('avg_bounty_net_diff_15m_a_minus_b');
    var excessBounty = M.diffAB('excess_bounty_net_diff_15m_a_minus_b');
    var goldNoBounty = M.diffAB('gold_diff_without_bounty_15m_a_minus_b');
    var bountyShare = M.direct('bounty_share_of_gold_diff_15m');
    var resourcePressure = M.diffAB('resource_winpct_pressure_estimate_a_15m');
    var snowQuality = M.direct('snowball_quality_15m_a');
    var snowConversion = M.direct('snowball_conversion_15m_a');
    var volatility = M.direct('volatility_15m_a');
    var killEfficiency = M.direct('kill_value_efficiency_15m_a');
    var objectiveConversion = M.diffAB('objective_conversion_score_a');
    var seqScore = M.diffAB('monster_sequence_control_score_a');
    var seqDiff = M.diffAB('monster_sequence_diff_total_a_minus_b');
    var seqEvents = M.direct('monster_sequence_event_count_total');
    var firstBlood = M.pctA('pct_champion_a_first_blood');
    var firstKill = M.pctA('pct_a_first_kill_in_pair');
    var firstDeath = M.pctA('pct_a_first_death_in_pair');
    var pa = profile(state.role, champA);
    var pb = profile(state.role, champB);
    var comebackA = profileComebackRisk(pa);
    var comebackB = profileComebackRisk(pb);
    var items = [];
    var conf = confidence(n);
    var samplePenalty = conf.level === 'low' ? 12 : (conf.level === 'mid' ? 4 : 0);

    function add(weight, tone, tag, title, body) {
      if (!body || !isNum(weight)) return;
      var adjusted = tag === 'Reliability' ? weight : Math.max(0, weight - samplePenalty);
      items.push({ weight: adjusted, rawWeight: weight, tone: tone || 'neutral', tag: tag, title: title, body: body });
    }
    function side(v, deadzone) {
      var t = toneFromSigned(v, deadzone || 0);
      return t === 'a' ? champA : (t === 'b' ? champB : 'neither');
    }
    function sameSign(a, b) {
      return isNum(a) && isNum(b) && Math.abs(a) > 0.0001 && Math.abs(b) > 0.0001 && Math.sign(a) === Math.sign(b);
    }
    function oppositeSign(a, b) {
      return isNum(a) && isNum(b) && Math.abs(a) > 0.0001 && Math.abs(b) > 0.0001 && Math.sign(a) !== Math.sign(b);
    }

    var wrEdge = isNum(wr[0]) ? wr[0] - 0.5 : null;
    var baseAdv = isNum(diff[0]) && isNum(diff[1]) ? diff[0] - diff[1] : null;

    if (conf.level === 'low') {
      add(103, 'warning', 'Reliability', 'Few matches: interpret the result cautiously',
        fmtInt(n) + ' direct matches. The result is more reliable when gold, XP, trades, and objectives tell the same story; one number is not enough.');
    } else if (isNum(n)) {
      add(conf.level === 'high' ? 73 : 67, conf.level === 'high' ? 'info' : 'warning', 'Reliability', conf.label,
        fmtInt(n) + ' direct matches. The more matches are available, the more weight the recommendations receive.');
    }

    if (sameSign(wrEdge, baseAdv) && Math.abs(wrEdge) >= 0.035 && Math.abs(baseAdv) >= 0.02) {
      add(99, toneFromSigned(wrEdge, 0), 'Convergence', side(wrEdge) + ' has an advantage confirmed by multiple data points',
        'Win rate in the matchup (' + fmtPct(Math.max(wr[0], wr[1]), 1) + ') and performance relative to the usual average (' + fmtSignedPP(baseAdv, 1) + ') favor the same champion.');
    } else if (isNum(wrEdge) && Math.abs(wrEdge) >= 0.045) {
      add(88, toneFromSigned(wrEdge, 0), 'Matchup', side(wrEdge) + ' wins this matchup more often',
        'The win rate favors one side (' + fmtPct(Math.max(wr[0], wr[1]), 1) + '), but gold, XP, and the timing of the advantage must confirm the interpretation.');
    } else {
      add(62, 'neutral', 'Balance', 'The overall result is close',
        'The win rates are nearly even: gold and XP progression, trades, level 6, and objectives matter more when interpreting the matchup.');
    }

    if (isNum(gold15) && isNum(exGold15)) {
      if (Math.abs(gold15) >= 420 && Math.abs(exGold15) >= 260 && sameSign(gold15, exGold15)) {
        add(95, toneFromSigned(gold15, 0), 'Economy', side(gold15) + ' creates an advantage that comes specifically from this matchup',
          'Gold at 15 minutes (' + fmtSigned(gold15, 0, '') + ') and matchup-specific gold advantage (' + fmtSigned(exGold15, 0, '') + ') agree: it is not merely an effect of the champion\'s usual strength.');
      } else if (Math.abs(gold15) >= 420 && Math.abs(exGold15) < 180) {
        add(84, toneFromSigned(gold15, 0), 'Economy', 'The gold advantage depends mainly on the champion',
          side(gold15) + ' is ahead in gold at 15 minutes, but the specific matchup adds little: much of the margin comes from the champion\'s usual performance.');
      } else if (Math.abs(exGold15) >= 300 && Math.abs(gold15) < 360) {
        add(87, toneFromSigned(exGold15, 0), 'Matchup-specific advantage', 'The matchup adds an advantage that the total conceals',
          'Total gold is close, but relative to expectations the matchup favors ' + side(exGold15) + ': this pairing shifts the balance more than total gold alone suggests.');
      }
    }

    if (isNum(gold15) && isNum(goldNoBounty) && Math.abs(gold15) >= 450) {
      if (oppositeSign(gold15, goldNoBounty)) {
        add(97, 'danger', 'Bounty-related risk', 'Bounties are completely changing the gold advantage',
          'Total gold favors one side, but without bounties it would favor the other. The advantage is fragile and can change with a single shutdown.');
      } else if (isNum(bountyShare) && Math.abs(bountyShare) >= 0.85 && Math.abs(goldNoBounty) < Math.abs(gold15) * 0.55) {
        add(91, 'warning', 'Bounty-related risk', 'Most of the advantage comes from bounties',
          'Share of the gold advantage due to bounties: ' + fmtSignedPct(bountyShare, 1) + '. Without bounties, the margin falls to ' + fmtSigned(goldNoBounty, 0, '') + ' gold.');
      }
    }

    if (isNum(kdPressure) || isNum(excessKd)) {
      if (isNum(kdPressure) && isNum(excessKd) && Math.abs(kdPressure) >= 2.5 && Math.abs(excessKd) >= 1.8 && sameSign(kdPressure, excessKd)) {
        add(94, toneFromSigned(kdPressure, 0), 'Trade advantage', side(kdPressure) + ' consistently wins trades',
          'Kill-death balance at 15 minutes ' + fmtSigned(kdPressure, 2) + ' and matchup-specific value ' + fmtSigned(excessKd, 2) + ' agree: this matchup creates a fight advantage beyond what is normally expected.');
      } else if (isNum(kdPressure) && Math.abs(kdPressure) >= 3) {
        add(86, toneFromSigned(kdPressure, 0), 'Trade advantage', side(kdPressure) + ' gets better trades in the first 15 minutes',
          'Kill difference ' + fmtSigned(killDiff, 2) + ', death difference ' + fmtSigned(deathDiff, 2) + ', overall balance ' + fmtSigned(kdPressure, 2) + '.');
      } else if (isNum(kdPressure) && isNum(excessKd) && oppositeSign(kdPressure, excessKd) && Math.abs(excessKd) >= 1.5) {
        add(88, 'warning', 'Trade advantage', 'The champions\' usual performance can be misleading',
          'The raw result and the result adjusted for usual performance point in opposite directions: do not choose a lane plan based on kills alone.');
      }
    }

    if (isNum(bountyDiff) && Math.abs(bountyDiff) >= 280) {
      var cleanBounty = isNum(excessBounty) && sameSign(bountyDiff, excessBounty) && Math.abs(excessBounty) >= 220;
      add(cleanBounty ? 90 : 81, toneFromSigned(bountyDiff, 0), 'Bounties', side(bountyDiff) + ' gains more useful gold from fights',
        'Bounty balance at 15 minutes: ' + fmtSigned(bountyDiff, 0) + (isNum(excessBounty) ? ' · matchup-specific component: ' + fmtSigned(excessBounty, 0) : '') + '. ' + (cleanBounty ? 'The advantage remains after accounting for the champions\' usual performance.' : 'Part of the margin may depend on how these champions normally play.'));
    }

    if (snow && snow.sensitivity >= 0.14) {
      var tSnow = snowballTier(snow.sensitivity);
      var aheadSide = isNum(snow.aheadPct) && Math.abs(snow.aheadPct - 0.5) >= 0.06 ? (snow.aheadPct > 0.5 ? champA : champB) : null;
      add(snow.sensitivity >= 0.22 ? 96 : 89, tSnow.cls, 'Impact of the first advantage', 'The first advantage matters more than usual',
        'The difference between being ahead or behind at 15 minutes is ' + fmtPP(snow.sensitivity, 1) + '. ' + (aheadSide ? aheadSide + ' is ahead at 15 minutes more often.' : 'Wave management, resets, and jungler presence carry particularly high weight.'));
    }
    if (isNum(snowQuality) && snowQuality >= 42 && isNum(snowConversion) && snowConversion >= 0.22) {
      add(snowQuality >= 55 ? 93 : 85, 'warning', 'Advantage stability', 'The early advantage is converted into wins effectively',
        'Advantage quality ' + fmtDec(snowQuality, 1) + ' and ability to capitalize on it ' + fmtPP(snowConversion, 1) + ': when this lane gets ahead, the margin tends to remain useful later in the match.');
    }
    if (isNum(volatility) && volatility >= 9) {
      add(volatility >= 16 ? 89 : 76, 'warning', 'Variable matches', 'The matchup can develop in very different ways',
        'Observed variability ' + fmtDec(volatility, 2) + '. Avoid an overly rigid plan: matches with these champions can take very different directions.');
    }

    if (isNum(resourcePressure) && Math.abs(resourcePressure) >= 5) {
      add(Math.abs(resourcePressure) >= 12 ? 92 : 83, toneFromSigned(resourcePressure, 0), 'Resources', side(resourcePressure) + ' makes better use of the gold and XP advantage',
        'Estimated impact of gold and XP on the result: ' + fmtSigned(resourcePressure, 2, ' pp') + '. This accounts for both the resource advantage and how effectively each champion normally uses it.');
    }

    if (isNum(xp15) && Math.abs(xp15) >= 420) {
      add(79, toneFromSigned(xp15, 0), 'Timing XP', side(xp15) + ' reaches power spikes earlier',
        'XP at 15 minutes: ' + fmtSigned(xp15, 0, '') + (isNum(exXp15) ? ' · matchup-specific XP: ' + fmtSigned(exXp15, 0, '') : '') + '. An earlier level or ultimate can matter more than gold.');
    }
    if (isNum(level6) && Math.abs(level6) >= 0.25) {
      var sideL6 = level6 < 0 ? champA : champB;
      add(72, level6 < 0 ? 'a' : 'b', 'Level 6', sideL6 + ' reaches level 6 earlier',
        'Average difference: ' + fmtDec(Math.abs(level6), 2) + ' minutes. During that window, they can look for trades, all-ins, or map pressure before the opponent.');
    }

    if (obj && Math.abs(obj.edge) >= 0.07) {
      add(78, toneFromSigned(obj.edge, 0), state.role === 'JUNGLE' ? 'Objectives' : 'Towers', side(obj.edge) + ' controls the first major objective more often',
        obj.label + ': ' + fmtPct(Math.max(obj.pct, 1 - obj.pct), 1) + '. This advantage matters most when the team uses lane priority to move first.');
    }
    if (isNum(firstBlood) && Math.abs(firstBlood - 0.5) >= 0.09) {
      add(76, toneFromSigned(firstBlood - 0.5, 0), 'First event', side(firstBlood - 0.5) + ' gets the first kill of the match more often',
        'First kill of the match: ' + fmtPct(Math.max(firstBlood, 1 - firstBlood), 1) + '. First kill in the duel: ' + fmtPct(firstKill, 1) + '; probability of dying first ' + champA + ': ' + fmtPct(firstDeath, 1) + '.');
    }
    if (state.role === 'JUNGLE' && isNum(seqScore) && Math.abs(seqScore) >= 0.10 && (!isNum(seqEvents) || seqEvents >= 7)) {
      add(Math.abs(seqScore) >= 0.22 ? 92 : 82, toneFromSigned(seqScore, 0), 'Monster sequence', side(seqScore) + ' controls the sequence of neutral objectives better',
        'Objective-control indicator ' + fmtSigned(seqScore, 3) + ', average monster difference ' + fmtSigned(seqDiff, 2) + ' across ' + fmtInt(seqEvents) + ' events. It considers not only the first dragon or Rift Herald, but the entire sequence.');
    }
    if (isNum(objectiveConversion) && Math.abs(objectiveConversion) >= 0.03) {
      add(80, toneFromSigned(objectiveConversion, 0), 'Conversion', side(objectiveConversion) + ' converts pressure into objectives more effectively',
        'Objective-conversion indicator: ' + fmtSigned(objectiveConversion, 4) + '.');
    }

    if (isNum(killEfficiency) && Math.abs(killEfficiency) >= 900) {
      add(Math.abs(killEfficiency) >= 1500 ? 86 : 74, 'warning', 'Kill value', 'Even a few kills can create a large gold lead',
        'Gold created per kill of advantage: ' + fmtDec(killEfficiency, 1) + ' gold. The matchup can become highly unbalanced economically even without many kills.');
    }

    if (isNum(comebackA) && isNum(comebackB) && Math.abs(comebackA - comebackB) >= 260) {
      var riskDiff = comebackA - comebackB;
      var exposed = riskDiff > 0 ? champA : champB;
      add(Math.abs(riskDiff) >= 650 ? 88 : 75, toneFromSigned(-riskDiff, 0), 'Comeback risk', exposed + ' risks giving away more gold through a shutdown',
        'Potential value exposed: ' + champA + ' ' + fmtInt(comebackA) + ' vs ' + champB + ' ' + fmtInt(comebackB) + '. The champion carrying the larger bounty must avoid isolated deaths and risky resets.');
    }

    if (isNum(baseAdv)) {
      add(63, toneFromSigned(baseAdv, 0.01), 'Comparison with usual performance', 'How much the matchup changes usual performance',
        'Difference from usual performance: ' + fmtSignedPP(baseAdv, 1) + '. If it does not agree with win rate, gold/XP progression, and timing, give more weight to the latter.');
    }

    return selectTopInsightCards(items);
  }

  function insightRelevance(weight) {
    if (weight >= 94) return { label: 'Very high relevance', cls: 'very-high' };
    if (weight >= 82) return { label: 'High relevance', cls: 'high' };
    if (weight >= 66) return { label: 'Medium relevance', cls: 'medium' };
    return { label: 'Low relevance', cls: 'low' };
  }

  function insightCardsHtml(M) {
    var items = buildInsightCards(M);
    return '<div class="insight-grid">' + items.map(function (it) {
      var rel = insightRelevance(it.weight);
      return '<article class="insight-card ' + it.tone + '">' +
        '<div class="insight-top">' +
          '<span class="insight-tag">' + esc(it.tag) + '</span>' +
          '<span class="insight-separator" aria-hidden="true"></span>' +
          '<span class="insight-impact ' + rel.cls + '">' + esc(rel.label) + '</span>' +
        '</div>' +
        '<h4>' + esc(it.title) + '</h4>' +
        '<p>' + esc(it.body) + '</p>' +
      '</article>';
    }).join('') + '</div>';
  }

  function miniBarsHtml(rows) {
    return '<div class="mini-bars">' + rows.map(function (r) {
      var val = isNum(r.value) ? r.value : 0;
      var width = Math.round(Math.max(4, Math.min(100, r.scale ? Math.abs(val) / r.scale * 100 : Math.abs(val) * 100)));
      var tone = toneFromSigned(val, r.deadzone || 0);
      var label = tone === 'neutral' ? 'Balance' : (tone === 'a' ? state.champA : state.champB);
      return '<div class="mini-bar-row ' + tone + '">' +
        '<div class="mini-bar-head"><span>' + esc(r.label) + '</span><strong>' + esc(r.format ? r.format(val) : fmtDec(val, 1)) + '</strong></div>' +
        '<div class="mini-bar-track"><i style="width:' + width + '%"></i></div>' +
        '<div class="mini-bar-sub">' + esc(label) + '</div>' +
      '</div>';
    }).join('') + '</div>';
  }

  function renderVerdict(M) {
    var champA = state.champA, champB = state.champB, role = state.role;
    var n = M.direct('n_matches');
    var conf = confidence(n);
    var wr = M.pair('winrate');
    var genWr = M.pair('general_winrate');
    var diffWr = M.pair('diff_winrate');
    var wrEdge = isNum(wr[0]) ? wr[0] - 0.5 : 0;
    var favoredIsLeft = wrEdge >= 0;
    var favoredName = favoredIsLeft ? champA : champB;
    var favoredWr = favoredIsLeft ? wr[0] : wr[1];
    var snow = snowballRead(M);
    var tier = snowballTier(snow ? snow.sensitivity : null);
    var gold15 = seriesAtMinute(M, 'gold_diff_by_minute', 15);
    var exGold15 = seriesAtMinute(M, 'excess_gold_diff_by_minute', 15);
    var obj = objectiveEdge(M);

    var outlook = Math.abs(wrEdge) < 0.02 ? 'Nearly even matchup' : favoredName + ' slightly ahead';
    if (Math.abs(wrEdge) >= 0.07) outlook = favoredName + ' has a clear advantage';
    else if (Math.abs(wrEdge) >= 0.04) outlook = favoredName + ' ahead';

    var html = '';
    html += '<section class="v2-hero">';
    html += '<div class="v2-hero-top"><div><div class="v2-eyebrow">Matchup interpretation · ' + esc(ROLE_LABELS[role]) + '</div>';
    html += '<h2><span class="name-a">' + champHtml(champA, 'md') + '</span><em>vs</em><span class="name-b">' + champHtml(champB, 'md') + '</span></h2>';
    html += '<p>' + esc(outlook) + '. The interpretation combines direct-matchup results, the champions\' usual performance, the first 15 minutes, and the number of available matches.</p></div>';
    html += '<div class="sample-badge ' + conf.level + '"><span class="dot"></span>' + conf.label + ' · ' + fmtInt(n) + ' matches</div></div>';
    html += '<div class="v2-verdict-main"><div class="v2-big-number ' + (favoredIsLeft ? 'a' : 'b') + '"><span>Main signal</span><strong>' + fmtPct(favoredWr, 1) + '</strong><em>' + esc(favoredName) + '</em></div>';
    html += '<div class="v2-winrail"><div class="tick50"></div><div class="left" style="width:' + Math.max(0, Math.min(100, wr[0] * 100)) + '%"><span>' + fmtPct(wr[0], 1) + '</span></div><div class="right" style="width:' + Math.max(0, Math.min(100, wr[1] * 100)) + '%"><span>' + fmtPct(wr[1], 1) + '</span></div></div></div>';
    html += '<div class="v2-kpi-row">';
    html += '<div class="v2-kpi ' + toneFromSigned(diffWr[0] - diffWr[1], 0.005) + '"><span>Difference from usual performance</span><strong>' + fmtSignedPP((isNum(diffWr[0]) && isNum(diffWr[1])) ? diffWr[0] - diffWr[1] : null, 1) + '</strong><em>direct matchup compared with average</em></div>';
    html += '<div class="v2-kpi ' + toneFromSigned(gold15, 80) + '"><span>Gold @15</span><strong>' + (isNum(gold15) ? (gold15 > 0 ? '+' : '') + fmtInt(gold15) : '—') + '</strong><em>actual early advantage</em></div>';
    html += '<div class="v2-kpi ' + toneFromSigned(exGold15, 60) + '"><span>Gold attributable to the matchup at 15 minutes</span><strong>' + (isNum(exGold15) ? (exGold15 > 0 ? '+' : '') + fmtInt(exGold15) : '—') + '</strong><em>matchup-specific effect</em></div>';
    html += '<div class="v2-kpi ' + tier.cls + '"><span>Impact of the first advantage</span><strong>' + (snow ? fmtPP(snow.sensitivity, 1) : '—') + '</strong><em>' + esc(tier.label) + '</em></div>';
    if (obj) html += '<div class="v2-kpi ' + toneFromSigned(obj.edge, 0.02) + '"><span>' + esc(obj.label) + '</span><strong>' + fmtPct(Math.max(obj.pct, 1 - obj.pct), 1) + '</strong><em>' + esc(sideName(toneFromSigned(obj.edge, 0.02))) + '</em></div>';
    html += '</div>';
    html += '<div class="v2-hero-insights"><div class="card-head"><h3>Decisive insights</h3><span class="card-sub">Only signals with meaningful weight: convergence, timing, snowballing, or data risk.</span></div>' + insightCardsHtml(M) + '</div>';
    html += '</section>';
    document.getElementById('verdictBand').innerHTML = html;
  }

  function radarSvg(title, axes, pa, pb) {
    var size = 360, cx = 180, cy = 185, r = 118;
    function point(i, val) {
      var ang = -Math.PI / 2 + i * 2 * Math.PI / axes.length;
      var rr = r * clamp01((val || 0) / 100);
      return [cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr];
    }
    function poly(vals) {
      return vals.map(function (v, i) { var p = point(i, v); return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ');
    }
    var valsA = axes.map(function (a) { return a.a; });
    var valsB = axes.map(function (a) { return a.b; });
    var grid = [0.25, 0.5, 0.75, 1].map(function (k) {
      var pts = axes.map(function (_, i) { var ang = -Math.PI / 2 + i * 2 * Math.PI / axes.length; return (cx + Math.cos(ang) * r * k).toFixed(1) + ',' + (cy + Math.sin(ang) * r * k).toFixed(1); }).join(' ');
      return '<polygon points="' + pts + '" class="radar-grid-poly"></polygon>';
    }).join('');
    var labels = axes.map(function (a, i) {
      var ang = -Math.PI / 2 + i * 2 * Math.PI / axes.length;
      var x = cx + Math.cos(ang) * (r + 44);
      var y = cy + Math.sin(ang) * (r + 34);
      var anchor = Math.abs(Math.cos(ang)) < 0.2 ? 'middle' : (Math.cos(ang) > 0 ? 'start' : 'end');
      return '<text x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" text-anchor="' + anchor + '" class="radar-label">' + esc(a.label) + '</text>';
    }).join('');
    return '<div class="v2-radar-card"><div class="card-head"><h3>' + esc(title) + '</h3><span class="card-sub">0–100 scale, based on role percentiles</span></div>' +
      '<svg class="v2-radar" viewBox="0 0 ' + size + ' ' + size + '" role="img" aria-label="' + esc(title) + '">' +
      grid + axes.map(function (_, i) { var p = point(i, 100); return '<line x1="' + cx + '" y1="' + cy + '" x2="' + p[0].toFixed(1) + '" y2="' + p[1].toFixed(1) + '" class="radar-axis"/>'; }).join('') +
      '<polygon points="' + poly(valsA) + '" class="radar-poly a"></polygon>' +
      '<polygon points="' + poly(valsB) + '" class="radar-poly b"></polygon>' +
      valsA.map(function (v, i) { var p = point(i, v); return '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="4" class="radar-dot a"/>'; }).join('') +
      valsB.map(function (v, i) { var p = point(i, v); return '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="4" class="radar-dot b"/>'; }).join('') + labels + '</svg>' +
      '<div class="radar-legend"><span><i class="a"></i>' + esc(state.champA) + '</span><span><i class="b"></i>' + esc(state.champB) + '</span></div></div>';
  }

  function renderOverview(M) {
    var role = state.role, champA = state.champA, champB = state.champB;
    var pa = profile(role, champA), pb = profile(role, champB);
    var identityAxes = [
      { label: 'Wins', a: pctile(pa, 'general_winrate'), b: pctile(pb, 'general_winrate') },
      { label: 'Damage', a: pctile(pa, 'avg_damage_to_champs'), b: pctile(pb, 'avg_damage_to_champs') },
      { label: 'Durability', a: pctile(pa, 'avg_damage_taken'), b: pctile(pb, 'avg_damage_taken') },
      { label: 'Vision', a: pctile(pa, 'vision_score'), b: pctile(pb, 'vision_score') },
      { label: 'CC', a: pctile(pa, 'avg_total_time_cc_dealt'), b: pctile(pb, 'avg_total_time_cc_dealt') },
      { label: 'Lvl 6', a: pctile(pa, 'avg_level6_minute', true), b: pctile(pb, 'avg_level6_minute', true) }
    ];
    var economyAxes = [
      { label: 'Gold dep.', a: pctile(pa, 'goldxp_winpct_per_1k_gold'), b: pctile(pb, 'goldxp_winpct_per_1k_gold') },
      { label: 'XP dep.', a: pctile(pa, 'goldxp_winpct_per_1k_xp'), b: pctile(pb, 'goldxp_winpct_per_1k_xp') },
      { label: 'Resources → winning', a: pctile(pa, 'goldxp_auc'), b: pctile(pb, 'goldxp_auc') },
      { label: 'Vision', a: pctile(pa, 'vision_score'), b: pctile(pb, 'vision_score') },
      { label: 'Time to level 6', a: pctile(pa, 'avg_level6_minute', true), b: pctile(pb, 'avg_level6_minute', true) }
    ];
    var killAxes = [
      { label: 'Kills by 15 min', a: pctile(pa, 'avg_kills_0_15m'), b: pctile(pb, 'avg_kills_0_15m') },
      { label: 'Death 15', a: pctile(pa, 'avg_deaths_0_15m', true), b: pctile(pb, 'avg_deaths_0_15m', true) },
      { label: 'Bounty balance', a: pctile(pa, 'avg_bounty_net'), b: pctile(pb, 'avg_bounty_net') },
      { label: 'Average bounty per kill', a: pctile(pa, 'avg_bounty_per_kill'), b: pctile(pb, 'avg_bounty_per_kill') },
      { label: 'Kill streak', a: pctile(pa, 'avg_kill_streak_on_kill'), b: pctile(pb, 'avg_kill_streak_on_kill') },
      { label: 'Bounties collected', a: pctile(pa, 'shutdown_collected_rate'), b: pctile(pb, 'shutdown_collected_rate') },
      { label: 'Bounties given up', a: pctile(pa, 'shutdown_given_rate', true), b: pctile(pb, 'shutdown_given_rate', true) }
    ];
    var diffRows = [
      { label: 'Damage to champions', value: (M.pair('avg_damage_to_champs')[0] || 0) - (M.pair('avg_damage_to_champs')[1] || 0), scale: 7000, format: function (v) { return (v > 0 ? '+' : '') + fmtInt(v); } },
      { label: 'Damage taken', value: (M.pair('avg_damage_taken')[0] || 0) - (M.pair('avg_damage_taken')[1] || 0), scale: 7000, format: function (v) { return (v > 0 ? '+' : '') + fmtInt(v); } },
      { label: 'Vision score', value: M.diffAB('vision_diff_a_minus_b'), scale: 12, format: function (v) { return fmtSigned(v, 1); } },
      { label: 'Total CC', value: (M.pair('avg_total_time_cc_dealt')[0] || 0) - (M.pair('avg_total_time_cc_dealt')[1] || 0), scale: 18, format: function (v) { return (v > 0 ? '+' : '') + fmtDec(v, 1) + 's'; } },
      { label: 'Kills by 15 min', value: (M.pair('avg_kills_0_15m')[0] || 0) - (M.pair('avg_kills_0_15m')[1] || 0), scale: 0.9, format: function (v) { return fmtSigned(v, 3); } },
      { label: 'Bounty balance', value: (M.pair('avg_bounty_net')[0] || 0) - (M.pair('avg_bounty_net')[1] || 0), scale: 260, format: function (v) { return fmtSigned(v, 1); } },
      { label: 'Risk of giving away a bounty', value: (M.pair('shutdown_given_rate')[0] || 0) - (M.pair('shutdown_given_rate')[1] || 0), scale: 0.18, format: function (v) { return fmtSignedPct(v, 1); } }
    ];
    var html = '<div class="panel-grid v2-overview">';
    html += '<div class="card full-span"><div class="card-head"><h3>Matchup identity</h3><span class="card-sub">The radar charts use normalized percentiles: overall profile, economy, and the new kill/bounty block.</span></div><div class="v2-radar-grid">' + radarSvg('General profile', identityAxes, pa, pb) + radarSvg('Economy and timing', economyAxes, pa, pb) + radarSvg('Fights and bounties', killAxes, pa, pb) + '</div></div>';
    html += '<div class="card"><div class="card-head"><h3>Quick comparison</h3><span class="card-sub">Diverging bars: left/blue ' + esc(champA) + ', right/red ' + esc(champB) + '.</span></div>' + miniBarsHtml(diffRows) + '</div>';
    html += '<div class="card"><div class="card-head"><h3>Damage composition</h3><span class="card-sub">Physical, magic, and true damage remain separate.</span></div>' + damageStackRow('a', champA, M.pair('pct_physical_dmg')[0], M.pair('pct_magic_dmg')[0], M.pair('pct_true_dmg')[0]) + damageStackRow('b', champB, M.pair('pct_physical_dmg')[1], M.pair('pct_magic_dmg')[1], M.pair('pct_true_dmg')[1]) + '<div class="dmg-legend"><span><i style="background:var(--dmg-phys)"></i>Physical</span><span><i style="background:var(--dmg-magic)"></i>Magic</span><span><i style="background:var(--dmg-true)"></i>True</span></div></div>';
    html += '</div>';
    document.getElementById('panel-overview').innerHTML = html;
    bindTips(document.getElementById('panel-overview'));
  }

  function renderEconomy(M) {
    var champA = state.champA, champB = state.champB;
    var snow = snowballRead(M);
    var tier = snowballTier(snow ? snow.sensitivity : null);
    var gold15 = seriesAtMinute(M, 'gold_diff_by_minute', 15);
    var xp15 = seriesAtMinute(M, 'xp_diff_by_minute', 15);
    var exGold15 = seriesAtMinute(M, 'excess_gold_diff_by_minute', 15);
    var exXp15 = seriesAtMinute(M, 'excess_xp_diff_by_minute', 15);
    var corr = M.direct('snowball_corr_15m');
    var std = M.direct('gold_diff_std_15m');

    var snowConv = M.direct('snowball_conversion_15m_a');
    var volatilityIdx = M.direct('volatility_15m_a');
    var killEfficiency = M.direct('kill_value_efficiency_15m_a');
    var goldNoBounty = M.diffAB('gold_diff_without_bounty_15m_a_minus_b');
    var bountyShare = M.direct('bounty_share_of_gold_diff_15m');
    var resourcePressure = M.diffAB('resource_winpct_pressure_estimate_a_15m');

    var econRows = [
      { label: 'Gold @15', value: gold15, scale: 2200, format: function (v) { return isNum(v) ? (v > 0 ? '+' : '') + fmtInt(v) : '—'; } },
      { label: 'XP @15', value: xp15, scale: 2200, format: function (v) { return isNum(v) ? (v > 0 ? '+' : '') + fmtInt(v) : '—'; } },
      { label: 'Matchup-specific gold @15', value: exGold15, scale: 1400, format: function (v) { return isNum(v) ? (v > 0 ? '+' : '') + fmtInt(v) : '—'; } },
      { label: 'Matchup-specific XP @15', value: exXp15, scale: 1400, format: function (v) { return isNum(v) ? (v > 0 ? '+' : '') + fmtInt(v) : '—'; } }
    ];

    var html = '<div class="panel-grid v2-economy">';
    html += '<div class="card full-span v2-snowball-card ' + tier.cls + '"><div class="card-head"><h3>How much the first advantage matters</h3><span class="card-sub">Combines how well the advantage is maintained, how much it varies between matches, and how often it actually leads to a win.</span></div>';
    html += '<div class="snowball-visual"><div class="snowball-core"><span>Sensitivity</span><strong>' + (snow ? fmtPP(snow.sensitivity, 1) : '—') + '</strong><em>' + esc(tier.label) + '</em></div><div class="snowball-copy"><p>' + esc(tier.copy) + '</p>' +
      '<div class="snowball-split"><div><span>Wins by ' + esc(champA) + ' when ahead at 15</span><strong>' + (snow ? fmtPct(snow.leftAhead, 1) : '—') + '</strong></div><div><span>Wins by ' + esc(champA) + ' when behind at 15</span><strong>' + (snow ? fmtPct(snow.leftBehind, 1) : '—') + '</strong></div><div><span>Ability to capitalize on the advantage</span><strong>' + fmtSignedPct(snowConv, 1) + '</strong></div><div><span>Relationship between gold and winning</span><strong>' + fmtDec(corr, 3) + '</strong></div><div><span>Volatility index</span><strong>' + fmtDec(volatilityIdx, 2) + '</strong></div><div><span>Gold fluctuation</span><strong>' + fmtInt(std) + '</strong></div></div></div></div></div>';

    html += '<div class="card"><div class="card-head"><h3>Early economy</h3><span class="card-sub">Actual gold indicates pressure; excess gold isolates the matchup-specific effect.</span></div>' + miniBarsHtml(econRows) + '</div>';

    html += '<div class="card"><div class="card-head"><h3>Resource conversion</h3><span class="card-sub">Distinguishes the raw lead, the lead excluding bounties, and value per kill.</span></div>' + miniBarsHtml([
      { label: 'How much it depends on gold', value: M.diffAB('goldxp_gold_dependency_diff_a_minus_b'), scale: 5, format: function (v) { return fmtSigned(v, 2); } },
      { label: 'How much it depends on XP', value: M.diffAB('goldxp_xp_dependency_diff_a_minus_b'), scale: 5, format: function (v) { return fmtSigned(v, 2); } },
      { label: 'Gold excluding bounties', value: goldNoBounty, scale: 2200, format: function (v) { return fmtSigned(v, 1); } },
      { label: 'Gold gained per kill of advantage', value: killEfficiency, scale: 900, format: function (v) { return isNum(v) ? fmtDec(v, 1) + 'g' : '—'; } },
      { label: 'Share of the advantage due to bounties', value: bountyShare, scale: 0.55, format: function (v) { return fmtSignedPct(v, 1); } },
      { label: 'Estimated impact of gold and XP', value: resourcePressure, scale: 8, format: function (v) { return fmtSigned(v, 2, ' pp'); } }
    ]) + '</div>';

    html += '</div>';
    document.getElementById('panel-economy').innerHTML = html;
  }


  var RAW_INVARIANT_DIFF_FIELDS = {
    gold_per_kill_diff_15m_a_minus_b: true,
    xp_per_kill_diff_15m_a_minus_b: true
  };
  var RAW_SIGNED_PERSPECTIVE_FIELDS = {
    resource_winpct_pressure_estimate_a_15m: true,
    objective_conversion_score_a: true,
    monster_sequence_control_score_a: true
  };

  var PLAIN_METRIC_LABELS = {
    n_matches: 'Direct matches analyzed',
    low_sample: 'Few matches available',
    winrate_a: 'Win rate in the matchup',
    general_winrate_a: 'Usual win rate in the role',
    diff_winrate_a: 'How much the matchup changes usual performance',
    pct_a_ahead_15m: 'Probability of being ahead at 15 minutes',
    winrate_a_when_ahead_15m: 'Win rate when ahead at 15 minutes',
    winrate_a_when_behind_15m: 'Win rate when behind at 15 minutes',
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
    var k = String(key || '').toLowerCase();
    if (/excess_(gold|xp)_diff_by_minute/.test(k)) return 'Shows the gold or XP advantage created by this specific matchup, beyond what is normally expected from the two champions.';
    if (/(gold|xp)_diff_by_minute/.test(k)) return 'Tracks the resource difference minute by minute: positive favors the champion on the left, negative favors the one on the right.';
    if (/snowball|when_ahead|when_behind/.test(k)) return 'Explains how much the first advantage changes the match result and how difficult it is to recover after falling behind.';
    if (/bounty|shutdown/.test(k)) return 'Measures gold gained or given up through bounties and the risk of surrendering the advantage through a high-value death.';
    if (/kill|death|streak/.test(k)) return 'Describes how fights play out: kills, deaths, kill streaks, and the balance between positive and negative events.';
    if (/goldxp|resource|auc|winpct_per_1k/.test(k)) return 'Indicates how much gold and XP affect the result and how well the champion converts resources into wins.';
    if (/tower/.test(k)) return 'Describes who takes the first turret more often and by what average margin.';
    if (/monster|dragon|baron|riftherald|horde/.test(k)) return 'Measures control of neutral objectives, considering not only the first objective but also the overall sequence.';
    if (/vision/.test(k)) return 'Estimates the average contribution to vision and map control.';
    if (/damage|physical|magic|true/.test(k)) return 'Describes the amount and type of damage dealt or absorbed by the champion.';
    if (/cc|time_cc/.test(k)) return 'Measures how long the champion restricts enemies with stuns, slows, and other crowd control.';
    if (/level6/.test(k)) return 'Average level 6 time: a lower value indicates earlier access to the ultimate.';
    if (/winrate|diff_winrate/.test(k)) return 'Compares win rate in the matchup with the champion\'s usual performance in the role.';
    if (/percentile/.test(k)) return 'A position from 0 to 100 relative to other champions in the same role: higher means farther above average for that characteristic.';
    if (/n_matches|coverage|total_games|low_sample/.test(k)) return 'Indicates how many matches support the data: more matches generally mean a more stable interpretation.';
    return 'Supporting data used alongside other metrics: it should not be interpreted in isolation.';
  }

  function rawHumanLabel(col) {
    if (PLAIN_METRIC_LABELS[col]) return PLAIN_METRIC_LABELS[col];
    return String(col || '')
      .replace(/_a_minus_b$/g, ' (difference between the two champions)')
      .replace(/_a$/g, ' A')
      .replace(/_b$/g, ' B')
      .replace(/_/g, ' ')
      .replace(/\bavg\b/gi, 'medium')
      .replace(/\bpct\b/gi, 'percentage')
      .replace(/\bwinrate\b/gi, 'win rate')
      .replace(/\b\w/g, function (m) { return m.toUpperCase(); });
  }
  function rawArrayDisplay(arr) {
    if (!Array.isArray(arr)) return '—';
    if (!arr.length) return '[]';
    var picks = [0, 5, 10, 15, arr.length - 1].filter(function (v, i, all) { return v < arr.length && all.indexOf(v) === i; });
    return picks.map(function (i) { return i + ': ' + (isNum(arr[i]) ? fmtSigned(arr[i], 0) : '—'); }).join(' · ') + ' [' + arr.length + ' points]';
  }
  function rawExportValue(v) {
    if (Array.isArray(v)) return JSON.stringify(v);
    if (v === null || v === undefined) return '';
    return String(v);
  }
  function rawDisplayValue(col, v) {
    if (Array.isArray(v)) return rawArrayDisplay(v);
    if (v === null || v === undefined || (typeof v === 'number' && !isNum(v))) return '—';
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    if (typeof v !== 'number') return String(v);
    if (/^pct_|winrate|_rate($|_)/.test(col)) return fmtPct(v, 2);
    if (/auc|corr|score|quality|conversion|volatility|efficiency|pressure/.test(col)) return fmtDec(v, 4);
    if (/minute|_min_|level6/.test(col)) return fmtDec(v, 2);
    if (/n_matches|event_count|_total$|max_kill_streak/.test(col)) return fmtInt(v);
    return Math.abs(v) >= 100 ? fmtDec(v, 1) : fmtDec(v, 3);
  }
  function profileRiskPair() {
    return [profileComebackRisk(profile(state.role, state.champA)), profileComebackRisk(profile(state.role, state.champB))];
  }
  function buildCompleteRawRows(M) {
    var cols = DATA.matchupColumns || [];
    var has = {};
    cols.forEach(function (c) { has[c] = true; });
    var rows = [];
    cols.forEach(function (col) {
      if (/_b$/.test(col) && has[col.replace(/_b$/, '_a')]) return;
      var label = rawHumanLabel(col);
      var source = col;
      var a = null, b = null;

      if (/_a$/.test(col) && has[col.replace(/_a$/, '_b')]) {
        var base = col.replace(/_a$/, '');
        var pair = M.pair(base);
        a = pair[0]; b = pair[1]; source = col + ' / ' + col.replace(/_a$/, '_b');
      } else if (col === 'winrate_a_when_ahead_15m' || col === 'winrate_a_when_behind_15m') {
        var sb = M.snowballPerspective();
        if (sb) {
          if (col === 'winrate_a_when_ahead_15m') { a = sb.leftAhead; b = sb.rightAhead; }
          else { a = sb.leftBehind; b = sb.rightBehind; }
        }
      } else if (col === 'comeback_risk_a') {
        var risks = profileRiskPair(); a = risks[0]; b = risks[1];
      } else if (/^pct_champion_a_/.test(col) || /^pct_a_/.test(col) || col === 'monster_sequence_control_avg_a') {
        a = M.pctA(col);
        if (col === 'pct_a_first_kill_in_pair') b = M.pctA('pct_a_first_death_in_pair');
        else if (col === 'pct_a_first_death_in_pair') b = M.pctA('pct_a_first_kill_in_pair');
        else if (col === 'pct_a_kill_adv_15m' || col === 'pct_a_bounty_net_adv_15m') b = null;
        else b = isNum(a) ? 1 - a : null;
      } else if ((/_a_minus_b$/.test(col) && !RAW_INVARIANT_DIFF_FIELDS[col]) || RAW_SIGNED_PERSPECTIVE_FIELDS[col]) {
        a = M.diffAB(col); b = isNum(a) ? -a : null;
      } else if (/^(gold|xp|excess_gold|excess_xp)_diff_by_minute$/.test(col)) {
        a = M.arrAB(col); b = Array.isArray(a) ? a.map(function (v) { return isNum(v) ? -v : null; }) : null;
      } else {
        a = M.direct(col); b = null;
      }

      rows.push({
        label: label,
        source: source,
        a: rawDisplayValue(col, a),
        b: b === null || b === undefined ? '—' : rawDisplayValue(col, b),
        exportA: rawExportValue(a),
        exportB: rawExportValue(b)
      });
    });
    return rows;
  }


  function buildCompleteProfileRows() {
    var pa = profile(state.role, state.champA) || {};
    var pb = profile(state.role, state.champB) || {};
    var bench = (DATA.roleBenchmarks && DATA.roleBenchmarks[state.role]) || {};
    var keys = {};
    Object.keys(pa).forEach(function (k) { if (k !== 'percentiles' && k !== 'coverage') keys[k] = true; });
    Object.keys(pb).forEach(function (k) { if (k !== 'percentiles' && k !== 'coverage') keys[k] = true; });
    var rows = Object.keys(keys).sort().map(function (key) {
      var median = bench[key] && bench[key].median;
      return {
        label: rawHumanLabel(key), source: 'championProfiles.' + key,
        a: rawDisplayValue(key, pa[key]), b: rawDisplayValue(key, pb[key]),
        median: median === undefined || median === null ? '—' : rawDisplayValue(key, median),
        exportA: rawExportValue(pa[key]), exportB: rawExportValue(pb[key]), exportMedian: rawExportValue(median)
      };
    });
    var percentileKeys = {};
    Object.keys(pa.percentiles || {}).forEach(function (k) { percentileKeys[k] = true; });
    Object.keys(pb.percentiles || {}).forEach(function (k) { percentileKeys[k] = true; });
    Object.keys(percentileKeys).sort().forEach(function (key) {
      var av = pa.percentiles ? pa.percentiles[key] : null;
      var bv = pb.percentiles ? pb.percentiles[key] : null;
      rows.push({
        label: rawHumanLabel(key) + ' — percentile', source: 'championProfiles.percentiles.' + key,
        a: isNum(av) ? fmtDec(av, 1) : '—', b: isNum(bv) ? fmtDec(bv, 1) : '—', median: '0–100 scale',
        exportA: rawExportValue(av), exportB: rawExportValue(bv), exportMedian: '0-100'
      });
    });
    ['n_matchups', 'total_games'].forEach(function (key) {
      var av = pa.coverage ? pa.coverage[key] : null;
      var bv = pb.coverage ? pb.coverage[key] : null;
      rows.push({ label: rawHumanLabel(key), source: 'championProfiles.coverage.' + key, a: fmtInt(av), b: fmtInt(bv), median: '—', exportA: rawExportValue(av), exportB: rawExportValue(bv), exportMedian: '' });
    });
    var risks = profileRiskPair();
    rows.push({ label: 'Gold exposed to a potential comeback', source: 'avg_bounty_net × shutdown_given_rate', a: fmtDec(risks[0], 1), b: fmtDec(risks[1], 1), median: '—', exportA: rawExportValue(risks[0]), exportB: rawExportValue(risks[1]), exportMedian: '' });
    return rows;
  }

  var VISUAL_ATLAS_FAMILIES = [
    { id: 'outcome', title: 'Results & reliability', short: 'Results', test: function (key) { return /(^|\.)(n_matches|low_sample|winrate_|general_winrate_|diff_winrate_)/.test(key); } },
    { id: 'timeline', title: 'Resources over time', short: 'Resources', test: function (key) { return /gold_diff_by_minute|xp_diff_by_minute|excess_gold_diff_by_minute|excess_xp_diff_by_minute/.test(key); } },
    { id: 'combat', title: 'Damage, crowd control & vision', short: 'Combat', test: function (key) { return /pct_(physical|magic|true)_dmg|avg_damage|avg_time_cc|avg_total_time_cc|vision/.test(key); } },
    { id: 'kill', title: 'Fights, bounties & risks', short: 'Fights', test: function (key) { return /kill|death|bounty|streak|shutdown/.test(key) && !/monster_kill/.test(key); } },
    { id: 'map', title: 'Towers & early actions', short: 'Map', test: function (key) { return /tower|first_blood|first_dragon|first_baron|first_horde|first_riftherald|n_matches_(dragon|baron|horde|riftherald)/.test(key); } },
    { id: 'snowball', title: 'Impact of the advantage & comeback', short: 'Advantage', test: function (key) { return /ahead_15m|when_ahead|when_behind|snowball|volatility|comeback|gold_diff_std/.test(key); } },
    { id: 'monsters', title: 'Monsters & sequences', short: 'Monsters', test: function (key) { return /monster|event_count_/.test(key); } },
    { id: 'models', title: 'Resource dependence', short: 'Resources → winning', test: function (key) { return /goldxp_|resource_winpct|auc|level6/.test(key); } },
    { id: 'advanced', title: 'Efficiency & matchup-specific advantage', short: 'Deep dives', test: function (key) { return /early_kd|excess_|per_kill|without_bounty|bounty_share|kill_value|objective_conversion/.test(key); } },
    { id: 'other', title: 'Other useful data', short: 'Other', test: function () { return true; } }
  ];

  var VISUAL_ATLAS_ESSENTIAL = {
    n_matches:1, low_sample:1, winrate_a:1, general_winrate_a:1, diff_winrate_a:1,
    gold_diff_by_minute:1, xp_diff_by_minute:1, excess_gold_diff_by_minute:1, excess_xp_diff_by_minute:1,
    pct_physical_dmg_a:1, pct_magic_dmg_a:1, pct_true_dmg_a:1, avg_damage_to_champs_a:1,
    avg_damage_taken_a:1, avg_total_time_cc_dealt_a:1, vision_diff_a_minus_b:1,
    goldxp_gold_dependency_diff_a_minus_b:1, goldxp_xp_dependency_diff_a_minus_b:1, avg_level6_minute_a:1,
    avg_kill_diff_15m_a_minus_b:1, avg_death_diff_15m_a_minus_b:1, avg_bounty_net_diff_15m_a_minus_b:1,
    pct_a_first_kill_in_pair:1, pct_a_first_death_in_pair:1, pct_champion_a_wins_tower_race:1,
    avg_tower_fall_diff_min_a_minus_b:1, pct_a_ahead_15m:1, winrate_a_when_ahead_15m:1,
    winrate_a_when_behind_15m:1, snowball_corr_15m:1, gold_diff_std_15m:1,
    early_kd_pressure_15m_a_minus_b:1, excess_early_kd_pressure_15m_a_minus_b:1,
    gold_diff_without_bounty_15m_a_minus_b:1, bounty_share_of_gold_diff_15m:1,
    resource_winpct_pressure_estimate_a_15m:1, snowball_quality_15m_a:1,
    snowball_conversion_15m_a:1, volatility_15m_a:1, kill_value_efficiency_15m_a:1,
    comeback_risk_a:1, monster_sequence_control_score_a:1, monster_sequence_diff_total_a_minus_b:1
  };

  function visualAtlasSourceKey(source) {
    return String(source || '').split(' / ')[0].trim();
  }
  function visualAtlasFamily(source) {
    var key = String(source || '').toLowerCase();
    for (var i = 0; i < VISUAL_ATLAS_FAMILIES.length; i++) {
      if (VISUAL_ATLAS_FAMILIES[i].test(key)) return VISUAL_ATLAS_FAMILIES[i];
    }
    return VISUAL_ATLAS_FAMILIES[VISUAL_ATLAS_FAMILIES.length - 1];
  }
  function visualAtlasNum(value) {
    if (value === null || value === undefined || value === '' || value === '—') return null;
    var n = Number(String(value).replace(/\./g, '').replace(',', '.').replace(/[^0-9+\-.]/g, ''));
    return isFinite(n) ? n : null;
  }
  function visualAtlasPairFill(a, b) {
    var av = visualAtlasNum(a), bv = visualAtlasNum(b);
    if (av === null && bv === null) return [18, 18];
    var max = Math.max(Math.abs(av || 0), Math.abs(bv || 0), 0.0001);
    return [Math.max(8, Math.min(100, Math.abs(av || 0) / max * 100)), Math.max(8, Math.min(100, Math.abs(bv || 0) / max * 100))];
  }
  function visualAtlasParseArray(raw) {
    if (!raw || String(raw).charAt(0) !== '[') return null;
    try {
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.map(function (v) { return isNum(v) ? v : null; }) : null;
    } catch (e) { return null; }
  }
  function visualAtlasSeriesSvg(a, b) {
    var aa = visualAtlasParseArray(a), bb = visualAtlasParseArray(b);
    if (!aa || !aa.length) return '';
    if (!bb || !bb.length) bb = aa.map(function (v) { return isNum(v) ? -v : null; });
    var all = aa.concat(bb).filter(isNum);
    if (!all.length) return '';
    var w = 300, h = 72, pad = 4;
    var min = Math.min.apply(Math, all.concat([0]));
    var max = Math.max.apply(Math, all.concat([0]));
    var range = Math.max(1, max - min);
    function points(arr) {
      return arr.map(function (v, i) {
        if (!isNum(v)) return null;
        var x = pad + i / Math.max(1, arr.length - 1) * (w - pad * 2);
        var y = pad + (1 - (v - min) / range) * (h - pad * 2);
        return x.toFixed(1) + ',' + y.toFixed(1);
      }).filter(Boolean).join(' ');
    }
    var zero = pad + (1 - (0 - min) / range) * (h - pad * 2);
    var lastA = aa.slice().reverse().find(isNum);
    var lastB = bb.slice().reverse().find(isNum);
    return '<div class="metric-series-stage"><svg class="metric-sparkline" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" aria-hidden="true"><line x1="0" y1="' + zero.toFixed(1) + '" x2="' + w + '" y2="' + zero.toFixed(1) + '"></line><polyline points="' + points(aa) + '"></polyline><polyline points="' + points(bb) + '" style="stroke:var(--champ-b)"></polyline></svg><div class="metric-series-meta"><span>' + esc(state.champA) + ' <strong>' + esc(isNum(lastA) ? fmtSigned(lastA, 0) : '—') + '</strong></span><span>' + esc(state.champB) + ' <strong style="color:var(--champ-b)">' + esc(isNum(lastB) ? fmtSigned(lastB, 0) : '—') + '</strong></span></div></div>';
  }
  function visualAtlasCard(row, family, index, isProfile) {
    var pair = row.b !== undefined && row.b !== null && row.b !== '—';
    var series = visualAtlasSeriesSvg(row.exportA, row.exportB);
    var stage = '';
    if (series) {
      stage = series;
    } else if (pair) {
      var fills = visualAtlasPairFill(row.exportA, row.exportB);
      stage = '<div class="metric-pair-stage"><div class="metric-side a"><span>' + esc(state.champA) + '</span><strong>' + esc(row.a) + '</strong></div><div class="metric-balance"><i class="a" style="--metric-fill:' + fills[0].toFixed(1) + '"></i><i class="b" style="--metric-fill:' + fills[1].toFixed(1) + '"></i>' + (isProfile && row.median && row.median !== '—' ? '<small class="metric-benchmark">median ' + esc(row.median) + '</small>' : '') + '</div><div class="metric-side b"><span>' + esc(state.champB) + '</span><strong>' + esc(row.b) + '</strong></div></div>';
    } else {
      var single = visualAtlasNum(row.exportA);
      var fill = single === null ? 18 : Math.max(8, Math.min(100, Math.abs(single) <= 1 ? Math.abs(single) * 100 : 56));
      stage = '<div class="metric-single-stage"><span>Value from the perspective of the champion on the left</span><strong>' + esc(row.a) + '</strong><i style="--single-fill:' + fill.toFixed(1) + '%"></i></div>';
    }
    return '<article class="metric-viz-card" data-atlas-search="' + esc((row.label + ' ' + row.source + ' ' + family.title).toLowerCase()) + '"><div class="metric-viz-head"><span>' + esc(family.short) + '</span><em>' + String(index + 1).padStart(2, '0') + '</em></div><h4>' + esc(row.label) + '</h4>' + stage + '<p class="metric-help">' + esc(plainMetricDescription(row.source)) + '</p><details class="metric-source"><summary>Technical name in the dataset</summary><code>' + esc(row.source) + '</code>' + (isProfile && row.median && row.median !== '—' ? '<small>Typical role value: ' + esc(row.median) + '</small>' : '') + '</details></article>';
  }

  function renderRaw(M) {
    var champA = state.champA, champB = state.champB;
    var rows = buildCompleteRawRows(M).map(function (row) {
      row.family = visualAtlasFamily(row.source);
      row.key = visualAtlasSourceKey(row.source);
      return row;
    });
    var profileRows = buildCompleteProfileRows().map(function (row) {
      row.family = { id: 'profile', title: 'Profiles & role comparison', short: 'Profile' };
      row.key = row.source;
      return row;
    });
    var mode = 'essential';
    var family = 'all';
    var query = '';
    var panel = document.getElementById('panel-raw');

    panel.innerHTML = '<div class="metric-atlas-v2"><section class="metric-atlas-intro"><div><div class="micro-label">All data</div><h3>All metrics, organized for readability.</h3><p>The Essential view shows the most useful data for preparing the matchup first. The Complete view lets you explore all ' + fmtInt(DATA.matchupColumns.length) + ' matchup metrics, champion profiles, comparisons with other champions in the role, and the number of available matches.</p></div><div class="metric-atlas-score"><span>Available metrics</span><strong>' + fmtInt(DATA.matchupColumns.length) + '/' + fmtInt(DATA.matchupColumns.length) + '</strong><em>organized data</em></div></section><div class="atlas-commandbar"><label><span class="visually-hidden">Search metric</span><input id="rawFilter" type="search" placeholder="Search kills, bounties, level 6, turret, or dragon…"></label><div class="atlas-mode"><button type="button" data-mode="essential" class="active">Essential</button><button type="button" data-mode="complete">Complete</button></div></div><div class="atlas-family-chips" id="rawFamilyChips"></div><div class="atlas-status" id="rawAtlasStatus"></div><div class="atlas-groups" id="rawAtlasGroups"></div></div>';

    var chipTarget = document.getElementById('rawFamilyChips');
    chipTarget.innerHTML = '<button type="button" data-family="all" class="active">All</button>' + VISUAL_ATLAS_FAMILIES.filter(function (f) { return f.id !== 'other'; }).map(function (f) { return '<button type="button" data-family="' + esc(f.id) + '">' + esc(f.short) + '</button>'; }).join('') + '<button type="button" data-family="profile">Profiles</button>';

    function profileEssential(row) {
      return /general_winrate|avg_damage_to_champs|avg_damage_taken|avg_total_time_cc_dealt|vision_score|goldxp_winpct_per_1k_gold|goldxp_winpct_per_1k_xp|goldxp_auc|avg_level6_minute|avg_kills_0_15m|avg_deaths_0_15m|avg_bounty_net|shutdown_collected_rate|shutdown_given_rate|comeback_risk|coverage\.(n_matchups|total_games)/.test(row.source);
    }
    function draw() {
      var q = query.trim().toLowerCase();
      var visible = rows.filter(function (row) {
        if (mode === 'essential' && !VISUAL_ATLAS_ESSENTIAL[row.key]) return false;
        if (family !== 'all' && family !== row.family.id) return false;
        return !q || (row.label + ' ' + row.source + ' ' + row.family.title).toLowerCase().indexOf(q) !== -1;
      });
      var groups = VISUAL_ATLAS_FAMILIES.map(function (fam) {
        return { fam: fam, rows: visible.filter(function (row) { return row.family.id === fam.id; }) };
      }).filter(function (group) { return group.rows.length; });
      var html = groups.map(function (group, gi) {
        return '<details class="atlas-family-v2" ' + (gi < 2 ? 'open' : '') + '><summary><div><span>' + String(gi + 1).padStart(2, '0') + '</span><strong>' + esc(group.fam.title) + '</strong></div><em>' + fmtInt(group.rows.length) + ' cards</em></summary><div class="metric-viz-grid">' + group.rows.map(function (row, i) { return visualAtlasCard(row, group.fam, i, false); }).join('') + '</div></details>';
      }).join('');
      var profiles = profileRows.filter(function (row) {
        if (mode === 'essential' && !profileEssential(row)) return false;
        if (family !== 'all' && family !== 'profile') return false;
        return !q || (row.label + ' ' + row.source).toLowerCase().indexOf(q) !== -1;
      });
      if (profiles.length) html += '<div class="atlas-divider">Profiles & benchmark</div><details class="atlas-family-v2" ' + (family === 'profile' ? 'open' : '') + '><summary><div><span>P</span><strong>Champion profiles</strong></div><em>' + fmtInt(profiles.length) + ' cards</em></summary><div class="metric-viz-grid">' + profiles.map(function (row, i) { return visualAtlasCard(row, row.family, i, true); }).join('') + '</div></details>';
      document.getElementById('rawAtlasGroups').innerHTML = html || '<div class="empty-note">No metric matches the filter.</div>';
      document.getElementById('rawAtlasStatus').innerHTML = '<strong>' + fmtInt(visible.length) + '</strong><span>matchup cards</span><i></i><span>' + (mode === 'essential' ? 'main data' : fmtInt(DATA.matchupColumns.length) + ' source columns') + '</span>';
    }

    document.getElementById('rawFilter').addEventListener('input', function (event) { query = event.target.value; draw(); });
    panel.querySelectorAll('.atlas-mode button').forEach(function (button) { button.addEventListener('click', function () {
      mode = button.getAttribute('data-mode');
      panel.querySelectorAll('.atlas-mode button').forEach(function (b) { b.classList.toggle('active', b === button); });
      draw();
    }); });
    panel.querySelectorAll('#rawFamilyChips button').forEach(function (button) { button.addEventListener('click', function () {
      family = button.getAttribute('data-family');
      panel.querySelectorAll('#rawFamilyChips button').forEach(function (b) { b.classList.toggle('active', b === button); });
      draw();
    }); });

    draw();
  }

  function renderTrajectory(M) {
    var champA = state.champA, champB = state.champB;
    var gold15 = seriesAtMinute(M, 'gold_diff_by_minute', 15);
    var xp15 = seriesAtMinute(M, 'xp_diff_by_minute', 15);
    var exGold15 = seriesAtMinute(M, 'excess_gold_diff_by_minute', 15);
    var exXp15 = seriesAtMinute(M, 'excess_xp_diff_by_minute', 15);
    var html = '<div class="panel-grid">';
    html += '<div class="card full-span"><div class="card-head"><div><h3>Game progression</h3><span class="card-sub">Above zero favors <span style="color:var(--champ-a)">' + esc(champA) + '</span>; below zero favors <span style="color:var(--champ-b)">' + esc(champB) + '</span>.</span></div></div>';
    html += '<div class="river-controls" id="trajControls">' + Object.keys(TRAJ_MODES).map(function (k) { return '<button class="river-btn' + (state.trajMode === k ? ' active' : '') + '" data-mode="' + k + '">' + TRAJ_MODES[k].label + '</button>'; }).join('') + '</div>';
    html += '<div class="river-note" id="trajNote"></div><div class="river-svg-wrap" id="trajSvgWrap"></div><div class="river-legend"><span><i style="background:var(--champ-a)"></i>' + esc(champA) + '</span><span><i style="background:var(--champ-b)"></i>' + esc(champB) + '</span></div></div>';
    html += '<div class="card"><div class="card-head"><h3>Checkpoint @15</h3><span class="card-sub">Quick reading of the lane\'s midpoint.</span></div>' + miniBarsHtml([
      { label: 'Gold @15', value: gold15, scale: 2200, format: function (v) { return isNum(v) ? (v > 0 ? '+' : '') + fmtInt(v) : '—'; } },
      { label: 'XP @15', value: xp15, scale: 2200, format: function (v) { return isNum(v) ? (v > 0 ? '+' : '') + fmtInt(v) : '—'; } },
      { label: 'Matchup-specific gold @15', value: exGold15, scale: 1400, format: function (v) { return isNum(v) ? (v > 0 ? '+' : '') + fmtInt(v) : '—'; } },
      { label: 'Matchup-specific XP @15', value: exXp15, scale: 1400, format: function (v) { return isNum(v) ? (v > 0 ? '+' : '') + fmtInt(v) : '—'; } }
    ]) + '</div>';
    var profiles = DATA.championProfiles[state.role] || {};
    var pa = profiles[champA] || {}, pb = profiles[champB] || {};
    var l6a = pa.avg_level6_minute, l6b = pb.avg_level6_minute;
    html += '<div class="card"><div class="card-head"><h3>Level 6</h3><span class="card-sub">Average timing in the role: lower means an earlier power spike.</span></div>';
    if (isNum(l6a) || isNum(l6b)) {
      var maxAx = Math.max(12, (l6a || 0) + 1, (l6b || 0) + 1);
      html += '<div class="axis-mini"><div class="line"></div>';
      if (isNum(l6a)) html += '<div class="pt a" style="left:' + (l6a / maxAx * 100) + '%"><div class="dot"></div><div class="lbl">' + esc(champA) + ' · ' + fmtDec(l6a, 2) + '\'</div></div>';
      if (isNum(l6b)) html += '<div class="pt b" style="left:' + (l6b / maxAx * 100) + '%"><div class="dot"></div><div class="lbl">' + esc(champB) + ' · ' + fmtDec(l6b, 2) + '\'</div></div>';
      html += '</div>';
    } else {
      html += '<div class="empty-note">Data unavailable for at least one of the two champions.</div>';
    }
    html += '</div></div>';
    document.getElementById('panel-trajectory').innerHTML = html;
    document.querySelectorAll('#trajControls .river-btn').forEach(function (btn) { btn.addEventListener('click', function () { state.trajMode = btn.getAttribute('data-mode'); document.querySelectorAll('#trajControls .river-btn').forEach(function (b) { b.classList.toggle('active', b === btn); }); drawTrajChart(M); }); });
    drawTrajChart(M);
  }

  function renderCombat(M) {
    var champA = state.champA, champB = state.champB;
    var phys = M.pair('pct_physical_dmg'), magic = M.pair('pct_magic_dmg'), truep = M.pair('pct_true_dmg');
    var dealt = M.pair('avg_damage_to_champs'), taken = M.pair('avg_damage_taken');
    var ccOthers = M.pair('avg_time_ccing_others'), ccTotal = M.pair('avg_total_time_cc_dealt');
    var vision = M.pair('vision_score'), visionDiff = M.diffAB('vision_diff_a_minus_b');
    var html = '<div class="panel-grid">';
    html += '<div class="card full-span"><div class="card-head"><h3>Damage composition</h3><span class="card-sub">Physical, magic, and true damage: dedicated colors not used elsewhere.</span></div>' + damageStackRow('a', champA, phys[0], magic[0], truep[0]) + damageStackRow('b', champB, phys[1], magic[1], truep[1]) + '<div class="dmg-legend"><span><i style="background:var(--dmg-phys)"></i>Physical</span><span><i style="background:var(--dmg-magic)"></i>Magic</span><span><i style="background:var(--dmg-true)"></i>True</span></div></div>';
    html += '<div class="card"><div class="card-head"><h3>Damage and durability</h3><span class="card-sub">Damage output and damage absorbed tell different stories: one indicates presence, the other exposure/frontline duty.</span></div>' + miniBarsHtml([
      { label: 'Damage to champions', value: (dealt[0] || 0) - (dealt[1] || 0), scale: 7500, format: function (v) { return (v > 0 ? '+' : '') + fmtInt(v); } },
      { label: 'Damage taken', value: (taken[0] || 0) - (taken[1] || 0), scale: 7500, format: function (v) { return (v > 0 ? '+' : '') + fmtInt(v); } }
    ]) + '</div>';
    html += '<div class="card"><div class="card-head"><h3>Crowd control and vision</h3><span class="card-sub">Setup, safety, and macro contribution.</span></div>' + miniBarsHtml([
      { label: 'Average CC', value: (ccOthers[0] || 0) - (ccOthers[1] || 0), scale: 16, format: function (v) { return (v > 0 ? '+' : '') + fmtDec(v, 1) + 's'; } },
      { label: 'Total CC', value: (ccTotal[0] || 0) - (ccTotal[1] || 0), scale: 24, format: function (v) { return (v > 0 ? '+' : '') + fmtDec(v, 1) + 's'; } },
      { label: 'Vision score', value: isNum(visionDiff) ? visionDiff : ((vision[0] || 0) - (vision[1] || 0)), scale: 14, format: function (v) { return fmtSigned(v, 1); } }
    ]) + '</div>';
    document.getElementById('panel-combat').innerHTML = html;
    bindTips(document.getElementById('panel-combat'));
  }


  function phaseCellHtml(role, champ, phaseKey) {
    var d = killPhase(role, champ, phaseKey);
    if (!d) {
      return '<td class="phase-empty">—</td><td class="phase-empty">—</td><td class="phase-empty">—</td>';
    }
    return '<td>' + fmtDec(d.kill_death_event_diff_per_match, 3) + '</td>' +
      '<td>' + fmtSigned(d.bounty_net_per_match, 1) + '</td>' +
      '<td>' + fmtPct(d.kill_event_winrate, 1) + '</td>';
  }

  function phaseTableHtml(role, champA, champB) {
    return '<div class="phase-table-wrap"><table class="phase-table">' +
      '<thead><tr><th>Phase</th><th colspan="3">' + esc(champA) + '</th><th colspan="3">' + esc(champB) + '</th></tr>' +
      '<tr><th></th><th>Fight balance</th><th>Bounty balance</th><th>Wins after a kill</th><th>Fight balance</th><th>Bounty balance</th><th>Wins after a kill</th></tr></thead>' +
      '<tbody>' + PHASES.map(function (p) {
        return '<tr><td class="phase-name">' + esc(p.long) + '</td>' +
          phaseCellHtml(role, champA, p.key) + phaseCellHtml(role, champB, p.key) + '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  function kbSignalHtml(label, value, scale, formatter, caption, inverse) {
    var n = isNum(value) ? value : 0;
    var strength = Math.max(0, Math.min(100, Math.abs(n) / (scale || 1) * 100));
    var toneValue = inverse ? -n : n;
    var tone = toneFromSigned(toneValue, 0.0001);
    return '<article class="kb-signal ' + tone + '">' +
      '<div class="kb-signal-head"><span>' + esc(label) + '</span><strong>' + esc(formatter(n)) + '</strong></div>' +
      '<div class="kb-diverge" aria-hidden="true"><i class="left"></i><b></b><i class="right"></i><em class="' + tone + '" style="--kb-strength:' + strength.toFixed(1) + '%"></em></div>' +
      '<p>' + esc(caption) + '</p>' +
    '</article>';
  }

  function kbPairHtml(label, a, b, formatter, note, inverse) {
    var av = isNum(a) ? a : null;
    var bv = isNum(b) ? b : null;
    var max = Math.max(Math.abs(av || 0), Math.abs(bv || 0), 0.0001);
    var aw = av === null ? 0 : Math.max(3, Math.abs(av) / max * 100);
    var bw = bv === null ? 0 : Math.max(3, Math.abs(bv) / max * 100);
    var diff = av === null || bv === null ? null : (inverse ? bv - av : av - bv);
    var leader = !isNum(diff) || Math.abs(diff) < 0.0001 ? 'Balance' : (diff > 0 ? state.champA : state.champB);
    return '<article class="kb-pair">' +
      '<div class="kb-pair-title"><span>' + esc(label) + '</span><em>' + esc(leader) + '</em></div>' +
      '<div class="kb-pair-row a"><strong>' + esc(state.champA) + '</strong><div><i style="width:' + aw.toFixed(1) + '%"></i></div><b>' + esc(av === null ? '—' : formatter(av)) + '</b></div>' +
      '<div class="kb-pair-row b"><strong>' + esc(state.champB) + '</strong><div><i style="width:' + bw.toFixed(1) + '%"></i></div><b>' + esc(bv === null ? '—' : formatter(bv)) + '</b></div>' +
      '<p>' + esc(note) + '</p>' +
    '</article>';
  }

  function phaseTrendHtml(role, champA, champB, field, title, note, formatter) {
    var av = PHASES.map(function (phase) {
      var row = killPhase(role, champA, phase.key);
      return row && isNum(row[field]) ? row[field] : null;
    });
    var bv = PHASES.map(function (phase) {
      var row = killPhase(role, champB, phase.key);
      return row && isNum(row[field]) ? row[field] : null;
    });
    var nums = av.concat(bv).filter(isNum);
    if (!nums.length) return '<article class="kb-phase-chart"><h4>' + esc(title) + '</h4><div class="empty-note">Data unavailable.</div></article>';
    var maxAbs = Math.max.apply(null, nums.map(function (v) { return Math.abs(v); }).concat([0.001]));
    var w = 620, h = 230, left = 48, right = 24, top = 28, bottom = 48;
    var plotW = w - left - right, plotH = h - top - bottom, zeroY = top + plotH / 2;
    function point(v, i) {
      var x = left + (PHASES.length === 1 ? plotW / 2 : i * plotW / (PHASES.length - 1));
      var y = v === null ? zeroY : zeroY - (v / maxAbs) * (plotH * 0.44);
      return [x, y];
    }
    function path(values) {
      var chunks = [], open = false;
      values.forEach(function (v, i) {
        if (!isNum(v)) { open = false; return; }
        var p = point(v, i);
        chunks.push((open ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1));
        open = true;
      });
      return chunks.join(' ');
    }
    function dots(values, cls) {
      return values.map(function (v, i) {
        if (!isNum(v)) return '';
        var p = point(v, i);
        return '<circle class="' + cls + '" cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="5"><title>' + esc(PHASES[i].long + ': ' + formatter(v)) + '</title></circle>';
      }).join('');
    }
    var labels = PHASES.map(function (phase, i) {
      var p = point(0, i);
      return '<text x="' + p[0].toFixed(1) + '" y="' + (h - 15) + '" text-anchor="middle">' + esc(phase.label) + '</text>';
    }).join('');
    var valueCards = PHASES.map(function (phase, i) {
      return '<div><span>' + esc(phase.label) + '</span><b class="a">' + esc(isNum(av[i]) ? formatter(av[i]) : '—') + '</b><b class="b">' + esc(isNum(bv[i]) ? formatter(bv[i]) : '—') + '</b></div>';
    }).join('');
    return '<article class="kb-phase-chart"><div class="kb-chart-head"><div><h4>' + esc(title) + '</h4><p>' + esc(note) + '</p></div><div class="kb-legend"><span class="a">' + esc(champA) + '</span><span class="b">' + esc(champB) + '</span></div></div>' +
      '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + esc(title) + '">' +
        '<line class="grid" x1="' + left + '" y1="' + zeroY.toFixed(1) + '" x2="' + (w-right) + '" y2="' + zeroY.toFixed(1) + '"></line>' +
        '<path class="line-a" d="' + path(av) + '"></path><path class="line-b" d="' + path(bv) + '"></path>' +
        dots(av, 'dot-a') + dots(bv, 'dot-b') + labels +
      '</svg><div class="kb-phase-values">' + valueCards + '</div></article>';
  }

  function renderKillBounty(M) {
    var role = state.role, champA = state.champA, champB = state.champB;

    var kills15 = M.diffAB('avg_kill_diff_15m_a_minus_b');
    var deaths15 = M.diffAB('avg_death_diff_15m_a_minus_b');
    var bounty15 = M.diffAB('avg_bounty_net_diff_15m_a_minus_b');
    var kdPressure = M.diffAB('early_kd_pressure_15m_a_minus_b');
    var excessBounty = M.diffAB('excess_bounty_net_diff_15m_a_minus_b');
    var excessKd = M.diffAB('excess_early_kd_pressure_15m_a_minus_b');

    var pctKillAdv = M.pctA('pct_a_kill_adv_15m');
    var pctBountyAdv = M.pctA('pct_a_bounty_net_adv_15m');
    var firstKillA = M.pctA('pct_a_first_kill_in_pair');
    // In the dataset, “A first death” is equivalent to “B first kill”: it is not the complement.
    var firstKillB = M.pctA('pct_a_first_death_in_pair');

    var bNet15 = M.pair('avg_bounty_net_0_15m');
    var bPerKill = M.pair('avg_bounty_per_kill');
    var shutdownTake = M.pair('shutdown_collected_rate');
    var shutdownGive = M.pair('shutdown_given_rate');

    var pressureTone = toneFromSigned(kdPressure, 0.05);
    var pressureLeader = sideName(pressureTone);
    var headline = pressureTone === 'neutral'
      ? 'Fights in the first 15 minutes are essentially even.'
      : pressureLeader + ' tends to secure more favorable trades by 15 minutes.';
    var explanation = pressureTone === 'neutral'
      ? 'Kills, deaths, and bounties remain close: to find the real advantage, also examine gold, XP, level 6, turrets, and objectives.'
      : 'The metric considers kills secured, deaths suffered, and bounty gold together: fighting more does not automatically mean fighting better.';

    var html = '<div class="kb-layout">';
    html += '<section class="kb-hero ' + pressureTone + '"><div><div class="micro-label">Fight analysis</div><h3>' + esc(headline) + '</h3><p>' + esc(explanation) + '</p></div>' +
      '<div class="kb-hero-score"><span>Kill-death balance at 15 minutes</span><strong>' + esc(fmtSigned(kdPressure, 3)) + '</strong><em>' + esc(pressureTone === 'neutral' ? 'balance' : pressureLeader) + '</em></div></section>';

    html += '<section class="kb-signal-grid">' +
      kbSignalHtml('Kill difference at 15 minutes', kills15, 1.2, function (v) { return fmtSigned(v, 3); }, 'A positive value indicates more kills for the champion on the left.', false) +
      kbSignalHtml('Death difference at 15 minutes', deaths15, 1.2, function (v) { return fmtSigned(v, 3); }, 'A positive value indicates more deaths suffered by the champion on the left: in this case, it is a disadvantage.', true) +
      kbSignalHtml('Difference in bounty balance at 15 minutes', bounty15, 260, function (v) { return fmtSigned(v, 1); }, 'Extra gold gained through kills and bounties, minus the amount given up by dying.', false) +
      kbSignalHtml('Matchup-attributable kill-death balance', excessKd, 0.8, function (v) { return fmtSigned(v, 3); }, 'Shows how this specific opponent changes fight outcomes relative to the two champions\' usual performance.', false) +
    '</section>';

    html += '<section class="kb-card-grid">';
    html += '<article class="kb-card"><div class="card-head"><h3>Who starts the duel</h3><span class="card-sub">The first kill in the pair; outcomes with no kill are excluded from both shares.</span></div>' +
      kbPairHtml('First kill in the pair', firstKillA, firstKillB, function (v) { return fmtPct(v, 1); }, 'Direct comparison of the two champions\' first-kill shares.', false) +
      '<div class="kb-prob-grid"><div><span>' + esc(champA) + ' has more kills at 15 minutes</span><strong>' + fmtPct(pctKillAdv, 1) + '</strong><i style="--p:' + (clamp01(pctKillAdv)*100).toFixed(1) + '%"></i></div>' +
      '<div><span>' + esc(champA) + ' has a better bounty balance at 15 minutes</span><strong>' + fmtPct(pctBountyAdv, 1) + '</strong><i style="--p:' + (clamp01(pctBountyAdv)*100).toFixed(1) + '%"></i></div></div></article>';

    html += '<article class="kb-card"><div class="card-head"><h3>How valuable kills are and how much gold can be given back</h3><span class="card-sub">Compares gold gained from takedowns with the risk of giving up a large amount through a single death.</span></div>' +
      '<div class="kb-pair-stack">' +
        kbPairHtml('Bounty balance in the first 15 minutes', bNet15[0], bNet15[1], function (v) { return fmtSigned(v, 1); }, 'Extra gold gained through takedowns, minus the amount given up by dying.', false) +
        kbPairHtml('Average gold gained per kill', bPerKill[0], bPerKill[1], function (v) { return fmtDec(v, 1); }, 'How much gold, on average, accompanies each takedown.', false) +
        kbPairHtml('Major bounties collected', shutdownTake[0], shutdownTake[1], function (v) { return fmtPct(v, 1); }, 'How often the champion manages to eliminate an opponent carrying a major bounty.', false) +
        kbPairHtml('Major bounties given up', shutdownGive[0], shutdownGive[1], function (v) { return fmtPct(v, 1); }, 'Lower means less risk of giving up a large amount of gold through a single death.', true) +
      '</div></article>';
    html += '</section>';

    html += '<section class="kb-phase-grid">' +
      phaseTrendHtml(role, champA, champB, 'kill_death_event_diff_per_match', 'Kill-death balance across phases', 'Kills secured minus deaths suffered in each phase: above zero favors that champion.', function (v) { return fmtSigned(v, 2); }) +
      phaseTrendHtml(role, champA, champB, 'bounty_net_per_match', 'Bounty balance across phases', 'Bounty gold gained minus the amount given up in the early, mid, and late game.', function (v) { return fmtSigned(v, 0); }) +
    '</section>';

    if (isNum(excessBounty)) {
      html += '<section class="kb-explainer"><div><span>Effect specific to this opponent</span><strong>' + esc(fmtSigned(excessBounty, 1)) + ' bounty gold</strong></div><p>This value separates the opponent\'s effect from the two champions\' usual tendencies and shows how much the matchup truly changes the gold gained through fights.</p></section>';
    }

    html += '</div>';
    document.getElementById('panel-kill').innerHTML = html;
    bindTips(document.getElementById('panel-kill'));
  }

  function renderObjectives(M) {
    var role = state.role, champA = state.champA, champB = state.champB;
    var html = '<div class="panel-grid">';
    var any = false;

    if (role === 'JUNGLE') {
      OBJECTIVES.forEach(function (o) {
        var pct = M.pctA('pct_champion_a_first_' + o.key);
        if (!isNum(pct)) return;
        any = true;
        html += objectiveDonutCard(o.label, null, pct, champA, champB, esc(champA) + ' first');
      });

      var seqAvg = M.pctA('monster_sequence_control_avg_a');
      var seqScore = M.diffAB('monster_sequence_control_score_a');
      var seqDiff = M.diffAB('monster_sequence_diff_total_a_minus_b');
      var objConv = M.diffAB('objective_conversion_score_a');

      if (isNum(seqAvg) || isNum(seqScore) || isNum(seqDiff) || isNum(objConv)) {
        any = true;
        html += '<div class="card full-span"><div class="card-head"><h3>Objective control over time</h3><span class="card-sub">It considers not only the first dragon or Rift Herald, but the entire sequence of available neutral objectives.</span></div>' +
          '<div class="stat-grid">' +
          '<div class="stat-card"><div class="label">Average control of ' + esc(champA) + '</div><div class="value a">' + fmtPct(seqAvg, 1) + '</div></div>' +
          '<div class="stat-card"><div class="label">Overall sequence control</div><div class="value">' + fmtSigned(seqScore, 4) + '</div><div class="sub">a positive value favors ' + esc(champA) + '</div></div>' +
          '<div class="stat-card"><div class="label">Average monster difference</div><div class="value">' + fmtSigned(seqDiff, 3) + '</div></div>' +
          '<div class="stat-card"><div class="label">Conversion of pressure into objectives</div><div class="value">' + fmtSigned(objConv, 4) + '</div></div>' +
          '</div></div>';
      }

      var monsterPctRows = dataColumnsStarting('pct_a_secures_monster_').filter(function (col) {
        return col.toLowerCase().indexOf('atak') === -1 && isNum(M.pctA(col));
      }).map(function (col) {
        return { label: humanMonsterLabel(col), value: M.pctA(col), scale: 1, format: function (v) { return fmtPct(v, 1); } };
      }).slice(0, 12);

      var monsterDiffRows = dataColumnsStarting('avg_monster_kill_diff_a_minus_b_').filter(function (col) {
        return col.toLowerCase().indexOf('atak') === -1 && isNum(M.diffAB(col));
      }).map(function (col) {
        return { label: humanMonsterLabel(col), value: M.diffAB(col), scale: 1.2, format: function (v) { return fmtSigned(v, 3); } };
      }).slice(0, 12);

      if (monsterPctRows.length || monsterDiffRows.length) {
        any = true;
        html += '<div class="card"><div class="card-head"><h3>Control of different monsters</h3><span class="card-sub">Shows which champion secures each type of neutral objective more often.</span></div>' + miniBarsHtml(monsterPctRows) + '</div>';
        html += '<div class="card"><div class="card-head"><h3>Difference in the number of monsters secured</h3><span class="card-sub">Compares how many objectives of each type the two champions secure on average.</span></div>' + miniBarsHtml(monsterDiffRows) + '</div>';
      }
    } else if (role === 'TOP' || role === 'MIDDLE' || role === 'BOTTOM') {
      var towerPct = M.pctA('pct_champion_a_wins_tower_race');
      var towerFallDiff = M.diffAB('avg_tower_fall_diff_min_a_minus_b');
      if (isNum(towerPct)) {
        any = true;
        html += objectiveDonutCard('Race to first turret', null, towerPct, champA, champB, esc(champA) + ' takes it first');
        html += '<div class="card"><div class="card-head"><h3>Turret timing</h3><span class="card-sub">Average difference in the takedown time of the first lane turret.</span></div>' + miniBarsHtml([{ label: 'Tower difference', value: towerFallDiff, scale: 4, format: function (v) { return fmtSigned(v, 2, ' min'); } }]) + '</div>';
      }
    }

    if (!any) html += '<div class="empty-note full-span">No objective/turret data is available for this specific matchup. The section remains empty because it does not invent metrics when the dataset does not contain them.</div>';
    html += '</div>';
    document.getElementById('panel-objectives').innerHTML = html;
  }



  function syncTopbarHeight() {
    var topbar = document.querySelector('.topbar');
    if (!topbar) return;
    var apply = function () {
      var h = Math.ceil(topbar.getBoundingClientRect().height || 72);
      document.documentElement.style.setProperty('--topbar-height', h + 'px');
    };
    apply();
    window.addEventListener('resize', apply, { passive: true });
    if (window.ResizeObserver) new ResizeObserver(apply).observe(topbar);
  }

  function init() {
    syncTopbarHeight();
    populateRolePills();
    renderGlossary();
    renderFooterStats();

    var params = new URLSearchParams(window.location.search);
    var requestedRole = String(params.get('role') || '').toUpperCase();
    var startRole = (Array.isArray(DATA.meta.roles) && DATA.meta.roles[0]) || ROLE_ORDER[0];
    if (DATA.meta.roles.indexOf(requestedRole) !== -1) startRole = requestedRole;
    setRole(startRole);

    // Deep link used by Rankings Lab: opens the requested champion or
    // matchup directly without changing the page's normal behavior.
    var requestedA = params.get('a');
    var requestedB = params.get('b');
    var available = DATA.meta.roles_champions[startRole] || [];
    if (requestedA && available.indexOf(requestedA) !== -1) {
      state.champA = requestedA;
      comboA.setValue(requestedA);
      comboB.setOptions(opponentOptionsFor(startRole, requestedA));
      comboB.setEnabled(true, 'Search for the opponent…');
      if (requestedB && available.indexOf(requestedB) !== -1 && getMatchup(startRole, requestedA, requestedB)) {
        state.champB = requestedB;
        comboB.setValue(requestedB);
      }
      render();
    }
    setDataStatus('ready', 'Dataset pronto');
  }

  init();
})();