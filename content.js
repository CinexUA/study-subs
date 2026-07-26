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
  let sentences = [];    // EN sentences (drive playback timing + EN reveal)
  let uaSentences = [];  // translation sentences, index-aligned to `sentences`
  let sentIdx = 0;
  let stopAt = null;
  let stopTimer = null;      // precise stop scheduled for the exact remaining time
  let suppressSeek = false;  // our own currentTime writes must not look like user seeks
  let hookedVideo = null;    // the <video> we attached play/seek/rate listeners to

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
      // dDurationMs = display end of the event; for the last word of an event
      // it is the only end estimate we have (ASR rolling captions overinflate
      // it, so buildSentences additionally caps word length).
      const evEnd = ev.dDurationMs ? (base + ev.dDurationMs) / 1000 : null;
      const segs = ev.segs.filter((s) => s.utf8 != null && s.utf8.replace(/\s/g, ''));
      for (let i = 0; i < segs.length; i++) {
        const t = (base + (segs[i].tOffsetMs || 0)) / 1000;
        const nextT = i + 1 < segs.length ? (base + (segs[i + 1].tOffsetMs || 0)) / 1000 : evEnd;
        units.push({ t, end: nextT != null && nextT > t ? nextT : undefined, text: segs[i].utf8 });
      }
    }
    return units;
  }

  function parseXmlUnits(xml) {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const make = (nodes, tAttr, dAttr, scale) => nodes.map((n, i) => {
      const t = parseFloat(n.getAttribute(tAttr) || '0') / scale;
      const d = parseFloat(n.getAttribute(dAttr) || '0') / scale;
      const text = (n.textContent || '').replace(/\s+/g, ' ').trim();
      return text ? { t, end: d > 0 ? t + d : undefined, text: (i > 0 ? ' ' : '') + text } : null;
    }).filter(Boolean);
    let nodes = [...doc.querySelectorAll('text')];
    if (nodes.length) return make(nodes, 'start', 'dur', 1);
    nodes = [...doc.querySelectorAll('p')];
    return make(nodes, 't', 'd', 1000);
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

  // True sentence end: terminal punctuation that is not an abbreviation.
  // A single letter ("U.S.", "п.") or a known title before the period does
  // not close a sentence — splitting there breaks both the stop point and
  // the UA alignment windows.
  const ABBR_RE = /(?:^|[\s.(\[«"'“‘])(?:[a-zа-яіїєґ]|mr|mrs|ms|dr|st|jr|sr|prof|gen|rep|sen|vs|etc|inc|approx)\.$/i;
  function endsSentence(text) {
    const t = String(text).trimEnd().replace(/["'”’»)\]]+$/, '');
    if (!/[.!?…]$/.test(t)) return false;
    return !(t.endsWith('.') && ABBR_RE.test(t));
  }

  // Coarse tracks (auto-translate often returns one unit per caption line)
  // can hold several sentences in one unit, and then a whole line lands in a
  // single alignment bucket together with a neighbouring sentence's tail.
  // Split such units at sentence punctuation; timestamps are interpolated by
  // character position across the unit's time span. Word-level units pass
  // through untouched.
  function splitUnitsByPunct(units) {
    const out = [];
    const re = /[.!?…]["'”’»)\]]*\s+/g;
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      const text = u.text;
      const cuts = [];
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(text))) {
        if (endsSentence(text.slice(0, m.index + 1))) cuts.push(m.index + m[0].length);
      }
      if (!cuts.length) { out.push(u); continue; }
      const endT = u.end != null ? u.end : (i + 1 < units.length ? units[i + 1].t : u.t + 2);
      const span = Math.max(0, endT - u.t);
      let prev = 0;
      for (const c of [...cuts, text.length]) {
        if (c <= prev) continue;
        const piece = text.slice(prev, c);
        if (piece.trim()) {
          out.push({
            t: u.t + span * (prev / text.length),
            end: u.t + span * (c / text.length),
            text: piece
          });
        }
        prev = c;
      }
    }
    return out;
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
      const endsSent = endsSentence(buf);
      if ((endsSent && buf.length >= minChars) || buf.length >= maxChars || (u.t - cur.start) >= maxDur) flush();
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

  // Split word units into sentences (period/!/?/… ends one; a long silence
  // also breaks — ASR tracks may lack punctuation entirely). Each sentence
  // keeps its units (word-by-word reveal) and an end = just AFTER the last
  // word is spoken (unit `end` from dDurationMs/dur), clamped to safely
  // before the next word's onset. Stopping right after speech — instead of
  // riding the silence to the brink of the next word — is what keeps the
  // next sentence's audio from bleeding in even when timestamps are off.
  function buildSentences(units) {
    const out = [];
    let cur = null, buf = '';
    // When the last word is spoken to the end: parser-provided end if any,
    // clamped by the next word's onset and by a max plausible word length.
    const spokenEnd = (u, nextT) => {
      let e = u.end != null ? u.end : u.t + 0.45;
      if (nextT != null && nextT > u.t) e = Math.min(e, nextT);
      return Math.min(e, u.t + 0.7);
    };
    const close = (i) => {
      const u = units[i], next = units[i + 1];
      const se = spokenEnd(u, next ? next.t : null);
      cur.end = next
        ? Math.max(Math.min(se + 0.2, next.t - 0.08), Math.min(u.t + 0.15, next.t - 0.03))
        : (video && video.duration ? video.duration : se + 0.6);
      out.push(cur);
      cur = null;
    };
    for (let i = 0; i < units.length; i++) {
      const u = units[i], next = units[i + 1];
      if (!cur) { cur = { start: u.t, units: [] }; buf = ''; }
      cur.units.push(u);
      buf += u.text;
      const longGap = next && (next.t - spokenEnd(u, next.t)) >= 1.4;
      if (endsSentence(buf) || longGap) close(i);
    }
    if (cur) close(units.length - 1);
    return out;
  }

  // Align the translation to the EN sentences by TIME, not by its own
  // punctuation. Auto-translate re-places periods (one EN sentence can become
  // two UA ones, or vice-versa), so segmenting UA independently drifts out of
  // index-sync with EN. Instead: every UA word keeps its own timestamp from the
  // same audio, so we bucket each UA word into the EN sentence whose time window
  // it falls in. Result always has exactly one UA bucket per EN sentence.
  function alignUaToEn(uaUnits, enSents) {
    const out = enSents.map((s) => ({ start: s.start, end: s.end, units: [] }));
    if (!out.length) return out;
    let si = 0;
    for (const u of uaUnits) {
      while (si + 1 < enSents.length && enSents[si + 1].start <= u.t + 0.01) si++;
      out[si].units.push(u);
    }
    // Time buckets can catch the next sentence's leading word(s): an auto-
    // translated word may be timed a hair before the next EN sentence starts.
    // Punctuation is the true end, so move anything trailing after a bucket's
    // last sentence-ending mark into the next bucket — where it belongs.
    for (let i = 0; i < out.length - 1; i++) {
      const u = out[i].units;
      let cut = -1;
      for (let k = 0; k < u.length; k++) {
        if (endsSentence(u[k].text)) cut = k;
      }
      if (cut >= 0) {
        if (cut < u.length - 1) out[i + 1].units.unshift(...u.splice(cut + 1));
      } else {
        // No punctuation to go by (auto-translate dropped the period): fall
        // back to the EN sentence's time window — words that start after its
        // speech has ended belong to the next sentence.
        let k = u.length;
        while (k > 1 && u[k - 1].t > out[i].end + 0.05) k--;
        if (k < u.length) out[i + 1].units.unshift(...u.splice(k));
      }
    }
    return out;
  }

  function findSentenceAt(t) {
    for (let i = 0; i < sentences.length; i++) if (t < sentences[i].end) return i;
    return Math.max(0, sentences.length - 1);
  }

  // Seek to just before a sentence's first word and play until its end.
  function playSentence(i) {
    if (!video || !sentences.length) return;
    sentIdx = clamp(i, 0, sentences.length - 1);
    const s = sentences[sentIdx];
    stopAt = s.end;
    const prevEnd = sentIdx > 0 ? sentences[sentIdx - 1].end : 0;
    // A touch early, so the first word's attack isn't clipped by the seek.
    const from = Math.min(Math.max(s.start - 0.15, prevEnd), s.start);
    try { video.currentTime = from; } catch (_) {}
    video.play().catch(() => {});
    armStop();
    lastSig = null; lastCtl = '';
  }

  // Precise stop: a timer scheduled for the exact remaining time. rAF alone
  // overshoots by a frame (16–33+ ms, worse at 2×) and freezes in background
  // tabs; the rAF check in loop() stays only as a backup.
  function armStop() {
    clearTimeout(stopTimer); stopTimer = null;
    if (stopAt == null || !video || video.paused) return;
    const ms = Math.max(0, (stopAt - video.currentTime) / (video.playbackRate || 1)) * 1000;
    stopTimer = setTimeout(hitStop, ms);
  }
  function hitStop() {
    clearTimeout(stopTimer); stopTimer = null;
    if (stopAt == null || !video || video.paused) return;
    if (video.currentTime < stopAt - 0.005) { armStop(); return; } // fired early (seek lag / buffering)
    video.pause();
    const over = video.currentTime - stopAt;
    if (over > 0.005 && over < 0.8) {
      suppressSeek = true; // our own correction — not a user seek
      try { video.currentTime = stopAt; } catch (_) { suppressSeek = false; }
    }
    stopAt = null;
    lastCtl = '';
  }

  // After any user seek or a resume outside our controls, the text must show
  // the sentence the audio is actually in — otherwise audio walks away while
  // the display stays frozen on a stale sentence.
  function resyncStudy() {
    if (!state.reader || !state.study || !sentences.length || !video) return;
    const i = findSentenceAt(video.currentTime || 0);
    if (i !== sentIdx) { sentIdx = i; lastSig = null; }
    stopAt = sentences[sentIdx].end;
    armStop();
  }

  function onSeeked() {
    if (suppressSeek) { suppressSeek = false; return; }
    resyncStudy();
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
    else { stopAt = null; clearTimeout(stopTimer); stopTimer = null; } // free play again
  }

  function applySpeed() {
    if (video) { try { video.playbackRate = state.speed || 1; } catch (_) {} }
    armStop(); // the stop timer depends on the playback rate
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
    enUnits = splitUnitsByPunct(enUnits);

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
    if (!sameLang) uaUnits = splitUnitsByPunct(uaUnits);

    enLines = groupUnitsToLines(enUnits);
    uaLines = sameLang ? enLines : groupUnitsToLines(uaUnits);
    sentences = buildSentences(enUnits);
    uaSentences = sameLang ? sentences : alignUaToEn(uaUnits, sentences);
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
    sentences = []; uaSentences = []; sentIdx = 0; stopAt = null;
    clearTimeout(stopTimer); stopTimer = null;
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
    // Shadowing: the precise stop timer does the real work; this is a backup.
    if (state.study && stopAt != null && video && !video.paused && video.currentTime >= stopAt) hitStop();
    if (!video || (!enLines.length && !uaLines.length)) { showPlaceholder(); return; }
    const t = video.currentTime;

    // Study mode: reveal only the current sentence, EN and UA index-aligned,
    // so the next sentence's words can never bleed across the two tracks.
    if (state.study && sentences.length) {
      // Playing with no stop armed = resumed outside our controls — follow.
      if (!video.paused && stopAt == null) resyncStudy();
      const enS = sentences[sentIdx];
      const enN = revealCount(enS, t);
      const uaN = uaRevealCount(enS, uaSentences[sentIdx], t);
      const sig = `S${sentIdx}:${enN}:${uaN}:${state.showEn ? 1 : 0}${state.showUa ? 1 : 0}`;
      if (sig === lastSig) return;
      lastSig = sig;
      renderStudy(enN, uaN);
      return;
    }

    const en = pickLine(enLines, t);
    const ua = pickLine(uaLines, t);
    const sig = `${en.idx}:${en.n}|${ua.idx}:${ua.n}|${state.showEn ? 1 : 0}${state.showUa ? 1 : 0}`;
    if (sig === lastSig) return;
    lastSig = sig;
    renderLive(en, ua);
  }

  // How many EN words of a sentence should be visible at time t.
  function revealCount(s, t) {
    if (!s) return 0;
    let n = 0;
    for (const u of s.units) { if (u.t <= t + LEAD) n++; else break; }
    return Math.max(1, n);
  }

  // Translation reveal follows the EN sentence's PROGRESS (not UA timestamps),
  // so it stays in step and shows fully exactly when the sentence ends.
  function uaRevealCount(enS, uaS, t) {
    if (!enS || !uaS) return 0;
    const span = (enS.end - enS.start) || 1;
    const p = clamp((t - enS.start) / span, 0, 1);
    return Math.max(1, Math.ceil(p * uaS.units.length));
  }

  function mkZone(cls) {
    const d = document.createElement('div');
    d.className = 'ytds-zone ' + cls;
    return d;
  }

  function renderStudy(enN, uaN) {
    if (!elRoll) return;
    elRoll.dataset.ph = '';
    elRoll.textContent = '';
    const zEn = mkZone('ytds-zone-en');
    const zUa = mkZone('ytds-zone-ua');
    elRoll.append(zEn, zUa);
    const enS = sentences[sentIdx];
    const uaS = uaSentences[sentIdx];
    if (state.showEn && enS) addLine(joinUnits(enS.units.slice(0, enN)), 'ytds-en', true, zEn);
    if (state.showUa && uaS) addLine(joinUnits(uaS.units.slice(0, uaN)), 'ytds-ua', true, zUa);
  }

  function renderLive(en, ua) {
    if (!elRoll) return;
    elRoll.dataset.ph = '';
    elRoll.textContent = '';
    // Two fixed zones split at the screen midline: EN sits just ABOVE it
    // (grows upward, its baseline never moves), the translation just below.
    const zEn = mkZone('ytds-zone-en');
    const zUa = mkZone('ytds-zone-ua');
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
    elPlay = mk('▶', 'Пауза / відтворення', () => {
      if (!video) return;
      if (!video.paused) { video.pause(); return; }
      // In study mode ▶ after the auto-stop means "next sentence" (skips the
      // silence); a manual mid-sentence pause (stop still armed) just resumes.
      if (state.study && state.reader && sentences.length && stopAt == null) playSentence(sentIdx + 1);
      else video.play();
    });
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
    clearTimeout(stopTimer); stopTimer = null;
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
    if (video && video !== hookedVideo) {
      hookedVideo = video;
      video.addEventListener('play', armStop);
      video.addEventListener('ratechange', armStop);
      video.addEventListener('seeked', onSeeked);
    }
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
