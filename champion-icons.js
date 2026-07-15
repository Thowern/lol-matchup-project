(function (global) {
  'use strict';

  var CDN_ROOT = 'https://ddragon.leagueoflegends.com';
  var DEFAULT_VERSION = '16.13.1';
  var CACHE_KEY = 'draftlab-ddragon-champions-v2';
  var version = DEFAULT_VERSION;
  var filesByName = Object.create(null);
  var readyResolve;
  var ready = new Promise(function (resolve) { readyResolve = resolve; });

  var FALLBACK_IDS = {
    'belveth': 'Belveth',
    'chogath': 'Chogath',
    'drmundo': 'DrMundo',
    'jarvaniv': 'JarvanIV',
    'kaisa': 'Kaisa',
    'khazix': 'Khazix',
    'kogmaw': 'KogMaw',
    'ksante': 'KSante',
    'leblanc': 'Leblanc',
    'leesin': 'LeeSin',
    'masteryi': 'MasterYi',
    'missfortune': 'MissFortune',
    'nunuandwillump': 'Nunu',
    'reksai': 'RekSai',
    'renataglasc': 'Renata',
    'tahmkench': 'TahmKench',
    'twistedfate': 'TwistedFate',
    'velkoz': 'Velkoz',
    'wukong': 'MonkeyKing',
    'xinzhao': 'XinZhao',
    'aurelionsol': 'AurelionSol'
  };

  function normalize(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]/g, '');
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function safeClass(value) {
    return String(value || '').replace(/[^a-zA-Z0-9_-]/g, ' ').trim();
  }

  function guessedId(name) {
    var key = normalize(name);
    if (FALLBACK_IDS[key]) return FALLBACK_IDS[key];
    return String(name || '').replace(/[^a-zA-Z0-9]/g, '');
  }

  function fileFor(name) {
    var key = normalize(name);
    return filesByName[key] || (guessedId(name) ? guessedId(name) + '.png' : '');
  }

  function iconUrl(name) {
    var file = fileFor(name);
    if (!file) return '';
    return CDN_ROOT + '/cdn/' + encodeURIComponent(version) + '/img/champion/' + encodeURIComponent(file);
  }

  function html(name, options) {
    options = options || {};
    var size = /^(xs|sm|md|lg)$/.test(options.size) ? options.size : 'sm';
    var className = safeClass(options.className);
    var label = escapeHtml(name || '—');
    var source = iconUrl(name);
    return '<span class="champion-with-icon champion-with-icon-' + size + (className ? ' ' + className : '') + '">' +
      '<img class="champion-icon" src="' + escapeHtml(source) + '" data-champion-icon="' + escapeHtml(name || '') + '" alt="" aria-hidden="true" loading="lazy" decoding="async" draggable="false">' +
      '<span class="champion-name-text">' + label + '</span></span>';
  }

  function hydrate(root) {
    var scope = root && root.querySelectorAll ? root : document;
    var nodes = scope.querySelectorAll('img[data-champion-icon]');
    Array.prototype.forEach.call(nodes, function (img) {
      var name = img.getAttribute('data-champion-icon') || '';
      var next = iconUrl(name);
      if (!next) {
        img.classList.add('champion-icon-missing');
        return;
      }
      if (img.src !== next) img.src = next;
      img.classList.remove('champion-icon-missing');
      img.onerror = function () {
        img.classList.add('champion-icon-missing');
      };
      img.onload = function () {
        img.classList.remove('champion-icon-missing');
      };
    });
  }

  function installStyles() {
    if (document.getElementById('champion-icons-style')) return;
    var style = document.createElement('style');
    style.id = 'champion-icons-style';
    style.textContent = [
      '.champion-with-icon{display:inline-flex;align-items:center;gap:.48em;min-width:0;max-width:100%;vertical-align:middle;line-height:inherit}',
      '.champion-with-icon-xs{--champion-icon-size:18px}',
      '.champion-with-icon-sm{--champion-icon-size:22px}',
      '.champion-with-icon-md{--champion-icon-size:28px}',
      '.champion-with-icon-lg{--champion-icon-size:36px}',
      '.champion-icon{width:var(--champion-icon-size);height:var(--champion-icon-size);flex:0 0 var(--champion-icon-size);display:block;object-fit:cover;border-radius:6px;background:rgba(255,255,255,.055);box-shadow:inset 0 0 0 1px rgba(255,255,255,.12),0 2px 8px rgba(0,0,0,.22)}',
      '.champion-icon-missing{display:none}',
      '.champion-name-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.combo-option .champion-with-icon,.combobox-option .champion-with-icon,.counter-option .champion-with-icon{flex:1 1 auto}',
      '.champion-cell .champion-with-icon,.slot-name .champion-with-icon,.podium-copy .champion-with-icon{font:inherit;color:inherit}',
      '.lane-versus .champion-with-icon,.advanced-card-head .champion-with-icon,.advanced-lane-card>header .champion-with-icon{display:inline-flex;margin-top:0;color:inherit;font:inherit;letter-spacing:inherit;text-transform:none}',
      '.lane-versus .champion-name-text,.advanced-card-head .champion-name-text,.advanced-lane-card>header .champion-name-text{display:inline;margin-top:0;color:inherit;font:inherit;letter-spacing:inherit;text-transform:none}',
      '@media (max-width:560px){.champion-with-icon-md{--champion-icon-size:24px}.champion-with-icon-lg{--champion-icon-size:30px}}'
    ].join('');
    document.head.appendChild(style);
  }

  function readCache() {
    try {
      var cached = JSON.parse(global.localStorage.getItem(CACHE_KEY) || 'null');
      if (!cached || !cached.version || !cached.filesByName) return;
      version = cached.version;
      filesByName = cached.filesByName;
    } catch (error) {
      // Storage may be disabled (e.g. file:// or privacy mode): do not block.
    }
  }

  function writeCache() {
    try {
      global.localStorage.setItem(CACHE_KEY, JSON.stringify({ version: version, filesByName: filesByName }));
    } catch (error) {
      // The cache is only an optimization.
    }
  }

  function loadDataDragon() {
    return fetch(CDN_ROOT + '/api/versions.json', { cache: 'force-cache' })
      .then(function (response) {
        if (!response.ok) throw new Error('Data Dragon versions unavailable');
        return response.json();
      })
      .then(function (versions) {
        if (Array.isArray(versions) && versions[0]) version = versions[0];
        return fetch(CDN_ROOT + '/cdn/' + encodeURIComponent(version) + '/data/en_US/champion.json', { cache: 'force-cache' });
      })
      .then(function (response) {
        if (!response.ok) throw new Error('Data Dragon champion catalog unavailable');
        return response.json();
      })
      .then(function (payload) {
        var next = Object.create(null);
        Object.keys((payload && payload.data) || {}).forEach(function (key) {
          var champion = payload.data[key] || {};
          var file = champion.image && champion.image.full ? champion.image.full : key + '.png';
          next[normalize(champion.name || key)] = file;
          next[normalize(champion.id || key)] = file;
        });
        if (Object.keys(next).length) filesByName = next;
        writeCache();
      })
      .catch(function () {
        // Silent fallback: the bundled version + aliases also cover partial offline use.
      })
      .then(function () {
        hydrate(document);
        readyResolve();
      });
  }

  installStyles();
  readCache();

  global.ChampionIcons = {
    html: html,
    hydrate: hydrate,
    iconUrl: iconUrl,
    ready: ready
  };

  var observer = new MutationObserver(function (mutations) {
    mutations.forEach(function (mutation) {
      Array.prototype.forEach.call(mutation.addedNodes || [], function (node) {
        if (node.nodeType !== 1) return;
        if (node.matches && node.matches('img[data-champion-icon]')) hydrate(node.parentNode || node);
        else if (node.querySelector) hydrate(node);
      });
    });
  });

  if (document.documentElement) observer.observe(document.documentElement, { childList: true, subtree: true });
  loadDataDragon();
})(window);
