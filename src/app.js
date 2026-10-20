(function () {
  var D = window.IPTV_DATA;
  var srcEl = document.getElementById('sources');
  var listEl = document.getElementById('list');
  var emptyEl = document.getElementById('empty');
  var rowsEl = null;
  var player = document.getElementById('player');
  var video = document.getElementById('video');
  var pres = document.getElementById('pres');
  var pmsg = document.getElementById('pmsg');
  var toastEl = document.getElementById('toast');
  var hls = null;
  var ROWS = 6;
  var FAV_KEY = 'iptv-favs-v1';
  var REC_KEY = 'iptv-recents-v1';
  var UPD_KEY = 'iptv-urls-v1';
  var UPD_TTL = 24 * 3600 * 1000;
  var SRC_KEY = { 'BeeTV': 'bee', 'Россия': 'ru', 'Казахстан': 'kz', 'Узбекистан': 'uz' };
  var FEEDS = {
    ru: ['https://raw.githubusercontent.com/Romaxa55/world_ip_tv/master/output/ru.m3u',
         'https://iptv-org.github.io/iptv/countries/ru.m3u'],
    kz: ['https://raw.githubusercontent.com/Romaxa55/world_ip_tv/master/output/kz.m3u',
         'https://iptv-org.github.io/iptv/countries/kz.m3u'],
    uz: ['https://raw.githubusercontent.com/Romaxa55/world_ip_tv/master/output/uz.m3u',
         'https://iptv-org.github.io/iptv/countries/uz.m3u']
  };
  var state = { src: 0, idx: 0, start: 0, playing: false };
  var QUALITY_BRIGHT_MS = 120000;
  var qphase = 'idle';
  var qtimer = null;
  var toastTimer = null;
  var holdTimer = null;
  var holdFired = false;

  function loadList(key) {
    try {
      var a = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(a) ? a : [];
    } catch (e) { return []; }
  }

  function saveList(key, arr) {
    try { localStorage.setItem(key, JSON.stringify(arr)); } catch (e) {}
  }

  function normName(name) {
    var s = (name || '').toLowerCase();
    s = s.replace(/\((\d{3,4}[pi])\)/g, ' ');
    s = s.replace(/\b(hd|sd|fhd|uhd|4k|hevc)\b/g, ' ');
    s = s.replace(/[^a-zа-яё0-9]+/g, ' ');
    return s.replace(/\s+/g, ' ').trim();
  }

  function srcKeyFor(title) { return SRC_KEY[title] || normName(title); }
  function makeKey(title, name) { return srcKeyFor(title) + '|' + normName(name); }

  // map old url-based favorites/recents to stable keys
  var urlKey = {};
  D.sources.forEach(function (s) {
    s.groups.forEach(function (g) {
      g.ch.forEach(function (c) {
        if (c[1]) urlKey[c[1]] = makeKey(s.title, c[0]);
      });
    });
  });

  function migrate(list) {
    var out = [];
    list.forEach(function (entry) {
      if (typeof entry !== 'string' || !entry) return;
      if (entry.indexOf('|') !== -1) { out.push(entry); return; }
      if (urlKey[entry]) out.push(urlKey[entry]);
    });
    return out;
  }

  var favs = migrate(loadList(FAV_KEY));
  var recents = migrate(loadList(REC_KEY));
  saveList(FAV_KEY, favs);
  saveList(REC_KEY, recents);

  function loadCache() {
    try { return JSON.parse(localStorage.getItem(UPD_KEY) || 'null'); } catch (e) { return null; }
  }

  function parseM3U(text) {
    var map = {};
    var curName = null;
    var lines = String(text || '').split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      if (line.toUpperCase().indexOf('#EXTINF') === 0) {
        var comma = line.indexOf(',');
        curName = normName(comma >= 0 ? line.substring(comma + 1) : '');
      } else if (line.charAt(0) === '#') {
        continue;
      } else if (curName) {
        if (!map[curName]) map[curName] = line;
        curName = null;
      }
    }
    return map;
  }

  function applyOverrides(cache) {
    if (!cache || !cache.urls) return 0;
    var changed = 0;
    D.sources.forEach(function (s) {
      var ov = cache.urls[srcKeyFor(s.title)];
      if (!ov) return;
      s.groups.forEach(function (g) {
        g.ch.forEach(function (c) {
          var n = normName(c[0]);
          if (n && ov[n] && ov[n] !== c[1]) { c[1] = ov[n]; changed++; }
        });
      });
    });
    return changed;
  }

  var cached = loadCache();
  var appliedOnStart = applyOverrides(cached);

  function flat(source, title) {
    var out = [];
    source.groups.forEach(function (g) {
      g.ch.forEach(function (c) {
        out.push({ key: makeKey(title, c[0]), name: c[0], url: c[1], logo: c[2], group: g.title });
      });
    });
    return out;
  }

  var sourceLists = D.sources.map(function (s) { return flat(s, s.title); });
  var allChannels = [];
  sourceLists.forEach(function (l) { allChannels = allChannels.concat(l); });

  function rebuildAllChannels() {
    sourceLists = D.sources.map(function (s) { return flat(s, s.title); });
    allChannels = [];
    sourceLists.forEach(function (l) { allChannels = allChannels.concat(l); });
  }

  function byKeys(keys) {
    var out = [];
    var index = {};
    allChannels.forEach(function (c) { if (!index[c.key]) index[c.key] = c; });
    keys.forEach(function (k) {
      if (index[k]) out.push(index[k]);
    });
    return out;
  }

  function favoritesList() { return byKeys(favs); }
  function recentsList() { return byKeys(recents); }

  function addRecent(ch) {
    var i = recents.indexOf(ch.key);
    if (i !== -1) recents.splice(i, 1);
    recents.unshift(ch.key);
    if (recents.length > 5) recents = recents.slice(0, 5);
    saveList(REC_KEY, recents);
  }

  var sources = [];
  var lists = [];

  function rebuild() {
    sources = [
      { title: '★ Избранное', list: favoritesList() },
      { title: 'Последние', list: recentsList() }
    ].concat(
      D.sources.map(function (s, i) { return { title: s.title, list: sourceLists[i] }; })
    );
    lists = sources.map(function (s) { return s.list; });
    if (state.src >= sources.length) state.src = 0;
    if (state.idx >= lists[state.src].length) state.idx = Math.max(0, lists[state.src].length - 1);
    if (state.start > state.idx) state.start = state.idx;
  }

  function toast(text) {
    toastEl.textContent = text;
    toastEl.className = 'on';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.className = ''; }, 1600);
  }

  function renderSources() {
    srcEl.innerHTML = '';
    sources.forEach(function (s, i) {
      var d = document.createElement('div');
      d.className = 'src' + (i === state.src ? ' active' : '');
      d.innerHTML = '<span></span><span class="cnt"></span>';
      d.children[0].textContent = s.title;
      d.children[1].textContent = lists[i].length;
      srcEl.appendChild(d);
    });
  }

  function ensureRows() {
    if (rowsEl) return;
    rowsEl = [];
    for (var i = 0; i < ROWS; i++) {
      var r = document.createElement('div');
      r.className = 'row';
      r.innerHTML = '<span class="num"></span><img class="logo" alt="">' +
        '<span class="nm"></span><span class="fav"></span>';
      listEl.appendChild(r);
      rowsEl.push(r);
    }
  }

  var logoCache = {};

  function setLogo(img, logo) {
    if (!logo) {
      img.style.display = 'none';
      img.removeAttribute('src');
      img.setAttribute('data-url', '');
      return;
    }
    if (img.getAttribute('data-url') === logo) {
      img.style.display = logoCache[logo] === 'fail' ? 'none' : '';
      return;
    }
    img.setAttribute('data-url', logo);
    if (logoCache[logo] === 'fail') { img.style.display = 'none'; return; }
    img.style.display = 'none';
    img.onload = function () { logoCache[logo] = 'ok'; img.style.display = ''; };
    img.onerror = function () { logoCache[logo] = 'fail'; img.style.display = 'none'; };
    img.src = logo;
  }

  function isFav(key) { return favs.indexOf(key) !== -1; }

  function renderList() {
    rebuild();
    ensureRows();
    var list = lists[state.src];
    if (state.idx < state.start) state.start = state.idx;
    if (state.idx >= state.start + ROWS) state.start = state.idx - ROWS + 1;
    if (state.start < 0) state.start = 0;
    if (list.length) {
      emptyEl.style.display = 'none';
    } else {
      emptyEl.style.display = 'block';
      if (state.src === 0) {
        emptyEl.innerHTML = 'Нет избранных.<br>Удерживайте OK на канале, чтобы добавить его сюда.';
      } else if (state.src === 1) {
        emptyEl.innerHTML = 'Нет недавних каналов.<br>Запустите любой канал — он появится здесь.';
      } else {
        emptyEl.innerHTML = 'Нет каналов.';
      }
    }
    for (var i = 0; i < ROWS; i++) {
      var r = rowsEl[i];
      var ch = list[state.start + i];
      if (!ch) { r.style.visibility = 'hidden'; continue; }
      r.style.visibility = 'visible';
      r.className = 'row' + (state.start + i === state.idx ? ' sel' : '');
      r.children[0].textContent = (state.start + i + 1);
      setLogo(r.children[1], ch.logo);
      r.children[2].textContent = ch.name;
      r.children[3].textContent = isFav(ch.key) ? '★' : '';
    }
    updateScrollbar(list.length);
    renderSources();
  }

  function updateScrollbar(total) {
    var bar = document.getElementById('scrollbar');
    var thumb = document.getElementById('scrollthumb');
    if (!bar || !thumb) return;
    if (total <= ROWS) {
      bar.style.display = 'none';
      return;
    }
    bar.style.display = 'block';
    var thumbPct = Math.max(8, (ROWS / total) * 100);
    thumb.style.height = thumbPct.toFixed(2) + '%';
    var maxStart = total - ROWS;
    var pos = maxStart > 0 ? state.start / maxStart : 0;
    thumb.style.top = (pos * (100 - thumbPct)).toFixed(2) + '%';
  }

  function switchSrc(d) {
    state.src = (state.src + d + lists.length) % lists.length;
    state.idx = 0; state.start = 0;
    renderList();
  }

  function move(d) {
    var n = lists[state.src].length;
    if (!n) return;
    state.idx = Math.max(0, Math.min(n - 1, state.idx + d));
    renderList();
  }

  function toggleFav() {
    var list = lists[state.src];
    var ch = list[state.idx];
    if (!ch) return;
    var i = favs.indexOf(ch.key);
    if (i === -1) {
      favs.push(ch.key);
      saveList(FAV_KEY, favs);
      toast('★ Добавлено в избранное: ' + ch.name);
      renderList();
    } else {
      favs.splice(i, 1);
      saveList(FAV_KEY, favs);
      toast('Удалено из избранного: ' + ch.name);
      renderList();
    }
  }

  function stop() {
    state.playing = false;
    player.className = '';
    qphase = 'idle';
    if (qtimer) { clearTimeout(qtimer); qtimer = null; }
    try { video.pause(); } catch (e) {}
    video.removeAttribute('src');
    try { video.load(); } catch (e) {}
    if (hls) { try { hls.destroy(); } catch (e) {} hls = null; }
    if (pres) { pres.textContent = ''; pres.className = ''; }
  }

  function fail(text) {
    pmsg.className = 'err';
    pmsg.style.display = 'flex';
    pmsg.textContent = text;
  }

  function setPres(text, mode) {
    if (!pres) return;
    pres.textContent = text || '';
    pres.className = mode === 'final' ? 'dim' : (mode ? 'bright' : '');
  }

  function qualityFinal() {
    qtimer = null;
    if (!state.playing) return;
    if (video.videoWidth) {
      qphase = 'final';
      updateRes();
    } else {
      qtimer = setTimeout(qualityFinal, 5000);
    }
  }

  function startQuality() {
    qphase = 'loading';
    if (qtimer) { clearTimeout(qtimer); qtimer = null; }
    setPres('Загружается поток…', 'bright');
    qtimer = setTimeout(qualityFinal, QUALITY_BRIGHT_MS);
  }

  function play() {
    var ch = lists[state.src][state.idx];
    if (!ch) return;
    addRecent(ch);
    state.playing = true;
    player.className = 'on';
    startQuality();
    pmsg.className = '';
    pmsg.style.display = 'flex';
    pmsg.innerHTML = '<div id="spin"></div>';
    video.src = ch.url;
    video.load();
    var p = video.play();
    if (p && p.catch) { p.catch(function () {}); }
    video.onplaying = function () { pmsg.style.display = 'none'; updateRes(); };
    video.onloadedmetadata = function () { updateRes(); };
    video.onerror = function () {
      if (!state.playing) return;
      var c = video.error ? video.error.code : '?';
      fail('Не удалось воспроизвести поток (код ' + c + ').\nBack — вернуться к списку.');
    };
    if (video.canPlayType && video.canPlayType('application/vnd.apple.mpegurl') === '' &&
        window.Hls && window.Hls.isSupported()) {
      if (hls) { try { hls.destroy(); } catch (e) {} }
      hls = new window.Hls({ enableWorker: false });
      hls.loadSource(ch.url);
      hls.attachMedia(video);
      hls.on(window.Hls.Events.ERROR, function (e, data) {
        if (data && data.fatal) fail('Поток недоступен (' + (data.details || data.type) + ').\nBack — вернуться.');
      });
    }
  }

  function updateRes() {
    if (!state.playing) { if (pres) { pres.textContent = ''; pres.className = ''; } return; }
    var w = video.videoWidth || 0, h = video.videoHeight || 0;
    if (qphase === 'final') {
      setPres(w ? ('Качество: ' + w + '×' + h) : 'Загружается поток…', 'final');
      return;
    }
    if (qphase === 'loading') {
      if (!w) { setPres('Загружается поток…', 'bright'); return; }
      qphase = 'determining';
    }
    setPres('Определяется качество…' + (w ? ' (' + w + '×' + h + ')' : ''), 'bright');
  }

  function playNext(d) {
    var n = lists[state.src].length;
    if (!n) return;
    state.idx = (state.idx + d + n) % n;
    play();
  }

  function onKeyDown(e) {
    var k = e.keyCode;
    if (state.playing) {
      if (k === 461 || k === 27) { e.preventDefault(); stop(); renderList(); }
      else if (k === 402 || k === 33) { e.preventDefault(); playNext(1); }
      else if (k === 403 || k === 34) { e.preventDefault(); playNext(-1); }
      return;
    }
    if (k === 38) { e.preventDefault(); move(-1); }
    else if (k === 40) { e.preventDefault(); move(1); }
    else if (k === 37) { e.preventDefault(); switchSrc(-1); }
    else if (k === 39) { e.preventDefault(); switchSrc(1); }
    else if (k === 13) {
      e.preventDefault();
      if (e.repeat) return;
      holdFired = false;
      holdTimer = setTimeout(function () {
        holdTimer = null;
        holdFired = true;
        toggleFav();
      }, 650);
    }
    else if (k === 402) { e.preventDefault(); move(-ROWS); }
    else if (k === 403) { e.preventDefault(); move(ROWS); }
    else if (k === 33) { e.preventDefault(); move(-ROWS); }
    else if (k === 34) { e.preventDefault(); move(ROWS); }
  }

  function onKeyUp(e) {
    if (e.keyCode !== 13) return;
    if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = null;
      if (!holdFired) play();
    }
    holdFired = false;
  }

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);

  var wheelLastMove = 0;
  document.addEventListener('wheel', function (e) {
    if (state.playing) return;
    e.preventDefault();
    if (Math.abs(e.deltaY) < 15) return;
    var now = Date.now();
    if (now - wheelLastMove < 90) return;
    wheelLastMove = now;
    move(e.deltaY > 0 ? 1 : -1);
  }, { passive: false });

  setInterval(updateRes, 1000);

  // ---- background refresh of stream URLs (cached for a day) ----
  function fetchText(url, ms) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        reject(new Error('timeout'));
      }, ms);
      fetch(url, { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('http ' + r.status);
        return r.text();
      }).then(function (text) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(text);
      }).catch(function (err) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  function fetchFirst(key) {
    var urls = FEEDS[key];
    function attempt(i) {
      if (i >= urls.length) return Promise.resolve(null);
      return fetchText(urls[i], 4000).then(function (text) {
        var map = parseM3U(text);
        return Object.keys(map).length ? map : attempt(i + 1);
      }).catch(function () { return attempt(i + 1); });
    }
    return attempt(0);
  }

  function refresh() {
    var keys = Object.keys(FEEDS);
    Promise.all(keys.map(function (key) {
      return fetchFirst(key).then(function (map) { return { key: key, map: map }; });
    })).then(function (res) {
      var urls = {};
      var okCount = 0;
      res.forEach(function (r) {
        if (r.map) { urls[r.key] = r.map; okCount++; }
      });
      if (!okCount) {
        window.__iptvUpdate = { status: 'fail', ts: Date.now() };
        return;
      }
      var newCache = { ts: Date.now(), urls: urls };
      try { localStorage.setItem(UPD_KEY, JSON.stringify(newCache)); } catch (e) {}
      var changed = applyOverrides(newCache);
      rebuildAllChannels();
      rebuild();
      renderList();
      window.__iptvUpdate = { status: 'ok', ts: newCache.ts, feeds: okCount, changed: changed };
    }).catch(function (err) {
      window.__iptvUpdate = { status: 'error', error: String(err) };
    });
  }

  if (cached && cached.ts && (Date.now() - cached.ts) < UPD_TTL) {
    window.__iptvUpdate = { status: 'cached', ts: cached.ts, changed: appliedOnStart };
  } else {
    window.__iptvUpdate = { status: 'pending' };
    setTimeout(refresh, 1200);
  }

  rebuild();
  renderList();
})();
