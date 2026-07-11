(function () {
  'use strict';

  function setDataStatus(kind, text) {
    var el = document.getElementById('dataStatus');
    if (!el) return;
    el.className = 'data-status-pill ' + (kind || 'loading');
    el.textContent = text || 'Caricamento dati';
  }

  function showDatasetError(message) {
    var empty = document.getElementById('emptyState');
    var dossier = document.getElementById('dossier');
    if (dossier) dossier.hidden = true;
    if (!empty) return;
    empty.hidden = false;
    empty.innerHTML = '<h3>Dataset non disponibile</h3><p>' + message + '</p>';
  }

  setDataStatus('loading', 'Caricamento dati');

  var DATA = window.MATCHUP_APP_DATA;
  if (!DATA || !Array.isArray(DATA.matchupColumns) || !DATA.matchups) {
    setDataStatus('error', 'Dati assenti');
    showDatasetError('Controlla che matchup_data.js sia nella stessa cartella e venga caricato prima di app.js.');
    throw new Error('[Matchup Lab] MATCHUP_APP_DATA non disponibile o incompleto.');
  }

  var COLS = {};
  DATA.matchupColumns.forEach(function (c, i) { COLS[c] = i; });

  var ROLE_LABELS = { TOP: 'Top', JUNGLE: 'Jungle', MIDDLE: 'Mid', BOTTOM: 'Bot', UTILITY: 'Support' };
  var ROLE_LONG = {
    TOP: 'Corsia Top', JUNGLE: 'Boscaglia', MIDDLE: 'Corsia di Mezzo',
    BOTTOM: 'Corsia Bassa (Bot)', UTILITY: 'Supporto'
  };
  var ROLE_ORDER = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];

  var OBJECTIVES = [
    { key: 'dragon', label: 'Primo Drago' },
    { key: 'baron_nashor', label: 'Primo Barone Nashor' },
    { key: 'riftherald', label: 'Primo Araldo' },
    { key: 'horde', label: 'Primo Sciame del Vuoto' },
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
    if (n >= DATA.meta.min_matches_solid) return { level: 'high', label: 'Molte partite disponibili' };
    if (n >= DATA.meta.min_matches_confident) return { level: 'mid', label: 'Numero di partite discreto' };
    return { level: 'low', label: 'Poche partite disponibili' };
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
      if (leftIsA) return v;
      // Prima kill e prima morte sono eventi speculari, non complementari:
      // B first kill = A first death (gli esiti senza kill non vanno inventati).
      if (col === 'pct_a_first_kill_in_pair') {
        var firstDeath = val(rec, 'pct_a_first_death_in_pair');
        return isNum(firstDeath) ? firstDeath : null;
      }
      if (col === 'pct_a_first_death_in_pair') {
        var firstKill = val(rec, 'pct_a_first_kill_in_pair');
        return isNum(firstKill) ? firstKill : null;
      }
      // Per queste due quote il dataset non esporta la quota avversaria né i
      // pareggi: 1-p sarebbe tecnicamente scorretto quando invertiamo il lato.
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

  // Compatibilità: alcune render function V2 chiamano bindTips(scope).
  // La gestione tooltip reale è già delegata a document tramite [data-tip],
  // quindi questa funzione mantiene le chiamate sicure senza duplicare listener.
  function bindTips(scope) {
    return scope;
  }


  /* ------------------------------------------------------------------ *
   * Combobox di ricerca campioni
   * ------------------------------------------------------------------ */
  function createCombobox(rootEl, opts) {
    var input = rootEl.querySelector('input');
    var list = rootEl.querySelector('.combobox-list');
    var options = [];
    var activeIndex = -1;

    // Stable fix: la lista resta dentro la combobox e si apre in flusso.
    // Non usa portal, fixed positioning o stacking trick: appare sempre sotto
    // il campo corretto e spinge il contenuto successivo, quindi non può essere
    // coperta/tagliata da cockpit, empty state o dossier più in basso.

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
    state.champA = null;
    state.champB = null;
    document.querySelectorAll('.role-pill').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-role') === role);
    });
    comboA.setOptions(championOptionsFor(role));
    comboA.clear();
    comboB.setOptions([]);
    comboB.setEnabled(false, 'Scegli prima il campione A');
    render();
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
      // UX tastiera: la seconda tendina si apre davvero dopo la selezione A.
      // requestAnimationFrame evita che il keydown usato per A venga riutilizzato
      // accidentalmente dalla nuova combobox, mentre il secondo Enter seleziona
      // immediatamente il matchup diretto più giocato (prima opzione ordinata).
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



  function renderSelectionHints() {
    var hintA = document.getElementById('hintA');
    var hintB = document.getElementById('hintB');
    var roleLabelText = state.role ? ROLE_LABELS[state.role] : 'ruolo';
    var pa = state.role && state.champA ? ((DATA.championProfiles[state.role] || {})[state.champA] || null) : null;
    var pb = state.role && state.champB ? ((DATA.championProfiles[state.role] || {})[state.champB] || null) : null;
    if (hintA) {
      if (state.champA && pa && pa.coverage) {
        hintA.innerHTML = '<strong>' + esc(state.champA) + '</strong> · ' + fmtInt(pa.coverage.n_matchups) + ' matchup · ' + fmtInt(pa.coverage.total_games) + ' partite da ' + roleLabelText;
      } else if (state.role) {
        hintA.textContent = 'Scegli il primo campione nel ruolo ' + roleLabelText + '.';
      } else {
        hintA.textContent = 'Scegli prima un ruolo per filtrare i campioni.';
      }
    }
    if (hintB) {
      if (state.champB && pb && pb.coverage) {
        hintB.innerHTML = '<strong>' + esc(state.champB) + '</strong> · ' + fmtInt(pb.coverage.n_matchups) + ' matchup · ' + fmtInt(pb.coverage.total_games) + ' partite da ' + roleLabelText;
      } else if (state.champA) {
        hintB.textContent = 'Ora scegli un avversario con dati diretti contro ' + state.champA + '.';
      } else {
        hintB.textContent = 'Lo slot si sblocca dopo il Campione A.';
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
    var roleLabelText = state.role ? ROLE_LABELS[state.role] : 'ruolo';
    var champA = state.champA || 'Campione A';
    var champB = state.champB || 'Campione B';
    var pa = state.role && state.champA ? ((DATA.championProfiles[state.role] || {})[state.champA] || null) : null;
    var pb = state.role && state.champB ? ((DATA.championProfiles[state.role] || {})[state.champB] || null) : null;

    setCockpitText('cockpitATitle', state.champA || 'In attesa');
    setCockpitText('cockpitBTitle', state.champB || 'In attesa');
    setCockpitText('cockpitACopy', pa && pa.coverage ? fmtPct(pa.general_winrate, 1) + ' di vittorie medie · dati contro ' + fmtInt(pa.coverage.n_matchups) + ' avversari nel ruolo ' + roleLabelText + '.' : 'Scegli il lato di riferimento.');
    setCockpitText('cockpitBCopy', pb && pb.coverage ? fmtPct(pb.general_winrate, 1) + ' di vittorie medie · dati contro ' + fmtInt(pb.coverage.n_matchups) + ' avversari nel ruolo ' + roleLabelText + '.' : (state.champA ? 'Scegli un avversario reale dal dataset per attivare il dossier.' : 'Si sblocca dopo il Campione A.'));

    if (!state.champA || !state.champB) {
      setCockpitText('cockpitTitle', 'Nessun confronto attivo.');
      setCockpitText('cockpitCopy', state.champA ? 'Manca il secondo campione: appena lo scegli vedrai chi parte meglio, la situazione media al minuto 15 e quanto sono solidi i dati.' : 'Seleziona due campioni: qui troverai subito i punti davvero importanti del confronto.');
      setCockpitText('cockpitFocus', state.champA ? state.champA + ' selezionato · avversario mancante.' : '—');
      setCockpitText('cockpitMethod', state.role ? 'Contesto: ' + roleLabelText + '.' : '—');
      setCockpitText('cockpitTrustTitle', 'In attesa');
      setCockpitText('cockpitTrustCopy', 'La fiducia dipende dal campione diretto.');
      setCockpitText('cockpitNextTitle', state.champA ? 'Completa il lato B' : 'Scegli il lato A');
      setCockpitText('cockpitNextCopy', state.champA ? 'Avversari filtrati sul dataset.' : 'Nessun dato inventato prima della coppia.');
      var meterIdle = document.getElementById('cockpitMeter');
      if (meterIdle) meterIdle.style.setProperty('--meter', state.champA ? '58%' : '34%');
      return;
    }

    if (!M || !rec) {
      setCockpitText('cockpitTitle', champA + ' vs ' + champB + ': dato diretto assente.');
      setCockpitText('cockpitCopy', 'La coppia esiste come scelta, ma non ha riga matchup nel ruolo selezionato.');
      setCockpitText('cockpitFocus', 'Non è possibile stimare un vantaggio.');
      setCockpitText('cockpitMethod', 'Cambia avversario o ruolo.');
      setCockpitText('cockpitTrustTitle', 'Copertura assente');
      setCockpitText('cockpitTrustCopy', 'Nessuna metrica sintetica viene inventata.');
      setCockpitText('cockpitNextTitle', 'Matchup non coperto');
      setCockpitText('cockpitNextCopy', 'Serve una riga diretta del dataset.');
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

    setCockpitText('cockpitTitle', favored + ' è il lato più forte.');
    setCockpitText('cockpitCopy', champA + ' vs ' + champB + ' · ' + roleLabelText + '. Sintesi: chi è favorito, situazione media al minuto 15 e affidabilità dei dati.');
    setCockpitText('cockpitFocus', fmtPct(Math.max(wr[0], wr[1]), 1) + ' di vittorie nel confronto · ' + fmtSignedPct(wr[0] >= wr[1] ? diffWr[0] : diffWr[1], 1) + ' rispetto al rendimento abituale.');
    setCockpitText('cockpitMethod', signedSideText(gold15, ' oro', 20) + ' · ' + signedSideText(xp15, ' XP', 20) + ' @15.');
    setCockpitText('cockpitTrustTitle', conf.label);
    setCockpitText('cockpitTrustCopy', fmtInt(n) + ' partite nel matchup. ' + (conf.level === 'low' ? 'Leggilo come segnale direzionale, non come certezza.' : 'Campione abbastanza stabile.'));
    setCockpitText('cockpitNextTitle', 'Leggi i consigli principali');
    setCockpitText('cockpitNextCopy', 'Parti dai primi consigli: sono quelli che possono cambiare di più il modo di giocare la lane.');
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
      emptyEl.innerHTML = '<h3>Nessun matchup attivo</h3><p>Il dossier compare quando A e B hanno una riga dati valida.</p>';
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
      emptyEl.innerHTML = '<h3>Nessun dato diretto</h3>' +
        '<p>Nessuna riga diretta per <strong>' + esc(state.champA) + '</strong> vs <strong>' + esc(state.champB) + '</strong> in ' + ROLE_LABELS[state.role] + '.' +
        (opts.length ? ' Avversari disponibili per ' + esc(state.champA) + ':' : '') + '</p>' +
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
        console.error('[Matchup Lab] Errore in sezione ' + label + ':', err);
        var panel = document.getElementById(panelId);
        if (panel) {
          panel.innerHTML = '<div class="empty-note full-span"><strong>' + esc(label) + '</strong><br>Questa sezione non è stata renderizzata per un errore locale. Le altre sezioni restano disponibili; controlla la console per il dettaglio.</div>';
        }
      }
    }

    safeRender('Verdetto', 'verdictBand', renderVerdict);
    safeRender('Panoramica', 'panel-overview', renderOverview);
    safeRender('Andamento partita', 'panel-trajectory', renderTrajectory);
    safeRender('Combattimento', 'panel-combat', renderCombat);
    safeRender('Kill, morti e taglie', 'panel-kill', renderKillBounty);
    safeRender('Oro, XP e peso del vantaggio', 'panel-economy', renderEconomy);
    safeRender('Obiettivi / Torri', 'panel-objectives', renderObjectives);
    safeRender('Dettaglio', 'panel-raw', renderRaw);
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
      '<div class="row"><span>Percentuale di vittorie in questo confronto</span><span class="v">' + fmtPct(wr[0], 1) + '</span></div>' +
      '<div class="row"><span>Percentuale di vittorie abituale da ' + ROLE_LABELS[role] + '</span><span class="v">' + fmtPct(genWr[0], 1) + '</span></div>' +
      '<div class="row"><span>Scarto</span><span class="v">' + fmtSignedPct(diffWr[0], 1) + '</span></div></div>';
    html += '<div class="verdict-col b"><div class="champ-name">' + esc(champB) + '</div>' +
      '<div class="row"><span>Percentuale di vittorie in questo confronto</span><span class="v">' + fmtPct(wr[1], 1) + '</span></div>' +
      '<div class="row"><span>Percentuale di vittorie abituale da ' + ROLE_LABELS[role] + '</span><span class="v">' + fmtPct(genWr[1], 1) + '</span></div>' +
      '<div class="row"><span>Scarto</span><span class="v">' + fmtSignedPct(diffWr[1], 1) + '</span></div></div>';
    html += '</div>';

    html += '<div class="verdict-sentence">' + sentence + '</div>';

    document.getElementById('verdictBand').innerHTML = html;
  }

  /* ------------------------------------------------------------------ *
   * Panoramica: profilo dei due campioni con percentile di ruolo
   * ------------------------------------------------------------------ */
  var OVERVIEW_FIELDS = [
    { key: 'general_winrate', label: 'Percentuale di vittorie abituale nel ruolo', fmt: function (v) { return fmtPct(v, 1); } },
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
      col: 'excess_gold_diff_by_minute', label: 'Oro specifico del matchup', unit: ' oro',
      explain: function (a, b) { return 'Vantaggio in oro imputabile allo scontro specifico tra ' + a + ' e ' + b + ', al netto di quanto atteso dalla forza individuale dei due campioni nel ruolo.'; }
    },
    excessXp: {
      col: 'excess_xp_diff_by_minute', label: 'XP specifica del matchup', unit: ' xp',
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
        compareBarRow('Effetto di 1000 oro sulle possibilità di vittoria', null, wpg[0], wpg[1], champA, champB, 2, ' pp') +
        compareBarRow('Effetto di 1000 XP sulle possibilità di vittoria', null, wpx[0], wpx[1], champA, champB, 2, ' pp') +
        '</div>';
    } else {
      html += '<div class="card"><div class="card-head"><h3>Dipendenza dal vantaggio economico</h3></div>' +
        '<div class="empty-note">Dati non disponibili per almeno uno dei due campioni in questo ruolo.</div></div>';
    }

    if (isNum(auc[0]) || isNum(auc[1])) {
      var aucTip = "Quanto il vantaggio economico al 15° minuto predice la vittoria finale. 0,50 significa nessun potere predittivo; valori vicini a 1 indicano un campione la cui vittoria dipende quasi sempre dal vantaggio economico.";
      html += '<div class="card"><div class="card-head"><h3>Quanto oro e XP aiutano a vincere</h3>' +
        '<span class="info-icon" tabindex="0" data-tip="' + esc(aucTip) + '">i</span></div>' +
        compareBarRow('Legame tra risorse e vittoria', null, auc[0], auc[1], champA, champB, 3, '', 1) +
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

    html += '<div class="card full-span"><div class="card-head"><h3>Quanto pesa essere avanti al minuto 15</h3>' +
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
        '<div class="stat-card"><div class="label">Vittorie di ' + esc(champA) + ' se avanti</div><div class="value a">' + fmtPct(sb.leftAhead, 1) + '</div></div>' +
        '<div class="stat-card"><div class="label">Vittorie di ' + esc(champA) + ' se indietro</div><div class="value a">' + fmtPct(sb.leftBehind, 1) + '</div></div>' +
        '<div class="stat-card"><div class="label">Vittorie di ' + esc(champB) + ' se avanti</div><div class="value b">' + fmtPct(sb.rightAhead, 1) + '</div></div>' +
        '<div class="stat-card"><div class="label">Vittorie di ' + esc(champB) + ' se indietro</div><div class="value b">' + fmtPct(sb.rightBehind, 1) + '</div></div>' +
        '</div>';

      var corrLabel = !isNum(corr) ? '—' : (Math.abs(corr) < 0.15 ? 'correlazione debole' : (Math.abs(corr) < 0.4 ? 'correlazione moderata' : 'correlazione forte'));
      html += '<div class="stat-grid" style="margin-top:14px;">' +
        '<div class="stat-card"><div class="label">Correlazione oro-vittoria</div><div class="value">' + fmtDec(corr, 3) + '</div><div class="sub">' + corrLabel + '</div></div>' +
        '<div class="stat-card"><div class="label">Quanto cambia il vantaggio tra una partita e l’altra</div><div class="value">' + fmtInt(std) + '</div><div class="sub">oscillazione tipica dell’oro al minuto 15</div></div>' +
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
    { kind: 'direct', col: 'low_sample', label: 'Poche partite disponibili', fmt: function (v) { return v ? 'Sì' : 'No'; } },
    { kind: 'pair', base: 'winrate', label: 'Percentuale di vittorie nel confronto', fmt: function (v) { return fmtPct(v, 2); } },
    { kind: 'pair', base: 'general_winrate', label: 'Percentuale di vittorie abituale nel ruolo', fmt: function (v) { return fmtPct(v, 2); } },
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
    { kind: 'pair', base: 'goldxp_winpct_per_1k_gold', label: 'Quanto 1000 oro cambiano le possibilità di vittoria', fmt: function (v) { return fmtDec(v, 2); } },
    { kind: 'pair', base: 'goldxp_winpct_per_1k_xp', label: 'Quanto 1000 XP cambiano le possibilità di vittoria', fmt: function (v) { return fmtDec(v, 2); } },
    { kind: 'pair', base: 'goldxp_auc', label: 'Legame complessivo tra risorse e vittoria', fmt: function (v) { return fmtDec(v, 3); } },
    { kind: 'diff', col: 'goldxp_gold_dependency_diff_a_minus_b', label: 'Differenziale dipendenza oro', fmt: function (v) { return fmtSigned(v, 2); } },
    { kind: 'diff', col: 'goldxp_xp_dependency_diff_a_minus_b', label: 'Differenziale dipendenza XP', fmt: function (v) { return fmtSigned(v, 2); } },
    { kind: 'pairFromPctA', col: 'pct_champion_a_wins_tower_race', label: 'Vittoria corsa alla torre', fmt: function (v) { return fmtPct(v, 1); } },
    { kind: 'diff', col: 'avg_tower_fall_diff_min_a_minus_b', label: 'Scarto caduta torre (min)', fmt: function (v) { return fmtSigned(v, 2); } },
    { kind: 'pairFromPctA', col: 'pct_a_ahead_15m', label: 'Partite in vantaggio al 15°', fmt: function (v) { return fmtPct(v, 1); } },
    { kind: 'pairFromSnowballAhead', label: 'Vittorie quando è avanti al minuto 15', fmt: function (v) { return fmtPct(v, 1); } },
    { kind: 'pairFromSnowballBehind', label: 'Vittorie quando è indietro al minuto 15', fmt: function (v) { return fmtPct(v, 1); } },
    { kind: 'direct', col: 'snowball_corr_15m', label: 'Correlazione oro-vittoria al 15°', fmt: function (v) { return fmtDec(v, 3); } },
    { kind: 'direct', col: 'gold_diff_std_15m', label: 'Deviazione standard oro al 15°', fmt: fmtInt }
  ];
  [
    { kind: 'pair', base: 'avg_kills_0_15m', label: 'Kills medie 0–15', fmt: function (v) { return fmtDec(v, 3); } },
    { kind: 'pair', base: 'avg_deaths_0_15m', label: 'Deaths medie 0–15', fmt: function (v) { return fmtDec(v, 3); } },
    { kind: 'pair', base: 'avg_bounty_net', label: 'Saldo medio delle taglie', fmt: function (v) { return fmtSigned(v, 1); } },
    { kind: 'pair', base: 'avg_bounty_net_0_15m', label: 'Saldo taglie nei primi 15 minuti', fmt: function (v) { return fmtSigned(v, 1); } },
    { kind: 'pair', base: 'avg_bounty_per_kill', label: 'Oro medio da taglia per kill', fmt: function (v) { return fmtDec(v, 1); } },
    { kind: 'pair', base: 'avg_bounty_given_per_death', label: 'Oro medio concesso morendo', fmt: function (v) { return fmtDec(v, 1); } },
    { kind: 'pair', base: 'avg_kill_streak_on_kill', label: 'Serie media di kill', fmt: function (v) { return fmtDec(v, 2); } },
    { kind: 'pair', base: 'shutdown_collected_rate', label: 'Frequenza con cui incassa una taglia', fmt: function (v) { return fmtPct(v, 1); } },
    { kind: 'pair', base: 'shutdown_given_rate', label: 'Frequenza con cui regala una taglia', fmt: function (v) { return fmtPct(v, 1); } },
    { kind: 'diff', col: 'avg_kill_diff_15m_a_minus_b', label: 'Matchup kill diff 15m', fmt: function (v) { return fmtSigned(v, 3); } },
    { kind: 'diff', col: 'avg_death_diff_15m_a_minus_b', label: 'Matchup death diff 15m', fmt: function (v) { return fmtSigned(v, 3); } },
    { kind: 'diff', col: 'avg_bounty_net_diff_15m_a_minus_b', label: 'Matchup bounty net diff 15m', fmt: function (v) { return fmtSigned(v, 1); } },
    { kind: 'diff', col: 'early_kd_pressure_15m_a_minus_b', label: 'Saldo kill-morti al minuto 15', fmt: function (v) { return fmtSigned(v, 3); } },
    { kind: 'diff', col: 'excess_early_kd_pressure_15m_a_minus_b', label: 'Saldo kill-morti specifico del matchup', fmt: function (v) { return fmtSigned(v, 3); } },
    { kind: 'pairFromPctA', col: 'pct_a_kill_adv_15m', label: 'Probabilità di avere più kill al minuto 15', fmt: function (v) { return fmtPct(v, 1); } },
    { kind: 'pairFromPctA', col: 'pct_a_bounty_net_adv_15m', label: 'Probabilità di avere più valore dalle taglie al minuto 15', fmt: function (v) { return fmtPct(v, 1); } },
    { kind: 'pairFromPctA', col: 'pct_a_first_kill_in_pair', label: 'First kill nel pair', fmt: function (v) { return fmtPct(v, 1); } },
    { kind: 'pairFromPctA', col: 'pct_a_first_death_in_pair', label: 'First death nel pair', fmt: function (v) { return fmtPct(v, 1); } },
    { kind: 'direct', col: 'snowball_conversion_15m_a', label: 'Capacità di trasformare il vantaggio iniziale', fmt: function (v) { return fmtSignedPct(v, 1); } },
    { kind: 'direct', col: 'volatility_15m_a', label: 'Variabilità del matchup al minuto 15', fmt: function (v) { return fmtDec(v, 3); } },
    { kind: 'direct', col: 'kill_value_efficiency_15m_a', label: 'Valore ottenuto dagli scontri al minuto 15', fmt: function (v) { return fmtDec(v, 1); } },
    { kind: 'direct', col: 'objective_conversion_score_a', label: 'Capacità di trasformare il vantaggio in obiettivi', fmt: function (v) { return fmtSigned(v, 4); } },
    { kind: 'diff', col: 'monster_sequence_control_score_a', label: 'Monster sequence control score', fmt: function (v) { return fmtSigned(v, 4); } }
  ].forEach(function (f) { RAW_FIELDS.push(f); });

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
      '<table class="raw-table"><thead><tr><th>Metrica</th><th>' + esc(champA) + '</th><th>' + esc(champB) + '</th></tr></thead><tbody>' + tableRows + '</tbody></table>' +
      '<div class="empty-note" style="margin-top:10px;">Le serie minuto per minuto (oro, XP e la parte specifica del matchup) sono nella scheda Andamento Partita.</div>' +
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
   * Glossario
   * ------------------------------------------------------------------ */
  var GLOSSARY = [
    { q: 'Quanto posso fidarmi del risultato?', a: 'Guarda prima il numero di partite dirette. Con molte partite la tendenza è più stabile; con poche partite basta qualche risultato diverso per cambiare parecchio le percentuali. Per questo i consigli perdono automaticamente peso quando i dati sono scarsi.' },
    { q: 'Che cosa significa “rendimento abituale” del campione?', a: 'È il modo in cui il campione va normalmente in quel ruolo contro tutti gli avversari. Il sito lo usa come punto di partenza per capire se il matchup scelto è davvero favorevole oppure se il campione è semplicemente forte in generale.' },
    { q: 'Che cosa significa “vantaggio specifico del matchup”?', a: 'È la parte di oro, XP, kill o taglie che va oltre ciò che ci aspetteremmo dai due campioni in generale. In pratica prova a isolare l’effetto della coppia: non “questo campione è forte”, ma “questo campione tende ad andare meglio proprio contro questo avversario”.' },
    { q: 'Come leggo i valori positivi e negativi?', a: 'Nelle barre centrate e nei differenziali, un valore positivo favorisce il campione a sinistra; un valore negativo favorisce quello a destra. Le percentuali, invece, indicano direttamente quanto spesso accade un evento.' },
    { q: 'Che cosa misura il vantaggio al minuto 15?', a: 'Riassume la situazione di lane verso la fine dell’early game: oro, XP, kill, morti e taglie. Non significa che la partita sia già vinta, ma mostra chi arriva più spesso alla fase centrale con più risorse o pressione.' },
    { q: 'Che cosa vuol dire “quanto pesa il primo vantaggio”?', a: 'Confronta quanto spesso il campione vince quando è avanti al minuto 15 e quanto spesso riesce a recuperare quando è indietro. Se la differenza è grande, il primo errore, un gank o un reset sbagliato possono pesare molto più del solito.' },
    { q: 'Che cosa indica la variabilità del matchup?', a: 'Mostra quanto le partite con questa coppia possono svilupparsi in modi diversi. Un valore alto suggerisce una lane poco prevedibile, in cui è meglio adattarsi invece di seguire sempre lo stesso piano.' },
    { q: 'Che cosa sono il saldo kill-morti e il saldo taglie?', a: 'Il saldo kill-morti confronta eventi positivi e negativi negli scontri. Il saldo taglie guarda invece l’oro extra guadagnato con le kill e quello regalato morendo. Due matchup con le stesse kill possono quindi avere un impatto economico molto diverso.' },
    { q: 'Che cosa significa rischio di rimonta?', a: 'Stima quanto valore può essere restituito all’avversario attraverso uno shutdown. Un campione che accumula spesso grandi taglie ma muore con una certa frequenza può creare molto vantaggio, ma anche offrire una finestra importante di comeback.' },
    { q: 'Come leggo il livello 6?', a: 'È il minuto medio in cui il campione raggiunge il livello 6 nel ruolo. Chi arriva prima alla ultimate può avere una breve finestra per cercare un all-in, forzare un reset o muoversi sulla mappa.' },
    { q: 'Che cosa indica il percentile di ruolo?', a: 'È una posizione da 0 a 100 rispetto agli altri campioni dello stesso ruolo. Per esempio, 90 in danno significa che quel campione è sopra circa il 90% degli altri campioni del ruolo per quella statistica.' },
    { q: 'Che cosa misura il legame tra oro/XP e vittoria?', a: 'Mostra quanto il risultato del matchup dipende dal vantaggio di risorse. Se il legame è forte, chi arriva avanti di oro o livelli tende a trasformare più spesso quel margine in vittoria; se è debole, il matchup può restare recuperabile.' },
    { q: 'Che cosa indicano visione e controlli?', a: 'La visione riassume il contributo medio a ward, rimozione di ward e controllo della mappa. I controlli misurano quanto a lungo il campione limita i nemici con stun, root, slow e altri effetti.' },
    { q: 'Come leggo il profilo di danno?', a: 'Mostra quanta parte del danno è fisica, magica o pura. Serve per capire quali resistenze possono essere più efficaci: armatura contro il fisico, resistenza magica contro il magico, mentre il danno puro ignora entrambe.' },
    { q: 'Che cosa mostrano torri e obiettivi?', a: 'Per le corsie misura chi prende più spesso la prima torre e con quale anticipo. In Jungle misura chi controlla più spesso draghi, araldo, barone e la sequenza complessiva degli obiettivi neutrali.' }
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
    var total = DATA.meta.total_matchups;
    var roles = Array.isArray(DATA.meta.roles) ? DATA.meta.roles.length : ROLE_ORDER.length;
    var heroDataset = document.getElementById('heroDatasetCount');
    var heroRoles = document.getElementById('heroRoleCount');
    if (heroDataset) heroDataset.textContent = fmtInt(total);
    if (heroRoles) heroRoles.textContent = fmtInt(roles);
    document.getElementById('footerStats').textContent =
      fmtInt(total) + ' matchup analizzati su ' + fmtInt(roles) + ' ruoli · ' +
      fmtInt(DATA.meta.total_low_sample) + ' a campione ridotto (< ' + DATA.meta.min_matches_confident + ' partite)';
  }


  /* ====================================================================== *
   * MATCHUP LAB V2 — lettura visuale + insight pesati
   * ----------------------------------------------------------------------
   * Queste funzioni sovrascrivono alcune render function originali senza
   * cambiare la struttura dati o il contratto con matchup_data.js.
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
    return 'Entrambi';
  }
  function signedSideText(v, unit, deadzone) {
    var tone = toneFromSigned(v, deadzone || 0);
    if (tone === 'neutral') return 'equilibrio';
    return (tone === 'a' ? state.champA : state.champB) + ' +' + fmtInt(Math.abs(v)) + (unit || '');
  }
  function seriesAtMinute(M, col, minute) {
    // Robustezza importante: nei diversi export la timeline può essere
    // indicizzata con array minutes esplicito, con indice 0=minuto 0, oppure
    // con indice 0=minuto 1. Evitiamo quindi falsi `—` quando il dato esiste.
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

      // Se il minuto 15 non è presente in modo esatto, usa il punto più vicino
      // entro una finestra stretta. Meglio un dato reale vicino che un falso vuoto.
      var bestIdx = -1, bestDist = Infinity;
      for (var j = 0; j < minutes.length; j++) {
        var m = toFinite(minutes[j]);
        if (m === null) continue;
        var d = Math.abs(m - minute);
        if (d < bestDist && isNum(valueAt(j))) { bestDist = d; bestIdx = j; }
      }
      if (bestIdx >= 0 && bestDist <= 1) return valueAt(bestIdx);
    }

    // Fallback per serie senza array minutes: proviamo sia 0-based sia 1-based.
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
    if (!isNum(sensitivity)) return { cls: 'neutral', label: 'non disponibile', copy: 'La sensibilità snowball non è presente per questo matchup.' };
    if (sensitivity >= 0.25) return { cls: 'danger', label: 'esplosiva', copy: 'Essere avanti o indietro al 15° minuto cambia drasticamente la lettura della partita.' };
    if (sensitivity >= 0.16) return { cls: 'warning', label: 'alta', copy: 'Il vantaggio early pesa molto: la corsia può decidere il ritmo del game.' };
    if (sensitivity >= 0.08) return { cls: 'info', label: 'media', copy: 'Il vantaggio early conta, ma non determina da solo il destino del matchup.' };
    return { cls: 'neutral', label: 'bassa', copy: 'La corsia tende a lasciare più spazio a recupero, scaling o macro.' };
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
    if (isNum(tower)) return { label: 'Prima torre', edge: tower - 0.5, pct: tower };
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
      var adjusted = tag === 'Affidabilità' ? weight : Math.max(0, weight - samplePenalty);
      items.push({ weight: adjusted, rawWeight: weight, tone: tone || 'neutral', tag: tag, title: title, body: body });
    }
    function side(v, deadzone) {
      var t = toneFromSigned(v, deadzone || 0);
      return t === 'a' ? champA : (t === 'b' ? champB : 'nessuno');
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
      add(103, 'warning', 'Affidabilità', 'Poche partite: leggi il risultato con cautela',
        fmtInt(n) + ' partite dirette. Il risultato è più affidabile quando oro, XP, scambi e obiettivi raccontano la stessa storia; un solo numero non basta.');
    } else if (isNum(n)) {
      add(conf.level === 'high' ? 73 : 67, conf.level === 'high' ? 'info' : 'warning', 'Affidabilità', conf.label,
        fmtInt(n) + ' partite dirette. Più partite sono disponibili, più peso viene dato ai consigli.');
    }

    if (sameSign(wrEdge, baseAdv) && Math.abs(wrEdge) >= 0.035 && Math.abs(baseAdv) >= 0.02) {
      add(99, toneFromSigned(wrEdge, 0), 'Convergenza', side(wrEdge) + ' ha un vantaggio confermato da più dati',
        'Percentuale di vittorie nel confronto (' + fmtPct(Math.max(wr[0], wr[1]), 1) + ') e rendimento rispetto alla media abituale (' + fmtSignedPP(baseAdv, 1) + ') favoriscono lo stesso campione.');
    } else if (isNum(wrEdge) && Math.abs(wrEdge) >= 0.045) {
      add(88, toneFromSigned(wrEdge, 0), 'Matchup', side(wrEdge) + ' vince più spesso questo confronto',
        'La percentuale di vittorie favorisce un lato (' + fmtPct(Math.max(wr[0], wr[1]), 1) + '), ma oro, XP e momento del vantaggio devono confermare la lettura.');
    } else {
      add(62, 'neutral', 'Equilibrio', 'Il risultato generale è vicino',
        'La percentuale di vittorie è quasi pari: per capire il matchup contano di più andamento di oro e XP, scambi, livello 6 e obiettivi.');
    }

    if (isNum(gold15) && isNum(exGold15)) {
      if (Math.abs(gold15) >= 420 && Math.abs(exGold15) >= 260 && sameSign(gold15, exGold15)) {
        add(95, toneFromSigned(gold15, 0), 'Economia', side(gold15) + ' crea un vantaggio che nasce proprio da questo matchup',
          'Oro al minuto 15 (' + fmtSigned(gold15, 0, '') + ') e vantaggio specifico in oro (' + fmtSigned(exGold15, 0, '') + ') concordano: non è soltanto un effetto della forza abituale del campione.');
      } else if (Math.abs(gold15) >= 420 && Math.abs(exGold15) < 180) {
        add(84, toneFromSigned(gold15, 0), 'Economia', 'Il vantaggio in oro dipende soprattutto dal campione',
          side(gold15) + ' è avanti in oro al minuto 15, ma il confronto specifico aggiunge poco: buona parte del margine deriva dal rendimento abituale del campione.');
      } else if (Math.abs(exGold15) >= 300 && Math.abs(gold15) < 360) {
        add(87, toneFromSigned(exGold15, 0), 'Vantaggio specifico', 'Il matchup aggiunge un vantaggio che il totale nasconde',
          'L’oro totale è vicino, ma rispetto alle aspettative il matchup favorisce ' + side(exGold15) + ': questa coppia modifica l’equilibrio più di quanto mostri il solo oro totale.');
      }
    }

    if (isNum(gold15) && isNum(goldNoBounty) && Math.abs(gold15) >= 450) {
      if (oppositeSign(gold15, goldNoBounty)) {
        add(97, 'danger', 'Rischio legato alle taglie', 'Le taglie stanno cambiando completamente il vantaggio in oro',
          'L’oro totale favorisce un lato, ma senza le taglie favorirebbe l’altro. Il vantaggio è fragile e può cambiare con un singolo shutdown.');
      } else if (isNum(bountyShare) && Math.abs(bountyShare) >= 0.85 && Math.abs(goldNoBounty) < Math.abs(gold15) * 0.55) {
        add(91, 'warning', 'Rischio legato alle taglie', 'Gran parte del vantaggio arriva dalle taglie',
          'Quota del vantaggio in oro dovuta alle taglie: ' + fmtSignedPct(bountyShare, 1) + '. Senza bounty il margine scende a ' + fmtSigned(goldNoBounty, 0, '') + ' oro.');
      }
    }

    if (isNum(kdPressure) || isNum(excessKd)) {
      if (isNum(kdPressure) && isNum(excessKd) && Math.abs(kdPressure) >= 2.5 && Math.abs(excessKd) >= 1.8 && sameSign(kdPressure, excessKd)) {
        add(94, toneFromSigned(kdPressure, 0), 'Vantaggio negli scambi', side(kdPressure) + ' vince gli scambi in modo coerente',
          'Saldo kill-morti al minuto 15 ' + fmtSigned(kdPressure, 2) + ' e valore specifico del matchup ' + fmtSigned(excessKd, 2) + ' concordano: questo confronto produce un vantaggio negli scontri oltre a quello normalmente atteso.');
      } else if (isNum(kdPressure) && Math.abs(kdPressure) >= 3) {
        add(86, toneFromSigned(kdPressure, 0), 'Vantaggio negli scambi', side(kdPressure) + ' ottiene scambi migliori nei primi 15 minuti',
          'Differenza kill ' + fmtSigned(killDiff, 2) + ', differenza morti ' + fmtSigned(deathDiff, 2) + ', saldo complessivo ' + fmtSigned(kdPressure, 2) + '.');
      } else if (isNum(kdPressure) && isNum(excessKd) && oppositeSign(kdPressure, excessKd) && Math.abs(excessKd) >= 1.5) {
        add(88, 'warning', 'Vantaggio negli scambi', 'Il rendimento abituale dei campioni può ingannare',
          'Il dato totale e quello corretto per il rendimento abituale vanno in direzioni opposte: non scegliere il piano di lane guardando solo le kill.');
      }
    }

    if (isNum(bountyDiff) && Math.abs(bountyDiff) >= 280) {
      var cleanBounty = isNum(excessBounty) && sameSign(bountyDiff, excessBounty) && Math.abs(excessBounty) >= 220;
      add(cleanBounty ? 90 : 81, toneFromSigned(bountyDiff, 0), 'Taglie', side(bountyDiff) + ' ottiene più oro utile dagli scontri',
        'Saldo taglie al minuto 15: ' + fmtSigned(bountyDiff, 0) + (isNum(excessBounty) ? ' · parte specifica del matchup: ' + fmtSigned(excessBounty, 0) : '') + '. ' + (cleanBounty ? 'Il vantaggio resta anche dopo aver considerato il rendimento abituale dei campioni.' : 'Una parte del margine può dipendere dal modo in cui questi campioni giocano normalmente.'));
    }

    if (snow && snow.sensitivity >= 0.14) {
      var tSnow = snowballTier(snow.sensitivity);
      var aheadSide = isNum(snow.aheadPct) && Math.abs(snow.aheadPct - 0.5) >= 0.06 ? (snow.aheadPct > 0.5 ? champA : champB) : null;
      add(snow.sensitivity >= 0.22 ? 96 : 89, tSnow.cls, 'Peso del primo vantaggio', 'Il primo vantaggio pesa più del solito',
        'La differenza tra essere avanti o indietro al minuto 15 è ' + fmtPP(snow.sensitivity, 1) + '. ' + (aheadSide ? aheadSide + ' arriva più spesso avanti al minuto 15.' : 'Gestione delle wave, reset e presenza del jungler hanno un peso particolarmente alto.'));
    }
    if (isNum(snowQuality) && snowQuality >= 42 && isNum(snowConversion) && snowConversion >= 0.22) {
      add(snowQuality >= 55 ? 93 : 85, 'warning', 'Solidità del vantaggio', 'Il vantaggio iniziale viene trasformato bene in vittorie',
        'Qualità del vantaggio ' + fmtDec(snowQuality, 1) + ' e capacità di sfruttarlo ' + fmtPP(snowConversion, 1) + ': quando questa lane va avanti, il margine tende a restare utile anche più tardi.');
    }
    if (isNum(volatility) && volatility >= 9) {
      add(volatility >= 16 ? 89 : 76, 'warning', 'Partite variabili', 'Il matchup può svilupparsi in modi molto diversi',
        'Variabilità osservata ' + fmtDec(volatility, 2) + '. Evita un piano troppo rigido: le partite con questi campioni possono prendere direzioni molto diverse.');
    }

    if (isNum(resourcePressure) && Math.abs(resourcePressure) >= 5) {
      add(Math.abs(resourcePressure) >= 12 ? 92 : 83, toneFromSigned(resourcePressure, 0), 'Risorse', side(resourcePressure) + ' sfrutta meglio il vantaggio di oro e XP',
        'Impatto stimato di oro e XP sull’esito: ' + fmtSigned(resourcePressure, 2, ' pp') + '. Tiene conto sia del vantaggio di risorse sia di quanto ciascun campione riesce normalmente a usarlo.');
    }

    if (isNum(xp15) && Math.abs(xp15) >= 420) {
      add(79, toneFromSigned(xp15, 0), 'Timing XP', side(xp15) + ' raggiunge prima i momenti di forza',
        'XP al minuto 15: ' + fmtSigned(xp15, 0, '') + (isNum(exXp15) ? ' · XP specifica del matchup: ' + fmtSigned(exXp15, 0, '') : '') + '. Un livello o una ultimate in anticipo possono contare più dell’oro.');
    }
    if (isNum(level6) && Math.abs(level6) >= 0.25) {
      var sideL6 = level6 < 0 ? champA : champB;
      add(72, level6 < 0 ? 'a' : 'b', 'Livello 6', sideL6 + ' raggiunge prima il livello 6',
        'Differenza media: ' + fmtDec(Math.abs(level6), 2) + ' minuti. In quella finestra può cercare trade, all-in o pressione sulla mappa prima dell’avversario.');
    }

    if (obj && Math.abs(obj.edge) >= 0.07) {
      add(78, toneFromSigned(obj.edge, 0), state.role === 'JUNGLE' ? 'Obiettivi' : 'Torri', side(obj.edge) + ' controlla più spesso il primo obiettivo importante',
        obj.label + ': ' + fmtPct(Math.max(obj.pct, 1 - obj.pct), 1) + '. Questo vantaggio conta soprattutto se la squadra usa la priorità di corsia per muoversi per prima.');
    }
    if (isNum(firstBlood) && Math.abs(firstBlood - 0.5) >= 0.09) {
      add(76, toneFromSigned(firstBlood - 0.5, 0), 'Primo evento', side(firstBlood - 0.5) + ' ottiene più spesso la prima kill della partita',
        'Prima kill della partita: ' + fmtPct(Math.max(firstBlood, 1 - firstBlood), 1) + '. Prima kill nel duello: ' + fmtPct(firstKill, 1) + '; probabilità che muoia per primo ' + champA + ': ' + fmtPct(firstDeath, 1) + '.');
    }
    if (state.role === 'JUNGLE' && isNum(seqScore) && Math.abs(seqScore) >= 0.10 && (!isNum(seqEvents) || seqEvents >= 7)) {
      add(Math.abs(seqScore) >= 0.22 ? 92 : 82, toneFromSigned(seqScore, 0), 'Sequenza mostri', side(seqScore) + ' controlla meglio la serie di obiettivi neutrali',
        'Indicatore di controllo degli obiettivi ' + fmtSigned(seqScore, 3) + ', differenza media di mostri ' + fmtSigned(seqDiff, 2) + ' su ' + fmtInt(seqEvents) + ' eventi. Non guarda soltanto il primo drago o araldo, ma l’intera sequenza.');
    }
    if (isNum(objectiveConversion) && Math.abs(objectiveConversion) >= 0.03) {
      add(80, toneFromSigned(objectiveConversion, 0), 'Conversione', side(objectiveConversion) + ' trasforma meglio la pressione in obiettivi',
        'Indicatore di conversione degli obiettivi: ' + fmtSigned(objectiveConversion, 4) + '.');
    }

    if (isNum(killEfficiency) && Math.abs(killEfficiency) >= 900) {
      add(Math.abs(killEfficiency) >= 1500 ? 86 : 74, 'warning', 'Valore delle kill', 'Anche poche kill possono creare molto oro',
        'Oro creato per ogni kill di vantaggio: ' + fmtDec(killEfficiency, 1) + ' oro. Il matchup può diventare molto sbilanciato economicamente anche senza molte kill.');
    }

    if (isNum(comebackA) && isNum(comebackB) && Math.abs(comebackA - comebackB) >= 260) {
      var riskDiff = comebackA - comebackB;
      var exposed = riskDiff > 0 ? champA : champB;
      add(Math.abs(riskDiff) >= 650 ? 88 : 75, toneFromSigned(-riskDiff, 0), 'Rischio di rimonta', exposed + ' rischia di regalare più oro con uno shutdown',
        'Valore potenzialmente esposto: ' + champA + ' ' + fmtInt(comebackA) + ' vs ' + champB + ' ' + fmtInt(comebackB) + '. Il campione più carico di taglia deve evitare morti isolate e reset rischiosi.');
    }

    if (isNum(baseAdv)) {
      add(63, toneFromSigned(baseAdv, 0.01), 'Confronto con il rendimento abituale', 'Quanto il matchup cambia il rendimento abituale',
        'Differenza rispetto al rendimento abituale: ' + fmtSignedPP(baseAdv, 1) + '. Se non concorda con percentuale di vittorie, andamento di oro/XP e timing, dai più peso a questi ultimi.');
    }

    return selectTopInsightCards(items);
  }

  function insightRelevance(weight) {
    if (weight >= 94) return { label: 'Rilevanza molto alta', cls: 'very-high' };
    if (weight >= 82) return { label: 'Rilevanza alta', cls: 'high' };
    if (weight >= 66) return { label: 'Rilevanza media', cls: 'medium' };
    return { label: 'Rilevanza bassa', cls: 'low' };
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
      var label = tone === 'neutral' ? 'Equilibrio' : (tone === 'a' ? state.champA : state.champB);
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

    var outlook = Math.abs(wrEdge) < 0.02 ? 'Matchup quasi pari' : favoredName + ' leggermente avanti';
    if (Math.abs(wrEdge) >= 0.07) outlook = favoredName + ' ha un vantaggio netto';
    else if (Math.abs(wrEdge) >= 0.04) outlook = favoredName + ' avanti';

    var html = '';
    html += '<section class="v2-hero">';
    html += '<div class="v2-hero-top"><div><div class="v2-eyebrow">Lettura del confronto · ' + esc(ROLE_LABELS[role]) + '</div>';
    html += '<h2><span class="name-a">' + esc(champA) + '</span><em>vs</em><span class="name-b">' + esc(champB) + '</span></h2>';
    html += '<p>' + esc(outlook) + '. La lettura combina i risultati del confronto diretto, il rendimento abituale dei campioni, i primi 15 minuti e il numero di partite disponibili.</p></div>';
    html += '<div class="sample-badge ' + conf.level + '"><span class="dot"></span>' + conf.label + ' · ' + fmtInt(n) + ' partite</div></div>';
    html += '<div class="v2-verdict-main"><div class="v2-big-number ' + (favoredIsLeft ? 'a' : 'b') + '"><span>Segnale principale</span><strong>' + fmtPct(favoredWr, 1) + '</strong><em>' + esc(favoredName) + '</em></div>';
    html += '<div class="v2-winrail"><div class="tick50"></div><div class="left" style="width:' + Math.max(0, Math.min(100, wr[0] * 100)) + '%"><span>' + fmtPct(wr[0], 1) + '</span></div><div class="right" style="width:' + Math.max(0, Math.min(100, wr[1] * 100)) + '%"><span>' + fmtPct(wr[1], 1) + '</span></div></div></div>';
    html += '<div class="v2-kpi-row">';
    html += '<div class="v2-kpi ' + toneFromSigned(diffWr[0] - diffWr[1], 0.005) + '"><span>Scarto dal rendimento abituale</span><strong>' + fmtSignedPP((isNum(diffWr[0]) && isNum(diffWr[1])) ? diffWr[0] - diffWr[1] : null, 1) + '</strong><em>confronto diretto rispetto alla media</em></div>';
    html += '<div class="v2-kpi ' + toneFromSigned(gold15, 80) + '"><span>Oro @15</span><strong>' + (isNum(gold15) ? (gold15 > 0 ? '+' : '') + fmtInt(gold15) : '—') + '</strong><em>vantaggio early reale</em></div>';
    html += '<div class="v2-kpi ' + toneFromSigned(exGold15, 60) + '"><span>Oro dovuto al matchup al minuto 15</span><strong>' + (isNum(exGold15) ? (exGold15 > 0 ? '+' : '') + fmtInt(exGold15) : '—') + '</strong><em>effetto specifico matchup</em></div>';
    html += '<div class="v2-kpi ' + tier.cls + '"><span>Peso del primo vantaggio</span><strong>' + (snow ? fmtPP(snow.sensitivity, 1) : '—') + '</strong><em>' + esc(tier.label) + '</em></div>';
    if (obj) html += '<div class="v2-kpi ' + toneFromSigned(obj.edge, 0.02) + '"><span>' + esc(obj.label) + '</span><strong>' + fmtPct(Math.max(obj.pct, 1 - obj.pct), 1) + '</strong><em>' + esc(sideName(toneFromSigned(obj.edge, 0.02))) + '</em></div>';
    html += '</div>';
    html += '<div class="v2-hero-insights"><div class="card-head"><h3>Insight decisivi</h3><span class="card-sub">Solo segnali con peso reale: convergenza, timing, snowball o rischio dato.</span></div>' + insightCardsHtml(M) + '</div>';
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
    return '<div class="v2-radar-card"><div class="card-head"><h3>' + esc(title) + '</h3><span class="card-sub">scala 0–100, basata sui percentili di ruolo</span></div>' +
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
      { label: 'Vittorie', a: pctile(pa, 'general_winrate'), b: pctile(pb, 'general_winrate') },
      { label: 'Danno', a: pctile(pa, 'avg_damage_to_champs'), b: pctile(pb, 'avg_damage_to_champs') },
      { label: 'Tenuta', a: pctile(pa, 'avg_damage_taken'), b: pctile(pb, 'avg_damage_taken') },
      { label: 'Visione', a: pctile(pa, 'vision_score'), b: pctile(pb, 'vision_score') },
      { label: 'CC', a: pctile(pa, 'avg_total_time_cc_dealt'), b: pctile(pb, 'avg_total_time_cc_dealt') },
      { label: 'Lvl 6', a: pctile(pa, 'avg_level6_minute', true), b: pctile(pb, 'avg_level6_minute', true) }
    ];
    var economyAxes = [
      { label: 'Gold dep.', a: pctile(pa, 'goldxp_winpct_per_1k_gold'), b: pctile(pb, 'goldxp_winpct_per_1k_gold') },
      { label: 'XP dep.', a: pctile(pa, 'goldxp_winpct_per_1k_xp'), b: pctile(pb, 'goldxp_winpct_per_1k_xp') },
      { label: 'Risorse → vittoria', a: pctile(pa, 'goldxp_auc'), b: pctile(pb, 'goldxp_auc') },
      { label: 'Visione', a: pctile(pa, 'vision_score'), b: pctile(pb, 'vision_score') },
      { label: 'Arrivo al livello 6', a: pctile(pa, 'avg_level6_minute', true), b: pctile(pb, 'avg_level6_minute', true) }
    ];
    var killAxes = [
      { label: 'Kill entro 15 min', a: pctile(pa, 'avg_kills_0_15m'), b: pctile(pb, 'avg_kills_0_15m') },
      { label: 'Death 15', a: pctile(pa, 'avg_deaths_0_15m', true), b: pctile(pb, 'avg_deaths_0_15m', true) },
      { label: 'Saldo taglie', a: pctile(pa, 'avg_bounty_net'), b: pctile(pb, 'avg_bounty_net') },
      { label: 'Taglia media per kill', a: pctile(pa, 'avg_bounty_per_kill'), b: pctile(pb, 'avg_bounty_per_kill') },
      { label: 'Serie di kill', a: pctile(pa, 'avg_kill_streak_on_kill'), b: pctile(pb, 'avg_kill_streak_on_kill') },
      { label: 'Taglie incassate', a: pctile(pa, 'shutdown_collected_rate'), b: pctile(pb, 'shutdown_collected_rate') },
      { label: 'Taglie regalate', a: pctile(pa, 'shutdown_given_rate', true), b: pctile(pb, 'shutdown_given_rate', true) }
    ];
    var diffRows = [
      { label: 'Danno ai campioni', value: (M.pair('avg_damage_to_champs')[0] || 0) - (M.pair('avg_damage_to_champs')[1] || 0), scale: 7000, format: function (v) { return (v > 0 ? '+' : '') + fmtInt(v); } },
      { label: 'Danno subito', value: (M.pair('avg_damage_taken')[0] || 0) - (M.pair('avg_damage_taken')[1] || 0), scale: 7000, format: function (v) { return (v > 0 ? '+' : '') + fmtInt(v); } },
      { label: 'Vision score', value: M.diffAB('vision_diff_a_minus_b'), scale: 12, format: function (v) { return fmtSigned(v, 1); } },
      { label: 'CC totale', value: (M.pair('avg_total_time_cc_dealt')[0] || 0) - (M.pair('avg_total_time_cc_dealt')[1] || 0), scale: 18, format: function (v) { return (v > 0 ? '+' : '') + fmtDec(v, 1) + 's'; } },
      { label: 'Kill entro 15 min', value: (M.pair('avg_kills_0_15m')[0] || 0) - (M.pair('avg_kills_0_15m')[1] || 0), scale: 0.9, format: function (v) { return fmtSigned(v, 3); } },
      { label: 'Saldo taglie', value: (M.pair('avg_bounty_net')[0] || 0) - (M.pair('avg_bounty_net')[1] || 0), scale: 260, format: function (v) { return fmtSigned(v, 1); } },
      { label: 'Rischio di regalare una taglia', value: (M.pair('shutdown_given_rate')[0] || 0) - (M.pair('shutdown_given_rate')[1] || 0), scale: 0.18, format: function (v) { return fmtSignedPct(v, 1); } }
    ];
    var html = '<div class="panel-grid v2-overview">';
    html += '<div class="card full-span"><div class="card-head"><h3>Identità del matchup</h3><span class="card-sub">I radar usano percentili normalizzati: profilo generale, economia e nuovo blocco kill/bounty.</span></div><div class="v2-radar-grid">' + radarSvg('Profilo generale', identityAxes, pa, pb) + radarSvg('Economia e tempo', economyAxes, pa, pb) + radarSvg('Scontri e taglie', killAxes, pa, pb) + '</div></div>';
    html += '<div class="card"><div class="card-head"><h3>Confronto rapido</h3><span class="card-sub">Barre divergenti: sinistra/blu ' + esc(champA) + ', destra/rosso ' + esc(champB) + '.</span></div>' + miniBarsHtml(diffRows) + '</div>';
    html += '<div class="card"><div class="card-head"><h3>Composizione danno</h3><span class="card-sub">Fisico, magico e puro restano separati.</span></div>' + damageStackRow('a', champA, M.pair('pct_physical_dmg')[0], M.pair('pct_magic_dmg')[0], M.pair('pct_true_dmg')[0]) + damageStackRow('b', champB, M.pair('pct_physical_dmg')[1], M.pair('pct_magic_dmg')[1], M.pair('pct_true_dmg')[1]) + '<div class="dmg-legend"><span><i style="background:var(--dmg-phys)"></i>Fisico</span><span><i style="background:var(--dmg-magic)"></i>Magico</span><span><i style="background:var(--dmg-true)"></i>Puro</span></div></div>';
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
    var resourcePressure = M.direct('resource_winpct_pressure_estimate_a_15m');

    var econRows = [
      { label: 'Oro @15', value: gold15, scale: 2200, format: function (v) { return isNum(v) ? (v > 0 ? '+' : '') + fmtInt(v) : '—'; } },
      { label: 'XP @15', value: xp15, scale: 2200, format: function (v) { return isNum(v) ? (v > 0 ? '+' : '') + fmtInt(v) : '—'; } },
      { label: 'Oro specifico del matchup @15', value: exGold15, scale: 1400, format: function (v) { return isNum(v) ? (v > 0 ? '+' : '') + fmtInt(v) : '—'; } },
      { label: 'XP specifica del matchup @15', value: exXp15, scale: 1400, format: function (v) { return isNum(v) ? (v > 0 ? '+' : '') + fmtInt(v) : '—'; } }
    ];

    var html = '<div class="panel-grid v2-economy">';
    html += '<div class="card full-span v2-snowball-card ' + tier.cls + '"><div class="card-head"><h3>Quanto pesa il primo vantaggio</h3><span class="card-sub">Combina quanto bene il vantaggio viene mantenuto, quanto cambia tra le partite e quanto spesso porta davvero alla vittoria.</span></div>';
    html += '<div class="snowball-visual"><div class="snowball-core"><span>Sensibilità</span><strong>' + (snow ? fmtPP(snow.sensitivity, 1) : '—') + '</strong><em>' + esc(tier.label) + '</em></div><div class="snowball-copy"><p>' + esc(tier.copy) + '</p>' +
      '<div class="snowball-split"><div><span>Vittorie di ' + esc(champA) + ' se avanti al 15</span><strong>' + (snow ? fmtPct(snow.leftAhead, 1) : '—') + '</strong></div><div><span>Vittorie di ' + esc(champA) + ' se indietro al 15</span><strong>' + (snow ? fmtPct(snow.leftBehind, 1) : '—') + '</strong></div><div><span>Capacità di sfruttare il vantaggio</span><strong>' + fmtSignedPct(snowConv, 1) + '</strong></div><div><span>Legame tra oro e vittoria</span><strong>' + fmtDec(corr, 3) + '</strong></div><div><span>Volatilità index</span><strong>' + fmtDec(volatilityIdx, 2) + '</strong></div><div><span>Oscillazione dell’oro</span><strong>' + fmtInt(std) + '</strong></div></div></div></div></div>';

    html += '<div class="card"><div class="card-head"><h3>Economia early</h3><span class="card-sub">Il gold reale indica pressione; l’excess gold isola l’effetto specifico del matchup.</span></div>' + miniBarsHtml(econRows) + '</div>';

    html += '<div class="card"><div class="card-head"><h3>Conversione risorse</h3><span class="card-sub">Distingue lead grezzo, lead depurato dal bounty e valore per kill.</span></div>' + miniBarsHtml([
      { label: 'Quanto dipende dall’oro', value: M.diffAB('goldxp_gold_dependency_diff_a_minus_b'), scale: 5, format: function (v) { return fmtSigned(v, 2); } },
      { label: 'Quanto dipende dall’XP', value: M.diffAB('goldxp_xp_dependency_diff_a_minus_b'), scale: 5, format: function (v) { return fmtSigned(v, 2); } },
      { label: 'Oro senza taglie', value: goldNoBounty, scale: 2200, format: function (v) { return fmtSigned(v, 1); } },
      { label: 'Oro ottenuto per ogni kill di vantaggio', value: killEfficiency, scale: 900, format: function (v) { return isNum(v) ? fmtDec(v, 1) + 'g' : '—'; } },
      { label: 'Quota del vantaggio dovuta alle taglie', value: bountyShare, scale: 0.55, format: function (v) { return fmtSignedPct(v, 1); } },
      { label: 'Impatto stimato di oro e XP', value: resourcePressure, scale: 8, format: function (v) { return fmtSigned(v, 2, ' pp'); } }
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
    n_matches: 'Partite dirette analizzate',
    low_sample: 'Poche partite disponibili',
    winrate_a: 'Percentuale di vittorie nel matchup',
    general_winrate_a: 'Percentuale di vittorie abituale nel ruolo',
    diff_winrate_a: 'Quanto il matchup cambia il rendimento abituale',
    pct_a_ahead_15m: 'Probabilità di essere avanti al minuto 15',
    winrate_a_when_ahead_15m: 'Vittorie quando è avanti al minuto 15',
    winrate_a_when_behind_15m: 'Vittorie quando è indietro al minuto 15',
    snowball_corr_15m: 'Legame tra vantaggio al 15 e vittoria',
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
    var k = String(key || '').toLowerCase();
    if (/excess_(gold|xp)_diff_by_minute/.test(k)) return 'Mostra il vantaggio di oro o XP che nasce da questo specifico matchup, oltre a quello normalmente atteso dai due campioni.';
    if (/(gold|xp)_diff_by_minute/.test(k)) return 'Segue minuto per minuto la differenza di risorse: positivo favorisce il campione a sinistra, negativo quello a destra.';
    if (/snowball|when_ahead|when_behind/.test(k)) return 'Spiega quanto il primo vantaggio cambia l’esito della partita e quanto è difficile recuperare quando si resta indietro.';
    if (/bounty|shutdown/.test(k)) return 'Misura l’oro ottenuto o concesso tramite taglie e il rischio di restituire il vantaggio con una morte ad alto valore.';
    if (/kill|death|streak/.test(k)) return 'Descrive come vanno gli scontri: kill, morti, serie di uccisioni e saldo tra eventi positivi e negativi.';
    if (/goldxp|resource|auc|winpct_per_1k/.test(k)) return 'Indica quanto oro e XP incidono sul risultato e quanto bene il campione riesce a trasformare le risorse in vittorie.';
    if (/tower/.test(k)) return 'Descrive chi abbatte più spesso la prima torre e con quale anticipo medio.';
    if (/monster|dragon|baron|riftherald|horde/.test(k)) return 'Misura il controllo degli obiettivi neutrali, non soltanto del primo obiettivo ma anche della sequenza complessiva.';
    if (/vision/.test(k)) return 'Stima il contributo medio al controllo della visione e della mappa.';
    if (/damage|physical|magic|true/.test(k)) return 'Descrive quantità e tipo di danno prodotto o assorbito dal campione.';
    if (/cc|time_cc/.test(k)) return 'Misura quanto a lungo il campione limita i nemici con stordimenti, rallentamenti e altri controlli.';
    if (/level6/.test(k)) return 'Minuto medio del livello 6: un valore più basso indica accesso anticipato alla ultimate.';
    if (/winrate|diff_winrate/.test(k)) return 'Confronta la percentuale di vittorie nel matchup con il rendimento abituale del campione nel ruolo.';
    if (/percentile/.test(k)) return 'Posizione da 0 a 100 rispetto agli altri campioni dello stesso ruolo: più alto significa più sopra la media per quella caratteristica.';
    if (/n_matches|coverage|total_games|low_sample/.test(k)) return 'Indica quante partite sostengono il dato: più partite significano una lettura generalmente più stabile.';
    return 'Dato di supporto usato insieme alle altre metriche: non va interpretato da solo.';
  }

  function rawHumanLabel(col) {
    if (PLAIN_METRIC_LABELS[col]) return PLAIN_METRIC_LABELS[col];
    return String(col || '')
      .replace(/_a_minus_b$/g, ' (differenza tra i due campioni)')
      .replace(/_a$/g, ' A')
      .replace(/_b$/g, ' B')
      .replace(/_/g, ' ')
      .replace(/\bavg\b/gi, 'medio')
      .replace(/\bpct\b/gi, 'percentuale')
      .replace(/\bwinrate\b/gi, 'percentuale vittorie')
      .replace(/\b\w/g, function (m) { return m.toUpperCase(); });
  }
  function rawArrayDisplay(arr) {
    if (!Array.isArray(arr)) return '—';
    if (!arr.length) return '[]';
    var picks = [0, 5, 10, 15, arr.length - 1].filter(function (v, i, all) { return v < arr.length && all.indexOf(v) === i; });
    return picks.map(function (i) { return i + ': ' + (isNum(arr[i]) ? fmtSigned(arr[i], 0) : '—'); }).join(' · ') + ' [' + arr.length + ' punti]';
  }
  function rawExportValue(v) {
    if (Array.isArray(v)) return JSON.stringify(v);
    if (v === null || v === undefined) return '';
    return String(v);
  }
  function rawDisplayValue(col, v) {
    if (Array.isArray(v)) return rawArrayDisplay(v);
    if (v === null || v === undefined || (typeof v === 'number' && !isNum(v))) return '—';
    if (typeof v === 'boolean') return v ? 'Sì' : 'No';
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
        a = M.pctA(col); b = isNum(a) ? 1 - a : null;
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
        a: isNum(av) ? fmtDec(av, 1) : '—', b: isNum(bv) ? fmtDec(bv, 1) : '—', median: 'scala 0–100',
        exportA: rawExportValue(av), exportB: rawExportValue(bv), exportMedian: '0-100'
      });
    });
    ['n_matchups', 'total_games'].forEach(function (key) {
      var av = pa.coverage ? pa.coverage[key] : null;
      var bv = pb.coverage ? pb.coverage[key] : null;
      rows.push({ label: rawHumanLabel(key), source: 'championProfiles.coverage.' + key, a: fmtInt(av), b: fmtInt(bv), median: '—', exportA: rawExportValue(av), exportB: rawExportValue(bv), exportMedian: '' });
    });
    var risks = profileRiskPair();
    rows.push({ label: 'Oro esposto a una possibile rimonta', source: 'avg_bounty_net × shutdown_given_rate', a: fmtDec(risks[0], 1), b: fmtDec(risks[1], 1), median: '—', exportA: rawExportValue(risks[0]), exportB: rawExportValue(risks[1]), exportMedian: '' });
    return rows;
  }

  var VISUAL_ATLAS_FAMILIES = [
    { id: 'outcome', title: 'Risultati & affidabilità', short: 'Risultati', test: function (key) { return /(^|\.)(n_matches|low_sample|winrate_|general_winrate_|diff_winrate_)/.test(key); } },
    { id: 'timeline', title: 'Risorse nel tempo', short: 'Risorse', test: function (key) { return /gold_diff_by_minute|xp_diff_by_minute|excess_gold_diff_by_minute|excess_xp_diff_by_minute/.test(key); } },
    { id: 'combat', title: 'Danno, controlli & visione', short: 'Combattimento', test: function (key) { return /pct_(physical|magic|true)_dmg|avg_damage|avg_time_cc|avg_total_time_cc|vision/.test(key); } },
    { id: 'kill', title: 'Scontri, taglie & rischi', short: 'Scontri', test: function (key) { return /kill|death|bounty|streak|shutdown/.test(key) && !/monster_kill/.test(key); } },
    { id: 'map', title: 'Torri & prime azioni', short: 'Mappa', test: function (key) { return /tower|first_blood|first_dragon|first_baron|first_horde|first_riftherald|n_matches_(dragon|baron|horde|riftherald)/.test(key); } },
    { id: 'snowball', title: 'Peso del vantaggio & rimonta', short: 'Vantaggio', test: function (key) { return /ahead_15m|when_ahead|when_behind|snowball|volatility|comeback|gold_diff_std/.test(key); } },
    { id: 'monsters', title: 'Mostri & sequenze', short: 'Mostri', test: function (key) { return /monster|event_count_/.test(key); } },
    { id: 'models', title: 'Dipendenza dalle risorse', short: 'Risorse → vittoria', test: function (key) { return /goldxp_|resource_winpct|auc|level6/.test(key); } },
    { id: 'advanced', title: 'Efficienza & vantaggio specifico', short: 'Approfondimenti', test: function (key) { return /early_kd|excess_|per_kill|without_bounty|bounty_share|kill_value|objective_conversion/.test(key); } },
    { id: 'other', title: 'Altri dati utili', short: 'Altro', test: function () { return true; } }
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
      stage = '<div class="metric-pair-stage"><div class="metric-side a"><span>' + esc(state.champA) + '</span><strong>' + esc(row.a) + '</strong></div><div class="metric-balance"><i class="a" style="--metric-fill:' + fills[0].toFixed(1) + '"></i><i class="b" style="--metric-fill:' + fills[1].toFixed(1) + '"></i>' + (isProfile && row.median && row.median !== '—' ? '<small class="metric-benchmark">mediana ' + esc(row.median) + '</small>' : '') + '</div><div class="metric-side b"><span>' + esc(state.champB) + '</span><strong>' + esc(row.b) + '</strong></div></div>';
    } else {
      var single = visualAtlasNum(row.exportA);
      var fill = single === null ? 18 : Math.max(8, Math.min(100, Math.abs(single) <= 1 ? Math.abs(single) * 100 : 56));
      stage = '<div class="metric-single-stage"><span>Valore dal punto di vista del campione a sinistra</span><strong>' + esc(row.a) + '</strong><i style="--single-fill:' + fill.toFixed(1) + '%"></i></div>';
    }
    return '<article class="metric-viz-card" data-atlas-search="' + esc((row.label + ' ' + row.source + ' ' + family.title).toLowerCase()) + '"><div class="metric-viz-head"><span>' + esc(family.short) + '</span><em>' + String(index + 1).padStart(2, '0') + '</em></div><h4>' + esc(row.label) + '</h4>' + stage + '<p class="metric-help">' + esc(plainMetricDescription(row.source)) + '</p><details class="metric-source"><summary>Nome tecnico nel dataset</summary><code>' + esc(row.source) + '</code>' + (isProfile && row.median && row.median !== '—' ? '<small>Valore tipico del ruolo: ' + esc(row.median) + '</small>' : '') + '</details></article>';
  }

  function renderRaw(M) {
    var champA = state.champA, champB = state.champB;
    var rows = buildCompleteRawRows(M).map(function (row) {
      row.family = visualAtlasFamily(row.source);
      row.key = visualAtlasSourceKey(row.source);
      return row;
    });
    var profileRows = buildCompleteProfileRows().map(function (row) {
      row.family = { id: 'profile', title: 'Profili & confronto con il ruolo', short: 'Profilo' };
      row.key = row.source;
      return row;
    });
    var mode = 'essential';
    var family = 'all';
    var query = '';
    var panel = document.getElementById('panel-raw');

    panel.innerHTML = '<div class="metric-atlas-v2"><section class="metric-atlas-intro"><div><div class="micro-label">Tutti i dati</div><h3>Tutte le metriche, organizzate per essere leggibili.</h3><p>La vista Essenziale mostra prima i dati più utili per preparare il matchup. La vista Completa permette di approfondire tutte le ' + fmtInt(DATA.matchupColumns.length) + ' metriche del confronto, i profili dei campioni, il confronto con gli altri campioni del ruolo e il numero di partite disponibili.</p></div><div class="metric-atlas-score"><span>Metriche disponibili</span><strong>' + fmtInt(DATA.matchupColumns.length) + '/' + fmtInt(DATA.matchupColumns.length) + '</strong><em>dati organizzati</em></div></section><div class="atlas-commandbar"><label><span class="visually-hidden">Cerca metrica</span><input id="rawFilter" type="search" placeholder="Cerca kill, taglie, livello 6, torre o drago…"></label><div class="atlas-mode"><button type="button" data-mode="essential" class="active">Essenziale</button><button type="button" data-mode="complete">Completa</button></div></div><div class="atlas-family-chips" id="rawFamilyChips"></div><div class="atlas-status" id="rawAtlasStatus"></div><div class="atlas-groups" id="rawAtlasGroups"></div></div>';

    var chipTarget = document.getElementById('rawFamilyChips');
    chipTarget.innerHTML = '<button type="button" data-family="all" class="active">Tutte</button>' + VISUAL_ATLAS_FAMILIES.filter(function (f) { return f.id !== 'other'; }).map(function (f) { return '<button type="button" data-family="' + esc(f.id) + '">' + esc(f.short) + '</button>'; }).join('') + '<button type="button" data-family="profile">Profili</button>';

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
        return '<details class="atlas-family-v2" ' + (gi < 2 ? 'open' : '') + '><summary><div><span>' + String(gi + 1).padStart(2, '0') + '</span><strong>' + esc(group.fam.title) + '</strong></div><em>' + fmtInt(group.rows.length) + ' carte</em></summary><div class="metric-viz-grid">' + group.rows.map(function (row, i) { return visualAtlasCard(row, group.fam, i, false); }).join('') + '</div></details>';
      }).join('');
      var profiles = profileRows.filter(function (row) {
        if (mode === 'essential' && !profileEssential(row)) return false;
        if (family !== 'all' && family !== 'profile') return false;
        return !q || (row.label + ' ' + row.source).toLowerCase().indexOf(q) !== -1;
      });
      if (profiles.length) html += '<div class="atlas-divider">Profili & benchmark</div><details class="atlas-family-v2" ' + (family === 'profile' ? 'open' : '') + '><summary><div><span>P</span><strong>Profili campione</strong></div><em>' + fmtInt(profiles.length) + ' carte</em></summary><div class="metric-viz-grid">' + profiles.map(function (row, i) { return visualAtlasCard(row, row.family, i, true); }).join('') + '</div></details>';
      document.getElementById('rawAtlasGroups').innerHTML = html || '<div class="empty-note">Nessuna metrica corrisponde al filtro.</div>';
      document.getElementById('rawAtlasStatus').innerHTML = '<strong>' + fmtInt(visible.length) + '</strong><span>carte matchup</span><i></i><span>' + (mode === 'essential' ? 'dati principali' : fmtInt(DATA.matchupColumns.length) + ' colonne sorgente') + '</span>';
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
    html += '<div class="card full-span"><div class="card-head"><div><h3>Andamento partita</h3><span class="card-sub">Sopra lo zero favorisce <span style="color:var(--champ-a)">' + esc(champA) + '</span>; sotto lo zero favorisce <span style="color:var(--champ-b)">' + esc(champB) + '</span>.</span></div></div>';
    html += '<div class="river-controls" id="trajControls">' + Object.keys(TRAJ_MODES).map(function (k) { return '<button class="river-btn' + (state.trajMode === k ? ' active' : '') + '" data-mode="' + k + '">' + TRAJ_MODES[k].label + '</button>'; }).join('') + '</div>';
    html += '<div class="river-note" id="trajNote"></div><div class="river-svg-wrap" id="trajSvgWrap"></div><div class="river-legend"><span><i style="background:var(--champ-a)"></i>' + esc(champA) + '</span><span><i style="background:var(--champ-b)"></i>' + esc(champB) + '</span></div></div>';
    html += '<div class="card"><div class="card-head"><h3>Checkpoint @15</h3><span class="card-sub">Lettura rapida del punto medio della lane.</span></div>' + miniBarsHtml([
      { label: 'Oro @15', value: gold15, scale: 2200, format: function (v) { return isNum(v) ? (v > 0 ? '+' : '') + fmtInt(v) : '—'; } },
      { label: 'XP @15', value: xp15, scale: 2200, format: function (v) { return isNum(v) ? (v > 0 ? '+' : '') + fmtInt(v) : '—'; } },
      { label: 'Oro specifico del matchup @15', value: exGold15, scale: 1400, format: function (v) { return isNum(v) ? (v > 0 ? '+' : '') + fmtInt(v) : '—'; } },
      { label: 'XP specifica del matchup @15', value: exXp15, scale: 1400, format: function (v) { return isNum(v) ? (v > 0 ? '+' : '') + fmtInt(v) : '—'; } }
    ]) + '</div>';
    var profiles = DATA.championProfiles[state.role] || {};
    var pa = profiles[champA] || {}, pb = profiles[champB] || {};
    var l6a = pa.avg_level6_minute, l6b = pb.avg_level6_minute;
    html += '<div class="card"><div class="card-head"><h3>Livello 6</h3><span class="card-sub">Timing medio nel ruolo: più basso significa spike prima.</span></div>';
    if (isNum(l6a) || isNum(l6b)) {
      var maxAx = Math.max(12, (l6a || 0) + 1, (l6b || 0) + 1);
      html += '<div class="axis-mini"><div class="line"></div>';
      if (isNum(l6a)) html += '<div class="pt a" style="left:' + (l6a / maxAx * 100) + '%"><div class="dot"></div><div class="lbl">' + esc(champA) + ' · ' + fmtDec(l6a, 2) + '\'</div></div>';
      if (isNum(l6b)) html += '<div class="pt b" style="left:' + (l6b / maxAx * 100) + '%"><div class="dot"></div><div class="lbl">' + esc(champB) + ' · ' + fmtDec(l6b, 2) + '\'</div></div>';
      html += '</div>';
    } else {
      html += '<div class="empty-note">Dato non disponibile per almeno uno dei due campioni.</div>';
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
    html += '<div class="card full-span"><div class="card-head"><h3>Composizione danno</h3><span class="card-sub">Fisico, magico e puro: colori dedicati e non usati per altro.</span></div>' + damageStackRow('a', champA, phys[0], magic[0], truep[0]) + damageStackRow('b', champB, phys[1], magic[1], truep[1]) + '<div class="dmg-legend"><span><i style="background:var(--dmg-phys)"></i>Fisico</span><span><i style="background:var(--dmg-magic)"></i>Magico</span><span><i style="background:var(--dmg-true)"></i>Puro</span></div></div>';
    html += '<div class="card"><div class="card-head"><h3>Danno e tenuta</h3><span class="card-sub">Output e danno assorbito non raccontano la stessa cosa: uno indica presenza, l’altro esposizione/frontline.</span></div>' + miniBarsHtml([
      { label: 'Danno ai campioni', value: (dealt[0] || 0) - (dealt[1] || 0), scale: 7500, format: function (v) { return (v > 0 ? '+' : '') + fmtInt(v); } },
      { label: 'Danno subito', value: (taken[0] || 0) - (taken[1] || 0), scale: 7500, format: function (v) { return (v > 0 ? '+' : '') + fmtInt(v); } }
    ]) + '</div>';
    html += '<div class="card"><div class="card-head"><h3>Controllo e visione</h3><span class="card-sub">Setup, sicurezza e contributo macro.</span></div>' + miniBarsHtml([
      { label: 'CC medio', value: (ccOthers[0] || 0) - (ccOthers[1] || 0), scale: 16, format: function (v) { return (v > 0 ? '+' : '') + fmtDec(v, 1) + 's'; } },
      { label: 'CC totale', value: (ccTotal[0] || 0) - (ccTotal[1] || 0), scale: 24, format: function (v) { return (v > 0 ? '+' : '') + fmtDec(v, 1) + 's'; } },
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
      '<thead><tr><th>Fase</th><th colspan="3">' + esc(champA) + '</th><th colspan="3">' + esc(champB) + '</th></tr>' +
      '<tr><th></th><th>Saldo scontri</th><th>Saldo taglie</th><th>Vittorie dopo una kill</th><th>Saldo scontri</th><th>Saldo taglie</th><th>Vittorie dopo una kill</th></tr></thead>' +
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
    var leader = !isNum(diff) || Math.abs(diff) < 0.0001 ? 'Equilibrio' : (diff > 0 ? state.champA : state.champB);
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
    if (!nums.length) return '<article class="kb-phase-chart"><h4>' + esc(title) + '</h4><div class="empty-note">Dato non disponibile.</div></article>';
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
    // Nel dataset “A first death” equivale a “B first kill”: non è il complemento.
    var firstKillB = M.pctA('pct_a_first_death_in_pair');

    var bNet15 = M.pair('avg_bounty_net_0_15m');
    var bPerKill = M.pair('avg_bounty_per_kill');
    var shutdownTake = M.pair('shutdown_collected_rate');
    var shutdownGive = M.pair('shutdown_given_rate');

    var pressureTone = toneFromSigned(kdPressure, 0.05);
    var pressureLeader = sideName(pressureTone);
    var headline = pressureTone === 'neutral'
      ? 'Gli scontri nei primi 15 minuti sono sostanzialmente equilibrati.'
      : pressureLeader + ' tende a ottenere scambi più vantaggiosi entro il minuto 15.';
    var explanation = pressureTone === 'neutral'
      ? 'Kill, morti e taglie restano vicine: per trovare il vero vantaggio conviene guardare anche oro, XP, livello 6, torri e obiettivi.'
      : 'Il dato considera insieme kill ottenute, morti subite e oro delle taglie: combattere di più non significa automaticamente combattere meglio.';

    var html = '<div class="kb-layout">';
    html += '<section class="kb-hero ' + pressureTone + '"><div><div class="micro-label">Lettura degli scontri</div><h3>' + esc(headline) + '</h3><p>' + esc(explanation) + '</p></div>' +
      '<div class="kb-hero-score"><span>Saldo kill-morti al minuto 15</span><strong>' + esc(fmtSigned(kdPressure, 3)) + '</strong><em>' + esc(pressureTone === 'neutral' ? 'equilibrio' : pressureLeader) + '</em></div></section>';

    html += '<section class="kb-signal-grid">' +
      kbSignalHtml('Differenza di kill al minuto 15', kills15, 1.2, function (v) { return fmtSigned(v, 3); }, 'Un valore positivo indica più kill per il campione a sinistra.', false) +
      kbSignalHtml('Differenza di morti al minuto 15', deaths15, 1.2, function (v) { return fmtSigned(v, 3); }, 'Un valore positivo indica più morti subite dal campione a sinistra: in questo caso è uno svantaggio.', true) +
      kbSignalHtml('Differenza nel saldo delle taglie al minuto 15', bounty15, 260, function (v) { return fmtSigned(v, 1); }, 'Oro extra ottenuto con kill e taglie, meno quello regalato morendo.', false) +
      kbSignalHtml('Saldo kill-morti dovuto al matchup', excessKd, 0.8, function (v) { return fmtSigned(v, 3); }, 'Mostra quanto questo specifico avversario cambia gli scontri rispetto al rendimento abituale dei due campioni.', false) +
    '</section>';

    html += '<section class="kb-card-grid">';
    html += '<article class="kb-card"><div class="card-head"><h3>Chi apre il duello</h3><span class="card-sub">La prima kill nella coppia; gli esiti senza kill restano fuori dalle due quote.</span></div>' +
      kbPairHtml('Prima kill nella coppia', firstKillA, firstKillB, function (v) { return fmtPct(v, 1); }, 'Confronto diretto tra la quota di prima kill dei due campioni.', false) +
      '<div class="kb-prob-grid"><div><span>' + esc(champA) + ' ha più kill al minuto 15</span><strong>' + fmtPct(pctKillAdv, 1) + '</strong><i style="--p:' + (clamp01(pctKillAdv)*100).toFixed(1) + '%"></i></div>' +
      '<div><span>' + esc(champA) + ' ha un saldo taglie migliore al minuto 15</span><strong>' + fmtPct(pctBountyAdv, 1) + '</strong><i style="--p:' + (clamp01(pctBountyAdv)*100).toFixed(1) + '%"></i></div></div></article>';

    html += '<article class="kb-card"><div class="card-head"><h3>Quanto valgono le kill e quanto oro si può restituire</h3><span class="card-sub">Confronta l’oro ottenuto con le eliminazioni e il rischio di regalarne molto con una singola morte.</span></div>' +
      '<div class="kb-pair-stack">' +
        kbPairHtml('Saldo delle taglie nei primi 15 minuti', bNet15[0], bNet15[1], function (v) { return fmtSigned(v, 1); }, 'Oro extra guadagnato con le eliminazioni, meno quello concesso morendo.', false) +
        kbPairHtml('Oro medio ottenuto per kill', bPerKill[0], bPerKill[1], function (v) { return fmtDec(v, 1); }, 'Quanto oro, in media, accompagna ogni eliminazione.', false) +
        kbPairHtml('Taglie importanti incassate', shutdownTake[0], shutdownTake[1], function (v) { return fmtPct(v, 1); }, 'Quanto spesso il campione riesce a eliminare un avversario con una taglia importante.', false) +
        kbPairHtml('Taglie importanti regalate', shutdownGive[0], shutdownGive[1], function (v) { return fmtPct(v, 1); }, 'Più basso significa meno rischio di restituire molto oro con una singola morte.', true) +
      '</div></article>';
    html += '</section>';

    html += '<section class="kb-phase-grid">' +
      phaseTrendHtml(role, champA, champB, 'kill_death_event_diff_per_match', 'Saldo kill-morti nelle diverse fasi', 'Kill ottenute meno morti subite in ogni fase: sopra lo zero favorisce quel campione.', function (v) { return fmtSigned(v, 2); }) +
      phaseTrendHtml(role, champA, champB, 'bounty_net_per_match', 'Saldo delle taglie nelle diverse fasi', 'Oro delle taglie guadagnato meno quello concesso in early, metà partita e late game.', function (v) { return fmtSigned(v, 0); }) +
    '</section>';

    if (isNum(excessBounty)) {
      html += '<section class="kb-explainer"><div><span>Effetto specifico di questo avversario</span><strong>' + esc(fmtSigned(excessBounty, 1)) + ' oro dalle taglie</strong></div><p>Questo valore separa l’effetto dell’avversario dalla tendenza abituale dei due campioni e mostra quanto il matchup cambia davvero l’oro ottenuto negli scontri.</p></section>';
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
        html += objectiveDonutCard(o.label, null, pct, champA, champB, esc(champA) + ' per primo');
      });

      var seqAvg = M.pctA('monster_sequence_control_avg_a');
      var seqScore = M.diffAB('monster_sequence_control_score_a');
      var seqDiff = M.diffAB('monster_sequence_diff_total_a_minus_b');
      var objConv = M.direct('objective_conversion_score_a');

      if (isNum(seqAvg) || isNum(seqScore) || isNum(seqDiff) || isNum(objConv)) {
        any = true;
        html += '<div class="card full-span"><div class="card-head"><h3>Controllo degli obiettivi nel tempo</h3><span class="card-sub">Non guarda soltanto il primo drago o il primo Herald: considera l’intera serie di obiettivi neutrali disponibili.</span></div>' +
          '<div class="stat-grid">' +
          '<div class="stat-card"><div class="label">Controllo medio ' + esc(champA) + '</div><div class="value a">' + fmtPct(seqAvg, 1) + '</div></div>' +
          '<div class="stat-card"><div class="label">Controllo complessivo della sequenza</div><div class="value">' + fmtSigned(seqScore, 4) + '</div><div class="sub">un valore positivo favorisce ' + esc(champA) + '</div></div>' +
          '<div class="stat-card"><div class="label">Differenza media di mostri</div><div class="value">' + fmtSigned(seqDiff, 3) + '</div></div>' +
          '<div class="stat-card"><div class="label">Trasformazione della pressione in obiettivi</div><div class="value">' + fmtSigned(objConv, 4) + '</div></div>' +
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
        html += '<div class="card"><div class="card-head"><h3>Controllo dei diversi mostri</h3><span class="card-sub">Mostra quale campione conquista più spesso ogni tipo di obiettivo neutrale.</span></div>' + miniBarsHtml(monsterPctRows) + '</div>';
        html += '<div class="card"><div class="card-head"><h3>Differenza nel numero di mostri conquistati</h3><span class="card-sub">Confronta quanti obiettivi di ogni tipo vengono presi in media dai due campioni.</span></div>' + miniBarsHtml(monsterDiffRows) + '</div>';
      }
    } else if (role === 'TOP' || role === 'MIDDLE' || role === 'BOTTOM') {
      var towerPct = M.pctA('pct_champion_a_wins_tower_race');
      var towerFallDiff = M.diffAB('avg_tower_fall_diff_min_a_minus_b');
      if (isNum(towerPct)) {
        any = true;
        html += objectiveDonutCard('Corsa alla prima torre', null, towerPct, champA, champB, esc(champA) + ' abbatte per primo');
        html += '<div class="card"><div class="card-head"><h3>Timing torre</h3><span class="card-sub">Scarto medio nella caduta della prima torre di corsia.</span></div>' + miniBarsHtml([{ label: 'Scarto torre', value: towerFallDiff, scale: 4, format: function (v) { return fmtSigned(v, 2, ' min'); } }]) + '</div>';
      }
    }

    if (!any) html += '<div class="empty-note full-span">Nessun dato obiettivo/torre disponibile per questo matchup specifico. La sezione resta vuota perché non inventa metriche quando il dataset non le contiene.</div>';
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

    // Deep-link usato da Rankings Lab: apre direttamente il campione o il
    // matchup richiesto senza modificare il comportamento della pagina normale.
    var requestedA = params.get('a');
    var requestedB = params.get('b');
    var available = DATA.meta.roles_champions[startRole] || [];
    if (requestedA && available.indexOf(requestedA) !== -1) {
      state.champA = requestedA;
      comboA.setValue(requestedA);
      comboB.setOptions(opponentOptionsFor(startRole, requestedA));
      comboB.setEnabled(true, 'Cerca l\'avversario…');
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