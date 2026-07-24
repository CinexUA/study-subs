// Runs in the ISOLATED world. Builds the subtitle panel under the video,
// gets captions (direct, or via the player's intercepted request), groups them
// into whole-sentence blocks and shows them as a rolling transcript.
(() => {
  'use strict';

  const DEFAULTS = { showEn: true, showUa: true, hideNative: true, targetLang: 'uk', theme: 'sepia' };
  const LANGS = [
    ['uk', 'Українська'], ['en', 'English'], ['pl', 'Polski'],
    ['de', 'Deutsch'], ['es', 'Español'], ['fr', 'Français'],
    ['it', 'Italiano'], ['ru', 'Русский']
  ];
  const THEMES = [['sepia', 'Книжкова'], ['dark', 'Темна'], ['light', 'Світла']];

  let state = { ...DEFAULTS };
  let blocks = [];           // [{ start, end, en, ua }]
  let curBlock = -1;
  let enRawLen = 0, uaRawLen = 0;
  let srcLang = '';
  let currentVideoId = null;
  let awaitingCapture = false;
  let captureTimer = null;
  let capturedBase = null, capturedBody = null, capturedTlang = '', capturedForVideo = null;
  let video = null;
  let panel, elRoll, elStatus, elLog, langSel;
  let rafId = null;

  // ---------- state ----------
  chrome.storage.local.get('ytds', (r) => {
    if (r.ytds) state = { ...state, ...r.ytds };
    applyNativeHide();
    ensurePanel();
    syncUi();
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
  const clearDisplay = () => { if (elRoll) elRoll.textContent = ''; };

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

  // ---------- caption fetching / parsing ----------
  function reuseBase(url) {
    try {
      const u = new URL(url, location.origin);
      u.searchParams.delete('fmt');
      u.searchParams.delete('tlang');
      return u.origin + u.pathname + '?' + u.searchParams.toString();
    } catch (_) { return url; }
  }

  // Returns raw time-chunks [{ start, end, text }] (no grouping).
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
    if (body[0] === '{') { try { return parseJson3(JSON.parse(body)); } catch (_) { return []; } }
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

    let nodes = [...doc.querySelectorAll('text')];
    if (nodes.length) return push(nodes, 'start', 'dur', 1);
    nodes = [...doc.querySelectorAll('p')];
    return push(nodes, 't', 'd', 1000);
  }

  // Re-group short chunks into whole-sentence blocks; never cut mid-sentence.
  function groupSegs(segs, minChars = 50, maxChars = 200, maxDur = 8) {
    const chars = [];
    for (const s of segs) {
      const t = (s.text || '').trim();
      if (!t) continue;
      if (chars.length && chars[chars.length - 1].ch !== ' ') chars.push({ ch: ' ', start: s.start, end: s.end });
      for (const ch of t) chars.push({ ch, start: s.start, end: s.end });
    }
    const out = [];
    let buf = '', start = null, end = null;
    const flush = () => { const text = buf.trim(); if (text) out.push({ start, end, text }); buf = ''; start = null; };
    for (let i = 0; i < chars.length; i++) {
      const c = chars[i];
      if (start === null) { if (c.ch === ' ') continue; start = c.start; }
      buf += c.ch; end = c.end;
      const next = chars[i + 1];
      const nextIsBreak = !next || next.ch === ' ';
      const endsSentence = /[.!?…]["'”’)\]]*$/.test(buf) && nextIsBreak;
      if (endsSentence && buf.trim().length >= minChars) flush();
      else if (buf.length >= maxChars || (end - start) >= maxDur) flush();
    }
    flush();
    return out;
  }

  // Pair each EN sentence block with the overlapping UA chunks (same timeline).
  function buildBlocks(enRaw, uaRaw, sameLang) {
    const enBlocks = groupSegs(enRaw);
    return enBlocks.map((b) => ({
      start: b.start,
      end: b.end,
      en: b.text,
      ua: sameLang ? b.text : joinOverlap(uaRaw, b.start, b.end)
    }));
  }

  function joinOverlap(raw, start, end) {
    const parts = [];
    for (const s of raw) {
      const mid = (s.start + s.end) / 2;
      if (mid >= start - 0.05 && mid < end + 0.05) {
        const t = (s.text || '').trim();
        if (t) parts.push(t);
      }
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  function findBlock(t) {
    let lo = 0, hi = blocks.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (blocks[mid].start <= t) { ans = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return ans;
  }

  function updateStatus() {
    const uaNote = (state.targetLang !== srcLang && !uaRawLen) ? ' · переклад недоступний' : '';
    const srcU = (srcLang || 'en').toUpperCase();
    setStatus(`джерело: ${srcLang || '?'} · ${srcU} ${enRawLen} · ${state.targetLang.toUpperCase()} ${uaRawLen} · блоків ${blocks.length}${uaNote}`);
    updateLabels();
  }

  // ---------- captions ----------
  const pickSrc = (tracks) =>
    tracks.find((t) => t.lang && t.lang.startsWith('en') && t.kind !== 'asr')
    || tracks.find((t) => t.lang && t.lang.startsWith('en'))
    || tracks[0];

  // Build EN + UA blocks from one valid base URL. Returns true on success.
  async function buildFromBase(base, body, capTlang) {
    let enRaw = [];
    try { enRaw = await fetchSegs(base, null); } catch (e) { dbg('EN fetch впав: ' + e.message); }
    if (!enRaw.length && !capTlang && body) enRaw = parseAny(body);
    if (!enRaw.length) return false;

    if (!srcLang) {
      try { srcLang = new URL(base, location.origin).searchParams.get('lang') || ''; } catch (_) {}
    }
    const sameLang = state.targetLang === srcLang;

    let uaRaw = [];
    if (sameLang) {
      uaRaw = enRaw;
    } else if (capTlang === state.targetLang && body) {
      uaRaw = parseAny(body);
      if (!uaRaw.length) { try { uaRaw = await fetchSegs(base, state.targetLang); } catch (_) {} }
    } else {
      try { uaRaw = await fetchSegs(base, state.targetLang); } catch (_) { uaRaw = []; }
    }

    blocks = buildBlocks(enRaw, uaRaw, sameLang);
    enRawLen = enRaw.length; uaRawLen = uaRaw.length; curBlock = -1;
    dbg(`готово: EN ${enRaw.length} · ${state.targetLang.toUpperCase()} ${uaRaw.length} · блоків ${blocks.length}`);
    updateStatus();
    return true;
  }

  async function loadCaptions() {
    blocks = []; srcLang = ''; curBlock = -1; enRawLen = uaRawLen = 0;
    awaitingCapture = false;
    clearTimeout(captureTimer);
    clearDisplay();
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
      if (await buildFromBase(src.baseUrl, null, '')) { dbg('пряме завантаження спрацювало'); return; }
      dbg('пряме завантаження дало 0 → потрібне перехоплення');
    }

    // Fallback: make the player fetch captions, then reuse its valid URL.
    awaitingCapture = true;
    setStatus('вмикаю субтитри плеєра…');
    dbg('→ прошу плеєр увімкнути CC (YTDS_ENABLE)');
    window.postMessage({ type: 'YTDS_ENABLE' }, '*');
    captureTimer = setTimeout(() => {
      if (awaitingCapture && !blocks.length) {
        awaitingCapture = false;
        dbg('таймаут 9с: перехоплення не сталось — імовірно у відео немає субтитрів');
        setStatus('не вдалося отримати субтитри — увімкни CC у плеєрі вручну');
      }
    }, 9000);
  }

  // Player-intercepted timedtext response — its URL carries valid tokens.
  async function handleCaptured(url, body) {
    if (blocks.length) return; // already have captions for this video
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

  // ---------- rolling render ----------
  function loop() {
    rafId = requestAnimationFrame(loop);
    if (!video || !blocks.length) return;
    const idx = findBlock(video.currentTime);
    if (idx !== curBlock) { curBlock = idx; renderRoll(); }
  }

  function renderRoll() {
    if (!elRoll) return;
    elRoll.textContent = '';
    if (curBlock < 0) return;
    const from = Math.max(0, curBlock - 2); // previous 2 (dimmed) + current
    for (let i = from; i <= curBlock; i++) {
      const b = blocks[i];
      const wrap = document.createElement('div');
      wrap.className = 'ytds-block' + (i === curBlock ? ' ytds-active' : '');
      if (state.showEn && b.en) {
        const e = document.createElement('div');
        e.className = 'ytds-line ytds-en';
        e.textContent = b.en;
        wrap.appendChild(e);
      }
      if (state.showUa && b.ua) {
        const u = document.createElement('div');
        u.className = 'ytds-line ytds-ua';
        u.textContent = b.ua;
        wrap.appendChild(u);
      }
      elRoll.appendChild(wrap);
    }
    elRoll.scrollTop = elRoll.scrollHeight;
  }
  const refresh = () => renderRoll();

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

    bar.append(btnEn, btnUa, btnHide, btnLog, themeSel, langSel);

    elRoll = document.createElement('div');
    elRoll.className = 'ytds-roll';
    elStatus = document.createElement('div');
    elStatus.className = 'ytds-status';
    elLog = document.createElement('div');
    elLog.className = 'ytds-log';
    elLog.style.display = 'none';

    panel.append(bar, elRoll, elStatus, elLog);
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
