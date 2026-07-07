(function () {
  'use strict';

  /* ==========================================================================
   * MATCHUP INTELLIGENCE — CORE FOUNDATION
   * --------------------------------------------------------------------------
   * Questa sezione è il nucleo dell'app:
   * - valida e normalizza il dataset
   * - costruisce la mappa colonne
   * - definisce il design system OKLCH
   * - centralizza formatter, sicurezza HTML e lettura dati
   * - mantiene compatibilità totale con il resto del file
   * ========================================================================== */

  const DATA = window.MATCHUP_APP_DATA;

  if (!DATA) {
    const mount = document.getElementById('emptyState');

    if (mount) {
      mount.hidden = false;
      mount.innerHTML = `
        <div class="empty-orbit" aria-hidden="true">
          <span></span>
          <span></span>
          <span></span>
        </div>

        <h3>Dataset non caricato</h3>

        <p>
          Il file <strong>matchup_data.js</strong> non è stato trovato oppure non
          definisce <strong>window.MATCHUP_APP_DATA</strong>. Controlla che
          <code>matchup_data.js</code>, <code>app.js</code> e questo HTML siano
          nella stessa cartella e che lo script dei dati venga caricato prima di
          <code>app.js</code>.
        </p>
      `;
    }

    throw new Error(
      '[Matchup Intelligence] window.MATCHUP_APP_DATA non trovato. Controlla matchup_data.js.'
    );
  }
  
  if (!Array.isArray(DATA.matchupColumns)) {
    throw new Error('[Matchup Intelligence] matchupColumns mancante o non valido.');
  }

  const COLS = Object.create(null);
  DATA.matchupColumns.forEach((columnName, index) => {
    COLS[columnName] = index;
  });

  /* --------------------------------------------------------------------------
   * Identità semantica dei ruoli
   * -------------------------------------------------------------------------- */

  const ROLE_LABELS = Object.freeze({
    TOP: 'Top',
    JUNGLE: 'Jungle',
    MIDDLE: 'Mid',
    BOTTOM: 'ADC',
    UTILITY: 'Support'
  });

  const ROLE_LONG = Object.freeze({
    TOP: 'Corsia Top',
    JUNGLE: 'Boscaglia',
    MIDDLE: 'Corsia di Mezzo',
    BOTTOM: 'Corsia Bassa (ADC)',
    UTILITY: 'Supporto'
  });

  const ROLE_ORDER = Object.freeze([
    'TOP',
    'JUNGLE',
    'MIDDLE',
    'BOTTOM',
    'UTILITY'
  ]);

  const OBJECTIVES = Object.freeze([
    { key: 'dragon', label: 'Primo Drago' },
    { key: 'baron_nashor', label: 'Primo Barone Nashor' },
    { key: 'riftherald', label: 'Primo Araldo' },
    { key: 'horde', label: 'Primo Sciame del Vuoto' }
  ]);

  /* --------------------------------------------------------------------------
   * Stato applicativo
   * --------------------------------------------------------------------------
   * Rimane volutamente semplice e mutabile:
   * il resto del file può continuare a leggerlo e aggiornarlo come prima.
   * -------------------------------------------------------------------------- */

  const state = {
    role: null,
    champA: null,
    champB: null,
    trajMode: 'gold'
  };

  /* --------------------------------------------------------------------------
   * Design system percettivo — OKLCH
   * --------------------------------------------------------------------------
   * Tutti i colori principali hanno coerenza percettiva:
   * - stesso livello di luminanza per i due campioni
   * - stessa croma per bilanciare il peso visivo
   * - hue separati per contrasto immediato
   *
   * Queste variabili vengono iniettate sul :root.
   * visual.html potrà poi usarle direttamente.
   * -------------------------------------------------------------------------- */

  const Theme = (() => {
    const tokens = Object.freeze({
      '--font-sans': 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      '--font-mono': '"JetBrains Mono", "SFMono-Regular", Consolas, monospace',

      '--ok-bg-0': 'oklch(10.5% 0.018 240)',
      '--ok-bg-1': 'oklch(13.5% 0.021 240)',
      '--ok-bg-2': 'oklch(17.5% 0.024 240)',
      '--ok-surface': 'oklch(20.5% 0.028 240)',
      '--ok-surface-raised': 'oklch(24% 0.032 240)',
      '--ok-surface-glass': 'oklch(24% 0.034 240 / 0.74)',

      '--ink': 'oklch(96% 0.012 230)',
      '--ink-soft': 'oklch(84% 0.018 230)',
      '--ink-dim': 'oklch(67% 0.022 230)',
      '--ink-faint': 'oklch(52% 0.025 230)',

      '--line': 'oklch(100% 0 0 / 0.095)',
      '--line-strong': 'oklch(100% 0 0 / 0.16)',

      '--champ-a': 'oklch(72% 0.17 222)',
      '--champ-a-soft': 'oklch(72% 0.17 222 / 0.18)',
      '--champ-a-faint': 'oklch(72% 0.17 222 / 0.08)',

      '--champ-b': 'oklch(72% 0.17 24)',
      '--champ-b-soft': 'oklch(72% 0.17 24 / 0.18)',
      '--champ-b-faint': 'oklch(72% 0.17 24 / 0.08)',

      '--success': 'oklch(76% 0.15 148)',
      '--warning': 'oklch(80% 0.15 84)',
      '--danger': 'oklch(70% 0.18 28)',
      '--info': 'oklch(74% 0.15 244)',

      '--dmg-phys': 'oklch(73% 0.16 62)',
      '--dmg-magic': 'oklch(72% 0.17 288)',
      '--dmg-true': 'oklch(86% 0.06 195)',

      '--radius-xs': '8px',
      '--radius-sm': '12px',
      '--radius-md': '18px',
      '--radius-lg': '26px',
      '--radius-xl': '34px',

      '--shadow-soft': '0 18px 60px oklch(0% 0 0 / 0.28)',
      '--shadow-card': '0 22px 80px oklch(0% 0 0 / 0.36)',

      '--ease-out': 'cubic-bezier(.22,.61,.36,1)',
      '--ease-emphatic': 'cubic-bezier(.16,1,.3,1)'
    });

    function apply() {
      const root = document.documentElement;
      Object.keys(tokens).forEach((key) => {
        root.style.setProperty(key, tokens[key]);
      });
    }

    function injectBasePolish() {
      if (document.getElementById('matchup-core-theme')) return;

      const style = document.createElement('style');
      style.id = 'matchup-core-theme';
      style.textContent = `
        :root {
          color-scheme: dark;
        }

        ::selection {
          background: oklch(72% 0.17 222 / 0.32);
          color: var(--ink);
        }

        [hidden] {
          display: none !important;
        }

        .is-measuring {
          transition: none !important;
          animation: none !important;
        }
      `;

      document.head.appendChild(style);
    }

    return Object.freeze({
      tokens,
      apply,
      injectBasePolish,
      boot() {
        apply();
        injectBasePolish();
      }
    });
  })();

  Theme.boot();

  /* --------------------------------------------------------------------------
   * Utility generali
   * -------------------------------------------------------------------------- */

  function isNum(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function clamp(value, min, max) {
    if (!isNum(value)) return min;
    return Math.min(max, Math.max(min, value));
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[char]);
  }

  function toFilenameSafe(value) {
    return String(value == null ? '' : value)
      .trim()
      .replace(/\s+/g, '_')
      .replace(/[^\w.-]+/g, '')
      .slice(0, 80);
  }

  /* --------------------------------------------------------------------------
   * Formatter numerici
   * --------------------------------------------------------------------------
   * Mantengono i nomi originali:
   * fmtInt, fmtDec, fmtPct, fmtSignedPct, fmtSigned
   * così il resto del file continua a funzionare senza modifiche.
   * -------------------------------------------------------------------------- */

  const Format = Object.freeze({
    int(value) {
      if (!isNum(value)) return '—';
      return Math.round(value).toLocaleString('it-IT');
    },

    decimal(value, digits = 1) {
      if (!isNum(value)) return '—';
      return value.toLocaleString('it-IT', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits
      });
    },

    percent(value, digits = 1) {
      if (!isNum(value)) return '—';
      return (value * 100).toLocaleString('it-IT', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits
      }) + '%';
    },

    signedPercent(value, digits = 1) {
      if (!isNum(value)) return '—';
      return (value > 0 ? '+' : '') + Format.percent(value, digits);
    },

    signed(value, digits = 1, suffix = '') {
      if (!isNum(value)) return '—';
      return (value > 0 ? '+' : '') + Format.decimal(value, digits) + suffix;
    },

    delta(value, digits = 1, positiveLabel = 'vantaggio', negativeLabel = 'svantaggio') {
      if (!isNum(value)) return '—';
      if (Math.abs(value) < 0.000001) return 'in equilibrio';
      return `${Format.signed(value, digits)} ${value > 0 ? positiveLabel : negativeLabel}`;
    }
  });

  function fmtInt(value) {
    return Format.int(value);
  }

  function fmtDec(value, digits) {
    return Format.decimal(value, digits);
  }

  function fmtPct(value, digits) {
    return Format.percent(value, digits);
  }

  function fmtSignedPct(value, digits) {
    return Format.signedPercent(value, digits);
  }

  function fmtSigned(value, digits, suffix) {
    return Format.signed(value, digits, suffix);
  }

  /* --------------------------------------------------------------------------
   * Lettura DOM sicura
   * -------------------------------------------------------------------------- */

  function $(selector, root = document) {
    return root.querySelector(selector);
  }

  function $all(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function setHTML(target, html) {
    const el = typeof target === 'string' ? byId(target) : target;
    if (!el) return;
    el.innerHTML = html;
  }

  /* --------------------------------------------------------------------------
   * Affidabilità statistica e linguaggio narrativo
   * -------------------------------------------------------------------------- */

  function confidence(sampleSize) {
    const minSolid = DATA.meta.min_matches_solid;
    const minConfident = DATA.meta.min_matches_confident;

    if (sampleSize >= minSolid) {
      return {
        level: 'high',
        label: 'Campione solido',
        tone: 'elevata affidabilità',
        weight: 3
      };
    }

    if (sampleSize >= minConfident) {
      return {
        level: 'mid',
        label: 'Campione adeguato',
        tone: 'affidabilità intermedia',
        weight: 2
      };
    }

    return {
      level: 'low',
      label: 'Campione ridotto',
      tone: 'dato indicativo',
      weight: 1
    };
  }

  function magnitudeWord(ppAbs) {
    if (!isNum(ppAbs)) return 'un vantaggio non quantificabile';
    if (ppAbs < 2) return 'un vantaggio marginale';
    if (ppAbs < 6) return 'un vantaggio moderato';
    return 'un vantaggio netto';
  }

  function advantageLabel(value, champA, champB) {
    if (!isNum(value) || Math.abs(value) < 0.000001) return 'equilibrio';
    return value > 0 ? `vantaggio ${champA}` : `vantaggio ${champB}`;
  }

  function polarityClass(value) {
    if (!isNum(value) || Math.abs(value) < 0.000001) return 'neutral';
    return value > 0 ? 'positive' : 'negative';
  }

  /* --------------------------------------------------------------------------
   * Accesso ai dati grezzi
   * -------------------------------------------------------------------------- */

  function getRoleData(role) {
    return DATA.matchups && DATA.matchups[role] ? DATA.matchups[role] : null;
  }

  function getMatchup(role, champX, champY) {
    const roleData = getRoleData(role);
    if (!roleData || !champX || !champY) return null;

    if (roleData[champX] && roleData[champX][champY]) {
      return {
        a: champX,
        b: champY,
        values: roleData[champX][champY],
        storageOrder: 'direct'
      };
    }

    if (roleData[champY] && roleData[champY][champX]) {
      return {
        a: champY,
        b: champX,
        values: roleData[champY][champX],
        storageOrder: 'reverse'
      };
    }

    return null;
  }

  function val(record, columnName) {
    if (!record || !record.values) return undefined;

    const index = COLS[columnName];
    if (index === undefined) return undefined;

    return record.values[index];
  }

  /* --------------------------------------------------------------------------
   * Normalizzazione matchup
   * --------------------------------------------------------------------------
   * Il dataset può salvare il matchup come:
   * A vs B
   * oppure
   * B vs A
   *
   * Questa funzione ricostruisce sempre la prospettiva dell'interfaccia:
   * sinistra = champA scelto dall'utente
   * destra   = champB scelto dall'utente
   * -------------------------------------------------------------------------- */

  function normalizeMatchup(record, leftName) {
    const leftIsStoredA = record.a === leftName;

    function pair(baseName) {
      const aValue = val(record, `${baseName}_a`);
      const bValue = val(record, `${baseName}_b`);

      return leftIsStoredA
        ? [aValue, bValue]
        : [bValue, aValue];
    }

    function diffAB(columnName) {
      const value = val(record, columnName);
      if (!isNum(value)) return null;

      return leftIsStoredA ? value : -value;
    }

    function pctA(columnName) {
      const value = val(record, columnName);
      if (!isNum(value)) return null;

      return leftIsStoredA ? value : 1 - value;
    }

    function arrAB(columnName) {
      const series = val(record, columnName);
      if (!Array.isArray(series)) return null;

      if (leftIsStoredA) {
        return series.map((value) => isNum(value) ? value : null);
      }

      return series.map((value) => isNum(value) ? -value : null);
    }

    function direct(columnName) {
      return val(record, columnName);
    }

    function snowballPerspective() {
      const winrateStoredAWhenAhead = val(record, 'winrate_a_when_ahead_15m');
      const winrateStoredAWhenBehind = val(record, 'winrate_a_when_behind_15m');

      if (!isNum(winrateStoredAWhenAhead) || !isNum(winrateStoredAWhenBehind)) {
        return null;
      }

      if (leftIsStoredA) {
        return {
          leftAhead: winrateStoredAWhenAhead,
          leftBehind: winrateStoredAWhenBehind,
          rightAhead: 1 - winrateStoredAWhenBehind,
          rightBehind: 1 - winrateStoredAWhenAhead
        };
      }

      return {
        leftAhead: 1 - winrateStoredAWhenBehind,
        leftBehind: 1 - winrateStoredAWhenAhead,
        rightAhead: winrateStoredAWhenAhead,
        rightBehind: winrateStoredAWhenBehind
      };
    }

    function snapshot() {
      return {
        n: direct('n_matches'),
        lowSample: Boolean(direct('low_sample')),
        winrate: pair('winrate'),
        generalWinrate: pair('general_winrate'),
        diffWinrate: pair('diff_winrate'),
        damageDealt: pair('avg_damage_to_champs'),
        damageTaken: pair('avg_damage_taken'),
        vision: pair('vision_score'),
        level6: pair('avg_level6_minute'),
        snowball: snowballPerspective()
      };
    }

    return {
      leftIsA: leftIsStoredA,

      pair,
      diffAB,
      pctA,
      arrAB,
      direct,
      snowballPerspective,

      snapshot
    };
  }

  /* --------------------------------------------------------------------------
   * Micro motore per insight testuali
   * --------------------------------------------------------------------------
   * Non cambia i dati: li traduce in linguaggio umano.
   * Verrà usato dalle sezioni successive per rendere la dashboard più chiara.
   * -------------------------------------------------------------------------- */

  const Insight = Object.freeze({
    winnerFromPair(pairValues, leftName, rightName) {
      const left = pairValues && pairValues[0];
      const right = pairValues && pairValues[1];

      if (!isNum(left) || !isNum(right)) {
        return {
          side: null,
          name: null,
          value: null,
          delta: null,
          sentence: 'Dati insufficienti per determinare un vincitore chiaro.'
        };
      }

      if (Math.abs(left - right) < 0.000001) {
        return {
          side: 'even',
          name: null,
          value: left,
          delta: 0,
          sentence: 'Il matchup risulta perfettamente in equilibrio.'
        };
      }

      const leftWins = left > right;
      const winner = leftWins ? leftName : rightName;
      const value = leftWins ? left : right;
      const delta = Math.abs(left - right);

      return {
        side: leftWins ? 'left' : 'right',
        name: winner,
        value,
        delta,
        sentence: `${winner} è favorito con ${fmtPct(value, 1)} di winrate.`
      };
    },

    percentileTone(percentile) {
      if (!isNum(percentile)) return 'dato non posizionato';
      if (percentile >= 90) return 'élite del ruolo';
      if (percentile >= 75) return 'sopra la media';
      if (percentile >= 55) return 'leggermente sopra media';
      if (percentile >= 45) return 'nella media';
      if (percentile >= 25) return 'sotto media';
      return 'fascia bassa del ruolo';
    },

    correlationTone(value) {
      if (!isNum(value)) return 'correlazione non disponibile';

      const abs = Math.abs(value);
      if (abs < 0.15) return 'correlazione debole';
      if (abs < 0.4) return 'correlazione moderata';
      return 'correlazione forte';
    },

    sampleWarning(sampleSize) {
      const conf = confidence(sampleSize);

      if (conf.level !== 'low') return '';

      return `Campione ridotto: ${fmtInt(sampleSize)} partite. Interpretare come indicazione, non come certezza statistica.`;
    }
  });

  /* --------------------------------------------------------------------------
   * Helper grafici condivisi
   * -------------------------------------------------------------------------- */

  function niceStep(rough) {
    if (!Number.isFinite(rough) || rough <= 0) return 1;

    const power = Math.pow(10, Math.floor(Math.log(rough) / Math.LN10));
    const normalized = rough / power;

    const step =
      normalized < 1.5 ? 1 :
      normalized < 3 ? 2 :
      normalized < 7 ? 5 :
      10;

    return step * power;
  }

  function seriesExtent(values) {
    if (!Array.isArray(values)) {
      return { min: 0, max: 0, maxAbs: 0, hasData: false };
    }

    let min = Infinity;
    let max = -Infinity;
    let maxAbs = 0;
    let hasData = false;

    values.forEach((value) => {
      if (!isNum(value)) return;

      hasData = true;
      min = Math.min(min, value);
      max = Math.max(max, value);
      maxAbs = Math.max(maxAbs, Math.abs(value));
    });

    return {
      min: hasData ? min : 0,
      max: hasData ? max : 0,
      maxAbs,
      hasData
    };
  }

  function percentWidth(value, maxValue) {
    if (!isNum(value) || !isNum(maxValue) || maxValue <= 0) return 0;
    return clamp(Math.abs(value) / maxValue * 100, 0, 100);
  }

  function dominantSide(leftValue, rightValue, leftName, rightName) {
    if (!isNum(leftValue) || !isNum(rightValue)) return null;
    if (Math.abs(leftValue - rightValue) < 0.000001) return null;

    return leftValue > rightValue
      ? { side: 'a', name: leftName, value: leftValue, diff: leftValue - rightValue }
      : { side: 'b', name: rightName, value: rightValue, diff: rightValue - leftValue };
  }


  /* ==========================================================================
   * INTERACTION FOUNDATION
   * --------------------------------------------------------------------------
   * Tooltip globale + Combobox accessibile.
   *
   * Obiettivi:
   * - meno listener duplicati
   * - migliore accessibilità da tastiera
   * - tooltip più stabile e leggibile
   * - ricerca campioni più intelligente
   * - compatibilità totale con selectChampion()
   * ========================================================================== */

  /* --------------------------------------------------------------------------
   * Tooltip globale
   * --------------------------------------------------------------------------
   * Il tooltip è uno solo per tutta l'app.
   * Viene mosso e aggiornato in base agli elementi con [data-tip].
   * -------------------------------------------------------------------------- */

  const Tooltip = (() => {
    const el = byId('tooltip');

    let activeAnchor = null;
    let lastHtml = '';

    function hasTooltipTarget(target) {
      return target && target.closest ? target.closest('[data-tip]') : null;
    }

    function getTooltipHtml(anchor) {
      return anchor ? anchor.getAttribute('data-tip') || '' : '';
    }

    function placeAt(clientX, clientY) {
      if (!el) return;

      const margin = 12;
      const offset = 14;

      el.style.left = '0px';
      el.style.top = '0px';

      const rect = el.getBoundingClientRect();

      const x = clamp(
        clientX + offset,
        margin,
        window.innerWidth - rect.width - margin
      );

      const y = clamp(
        clientY + offset,
        margin,
        window.innerHeight - rect.height - margin
      );

      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
    }

    function show(clientX, clientY, html) {
      if (!el || !html) return;

      lastHtml = html;
      el.innerHTML = html;
      el.classList.add('show');
      el.setAttribute('aria-hidden', 'false');

      placeAt(clientX, clientY);
    }

    function hide() {
      if (!el) return;

      activeAnchor = null;
      lastHtml = '';
      el.classList.remove('show');
      el.setAttribute('aria-hidden', 'true');
    }

    function move(clientX, clientY) {
      if (!el || !el.classList.contains('show')) return;
      placeAt(clientX, clientY);
    }

    function bind() {
      if (!el) return;

      document.addEventListener('mouseover', (event) => {
        const anchor = hasTooltipTarget(event.target);
        if (!anchor) return;

        activeAnchor = anchor;
        show(event.clientX, event.clientY, getTooltipHtml(anchor));
      });

      document.addEventListener('mousemove', (event) => {
        const anchor = hasTooltipTarget(event.target);

        if (!anchor) {
          return;
        }

        if (anchor !== activeAnchor) {
          activeAnchor = anchor;
          show(event.clientX, event.clientY, getTooltipHtml(anchor));
          return;
        }

        move(event.clientX, event.clientY);
      });

      document.addEventListener('mouseout', (event) => {
        const anchor = hasTooltipTarget(event.target);
        if (!anchor) return;

        const related = event.relatedTarget;
        if (related && anchor.contains(related)) return;

        hide();
      });

      document.addEventListener('focusin', (event) => {
        const anchor = hasTooltipTarget(event.target);
        if (!anchor) return;

        activeAnchor = anchor;

        const rect = anchor.getBoundingClientRect();
        show(rect.left, rect.bottom, getTooltipHtml(anchor));
      });

      document.addEventListener('focusout', (event) => {
        if (hasTooltipTarget(event.target)) {
          hide();
        }
      });

      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && lastHtml) {
          hide();
        }
      });

      window.addEventListener('scroll', hide, { passive: true });
      window.addEventListener('resize', hide);
    }

    return Object.freeze({
      bind,
      show,
      hide,
      move
    });
  })();

  Tooltip.bind();

  function showTip(x, y, html) {
    Tooltip.show(x, y, html);
  }

  function hideTip() {
    Tooltip.hide();
  }

  /* --------------------------------------------------------------------------
   * Combobox intelligente
   * --------------------------------------------------------------------------
   * Migliorie rispetto alla versione originale:
   * - ricerca pesata: exact > startsWith > includes
   * - supporto tastiera più fluido
   * - aria-activedescendant
   * - placeholder coerenti
   * - gestione empty state
   * - nessun dato perso: value, label, meta e low restano supportati
   * -------------------------------------------------------------------------- */

  function createCombobox(rootEl, options = {}) {
    if (!rootEl) {
      throw new Error('[Matchup Intelligence] Combobox root non trovato.');
    }

    const input = rootEl.querySelector('input');
    const list = rootEl.querySelector('.combobox-list');

    if (!input || !list) {
      throw new Error('[Matchup Intelligence] Markup combobox non valido.');
    }

    let allOptions = [];
    let filteredOptions = [];
    let activeIndex = -1;
    let selectedValue = null;

    const uid = rootEl.id || `combo-${Math.random().toString(36).slice(2, 8)}`;
    const listId = `${uid}-listbox`;

    list.id = list.id || listId;
    list.setAttribute('role', 'listbox');

    input.setAttribute('role', 'combobox');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', list.id);

    function normalizeText(value) {
      return String(value == null ? '' : value)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
    }

    function scoreOption(option, query) {
      const label = normalizeText(option.label);
      const value = normalizeText(option.value);
      const q = normalizeText(query);

      if (!q) return 10;

      if (label === q || value === q) return 100;
      if (label.startsWith(q) || value.startsWith(q)) return 80;
      if (label.includes(q) || value.includes(q)) return 55;

      const compactLabel = label.replace(/[^a-z0-9]/g, '');
      const compactQuery = q.replace(/[^a-z0-9]/g, '');

      if (compactQuery && compactLabel.includes(compactQuery)) return 45;

      return 0;
    }

    function getFiltered(query) {
      return allOptions
        .map((option, originalIndex) => ({
          option,
          originalIndex,
          score: scoreOption(option, query)
        }))
        .filter((item) => item.score > 0)
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;

          const gamesA = Number(a.option.sortValue || 0);
          const gamesB = Number(b.option.sortValue || 0);

          if (gamesB !== gamesA) return gamesB - gamesA;

          return String(a.option.label).localeCompare(String(b.option.label), 'it');
        })
        .map((item) => item.option);
    }

    function optionId(index) {
      return `${uid}-option-${index}`;
    }

    function renderList(query = input.value) {
      filteredOptions = getFiltered(query);

      if (activeIndex >= filteredOptions.length) {
        activeIndex = filteredOptions.length - 1;
      }

      if (activeIndex < -1) {
        activeIndex = -1;
      }

      if (!filteredOptions.length) {
        list.innerHTML = `
          <div class="combobox-empty" role="presentation">
            Nessun campione trovato.
          </div>
        `;
      } else {
        list.innerHTML = filteredOptions.map((option, index) => {
          const isActive = index === activeIndex;
          const classes = [
            'combobox-option',
            option.low ? 'low' : '',
            isActive ? 'active' : ''
          ].filter(Boolean).join(' ');

          const meta = option.meta !== undefined && option.meta !== ''
            ? `<span class="n">${esc(option.meta)}</span>`
            : '';

          const reliability = option.low
            ? '<span class="mini-badge low">sample basso</span>'
            : '';

          return `
            <div
              id="${optionId(index)}"
              class="${classes}"
              role="option"
              aria-selected="${isActive ? 'true' : 'false'}"
              data-value="${esc(option.value)}"
            >
              <span class="combo-main">
                <span class="combo-name">${esc(option.label)}</span>
                ${reliability}
              </span>
              ${meta}
            </div>
          `;
        }).join('');
      }

      list.classList.add('open');
      input.setAttribute('aria-expanded', 'true');

      if (activeIndex >= 0) {
        input.setAttribute('aria-activedescendant', optionId(activeIndex));
      } else {
        input.removeAttribute('aria-activedescendant');
      }
    }

    function open() {
      if (input.disabled) return;
      renderList(input.value);
    }

    function close() {
      list.classList.remove('open');
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      activeIndex = -1;
    }

    function choose(option) {
      if (!option) return;

      selectedValue = option.value;
      input.value = option.label;

      close();

      if (typeof options.onSelect === 'function') {
        options.onSelect(option.value, option);
      }
    }

    function chooseByValue(value) {
      const found = allOptions.find((option) => String(option.value) === String(value));

      if (found) {
        choose(found);
        return;
      }

      selectedValue = value;
      input.value = value || '';
      close();

      if (typeof options.onSelect === 'function') {
        options.onSelect(value, null);
      }
    }

    function moveActive(delta) {
      if (!list.classList.contains('open')) {
        open();
        return;
      }

      if (!filteredOptions.length) return;

      activeIndex += delta;

      if (activeIndex < 0) {
        activeIndex = filteredOptions.length - 1;
      }

      if (activeIndex >= filteredOptions.length) {
        activeIndex = 0;
      }

      renderList(input.value);

      const activeEl = byId(optionId(activeIndex));
      if (activeEl && activeEl.scrollIntoView) {
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    }

    input.addEventListener('focus', () => {
      open();
    });

    input.addEventListener('input', () => {
      selectedValue = null;
      activeIndex = -1;
      renderList(input.value);
    });

    input.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveActive(1);
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveActive(-1);
        return;
      }

      if (event.key === 'Home' && list.classList.contains('open')) {
        event.preventDefault();
        activeIndex = 0;
        renderList(input.value);
        return;
      }

      if (event.key === 'End' && list.classList.contains('open')) {
        event.preventDefault();
        activeIndex = filteredOptions.length - 1;
        renderList(input.value);
        return;
      }

      if (event.key === 'Enter') {
        if (!list.classList.contains('open')) return;

        event.preventDefault();

        const selected =
          filteredOptions[activeIndex] ||
          filteredOptions[0];

        choose(selected);
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    });

    list.addEventListener('mousedown', (event) => {
      event.preventDefault();

      const optionEl = event.target.closest('.combobox-option');
      if (!optionEl) return;

      chooseByValue(optionEl.getAttribute('data-value'));
    });

    document.addEventListener('click', (event) => {
      if (!rootEl.contains(event.target)) {
        close();
      }
    });

    return Object.freeze({
      setOptions(newOptions) {
        allOptions = Array.isArray(newOptions) ? newOptions.slice() : [];
        filteredOptions = [];
        activeIndex = -1;
        selectedValue = null;

        if (document.activeElement === input) {
          renderList(input.value);
        }
      },

      setValue(labelOrValue) {
        const found = allOptions.find((option) => {
          return option.value === labelOrValue || option.label === labelOrValue;
        });

        selectedValue = found ? found.value : labelOrValue;
        input.value = found ? found.label : (labelOrValue || '');
      },

      setEnabled(enabled, placeholder) {
        input.disabled = !enabled;

        if (placeholder !== undefined) {
          input.placeholder = placeholder;
        }

        rootEl.classList.toggle('disabled', !enabled);

        if (!enabled) {
          selectedValue = null;
          input.value = '';
          close();
        }
      },

      clear() {
        selectedValue = null;
        input.value = '';
        activeIndex = -1;
        close();
      },

      getValue() {
        return selectedValue;
      },

      open,
      close
    });
  }

  const comboA = createCombobox(byId('comboA'), {
    onSelect(value) {
      selectChampion('A', value);
    }
  });

  const comboB = createCombobox(byId('comboB'), {
    onSelect(value) {
      selectChampion('B', value);
    }
  });



  /* ==========================================================================
   * SELECTION & DASHBOARD ROUTER
   * --------------------------------------------------------------------------
   * Gestisce:
   * - selezione ruolo
   * - selezione campione A
   * - selezione campione B
   * - matchup consigliati
   * - swap dei campioni
   * - stato vuoto
   * - routing verso tutte le sezioni del dossier
   * ========================================================================== */

  function availableRoles() {
    const roles = Array.isArray(DATA.meta.roles) ? DATA.meta.roles : [];
    return ROLE_ORDER.filter((role) => roles.includes(role));
  }

  function championProfile(role, championName) {
    const profiles = DATA.championProfiles && DATA.championProfiles[role]
      ? DATA.championProfiles[role]
      : {};

    return profiles[championName] || null;
  }

  function championCoverage(role, championName) {
    const profile = championProfile(role, championName);

    return profile && profile.coverage
      ? profile.coverage
      : {
          n_matchups: 0,
          total_games: 0
        };
  }

  function championOptionsFor(role) {
    const champions = DATA.meta.roles_champions && DATA.meta.roles_champions[role]
      ? DATA.meta.roles_champions[role]
      : [];

    return champions
      .slice()
      .sort((champA, champB) => {
        const coverageA = championCoverage(role, champA);
        const coverageB = championCoverage(role, champB);

        return (coverageB.total_games || 0) - (coverageA.total_games || 0);
      })
      .map((championName) => {
        const coverage = championCoverage(role, championName);
        const conf = confidence(coverage.total_games || 0);

        return {
          value: championName,
          label: championName,
          meta: `${fmtInt(coverage.n_matchups)} matchup`,
          sortValue: coverage.total_games || 0,
          low: conf.level === 'low'
        };
      });
  }

  function opponentOptionsFor(role, championName) {
    const roleAdjacency = DATA.adjacency && DATA.adjacency[role]
      ? DATA.adjacency[role]
      : {};

    const rows = roleAdjacency[championName] || [];

    return rows.map((row) => {
      const opponentName = row[0];
      const matches = row[1];
      const lowSample = row[2];

      return {
        value: opponentName,
        label: opponentName,
        meta: `${fmtInt(matches)} partite`,
        sortValue: matches || 0,
        low: Boolean(lowSample)
      };
    });
  }

  function topMatchupsForRole(role) {
    const byRole = DATA.meta.top_matchups_by_role || {};
    return byRole[role] || [];
  }

  function bestGlobalRole() {
    let best = null;

    availableRoles().forEach((role) => {
      const top = topMatchupsForRole(role)[0];

      if (!top) return;

      if (!best || top.n > best.n) {
        best = {
          role,
          n: top.n
        };
      }
    });

    return best ? best.role : availableRoles()[0];
  }

  function setControlLoading(isLoading) {
    document.documentElement.classList.toggle('is-rendering', Boolean(isLoading));
  }

  function populateRolePills() {
    const wrap = byId('rolePills');
    if (!wrap) return;

    const roles = availableRoles();

    wrap.innerHTML = roles.map((role) => {
      const top = topMatchupsForRole(role)[0];
      const sample = top ? fmtInt(top.n) : '—';

      return `
        <button
          class="role-pill"
          type="button"
          data-role="${esc(role)}"
          aria-pressed="false"
          data-tip="<div class='tt-title'>${esc(ROLE_LONG[role] || role)}</div>Matchup più osservato: ${esc(sample)} partite"
        >
          <span class="role-pill-label">${esc(ROLE_LABELS[role] || role)}</span>
          <span class="role-pill-meta">${esc(sample)}</span>
        </button>
      `;
    }).join('');

    wrap.addEventListener('click', (event) => {
      const button = event.target.closest('.role-pill');
      if (!button) return;

      setRole(button.getAttribute('data-role'));
    });
  }

  function updateRolePillState(activeRole) {
    $all('.role-pill').forEach((button) => {
      const isActive = button.getAttribute('data-role') === activeRole;

      button.classList.toggle('active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  }

  function setRole(role) {
    if (!role) return;

    state.role = role;
    state.champA = null;
    state.champB = null;

    updateRolePillState(role);

    comboA.setOptions(championOptionsFor(role));
    comboA.clear();

    comboB.setOptions([]);
    comboB.setEnabled(false, 'Scegli prima il campione A');

    renderChips(role);

    const top = topMatchupsForRole(role)[0];

    if (top) {
      applySelection(top.a, top.b);
      return;
    }

    render();
  }

  function applySelection(champA, champB) {
    if (!state.role || !champA || !champB) return;

    state.champA = champA;
    state.champB = champB;

    comboA.setOptions(championOptionsFor(state.role));
    comboA.setValue(champA);

    comboB.setOptions(opponentOptionsFor(state.role, champA));
    comboB.setEnabled(true, 'Cerca l’avversario…');
    comboB.setValue(champB);

    render();
  }

  function selectChampion(slot, championName) {
    if (!state.role || !championName) return;

    if (slot === 'A') {
      state.champA = championName;
      state.champB = null;

      comboB.setOptions(opponentOptionsFor(state.role, championName));
      comboB.setEnabled(true, 'Cerca l’avversario…');
      comboB.clear();

      render();
      return;
    }

    if (slot === 'B') {
      state.champB = championName;
      render();
    }
  }

  function bindSwapButton() {
    const swapButton = byId('swapBtn');
    if (!swapButton) return;

    swapButton.addEventListener('click', () => {
      if (!state.role || !state.champA || !state.champB) return;

      const previousA = state.champA;
      const previousB = state.champB;

      state.champA = previousB;
      state.champB = previousA;

      comboA.setValue(previousB);

      comboB.setOptions(opponentOptionsFor(state.role, previousB));
      comboB.setEnabled(true, 'Cerca l’avversario…');
      comboB.setValue(previousA);

      render();
    });
  }

  function renderChips(role) {
    const wrap = byId('chipsRow');
    if (!wrap) return;

    const matchups = topMatchupsForRole(role).slice(0, 8);

    if (!matchups.length) {
      wrap.innerHTML = '';
      return;
    }

    wrap.innerHTML = matchups.map((matchup, index) => {
      const conf = confidence(matchup.n || 0);

      return `
        <button
          class="chip matchup-chip"
          type="button"
          data-a="${esc(matchup.a)}"
          data-b="${esc(matchup.b)}"
          data-rank="${index + 1}"
          data-tip="<div class='tt-title'>Matchup #${index + 1}</div>${esc(matchup.a)} vs ${esc(matchup.b)} · ${fmtInt(matchup.n)} partite · ${esc(conf.label)}"
        >
          <span class="chip-rank">#${index + 1}</span>
          <span class="chip-pair">
            <strong>${esc(matchup.a)}</strong>
            <span>vs</span>
            <strong>${esc(matchup.b)}</strong>
          </span>
          <span class="n">${fmtInt(matchup.n)}</span>
        </button>
      `;
    }).join('');

    wrap.querySelectorAll('.matchup-chip').forEach((button) => {
      button.addEventListener('click', () => {
        applySelection(
          button.getAttribute('data-a'),
          button.getAttribute('data-b')
        );
      });
    });
  }

  /* --------------------------------------------------------------------------
   * Stati vuoti
   * -------------------------------------------------------------------------- */

  function renderEmptyState(title, body, extraHtml = '') {
    const emptyEl = byId('emptyState');
    const dossierEl = byId('dossier');

    if (dossierEl) dossierEl.hidden = true;

    if (!emptyEl) return;

    emptyEl.hidden = false;
    emptyEl.innerHTML = `
      <div class="empty-orbit" aria-hidden="true">
        <span></span>
        <span></span>
        <span></span>
      </div>

      <h3>${esc(title)}</h3>
      <p>${body}</p>
      ${extraHtml}
    `;
  }

  function renderMissingSelection() {
    renderEmptyState(
      'Seleziona due campioni',
      'Scegli un ruolo e due campioni per aprire il dossier completo del matchup.'
    );
  }

  function renderMissingMatchup() {
    const role = state.role;
    const champA = state.champA;
    const champB = state.champB;

    const suggestions = opponentOptionsFor(role, champA).slice(0, 10);

    const suggestionHtml = suggestions.length
      ? `
        <div class="suggestions">
          ${suggestions.map((option) => `
            <button
              class="chip suggestion-chip"
              type="button"
              data-b="${esc(option.value)}"
            >
              <span>${esc(option.value)}</span>
              <span class="n">${esc(option.meta)}</span>
            </button>
          `).join('')}
        </div>
      `
      : '';

    renderEmptyState(
      'Nessuna partita registrata',
      `
        Non ci sono dati per
        <strong>${esc(champA)}</strong>
        contro
        <strong>${esc(champB)}</strong>
        nel ruolo
        <strong>${esc(ROLE_LABELS[role] || role)}</strong>.
        ${suggestions.length ? `Avversari disponibili per <strong>${esc(champA)}</strong>:` : ''}
      `,
      suggestionHtml
    );

    $all('#emptyState .suggestion-chip').forEach((button) => {
      button.addEventListener('click', () => {
        selectChampion('B', button.getAttribute('data-b'));
      });
    });
  }

  /* --------------------------------------------------------------------------
   * Dashboard Router
   * --------------------------------------------------------------------------
   * Questa funzione rimane il punto unico di rendering.
   * Le sezioni successive verranno rese più potenti una alla volta.
   * -------------------------------------------------------------------------- */

  function render() {
    const emptyEl = byId('emptyState');
    const dossierEl = byId('dossier');

    if (!state.role || !state.champA || !state.champB) {
      renderMissingSelection();
      return;
    }

    const record = getMatchup(state.role, state.champA, state.champB);

    if (!record) {
      renderMissingMatchup();
      return;
    }

    if (emptyEl) emptyEl.hidden = true;
    if (dossierEl) dossierEl.hidden = false;

    const M = normalizeMatchup(record, state.champA);

    setControlLoading(true);

    try {
      renderVerdict(M);
      renderOverview(M);
      renderTrajectory(M);
      renderCombat(M);
      renderEconomy(M);
      renderObjectives(M);
      renderRaw(M);
    } finally {
      requestAnimationFrame(() => {
        setControlLoading(false);
      });
    }
  }

  bindSwapButton();

  /* ==========================================================================
   * VERDICT HERO
   * --------------------------------------------------------------------------
   * La fascia più importante della dashboard.
   *
   * Obiettivo:
   * in meno di 5 secondi l'utente deve capire:
   * - chi è favorito
   * - con quale winrate
   * - quanto il dato è affidabile
   * - se il matchup è sopra o sotto le attese
   * - quanto è forte lo scarto
   * ========================================================================== */

  function safePercentWidth(value) {
    if (!isNum(value)) return 50;
    return clamp(value * 100, 0, 100);
  }

  function winrateBalanceLabel(leftWinrate, rightWinrate, champA, champB) {
    if (!isNum(leftWinrate) || !isNum(rightWinrate)) {
      return 'Winrate non disponibile';
    }

    const delta = Math.abs(leftWinrate - rightWinrate) * 100;

    if (delta < 1) {
      return 'Matchup quasi perfettamente equilibrato';
    }

    const leader = leftWinrate > rightWinrate ? champA : champB;
    return `${leader} avanti di ${fmtDec(delta, 1)} punti percentuali`;
  }

  function expectedDeltaNarrative(championName, diffValue, role) {
    if (!isNum(diffValue)) {
      return `${championName} non ha uno scarto dal winrate medio calcolabile.`;
    }

    const absPp = Math.abs(diffValue * 100);

    if (absPp < 0.5) {
      return `${championName} performa praticamente in linea con il suo winrate medio da ${ROLE_LABELS[role]}.`;
    }

    const direction = diffValue > 0
      ? 'meglio'
      : 'peggio';

    return `${championName} performa ${direction} del suo standard da ${ROLE_LABELS[role]} di ${fmtSignedPct(diffValue, 1)}.`;
  }

  function confidenceBadge(sampleSize) {
    const conf = confidence(sampleSize);

    return `
      <div
        class="sample-badge ${esc(conf.level)}"
        data-tip="<div class='tt-title'>Affidabilità statistica</div>${esc(conf.tone)} · ${fmtInt(sampleSize)} partite osservate"
        tabindex="0"
      >
        <span class="dot"></span>
        <span>${esc(conf.label)}</span>
        <strong>${fmtInt(sampleSize)}</strong>
        <span>partite</span>
      </div>
    `;
  }

  function heroMetricCard(config) {
    const {
      label,
      value,
      sub,
      tone = '',
      tip = ''
    } = config;

    const tipAttr = tip
      ? ` data-tip="${esc(tip)}" tabindex="0"`
      : '';

    return `
      <div class="hero-metric ${esc(tone)}"${tipAttr}>
        <div class="hero-metric-label">${esc(label)}</div>
        <div class="hero-metric-value">${value}</div>
        ${sub ? `<div class="hero-metric-sub">${sub}</div>` : ''}
      </div>
    `;
  }

  function winrateRail(champA, champB, leftWinrate, rightWinrate) {
    const leftWidth = safePercentWidth(leftWinrate);
    const rightWidth = safePercentWidth(rightWinrate);

    return `
      <div
        class="winrate-rail"
        aria-label="${esc(winrateBalanceLabel(leftWinrate, rightWinrate, champA, champB))}"
      >
        <div class="winrate-rail-axis">
          <span>0%</span>
          <strong>50%</strong>
          <span>100%</span>
        </div>

        <div class="winrate-rail-track">
          <div class="tick50"></div>

          <div
            class="winrate-rail-fill a"
            style="width:${leftWidth}%"
            data-tip="<div class='tt-title'>${esc(champA)}</div>Winrate matchup: ${fmtPct(leftWinrate, 1)}"
          >
            <span>${fmtPct(leftWinrate, 1)}</span>
          </div>

          <div
            class="winrate-rail-fill b"
            style="width:${rightWidth}%"
            data-tip="<div class='tt-title'>${esc(champB)}</div>Winrate matchup: ${fmtPct(rightWinrate, 1)}"
          >
            <span>${fmtPct(rightWinrate, 1)}</span>
          </div>
        </div>
      </div>
    `;
  }

  function expectedPerformanceRows(champA, champB, role, winrate, generalWinrate, diffWinrate) {
    const rows = [
      {
        side: 'a',
        name: champA,
        matchup: winrate[0],
        general: generalWinrate[0],
        diff: diffWinrate[0]
      },
      {
        side: 'b',
        name: champB,
        matchup: winrate[1],
        general: generalWinrate[1],
        diff: diffWinrate[1]
      }
    ];

    return `
      <div class="expectation-grid">
        ${rows.map((row) => {
          const diffClass = polarityClass(row.diff);
          const diffAbs = isNum(row.diff) ? Math.abs(row.diff * 100) : 0;
          const diffWidth = clamp(diffAbs / 12 * 100, 0, 100);

          return `
            <div class="expectation-card ${esc(row.side)}">
              <div class="expectation-head">
                <strong>${esc(row.name)}</strong>
                <span>${esc(ROLE_LABELS[role])}</span>
              </div>

              <div class="expectation-values">
                <div>
                  <span>Matchup</span>
                  <strong>${fmtPct(row.matchup, 1)}</strong>
                </div>
                <div>
                  <span>Media ruolo</span>
                  <strong>${fmtPct(row.general, 1)}</strong>
                </div>
                <div class="${esc(diffClass)}">
                  <span>Scarto</span>
                  <strong>${fmtSignedPct(row.diff, 1)}</strong>
                </div>
              </div>

              <div class="delta-meter ${esc(diffClass)}">
                <span style="width:${diffWidth}%"></span>
              </div>

              <p>${esc(expectedDeltaNarrative(row.name, row.diff, role))}</p>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function verdictSentence({
    favoredName,
    favoredWinrate,
    favoredDiff,
    sampleSize,
    role
  }) {
    let sentence = `
      <strong>${esc(favoredName)}</strong>
      vince questo matchup nel
      <strong>${fmtPct(favoredWinrate, 1)}</strong>
      delle partite
    `;

    if (isNum(favoredDiff) && Math.abs(favoredDiff) >= 0.005) {
      sentence += `,
        mostrando ${magnitudeWord(Math.abs(favoredDiff * 100))}
        (<strong>${fmtSignedPct(favoredDiff, 1)}</strong>)
        rispetto al suo winrate medio da ${esc(ROLE_LABELS[role])}.
      `;
    } else {
      sentence += `,
        con una performance sostanzialmente in linea con il suo winrate medio da
        ${esc(ROLE_LABELS[role])}.
      `;
    }

    const warning = Insight.sampleWarning(sampleSize);

    if (warning) {
      sentence += `
        <span class="verdict-warning">
          ${esc(warning)}
        </span>
      `;
    }

    return sentence;
  }

  function renderVerdict(M) {
    const champA = state.champA;
    const champB = state.champB;
    const role = state.role;

    const sampleSize = M.direct('n_matches');
    const conf = confidence(sampleSize);

    const winrate = M.pair('winrate');
    const generalWinrate = M.pair('general_winrate');
    const diffWinrate = M.pair('diff_winrate');

    const leftWinrate = winrate[0];
    const rightWinrate = winrate[1];

    const winner = Insight.winnerFromPair(winrate, champA, champB);

    const favoredIsLeft = winner.side !== 'right';
    const favoredName = winner.name || champA;
    const favoredWinrate = winner.value || leftWinrate;
    const favoredDiff = favoredIsLeft ? diffWinrate[0] : diffWinrate[1];

    const deltaPp = isNum(leftWinrate) && isNum(rightWinrate)
      ? Math.abs(leftWinrate - rightWinrate) * 100
      : null;

    const matchupTone = !isNum(deltaPp)
      ? 'neutral'
      : deltaPp < 1
        ? 'neutral'
        : favoredIsLeft
          ? 'a'
          : 'b';

    const html = `
      <section
        class="verdict-hero tone-${esc(matchupTone)} confidence-${esc(conf.level)}"
        aria-label="Verdetto del matchup"
      >
        <div class="verdict-bg" aria-hidden="true">
          <span class="orb orb-a"></span>
          <span class="orb orb-b"></span>
          <span class="grid-glow"></span>
        </div>

        <div class="verdict-top">
          <div class="matchup-heading">
            <div class="eyebrow">
              <span>Matchup Intelligence</span>
              <i></i>
              <span>${esc(ROLE_LONG[role] || role)}</span>
            </div>

            <h1 class="matchup-title">
              <span class="name-a">${esc(champA)}</span>
              <span class="vs-x">vs</span>
              <span class="name-b">${esc(champB)}</span>
            </h1>
          </div>

          ${confidenceBadge(sampleSize)}
        </div>

        <div class="verdict-main">
          <div class="verdict-primary">
            <div class="favored-label">Favorito del matchup</div>

            <div class="favored-name ${favoredIsLeft ? 'a' : 'b'}">
              ${esc(favoredName)}
            </div>

            <div class="favored-copy">
              ${verdictSentence({
                favoredName,
                favoredWinrate,
                favoredDiff,
                sampleSize,
                role
              })}
            </div>
          </div>

          <div class="verdict-metrics">
            ${heroMetricCard({
              label: 'Winrate favorito',
              value: fmtPct(favoredWinrate, 1),
              tone: favoredIsLeft ? 'a' : 'b',
              sub: `<span>${esc(favoredName)}</span>`
            })}

            ${heroMetricCard({
              label: 'Distanza matchup',
              value: isNum(deltaPp) ? `${fmtDec(deltaPp, 1)} pp` : '—',
              tone: polarityClass(deltaPp),
              sub: `<span>${esc(winrateBalanceLabel(leftWinrate, rightWinrate, champA, champB))}</span>`,
              tip: 'Differenza assoluta tra i due winrate nel matchup.'
            })}

            ${heroMetricCard({
              label: 'Scarto vs media',
              value: fmtSignedPct(favoredDiff, 1),
              tone: polarityClass(favoredDiff),
              sub: `<span>${esc(favoredName)} rispetto al suo winrate generale</span>`
            })}
          </div>
        </div>

        ${winrateRail(champA, champB, leftWinrate, rightWinrate)}

        ${expectedPerformanceRows(
          champA,
          champB,
          role,
          winrate,
          generalWinrate,
          diffWinrate
        )}
      </section>
    `;

    setHTML('verdictBand', html);
  }

  /* ==========================================================================
   * OVERVIEW / CHAMPION IDENTITY
   * --------------------------------------------------------------------------
   * Questa sezione trasforma i profili dei campioni in una lettura immediata:
   *
   * - valore grezzo
   * - percentile nel ruolo
   * - confronto diretto A/B
   * - identità statistica del campione
   * - copertura dati
   *
   * Nessuna metrica viene rimossa:
   * tutte le metriche originali dell'overview restano presenti.
   * ========================================================================== */

  const OVERVIEW_FIELDS = Object.freeze([
    {
      key: 'general_winrate',
      label: 'Winrate generale nel ruolo',
      short: 'Winrate',
      axis: 'Consistenza',
      fmt(value) { return fmtPct(value, 1); },
      higherIsBetter: true,
      tip: 'Winrate medio del campione nel ruolo selezionato, calcolato su tutte le partite disponibili nel dataset.'
    },
    {
      key: 'avg_damage_to_champs',
      label: 'Danno medio ai campioni',
      short: 'Danno',
      axis: 'Pressione offensiva',
      fmt(value) { return fmtInt(value); },
      higherIsBetter: true,
      tip: 'Danno medio inflitto ai campioni nemici nel corso della partita.'
    },
    {
      key: 'avg_damage_taken',
      label: 'Danno medio subito',
      short: 'Danno subito',
      axis: 'Esposizione',
      fmt(value) { return fmtInt(value); },
      higherIsBetter: null,
      tip: 'Danno medio ricevuto. Valori alti possono indicare frontline, esposizione frequente o partite combattute.'
    },
    {
      key: 'vision_score',
      label: 'Vision score medio',
      short: 'Visione',
      axis: 'Controllo mappa',
      fmt(value) { return fmtDec(value, 1); },
      higherIsBetter: true,
      tip: 'Contributo medio al controllo della visione della mappa.'
    },
    {
      key: 'avg_total_time_cc_dealt',
      label: 'CC totale generato',
      short: 'Controllo',
      axis: 'Controllo fight',
      fmt(value) { return `${fmtDec(value, 1)}s`; },
      higherIsBetter: true,
      tip: 'Tempo totale medio in cui il campione applica effetti di controllo ai nemici.'
    },
    {
      key: 'avg_level6_minute',
      label: 'Minuto medio del livello 6',
      short: 'Livello 6',
      axis: 'Timing power spike',
      fmt(value) { return `${fmtDec(value, 2)} min`; },
      higherIsBetter: false,
      tip: 'Minuto medio in cui il campione raggiunge il livello 6. In questo caso un valore più basso indica un timing più rapido.'
    },
    {
      key: 'goldxp_auc',
      label: 'Potere predittivo del vantaggio economico',
      short: 'AUC',
      axis: 'Dipendenza economica',
      fmt(value) { return fmtDec(value, 3); },
      higherIsBetter: null,
      tip: 'Quanto il vantaggio economico al 15° minuto predice la vittoria finale. 0,50 = nessun potere predittivo; valori più alti indicano snowball più leggibile.'
    }
  ]);

  function getProfileValue(profile, key) {
    if (!profile) return null;
    return profile[key];
  }

  function getProfilePercentile(profile, key) {
    if (!profile || !profile.percentiles) return null;
    return profile.percentiles[key];
  }

  function profileCoverageCard(championName, profile, sideClass) {
    const coverage = profile && profile.coverage
      ? profile.coverage
      : { n_matchups: 0, total_games: 0 };

    const totalGames = coverage.total_games || 0;
    const matchups = coverage.n_matchups || 0;
    const conf = confidence(totalGames);

    return `
      <article class="identity-coverage-card ${esc(sideClass)}">
        <div class="identity-coverage-top">
          <div>
            <span class="micro-label">Copertura ruolo</span>
            <h3>${esc(championName)}</h3>
          </div>

          <div
            class="coverage-ring ${esc(conf.level)}"
            data-tip="<div class='tt-title'>Copertura dati</div>${esc(conf.label)} · ${fmtInt(totalGames)} partite totali nel ruolo"
            tabindex="0"
          >
            <span>${fmtInt(matchups)}</span>
            <small>matchup</small>
          </div>
        </div>

        <div class="coverage-stats">
          <div>
            <span>Matchup registrati</span>
            <strong>${fmtInt(matchups)}</strong>
          </div>
          <div>
            <span>Partite totali nel ruolo</span>
            <strong>${fmtInt(totalGames)}</strong>
          </div>
          <div>
            <span>Affidabilità</span>
            <strong>${esc(conf.label)}</strong>
          </div>
        </div>
      </article>
    `;
  }

  function percentileMarker(championName, sideClass, field, value, percentile) {
    if (!isNum(percentile)) return '';

    const safeLeft = clamp(percentile, 0, 100);

    return `
      <span
        class="identity-marker ${esc(sideClass)}"
        style="left:${safeLeft}%"
        data-tip="<div class='tt-title'>${esc(championName)}</div>${esc(field.label)}: ${esc(field.fmt(value))}<br>${fmtDec(percentile, 0)}° percentile nel ruolo<br>${esc(Insight.percentileTone(percentile))}"
        tabindex="0"
      >
        <i></i>
      </span>
    `;
  }

  function percentileRow(field, champA, champB, profileA, profileB, role) {
    const valueA = getProfileValue(profileA, field.key);
    const valueB = getProfileValue(profileB, field.key);

    const percentileA = getProfilePercentile(profileA, field.key);
    const percentileB = getProfilePercentile(profileB, field.key);

    const dominant = dominantSide(
      isNum(percentileA) ? percentileA : null,
      isNum(percentileB) ? percentileB : null,
      champA,
      champB
    );

    const dominantText = dominant
      ? `${dominant.name} più alto di ${fmtDec(dominant.diff, 0)} percentili`
      : 'profilo simile o non confrontabile';

    return `
      <div class="identity-row">
        <div class="identity-row-head">
          <div>
            <span class="micro-label">${esc(field.axis)}</span>
            <strong>
              ${esc(field.label)}
              <span
                class="info-icon"
                tabindex="0"
                data-tip="${esc(field.tip)}<br><br>Percentile calcolato rispetto ai campioni ${esc(ROLE_LABELS[role])} del dataset. 50° percentile = media del ruolo."
              >i</span>
            </strong>
          </div>

          <em>${esc(dominantText)}</em>
        </div>

        <div class="identity-scale" aria-hidden="true">
          <span>0</span>
          <span>25</span>
          <strong>50</strong>
          <span>75</span>
          <span>100</span>
        </div>

        <div class="identity-track">
          <div class="identity-midline"></div>
          ${percentileMarker(champA, 'a', field, valueA, percentileA)}
          ${percentileMarker(champB, 'b', field, valueB, percentileB)}
        </div>

        <div class="identity-values">
          <div class="a">
            <span>${esc(champA)}</span>
            <strong>${field.fmt(valueA)}</strong>
            <em>${isNum(percentileA) ? `p${fmtDec(percentileA, 0)} · ${esc(Insight.percentileTone(percentileA))}` : 'percentile non disponibile'}</em>
          </div>

          <div class="b">
            <span>${esc(champB)}</span>
            <strong>${field.fmt(valueB)}</strong>
            <em>${isNum(percentileB) ? `p${fmtDec(percentileB, 0)} · ${esc(Insight.percentileTone(percentileB))}` : 'percentile non disponibile'}</em>
          </div>
        </div>
      </div>
    `;
  }

  function identityRadarData(profile) {
    return OVERVIEW_FIELDS.map((field) => {
      const percentile = getProfilePercentile(profile, field.key);

      return {
        key: field.key,
        label: field.short,
        value: isNum(percentile) ? clamp(percentile, 0, 100) : null
      };
    });
  }

  function miniIdentityRadar(championName, profile, sideClass) {
    const items = identityRadarData(profile);
    const available = items.filter((item) => isNum(item.value));

    if (!available.length) {
      return `
        <div class="identity-radar empty ${esc(sideClass)}">
          <div class="empty-note">Percentili non disponibili per ${esc(championName)}.</div>
        </div>
      `;
    }

    const size = 260;
    const cx = size / 2;
    const cy = size / 2;
    const radius = 92;
    const labelRadius = 116;
    const count = items.length;

    function pointFor(index, value, r = radius) {
      const angle = -Math.PI / 2 + (Math.PI * 2 * index) / count;
      const scaledRadius = r * (value / 100);

      return {
        x: cx + Math.cos(angle) * scaledRadius,
        y: cy + Math.sin(angle) * scaledRadius
      };
    }

    function labelPoint(index) {
      const angle = -Math.PI / 2 + (Math.PI * 2 * index) / count;

      return {
        x: cx + Math.cos(angle) * labelRadius,
        y: cy + Math.sin(angle) * labelRadius
      };
    }

    const polygonPoints = items.map((item, index) => {
      const p = pointFor(index, isNum(item.value) ? item.value : 0);
      return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    }).join(' ');

    const axes = items.map((item, index) => {
      const end = pointFor(index, 100);
      const label = labelPoint(index);

      return `
        <line
          x1="${cx}"
          y1="${cy}"
          x2="${end.x.toFixed(1)}"
          y2="${end.y.toFixed(1)}"
          stroke="var(--line)"
          stroke-width="1"
        />
        <text
          x="${label.x.toFixed(1)}"
          y="${label.y.toFixed(1)}"
          text-anchor="middle"
          dominant-baseline="middle"
          font-size="10"
          fill="var(--ink-faint)"
        >${esc(item.label)}</text>
      `;
    }).join('');

    const rings = [25, 50, 75, 100].map((level) => {
      const points = items.map((_, index) => {
        const p = pointFor(index, level);
        return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
      }).join(' ');

      return `
        <polygon
          points="${points}"
          fill="none"
          stroke="var(--line)"
          stroke-width="${level === 50 ? 1.2 : 1}"
          opacity="${level === 50 ? 0.9 : 0.55}"
        />
      `;
    }).join('');

    const dots = items.map((item, index) => {
      if (!isNum(item.value)) return '';

      const p = pointFor(index, item.value);

      return `
        <circle
          cx="${p.x.toFixed(1)}"
          cy="${p.y.toFixed(1)}"
          r="3.5"
          fill="var(--champ-${sideClass})"
          data-tip="<div class='tt-title'>${esc(championName)}</div>${esc(item.label)} · p${fmtDec(item.value, 0)}"
        />
      `;
    }).join('');

    return `
      <div class="identity-radar ${esc(sideClass)}">
        <div class="identity-radar-head">
          <span class="micro-label">Impronta statistica</span>
          <strong>${esc(championName)}</strong>
        </div>

        <svg viewBox="0 0 ${size} ${size}" role="img" aria-label="Profilo percentile di ${esc(championName)}">
          ${rings}
          ${axes}
          <polygon
            points="${polygonPoints}"
            fill="var(--champ-${sideClass}-soft)"
            stroke="var(--champ-${sideClass})"
            stroke-width="2"
          />
          ${dots}
        </svg>
      </div>
    `;
  }

  function buildIdentitySummary(championName, profile) {
    const ranked = OVERVIEW_FIELDS.map((field) => {
      const percentile = getProfilePercentile(profile, field.key);
      const value = getProfileValue(profile, field.key);

      return {
        field,
        percentile,
        value
      };
    }).filter((item) => isNum(item.percentile))
      .sort((a, b) => b.percentile - a.percentile);

    const strengths = ranked.slice(0, 2);
    const weaknesses = ranked.slice(-2).reverse();

    const strengthText = strengths.length
      ? strengths.map((item) => `${item.field.short} p${fmtDec(item.percentile, 0)}`).join(' · ')
      : 'punti forti non calcolabili';

    const weaknessText = weaknesses.length
      ? weaknesses.map((item) => `${item.field.short} p${fmtDec(item.percentile, 0)}`).join(' · ')
      : 'aree deboli non calcolabili';

    return `
      <div class="identity-summary">
        <div>
          <span class="micro-label">${esc(championName)}</span>
          <strong>Picchi statistici</strong>
          <p>${esc(strengthText)}</p>
        </div>

        <div>
          <span class="micro-label">${esc(championName)}</span>
          <strong>Aree più basse</strong>
          <p>${esc(weaknessText)}</p>
        </div>
      </div>
    `;
  }

  function renderOverview(M) {
    const role = state.role;
    const champA = state.champA;
    const champB = state.champB;

    const profiles = DATA.championProfiles && DATA.championProfiles[role]
      ? DATA.championProfiles[role]
      : {};

    const profileA = profiles[champA] || {};
    const profileB = profiles[champB] || {};

    const roleChampionCount = DATA.meta.roles_champions && DATA.meta.roles_champions[role]
      ? DATA.meta.roles_champions[role].length
      : 0;

    const rows = OVERVIEW_FIELDS.map((field) => {
      return percentileRow(field, champA, champB, profileA, profileB, role);
    }).join('');

    const html = `
      <section class="overview-identity">
        <div class="section-kicker">
          <span>Champion Identity</span>
          <i></i>
          <span>${fmtInt(roleChampionCount)} campioni ${esc(ROLE_LABELS[role])}</span>
        </div>

        <div class="section-head">
          <div>
            <h2>Profilo dei due campioni nel ruolo</h2>
            <p>
              Ogni metrica mostra il valore reale e il percentile nel ruolo:
              non solo “quanto vale”, ma quanto è fuori scala rispetto agli altri campioni.
            </p>
          </div>
        </div>

        <div class="identity-layout">
          <div class="identity-main card full-span">
            <div class="card-head">
              <div>
                <h3>Mappa percentile del ruolo</h3>
                <span class="card-sub">
                  50° percentile = media del ruolo · valori più a destra = più alti nel dataset
                </span>
              </div>
            </div>

            <div class="identity-rows">
              ${rows}
            </div>
          </div>

          <div class="identity-radar-grid">
            ${miniIdentityRadar(champA, profileA, 'a')}
            ${miniIdentityRadar(champB, profileB, 'b')}
          </div>

          <div class="identity-summary-grid">
            ${buildIdentitySummary(champA, profileA)}
            ${buildIdentitySummary(champB, profileB)}
          </div>

          <div class="identity-coverage-grid">
            ${profileCoverageCard(champA, profileA, 'a')}
            ${profileCoverageCard(champB, profileB, 'b')}
          </div>
        </div>
      </section>
    `;

    setHTML('panel-overview', html);
  }

  /* ==========================================================================
   * TRAJECTORY ENGINE
   * --------------------------------------------------------------------------
   * Andamento partita minuto per minuto:
   *
   * - oro
   * - XP
   * - oro in eccesso
   * - XP in eccesso
   *
   * Il grafico non è più solo una linea:
   * diventa una "mappa del controllo" del matchup.
   *
   * Positivo = vantaggio champA
   * Negativo = vantaggio champB
   * ========================================================================== */

  const TRAJ_MODES = Object.freeze({
    gold: {
      col: 'gold_diff_by_minute',
      label: 'Oro',
      short: 'Gold',
      unit: ' oro',
      precision: 0,
      tone: 'economy',
      explain(champA, champB) {
        return `Differenza di oro accumulato tra ${champA} e ${champB}, minuto per minuto.`;
      }
    },

    xp: {
      col: 'xp_diff_by_minute',
      label: 'XP',
      short: 'XP',
      unit: ' XP',
      precision: 0,
      tone: 'experience',
      explain(champA, champB) {
        return `Differenza di esperienza accumulata tra ${champA} e ${champB}, minuto per minuto.`;
      }
    },

    excessGold: {
      col: 'excess_gold_diff_by_minute',
      label: 'Oro in eccesso',
      short: 'Excess Gold',
      unit: ' oro',
      precision: 0,
      tone: 'excess',
      explain(champA, champB) {
        return `Vantaggio in oro imputabile allo scontro specifico tra ${champA} e ${champB}, al netto della forza media dei due campioni nel ruolo.`;
      }
    },

    excessXp: {
      col: 'excess_xp_diff_by_minute',
      label: 'XP in eccesso',
      short: 'Excess XP',
      unit: ' XP',
      precision: 0,
      tone: 'excess',
      explain(champA, champB) {
        return `Vantaggio in esperienza imputabile allo scontro specifico tra ${champA} e ${champB}, al netto della forza media dei due campioni nel ruolo.`;
      }
    }
  });

  function signedSeriesValue(value, mode) {
    return fmtSigned(value, mode.precision, mode.unit);
  }

  function seriesLeader(value, champA, champB) {
    if (!isNum(value) || Math.abs(value) < 0.000001) {
      return {
        side: 'neutral',
        name: 'Pareggio',
        label: 'in equilibrio'
      };
    }

    return value > 0
      ? { side: 'a', name: champA, label: `vantaggio ${champA}` }
      : { side: 'b', name: champB, label: `vantaggio ${champB}` };
  }

  function analyzeTrajectory(values, champA, champB) {
    const clean = Array.isArray(values)
      ? values.map((value, minute) => ({ minute, value })).filter((p) => isNum(p.value))
      : [];

    if (!clean.length) {
      return {
        hasData: false,
        points: [],
        peak: null,
        final: null,
        minute15: null,
        leadChanges: 0,
        dominantSide: null
      };
    }

    let peak = clean[0];
    let leadChanges = 0;
    let previousSign = Math.sign(clean[0].value);

    clean.forEach((point) => {
      if (Math.abs(point.value) > Math.abs(peak.value)) {
        peak = point;
      }

      const sign = Math.sign(point.value);

      if (sign !== 0 && previousSign !== 0 && sign !== previousSign) {
        leadChanges += 1;
      }

      if (sign !== 0) {
        previousSign = sign;
      }
    });

    const final = clean[clean.length - 1];
    const minute15 = clean.reduce((best, point) => {
      if (!best) return point;
      return Math.abs(point.minute - 15) < Math.abs(best.minute - 15) ? point : best;
    }, null);

    const positiveMagnitude = clean.reduce((sum, point) => {
      return sum + Math.max(0, point.value);
    }, 0);

    const negativeMagnitude = clean.reduce((sum, point) => {
      return sum + Math.abs(Math.min(0, point.value));
    }, 0);

    const dominantSide =
      Math.abs(positiveMagnitude - negativeMagnitude) < 0.000001
        ? null
        : positiveMagnitude > negativeMagnitude
          ? { side: 'a', name: champA }
          : { side: 'b', name: champB };

    return {
      hasData: true,
      points: clean,
      peak,
      final,
      minute15,
      leadChanges,
      dominantSide
    };
  }

  function trajectorySummaryHtml(analysis, mode, champA, champB) {
    if (!analysis.hasData) {
      return `
        <div class="trajectory-summary empty">
          <div class="empty-note">Dati insufficienti per leggere l’andamento della partita.</div>
        </div>
      `;
    }

    const peakLeader = seriesLeader(analysis.peak.value, champA, champB);
    const finalLeader = seriesLeader(analysis.final.value, champA, champB);
    const minute15Leader = seriesLeader(analysis.minute15.value, champA, champB);

    return `
      <div class="trajectory-summary">
        <div class="trajectory-summary-card ${esc(peakLeader.side)}">
          <span class="micro-label">Picco massimo</span>
          <strong>${signedSeriesValue(analysis.peak.value, mode)}</strong>
          <p>Minuto ${fmtInt(analysis.peak.minute)} · ${esc(peakLeader.label)}</p>
        </div>

        <div class="trajectory-summary-card ${esc(minute15Leader.side)}">
          <span class="micro-label">Al minuto 15</span>
          <strong>${signedSeriesValue(analysis.minute15.value, mode)}</strong>
          <p>${esc(minute15Leader.label)}</p>
        </div>

        <div class="trajectory-summary-card ${esc(finalLeader.side)}">
          <span class="micro-label">Ultimo minuto tracciato</span>
          <strong>${signedSeriesValue(analysis.final.value, mode)}</strong>
          <p>Minuto ${fmtInt(analysis.final.minute)} · ${esc(finalLeader.label)}</p>
        </div>

        <div class="trajectory-summary-card neutral">
          <span class="micro-label">Cambi di leadership</span>
          <strong>${fmtInt(analysis.leadChanges)}</strong>
          <p>${analysis.leadChanges === 0 ? 'traiettoria stabile' : 'matchup oscillante'}</p>
        </div>
      </div>
    `;
  }

  function catmullRomPath(points) {
    if (!points.length) return '';

    if (points.length === 1) {
      return `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
    }

    let path = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;

    for (let i = 0; i < points.length - 1; i += 1) {
      const p0 = points[i - 1] || points[i];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + 2] || p2;

      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;

      path += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
    }

    return path;
  }

  function buildAreaPath(points, centerY, positive) {
    const selected = points.map((point) => ({
      x: point.x,
      y: positive
        ? Math.min(point.y, centerY)
        : Math.max(point.y, centerY)
    }));

    if (!selected.length) return '';

    const first = selected[0];
    const last = selected[selected.length - 1];
    const curve = catmullRomPath(selected);

    return `
      M${first.x.toFixed(1)},${centerY.toFixed(1)}
      ${curve.replace(/^M[^C]+/, 'L' + first.x.toFixed(1) + ',' + first.y.toFixed(1))}
      L${last.x.toFixed(1)},${centerY.toFixed(1)}
      Z
    `;
  }

  function buildRiverSVG(minutes, values, mode, champA, champB) {
    const W = 1100;
    const H = 360;

    const L = 64;
    const R = 28;
    const T = 26;
    const B = 42;

    const plotW = W - L - R;
    const plotH = H - T - B;
    const centerY = T + plotH / 2;

    const rawPoints = [];

    for (let i = 0; i < minutes.length; i += 1) {
      if (isNum(values[i])) {
        rawPoints.push({
          minute: minutes[i],
          value: values[i]
        });
      }
    }

    if (!rawPoints.length) return null;

    const extent = seriesExtent(values);
    const maxMinute = minutes[minutes.length - 1] || 1;
    const domainMax = Math.max(1, extent.maxAbs * 1.22);

    function xAt(minute) {
      return L + (minute / maxMinute) * plotW;
    }

    function yAt(value) {
      return centerY - (value / domainMax) * (plotH / 2);
    }

    const points = rawPoints.map((point) => ({
      minute: point.minute,
      value: point.value,
      x: xAt(point.minute),
      y: yAt(point.value)
    }));

    const linePath = catmullRomPath(points);
    const posArea = buildAreaPath(points, centerY, true);
    const negArea = buildAreaPath(points, centerY, false);

    const step = niceStep(domainMax / 2.2);
    let gridSvg = '';

    for (let g = step; g <= domainMax; g += step) {
      const yTop = yAt(g);
      const yBottom = yAt(-g);

      gridSvg += `
        <line x1="${L}" x2="${L + plotW}" y1="${yTop.toFixed(1)}" y2="${yTop.toFixed(1)}" class="river-grid-line" />
        <text x="${L - 10}" y="${(yTop + 4).toFixed(1)}" text-anchor="end" class="river-axis-label">+${fmtInt(g)}</text>

        <line x1="${L}" x2="${L + plotW}" y1="${yBottom.toFixed(1)}" y2="${yBottom.toFixed(1)}" class="river-grid-line" />
        <text x="${L - 10}" y="${(yBottom + 4).toFixed(1)}" text-anchor="end" class="river-axis-label">-${fmtInt(g)}</text>
      `;
    }

    const tickStep = maxMinute > 24 ? 10 : 5;
    let xTicksSvg = '';

    for (let minute = 0; minute <= maxMinute; minute += tickStep) {
      xTicksSvg += `
        <line x1="${xAt(minute).toFixed(1)}" x2="${xAt(minute).toFixed(1)}" y1="${T}" y2="${T + plotH}" class="river-time-line" />
        <text x="${xAt(minute).toFixed(1)}" y="${H - 13}" text-anchor="middle" class="river-axis-label">${minute}'</text>
      `;
    }

    const analysis = analyzeTrajectory(values, champA, champB);
    const markers = [];

    if (analysis.minute15) {
      markers.push({
        type: 'minute15',
        label: '15’',
        point: analysis.minute15,
        tip: `Minuto 15 · ${signedSeriesValue(analysis.minute15.value, mode)}`
      });
    }

    if (analysis.peak) {
      markers.push({
        type: 'peak',
        label: 'Peak',
        point: analysis.peak,
        tip: `Picco massimo · minuto ${fmtInt(analysis.peak.minute)} · ${signedSeriesValue(analysis.peak.value, mode)}`
      });
    }

    const markerSvg = markers.map((marker) => {
      const x = xAt(marker.point.minute);
      const y = yAt(marker.point.value);
      const leader = seriesLeader(marker.point.value, champA, champB);

      return `
        <g class="river-marker ${esc(marker.type)} ${esc(leader.side)}" tabindex="0" data-tip="<div class='tt-title'>${esc(marker.label)}</div>${esc(marker.tip)}">
          <line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${T}" y2="${T + plotH}" />
          <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5.5" />
          <text x="${x.toFixed(1)}" y="${(y - 12).toFixed(1)}" text-anchor="middle">${esc(marker.label)}</text>
        </g>
      `;
    }).join('');

    const gradientId = `river-${Math.random().toString(36).slice(2, 9)}`;

    const svg = `
      <svg
        class="river-chart tone-${esc(mode.tone)}"
        viewBox="0 0 ${W} ${H}"
        role="img"
        aria-label="Andamento ${esc(mode.label)} del matchup"
        data-river="1"
        data-l="${L}"
        data-t="${T}"
        data-plotw="${plotW}"
        data-ploth="${plotH}"
        data-maxminute="${maxMinute}"
      >
        <defs>
          <linearGradient id="${gradientId}-a" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--champ-a)" stop-opacity="0.58" />
            <stop offset="72%" stop-color="var(--champ-a)" stop-opacity="0.12" />
            <stop offset="100%" stop-color="var(--champ-a)" stop-opacity="0.02" />
          </linearGradient>

          <linearGradient id="${gradientId}-b" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stop-color="var(--champ-b)" stop-opacity="0.58" />
            <stop offset="72%" stop-color="var(--champ-b)" stop-opacity="0.12" />
            <stop offset="100%" stop-color="var(--champ-b)" stop-opacity="0.02" />
          </linearGradient>

          <filter id="${gradientId}-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3.2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <rect x="${L}" y="${T}" width="${plotW}" height="${plotH}" rx="18" class="river-plot-bg" />

        <g class="river-grid">
          ${gridSvg}
          ${xTicksSvg}
        </g>

        <line
          x1="${L}"
          x2="${L + plotW}"
          y1="${centerY.toFixed(1)}"
          y2="${centerY.toFixed(1)}"
          class="river-zero-line"
        />

        <path d="${posArea}" fill="url(#${gradientId}-a)" class="river-area river-area-a" />
        <path d="${negArea}" fill="url(#${gradientId}-b)" class="river-area river-area-b" />

        <path d="${linePath}" class="river-glow-trace" filter="url(#${gradientId}-glow)" />
        <path d="${linePath}" class="river-trace riv-trace" />

        ${markerSvg}

        <g class="riv-hover" style="display:none">
          <line class="riv-hover-line" y1="${T}" y2="${T + plotH}" />
          <circle class="riv-hover-dot" r="5.5" />
          <text class="riv-hover-label" y="${T + 18}" text-anchor="middle"></text>
        </g>

        <rect
          class="riv-capture"
          x="${L}"
          y="${T}"
          width="${plotW}"
          height="${plotH}"
          fill="transparent"
        />
      </svg>
    `;

    return {
      svg,
      pts: points,
      xAt,
      yAt,
      analysis,
      domainMax,
      maxMinute
    };
  }

  function attachRiverInteractivity(wrapEl, chart, mode) {
    const svg = wrapEl.querySelector('svg[data-river]');
    if (!svg) return;

    const capture = svg.querySelector('.riv-capture');
    const hoverGroup = svg.querySelector('.riv-hover');
    const hoverLine = svg.querySelector('.riv-hover-line');
    const hoverDot = svg.querySelector('.riv-hover-dot');
    const hoverLabel = svg.querySelector('.riv-hover-label');

    if (!capture || !hoverGroup || !hoverLine || !hoverDot) return;

    function nearestPointFromEvent(event) {
      const rect = svg.getBoundingClientRect();
      const viewBox = svg.viewBox.baseVal;
      const scaleX = viewBox.width / rect.width;

      const x = (event.clientX - rect.left) * scaleX;

      const L = Number(svg.getAttribute('data-l'));
      const plotW = Number(svg.getAttribute('data-plotw'));
      const maxMinute = Number(svg.getAttribute('data-maxminute'));

      const minuteAtX = ((x - L) / plotW) * maxMinute;

      let nearest = chart.pts[0];
      let bestDistance = Infinity;

      chart.pts.forEach((point) => {
        const distance = Math.abs(point.minute - minuteAtX);

        if (distance < bestDistance) {
          bestDistance = distance;
          nearest = point;
        }
      });

      return nearest;
    }

    capture.addEventListener('mousemove', (event) => {
      const point = nearestPointFromEvent(event);
      const leader = seriesLeader(point.value, state.champA, state.champB);

      hoverGroup.style.display = '';

      hoverLine.setAttribute('x1', point.x);
      hoverLine.setAttribute('x2', point.x);

      hoverDot.setAttribute('cx', point.x);
      hoverDot.setAttribute('cy', point.y);

      if (hoverLabel) {
        hoverLabel.setAttribute('x', point.x);
        hoverLabel.textContent = `${Math.round(point.minute)}’`;
      }

      const rect = svg.getBoundingClientRect();
      const viewBox = svg.viewBox.baseVal;

      const screenX = rect.left + (point.x / viewBox.width) * rect.width;
      const screenY = rect.top + (point.y / viewBox.height) * rect.height;

      const tooltip = `
        <div class="tt-title">Minuto ${fmtInt(point.minute)}</div>
        <strong>${signedSeriesValue(point.value, mode)}</strong><br>
        ${esc(leader.label)}
      `;

      showTip(screenX, screenY, tooltip);
    });

    capture.addEventListener('mouseleave', () => {
      hoverGroup.style.display = 'none';
      hideTip();
    });
  }

  function animateTrace(svgEl) {
    if (!svgEl) return;

    const path = svgEl.querySelector('.riv-trace');
    if (!path) return;

    const reducedMotion = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reducedMotion) return;

    try {
      const length = path.getTotalLength();

      path.style.strokeDasharray = length;
      path.style.strokeDashoffset = length;

      path.getBoundingClientRect();

      path.style.transition = 'stroke-dashoffset 900ms var(--ease-emphatic)';

      requestAnimationFrame(() => {
        path.style.strokeDashoffset = '0';
      });
    } catch (error) {
      // Alcuni browser possono fallire su path SVG vuoti o non ancora misurabili.
    }
  }

  function levelSixTimeline(champA, champB, levelA, levelB) {
    if (!isNum(levelA) && !isNum(levelB)) {
      return `
        <div class="empty-note">
          Dato non disponibile per almeno uno dei due campioni.
        </div>
      `;
    }

    const maxAxis = Math.max(12, (levelA || 0) + 1, (levelB || 0) + 1);

    function marker(championName, sideClass, value) {
      if (!isNum(value)) return '';

      return `
        <div
          class="level6-marker ${esc(sideClass)}"
          style="left:${clamp(value / maxAxis * 100, 0, 100)}%"
          data-tip="<div class='tt-title'>${esc(championName)}</div>Livello 6 medio: ${fmtDec(value, 2)} minuti"
          tabindex="0"
        >
          <span class="dot"></span>
          <strong>${esc(championName)}</strong>
          <em>${fmtDec(value, 2)}'</em>
        </div>
      `;
    }

    const faster =
      isNum(levelA) && isNum(levelB)
        ? levelA < levelB
          ? { name: champA, diff: levelB - levelA }
          : levelB < levelA
            ? { name: champB, diff: levelA - levelB }
            : null
        : null;

    return `
      <div class="level6-story">
        <div class="level6-axis">
          <div class="level6-line"></div>
          ${marker(champA, 'a', levelA)}
          ${marker(champB, 'b', levelB)}
        </div>

        <div class="level6-caption">
          ${
            faster
              ? `<strong>${esc(faster.name)}</strong> raggiunge mediamente il livello 6 ${fmtDec(faster.diff, 2)} minuti prima.`
              : 'I due campioni raggiungono il livello 6 con un timing molto simile.'
          }
        </div>
      </div>
    `;
  }

  function renderTrajectory(M) {
    const role = state.role;
    const champA = state.champA;
    const champB = state.champB;

    const mode = TRAJ_MODES[state.trajMode] || TRAJ_MODES.gold;
    const series = M.arrAB(mode.col);
    const analysis = analyzeTrajectory(series, champA, champB);

    const profiles = DATA.championProfiles && DATA.championProfiles[role]
      ? DATA.championProfiles[role]
      : {};

    const profileA = profiles[champA] || {};
    const profileB = profiles[champB] || {};

    const html = `
      <section class="trajectory-section">
        <div class="section-kicker">
          <span>Game Flow</span>
          <i></i>
          <span>minuto per minuto</span>
        </div>

        <div class="section-head">
          <div>
            <h2>Quando nasce il vantaggio?</h2>
            <p>
              La traiettoria mostra se il matchup tende a essere stabile,
              oscillante o dominato da uno dei due campioni lungo la partita.
            </p>
          </div>
        </div>

        <div class="card full-span trajectory-card">
          <div class="card-head trajectory-head">
            <div>
              <h3>Andamento della partita</h3>
              <span class="card-sub">
                Positivo = vantaggio di
                <strong style="color:var(--champ-a)">${esc(champA)}</strong>
                · Negativo = vantaggio di
                <strong style="color:var(--champ-b)">${esc(champB)}</strong>
              </span>
            </div>

            <div class="river-controls" id="trajControls">
              ${Object.keys(TRAJ_MODES).map((key) => {
                const item = TRAJ_MODES[key];

                return `
                  <button
                    class="river-btn ${state.trajMode === key ? 'active' : ''}"
                    type="button"
                    data-mode="${esc(key)}"
                    aria-pressed="${state.trajMode === key ? 'true' : 'false'}"
                  >
                    <span>${esc(item.label)}</span>
                  </button>
                `;
              }).join('')}
            </div>
          </div>

          <div class="trajectory-note" id="trajNote">
            ${esc(mode.explain(champA, champB))}
          </div>

          ${trajectorySummaryHtml(analysis, mode, champA, champB)}

          <div class="river-svg-wrap" id="trajSvgWrap"></div>

          <div class="river-legend">
            <span><i style="background:var(--champ-a)"></i>${esc(champA)}</span>
            <span><i style="background:var(--champ-b)"></i>${esc(champB)}</span>
            <em>zero = equilibrio</em>
          </div>
        </div>

        <div class="card full-span level6-card">
          <div class="card-head">
            <div>
              <h3>Timing del livello 6</h3>
              <span class="card-sub">
                Power spike medio calcolato sulle partite complessive nel ruolo.
              </span>
            </div>

            <span
              class="info-icon"
              tabindex="0"
              data-tip="Minuto medio in cui il campione raggiunge il livello 6, calcolato sulle partite complessive nel ruolo e non solo su questo matchup."
            >i</span>
          </div>

          ${levelSixTimeline(
            champA,
            champB,
            profileA.avg_level6_minute,
            profileB.avg_level6_minute
          )}
        </div>
      </section>
    `;

    setHTML('panel-trajectory', html);

    $all('#trajControls .river-btn').forEach((button) => {
      button.addEventListener('click', () => {
        state.trajMode = button.getAttribute('data-mode');

        $all('#trajControls .river-btn').forEach((btn) => {
          const isActive = btn === button;
          btn.classList.toggle('active', isActive);
          btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });

        drawTrajChart(M);
      });
    });

    drawTrajChart(M);
  }

  function drawTrajChart(M) {
    const mode = TRAJ_MODES[state.trajMode] || TRAJ_MODES.gold;

    const noteEl = byId('trajNote');
    const wrap = byId('trajSvgWrap');

    if (!wrap) return;

    if (noteEl) {
      noteEl.textContent = mode.explain(state.champA, state.champB);
    }

    const series = M.arrAB(mode.col);

    if (!Array.isArray(series) || !series.some(isNum)) {
      wrap.innerHTML = `
        <div class="empty-note">
          Dati insufficienti per calcolare questa serie su questo matchup.
        </div>
      `;
      return;
    }

    const minutes = series.map((_, index) => index);
    const chart = buildRiverSVG(minutes, series, mode, state.champA, state.champB);

    if (!chart) {
      wrap.innerHTML = `
        <div class="empty-note">
          Dati insufficienti per generare il grafico.
        </div>
      `;
      return;
    }

    wrap.innerHTML = chart.svg;

    const svgEl = wrap.querySelector('svg');

    attachRiverInteractivity(wrap, chart, mode);
    animateTrace(svgEl);

    const trajectoryCard = wrap.closest('.trajectory-card');
    if (trajectoryCard) {
      const existingSummary = trajectoryCard.querySelector('.trajectory-summary');
      if (existingSummary) {
        existingSummary.outerHTML = trajectorySummaryHtml(
          chart.analysis,
          mode,
          state.champA,
          state.champB
        );
      }
    }
  }

  /* ==========================================================================
   * COMBAT ANALYSIS
   * --------------------------------------------------------------------------
   * Sezione combattimento:
   *
   * - composizione danno: fisico / magico / puro
   * - danno inflitto
   * - danno subito
   * - controllo / CC
   * - visione
   *
   * Obiettivo:
   * non mostrare solo numeri, ma spiegare il profilo di combattimento:
   * chi pressa, chi assorbe, chi controlla, chi dà più valore macro.
   * ========================================================================== */

  function metricDifference(leftValue, rightValue) {
    if (!isNum(leftValue) || !isNum(rightValue)) {
      return null;
    }

    return leftValue - rightValue;
  }

  function relativeDifference(leftValue, rightValue) {
    if (!isNum(leftValue) || !isNum(rightValue) || rightValue === 0) {
      return null;
    }

    return (leftValue - rightValue) / Math.abs(rightValue);
  }

  function metricLeader(leftValue, rightValue, champA, champB) {
    if (!isNum(leftValue) || !isNum(rightValue)) return null;

    const diff = leftValue - rightValue;

    if (Math.abs(diff) < 0.000001) {
      return {
        side: 'neutral',
        name: null,
        diff: 0,
        ratio: 0,
        label: 'equilibrio'
      };
    }

    const leftLeads = diff > 0;

    return {
      side: leftLeads ? 'a' : 'b',
      name: leftLeads ? champA : champB,
      diff: Math.abs(diff),
      ratio: relativeDifference(
        leftLeads ? leftValue : rightValue,
        leftLeads ? rightValue : leftValue
      ),
      label: leftLeads ? champA : champB
    };
  }

  function compareBarRow(
    label,
    tip,
    leftValue,
    rightValue,
    leftName,
    rightName,
    decimals,
    unit,
    sharedMax
  ) {
    const max = sharedMax ||
      Math.max(Math.abs(leftValue || 0), Math.abs(rightValue || 0)) * 1.15 ||
      1;

    const leader = metricLeader(leftValue, rightValue, leftName, rightName);

    const infoHtml = tip
      ? `
        <span
          class="info-icon"
          tabindex="0"
          data-tip="${esc(tip)}"
        >i</span>
      `
      : '';

    function valueText(value) {
      return isNum(value)
        ? `${fmtDec(value, decimals)}${unit}`
        : '—';
    }

    function row(sideClass, name, value) {
      const width = percentWidth(value, max);

      const leadClass = leader && leader.side === sideClass
        ? 'is-leader'
        : '';

      return `
        <div class="compare-bar-row ${esc(sideClass)} ${esc(leadClass)}">
          <div class="compare-name">
            <span>${esc(name)}</span>
          </div>

          <div class="compare-track">
            <div
              class="compare-fill ${esc(sideClass)}"
              style="width:${width}%"
            ></div>
          </div>

          <div class="compare-value">
            ${valueText(value)}
          </div>
        </div>
      `;
    }

    const leaderCopy = leader && leader.name
      ? `
        <em class="${esc(leader.side)}">
          ${esc(leader.name)} sopra di ${fmtDec(leader.diff, decimals)}${unit}
          ${
            isNum(leader.ratio)
              ? ` · ${fmtSignedPct(leader.ratio, 1)}`
              : ''
          }
        </em>
      `
      : '<em>valori simili o non disponibili</em>';

    return `
      <div class="compare-bar">
        <div class="compare-bar-label">
          <strong>${esc(label)}</strong>
          ${infoHtml}
          ${leaderCopy}
        </div>

        ${row('a', leftName, leftValue)}
        ${row('b', rightName, rightValue)}
      </div>
    `;
  }

  function damageTypeName(type) {
    return {
      physical: 'Fisico',
      magic: 'Magico',
      true: 'Puro'
    }[type] || type;
  }

  function damageTypeClass(type) {
    return {
      physical: 'phys',
      magic: 'magic',
      true: 'true'
    }[type] || type;
  }

  function dominantDamageType(physical, magic, trueDamage) {
    const items = [
      { type: 'physical', value: physical },
      { type: 'magic', value: magic },
      { type: 'true', value: trueDamage }
    ].filter((item) => isNum(item.value));

    if (!items.length) return null;

    items.sort((a, b) => b.value - a.value);

    return items[0];
  }

  function damageStackRow(sideClass, championName, physical, magic, trueDamage) {
    const segments = [
      {
        type: 'physical',
        value: physical,
        color: 'var(--dmg-phys)'
      },
      {
        type: 'magic',
        value: magic,
        color: 'var(--dmg-magic)'
      },
      {
        type: 'true',
        value: trueDamage,
        color: 'var(--dmg-true)'
      }
    ];

    const dominant = dominantDamageType(physical, magic, trueDamage);

    const segmentsHtml = segments.map((segment) => {
      if (!isNum(segment.value)) return '';

      const width = clamp(segment.value * 100, 0, 100);

      if (width <= 0.4) return '';

      const label = damageTypeName(segment.type);
      const typeClass = damageTypeClass(segment.type);

      return `
        <div
          class="stack-seg ${esc(typeClass)}"
          style="width:${width}%;background:${segment.color}"
          data-tip="<div class='tt-title'>${esc(championName)}</div>${esc(label)}: ${fmtPct(segment.value, 1)}"
          tabindex="0"
        >
          ${width > 10 ? `<span>${fmtPct(segment.value, 0)}</span>` : ''}
        </div>
      `;
    }).join('');

    const dominantCopy = dominant
      ? `${damageTypeName(dominant.type)} · ${fmtPct(dominant.value, 1)}`
      : 'Composizione non disponibile';

    return `
      <div class="stack-row ${esc(sideClass)}">
        <div class="stack-row-head">
          <strong>${esc(championName)}</strong>
          <em>${esc(dominantCopy)}</em>
        </div>

        <div class="stack-track">
          ${segmentsHtml || '<div class="stack-empty">Dati non disponibili</div>'}
        </div>
      </div>
    `;
  }

  function combatInsightCard(title, value, sub, sideClass, tip) {
    const tipAttr = tip
      ? ` data-tip="${esc(tip)}" tabindex="0"`
      : '';

    return `
      <div class="combat-insight-card ${esc(sideClass || 'neutral')}"${tipAttr}>
        <span class="micro-label">${esc(title)}</span>
        <strong>${value}</strong>
        <p>${sub}</p>
      </div>
    `;
  }

  function combatHeadline({
    champA,
    champB,
    dealt,
    taken,
    ccTotal,
    vision
  }) {
    const damageLeader = metricLeader(dealt[0], dealt[1], champA, champB);
    const tankLeader = metricLeader(taken[0], taken[1], champA, champB);
    const ccLeader = metricLeader(ccTotal[0], ccTotal[1], champA, champB);
    const visionLeader = metricLeader(vision[0], vision[1], champA, champB);

    const fragments = [];

    if (damageLeader && damageLeader.name) {
      fragments.push(`<strong>${esc(damageLeader.name)}</strong> genera più pressione offensiva`);
    }

    if (ccLeader && ccLeader.name) {
      fragments.push(`<strong>${esc(ccLeader.name)}</strong> produce più controllo`);
    }

    if (visionLeader && visionLeader.name) {
      fragments.push(`<strong>${esc(visionLeader.name)}</strong> porta più valore di visione`);
    }

    if (!fragments.length) {
      return 'I due campioni mostrano un profilo di combattimento molto vicino sui dati disponibili.';
    }

    return fragments.join(' · ') + '.';
  }

  function damageCompositionCard(champA, champB, physical, magic, trueDamage) {
    return `
      <div class="card combat-card damage-composition-card">
        <div class="card-head">
          <div>
            <h3>Composizione del danno</h3>
            <span class="card-sub">
              Distribuzione percentuale tra danno fisico, magico e puro.
            </span>
          </div>
        </div>

        <div class="damage-stack-list">
          ${damageStackRow('a', champA, physical[0], magic[0], trueDamage[0])}
          ${damageStackRow('b', champB, physical[1], magic[1], trueDamage[1])}
        </div>

        <div class="dmg-legend">
          <span><i style="background:var(--dmg-phys)"></i>Fisico</span>
          <span><i style="background:var(--dmg-magic)"></i>Magico</span>
          <span><i style="background:var(--dmg-true)"></i>Puro</span>
        </div>
      </div>
    `;
  }

  function combatBalanceCard(champA, champB, dealt, taken) {
    const maxDamage = Math.max(
      dealt[0] || 0,
      dealt[1] || 0,
      taken[0] || 0,
      taken[1] || 0
    ) * 1.15 || 1;

    const dealtLeader = metricLeader(dealt[0], dealt[1], champA, champB);
    const takenLeader = metricLeader(taken[0], taken[1], champA, champB);

    return `
      <div class="card combat-card">
        <div class="card-head">
          <div>
            <h3>Danno inflitto e subito</h3>
            <span class="card-sub">
              Pressione offensiva e livello di esposizione nel matchup.
            </span>
          </div>
        </div>

        <div class="combat-insight-strip">
          ${combatInsightCard(
            'Pressione offensiva',
            dealtLeader && dealtLeader.name ? esc(dealtLeader.name) : 'Equilibrio',
            dealtLeader && dealtLeader.name
              ? `+${fmtDec(dealtLeader.diff, 0)} danni medi`
              : 'nessun vantaggio chiaro',
            dealtLeader ? dealtLeader.side : 'neutral'
          )}

          ${combatInsightCard(
            'Maggiore esposizione',
            takenLeader && takenLeader.name ? esc(takenLeader.name) : 'Equilibrio',
            takenLeader && takenLeader.name
              ? `+${fmtDec(takenLeader.diff, 0)} danni subiti`
              : 'valori molto vicini',
            takenLeader ? takenLeader.side : 'neutral',
            'Il danno subito non è automaticamente negativo: può indicare frontline, ingaggi frequenti o maggiore presenza nei fight.'
          )}
        </div>

        ${compareBarRow(
          'Danno medio ai campioni',
          'Danno medio inflitto ai campioni nemici nel corso della partita.',
          dealt[0],
          dealt[1],
          champA,
          champB,
          0,
          '',
          maxDamage
        )}

        ${compareBarRow(
          'Danno medio subito',
          'Danno medio ricevuto nel corso della partita.',
          taken[0],
          taken[1],
          champA,
          champB,
          0,
          '',
          maxDamage
        )}
      </div>
    `;
  }

  function controlCard(champA, champB, ccOthers, ccTotal) {
    const ccTip =
      'Secondi medi in cui il campione tiene sotto controllo i nemici tramite stordimenti, rallentamenti, immobilizzazioni e simili.';

    const ccTotalTip =
      'Somma complessiva del tempo di controllo generato dal campione su tutti i nemici nel corso della partita.';

    const ccLeader = metricLeader(ccTotal[0], ccTotal[1], champA, champB);

    return `
      <div class="card combat-card">
        <div class="card-head">
          <div>
            <h3>Controllo degli scontri</h3>
            <span class="card-sub">
              Quanto il campione condiziona movimento, ingaggi e fight.
            </span>
          </div>
        </div>

        <div class="combat-insight-strip single">
          ${combatInsightCard(
            'Controllo complessivo',
            ccLeader && ccLeader.name ? esc(ccLeader.name) : 'Equilibrio',
            ccLeader && ccLeader.name
              ? `+${fmtDec(ccLeader.diff, 1)}s di CC totale medio`
              : 'nessuna distanza netta',
            ccLeader ? ccLeader.side : 'neutral'
          )}
        </div>

        ${compareBarRow(
          'Tempo medio di CC sui nemici',
          ccTip,
          ccOthers[0],
          ccOthers[1],
          champA,
          champB,
          1,
          's'
        )}

        ${compareBarRow(
          'Tempo totale di CC generato',
          ccTotalTip,
          ccTotal[0],
          ccTotal[1],
          champA,
          champB,
          1,
          's'
        )}
      </div>
    `;
  }

  function visionCard(champA, champB, vision, visionDiff) {
    const visionLeader = metricLeader(vision[0], vision[1], champA, champB);

    const diffLeader = isNum(visionDiff)
      ? visionDiff > 0
        ? champA
        : visionDiff < 0
          ? champB
          : null
      : null;

    return `
      <div class="card combat-card vision-card">
        <div class="card-head">
          <div>
            <h3>Visione e controllo mappa</h3>
            <span class="card-sub">
              Lettura del contributo macro tramite vision score medio.
            </span>
          </div>
        </div>

        <div class="combat-insight-strip">
          ${combatInsightCard(
            'Vision leader',
            visionLeader && visionLeader.name ? esc(visionLeader.name) : 'Equilibrio',
            visionLeader && visionLeader.name
              ? `+${fmtDec(visionLeader.diff, 1)} vision score`
              : 'valori simili',
            visionLeader ? visionLeader.side : 'neutral'
          )}

          ${combatInsightCard(
            `${esc(champA)} meno ${esc(champB)}`,
            fmtSigned(visionDiff, 1),
            diffLeader
              ? `differenziale a favore di ${esc(diffLeader)}`
              : 'differenziale neutro o non disponibile',
            polarityClass(visionDiff)
          )}
        </div>

        ${compareBarRow(
          'Vision score medio',
          'Metrica ufficiale del gioco che sintetizza piazzamento/rimozione ward e contributo al controllo visione.',
          vision[0],
          vision[1],
          champA,
          champB,
          1,
          ''
        )}
      </div>
    `;
  }

  function renderCombat(M) {
    const champA = state.champA;
    const champB = state.champB;

    const physical = M.pair('pct_physical_dmg');
    const magic = M.pair('pct_magic_dmg');
    const trueDamage = M.pair('pct_true_dmg');

    const dealt = M.pair('avg_damage_to_champs');
    const taken = M.pair('avg_damage_taken');

    const ccOthers = M.pair('avg_time_ccing_others');
    const ccTotal = M.pair('avg_total_time_cc_dealt');

    const vision = M.pair('vision_score');
    const visionDiff = M.diffAB('vision_diff_a_minus_b');

    const html = `
      <section class="combat-section">
        <div class="section-kicker">
          <span>Combat Profile</span>
          <i></i>
          <span>danno · controllo · visione</span>
        </div>

        <div class="section-head">
          <div>
            <h2>Come combattono davvero?</h2>
            <p>
              ${combatHeadline({
                champA,
                champB,
                dealt,
                taken,
                ccTotal,
                vision
              })}
            </p>
          </div>
        </div>

        <div class="panel-grid combat-grid">
          ${damageCompositionCard(champA, champB, physical, magic, trueDamage)}
          ${combatBalanceCard(champA, champB, dealt, taken)}
          ${controlCard(champA, champB, ccOthers, ccTotal)}
          ${visionCard(champA, champB, vision, visionDiff)}
        </div>
      </section>
    `;

    setHTML('panel-combat', html);
  }


  /* ==========================================================================
   * ECONOMY & SNOWBALL
   * --------------------------------------------------------------------------
   * Questa sezione racconta la parte più strategica del matchup:
   *
   * - quanto il vantaggio economico pesa sulla vittoria
   * - chi capitalizza meglio oro e XP
   * - quanto il minuto 15 predice la partita
   * - chi vince quando è avanti
   * - chi riesce a recuperare quando è indietro
   * - quanto il matchup è volatile
   * ========================================================================== */

  function ppValue(value, digits = 2) {
    return isNum(value) ? `${fmtDec(value, digits)} pp` : '—';
  }

  function aucTone(value) {
    if (!isNum(value)) return 'neutral';
    if (value < 0.55) return 'low';
    if (value < 0.65) return 'mid';
    if (value < 0.75) return 'high';
    return 'extreme';
  }

  function aucNarrative(value) {
    if (!isNum(value)) return 'potere predittivo non disponibile';
    if (value < 0.55) return 'vantaggio poco predittivo';
    if (value < 0.65) return 'vantaggio moderatamente predittivo';
    if (value < 0.75) return 'vantaggio molto indicativo';
    return 'partita fortemente legata al vantaggio economico';
  }

  function snowballCorrelationNarrative(value) {
    if (!isNum(value)) return 'correlazione non disponibile';

    const abs = Math.abs(value);

    if (abs < 0.15) return 'snowball debole';
    if (abs < 0.4) return 'snowball leggibile';
    return 'snowball molto marcato';
  }

  function volatilityNarrative(stdValue) {
    if (!isNum(stdValue)) return 'volatilità non disponibile';
    if (stdValue < 350) return 'matchup stabile';
    if (stdValue < 800) return 'matchup variabile';
    return 'matchup altamente volatile';
  }

  function economyInsightCard(title, value, sub, sideClass = 'neutral', tip = '') {
    const tipAttr = tip
      ? ` data-tip="${esc(tip)}" tabindex="0"`
      : '';

    return `
      <div class="economy-insight ${esc(sideClass)}"${tipAttr}>
        <span class="micro-label">${esc(title)}</span>
        <strong>${value}</strong>
        <p>${sub}</p>
      </div>
    `;
  }

  function dependencyCard(champA, champB, wpg, wpx) {
    const depTip =
      'Incremento di probabilità di vittoria, in punti percentuali, per ogni 1000 oro o 1000 esperienza di vantaggio accumulato entro il 15° minuto.';

    const goldLeader = metricLeader(wpg[0], wpg[1], champA, champB);
    const xpLeader = metricLeader(wpx[0], wpx[1], champA, champB);

    if (!isNum(wpg[0]) && !isNum(wpg[1]) && !isNum(wpx[0]) && !isNum(wpx[1])) {
      return `
        <div class="card economy-card">
          <div class="card-head">
            <div>
              <h3>Dipendenza dal vantaggio economico</h3>
              <span class="card-sub">Oro e XP entro il minuto 15.</span>
            </div>
          </div>

          <div class="empty-note">
            Dati non disponibili per almeno uno dei due campioni in questo ruolo.
          </div>
        </div>
      `;
    }

    return `
      <div class="card economy-card">
        <div class="card-head">
          <div>
            <h3>Dipendenza dal vantaggio economico</h3>
            <span class="card-sub">
              Quanto ogni +1000 oro o XP sposta la probabilità di vittoria.
            </span>
          </div>

          <span
            class="info-icon"
            tabindex="0"
            data-tip="${esc(depTip)}"
          >i</span>
        </div>

        <div class="economy-insight-strip">
          ${economyInsightCard(
            'Più sensibile all’oro',
            goldLeader && goldLeader.name ? esc(goldLeader.name) : 'Equilibrio',
            goldLeader && goldLeader.name
              ? `+${fmtDec(goldLeader.diff, 2)} pp per 1000 oro`
              : 'nessun vantaggio netto',
            goldLeader ? goldLeader.side : 'neutral'
          )}

          ${economyInsightCard(
            'Più sensibile all’XP',
            xpLeader && xpLeader.name ? esc(xpLeader.name) : 'Equilibrio',
            xpLeader && xpLeader.name
              ? `+${fmtDec(xpLeader.diff, 2)} pp per 1000 XP`
              : 'nessun vantaggio netto',
            xpLeader ? xpLeader.side : 'neutral'
          )}
        </div>

        ${compareBarRow(
          'Winrate per 1000 oro di vantaggio',
          'Punti percentuali di winrate associati a ogni +1000 oro entro il minuto 15.',
          wpg[0],
          wpg[1],
          champA,
          champB,
          2,
          ' pp'
        )}

        ${compareBarRow(
          'Winrate per 1000 XP di vantaggio',
          'Punti percentuali di winrate associati a ogni +1000 XP entro il minuto 15.',
          wpx[0],
          wpx[1],
          champA,
          champB,
          2,
          ' pp'
        )}
      </div>
    `;
  }

  function aucCard(champA, champB, auc, nMatches) {
    if (!isNum(auc[0]) && !isNum(auc[1])) {
      return '';
    }

    const leader = metricLeader(auc[0], auc[1], champA, champB);

    return `
      <div class="card economy-card auc-card">
        <div class="card-head">
          <div>
            <h3>Potere predittivo del vantaggio</h3>
            <span class="card-sub">
              AUC oro/XP verso vittoria finale.
            </span>
          </div>

          <span
            class="info-icon"
            tabindex="0"
            data-tip="Quanto il vantaggio economico al 15° minuto predice la vittoria finale. 0,50 significa nessun potere predittivo; valori vicini a 1 indicano che chi ha vantaggio economico tende quasi sempre a vincere."
          >i</span>
        </div>

        <div class="auc-showcase">
          ${[0, 1].map((index) => {
            const side = index === 0 ? 'a' : 'b';
            const championName = index === 0 ? champA : champB;
            const value = auc[index];
            const sample = nMatches[index];

            const width = isNum(value)
              ? clamp((value - 0.5) / 0.5 * 100, 0, 100)
              : 0;

            return `
              <div class="auc-row ${esc(side)} tone-${esc(aucTone(value))}">
                <div class="auc-row-head">
                  <strong>${esc(championName)}</strong>
                  <span>${fmtInt(sample)} partite</span>
                </div>

                <div class="auc-meter">
                  <span class="auc-baseline">0,50</span>
                  <div class="auc-fill" style="width:${width}%"></div>
                  <span class="auc-value">${fmtDec(value, 3)}</span>
                </div>

                <p>${esc(aucNarrative(value))}</p>
              </div>
            `;
          }).join('')}
        </div>

        <div class="economy-insight-strip single">
          ${economyInsightCard(
            'AUC più alto',
            leader && leader.name ? esc(leader.name) : 'Equilibrio',
            leader && leader.name
              ? `+${fmtDec(leader.diff, 3)} rispetto all’avversario`
              : 'potere predittivo molto simile',
            leader ? leader.side : 'neutral'
          )}
        </div>
      </div>
    `;
  }

  function capitalizationCard(champA, champB, depGold, depXp) {
    if (!isNum(depGold) && !isNum(depXp)) {
      return '';
    }

    const leaderGold = isNum(depGold)
      ? depGold > 0
        ? champA
        : depGold < 0
          ? champB
          : null
      : null;

    const leaderXp = isNum(depXp)
      ? depXp > 0
        ? champA
        : depXp < 0
          ? champB
          : null
      : null;

    return `
      <div class="card economy-card full-span capitalization-card">
        <div class="card-head">
          <div>
            <h3>Chi capitalizza meglio in questo matchup?</h3>
            <span class="card-sub">
              Differenziale specifico della dipendenza da oro e XP.
            </span>
          </div>
        </div>

        <div class="capitalization-grid">
          ${economyInsightCard(
            'Differenziale dipendenza oro',
            fmtSigned(depGold, 2, ' pp'),
            leaderGold
              ? `a favore di ${esc(leaderGold)}`
              : 'nessun lato chiaramente favorito',
            polarityClass(depGold)
          )}

          ${economyInsightCard(
            'Differenziale dipendenza XP',
            fmtSigned(depXp, 2, ' pp'),
            leaderXp
              ? `a favore di ${esc(leaderXp)}`
              : 'nessun lato chiaramente favorito',
            polarityClass(depXp)
          )}
        </div>
      </div>
    `;
  }

  function snowballMatrix(champA, champB, sb) {
    if (!sb) return '';

    const cells = [
      {
        side: 'a',
        champion: champA,
        state: 'se avanti al 15°',
        value: sb.leftAhead
      },
      {
        side: 'a',
        champion: champA,
        state: 'se indietro al 15°',
        value: sb.leftBehind
      },
      {
        side: 'b',
        champion: champB,
        state: 'se avanti al 15°',
        value: sb.rightAhead
      },
      {
        side: 'b',
        champion: champB,
        state: 'se indietro al 15°',
        value: sb.rightBehind
      }
    ];

    return `
      <div class="snowball-matrix">
        ${cells.map((cell) => {
          const width = isNum(cell.value)
            ? clamp(cell.value * 100, 0, 100)
            : 0;

          return `
            <div class="snowball-cell ${esc(cell.side)}">
              <span>${esc(cell.champion)}</span>
              <em>${esc(cell.state)}</em>
              <strong>${fmtPct(cell.value, 1)}</strong>
              <div class="snowball-cell-meter">
                <i style="width:${width}%"></i>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function snowballDonut(champA, champB, pctAhead) {
    if (!isNum(pctAhead)) return '';

    const pctBehind = 1 - pctAhead;
    const deg = clamp(pctAhead * 360, 0, 360);

    return `
      <div class="donut-wrap snowball-donut-wrap">
        <div
          class="donut"
          style="background:conic-gradient(var(--champ-a) 0deg ${deg}deg, var(--champ-b) ${deg}deg 360deg)"
          data-tip="<div class='tt-title'>Vantaggio al 15° minuto</div>${esc(champA)} avanti: ${fmtPct(pctAhead, 1)}<br>${esc(champB)} avanti: ${fmtPct(pctBehind, 1)}"
          tabindex="0"
        >
          <div class="donut-center">
            <div class="big">${fmtPct(pctAhead, 0)}</div>
            <div class="small">${esc(champA)} avanti al 15°</div>
          </div>
        </div>

        <div class="donut-legend">
          <div class="row">
            <i style="background:var(--champ-a)"></i>
            ${esc(champA)} in vantaggio: ${fmtPct(pctAhead, 1)}
          </div>

          <div class="row">
            <i style="background:var(--champ-b)"></i>
            ${esc(champB)} in vantaggio: ${fmtPct(pctBehind, 1)}
          </div>
        </div>
      </div>
    `;
  }

  function snowballCard(champA, champB, pctAhead, corr, std, sb) {
    return `
      <div class="card economy-card full-span snowball-card">
        <div class="card-head">
          <div>
            <h3>Snowball al 15° minuto</h3>
            <span class="card-sub">
              Quanto il vantaggio iniziale si trasforma in vittoria.
            </span>
          </div>

          <span
            class="info-icon"
            tabindex="0"
            data-tip="Metriche calcolate solo sui matchup con campione sufficiente: misurano quanto un vantaggio in oro al 15° minuto si traduce poi in vittoria."
          >i</span>
        </div>

        ${
          isNum(pctAhead) && sb
            ? `
              <div class="snowball-layout">
                ${snowballDonut(champA, champB, pctAhead)}

                <div class="snowball-story">
                  <div class="economy-insight-strip">
                    ${economyInsightCard(
                      'Correlazione oro-vittoria',
                      fmtDec(corr, 3),
                      snowballCorrelationNarrative(corr),
                      aucTone(Math.abs(corr) + 0.5),
                      'Correlazione statistica tra vantaggio in oro al minuto 15 ed esito finale.'
                    )}

                    ${economyInsightCard(
                      'Volatilità oro al 15°',
                      fmtInt(std),
                      volatilityNarrative(std),
                      'neutral',
                      'Deviazione standard del differenziale oro al minuto 15. Più è alta, più il matchup varia da partita a partita.'
                    )}
                  </div>

                  ${snowballMatrix(champA, champB, sb)}
                </div>
              </div>
            `
            : `
              <div class="empty-note">
                Le metriche di snowball al 15° minuto richiedono un campione più ampio di quello disponibile per questo matchup.
              </div>
            `
        }
      </div>
    `;
  }

  function economyHeadline(champA, champB, wpg, wpx, auc, pctAhead, sb) {
    const fragments = [];

    const goldLeader = metricLeader(wpg[0], wpg[1], champA, champB);
    const xpLeader = metricLeader(wpx[0], wpx[1], champA, champB);
    const aucLeader = metricLeader(auc[0], auc[1], champA, champB);

    if (goldLeader && goldLeader.name) {
      fragments.push(`<strong>${esc(goldLeader.name)}</strong> scala meglio con l’oro`);
    }

    if (xpLeader && xpLeader.name) {
      fragments.push(`<strong>${esc(xpLeader.name)}</strong> capitalizza meglio l’XP`);
    }

    if (aucLeader && aucLeader.name) {
      fragments.push(`<strong>${esc(aucLeader.name)}</strong> ha un vantaggio più predittivo`);
    }

    if (isNum(pctAhead)) {
      const leader = pctAhead >= 0.5 ? champA : champB;
      fragments.push(`<strong>${esc(leader)}</strong> è più spesso avanti al minuto 15`);
    }

    if (!fragments.length || !sb) {
      return 'Le metriche economiche disponibili non mostrano una direzione dominante netta.';
    }

    return fragments.join(' · ') + '.';
  }

  function renderEconomy(M) {
    const champA = state.champA;
    const champB = state.champB;

    const wpg = M.pair('goldxp_winpct_per_1k_gold');
    const wpx = M.pair('goldxp_winpct_per_1k_xp');

    const auc = M.pair('goldxp_auc');
    const nGX = M.pair('goldxp_n_matches');

    const depGold = M.diffAB('goldxp_gold_dependency_diff_a_minus_b');
    const depXp = M.diffAB('goldxp_xp_dependency_diff_a_minus_b');

    const pctAhead = M.pctA('pct_a_ahead_15m');
    const corr = M.direct('snowball_corr_15m');
    const std = M.direct('gold_diff_std_15m');
    const sb = M.snowballPerspective();

    const html = `
      <section class="economy-section">
        <div class="section-kicker">
          <span>Economy Engine</span>
          <i></i>
          <span>oro · XP · snowball</span>
        </div>

        <div class="section-head">
          <div>
            <h2>Chi trasforma il vantaggio in vittoria?</h2>
            <p>
              ${economyHeadline(champA, champB, wpg, wpx, auc, pctAhead, sb)}
            </p>
          </div>
        </div>

        <div class="panel-grid economy-grid">
          ${dependencyCard(champA, champB, wpg, wpx)}
          ${aucCard(champA, champB, auc, nGX)}
          ${capitalizationCard(champA, champB, depGold, depXp)}
          ${snowballCard(champA, champB, pctAhead, corr, std, sb)}
        </div>
      </section>
    `;

    setHTML('panel-economy', html);
  }

  /* ==========================================================================
   * OBJECTIVES + RAW DATA + EXPORT
   * --------------------------------------------------------------------------
   * Questa sezione copre:
   *
   * - obiettivi epici per Jungle
   * - corsa alla prima torre per Top / Mid / ADC
   * - fallback spiegato per Support
   * - tabella completa dei dati grezzi
   * - copia testo
   * - esportazione CSV
   *
   * Tutte le metriche originali sono mantenute.
   * ========================================================================== */

  function objectiveLeader(pctLeft, champA, champB) {
    if (!isNum(pctLeft)) {
      return {
        side: 'neutral',
        name: null,
        label: 'dato non disponibile'
      };
    }

    if (Math.abs(pctLeft - 0.5) < 0.000001) {
      return {
        side: 'neutral',
        name: null,
        label: 'equilibrio perfetto'
      };
    }

    return pctLeft > 0.5
      ? {
          side: 'a',
          name: champA,
          label: `${champA} più spesso per primo`
        }
      : {
          side: 'b',
          name: champB,
          label: `${champB} più spesso per primo`
        };
  }

  function objectiveDonutCard(title, sub, pctLeft, champA, champB, centerNote, extra = '') {
    const pctRight = isNum(pctLeft) ? 1 - pctLeft : null;
    const degrees = isNum(pctLeft) ? clamp(pctLeft * 360, 0, 360) : 0;
    const leader = objectiveLeader(pctLeft, champA, champB);

    if (!isNum(pctLeft)) {
      return `
        <div class="card objective-card empty-objective-card">
          <div class="card-head">
            <div>
              <h3>${esc(title)}</h3>
              ${sub ? `<span class="card-sub">${sub}</span>` : ''}
            </div>
          </div>

          <div class="empty-note">
            Dato non disponibile per questo matchup.
          </div>
        </div>
      `;
    }

    return `
      <div class="card objective-card tone-${esc(leader.side)}">
        <div class="card-head">
          <div>
            <h3>${esc(title)}</h3>
            ${sub ? `<span class="card-sub">${sub}</span>` : ''}
          </div>
        </div>

        <div class="objective-focus">
          <div
            class="donut objective-donut"
            style="background:conic-gradient(var(--champ-a) 0deg ${degrees}deg, var(--champ-b) ${degrees}deg 360deg)"
            data-tip="<div class='tt-title'>${esc(title)}</div>${esc(champA)}: ${fmtPct(pctLeft, 1)}<br>${esc(champB)}: ${fmtPct(pctRight, 1)}"
            tabindex="0"
          >
            <div class="donut-center">
              <div class="big">${fmtPct(pctLeft, 0)}</div>
              <div class="small">${centerNote}</div>
            </div>
          </div>

          <div class="objective-story">
            <span class="micro-label">Lettura</span>
            <strong>${leader.name ? esc(leader.name) : 'Equilibrio'}</strong>
            <p>${esc(leader.label)}</p>
          </div>
        </div>

        <div class="donut-legend">
          <div class="row">
            <i style="background:var(--champ-a)"></i>
            ${esc(champA)}: ${fmtPct(pctLeft, 1)}
          </div>

          <div class="row">
            <i style="background:var(--champ-b)"></i>
            ${esc(champB)}: ${fmtPct(pctRight, 1)}
          </div>
        </div>

        ${extra}
      </div>
    `;
  }

  function jungleObjectivesGrid(M, champA, champB) {
    const rows = OBJECTIVES.map((objective) => {
      const pct = M.pctA(`pct_champion_a_first_${objective.key}`);
      const n = M.direct(`n_matches_${objective.key}`);

      if (!isNum(pct)) return null;

      return {
        key: objective.key,
        label: objective.label,
        pct,
        n
      };
    }).filter(Boolean);

    if (!rows.length) {
      return `
        <div class="empty-note">
          Nessun dato sugli obiettivi disponibile per questo matchup specifico.
        </div>
      `;
    }

    const best = rows.slice().sort((a, b) => {
      return Math.abs(b.pct - 0.5) - Math.abs(a.pct - 0.5);
    })[0];

    const bestLeader = objectiveLeader(best.pct, champA, champB);

    return `
      <div class="objectives-summary full-span">
        <div class="economy-insight ${esc(bestLeader.side)}">
          <span class="micro-label">Obiettivo più sbilanciato</span>
          <strong>${esc(best.label)}</strong>
          <p>
            ${bestLeader.name ? esc(bestLeader.name) : 'Equilibrio'}
            · ${fmtPct(Math.max(best.pct, 1 - best.pct), 1)}
          </p>
        </div>
      </div>

      ${rows.map((row) => {
        return objectiveDonutCard(
          row.label,
          `${fmtInt(row.n)} occorrenze registrate`,
          row.pct,
          champA,
          champB,
          `${esc(champA)} per primo`
        );
      }).join('')}
    `;
  }

  function laneTowerObjectives(M, champA, champB) {
    const towerPct = M.pctA('pct_champion_a_wins_tower_race');
    const towerFallDiff = M.diffAB('avg_tower_fall_diff_min_a_minus_b');

    if (!isNum(towerPct)) {
      return `
        <div class="empty-note">
          Nessun dato sulla corsa alle torri disponibile per questo matchup specifico.
        </div>
      `;
    }

    const leader = objectiveLeader(towerPct, champA, champB);

    const towerDiffCard = `
      <div class="card objective-card tower-diff-card">
        <div class="card-head">
          <div>
            <h3>Scarto nella caduta della torre</h3>
            <span class="card-sub">
              Differenza media nel timing della prima torre di corsia.
            </span>
          </div>

          <span
            class="info-icon"
            tabindex="0"
            data-tip="Differenza, in minuti, associata al momento della caduta della prima torre di corsia tra i due campioni. Il segno riflette la convenzione del dataset di origine."
          >i</span>
        </div>

        ${
          isNum(towerFallDiff)
            ? `
              <div class="objective-diff-showcase ${esc(polarityClass(towerFallDiff))}">
                <span class="micro-label">${esc(champA)} meno ${esc(champB)}</span>
                <strong>${fmtSigned(towerFallDiff, 2, ' min')}</strong>
                <p>
                  ${
                    towerFallDiff > 0
                      ? `${esc(champA)} ha uno scarto positivo nella convenzione del dataset.`
                      : towerFallDiff < 0
                        ? `${esc(champB)} ha uno scarto positivo nella lettura invertita.`
                        : 'Timing medio della torre sostanzialmente in equilibrio.'
                  }
                </p>
              </div>
            `
            : `
              <div class="empty-note">
                Dato non disponibile.
              </div>
            `
        }
      </div>
    `;

    return `
      <div class="objectives-summary full-span">
        <div class="economy-insight ${esc(leader.side)}">
          <span class="micro-label">Pressione di corsia</span>
          <strong>${leader.name ? esc(leader.name) : 'Equilibrio'}</strong>
          <p>${esc(leader.label)}</p>
        </div>
      </div>

      ${objectiveDonutCard(
        'Corsa alla prima torre',
        'Percentuale di partite in cui la prima torre di corsia cade a favore del campione.',
        towerPct,
        champA,
        champB,
        `${esc(champA)} abbatte per primo`
      )}

      ${towerDiffCard}
    `;
  }

  function renderObjectives(M) {
    const role = state.role;
    const champA = state.champA;
    const champB = state.champB;

    let body = '';

    if (role === 'JUNGLE') {
      body = jungleObjectivesGrid(M, champA, champB);
    } else if (role === 'TOP' || role === 'MIDDLE' || role === 'BOTTOM') {
      body = laneTowerObjectives(M, champA, champB);
    } else {
      body = `
        <div class="empty-note full-span">
          Le metriche sugli obiettivi epici — draghi, araldo, barone e sciame —
          sono calcolate solo per il ruolo Jungle.
          Le metriche sulla corsa alle torri sono disponibili per Top, Mid e ADC.
          Per il ruolo Support il dataset non include metriche specifiche sugli obiettivi.
        </div>
      `;
    }

    const html = `
      <section class="objectives-section">
        <div class="section-kicker">
          <span>Map Objectives</span>
          <i></i>
          <span>${esc(ROLE_LABELS[role] || role)}</span>
        </div>

        <div class="section-head">
          <div>
            <h2>Chi prende controllo della mappa?</h2>
            <p>
              Questa sezione legge gli obiettivi disponibili per il ruolo:
              obiettivi epici per Jungle, pressione torre per le corsie.
            </p>
          </div>
        </div>

        <div class="panel-grid objectives-grid">
          ${body}
        </div>
      </section>
    `;

    setHTML('panel-objectives', html);
  }

  /* --------------------------------------------------------------------------
   * Raw fields
   * --------------------------------------------------------------------------
   * Tutte le metriche originali vengono mantenute.
   * group serve solo per rendere la tabella più leggibile.
   * -------------------------------------------------------------------------- */

  const RAW_FIELDS = [
    {
      group: 'Campione statistico',
      kind: 'direct',
      col: 'n_matches',
      label: 'Partite analizzate',
      fmt: fmtInt
    },
    {
      group: 'Campione statistico',
      kind: 'direct',
      col: 'low_sample',
      label: 'Campione ridotto',
      fmt(value) {
        if (value === true) return 'Sì';
        if (value === false) return 'No';
        return value ? 'Sì' : 'No';
      }
    },

    {
      group: 'Winrate',
      kind: 'pair',
      base: 'winrate',
      label: 'Winrate nel matchup',
      fmt(value) { return fmtPct(value, 2); }
    },
    {
      group: 'Winrate',
      kind: 'pair',
      base: 'general_winrate',
      label: 'Winrate generale nel ruolo',
      fmt(value) { return fmtPct(value, 2); }
    },
    {
      group: 'Winrate',
      kind: 'pair',
      base: 'diff_winrate',
      label: 'Scarto vs winrate generale',
      fmt(value) { return fmtSignedPct(value, 2); }
    },

    {
      group: 'Danno',
      kind: 'pair',
      base: 'pct_physical_dmg',
      label: 'Danno fisico (%)',
      fmt(value) { return fmtPct(value, 1); }
    },
    {
      group: 'Danno',
      kind: 'pair',
      base: 'pct_magic_dmg',
      label: 'Danno magico (%)',
      fmt(value) { return fmtPct(value, 1); }
    },
    {
      group: 'Danno',
      kind: 'pair',
      base: 'pct_true_dmg',
      label: 'Danno puro (%)',
      fmt(value) { return fmtPct(value, 1); }
    },
    {
      group: 'Danno',
      kind: 'pair',
      base: 'avg_damage_to_champs',
      label: 'Danno medio ai campioni',
      fmt: fmtInt
    },
    {
      group: 'Danno',
      kind: 'pair',
      base: 'avg_damage_taken',
      label: 'Danno medio subito',
      fmt: fmtInt
    },

    {
      group: 'Controllo e visione',
      kind: 'pair',
      base: 'avg_time_ccing_others',
      label: 'CC medio sui nemici (s)',
      fmt(value) { return fmtDec(value, 1); }
    },
    {
      group: 'Controllo e visione',
      kind: 'pair',
      base: 'avg_total_time_cc_dealt',
      label: 'CC totale generato (s)',
      fmt(value) { return fmtDec(value, 1); }
    },
    {
      group: 'Controllo e visione',
      kind: 'pair',
      base: 'vision_score',
      label: 'Vision score medio',
      fmt(value) { return fmtDec(value, 1); }
    },
    {
      group: 'Controllo e visione',
      kind: 'diff',
      col: 'vision_diff_a_minus_b',
      label: 'Differenza vision score',
      fmt(value) { return fmtSigned(value, 1); }
    },

    {
      group: 'Timing',
      kind: 'pair',
      base: 'avg_level6_minute',
      label: 'Minuto medio livello 6',
      fmt(value) { return fmtDec(value, 2); }
    },

    {
      group: 'Oro / XP',
      kind: 'pair',
      base: 'goldxp_n_matches',
      label: 'Partite con dati oro/XP',
      fmt: fmtInt
    },
    {
      group: 'Oro / XP',
      kind: 'pair',
      base: 'goldxp_winpct_per_1k_gold',
      label: 'Winrate per 1000 oro (pp)',
      fmt(value) { return fmtDec(value, 2); }
    },
    {
      group: 'Oro / XP',
      kind: 'pair',
      base: 'goldxp_winpct_per_1k_xp',
      label: 'Winrate per 1000 XP (pp)',
      fmt(value) { return fmtDec(value, 2); }
    },
    {
      group: 'Oro / XP',
      kind: 'pair',
      base: 'goldxp_auc',
      label: 'AUC oro/XP verso vittoria',
      fmt(value) { return fmtDec(value, 3); }
    },
    {
      group: 'Oro / XP',
      kind: 'diff',
      col: 'goldxp_gold_dependency_diff_a_minus_b',
      label: 'Differenziale dipendenza oro',
      fmt(value) { return fmtSigned(value, 2); }
    },
    {
      group: 'Oro / XP',
      kind: 'diff',
      col: 'goldxp_xp_dependency_diff_a_minus_b',
      label: 'Differenziale dipendenza XP',
      fmt(value) { return fmtSigned(value, 2); }
    },

    {
      group: 'Torri',
      kind: 'pairFromPctA',
      col: 'pct_champion_a_wins_tower_race',
      label: 'Vittoria corsa alla torre',
      fmt(value) { return fmtPct(value, 1); }
    },
    {
      group: 'Torri',
      kind: 'diff',
      col: 'avg_tower_fall_diff_min_a_minus_b',
      label: 'Scarto caduta torre (min)',
      fmt(value) { return fmtSigned(value, 2); }
    },

    {
      group: 'Snowball',
      kind: 'pairFromPctA',
      col: 'pct_a_ahead_15m',
      label: 'Partite in vantaggio al 15°',
      fmt(value) { return fmtPct(value, 1); }
    },
    {
      group: 'Snowball',
      kind: 'pairFromSnowballAhead',
      label: 'Winrate se in vantaggio al 15°',
      fmt(value) { return fmtPct(value, 1); }
    },
    {
      group: 'Snowball',
      kind: 'pairFromSnowballBehind',
      label: 'Winrate se in svantaggio al 15°',
      fmt(value) { return fmtPct(value, 1); }
    },
    {
      group: 'Snowball',
      kind: 'direct',
      col: 'snowball_corr_15m',
      label: 'Correlazione oro-vittoria al 15°',
      fmt(value) { return fmtDec(value, 3); }
    },
    {
      group: 'Snowball',
      kind: 'direct',
      col: 'gold_diff_std_15m',
      label: 'Deviazione standard oro al 15°',
      fmt: fmtInt
    }
  ];

  OBJECTIVES.forEach((objective) => {
    RAW_FIELDS.push({
      group: 'Obiettivi Jungle',
      kind: 'pairFromPctA',
      col: `pct_champion_a_first_${objective.key}`,
      label: `${objective.label} (%)`,
      fmt(value) { return fmtPct(value, 1); }
    });

    RAW_FIELDS.push({
      group: 'Obiettivi Jungle',
      kind: 'direct',
      col: `n_matches_${objective.key}`,
      label: `${objective.label} — partite osservate`,
      fmt: fmtInt
    });
  });

  function rawFieldValues(field, M) {
    let leftValue = null;
    let rightValue = null;

    if (field.kind === 'pair') {
      const pair = M.pair(field.base);
      leftValue = pair[0];
      rightValue = pair[1];
    } else if (field.kind === 'pairFromPctA') {
      const pct = M.pctA(field.col);
      leftValue = pct;
      rightValue = isNum(pct) ? 1 - pct : null;
    } else if (field.kind === 'pairFromSnowballAhead') {
      const snowball = M.snowballPerspective();
      leftValue = snowball ? snowball.leftAhead : null;
      rightValue = snowball ? snowball.rightAhead : null;
    } else if (field.kind === 'pairFromSnowballBehind') {
      const snowball = M.snowballPerspective();
      leftValue = snowball ? snowball.leftBehind : null;
      rightValue = snowball ? snowball.rightBehind : null;
    } else if (field.kind === 'diff') {
      leftValue = M.diffAB(field.col);
      rightValue = null;
    } else {
      leftValue = M.direct(field.col);
      rightValue = null;
    }

    return {
      group: field.group,
      label: field.label,
      a: field.fmt(leftValue),
      b: rightValue !== null && rightValue !== undefined ? field.fmt(rightValue) : '—',
      rawA: leftValue,
      rawB: rightValue
    };
  }

  function groupRawRows(rows) {
    const groups = [];

    rows.forEach((row) => {
      let group = groups.find((item) => item.name === row.group);

      if (!group) {
        group = {
          name: row.group,
          rows: []
        };

        groups.push(group);
      }

      group.rows.push(row);
    });

    return groups;
  }

  function rawTableHtml(rows, champA, champB) {
    const groups = groupRawRows(rows);

    return `
      <table class="raw-table">
        <thead>
          <tr>
            <th>Metrica</th>
            <th>${esc(champA)}</th>
            <th>${esc(champB)}</th>
          </tr>
        </thead>

        <tbody>
          ${groups.map((group) => `
            <tr class="raw-group-row">
              <td colspan="3">${esc(group.name)}</td>
            </tr>

            ${group.rows.map((row) => `
              <tr>
                <td class="metric">${esc(row.label)}</td>
                <td class="va">${esc(row.a)}</td>
                <td class="vb">${esc(row.b)}</td>
              </tr>
            `).join('')}
          `).join('')}
        </tbody>
      </table>
    `;
  }

  function rawRowsToText(rows, champA, champB) {
    return rows.map((row) => {
      return `${row.group} — ${row.label}: ${champA} = ${row.a} | ${champB} = ${row.b}`;
    }).join('\n');
  }

  function csvQuote(value) {
    return `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;
  }

  function rawRowsToCsv(rows, champA, champB) {
    return [
      [
        csvQuote('Gruppo'),
        csvQuote('Metrica'),
        csvQuote(champA),
        csvQuote(champB)
      ].join(','),

      ...rows.map((row) => [
        csvQuote(row.group),
        csvQuote(row.label),
        csvQuote(row.a),
        csvQuote(row.b)
      ].join(','))
    ].join('\n');
  }

  function downloadTextFile(filename, text, mimeType) {
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = filename;

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);
  }

  function flashButtonLabel(button, label, duration = 1600) {
    if (!button) return;

    const original = button.textContent;
    button.textContent = label;

    window.setTimeout(() => {
      button.textContent = original;
    }, duration);
  }

  function bindRawExportButtons(rows, champA, champB) {
    const copyButton = byId('rawCopyBtn');
    const csvButton = byId('rawCsvBtn');

    if (copyButton) {
      copyButton.addEventListener('click', () => {
        const text = rawRowsToText(rows, champA, champB);

        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text)
            .then(() => {
              flashButtonLabel(copyButton, 'Copiato');
            })
            .catch(() => {
              flashButtonLabel(copyButton, 'Errore copia');
            });

          return;
        }

        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';

        document.body.appendChild(textarea);
        textarea.select();

        try {
          document.execCommand('copy');
          flashButtonLabel(copyButton, 'Copiato');
        } catch (error) {
          flashButtonLabel(copyButton, 'Errore copia');
        }

        document.body.removeChild(textarea);
      });
    }

    if (csvButton) {
      csvButton.addEventListener('click', () => {
        const csv = rawRowsToCsv(rows, champA, champB);

        const filename = [
          'matchup',
          toFilenameSafe(state.role),
          toFilenameSafe(champA),
          'vs',
          toFilenameSafe(champB)
        ].filter(Boolean).join('_') + '.csv';

        downloadTextFile(filename, csv, 'text/csv;charset=utf-8;');
      });
    }
  }

  function renderRaw(M) {
    const champA = state.champA;
    const champB = state.champB;

    const rows = RAW_FIELDS.map((field) => rawFieldValues(field, M));

    const html = `
      <section class="raw-section">
        <div class="section-kicker">
          <span>Raw Dataset</span>
          <i></i>
          <span>audit completo</span>
        </div>

        <div class="section-head">
          <div>
            <h2>Dati grezzi del matchup</h2>
            <p>
              Tutte le metriche esposte dalla dashboard sono raccolte qui in forma tabellare,
              senza interpretazione grafica.
            </p>
          </div>
        </div>

        <div class="card full-span raw-card">
          <div class="raw-toolbar">
            <div>
              <strong>Tabella completa</strong>
              <span>${fmtInt(rows.length)} metriche · ${esc(champA)} vs ${esc(champB)}</span>
            </div>

            <div class="raw-actions">
              <button class="raw-btn" type="button" id="rawCopyBtn">
                Copia come testo
              </button>

              <button class="raw-btn" type="button" id="rawCsvBtn">
                Scarica CSV
              </button>
            </div>
          </div>

          <div class="raw-table-wrap">
            ${rawTableHtml(rows, champA, champB)}
          </div>

          <div class="empty-note raw-note">
            Le serie minuto per minuto — oro, XP e rispettive versioni “in eccesso” —
            sono visualizzate nella scheda Andamento Partita.
          </div>
        </div>
      </section>
    `;

    setHTML('panel-raw', html);
    bindRawExportButtons(rows, champA, champB);
  }

  /* ==========================================================================
   * NAVIGATION + GLOSSARY + BOOT
   * --------------------------------------------------------------------------
   * Ultima sezione del file:
   *
   * - navigazione tab
   * - glossario
   * - footer statistiche
   * - bootstrap dell'app
   * ========================================================================== */

  function bindTabs() {
    const tabBar = byId('tabBar');
    if (!tabBar) return;

    tabBar.addEventListener('click', (event) => {
      const button = event.target.closest('.tab-btn');
      if (!button) return;

      const tab = button.getAttribute('data-tab');
      if (!tab) return;

      $all('.tab-btn').forEach((btn) => {
        const isActive = btn === button;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });

      $all('.tab-panel').forEach((panel) => {
        const isActive = panel.id === `panel-${tab}`;

        panel.classList.toggle('active', isActive);
        panel.hidden = !isActive;
      });
    });
  }

  /* --------------------------------------------------------------------------
   * Glossario
   * -------------------------------------------------------------------------- */

  const GLOSSARY = Object.freeze([
    {
      category: 'Affidabilità',
      q: 'Cosa significa "campione ridotto"?',
      a: `Indica un matchup con meno di ${DATA.meta.min_matches_confident} partite osservate nel dataset. Le percentuali restano indicative ma sono soggette a più rumore statistico: poche partite in più o in meno possono spostare sensibilmente il winrate misurato.`
    },
    {
      category: 'Percentili',
      q: 'Cosa vuol dire "percentile di ruolo"?',
      a: 'La posizione di un valore rispetto a tutti gli altri campioni dello stesso ruolo nel dataset. Un 90° percentile in danno subito significa che il campione subisce più danno del 90% degli altri campioni di quel ruolo.'
    },
    {
      category: 'Winrate',
      q: 'Cosa indica lo "scarto vs winrate generale"?',
      a: 'La differenza tra il winrate di un campione in questo specifico matchup e il suo winrate medio complessivo nel ruolo. Un valore positivo indica che l’avversario scelto è comparativamente più favorevole del solito; uno negativo, più sfavorevole.'
    },
    {
      category: 'Economia',
      q: 'Cosa sono "oro in eccesso" e "XP in eccesso"?',
      a: 'Il vantaggio in oro o esperienza che va oltre quanto ci si aspetterebbe dalla sola forza individuale dei due campioni nel ruolo. Isolano l’effetto specifico dell’incontro tra questi due campioni, al netto del loro livello generale di potenza.'
    },
    {
      category: 'Economia',
      q: 'Cos’è l’AUC oro/XP verso vittoria?',
      a: 'Una misura di quanto il vantaggio economico al 15° minuto predice la vittoria finale. Vale 0,50 quando il vantaggio economico non ha alcun potere predittivo e si avvicina a 1 quando la partita è quasi sempre decisa da chi è in vantaggio economico.'
    },
    {
      category: 'Economia',
      q: 'Cosa significa "winrate per 1000 oro/XP"?',
      a: 'L’aumento di probabilità di vittoria, in punti percentuali, associato a ogni 1000 oro o 1000 esperienza di vantaggio accumulato entro il 15° minuto.'
    },
    {
      category: 'Snowball',
      q: 'Cos’è la correlazione oro-vittoria?',
      a: 'La correlazione statistica tra il vantaggio in oro al 15° minuto e l’esito finale della partita in questo matchup. Valori più alti indicano un matchup dove chi va in vantaggio economico presto tende a chiudere la partita in vantaggio.'
    },
    {
      category: 'Snowball',
      q: 'Cosa indica la "volatilità" del vantaggio in oro?',
      a: 'La deviazione standard del differenziale di oro al 15° minuto tra le partite di questo matchup. Valori alti indicano un matchup dagli sviluppi molto variabili da partita a partita; valori bassi, un andamento più prevedibile.'
    },
    {
      category: 'Torri',
      q: 'Come funziona la "corsa alla prima torre"?',
      a: 'Misura la percentuale di partite in cui la prima torre della corsia cade a favore dell’uno o dell’altro campione, un indicatore diretto della pressione di corsia esercitata.'
    },
    {
      category: 'Obiettivi',
      q: 'A cosa si riferiscono i "primi obiettivi" — drago, barone, araldo?',
      a: 'Alla percentuale di partite in cui il campione, giocando in Jungle, ottiene per primo un determinato obiettivo epico rispetto all’avversario diretto. Sono disponibili solo per il ruolo Jungle.'
    },
    {
      category: 'Visione',
      q: 'Cos’è il vision score?',
      a: 'Una metrica ufficiale del gioco che sintetizza il contributo di un giocatore al controllo della visione della mappa: piazzamento e rimozione di ward, uso del controllo visione e presenza informativa.'
    },
    {
      category: 'Combattimento',
      q: 'Cosa indicano i tempi di CC ("controllo")?',
      a: 'Il tempo medio, in secondi, in cui un campione tiene sotto controllo i nemici tramite stordimenti, rallentamenti, immobilizzazioni e simili effetti nel corso di una partita.'
    },
    {
      category: 'Combattimento',
      q: 'Che differenza c’è tra danno fisico, magico e puro?',
      a: 'Sono le tre tipologie di danno del gioco: il danno fisico è mitigato dall’armatura, quello magico dalla resistenza magica, mentre il danno puro ignora entrambe le resistenze. La composizione indica il profilo di danno del campione e aiuta a valutare contro quali resistenze conviene costruire l’equipaggiamento.'
    }
  ]);

  function glossaryCategories() {
    return Array.from(new Set(GLOSSARY.map((item) => item.category)));
  }

  function glossaryItemHtml(item, index) {
    return `
      <div
        class="gloss-item"
        data-i="${index}"
        data-category="${esc(item.category)}"
      >
        <button
          class="gloss-q"
          type="button"
          aria-expanded="false"
        >
          <span class="gloss-category">${esc(item.category)}</span>
          <strong>${esc(item.q)}</strong>
          <span class="chev">+</span>
        </button>

        <div class="gloss-a">
          <p>${esc(item.a)}</p>
        </div>
      </div>
    `;
  }

  function filterGlossary(query, category) {
    const normalizedQuery = String(query || '').toLowerCase().trim();

    return GLOSSARY
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => {
        const matchesCategory = !category || category === 'all' || item.category === category;

        const haystack = `${item.category} ${item.q} ${item.a}`.toLowerCase();
        const matchesQuery = !normalizedQuery || haystack.includes(normalizedQuery);

        return matchesCategory && matchesQuery;
      });
  }

  function renderGlossaryList(query = '', category = 'all') {
    const wrap = byId('glossaryList');
    if (!wrap) return;

    const results = filterGlossary(query, category);

    if (!results.length) {
      wrap.innerHTML = `
        <div class="empty-note">
          Nessuna voce trovata nel glossario.
        </div>
      `;
      return;
    }

    wrap.innerHTML = results
      .map(({ item, index }) => glossaryItemHtml(item, index))
      .join('');

    wrap.querySelectorAll('.gloss-item').forEach((itemEl) => {
      const button = itemEl.querySelector('.gloss-q');
      const body = itemEl.querySelector('.gloss-a');

      if (!button || !body) return;

      button.addEventListener('click', () => {
        const isOpen = itemEl.classList.toggle('open');

        button.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        body.style.maxHeight = isOpen ? `${body.scrollHeight}px` : '0px';

        const chevron = button.querySelector('.chev');
        if (chevron) {
          chevron.textContent = isOpen ? '−' : '+';
        }
      });
    });
  }

  function renderGlossaryControls() {
    const wrap = byId('glossaryList');
    if (!wrap || byId('glossaryControls')) return;

    const container = document.createElement('div');
    container.id = 'glossaryControls';
    container.className = 'glossary-controls';

    const categories = glossaryCategories();

    container.innerHTML = `
      <div class="glossary-search">
        <input
          id="glossarySearch"
          type="search"
          placeholder="Cerca nel glossario…"
          aria-label="Cerca nel glossario"
        />
      </div>

      <div class="glossary-filter" role="tablist" aria-label="Categorie glossario">
        <button class="gloss-filter active" type="button" data-category="all">
          Tutto
        </button>

        ${categories.map((category) => `
          <button
            class="gloss-filter"
            type="button"
            data-category="${esc(category)}"
          >
            ${esc(category)}
          </button>
        `).join('')}
      </div>
    `;

    wrap.parentNode.insertBefore(container, wrap);

    const search = byId('glossarySearch');
    let activeCategory = 'all';

    function update() {
      renderGlossaryList(search ? search.value : '', activeCategory);
    }

    if (search) {
      search.addEventListener('input', update);
    }

    container.querySelectorAll('.gloss-filter').forEach((button) => {
      button.addEventListener('click', () => {
        activeCategory = button.getAttribute('data-category') || 'all';

        container.querySelectorAll('.gloss-filter').forEach((btn) => {
          btn.classList.toggle('active', btn === button);
        });

        update();
      });
    });
  }

  function renderGlossary() {
    renderGlossaryControls();
    renderGlossaryList();
  }

  /* --------------------------------------------------------------------------
   * Footer
   * -------------------------------------------------------------------------- */

  function renderFooterStats() {
    const target = byId('footerStats');
    if (!target) return;

    const totalMatchups = DATA.meta.total_matchups;
    const totalLowSample = DATA.meta.total_low_sample;
    const minConfident = DATA.meta.min_matches_confident;

    target.textContent =
      `${fmtInt(totalMatchups)} matchup analizzati su 5 ruoli · ` +
      `${fmtInt(totalLowSample)} a campione ridotto (< ${minConfident} partite)`;
  }

  /* --------------------------------------------------------------------------
   * Bootstrap
   * -------------------------------------------------------------------------- */

  function validateRequiredDom() {
    const requiredIds = [
      'rolePills',
      'comboA',
      'comboB',
      'swapBtn',
      'chipsRow',
      'emptyState',
      'dossier',
      'verdictBand',
      'panel-overview',
      'panel-trajectory',
      'panel-combat',
      'panel-economy',
      'panel-objectives',
      'panel-raw',
      'tabBar',
      'glossaryList',
      'footerStats'
    ];

    const missing = requiredIds.filter((id) => !byId(id));

    if (missing.length) {
      console.warn(
        '[Matchup Intelligence] Elementi DOM mancanti:',
        missing.join(', ')
      );
    }
  }

  function activateInitialTab() {
    const activeButton = $('.tab-btn.active') || $('.tab-btn');
    if (!activeButton) return;

    const tab = activeButton.getAttribute('data-tab');

    $all('.tab-btn').forEach((button) => {
      const isActive = button === activeButton;

      button.classList.toggle('active', isActive);
      button.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    $all('.tab-panel').forEach((panel) => {
      const isActive = panel.id === `panel-${tab}`;

      panel.classList.toggle('active', isActive);
      panel.hidden = !isActive;
    });
  }

  function init() {
    validateRequiredDom();

    populateRolePills();
    bindTabs();
    activateInitialTab();

    renderGlossary();
    renderFooterStats();

    const startRole = bestGlobalRole();

    if (startRole) {
      setRole(startRole);
    } else {
      renderEmptyState(
        'Dataset non disponibile',
        'Non sono stati trovati ruoli utilizzabili nel dataset.'
      );
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
