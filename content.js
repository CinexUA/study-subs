// Runs in the ISOLATED world. Builds the subtitle panel under the video,
// gets captions (direct, or via the player's intercepted request), and syncs them.
(() => {
  'use strict';

  const DEFAULTS = { showEn: true, showUa: true, hideNative: true, targetLang: 'uk' };
  const LANGS = [
    ['uk', 'Українська'], ['en', 'English'], ['pl', 'Polski'],
    ['de', 'Deutsch'], ['es', 'Español'], ['fr', 'Français'],
    ['it', 'Italiano'], ['ru', 'Русский']
  ];

  let state = { ...DEFAULTS };
  let enSegs = [];
  let uaSegs = [];
  let srcLang = '';
  let currentVideoId = null;
  let awaitingCapture = false;
  let captureTimer = null;
  let capturedBase = null;   // a valid, tokened timedtext URL we can reuse
  let capturedBody = null;   // the intercepted response body (already a translation)
  let capturedTlang = '';
  let capturedForVideo = null;
  let video = null;
  let panel, elEn, elUa, elStatus, elLog, langSel;
  let rafId = null;
  let lastEn = null, lastUa = null;

  // ---------- debug log ----------
  function dbg(msg) {
    const time = new Date().toLocaleTimeString();
    console.log('[YTDS]', msg);
    if (!elLog) return;
    const line = document.createElement('div');
    line.textContent = `${time}  ${msg}`;
    elLog.appendChild(line);
    while (elLog.childElementCount > 60) elLog.firstChild.remove();
    elLog.scrollTop = elLog.scrollHeight;
  }

  // ---------- state ----------
  chrome.storage.local.get('ytds', (r) => {
    if (r.ytds) state = { ...state, ...r.ytds };
    applyNativeHide();
    ensurePanel();
    syncUi();
  });
  const saveState = () => chrome.storage.local.set({ ytds: state });

  // ---------- helpers ----------
  const setStatus = (msg) => { if (elStatus) elStatus.textContent = msg; };
  const setText = (el, txt) => { if (el) el.textContent = txt; };

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

  // Keep the valid token params, drop format/translation so we can re-add ours.
  function reuseBase(url) {
    try {
      const u = new URL(url, location.origin);
      u.searchParams.delete('fmt');
      u.searchParams.delete('tlang');
      return u.origin + u.pathname + '?' + u.searchParams.toString();
    } catch (_) { return url; }
  }

  async function fetchSegs(baseUrl, tlang) {
    const tl = tlang ? '&tlang=' + encodeURIComponent(tlang) : '';
    for (const fmt of ['&fmt=json3', '']) {
      const res = await fetch(baseUrl + fmt + tl);
      if (!res.ok) continue;
      const body = (await res.text()).trim();
      if (!body) continue;
      const segs = parseAny(body);
      if (segs.length) return segs;
    }
    return [];
  }

  function parseAny(body) {
    body = (body || '').trim();
    if (!body) return [];
    if (body[0] === '{') {
      try { return parseJson3(JSON.parse(body)); } catch (_) { return []; }
    }
    return parseXml(body);
  }

  function parseJson3(data) {
    const out = [];
    for (const ev of (data.events || [])) {
      if (!ev.segs) continue;
      const text = ev.segs.map((s) => s.utf8 || '').join('').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const start = (ev.tStartMs || 0) / 1000;
      out.push({ start, end: start + (ev.dDurationMs || 0) / 1000, text });
    }
    return out;
  }

  function parseXml(xml) {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const push = (nodes, tAttr, dAttr, scale) => nodes.map((n) => {
      const start = parseFloat(n.getAttribute(tAttr) || '0') / scale;
      const dur = parseFloat(n.getAttribute(dAttr) || '0') / scale;
      const text = (n.textContent || '').replace(/\s+/g, ' ').trim();
      return text ? { start, end: start + dur, text } : null;
    }).filter(Boolean);

    let nodes = [...doc.querySelectorAll('text')];       // srv1: seconds
    if (nodes.length) return push(nodes, 'start', 'dur', 1);
    nodes = [...doc.querySelectorAll('p')];              // srv3/ttml: ms
    return push(nodes, 't', 'd', 1000);
  }

  function findSeg(segs, t) {
    let lo = 0, hi = segs.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (segs[mid].start <= t) { ans = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    if (ans === -1) return null;
    const s = segs[ans];
    return t <= s.end + 0.3 ? s : null;
  }

  function updateStatus() {
    const uaNote = (state.targetLang !== srcLang && !uaSegs.length) ? ' · переклад недоступний' : '';
    const srcU = (srcLang || 'en').toUpperCase();
    setStatus(`джерело: ${srcLang || '?'} · ${srcU} ${enSegs.length} · ${state.targetLang.toUpperCase()} ${uaSegs.length}${uaNote}`);
    updateLabels();
  }

  // ---------- captions ----------
  const pickSrc = (tracks) =>
    tracks.find((t) => t.lang && t.lang.startsWith('en') && t.kind !== 'asr')
    || tracks.find((t) => t.lang && t.lang.startsWith('en'))
    || tracks[0];

  // Build EN + UA segments from one valid, tokened base URL.
  async function buildFromBase(base, body, capTlang) {
    let en = [];
    try { en = await fetchSegs(base, null); } catch (e) { dbg('EN fetch впав: ' + e.message); }
    if (!en.length && !capTlang && body) en = parseAny(body);
    if (!en.length) return false;

    enSegs = en;
    if (!srcLang) {
      try { srcLang = new URL(base, location.origin).searchParams.get('lang') || ''; } catch (_) {}
    }

    if (state.targetLang === srcLang) {
      uaSegs = enSegs;
    } else if (capTlang === state.targetLang && body) {
      uaSegs = parseAny(body); // captured body already is the target translation
      if (!uaSegs.length) { try { uaSegs = await fetchSegs(base, state.targetLang); } catch (_) {} }
    } else {
      try { uaSegs = await fetchSegs(base, state.targetLang); } catch (_) { uaSegs = []; }
    }

    dbg(`готово: EN ${enSegs.length} · ${state.targetLang.toUpperCase()} ${uaSegs.length}`);
    lastEn = lastUa = null;
    updateStatus();
    return true;
  }

  async function loadCaptions() {
    enSegs = []; uaSegs = []; srcLang = ''; lastEn = lastUa = null;
    awaitingCapture = false;
    clearTimeout(captureTimer);
    setText(elEn, ''); setText(elUa, '');
    setStatus('завантаження…');
    dbg('--- loadCaptions для ' + currentVideoId);

    // Fast path: reuse a previously captured valid URL (survives language switches).
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
      try { enSegs = await fetchSegs(src.baseUrl, null); } catch (e) { dbg('пряме завантаження впало: ' + e.message); }
      dbg(`пряме завантаження EN: ${enSegs.length} рядків`);
      if (enSegs.length) {
        await loadTranslation(src.baseUrl);
        dbg(`переклад ${state.targetLang}: ${uaSegs.length} рядків`);
        updateStatus();
        lastEn = lastUa = null;
        return;
      }
    }

    // Fallback: make the player fetch captions, then reuse its valid URL.
    awaitingCapture = true;
    setStatus('вмикаю субтитри плеєра…');
    dbg('пряме не дало результату → прошу плеєр увімкнути CC (YTDS_ENABLE)');
    window.postMessage({ type: 'YTDS_ENABLE' }, '*');
    captureTimer = setTimeout(() => {
      if (awaitingCapture && !enSegs.length) {
        awaitingCapture = false;
        dbg('таймаут 9с: перехоплення не сталось — імовірно у відео немає субтитрів');
        setStatus('не вдалося отримати субтитри — увімкни CC у плеєрі вручну');
      }
    }, 9000);
  }

  async function loadTranslation(base) {
    if (state.targetLang === srcLang) { uaSegs = enSegs; return; }
    try { uaSegs = await fetchSegs(base, state.targetLang); } catch (_) { uaSegs = []; }
  }

  // Player-intercepted timedtext response — its URL carries valid tokens (pot),
  // so we cache it and reuse it for the source, the translation, and later
  // language switches. Works any time the player loads captions.
  async function handleCaptured(url, body) {
    if (enSegs.length) return; // already have captions for this video
    const base = reuseBase(url); // keeps valid tokens, drops fmt & tlang
    const capTlang = (/[?&]tlang=([^&]*)/.exec(url) || [])[1] || '';

    // Cache for reuse (language switches, reloads) — no more interception needed.
    capturedBase = base;
    capturedBody = body;
    capturedTlang = capTlang;
    capturedForVideo = currentVideoId;

    if (!(await buildFromBase(base, body, capTlang))) {
      dbg('капчур без корисних EN — чекаю інший');
      return;
    }
    awaitingCapture = false;
    clearTimeout(captureTimer);
    window.postMessage({ type: 'YTDS_STOP_ENABLE' }, '*'); // stop the enable retries
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

  // ---------- render loop ----------
  function loop() {
    rafId = requestAnimationFrame(loop);
    if (!video || (!enSegs.length && !uaSegs.length)) return;
    const t = video.currentTime;
    const en = state.showEn ? findSeg(enSegs, t) : null;
    const ua = state.showUa ? findSeg(uaSegs, t) : null;
    const enText = en ? en.text : '';
    const uaText = ua ? ua.text : '';
    if (enText !== lastEn) { setText(elEn, enText); lastEn = enText; }
    if (uaText !== lastUa) { setText(elUa, uaText); lastUa = uaText; }
  }

  // ---------- UI ----------
  function ensurePanel() {
    if (panel && document.body.contains(panel)) return true;

    const anchor = document.querySelector('#below') || document.querySelector('#secondary');
    if (!anchor) return false;

    panel = document.createElement('div');
    panel.className = 'ytds-panel';

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

    langSel = document.createElement('select');
    langSel.className = 'ytds-select';
    for (const [code, label] of LANGS) {
      const o = document.createElement('option');
      o.value = code; o.textContent = label;
      if (code === state.targetLang) o.selected = true;
      langSel.appendChild(o);
    }
    langSel.addEventListener('change', () => {
      state.targetLang = langSel.value; saveState(); loadCaptions();
    });

    bar.append(btnEn, btnUa, btnHide, btnLog, langSel);

    elStatus = document.createElement('div');
    elStatus.className = 'ytds-status';
    elEn = document.createElement('div');
    elEn.className = 'ytds-line ytds-en';
    elUa = document.createElement('div');
    elUa.className = 'ytds-line ytds-ua';
    elLog = document.createElement('div');
    elLog.className = 'ytds-log';
    elLog.style.display = 'none';

    panel.append(bar, elEn, elUa, elStatus, elLog);
    anchor.prepend(panel);
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
      lastEn = lastUa = null;
    });
    return b;
  }

  function syncUi() {
    if (!panel) return;
    panel.querySelectorAll('.ytds-btn').forEach((b) => {
      if (b.dataset.key) b.classList.toggle('ytds-on', !!state[b.dataset.key]);
    });
    if (elEn) elEn.style.display = state.showEn ? '' : 'none';
    if (elUa) elUa.style.display = state.showUa ? '' : 'none';
    if (langSel) langSel.value = state.targetLang;
    updateLabels();
  }

  // Toggle buttons show the actual language codes (source vs. chosen target).
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

  // ---------- fullscreen: dock panel at the bottom, shrink the video ----------
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
    setTimeout(() => window.dispatchEvent(new Event('resize')), 60);
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
