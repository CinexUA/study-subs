// Runs in the ISOLATED world.
// It stays out of YouTube's UI: it only adds one button to the player controls.
// Clicking it opens a full-screen study overlay with dual subtitles that reveal
// word by word, plus its own playback controls.
(() => {
  'use strict';

  const DEFAULTS = { showEn: true, showUa: true, targetLang: 'uk', theme: 'sepia', fontScale: 1, reader: false, speed: 1, study: false };
  const LANGS = [
    ['uk', 'Українська'], ['en', 'English'], ['pl', 'Polski'],
    ['de', 'Deutsch'], ['es', 'Español'], ['fr', 'Français'],
    ['it', 'Italiano'], ['ru', 'Русский']
  ];
  const THEMES = [['sepia', 'Книжкова'], ['dark', 'Темна'], ['light', 'Світла']];
  const LEAD = 0.12;

  // Subtitle-box icon for the player-controls button (white, YouTube style).
  const LAUNCH_ICON =
    '<svg viewBox="0 0 36 36" height="100%" width="100%" fill="#fff">' +
    '<rect x="6" y="10" width="24" height="16" rx="3" fill="none" stroke="#fff" stroke-width="2"/>' +
    '<rect x="9.5" y="14" width="11" height="2.4"/>' +
    '<rect x="9.5" y="19" width="17" height="2.4"/></svg>';

  let state = { ...DEFAULTS };
  let enLines = [];
  let uaLines = [];
  let enUnitLen = 0, uaUnitLen = 0;
  let srcLang = '';
  let lastSig = null, lastCtl = '';
  let currentVideoId = null;
  let awaitingCapture = false;
  let captureTimer = null;
  let capturedBase = null, capturedBody = null, capturedTlang = '', capturedForVideo = null;
  let video = null;
  let panel, elRoll, elStatus, elLog, langSel, elClose, elControls, elPlay, elTime, elFill, elSpeed, btnStudy, elStudy;
  let rafId = null;
  // Shadowing: sentence boundaries (from EN units), current sentence, and the
  // time at which playback should stop (null = free play).
  let sentences = [];
  let sentIdx = 0;
  let stopAt = null;

  // ---------- state ----------
  chrome.storage.local.get('ytds', (r) => {
    if (r.ytds) state = { ...state, ...r.ytds };
    state.reader = false; // never start a page already in reader mode
    document.documentElement.classList.remove('ytds-reader');
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
  const clearDisplay = () => { if (elRoll) elRoll.textContent = ''; lastSig = null; };
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

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
        if (txt == null || !txt.replace(/\s/g, '')) continue;
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

  function joinUnits(units) {
    let out = '';
    for (const u of units) {
      const txt = u.text;
      if (out && !/\s$/.test(out) && !/^[\s.,!?;:…)\]'"”’»]/.test(txt)) out += ' ';
      out += txt;
    }
    return out.replace(/\s+/g, ' ').trim();
  }

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

  // Split word units into sentences (period/!/?/… ends one). Sentence end time =
  // start of the next sentence's first word, so playback stops right at the pause.
  function buildSentences(units) {
    const out = [];
    let start = null, buf = '';
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (start == null) { start = u.t; buf = ''; }
      buf += u.text;
      if (/[.!?…]["'”’)\]]*\s*$/.test(buf)) {
        let end;
        if (i + 1 < units.length) {
          // Stop in the pause BEFORE the next word, so its onset is neither
          // heard nor revealed — but keep at least a little of the last word
          // if the gap happens to be tiny.
          end = Math.max(u.t + 0.12, units[i + 1].t - 0.2);
        } else {
          end = (video && video.duration ? video.duration : u.t + 3);
        }
        out.push({ start, end });
        start = null;
      }
    }
    if (start != null) {
      const last = units[units.length - 1];
      out.push({ start, end: (video && video.duration ? video.duration : last.t + 3) });
    }
    return out;
  }

  function findSentenceAt(t) {
    for (let i = 0; i < sentences.length; i++) if (t < sentences[i].end) return i;
    return Math.max(0, sentences.length - 1);
  }

  // Seek to a sentence's start and play until its end (then loop() pauses us).
  function playSentence(i) {
    if (!video || !sentences.length) return;
    sentIdx = clamp(i, 0, sentences.length - 1);
    const s = sentences[sentIdx];
    stopAt = s.end;
    try { video.currentTime = s.start; } catch (_) {}
    video.play().catch(() => {});
    lastSig = null; lastCtl = '';
  }

  // Begin shadowing at whatever sentence the playhead is currently in.
  function armStudy() {
    if (!video || !sentences.length) return;
    playSentence(findSentenceAt(video.currentTime || 0));
  }

  function setStudy(on) {
    state.study = on; saveState();
    document.documentElement.classList.toggle('ytds-study', !!on);
    if (btnStudy) btnStudy.classList.toggle('ytds-on', !!on);
    if (on) armStudy();
    else stopAt = null; // free play again
  }

  function applySpeed() {
    if (video) { try { video.playbackRate = state.speed || 1; } catch (_) {} }
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
    sentences = buildSentences(enUnits);
    sentIdx = 0; stopAt = null;
    enUnitLen = enUnits.length; uaUnitLen = uaUnits.length;
    lastSig = null;
    dbg(`готово: EN ${enUnits.length} сл / ${enLines.length} рядків · ${sentences.length} речень · ${state.targetLang.toUpperCase()} ${uaUnits.length} сл`);
    updateStatus();
    if (state.reader && state.study) armStudy();
    return true;
  }

  async function loadCaptions() {
    enLines = []; uaLines = []; srcLang = ''; enUnitLen = uaUnitLen = 0;
    sentences = []; sentIdx = 0; stopAt = null;
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

  // ---------- render loop (only while reading) ----------
  function loop() {
    rafId = requestAnimationFrame(loop);
    if (!state.reader) return;
    updateControls();
    // Shadowing: stop the video right at the end of the current sentence.
    if (state.study && stopAt != null && video && !video.paused && video.currentTime >= stopAt - 0.03) {
      video.pause();
      stopAt = null;
    }
    if (!video || (!enLines.length && !uaLines.length)) { showPlaceholder(); return; }
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
    elRoll.dataset.ph = '';
    elRoll.textContent = '';
    // Two fixed zones split at the screen midline: EN sits just ABOVE it
    // (grows upward, its baseline never moves), the translation just below.
    const zEn = document.createElement('div');
    zEn.className = 'ytds-zone ytds-zone-en';
    const zUa = document.createElement('div');
    zUa.className = 'ytds-zone ytds-zone-ua';
    elRoll.append(zEn, zUa);
    if (state.showEn) appendLang(enLines, en, 'ytds-en', zEn);
    if (state.showUa) appendLang(uaLines, ua, 'ytds-ua', zUa);
  }

  // Shown in reader when there are no captions yet: surfaces the status/error.
  function showPlaceholder() {
    if (!elRoll) return;
    const msg = (elStatus && elStatus.textContent) || 'завантаження субтитрів…';
    if (elRoll.dataset.ph === msg) return;
    elRoll.dataset.ph = msg;
    elRoll.textContent = '';
    const d = document.createElement('div');
    d.className = 'ytds-line ytds-ua';
    d.style.opacity = '0.75';
    d.textContent = msg;
    elRoll.appendChild(d);
  }

  function appendLang(lines, sel, cls, target) {
    if (sel.idx < 0) return;
    if (sel.idx > 0) addLine(lines[sel.idx - 1].full, cls, false, target);
    const line = lines[sel.idx];
    addLine(joinUnits(line.units.slice(0, sel.n)), cls, true, target);
  }

  function addLine(text, cls, active, target) {
    const wrap = document.createElement('div');
    wrap.className = 'ytds-block' + (active ? ' ytds-active' : '');
    const l = document.createElement('div');
    l.className = 'ytds-line ' + cls;
    l.textContent = text;
    wrap.appendChild(l);
    (target || elRoll).appendChild(wrap);
  }

  const refresh = () => { lastSig = null; };

  // ---------- playback controls ----------
  const fmtTime = (s) => {
    s = Math.max(0, Math.floor(s || 0));
    const m = Math.floor(s / 60), ss = String(s % 60).padStart(2, '0');
    return `${m}:${ss}`;
  };

  function updateControls() {
    if (!elControls || !video) return;
    const cur = video.currentTime || 0, dur = video.duration || 0;
    const pct = dur ? (cur / dur) * 100 : 0;
    const sig = `${Math.floor(cur)}|${video.paused ? 0 : 1}|${Math.floor(pct)}`;
    if (sig === lastCtl) return;
    lastCtl = sig;
    if (elPlay) elPlay.textContent = video.paused ? '▶' : '❚❚';
    if (elTime) elTime.textContent = `${fmtTime(cur)} / ${fmtTime(dur)}`;
    if (elFill) elFill.style.width = pct + '%';
  }

  // ---------- panel (built once, shown only in reader) ----------
  function ensurePanel() {
    if (panel) return true;

    panel = document.createElement('div');
    panel.className = 'ytds-panel ytds-theme-' + state.theme;

    const bar = document.createElement('div');
    bar.className = 'ytds-bar';

    const btnEn = mkToggle('EN', 'showEn');
    const btnUa = mkToggle('UA', 'showUa');

    const mkBtn = (label, title, fn, cls) => {
      const b = document.createElement('button');
      b.className = 'ytds-btn' + (cls ? ' ' + cls : '');
      b.textContent = label; b.title = title;
      b.addEventListener('click', fn);
      return b;
    };
    const fontMinus = mkBtn('A−', 'Менший шрифт', () => changeFont(-0.1), 'ytds-step');
    const fontPlus = mkBtn('A+', 'Більший шрифт', () => changeFont(0.1), 'ytds-step');

    btnStudy = mkBtn('Навчання', 'Режим шедовінгу: речення за реченням, зупинка на крапці', () => setStudy(!state.study));

    const btnLog = document.createElement('button');
    btnLog.className = 'ytds-btn';
    btnLog.textContent = 'Лог';
    btnLog.addEventListener('click', () => {
      elLog.style.display = elLog.style.display === 'none' ? '' : 'none';
      btnLog.classList.toggle('ytds-on', elLog.style.display !== 'none');
    });

    const themeSel = document.createElement('select');
    themeSel.className = 'ytds-select';
    themeSel.title = 'Тема';
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

    bar.append(btnEn, btnUa, fontMinus, fontPlus, btnStudy, btnLog, themeSel, langSel);

    elRoll = document.createElement('div');
    elRoll.className = 'ytds-roll';
    elStatus = document.createElement('div');
    elStatus.className = 'ytds-status';
    elLog = document.createElement('div');
    elLog.className = 'ytds-log';
    elLog.style.display = 'none';

    elControls = buildControls();
    elStudy = buildStudyRow();
    elClose = document.createElement('button');
    elClose.className = 'ytds-close';
    elClose.textContent = '✕';
    elClose.title = 'Завершити навчання (Esc)';
    elClose.addEventListener('click', exitReader);

    panel.append(elClose, bar, elRoll, elStatus, elControls, elStudy, elLog);
    syncUi();
    return true;
  }

  function buildControls() {
    const wrap = document.createElement('div');
    wrap.className = 'ytds-controls';

    const seek = (d) => { if (video && video.duration) video.currentTime = clamp(video.currentTime + d, 0, video.duration); };
    const mk = (label, title, fn) => {
      const b = document.createElement('button');
      b.className = 'ytds-cbtn'; b.textContent = label; b.title = title;
      b.addEventListener('click', fn);
      return b;
    };
    const back = mk('⏪', 'Назад 10 с', () => seek(-10));
    elPlay = mk('▶', 'Пауза / відтворення', () => { if (!video) return; video.paused ? video.play() : video.pause(); });
    const fwd = mk('⏩', 'Вперед 10 с', () => seek(10));

    elSpeed = document.createElement('select');
    elSpeed.className = 'ytds-select ytds-speed';
    elSpeed.title = 'Швидкість відтворення';
    for (const v of [0.5, 0.75, 1, 1.25, 1.5, 2]) {
      const o = document.createElement('option');
      o.value = String(v); o.textContent = v + '×';
      if (v === (state.speed || 1)) o.selected = true;
      elSpeed.appendChild(o);
    }
    elSpeed.addEventListener('change', () => { state.speed = parseFloat(elSpeed.value); saveState(); applySpeed(); });

    elTime = document.createElement('span');
    elTime.className = 'ytds-time';
    elTime.textContent = '0:00 / 0:00';

    const track = document.createElement('div');
    track.className = 'ytds-progress';
    elFill = document.createElement('div');
    elFill.className = 'ytds-progress-fill';
    track.appendChild(elFill);
    track.addEventListener('click', (e) => {
      if (!video || !video.duration) return;
      const r = track.getBoundingClientRect();
      video.currentTime = clamp((e.clientX - r.left) / r.width, 0, 1) * video.duration;
    });

    wrap.append(back, elPlay, fwd, elSpeed, elTime, track);
    return wrap;
  }

  // Shadowing controls: previous / repeat / next sentence.
  function buildStudyRow() {
    const wrap = document.createElement('div');
    wrap.className = 'ytds-study-row';
    const mk = (label, title, fn, cls) => {
      const b = document.createElement('button');
      b.className = 'ytds-sbtn' + (cls ? ' ' + cls : '');
      b.textContent = label; b.title = title;
      b.addEventListener('click', fn);
      return b;
    };
    const prev = mk('← Попереднє', 'Попереднє речення', () => playSentence(sentIdx - 1));
    const rep = mk('↻ Повторити', 'Програти це речення від початку до кінця', () => playSentence(sentIdx), 'ytds-primary');
    const next = mk('Наступне →', 'Наступне речення', () => playSentence(sentIdx + 1));
    wrap.append(prev, rep, next);
    return wrap;
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
    if (btnStudy) btnStudy.classList.toggle('ytds-on', !!state.study);
    if (elSpeed) elSpeed.value = String(state.speed || 1);
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

  function applyTheme() {
    if (panel) panel.className = 'ytds-panel ytds-theme-' + state.theme;
  }

  function applyLayout() {
    document.documentElement.style.setProperty('--font-scale', state.fontScale || 1);
  }

  function changeFont(delta) {
    state.fontScale = clamp(Math.round((state.fontScale + delta) * 100) / 100, 0.7, 2.6);
    saveState(); applyLayout(); refresh();
  }

  // ---------- reader (study) mode ----------
  function enterReader() {
    ensurePanel();
    state.reader = true; saveState();
    document.body.appendChild(panel);
    document.documentElement.classList.add('ytds-reader');
    document.documentElement.classList.toggle('ytds-study', !!state.study);
    if (panel.requestFullscreen) panel.requestFullscreen().catch(() => {});
    syncUi(); refresh();
    if (state.study) armStudy();
  }

  function exitReader() {
    if (!state.reader && !document.documentElement.classList.contains('ytds-reader')) return;
    state.reader = false; saveState();
    stopAt = null; // let the video play normally again outside study mode
    document.documentElement.classList.remove('ytds-reader');
    document.documentElement.classList.remove('ytds-study');
    if (document.fullscreenElement === panel) document.exitFullscreen().catch(() => {});
    if (panel && panel.parentElement) panel.parentElement.removeChild(panel);
    syncUi();
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.reader) { e.stopPropagation(); exitReader(); }
  }, true);

  document.addEventListener('fullscreenchange', () => {
    if (state.reader && !document.fullscreenElement) exitReader();
  });

  // ---------- player-controls launch button ----------
  function ensureLaunchButton() {
    const rc = document.querySelector('.ytp-right-controls');
    if (!rc || rc.querySelector('.ytds-launch')) return;
    const btn = document.createElement('button');
    btn.className = 'ytp-button ytds-launch';
    btn.title = 'Навчання: двомовні субтитри (English + переклад)';
    btn.innerHTML = LAUNCH_ICON;
    btn.addEventListener('click', enterReader);
    rc.insertBefore(btn, rc.firstChild);
  }

  // ---------- lifecycle ----------
  function tick() {
    if (location.pathname !== '/watch') return;
    video = document.querySelector('video.html5-main-video') || document.querySelector('video');
    ensurePanel();
    ensureLaunchButton();
    const id = new URLSearchParams(location.search).get('v');
    if (id && id !== currentVideoId) {
      currentVideoId = id;
      applySpeed(); // playbackRate resets on each new video
      loadCaptions();
    }
  }

  document.addEventListener('yt-navigate-finish', tick);
  setInterval(tick, 1000);
  tick();
  if (!rafId) loop();
})();
