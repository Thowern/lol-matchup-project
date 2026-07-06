/* ==========================================================================
   MATCHUP LAB — app.js
   Logica dell'applicazione. Nessuna dipendenza esterna: i grafici sono
   disegnati a mano in SVG/CSS per il pieno controllo visivo.

   Nota sulla "prospettiva": nel dataset ogni coppia di campioni esiste una
   sola volta, con un'etichetta fissa champion_a / champion_b (non esiste la
   riga inversa). Quando l'utente sceglie i due campioni in un ordine
   qualsiasi, normalizeMatchup() risolve quale dei due e' "a" e quale "b"
   nella riga trovata e restituisce degli helper (pair/diffAB/pctA/arrAB)
   che parlano sempre in termini di "sinistra" (slot A scelto dall'utente,
   colore teal) e "destra" (slot B, colore ambra) — mai in termini di a/b
   di archivio. Questo evita di mostrare per errore le statistiche scambiate
   quando l'utente inverte l'ordine di selezione.
   ========================================================================== */
(function () {
  'use strict';

  var DATA = window.MATCHUP_APP_DATA;
  var COLS = {};
  DATA.matchupColumns.forEach(function (c, i) { COLS[c] = i; });

  var ROLE_LABELS = { TOP: 'Top', JUNGLE: 'Jungle', MIDDLE: 'Mid', BOTTOM: 'ADC', UTILITY: 'Support' };
  var ROLE_LONG = {
    TOP: 'Corsia Top', JUNGLE: 'Boscaglia', MIDDLE: 'Corsia di Mezzo',
    BOTTOM: 'Corsia Bassa (ADC)', UTILITY: 'Supporto'
  };
  var ROLE_ORDER = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];

  var OBJECTIVES = [
    { key: 'dragon', label: 'Primo Drago' },
    { key: 'baron_nashor', label: 'Primo Barone Nashor' },
    { key: 'riftherald', label: 'Primo Araldo' },
    { key: 'horde', label: 'Primo Sciame del Vuoto' },
  ];

  var state = { role: null, champA: null, champB: null, trajMode: 'gold' };

  /* ------------------------------------------------------------------ *
   * Formattazione
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

  function confidence(n) {
    if (n >= DATA.meta.min_matches_solid) return { level: 'high', label: 'Campione solido' };
    if (n >= DATA.meta.min_matches_confident) return { level: 'mid', label: 'Campione adeguato' };
    return { level: 'low', label: 'Campione ridotto' };
  }

  function magnitudeWord(ppAbs) {
    if (ppAbs < 2) return 'un vantaggio marginale';
    if (ppAbs < 6) return 'un vantaggio moderato';
    return 'un vantaggio netto';
  }

  /* ------------------------------------------------------------------ *
   * Lookup dati grezzi
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

  /* Normalizza la riga trovata in termini di sinistra (champA scelto
   * dall'utente) / destra (champB), qualunque sia l'ordine di archivio. */
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
      return leftIsA ? v : 1 - v;
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
   * Tooltip globale
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

  /* ------------------------------------------------------------------ *
   * Combobox di ricerca campioni
   * ------------------------------------------------------------------ */
  function createCombobox(rootEl, opts) {
    var input = rootEl.querySelector('input');
    var list = rootEl.querySelector('.combobox-list');
    var options = [];
    var activeIndex = -1;

    function setOptions(newOptions) {
      options = newOptions;
    }

    function renderList(filterText) {
      var q = (filterText || '').trim().toLowerCase();
      var filtered = options.filter(function (o) {
        return o.label.toLowerCase().indexOf(q) !== -1;
      });
      if (!filtered.length) {
        list.innerHTML = '<div class="combobox-empty">Nessun campione trovato.</div>';
      } else {
        list.innerHTML = filtered.map(function (o, i) {
          var cls = 'combobox-option' + (o.low ? ' low' : '') + (i === activeIndex ? ' active' : '');
          var meta = o.meta !== undefined ? '<span class="n">' + esc(o.meta) + '</span>' : '';
          return '<div class="' + cls + '" role="option" data-value="' + esc(o.value) + '">' +
            '<span>' + esc(o.label) + '</span>' + meta + '</div>';
        }).join('');
      }
      list._filtered = filtered;
      list.classList.add('open');
      input.setAttribute('aria-expanded', 'true');
    }

    function close() {
      list.classList.remove('open');
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
      var v = opt.getAttribute('data-value');
      var found = options.find(function (o) { return o.value === v; });
      input.value = found ? found.label : v;
      close();
      opts.onSelect(v);
    });
    document.addEventListener('click', function (e) {
      if (!rootEl.contains(e.target)) close();
    });

    return {
      setOptions: setOptions,
      setValue: function (label) { input.value = label || ''; },
      setEnabled: function (enabled, placeholder) {
        input.disabled = !enabled;
        if (placeholder) input.placeholder = placeholder;
        if (!enabled) { input.value = ''; close(); }
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
   * Ruoli, selezione campioni, scorciatoie
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
      return { value: row[0], label: row[0], meta: fmtInt(row[1]) + ' partite', low: row[2] };
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
    document.querySelectorAll('.role-pill').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-role') === role);
    });
    comboA.setOptions(championOptionsFor(role));
    comboB.setOptions([]);
    comboB.setEnabled(false, 'Scegli prima il campione A');

    var top = DATA.meta.top_matchups_by_role[role] && DATA.meta.top_matchups_by_role[role][0];
    renderChips(role);
    if (top) {
      applySelection(top.a, top.b);
    } else {
      state.champA = null; state.champB = null;
      comboA.clear();
      render();
    }
  }

  function applySelection(a, b) {
    state.champA = a; state.champB = b;
    comboA.setValue(a);
    comboB.setOptions(opponentOptionsFor(state.role, a));
    comboB.setEnabled(true, 'Cerca l\'avversario…');
    comboB.setValue(b);
    render();
  }

  function selectChampion(slot, name) {
    if (slot === 'A') {
      state.champA = name;
      state.champB = null;
      comboB.setOptions(opponentOptionsFor(state.role, name));
      comboB.setEnabled(true, 'Cerca l\'avversario…');
      comboB.clear();
      render();
    } else {
      state.champB = name;
      render();
    }
  }

  document.getElementById('swapBtn').addEventListener('click', function () {
    if (!state.champA || !state.champB) return;
    var a = state.champA, b = state.champB;
    // Ricostruiamo le opzioni di B in base al nuovo campione A per coerenza,
    // poi applichiamo lo scambio: e' un cambio di etichetta sinistra/destra,
    // i dati verranno ri-normalizzati automaticamente da normalizeMatchup().
    state.champA = b; state.champB = a;
    comboA.setValue(b);
    comboB.setOptions(opponentOptionsFor(state.role, b));
    comboB.setEnabled(true);
    comboB.setValue(a);
    render();
  });

  function renderChips(role) {
    var top = DATA.meta.top_matchups_by_role[role] || [];
    var wrap = document.getElementById('chipsRow');
    wrap.innerHTML = top.slice(0, 8).map(function (m) {
      return '<button class="chip" data-a="' + esc(m.a) + '" data-b="' + esc(m.b) + '">' +
        esc(m.a) + ' — ' + esc(m.b) + ' <span class="n">' + fmtInt(m.n) + '</span></button>';
    }).join('');
    wrap.querySelectorAll('.chip').forEach(function (btn) {
      btn.addEventListener('click', function () {
        applySelection(btn.getAttribute('data-a'), btn.getAttribute('data-b'));
      });
    });
  }

  /* ------------------------------------------------------------------ *
   * Render principale
   * ------------------------------------------------------------------ */
  function render() {
    var emptyEl = document.getElementById('emptyState');
    var dossierEl = document.getElementById('dossier');

    if (!state.champA || !state.champB) {
      dossierEl.hidden = true;
      emptyEl.hidden = false;
      emptyEl.innerHTML = '<h3>Seleziona due campioni</h3><p>Scegli un ruolo e due campioni per aprire il dossier completo del matchup.</p>';
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
      emptyEl.innerHTML = '<h3>Nessuna partita registrata</h3>' +
        '<p>Non ci sono dati per <strong>' + esc(state.champA) + '</strong> contro <strong>' + esc(state.champB) + '</strong> nel ruolo ' + ROLE_LABELS[state.role] + '.' +
        (opts.length ? ' Avversari disponibili per ' + esc(state.champA) + ':' : '') + '</p>' +
        '<div class="suggestions">' + sugg + '</div>';
      emptyEl.querySelectorAll('.chip[data-b]').forEach(function (btn) {
        btn.addEventListener('click', function () { selectChampion('B', btn.getAttribute('data-b')); });
      });
      return;
    }

    emptyEl.hidden = true;
    dossierEl.hidden = false;

    var M = normalizeMatchup(rec, state.champA);
    renderVerdict(M);
    renderOverview(M);
    renderTrajectory(M);
    renderCombat(M);
    renderEconomy(M);
    renderObjectives(M);
    renderRaw(M);
  }

  /* ------------------------------------------------------------------ *
   * Verdetto (fascia in alto, sempre visibile)
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

    var sentence = '<strong>' + esc(favoredName) + '</strong> vince questo matchup nel ' + fmtPct(favoredWr, 1) + ' delle partite';
    if (isNum(favoredDiff) && Math.abs(favoredDiff) >= 0.005) {
      sentence += ', ' + magnitudeWord(Math.abs(favoredDiff * 100)) + ' (' + fmtSignedPct(favoredDiff, 1) + ') rispetto al suo winrate medio da ' + ROLE_LABELS[role] + '.';
    } else {
      sentence += ', in linea con il suo winrate medio da ' + ROLE_LABELS[role] + '.';
    }
    if (conf.level === 'low') {
      sentence += ' Il campione è ridotto (' + fmtInt(n) + ' partite): trattare come indicazione, non come certezza statistica.';
    }

    var html = '';
    html += '<div class="verdict-top">';
    html += '<div><div class="matchup-title"><span class="name-a">' + esc(champA) + '</span><span class="vs-x">vs</span><span class="name-b">' + esc(champB) + '</span></div>';
    html += '<div class="role-tag">' + ROLE_LONG[role] + '</div></div>';
    html += '<div class="sample-badge ' + conf.level + '"><span class="dot"></span>' + conf.label + ' — ' + fmtInt(n) + ' partite</div>';
    html += '</div>';

    html += '<div class="winrate-bar"><div class="tick50"></div>' +
      '<div class="fill-a" style="width:' + (wr[0] * 100) + '%">' + fmtPct(wr[0], 1) + '</div>' +
      '<div class="fill-b" style="width:' + (wr[1] * 100) + '%">' + fmtPct(wr[1], 1) + '</div></div>';

    html += '<div class="verdict-foot">';
    html += '<div class="verdict-col a"><div class="champ-name">' + esc(champA) + '</div>' +
      '<div class="row"><span>Winrate in questo matchup</span><span class="v">' + fmtPct(wr[0], 1) + '</span></div>' +
      '<div class="row"><span>Winrate generale da ' + ROLE_LABELS[role] + '</span><span class="v">' + fmtPct(genWr[0], 1) + '</span></div>' +
      '<div class="row"><span>Scarto</span><span class="v">' + fmtSignedPct(diffWr[0], 1) + '</span></div></div>';
    html += '<div class="verdict-col b"><div class="champ-name">' + esc(champB) + '</div>' +
      '<div class="row"><span>Winrate in questo matchup</span><span class="v">' + fmtPct(wr[1], 1) + '</span></div>' +
      '<div class="row"><span>Winrate generale da ' + ROLE_LABELS[role] + '</span><span class="v">' + fmtPct(genWr[1], 1) + '</span></div>' +
      '<div class="row"><span>Scarto</span><span class="v">' + fmtSignedPct(diffWr[1], 1) + '</span></div></div>';
    html += '</div>';

    html += '<div class="verdict-sentence">' + sentence + '</div>';

    document.getElementById('verdictBand').innerHTML = html;
  }

  /* ------------------------------------------------------------------ *
   * Panoramica: profilo dei due campioni con percentile di ruolo
   * ------------------------------------------------------------------ */
  var OVERVIEW_FIELDS = [
    { key: 'general_winrate', label: 'Winrate generale nel ruolo', fmt: function (v) { return fmtPct(v, 1); } },
    { key: 'avg_damage_to_champs', label: 'Danno medio ai campioni', fmt: function (v) { return fmtInt(v); } },
    { key: 'avg_damage_taken', label: 'Danno medio subito', fmt: function (v) { return fmtInt(v); } },
    { key: 'vision_score', label: 'Vision score medio', fmt: function (v) { return fmtDec(v, 1); } },
    { key: 'avg_total_time_cc_dealt', label: 'CC totale generato', fmt: function (v) { return fmtDec(v, 1) + 's'; } },
    { key: 'avg_level6_minute', label: 'Minuto medio del livello 6', fmt: function (v) { return fmtDec(v, 2) + ' min'; } },
    { key: 'goldxp_auc', label: 'Potere predittivo del vantaggio economico', fmt: function (v) { return fmtDec(v, 3); } }
  ];

  function renderOverview(M) {
    var role = state.role, champA = state.champA, champB = state.champB;
    var profiles = DATA.championProfiles[role] || {};
    var pa = profiles[champA] || {}, pb = profiles[champB] || {};

    var rows = OVERVIEW_FIELDS.map(function (f) {
      var va = pa[f.key], vb = pb[f.key];
      var pca = pa.percentiles ? pa.percentiles[f.key] : null;
      var pcb = pb.percentiles ? pb.percentiles[f.key] : null;
      var markerA = isNum(pca) ? '<div class="pct-marker a" style="left:' + pca + '%" data-tip="<div class=\'tt-title\'>' + esc(champA) + '</div>' + esc(f.label) + ': ' + esc(f.fmt(va)) + ' — ' + fmtDec(pca, 0) + '° percentile nel ruolo"></div>' : '';
      var markerB = isNum(pcb) ? '<div class="pct-marker b" style="left:' + pcb + '%" data-tip="<div class=\'tt-title\'>' + esc(champB) + '</div>' + esc(f.label) + ': ' + esc(f.fmt(vb)) + ' — ' + fmtDec(pcb, 0) + '° percentile nel ruolo"></div>' : '';
      return '<div class="pct-row">' +
        '<div class="pct-row-head"><span class="stat-label">' + f.label + ' <span class="info-icon" tabindex="0" data-tip="Posizione rispetto a tutti i campioni ' + ROLE_LABELS[role] + ' del dataset. 50° percentile = nella media del ruolo.">i</span></span></div>' +
        '<div class="pct-track">' + markerA + markerB + '</div>' +
        '<div class="pct-vals"><span class="va">' + esc(champA) + ': ' + f.fmt(va) + (isNum(pca) ? ' (p' + fmtDec(pca, 0) + ')' : '') + '</span>' +
        '<span class="vb">' + esc(champB) + ': ' + f.fmt(vb) + (isNum(pcb) ? ' (p' + fmtDec(pcb, 0) + ')' : '') + '</span></div>' +
        '</div>';
    }).join('');

    var covA = pa.coverage || { n_matchups: 0, total_games: 0 };
    var covB = pb.coverage || { n_matchups: 0, total_games: 0 };

    var html = '<div class="panel-grid">';
    html += '<div class="card full-span"><div class="card-head"><h3>Profilo dei due campioni nel ruolo</h3>' +
      '<span class="card-sub">Percentile calcolato su ' + (DATA.meta.roles_champions[role] || []).length + ' campioni ' + ROLE_LABELS[role] + '</span></div>' + rows + '</div>';

    html += '<div class="card"><div class="card-head"><h3>' + esc(champA) + '</h3></div>' +
      '<div class="stat-grid">' +
      '<div class="stat-card"><div class="label">Matchup registrati</div><div class="value a">' + fmtInt(covA.n_matchups) + '</div></div>' +
      '<div class="stat-card"><div class="label">Partite totali (ruolo)</div><div class="value a">' + fmtInt(covA.total_games) + '</div></div>' +
      '</div></div>';
    html += '<div class="card"><div class="card-head"><h3>' + esc(champB) + '</h3></div>' +
      '<div class="stat-grid">' +
      '<div class="stat-card"><div class="label">Matchup registrati</div><div class="value b">' + fmtInt(covB.n_matchups) + '</div></div>' +
      '<div class="stat-card"><div class="label">Partite totali (ruolo)</div><div class="value b">' + fmtInt(covB.total_games) + '</div></div>' +
      '</div></div>';
    html += '</div>';

    document.getElementById('panel-overview').innerHTML = html;
  }

  /* ------------------------------------------------------------------ *
   * Grafico "fiume": area speculare intorno allo zero, disegnata a mano
   * in SVG per un controllo totale su forma, colore e interazione.
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
      var body = fmtSigned(nearest.v, 0, unitLabel) + (leader ? ' a favore di ' + esc(leader) : ' — in pareggio');
      showTip(screenX, screenY, '<div class="tt-title">Minuto ' + Math.round(nearest.m) + '</div>' + body);
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
    } catch (err) { /* getTotalLength puo' fallire se il path e' vuoto: ignoriamo */ }
  }

  /* ------------------------------------------------------------------ *
   * Andamento partita
   * ------------------------------------------------------------------ */
  var TRAJ_MODES = {
    gold: {
      col: 'gold_diff_by_minute', label: 'Oro', unit: ' oro',
      explain: function (a, b) { return 'Differenza di oro accumulato tra ' + a + ' e ' + b + ', minuto per minuto.'; }
    },
    xp: {
      col: 'xp_diff_by_minute', label: 'XP', unit: ' xp',
      explain: function (a, b) { return 'Differenza di esperienza accumulata tra ' + a + ' e ' + b + ', minuto per minuto.'; }
    },
    excessGold: {
      col: 'excess_gold_diff_by_minute', label: 'Oro in eccesso', unit: ' oro',
      explain: function (a, b) { return 'Vantaggio in oro imputabile allo scontro specifico tra ' + a + ' e ' + b + ', al netto di quanto atteso dalla forza individuale dei due campioni nel ruolo.'; }
    },
    excessXp: {
      col: 'excess_xp_diff_by_minute', label: 'XP in eccesso', unit: ' xp',
      explain: function (a, b) { return 'Vantaggio in esperienza imputabile allo scontro specifico tra ' + a + ' e ' + b + ', al netto di quanto atteso dalla forza individuale dei due campioni nel ruolo.'; }
    }
  };

  function renderTrajectory(M) {
    var role = state.role, champA = state.champA, champB = state.champB;

    var html = '<div class="card full-span">';
    html += '<div class="card-head"><h3>Andamento della partita</h3>' +
      '<span class="card-sub">Positivo = vantaggio di <span style="color:var(--champ-a)">' + esc(champA) + '</span> · Negativo = vantaggio di <span style="color:var(--champ-b)">' + esc(champB) + '</span></span></div>';
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
      '<div class="card-head"><h3>Timing del livello 6</h3><span class="info-icon" tabindex="0" data-tip="Minuto medio in cui il campione raggiunge il livello 6, calcolato sulle partite complessive nel ruolo (non solo su questo matchup).">i</span></div>';
    if (isNum(l6a) || isNum(l6b)) {
      var maxAx = Math.max(12, (l6a || 0) + 1, (l6b || 0) + 1);
      html += '<div class="axis-mini"><div class="line"></div>';
      if (isNum(l6a)) html += '<div class="pt a" style="left:' + (l6a / maxAx * 100) + '%"><div class="dot"></div><div class="lbl">' + esc(champA) + ' · ' + fmtDec(l6a, 2) + '\'</div></div>';
      if (isNum(l6b)) html += '<div class="pt b" style="left:' + (l6b / maxAx * 100) + '%"><div class="dot"></div><div class="lbl">' + esc(champB) + ' · ' + fmtDec(l6b, 2) + '\'</div></div>';
      html += '</div>';
    } else {
      html += '<div class="empty-note">Dato non disponibile per almeno uno dei due campioni.</div>';
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
      wrap.innerHTML = '<div class="empty-note">Dati insufficienti per calcolare questa serie su questo matchup.</div>';
      return;
    }
    var minutes = arr.map(function (_, i) { return i; });
    var chart = buildRiverSVG(minutes, arr);
    if (!chart) { wrap.innerHTML = '<div class="empty-note">Dati insufficienti.</div>'; return; }
    wrap.innerHTML = chart.svg;
    var svgEl = wrap.querySelector('svg');
    attachRiverInteractivity(wrap, chart, mode.unit);
    animateTrace(svgEl);
  }

  /* ------------------------------------------------------------------ *
   * Componenti di confronto riutilizzabili
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
      { v: physV, color: 'var(--dmg-phys)', label: 'Fisico' },
      { v: magicV, color: 'var(--dmg-magic)', label: 'Magico' },
      { v: trueV, color: 'var(--dmg-true)', label: 'Puro' }
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
   * Combattimento
   * ------------------------------------------------------------------ */
  function renderCombat(M) {
    var champA = state.champA, champB = state.champB;
    var phys = M.pair('pct_physical_dmg'), magic = M.pair('pct_magic_dmg'), truep = M.pair('pct_true_dmg');
    var dealt = M.pair('avg_damage_to_champs'), taken = M.pair('avg_damage_taken');
    var ccOthers = M.pair('avg_time_ccing_others'), ccTotal = M.pair('avg_total_time_cc_dealt');
    var vision = M.pair('vision_score');
    var visionDiff = M.diffAB('vision_diff_a_minus_b');

    var html = '<div class="panel-grid">';

    html += '<div class="card"><div class="card-head"><h3>Composizione del danno</h3></div>' +
      damageStackRow('a', champA, phys[0], magic[0], truep[0]) +
      damageStackRow('b', champB, phys[1], magic[1], truep[1]) +
      '<div class="dmg-legend"><span><i style="background:var(--dmg-phys)"></i>Fisico</span><span><i style="background:var(--dmg-magic)"></i>Magico</span><span><i style="background:var(--dmg-true)"></i>Puro</span></div>' +
      '</div>';

    var maxDmg = (Math.max(dealt[0] || 0, dealt[1] || 0, taken[0] || 0, taken[1] || 0) * 1.15) || 1;
    html += '<div class="card"><div class="card-head"><h3>Danno inflitto e subito</h3></div>' +
      compareBarRow('Danno medio ai campioni', null, dealt[0], dealt[1], champA, champB, 0, '', maxDmg) +
      compareBarRow('Danno medio subito', null, taken[0], taken[1], champA, champB, 0, '', maxDmg) +
      '</div>';

    var ccTip = "Secondi medi in cui il campione tiene sotto controllo i nemici (stordimento, rallentamento, immobilizzazione e simili) nel corso della partita.";
    var ccTotalTip = "Somma complessiva del tempo di controllo generato dal campione su tutti i nemici nel corso della partita.";
    html += '<div class="card"><div class="card-head"><h3>Controllo (CC)</h3></div>' +
      compareBarRow('Tempo medio di CC sui nemici', ccTip, ccOthers[0], ccOthers[1], champA, champB, 1, 's') +
      compareBarRow('Tempo totale di CC generato', ccTotalTip, ccTotal[0], ccTotal[1], champA, champB, 1, 's') +
      '</div>';

    html += '<div class="card"><div class="card-head"><h3>Visione</h3></div>' +
      compareBarRow('Vision score medio', null, vision[0], vision[1], champA, champB, 1, '') +
      '<div class="stat-grid" style="margin-top:14px;"><div class="stat-card"><div class="label">Differenza (' + esc(champA) + ' meno ' + esc(champB) + ')</div><div class="value">' + fmtSigned(visionDiff, 1) + '</div></div></div>' +
      '</div>';

    html += '</div>';
    document.getElementById('panel-combat').innerHTML = html;
  }

  /* ------------------------------------------------------------------ *
   * Oro, XP e Snowball
   * ------------------------------------------------------------------ */
  function renderEconomy(M) {
    var champA = state.champA, champB = state.champB;
    var wpg = M.pair('goldxp_winpct_per_1k_gold'), wpx = M.pair('goldxp_winpct_per_1k_xp');
    var auc = M.pair('goldxp_auc'), nGX = M.pair('goldxp_n_matches');
    var depGold = M.diffAB('goldxp_gold_dependency_diff_a_minus_b');
    var depXp = M.diffAB('goldxp_xp_dependency_diff_a_minus_b');

    var html = '<div class="panel-grid">';

    if (isNum(wpg[0]) || isNum(wpg[1])) {
      var depTip = "Incremento di probabilita di vittoria, in punti percentuali, per ogni 1000 oro (o 1000 esperienza) di vantaggio accumulato entro il 15° minuto.";
      html += '<div class="card"><div class="card-head"><h3>Dipendenza dal vantaggio economico</h3>' +
        '<span class="info-icon" tabindex="0" data-tip="' + esc(depTip) + '">i</span></div>' +
        compareBarRow('Winrate per 1000 oro di vantaggio', null, wpg[0], wpg[1], champA, champB, 2, ' pp') +
        compareBarRow('Winrate per 1000 XP di vantaggio', null, wpx[0], wpx[1], champA, champB, 2, ' pp') +
        '</div>';
    } else {
      html += '<div class="card"><div class="card-head"><h3>Dipendenza dal vantaggio economico</h3></div>' +
        '<div class="empty-note">Dati non disponibili per almeno uno dei due campioni in questo ruolo.</div></div>';
    }

    if (isNum(auc[0]) || isNum(auc[1])) {
      var aucTip = "Quanto il vantaggio economico al 15° minuto predice la vittoria finale. 0,50 significa nessun potere predittivo; valori vicini a 1 indicano un campione la cui vittoria dipende quasi sempre dal vantaggio economico.";
      html += '<div class="card"><div class="card-head"><h3>Potere predittivo del vantaggio (AUC)</h3>' +
        '<span class="info-icon" tabindex="0" data-tip="' + esc(aucTip) + '">i</span></div>' +
        compareBarRow('AUC oro/XP verso vittoria', null, auc[0], auc[1], champA, champB, 3, '', 1) +
        '<div class="card-sub" style="margin-top:10px;">Campione: ' + fmtInt(nGX[0]) + ' partite (' + esc(champA) + ') · ' + fmtInt(nGX[1]) + ' partite (' + esc(champB) + ')</div>' +
        '</div>';
    }

    if (isNum(depGold) || isNum(depXp)) {
      var leaderGold = isNum(depGold) ? (depGold >= 0 ? champA : champB) : null;
      var leaderXp = isNum(depXp) ? (depXp >= 0 ? champA : champB) : null;
      html += '<div class="card full-span"><div class="card-head"><h3>Chi capitalizza di più in questo matchup</h3></div>' +
        '<div class="stat-grid">' +
        '<div class="stat-card"><div class="label">Differenziale dipendenza oro</div><div class="value">' + fmtSigned(depGold, 2, ' pp') + '</div><div class="sub">' + (leaderGold ? 'A favore di ' + esc(leaderGold) : '—') + '</div></div>' +
        '<div class="stat-card"><div class="label">Differenziale dipendenza XP</div><div class="value">' + fmtSigned(depXp, 2, ' pp') + '</div><div class="sub">' + (leaderXp ? 'A favore di ' + esc(leaderXp) : '—') + '</div></div>' +
        '</div></div>';
    }

    var pctAhead = M.pctA('pct_a_ahead_15m');
    var corr = M.direct('snowball_corr_15m');
    var std = M.direct('gold_diff_std_15m');
    var sb = M.snowballPerspective();

    html += '<div class="card full-span"><div class="card-head"><h3>Snowball al 15° minuto</h3>' +
      '<span class="info-icon" tabindex="0" data-tip="Metriche calcolate solo sui matchup con un campione sufficientemente ampio: misurano quanto un vantaggio in oro al 15° minuto si traduce poi in vittoria.">i</span></div>';

    if (isNum(pctAhead) && sb) {
      var pctBehind = 1 - pctAhead;
      var deg = pctAhead * 360;
      html += '<div class="donut-wrap">' +
        '<div class="donut" style="background:conic-gradient(var(--champ-a) 0deg ' + deg + 'deg, var(--champ-b) ' + deg + 'deg 360deg)">' +
        '<div class="donut-center"><div class="big">' + fmtPct(pctAhead, 0) + '</div><div class="small">partite con ' + esc(champA) + ' avanti al 15°</div></div></div>' +
        '<div class="donut-legend">' +
        '<div class="row"><i style="background:var(--champ-a)"></i>' + esc(champA) + ' in vantaggio: ' + fmtPct(pctAhead, 1) + '</div>' +
        '<div class="row"><i style="background:var(--champ-b)"></i>' + esc(champB) + ' in vantaggio: ' + fmtPct(pctBehind, 1) + '</div>' +
        '</div></div>';

      html += '<div class="stat-grid" style="margin-top:18px;">' +
        '<div class="stat-card"><div class="label">Winrate ' + esc(champA) + ' se avanti</div><div class="value a">' + fmtPct(sb.leftAhead, 1) + '</div></div>' +
        '<div class="stat-card"><div class="label">Winrate ' + esc(champA) + ' se indietro</div><div class="value a">' + fmtPct(sb.leftBehind, 1) + '</div></div>' +
        '<div class="stat-card"><div class="label">Winrate ' + esc(champB) + ' se avanti</div><div class="value b">' + fmtPct(sb.rightAhead, 1) + '</div></div>' +
        '<div class="stat-card"><div class="label">Winrate ' + esc(champB) + ' se indietro</div><div class="value b">' + fmtPct(sb.rightBehind, 1) + '</div></div>' +
        '</div>';

      var corrLabel = !isNum(corr) ? '—' : (Math.abs(corr) < 0.15 ? 'correlazione debole' : (Math.abs(corr) < 0.4 ? 'correlazione moderata' : 'correlazione forte'));
      html += '<div class="stat-grid" style="margin-top:14px;">' +
        '<div class="stat-card"><div class="label">Correlazione oro-vittoria</div><div class="value">' + fmtDec(corr, 3) + '</div><div class="sub">' + corrLabel + '</div></div>' +
        '<div class="stat-card"><div class="label">Volatilità del vantaggio in oro</div><div class="value">' + fmtInt(std) + '</div><div class="sub">deviazione standard, in oro, al 15°</div></div>' +
        '</div>';
    } else {
      html += '<div class="empty-note">Le metriche di snowball al 15° minuto richiedono un campione più ampio di quello disponibile per questo matchup (in genere alcune decine di partite).</div>';
    }
    html += '</div>';

    html += '</div>';
    document.getElementById('panel-economy').innerHTML = html;
  }

  /* ------------------------------------------------------------------ *
   * Obiettivi & Torri
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
          return objectiveDonutCard(r.label, fmtInt(r.n) + ' occorrenze registrate', r.pct, champA, champB, esc(champA) + ' per primo');
        }).join('') + '</div>';
      } else {
        html += '<div class="empty-note">Nessun dato sugli obiettivi disponibile per questo matchup specifico.</div>';
      }
    } else if (role === 'TOP' || role === 'MIDDLE' || role === 'BOTTOM') {
      var towerPct = M.pctA('pct_champion_a_wins_tower_race');
      var towerFallDiff = M.diffAB('avg_tower_fall_diff_min_a_minus_b');
      if (isNum(towerPct)) {
        html += '<div class="panel-grid">';
        html += objectiveDonutCard('Corsa alla prima torre', null, towerPct, champA, champB, esc(champA) + ' abbatte per primo');
        html += '<div class="card"><div class="card-head"><h3>Scarto nella caduta della torre</h3>' +
          '<span class="info-icon" tabindex="0" data-tip="Differenza, in minuti, associata al momento della caduta della prima torre di corsia tra i due campioni. Il segno riflette la convenzione del dataset di origine.">i</span></div>';
        if (isNum(towerFallDiff)) {
          html += '<div class="stat-grid"><div class="stat-card"><div class="label">Scarto (' + esc(champA) + ' meno ' + esc(champB) + ')</div><div class="value">' + fmtSigned(towerFallDiff, 2, ' min') + '</div></div></div>';
        } else {
          html += '<div class="empty-note">Dato non disponibile.</div>';
        }
        html += '</div></div>';
      } else {
        html += '<div class="empty-note">Nessun dato sulla corsa alle torri disponibile per questo matchup specifico.</div>';
      }
    } else {
      html += '<div class="empty-note">Le metriche sugli obiettivi epici (draghi, araldo, barone, sciame) sono calcolate solo per il ruolo Jungle; quelle sulla corsa alle torri solo per le corsie singole (Top, Mid, ADC). Per il ruolo Support il dataset non include metriche specifiche sugli obiettivi.</div>';
    }

    document.getElementById('panel-objectives').innerHTML = html;
  }

  /* ------------------------------------------------------------------ *
   * Dati grezzi
   * ------------------------------------------------------------------ */
  var RAW_FIELDS = [
    { kind: 'direct', col: 'n_matches', label: 'Partite analizzate', fmt: fmtInt },
    { kind: 'direct', col: 'low_sample', label: 'Campione ridotto', fmt: function (v) { return v ? 'Sì' : 'No'; } },
    { kind: 'pair', base: 'winrate', label: 'Winrate nel matchup', fmt: function (v) { return fmtPct(v, 2); } },
    { kind: 'pair', base: 'general_winrate', label: 'Winrate generale nel ruolo', fmt: function (v) { return fmtPct(v, 2); } },
    { kind: 'pair', base: 'diff_winrate', label: 'Scarto vs winrate generale', fmt: function (v) { return fmtSignedPct(v, 2); } },
    { kind: 'pair', base: 'pct_physical_dmg', label: 'Danno fisico (%)', fmt: function (v) { return fmtPct(v, 1); } },
    { kind: 'pair', base: 'pct_magic_dmg', label: 'Danno magico (%)', fmt: function (v) { return fmtPct(v, 1); } },
    { kind: 'pair', base: 'pct_true_dmg', label: 'Danno puro (%)', fmt: function (v) { return fmtPct(v, 1); } },
    { kind: 'pair', base: 'avg_damage_to_champs', label: 'Danno medio ai campioni', fmt: fmtInt },
    { kind: 'pair', base: 'avg_damage_taken', label: 'Danno medio subito', fmt: fmtInt },
    { kind: 'pair', base: 'avg_time_ccing_others', label: 'CC medio sui nemici (s)', fmt: function (v) { return fmtDec(v, 1); } },
    { kind: 'pair', base: 'avg_total_time_cc_dealt', label: 'CC totale generato (s)', fmt: function (v) { return fmtDec(v, 1); } },
    { kind: 'pair', base: 'vision_score', label: 'Vision score medio', fmt: function (v) { return fmtDec(v, 1); } },
    { kind: 'diff', col: 'vision_diff_a_minus_b', label: 'Differenza vision score', fmt: function (v) { return fmtSigned(v, 1); } },
    { kind: 'pair', base: 'avg_level6_minute', label: 'Minuto medio livello 6', fmt: function (v) { return fmtDec(v, 2); } },
    { kind: 'pair', base: 'goldxp_n_matches', label: 'Partite con dati oro/XP', fmt: fmtInt },
    { kind: 'pair', base: 'goldxp_winpct_per_1k_gold', label: 'Winrate per 1000 oro (pp)', fmt: function (v) { return fmtDec(v, 2); } },
    { kind: 'pair', base: 'goldxp_winpct_per_1k_xp', label: 'Winrate per 1000 XP (pp)', fmt: function (v) { return fmtDec(v, 2); } },
    { kind: 'pair', base: 'goldxp_auc', label: 'AUC oro/XP verso vittoria', fmt: function (v) { return fmtDec(v, 3); } },
    { kind: 'diff', col: 'goldxp_gold_dependency_diff_a_minus_b', label: 'Differenziale dipendenza oro', fmt: function (v) { return fmtSigned(v, 2); } },
    { kind: 'diff', col: 'goldxp_xp_dependency_diff_a_minus_b', label: 'Differenziale dipendenza XP', fmt: function (v) { return fmtSigned(v, 2); } },
    { kind: 'pairFromPctA', col: 'pct_champion_a_wins_tower_race', label: 'Vittoria corsa alla torre', fmt: function (v) { return fmtPct(v, 1); } },
    { kind: 'diff', col: 'avg_tower_fall_diff_min_a_minus_b', label: 'Scarto caduta torre (min)', fmt: function (v) { return fmtSigned(v, 2); } },
    { kind: 'pairFromPctA', col: 'pct_a_ahead_15m', label: 'Partite in vantaggio al 15°', fmt: function (v) { return fmtPct(v, 1); } },
    { kind: 'pairFromSnowballAhead', label: 'Winrate se in vantaggio al 15°', fmt: function (v) { return fmtPct(v, 1); } },
    { kind: 'pairFromSnowballBehind', label: 'Winrate se in svantaggio al 15°', fmt: function (v) { return fmtPct(v, 1); } },
    { kind: 'direct', col: 'snowball_corr_15m', label: 'Correlazione oro-vittoria al 15°', fmt: function (v) { return fmtDec(v, 3); } },
    { kind: 'direct', col: 'gold_diff_std_15m', label: 'Deviazione standard oro al 15°', fmt: fmtInt }
  ];
  OBJECTIVES.forEach(function (o) {
    RAW_FIELDS.push({ kind: 'pairFromPctA', col: 'pct_champion_a_first_' + o.key, label: o.label + ' (%)', fmt: function (v) { return fmtPct(v, 1); } });
    RAW_FIELDS.push({ kind: 'direct', col: 'n_matches_' + o.key, label: o.label + ' — partite osservate', fmt: fmtInt });
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
      '<div class="raw-toolbar"><button class="raw-btn" id="rawCopyBtn">Copia come testo</button><button class="raw-btn" id="rawCsvBtn">Scarica CSV</button></div>' +
      '<table class="raw-table"><thead><tr><th>Metrica</th><th>' + esc(champA) + '</th><th>' + esc(champB) + '</th></tr></thead><tbody>' + tableRows + '</tbody></table>' +
      '<div class="empty-note" style="margin-top:10px;">Le serie minuto per minuto (oro, XP e le rispettive versioni "in eccesso") sono nella scheda Andamento Partita.</div>' +
      '</div>';

    document.getElementById('panel-raw').innerHTML = html;

    var copyBtn = document.getElementById('rawCopyBtn');
    var csvBtn = document.getElementById('rawCsvBtn');
    if (copyBtn) copyBtn.addEventListener('click', function () {
      var text = rows.map(function (r) { return r.label + ': ' + champA + ' = ' + r.a + ' | ' + champB + ' = ' + r.b; }).join('\n');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          var orig = copyBtn.textContent; copyBtn.textContent = 'Copiato';
          setTimeout(function () { copyBtn.textContent = orig; }, 1600);
        }).catch(function () {});
      }
    });
    if (csvBtn) csvBtn.addEventListener('click', function () {
      function q(s) { return '"' + String(s).replace(/"/g, '""') + '"'; }
      var csv = [q('Metrica') + ',' + q(champA) + ',' + q(champB)]
        .concat(rows.map(function (r) { return q(r.label) + ',' + q(r.a) + ',' + q(r.b); }))
        .join('\n');
      var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = 'matchup_' + state.role + '_' + champA + '_vs_' + champB + '.csv';
      document.body.appendChild(link); link.click(); document.body.removeChild(link);
      URL.revokeObjectURL(url);
    });
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
   * Glossario
   * ------------------------------------------------------------------ */
  var GLOSSARY = [
    { q: 'Cosa significa "campione ridotto"?', a: 'Indica un matchup con meno di ' + DATA.meta.min_matches_confident + ' partite osservate nel dataset. Le percentuali restano indicative ma sono soggette a più rumore statistico: poche partite in più o in meno possono spostare sensibilmente il winrate misurato.' },
    { q: 'Cosa vuol dire "percentile di ruolo"?', a: 'La posizione di un valore rispetto a tutti gli altri campioni dello stesso ruolo nel dataset. Un 90° percentile in danno subito significa che il campione subisce più danno dell\u2019 90% degli altri campioni di quel ruolo.' },
    { q: 'Cosa indica lo "scarto vs winrate generale"?', a: 'La differenza tra il winrate di un campione in questo specifico matchup e il suo winrate medio complessivo nel ruolo. Un valore positivo indica che l\u2019avversario scelto è comparativamente più favorevole del solito; uno negativo, più sfavorevole.' },
    { q: 'Cosa sono "oro in eccesso" e "XP in eccesso"?', a: 'Il vantaggio in oro o esperienza che va oltre quanto ci si aspetterebbe dalla sola forza individuale dei due campioni nel ruolo. Isolano l\u2019effetto specifico dell\u2019incontro tra questi due campioni, al netto del loro livello generale di potenza.' },
    { q: 'Cos\u2019è l\u2019AUC oro/XP verso vittoria?', a: 'Una misura di quanto il vantaggio economico al 15° minuto predica la vittoria finale. Vale 0,50 quando il vantaggio economico non ha alcun potere predittivo e si avvicina a 1 quando la partita è quasi sempre decisa da chi è in vantaggio economico.' },
    { q: 'Cosa significa "winrate per 1000 oro/XP"?', a: 'L\u2019aumento di probabilità di vittoria, in punti percentuali, associato a ogni 1000 oro (o 1000 esperienza) di vantaggio accumulato entro il 15° minuto.' },
    { q: 'Cos\u2019è la correlazione oro-vittoria?', a: 'La correlazione statistica tra il vantaggio in oro al 15° minuto e l\u2019esito finale della partita in questo matchup. Valori più alti indicano un matchup dove chi va in vantaggio economico presto tende a chiudere la partita in vantaggio ("snowball" più marcato).' },
    { q: 'Cosa indica la "volatilità" del vantaggio in oro?', a: 'La deviazione standard del differenziale di oro al 15° minuto tra le partite di questo matchup. Valori alti indicano un matchup dagli sviluppi molto variabili da partita a partita; valori bassi, un andamento più prevedibile.' },
    { q: 'Come funziona la "corsa alla prima torre"?', a: 'Misura la percentuale di partite in cui la prima torre della corsia cade a favore dell\u2019uno o dell\u2019altro campione, un indicatore diretto della pressione di corsia esercitata.' },
    { q: 'A cosa si riferiscono i "primi obiettivi" (drago, barone, araldo)?', a: 'Alla percentuale di partite in cui il campione, giocando in Jungle, ottiene per primo un determinato obiettivo epico rispetto all\u2019avversario diretto. Sono disponibili solo per il ruolo Jungle.' },
    { q: 'Cos\u2019è il vision score?', a: 'Una metrica ufficiale del gioco che sintetizza il contributo di un giocatore al controllo della visione della mappa (piazzamento e rimozione di ward, uso del controllo visione totale).' },
    { q: 'Cosa indicano i tempi di CC ("controllo")?', a: 'Il tempo medio, in secondi, in cui un campione tiene sotto controllo i nemici tramite stordimenti, rallentamenti, immobilizzazioni e simili effetti nel corso di una partita.' },
    { q: 'Che differenza c\u2019è tra danno fisico, magico e puro?', a: 'Sono le tre tipologie di danno del gioco: il danno fisico è mitigato dall\u2019armatura, quello magico dalla resistenza magica, mentre il danno puro ignora entrambe le resistenze. La composizione indica il profilo di danno del campione e aiuta a valutare contro quali resistenze conviene costruire l\u2019equipaggiamento.' }
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
   * Footer & avvio
   * ------------------------------------------------------------------ */
  function renderFooterStats() {
    document.getElementById('footerStats').textContent =
      fmtInt(DATA.meta.total_matchups) + ' matchup analizzati su 5 ruoli · ' +
      fmtInt(DATA.meta.total_low_sample) + ' a campione ridotto (< ' + DATA.meta.min_matches_confident + ' partite)';
  }

  function init() {
    populateRolePills();
    renderGlossary();
    renderFooterStats();

    var best = null;
    ROLE_ORDER.forEach(function (r) {
      var top = DATA.meta.top_matchups_by_role[r] && DATA.meta.top_matchups_by_role[r][0];
      if (top && (!best || top.n > best.n)) best = { role: r };
    });
    var startRole = (best && best.role) || DATA.meta.roles[0];
    setRole(startRole);
  }

  init();
})();