// Runs in the ISOLATED world. Builds the subtitle panel under the video,
// gets captions (direct, or via the player's intercepted request), and reveals
// them word by word (like YouTube), one caption-sized line at a time.
(() => {
  'use strict';

  const DEFAULTS = { showEn: true, showUa: true, hideNative: true, targetLang: 'uk', theme: 'sepia', fontScale: 1, reader: false };
  const LANGS = [
    ['uk', 'Українська'], ['en', 'English'], ['pl', 'Polski'],
    ['de', 'Deutsch'], ['es', 'Español'], ['fr', 'Français'],
    ['it', 'Italiano'], ['ru', 'Русский']
  ];
  const THEMES = [['sepia', 'Книжкова'], ['dark', 'Темна'], ['light', 'Світла']];
  const LEAD = 0.12; // reveal a word this many seconds around its timestamp

  let state = { ...DEFAULTS };
  let enLines = [];          // [{ start, end, units:[{t,text}], full }]
  let uaLines = [];
  let enUnitLen = 0, uaUnitLen = 0;
  let srcLang = '';
  let lastSig = null;
  let currentVideoId = null;
  let awaitingCapture = false;
  let captureTimer = null;
  let capturedBase = null, capturedBody = null, capturedTlang = '', capturedForVideo = null;
  let video = null;
  let panel, elRoll, elStatus, elLog, langSel, elClose;
  let rafId = null;

  // ---------- state ----------
  chrome.storage.local.get('ytds', (r) => {
    if (r.ytds) state = { ...state, ...r.ytds };
    state.reader = false; // never start a page already in reader mode
    applyNativeHide();
    ensurePanel();
    syncUi();
    applyReader();
  });
  const saveState = () => chrome.storage.local.set({ ytds: state });

  // ---------- debug log ----------
  function dbg(msg) {
    console.log('[YTDS]', msg);
    if (!elLog) return;
    const line = document.createElement('div');
    line.textContent = `${new Date().toLocaleTimeString()}  ${msg}`;
    elLog.appendChild(line);
    while (elLog.childElementCount > 60) elLog.firstChild.remove();
    elLog.scrollTop = elLog.scrollHeight;
  }

  const setStatus = (msg) => { if (elStatus) elStatus.textContent = msg; };
  const clearDisplay = () => { if (elRoll) elRoll.textContent = ''; lastSig = null; };

  // ---------- MAIN-world bridge ----------
  function requestTracks() {
    return new Promise((resolve) => {
      let done = false, tries = 0;
      const onMsg = (e) => {
        if (e.source !== window || !e.data || e.data.type !== 'YTDS_TRACKS') return;
        window.removeEventListener('message', onMsg);
        done = true;
        resolve(e.data.tracks || []);
      };
      window.addEventListener('message', onMsg);
      (function ask() {
        if (done) return;
        window.postMessage({ type: 'YTDS_REQUEST_TRACKS' }, '*');
        if (++tries < 15) setTimeout(ask, 300);
        else { window.removeEventListener('message', onMsg); resolve([]); }
      })();
    });
  }

  // ---------- fetching / parsing (word-level units) ----------
  function reuseBase(url) {
    try {
      const u = new URL(url, location.origin);
      u.searchParams.delete('fmt');
      u.searchParams.delete('tlang');
      return u.origin + u.pathname + '?' + u.searchParams.toString();
    } catch (_) { return url; }
  }

  // Returns [{ t, text }] — one entry per word (json3) or per chunk (xml).
  async function fetchUnits(baseUrl, tlang) {
    const tl = tlang ? '&tlang=' + encodeURIComponent(tlang) : '';
    for (const fmt of ['&fmt=json3', '']) {
      const res = await fetch(baseUrl + fmt + tl);
      if (!res.ok) continue;
      const body = (await res.text()).trim();
      if (!body) continue;
      const units = parseUnits(body);
      if (units.length) return units;
    }
    return [];
  }

  function parseUnits(body) {
    body = (body || '').trim();
    if (!body) return [];
    if (body[0] === '{') { try { return parseJson3Units(JSON.parse(body)); } catch (_) { return []; } }
    return parseXmlUnits(body);
  }

  function parseJson3Units(data) {
    const units = [];
    for (const ev of (data.events || [])) {
      if (!ev.segs) continue;
      const base = ev.tStartMs || 0;
      for (const s of ev.segs) {
        const txt = s.utf8;
        if (txt == null || !txt.replace(/\s/g, '')) continue; // skip empty / newline
        units.push({ t: (base + (s.tOffsetMs || 0)) / 1000, text: txt });
      }
    }
    return units;
  }

  function parseXmlUnits(xml) {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const make = (nodes, tAttr, scale) => nodes.map((n, i) => {
      const t = parseFloat(n.getAttribute(tAttr) || '0') / scale;
      const text = (n.textContent || '').replace(/\s+/g, ' ').trim();
      return text ? { t, text: (i > 0 ? ' ' : '') + text } : null;
    }).filter(Boolean);
    let nodes = [...doc.querySelectorAll('text')];
    if (nodes.length) return make(nodes, 'start', 1);
    nodes = [...doc.querySelectorAll('p')];
    return make(nodes, 't', 1000);
  }

  // Join word units, restoring spaces (json3 often drops the space segments)
  // while keeping punctuation attached to the preceding word.
  function joinUnits(units) {
    let out = '';
    for (const u of units) {
      const txt = u.text;
      if (out && !/\s$/.test(out) && !/^[\s.,!?;:…)\]'"”’»]/.test(txt)) out += ' ';
      out += txt;
    }
    return out.replace(/\s+/g, ' ').trim();
  }

  // Group words into caption-sized lines; break on sentence end or width cap,
  // but keep the per-word timing so we can reveal them progressively.
  function groupUnitsToLines(units, minChars = 40, maxChars = 75, maxDur = 6) {
    const lines = [];
    let cur = null;
    const flush = () => {
      if (cur && cur.units.length) {
        cur.full = joinUnits(cur.units);
        cur.end = cur.units[cur.units.length - 1].t;
        lines.push(cur);
      }
      cur = null;
    };
    for (const u of units) {
      if (!cur) cur = { start: u.t, units: [] };
      cur.units.push(u);
      const buf = joinUnits(cur.units);
      const endsSentence = /[.!?…]["'”’)\]]*$/.test(buf);
      if ((endsSentence && buf.length >= minChars) || buf.length >= maxChars || (u.t - cur.start) >= maxDur) flush();
    }
    flush();
    return lines;
  }

  function pickLine(lines, t) {
    if (!lines.length) return { idx: -1, n: 0 };
    let lo = 0, hi = lines.length - 1, idx = -1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (lines[m].start <= t) { idx = m; lo = m + 1; }
      else hi = m - 1;
    }
    if (idx < 0) return { idx: -1, n: 0 };
    let n = 0;
    for (const u of lines[idx].units) { if (u.t <= t + LEAD) n++; else break; }
    return { idx, n: Math.max(1, n) };
  }

  function updateStatus() {
    const uaNote = (state.targetLang !== srcLang && !uaUnitLen) ? ' · переклад недоступний' : '';
    const srcU = (srcLang || 'en').toUpperCase();
    setStatus(`джерело: ${srcLang || '?'} · ${srcU} ${enUnitLen} сл · ${state.targetLang.toUpperCase()} ${uaUnitLen} сл · рядків ${enLines.length}${uaNote}`);
    updateLabels();
  }

  // ---------- captions ----------
  const pickSrc = (tracks) =>
    tracks.find((t) => t.lang && t.lang.startsWith('en') && t.kind !== 'asr')
    || tracks.find((t) => t.lang && t.lang.startsWith('en'))
    || tracks[0];

  // Build EN + UA lines from one valid base URL. Returns true on success.
  async function buildFromBase(base, body, capTlang) {
    let enUnits = [];
    try { enUnits = await fetchUnits(base, null); } catch (e) { dbg('EN fetch впав: ' + e.message); }
    if (!enUnits.length && !capTlang && body) enUnits = parseUnits(body);
    if (!enUnits.length) return false;

    if (!srcLang) {
      try { srcLang = new URL(base, location.origin).searchParams.get('lang') || ''; } catch (_) {}
    }
    const sameLang = state.targetLang === srcLang;

    let uaUnits = [];
    if (sameLang) {
      uaUnits = enUnits;
    } else if (capTlang === state.targetLang && body) {
      uaUnits = parseUnits(body);
      if (!uaUnits.length) { try { uaUnits = await fetchUnits(base, state.targetLang); } catch (_) {} }
    } else {
      try { uaUnits = await fetchUnits(base, state.targetLang); } catch (_) { uaUnits = []; }
    }

    enLines = groupUnitsToLines(enUnits);
    uaLines = sameLang ? enLines : groupUnitsToLines(uaUnits);
    enUnitLen = enUnits.length; uaUnitLen = uaUnits.length;
    lastSig = null;
    dbg(`готово: EN ${enUnits.length} сл / ${enLines.length} рядків · ${state.targetLang.toUpperCase()} ${uaUnits.length} сл`);
    updateStatus();
    return true;
  }

  async function loadCaptions() {
    enLines = []; uaLines = []; srcLang = ''; enUnitLen = uaUnitLen = 0;
    awaitingCapture = false;
    clearTimeout(captureTimer);
    clearDisplay();
    setStatus('завантаження…');
    dbg('--- loadCaptions для ' + currentVideoId);

    if (capturedBase && capturedForVideo === currentVideoId) {
      dbg('використовую збережене валідне посилання');
      if (await buildFromBase(capturedBase, capturedBody, capturedTlang)) return;
      dbg('збережене посилання не спрацювало (можливо, токен застарів)');
    }

    const tracks = await requestTracks();
    dbg(`доріжок з playerResponse: ${tracks.length}` +
        (tracks.length ? ' [' + tracks.map((t) => `${t.lang}${t.kind === 'asr' ? '/asr' : ''}`).join(', ') + ']' : ''));
    if (tracks.length) {
      const src = pickSrc(tracks);
      srcLang = src.lang || '';
      if (await buildFromBase(src.baseUrl, null, '')) { dbg('пряме завантаження спрацювало'); return; }
      dbg('пряме завантаження дало 0 → потрібне перехоплення');
    }

    awaitingCapture = true;
    setStatus('вмикаю субтитри плеєра…');
    dbg('→ прошу плеєр увімкнути CC (YTDS_ENABLE)');
    window.postMessage({ type: 'YTDS_ENABLE' }, '*');
    captureTimer = setTimeout(() => {
      if (awaitingCapture && !enLines.length) {
        awaitingCapture = false;
        dbg('таймаут 9с: перехоплення не сталось — імовірно у відео немає субтитрів');
        setStatus('не вдалося отримати субтитри — увімкни CC у плеєрі вручну');
      }
    }, 9000);
  }

  async function handleCaptured(url, body) {
    if (enLines.length) return;
    const base = reuseBase(url);
    const capTlang = (/[?&]tlang=([^&]*)/.exec(url) || [])[1] || '';

    capturedBase = base; capturedBody = body; capturedTlang = capTlang; capturedForVideo = currentVideoId;

    if (!(await buildFromBase(base, body, capTlang))) { dbg('капчур без корисних EN — чекаю інший'); return; }
    awaitingCapture = false;
    clearTimeout(captureTimer);
    window.postMessage({ type: 'YTDS_STOP_ENABLE' }, '*');
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data) return;
    if (e.data.type === 'YTDS_LOG') {
      dbg(e.data.msg);
    } else if (e.data.type === 'YTDS_TT') {
      const tl = /[?&]tlang=([^&]*)/.exec(e.data.url);
      dbg(`перехоплено timedtext (tlang=${tl ? tl[1] : '-'}, тіло=${(e.data.body || '').length} б)`);
      handleCaptured(e.data.url, e.data.body);
    }
  });

  // ---------- word-by-word render ----------
  function loop() {
    rafId = requestAnimationFrame(loop);
    if (!video || (!enLines.length && !uaLines.length)) return;
    const t = video.currentTime;
    const en = pickLine(enLines, t);
    const ua = pickLine(uaLines, t);
    const sig = `${en.idx}:${en.n}|${ua.idx}:${ua.n}|${state.showEn ? 1 : 0}${state.showUa ? 1 : 0}`;
    if (sig === lastSig) return;
    lastSig = sig;
    renderLive(en, ua);
  }

  function renderLive(en, ua) {
    if (!elRoll) return;
    elRoll.textContent = '';
    if (state.showEn) appendLang(enLines, en, 'ytds-en');
    if (state.showUa) appendLang(uaLines, ua, 'ytds-ua');
    measureDock();
  }

  // In fullscreen the video is shrunk by the panel's real height, so the dock
  // hugs its content (no empty space when a row is toggled off).
  function measureDock() {
    if (!panel || !document.documentElement.classList.contains('ytds-fs')) return;
    document.documentElement.style.setProperty('--dock-h', panel.offsetHeight + 'px');
  }

  function appendLang(lines, sel, cls) {
    if (sel.idx < 0) return;
    if (sel.idx > 0) addLine(lines[sel.idx - 1].full, cls, false); // previous line, dimmed
    const line = lines[sel.idx];
    const revealed = joinUnits(line.units.slice(0, sel.n));
    addLine(revealed, cls, true); // current line, building word by word
  }

  function addLine(text, cls, active) {
    const wrap = document.createElement('div');
    wrap.className = 'ytds-block' + (active ? ' ytds-active' : '');
    const l = document.createElement('div');
    l.className = 'ytds-line ' + cls;
    l.textContent = text;
    wrap.appendChild(l);
    elRoll.appendChild(wrap);
  }

  const refresh = () => { lastSig = null; };

  // ---------- UI ----------
  function ensurePanel() {
    if (panel && document.body.contains(panel)) return true;
    const anchor = document.querySelector('#below') || document.querySelector('#secondary');
    if (!anchor) return false;

    panel = document.createElement('div');
    panel.className = 'ytds-panel ytds-theme-' + state.theme;

    const bar = document.createElement('div');
    bar.className = 'ytds-bar';

    const btnEn = mkToggle('EN', 'showEn');
    const btnUa = mkToggle('UA', 'showUa');
    const btnHide = mkToggle('Сховати субтитри YouTube', 'hideNative', applyNativeHide);

    const btnLog = document.createElement('button');
    btnLog.className = 'ytds-btn';
    btnLog.textContent = 'Лог';
    btnLog.addEventListener('click', () => {
      elLog.style.display = elLog.style.display === 'none' ? '' : 'none';
      btnLog.classList.toggle('ytds-on', elLog.style.display !== 'none');
    });

    const mkBtn = (label, title, fn) => {
      const b = document.createElement('button');
      b.className = 'ytds-btn ytds-step';
      b.textContent = label; b.title = title;
      b.addEventListener('click', fn);
      return b;
    };
    const fontMinus = mkBtn('A−', 'Менший шрифт', () => changeFont(-0.1));
    const fontPlus = mkBtn('A+', 'Більший шрифт', () => changeFont(0.1));
    const btnReader = mkToggle('⤢ Читання', 'reader', applyReader);
    btnReader.title = 'Режим читання на весь екран (Esc — вийти)';

    const themeSel = document.createElement('select');
    themeSel.className = 'ytds-select';
    themeSel.title = 'Тема панелі';
    for (const [code, label] of THEMES) {
      const o = document.createElement('option');
      o.value = code; o.textContent = label;
      if (code === state.theme) o.selected = true;
      themeSel.appendChild(o);
    }
    themeSel.addEventListener('change', () => { state.theme = themeSel.value; saveState(); applyTheme(); });

    langSel = document.createElement('select');
    langSel.className = 'ytds-select';
    langSel.title = 'Мова перекладу';
    for (const [code, label] of LANGS) {
      const o = document.createElement('option');
      o.value = code; o.textContent = label;
      if (code === state.targetLang) o.selected = true;
      langSel.appendChild(o);
    }
    langSel.addEventListener('change', () => { state.targetLang = langSel.value; saveState(); loadCaptions(); });

    bar.append(btnEn, btnUa, btnHide, btnLog, fontMinus, fontPlus, btnReader, themeSel, langSel);

    elRoll = document.createElement('div');
    elRoll.className = 'ytds-roll';
    elStatus = document.createElement('div');
    elStatus.className = 'ytds-status';
    elLog = document.createElement('div');
    elLog.className = 'ytds-log';
    elLog.style.display = 'none';

    panel.append(bar, elRoll, elStatus, elLog);
    anchor.prepend(panel);

    // Floating exit button for reader mode, on <body> so it is always reachable.
    if (!elClose) {
      elClose = document.createElement('button');
      elClose.className = 'ytds-close';
      elClose.textContent = '✕';
      elClose.title = 'Вийти з режиму читання (Esc)';
      elClose.style.display = 'none';
      elClose.addEventListener('click', exitReader);
      document.body.appendChild(elClose);
    }

    syncUi();
    return true;
  }

  function mkToggle(label, key, extra) {
    const b = document.createElement('button');
    b.className = 'ytds-btn';
    b.textContent = label;
    b.dataset.key = key;
    b.addEventListener('click', () => {
      state[key] = !state[key];
      saveState();
      syncUi();
      if (extra) extra();
      refresh();
    });
    return b;
  }

  function syncUi() {
    if (!panel) return;
    panel.querySelectorAll('.ytds-btn').forEach((b) => {
      if (b.dataset.key) b.classList.toggle('ytds-on', !!state[b.dataset.key]);
    });
    if (langSel) langSel.value = state.targetLang;
    updateLabels();
    applyLayout();
    refresh();
  }

  function updateLabels() {
    if (!panel) return;
    const bSrc = panel.querySelector('[data-key="showEn"]');
    const bTr = panel.querySelector('[data-key="showUa"]');
    if (bSrc) bSrc.textContent = (srcLang || 'en').toUpperCase();
    if (bTr) bTr.textContent = state.targetLang.toUpperCase();
  }

  function applyNativeHide() {
    document.documentElement.classList.toggle('ytds-hide-native', !!state.hideNative);
  }

  function applyTheme() {
    if (panel) panel.className = 'ytds-panel ytds-theme-' + state.theme;
  }

  // Reader mode: the panel becomes a full-viewport overlay (own overlay, not the
  // browser fullscreen), subtitles centered and large. The video keeps playing
  // its audio behind it. Exit with the button or Esc.
  function applyReader() {
    const on = !!state.reader;
    document.documentElement.classList.toggle('ytds-reader', on);
    if (elClose) elClose.style.display = on ? 'flex' : 'none';
    if (!panel) return;
    if (on) {
      document.body.appendChild(panel);
    } else {
      const anchor = document.querySelector('#below') || document.querySelector('#secondary');
      if (anchor) anchor.prepend(panel);
    }
    refresh();
  }

  function exitReader() {
    if (!state.reader) return;
    state.reader = false; saveState(); applyReader(); syncUi();
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.reader) { e.stopPropagation(); exitReader(); }
  }, true);

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function applyLayout() {
    // Font scale drives text size; the window height follows the content.
    // Set on <html> so the fullscreen video-shrink rule can read it too.
    document.documentElement.style.setProperty('--font-scale', state.fontScale || 1);
  }

  function changeFont(delta) {
    state.fontScale = clamp(Math.round((state.fontScale + delta) * 100) / 100, 0.7, 2.2);
    saveState(); applyLayout(); refresh(); // re-render to remeasure the dock
  }

  // ---------- fullscreen ----------
  function onFullscreen() {
    const fs = document.fullscreenElement;
    const player = document.getElementById('movie_player');
    if (fs && player && panel) {
      document.documentElement.classList.add('ytds-fs');
      player.appendChild(panel);
    } else {
      document.documentElement.classList.remove('ytds-fs');
      const anchor = document.querySelector('#below') || document.querySelector('#secondary');
      if (anchor && panel) anchor.prepend(panel);
    }
    refresh();
    setTimeout(() => { window.dispatchEvent(new Event('resize')); measureDock(); }, 60);
  }
  document.addEventListener('fullscreenchange', onFullscreen);

  // ---------- lifecycle ----------
  function tick() {
    if (location.pathname !== '/watch') return;
    video = document.querySelector('video.html5-main-video') || document.querySelector('video');
    ensurePanel();
    const id = new URLSearchParams(location.search).get('v');
    if (id && id !== currentVideoId && panel) {
      currentVideoId = id;
      loadCaptions();
    }
  }

  document.addEventListener('yt-navigate-finish', tick);
  setInterval(tick, 1000);
  tick();
  if (!rafId) loop();
})();
