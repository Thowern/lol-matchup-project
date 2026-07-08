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
    setCockpitText('cockpitACopy', pa && pa.coverage ? fmtPct(pa.general_winrate, 1) + ' winrate generale · ' + fmtInt(pa.coverage.n_matchups) + ' matchup coperti nel ruolo ' + roleLabelText + '.' : 'Scegli il lato di riferimento.');
    setCockpitText('cockpitBCopy', pb && pb.coverage ? fmtPct(pb.general_winrate, 1) + ' winrate generale · ' + fmtInt(pb.coverage.n_matchups) + ' matchup coperti nel ruolo ' + roleLabelText + '.' : (state.champA ? 'Scegli un avversario reale dal dataset per attivare il dossier.' : 'Si sblocca dopo il Campione A.'));

    if (!state.champA || !state.champB) {
      setCockpitText('cockpitTitle', 'Nessun confronto attivo.');
      setCockpitText('cockpitCopy', state.champA ? 'Manca il secondo lato: appena scegli B, il riepilogo mostra edge, timing e fiducia.' : 'Seleziona due campioni: qui resteranno solo i fondamentali del matchup.');
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
      setCockpitText('cockpitFocus', 'Nessun edge calcolabile.');
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
    setCockpitText('cockpitCopy', champA + ' vs ' + champB + ' · ' + roleLabelText + '. Sintesi: edge diretto, timing @15, fiducia.');
    setCockpitText('cockpitFocus', fmtPct(Math.max(wr[0], wr[1]), 1) + ' matchup · ' + fmtSignedPct(wr[0] >= wr[1] ? diffWr[0] : diffWr[1], 1) + ' vs baseline.');
    setCockpitText('cockpitMethod', signedSideText(gold15, ' oro', 20) + ' · ' + signedSideText(xp15, ' XP', 20) + ' @15.');
    setCockpitText('cockpitTrustTitle', conf.label);
    setCockpitText('cockpitTrustCopy', fmtInt(n) + ' partite nel matchup. ' + (conf.level === 'low' ? 'Leggilo come segnale direzionale, non come certezza.' : 'Campione abbastanza stabile.'));
    setCockpitText('cockpitNextTitle', 'Apri gli insight');
    setCockpitText('cockpitNextCopy', 'Parti dai segnali con rilevanza più alta.');
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
    safeRender('Oro / XP / Snowball', 'panel-economy', renderEconomy);
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
      gold_diff_by_minute: 'gold_diff_15m',
      xp_diff_by_minute: 'xp_diff_15m',
      excess_gold_diff_by_minute: 'excess_gold_diff_15m',
      excess_xp_diff_by_minute: 'excess_xp_diff_15m'
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

  function buildInsightCards(M) {
    var champA = state.champA, champB = state.champB;
    var wr = M.pair('winrate');
    var diff = M.pair('diff_winrate');
    var n = M.direct('n_matches');
    var gold15 = seriesAtMinute(M, 'gold_diff_by_minute', 15);
    var xp15 = seriesAtMinute(M, 'xp_diff_by_minute', 15);
    var exGold15 = seriesAtMinute(M, 'excess_gold_diff_by_minute', 15);
    var snow = snowballRead(M);
    var obj = objectiveEdge(M);
    var l6 = M.pair('avg_level6_minute');
    var level6 = isNum(l6[0]) && isNum(l6[1]) ? l6[0] - l6[1] : null;
    var items = [];

    function add(weight, tone, tag, title, body) {
      if (!body) return;
      items.push({ weight: weight, tone: tone || 'neutral', tag: tag, title: title, body: body });
    }
    function side(v, deadzone) {
      var t = toneFromSigned(v, deadzone || 0);
      return t === 'a' ? champA : (t === 'b' ? champB : 'nessuno');
    }
    function sameSign(a, b) {
      return isNum(a) && isNum(b) && Math.abs(a) > 0.0001 && Math.abs(b) > 0.0001 && Math.sign(a) === Math.sign(b);
    }

    var wrEdge = isNum(wr[0]) ? wr[0] - 0.5 : null;
    var baseAdv = isNum(diff[0]) && isNum(diff[1]) ? diff[0] - diff[1] : null;
    var conf = confidence(n);

    if (conf.level === 'low') {
      add(102, 'warning', 'Affidabilità', 'Campione corto: abbassa il peso del verdetto',
        fmtInt(n) + ' partite. Uso pratico: considera validi soprattutto i segnali che concordano tra winrate, excess gold e snowball; se un dato resta isolato, trattalo come rumore direzionale.');
    } else if (isNum(n)) {
      add(conf.level === 'high' ? 76 : 66, conf.level === 'high' ? 'info' : 'warning', 'Affidabilità', conf.label,
        fmtInt(n) + ' partite dirette. Uso pratico: il verdetto può essere letto come base stabile, ma va ancora controllato contro timing e baseline.');
    }

    if (sameSign(wrEdge, baseAdv) && Math.abs(wrEdge) >= 0.035 && Math.abs(baseAdv) >= 0.02) {
      add(98, toneFromSigned(wrEdge, 0), 'Convergenza', side(wrEdge) + ' ha un edge pulito',
        'Winrate diretto (' + fmtPct(Math.max(wr[0], wr[1]), 1) + ') e scarto vs baseline (' + fmtSignedPP(baseAdv, 1) + ') puntano dallo stesso lato. È il segnale più affidabile perché non dipende solo dalla forza media del campione.');
    } else if (isNum(wrEdge) && Math.abs(wrEdge) >= 0.045) {
      add(88, toneFromSigned(wrEdge, 0), 'Matchup', side(wrEdge) + ' ha il vantaggio diretto',
        'Il winrate separa i due lati (' + fmtPct(Math.max(wr[0], wr[1]), 1) + '), ma va controllato contro baseline ed early: se non concordano, l’edge è meno pulito.');
    } else {
      add(62, 'neutral', 'Equilibrio', 'Il winrate non basta a decidere',
        'La lettura utile si sposta su timing: oro/XP @15, snowball e obiettivi hanno più valore del numero centrale.');
    }

    if (isNum(gold15) && isNum(exGold15)) {
      if (Math.abs(gold15) >= 420 && Math.abs(exGold15) >= 260 && sameSign(gold15, exGold15)) {
        add(94, toneFromSigned(gold15, 0), 'Economia pulita', side(gold15) + ' crea vantaggio specifico',
          'Oro @15 (' + fmtSigned(gold15, 0, '') + ') ed excess gold (' + fmtSigned(exGold15, 0, '') + ') concordano. Non è solo baseline: il matchup stesso sembra produrre pressione reale.');
      } else if (Math.abs(gold15) >= 420 && Math.abs(exGold15) < 180) {
        add(84, toneFromSigned(gold15, 0), 'Economia sporca', 'Il gold lead è meno matchup-specifico',
          side(gold15) + ' ha oro @15, ma l’excess è basso: parte del vantaggio può venire dal profilo naturale del campione, non dall’interazione diretta.');
      } else if (Math.abs(exGold15) >= 300 && Math.abs(gold15) < 360) {
        add(86, toneFromSigned(exGold15, 0), 'Segnale nascosto', 'Il matchup conta più del gold grezzo',
          'Il gold totale sembra vicino, ma l’excess gold favorisce ' + side(exGold15) + ': rispetto alla baseline, questa coppia sta spostando più di quanto il numero grezzo mostri.');
      }
    }

    if (snow && snow.sensitivity >= 0.14) {
      var tSnow = snowballTier(snow.sensitivity);
      var aheadSide = isNum(snow.aheadPct) && Math.abs(snow.aheadPct - 0.5) >= 0.06 ? (snow.aheadPct > 0.5 ? champA : champB) : null;
      add(snow.sensitivity >= 0.22 ? 96 : 89, tSnow.cls, 'Snowball', 'La corsia punisce il primo errore',
        'Il gap avanti/indietro @15 è ' + fmtPP(snow.sensitivity, 1) + '. ' + (aheadSide ? aheadSide + ' è più spesso avanti al 15°, quindi quel dato pesa molto.' : 'Non assegna da solo il lato: dice che gestione wave, reset e jungle pressure valgono più del solito.'));
    }

    if (isNum(xp15) && Math.abs(xp15) >= 420) {
      add(78, toneFromSigned(xp15, 0), 'Timing XP', side(xp15) + ' gioca meglio sugli spike',
        'XP @15: ' + fmtSigned(xp15, 0, '') + '. Se il matchup dipende da livello 6, wave tempo o all-in, questo può pesare più del gold.');
    }
    if (isNum(level6) && Math.abs(level6) >= 0.25) {
      var sideL6 = level6 < 0 ? champA : champB;
      add(72, level6 < 0 ? 'a' : 'b', 'Livello 6', sideL6 + ' apre prima la finestra ultimate',
        'Differenza media: ' + fmtDec(Math.abs(level6), 2) + ' min. È una finestra tattica, non una statistica decorativa.');
    }

    if (obj && Math.abs(obj.edge) >= 0.07) {
      add(74, toneFromSigned(obj.edge, 0), state.role === 'JUNGLE' ? 'Obiettivi' : 'Torri', side(obj.edge) + ' converte meglio la prima mappa',
        obj.label + ': ' + fmtPct(Math.max(obj.pct, 1 - obj.pct), 1) + '. Questo conta solo se il piano gioca davvero per priorità, non per scaling passivo.');
    }

    if (isNum(baseAdv)) {
      add(63, toneFromSigned(baseAdv, 0.01), 'Baseline', 'Quanto è reale l’edge rispetto al campione',
        'Scarto comparato tra baseline dei due lati: ' + fmtSignedPP(baseAdv, 1) + '. Uso pratico: se baseline e winrate diretto vanno insieme, l’edge è pulito; se divergono, guarda prima excess e timing.');
    }
    if (isNum(gold15) || isNum(xp15)) {
      add(62, toneFromSigned(isNum(gold15) && Math.abs(gold15) >= Math.abs(xp15 || 0) ? gold15 : xp15, 0), 'Timing @15', 'La lane ha una forma leggibile al minuto 15',
        'Oro: ' + signedSideText(gold15, ' oro', 20) + ' · XP: ' + signedSideText(xp15, ' XP', 20) + '. Uso pratico: questo dice se il matchup crea una finestra di pressione prima del mid game.');
    }

    var ranked = items.sort(function (a, b) { return b.weight - a.weight; });
    var relevant = ranked.filter(function (it) { return it.weight >= 61; });
    var selected = relevant.length ? relevant.slice() : ranked.slice();
    if (selected.length < 3) {
      ranked.forEach(function (it) {
        if (selected.length >= 3) return;
        if (selected.indexOf(it) === -1) selected.push(it);
      });
    }
    return selected;
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
    if (Math.abs(wrEdge) >= 0.07) outlook = favoredName + ' edge netto';
    else if (Math.abs(wrEdge) >= 0.04) outlook = favoredName + ' avanti';

    var html = '';
    html += '<section class="v2-hero">';
    html += '<div class="v2-hero-top"><div><div class="v2-eyebrow">Matchup read · ' + esc(ROLE_LABELS[role]) + '</div>';
    html += '<h2><span class="name-a">' + esc(champA) + '</span><em>vs</em><span class="name-b">' + esc(champB) + '</span></h2>';
    html += '<p>' + esc(outlook) + '. Lettura basata su winrate diretto, baseline del campione, andamento early e affidabilità del sample.</p></div>';
    html += '<div class="sample-badge ' + conf.level + '"><span class="dot"></span>' + conf.label + ' · ' + fmtInt(n) + ' partite</div></div>';
    html += '<div class="v2-verdict-main"><div class="v2-big-number ' + (favoredIsLeft ? 'a' : 'b') + '"><span>Segnale principale</span><strong>' + fmtPct(favoredWr, 1) + '</strong><em>' + esc(favoredName) + '</em></div>';
    html += '<div class="v2-winrail"><div class="tick50"></div><div class="left" style="width:' + Math.max(0, Math.min(100, wr[0] * 100)) + '%"><span>' + fmtPct(wr[0], 1) + '</span></div><div class="right" style="width:' + Math.max(0, Math.min(100, wr[1] * 100)) + '%"><span>' + fmtPct(wr[1], 1) + '</span></div></div></div>';
    html += '<div class="v2-kpi-row">';
    html += '<div class="v2-kpi ' + toneFromSigned(diffWr[0] - diffWr[1], 0.005) + '"><span>Scarto da baseline</span><strong>' + fmtSignedPP((isNum(diffWr[0]) && isNum(diffWr[1])) ? diffWr[0] - diffWr[1] : null, 1) + '</strong><em>matchup vs winrate medio</em></div>';
    html += '<div class="v2-kpi ' + toneFromSigned(gold15, 80) + '"><span>Oro @15</span><strong>' + (isNum(gold15) ? (gold15 > 0 ? '+' : '') + fmtInt(gold15) : '—') + '</strong><em>vantaggio early reale</em></div>';
    html += '<div class="v2-kpi ' + toneFromSigned(exGold15, 60) + '"><span>Excess gold @15</span><strong>' + (isNum(exGold15) ? (exGold15 > 0 ? '+' : '') + fmtInt(exGold15) : '—') + '</strong><em>effetto specifico matchup</em></div>';
    html += '<div class="v2-kpi ' + tier.cls + '"><span>Snowball</span><strong>' + (snow ? fmtPP(snow.sensitivity, 1) : '—') + '</strong><em>' + esc(tier.label) + '</em></div>';
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
      { label: 'Winrate', a: pctile(pa, 'general_winrate'), b: pctile(pb, 'general_winrate') },
      { label: 'Danno', a: pctile(pa, 'avg_damage_to_champs'), b: pctile(pb, 'avg_damage_to_champs') },
      { label: 'Tenuta', a: pctile(pa, 'avg_damage_taken'), b: pctile(pb, 'avg_damage_taken') },
      { label: 'Visione', a: pctile(pa, 'vision_score'), b: pctile(pb, 'vision_score') },
      { label: 'CC', a: pctile(pa, 'avg_total_time_cc_dealt'), b: pctile(pb, 'avg_total_time_cc_dealt') },
      { label: 'Lvl 6', a: pctile(pa, 'avg_level6_minute', true), b: pctile(pb, 'avg_level6_minute', true) }
    ];
    var economyAxes = [
      { label: 'Gold dep.', a: pctile(pa, 'goldxp_winpct_per_1k_gold'), b: pctile(pb, 'goldxp_winpct_per_1k_gold') },
      { label: 'XP dep.', a: pctile(pa, 'goldxp_winpct_per_1k_xp'), b: pctile(pb, 'goldxp_winpct_per_1k_xp') },
      { label: 'AUC', a: pctile(pa, 'goldxp_auc'), b: pctile(pb, 'goldxp_auc') },
      { label: 'Visione', a: pctile(pa, 'vision_score'), b: pctile(pb, 'vision_score') },
      { label: 'Tempo 6', a: pctile(pa, 'avg_level6_minute', true), b: pctile(pb, 'avg_level6_minute', true) }
    ];
    var diffRows = [
      { label: 'Danno ai campioni', value: (M.pair('avg_damage_to_champs')[0] || 0) - (M.pair('avg_damage_to_champs')[1] || 0), scale: 7000, format: function (v) { return (v > 0 ? '+' : '') + fmtInt(v); } },
      { label: 'Danno subito', value: (M.pair('avg_damage_taken')[0] || 0) - (M.pair('avg_damage_taken')[1] || 0), scale: 7000, format: function (v) { return (v > 0 ? '+' : '') + fmtInt(v); } },
      { label: 'Vision score', value: M.diffAB('vision_diff_a_minus_b'), scale: 12, format: function (v) { return fmtSigned(v, 1); } },
      { label: 'CC totale', value: (M.pair('avg_total_time_cc_dealt')[0] || 0) - (M.pair('avg_total_time_cc_dealt')[1] || 0), scale: 18, format: function (v) { return (v > 0 ? '+' : '') + fmtDec(v, 1) + 's'; } }
    ];
    var html = '<div class="panel-grid v2-overview">';
    html += '<div class="card full-span"><div class="card-head"><h3>Identità del matchup</h3><span class="card-sub">I radar usano percentili normalizzati: leggibili a colpo d’occhio, senza mischiare scale incompatibili.</span></div><div class="v2-radar-grid">' + radarSvg('Profilo generale', identityAxes, pa, pb) + radarSvg('Economia e tempo', economyAxes, pa, pb) + '</div></div>';
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
    var vol = M.direct('gold_diff_std_15m');
    var econRows = [
      { label: 'Oro @15', value: gold15, scale: 2200, format: function (v) { return isNum(v) ? (v > 0 ? '+' : '') + fmtInt(v) : '—'; } },
      { label: 'XP @15', value: xp15, scale: 2200, format: function (v) { return isNum(v) ? (v > 0 ? '+' : '') + fmtInt(v) : '—'; } },
      { label: 'Excess gold @15', value: exGold15, scale: 1400, format: function (v) { return isNum(v) ? (v > 0 ? '+' : '') + fmtInt(v) : '—'; } },
      { label: 'Excess XP @15', value: exXp15, scale: 1400, format: function (v) { return isNum(v) ? (v > 0 ? '+' : '') + fmtInt(v) : '—'; } }
    ];
    var aheadDiff = snow ? snow.leftAhead - snow.leftBehind : null;
    var html = '<div class="panel-grid v2-economy">';
    html += '<div class="card full-span v2-snowball-card ' + tier.cls + '"><div class="card-head"><h3>Snowball sensitivity</h3><span class="card-sub">Metrica neutra: misura quanto cambia l’esito tra essere avanti e indietro al minuto 15.</span></div>';
    html += '<div class="snowball-visual"><div class="snowball-core"><span>Sensibilità</span><strong>' + (snow ? fmtPP(snow.sensitivity, 1) : '—') + '</strong><em>' + esc(tier.label) + '</em></div><div class="snowball-copy"><p>' + esc(tier.copy) + '</p>' +
      '<div class="snowball-split"><div><span>' + esc(champA) + ' avanti @15</span><strong>' + (snow ? fmtPct(snow.leftAhead, 1) : '—') + '</strong></div><div><span>' + esc(champA) + ' indietro @15</span><strong>' + (snow ? fmtPct(snow.leftBehind, 1) : '—') + '</strong></div><div><span>Correlazione</span><strong>' + fmtDec(corr, 3) + '</strong></div><div><span>Volatilità oro</span><strong>' + fmtInt(vol) + '</strong></div></div></div></div></div>';
    html += '<div class="card"><div class="card-head"><h3>Economia early</h3><span class="card-sub">Il gold reale indica pressione; l’excess gold isola l’effetto specifico del matchup.</span></div>' + miniBarsHtml(econRows) + '</div>';
    html += '<div class="card"><div class="card-head"><h3>Conversione delle risorse</h3><span class="card-sub">Non è winrate: misura quanto oro/XP tendono a essere informativi per l’esito.</span></div>' + miniBarsHtml([
      { label: 'Gold dependency', value: M.diffAB('goldxp_gold_dependency_diff_a_minus_b'), scale: 5, format: function (v) { return fmtSigned(v, 2); } },
      { label: 'XP dependency', value: M.diffAB('goldxp_xp_dependency_diff_a_minus_b'), scale: 5, format: function (v) { return fmtSigned(v, 2); } }
    ]) + '</div>';
    document.getElementById('panel-economy').innerHTML = html;
  }

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
    var html = '<div class="card full-span raw-compact"><div class="card-head"><h3>Dettaglio tecnico</h3><span class="card-sub">Secondario: utile per audit, export o controllo puntuale delle metriche.</span></div>' +
      '<details><summary>Mostra tabella completa</summary><div class="raw-toolbar"><button class="raw-btn" id="rawCopyBtn">Copia testo</button><button class="raw-btn" id="rawCsvBtn">Scarica CSV</button></div>' +
      '<table class="raw-table"><thead><tr><th>Metrica</th><th>' + esc(champA) + '</th><th>' + esc(champB) + '</th></tr></thead><tbody>' + rows.map(function (r) { return '<tr><td class="metric">' + esc(r.label) + '</td><td class="va">' + esc(r.a) + '</td><td class="vb">' + esc(r.b) + '</td></tr>'; }).join('') + '</tbody></table></details></div>';
    document.getElementById('panel-raw').innerHTML = html;
    var copyBtn = document.getElementById('rawCopyBtn');
    var csvBtn = document.getElementById('rawCsvBtn');
    if (copyBtn) copyBtn.addEventListener('click', function () {
      var text = rows.map(function (r) { return r.label + ': ' + champA + ' = ' + r.a + ' | ' + champB + ' = ' + r.b; }).join('\n');
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text);
      copyBtn.textContent = 'Copiato'; setTimeout(function () { copyBtn.textContent = 'Copia testo'; }, 1400);
    });
    if (csvBtn) csvBtn.addEventListener('click', function () {
      function q(s) { return '"' + String(s).replace(/"/g, '""') + '"'; }
      var csv = [q('Metrica') + ',' + q(champA) + ',' + q(champB)].concat(rows.map(function (r) { return q(r.label) + ',' + q(r.a) + ',' + q(r.b); })).join('\n');
      var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url; link.download = 'matchup_' + state.role + '_' + champA + '_vs_' + champB + '.csv';
      document.body.appendChild(link); link.click(); document.body.removeChild(link); URL.revokeObjectURL(url);
    });
  }



  /* ---------------------------------------------------------------------- *
   * V2 compatibility overrides — keep every tab populated and coherent
   * ---------------------------------------------------------------------- */
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
      { label: 'Excess gold @15', value: exGold15, scale: 1400, format: function (v) { return isNum(v) ? (v > 0 ? '+' : '') + fmtInt(v) : '—'; } },
      { label: 'Excess XP @15', value: exXp15, scale: 1400, format: function (v) { return isNum(v) ? (v > 0 ? '+' : '') + fmtInt(v) : '—'; } }
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

  function renderObjectives(M) {
    var role = state.role, champA = state.champA, champB = state.champB;
    var html = '<div class="panel-grid">';
    var any = false;
    if (role === 'JUNGLE') {
      OBJECTIVES.forEach(function (o) {
        var pct = M.pctA('pct_champion_a_first_' + o.key);
        var n = M.direct('n_matches_' + o.key);
        if (!isNum(pct)) return;
        any = true;
        html += objectiveDonutCard(o.label, fmtInt(n) + ' occorrenze registrate', pct, champA, champB, esc(champA) + ' per primo');
      });
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

  function init() {
    populateRolePills();
    renderGlossary();
    renderFooterStats();

    var startRole = (Array.isArray(DATA.meta.roles) && DATA.meta.roles[0]) || ROLE_ORDER[0];
    setRole(startRole);
    setDataStatus('ready', 'Dataset pronto');
  }

  init();
})();