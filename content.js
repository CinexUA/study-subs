// Runs in the ISOLATED world.
// It stays out of YouTube's UI: it only adds one button to the player controls.
// Clicking it opens a full-screen study overlay with dual subtitles that reveal
// word by word, plus its own playback controls.
(() => {
  'use strict';

  const DEFAULTS = { showEn: true, showUa: true, targetLang: 'uk', theme: 'sepia', fontScale: 1, reader: false, speed: 1, study: true, loop: false };
  const LANGS = [
    ['uk', 'Українська'], ['en', 'English'], ['pl', 'Polski'],
    ['de', 'Deutsch'], ['es', 'Español'], ['fr', 'Français'],
    ['it', 'Italiano'], ['ru', 'Русская']
  ];
  const THEMES = [['sepia', 'Книжкова'], ['dark', 'Нічна'], ['light', 'Денна']];
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
  // Subtitle scale steps from the design language (26/32/40/50/62px → ×M).
  const FONT_STEPS = [['XS', 0.65], ['S', 0.8], ['M', 1], ['L', 1.25], ['XL', 1.55]];
  const LEAD = 0.12;

  // Subtitle-box icon for the player-controls button (white, YouTube style).
  const LAUNCH_ICON =
    '<svg viewBox="0 0 36 36" height="100%" width="100%" fill="#fff">' +
    '<rect x="6" y="10" width="24" height="16" rx="3" fill="none" stroke="#fff" stroke-width="2"/>' +
    '<rect x="9.5" y="14" width="11" height="2.4"/>' +
    '<rect x="9.5" y="19" width="17" height="2.4"/></svg>';

  // One pencil for the whole set: 20×20 grid, 1.7 stroke, round joins,
  // currentColor. Fill is allowed for transport only. Sizes come from CSS.
  const S = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">';
  const ICONS = {
    play: '<svg viewBox="0 0 20 20" fill="none"><path d="M6.9 4.5 15.6 10 6.9 15.5Z" fill="currentColor" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
    pause: '<svg viewBox="0 0 20 20" fill="none"><rect x="6" y="4.6" width="2.9" height="10.8" rx="1.3" fill="currentColor"/><rect x="11.1" y="4.6" width="2.9" height="10.8" rx="1.3" fill="currentColor"/></svg>',
    rewind: S + '<path d="M9.4 5.6 5 10l4.4 4.4M16 5.6 11.6 10 16 14.4"/></svg>',
    forward: S + '<path d="M10.6 5.6 15 10l-4.4 4.4M4 5.6 8.4 10 4 14.4"/></svg>',
    repeat: S + '<path d="M4.6 9.4v-.8A2.8 2.8 0 0 1 7.4 5.8h6.3M11.7 3.6 14 5.8l-2.3 2.2M15.4 10.6v.8a2.8 2.8 0 0 1-2.8 2.8H6.3M8.3 16.4 6 14.2l2.3-2.2"/></svg>',
    chevL: S + '<path d="M12.4 5.2 7.4 10l5 4.8"/></svg>',
    chevR: S + '<path d="M7.6 5.2 12.6 10l-5 4.8"/></svg>',
    chevD: S + '<path d="M5.4 8 10 12.6 14.6 8"/></svg>',
    close: S + '<path d="M5.8 5.8 14.2 14.2M14.2 5.8 5.8 14.2"/></svg>',
    settings: S + '<path d="M3.6 6.6h2.1M10.4 6.6h6M3.6 13.4h6.9M15.1 13.4h1.3"/><circle cx="8.1" cy="6.6" r="2.3"/><circle cx="12.8" cy="13.4" r="2.3"/></svg>',
    check: S + '<path d="M4.8 10.5 8.2 13.9 15.2 6.5"/></svg>',
    console: S + '<rect x="3.2" y="4.4" width="13.6" height="11.2" rx="2.6"/><path d="M6.6 8.6 8.9 10.9l-2.3 2.3M11.2 13.2h3.1"/></svg>'
  };

  let state = { ...DEFAULTS };
  let enUnitLen = 0, uaUnitLen = 0;
  let srcLang = '';
  let lastSig = null, lastCtl = '', lastIdx = -1, ticksDur = 0, ticksLen = -1;
  let currentVideoId = null;
  let awaitingCapture = false;
  let captureTimer = null;
  let capturedBase = null, capturedBody = null, capturedTlang = '', capturedForVideo = null;
  let video = null;
  let panel, elStage, elEn, elUa, elNote, elStatus, elLog, elCounter;
  let elControls, elPlay, elTime, elFill, elBuffer, elTicks, elBubble, elScrub;
  let btnLoop;
  const menus = [];   // value pickers (speed, language) that syncUi() refreshes
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
  const clearDisplay = () => {
    if (elEn) elEn.textContent = '';
    if (elUa) elUa.textContent = '';
    lastSig = null; lastIdx = -1;
  };
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
  // A single letter (e.g. "U.S.") or a known title before the period does
  // not close a sentence — splitting there breaks both the stop point and
  // the UA alignment windows. The letter class below covers Latin and
  // Cyrillic since the translation track can be in Ukrainian/Russian.
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

  // Playback stops at the end of a sentence when auto-pause is on, and also
  // while looping — the loop is built on top of that same stop.
  function stopping() { return !!(state.study || state.loop); }

  // Seek to just before a sentence's first word and play until its end.
  function playSentence(i) {
    if (!video || !sentences.length) return;
    sentIdx = clamp(i, 0, sentences.length - 1);
    const s = sentences[sentIdx];
    stopAt = stopping() ? s.end : null;
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
    // Loop: after the pause that lets the learner repeat aloud, play it again.
    if (state.loop && state.reader) {
      const at = sentIdx;
      setTimeout(() => { if (state.loop && state.reader && sentIdx === at) playSentence(at); }, 600);
    }
  }

  // After any user seek or a resume outside our controls, the text must show
  // the sentence the audio is actually in — otherwise audio walks away while
  // the display stays frozen on a stale sentence.
  function resync() {
    if (!state.reader || !sentences.length || !video) return;
    const i = findSentenceAt(video.currentTime || 0);
    if (i !== sentIdx) { sentIdx = i; lastSig = null; }
    stopAt = stopping() ? sentences[sentIdx].end : null;
    armStop();
  }

  function onSeeked() {
    if (suppressSeek) { suppressSeek = false; return; }
    resync();
  }

  // Begin shadowing at whatever sentence the playhead is currently in.
  function armStudy() {
    if (!video || !sentences.length) return;
    sentIdx = findSentenceAt(video.currentTime || 0);
    stopAt = stopping() ? sentences[sentIdx].end : null;
    armStop();
    lastSig = null;
  }

  function setStudy(on) {
    state.study = on; saveState();
    if (on) armStudy();
    else if (!state.loop) { stopAt = null; clearTimeout(stopTimer); stopTimer = null; } // free play again
    syncUi();
  }

  // Repeat is a toggle: turning it on restarts the sentence and keeps
  // replaying it; turning it off lets playback move on.
  function setLoop(on) {
    state.loop = on; saveState();
    if (on) playSentence(sentIdx);
    else if (!state.study) { stopAt = null; clearTimeout(stopTimer); stopTimer = null; }
    syncUi();
  }

  function applySpeed() {
    if (video) { try { video.playbackRate = state.speed || 1; } catch (_) {} }
    armStop(); // the stop timer depends on the playback rate
  }

  function updateStatus() {
    const uaNote = (state.targetLang !== srcLang && !uaUnitLen) ? ' · translation unavailable' : '';
    const srcU = (srcLang || 'en').toUpperCase();
    setStatus(`source: ${srcLang || '?'} · ${srcU} ${enUnitLen} words · ${state.targetLang.toUpperCase()} ${uaUnitLen} words · ${sentences.length} sentences${uaNote}`);
    updateLabels();
    updateCounter();
  }

  // ---------- captions ----------
  const pickSrc = (tracks) =>
    tracks.find((t) => t.lang && t.lang.startsWith('en') && t.kind !== 'asr')
    || tracks.find((t) => t.lang && t.lang.startsWith('en'))
    || tracks[0];

  async function buildFromBase(base, body, capTlang) {
    let enUnits = [];
    try { enUnits = await fetchUnits(base, null); } catch (e) { dbg('EN fetch failed: ' + e.message); }
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

    sentences = buildSentences(enUnits);
    uaSentences = sameLang ? sentences : alignUaToEn(uaUnits, sentences);
    sentIdx = 0; stopAt = null;
    enUnitLen = enUnits.length; uaUnitLen = uaUnits.length;
    lastSig = null; lastIdx = -1;
    dbg(`ready: EN ${enUnits.length} words · ${sentences.length} sentences · ${state.targetLang.toUpperCase()} ${uaUnits.length} words`);
    updateStatus();
    if (state.reader) armStudy();
    return true;
  }

  async function loadCaptions() {
    srcLang = ''; enUnitLen = uaUnitLen = 0;
    sentences = []; uaSentences = []; sentIdx = 0; stopAt = null;
    clearTimeout(stopTimer); stopTimer = null;
    awaitingCapture = false;
    clearTimeout(captureTimer);
    clearDisplay();
    setStatus('loading…');
    dbg('--- loadCaptions for ' + currentVideoId);

    if (capturedBase && capturedForVideo === currentVideoId) {
      dbg('using cached valid URL');
      if (await buildFromBase(capturedBase, capturedBody, capturedTlang)) return;
      dbg('cached URL failed (token may have expired)');
    }

    const tracks = await requestTracks();
    dbg(`tracks from playerResponse: ${tracks.length}` +
        (tracks.length ? ' [' + tracks.map((t) => `${t.lang}${t.kind === 'asr' ? '/asr' : ''}`).join(', ') + ']' : ''));
    if (tracks.length) {
      const src = pickSrc(tracks);
      srcLang = src.lang || '';
      if (await buildFromBase(src.baseUrl, null, '')) { dbg('direct fetch succeeded'); return; }
      dbg('direct fetch returned 0 → need interception');
    }

    awaitingCapture = true;
    setStatus('enabling player captions…');
    dbg('→ asking player to enable CC (YTDS_ENABLE)');
    window.postMessage({ type: 'YTDS_ENABLE' }, '*');
    captureTimer = setTimeout(() => {
      if (awaitingCapture && !sentences.length) {
        awaitingCapture = false;
        dbg('9s timeout: no capture happened — the video likely has no captions');
        setStatus('could not fetch captions — enable CC in the player manually');
      }
    }, 9000);
  }

  async function handleCaptured(url, body) {
    if (sentences.length) return;
    const base = reuseBase(url);
    const capTlang = (/[?&]tlang=([^&]*)/.exec(url) || [])[1] || '';

    capturedBase = base; capturedBody = body; capturedTlang = capTlang; capturedForVideo = currentVideoId;

    if (!(await buildFromBase(base, body, capTlang))) { dbg('capture had no usable EN — waiting for another'); return; }
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
      dbg(`intercepted timedtext (tlang=${tl ? tl[1] : '-'}, body=${(e.data.body || '').length} bytes)`);
      handleCaptured(e.data.url, e.data.body);
    }
  });

  // ---------- render loop (only while reading) ----------
  // One sentence at a time: EN and the translation are index-aligned, so the
  // next sentence's words can never bleed across the two tracks.
  function loop() {
    rafId = requestAnimationFrame(loop);
    if (!state.reader) return;
    updateControls();
    // The precise stop timer does the real work; this is a backup.
    if (stopAt != null && video && !video.paused && video.currentTime >= stopAt) hitStop();
    if (!video || !sentences.length) { showPlaceholder(); return; }
    const t = video.currentTime;

    // Playing with no stop armed = free play or a resume outside our
    // controls — follow the audio instead of freezing on a stale sentence.
    if (!video.paused && stopAt == null) {
      const i = findSentenceAt(t);
      if (i !== sentIdx) { sentIdx = i; lastSig = null; }
    }
    const enS = sentences[sentIdx];
    const uaS = uaSentences[sentIdx];
    const enN = revealCount(enS, t);
    const uaN = uaRevealCount(enS, uaS, t);
    const sig = `${sentIdx}:${enN}:${uaN}:${state.showEn ? 1 : 0}${state.showUa ? 1 : 0}`;
    if (sig === lastSig) return;
    const fresh = sentIdx !== lastIdx;
    lastSig = sig; lastIdx = sentIdx;
    render(
      enS ? joinUnits(enS.units.slice(0, enN)) : '',
      uaS ? joinUnits(uaS.units.slice(0, uaN)) : '',
      fresh
    );
    if (fresh) updateCounter();
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

  // Two fixed zones split by the hairline: EN sits just ABOVE it (grows
  // upward, its baseline never moves), the translation just below.
  function render(enText, uaText, fresh) {
    if (!elEn) return;
    if (elNote) elNote.style.display = 'none';
    elEn.textContent = state.showEn ? enText : '';
    elUa.textContent = state.showUa ? uaText : '';
    if (!fresh) return;
    for (const node of [elEn, elUa]) {
      node.classList.remove('ytds-fresh');
      void node.offsetWidth;    // restart the entrance animation
      node.classList.add('ytds-fresh');
    }
  }

  // Shown in reader when there are no captions yet: surfaces the status/error.
  function showPlaceholder() {
    if (!elNote) return;
    const msg = (elStatus && elStatus.textContent) || 'завантажую субтитри…';
    if (elNote.style.display !== 'none' && elNote.textContent === msg) return;
    elEn.textContent = ''; elUa.textContent = '';
    elNote.style.display = '';
    elNote.textContent = msg;
  }

  function refresh() { lastSig = null; lastIdx = -1; }

  // ---------- playback controls ----------
  const fmtTime = (s) => {
    s = Math.max(0, Math.floor(s || 0));
    const m = Math.floor(s / 60), ss = String(s % 60).padStart(2, '0');
    return `${m}:${ss}`;
  };

  function updateControls() {
    if (!elControls || !video) return;
    const cur = video.currentTime || 0, dur = video.duration || 0;
    // Outside the signature gate below: captions usually arrive while the
    // video is paused, i.e. while that gate is short-circuiting every frame.
    if (dur && (dur !== ticksDur || sentences.length !== ticksLen)) buildTicks(dur);
    const sig = `${cur.toFixed(1)}|${video.paused ? 0 : 1}|${Math.floor(dur)}`;
    if (sig === lastCtl) return;
    lastCtl = sig;
    if (elPlay) setIcon(elPlay, video.paused ? 'play' : 'pause');
    if (elTime) elTime.textContent = `${fmtTime(cur)} / ${fmtTime(dur)}`;
    if (elFill) elFill.style.width = (dur ? (cur / dur) * 100 : 0) + '%';
    if (elBuffer) elBuffer.style.width = (dur ? (bufferedTo(cur) / dur) * 100 : 0) + '%';
  }

  // End of the buffered range the playhead currently sits in.
  function bufferedTo(cur) {
    try {
      for (let i = 0; i < video.buffered.length; i++) {
        if (video.buffered.start(i) <= cur && video.buffered.end(i) >= cur) return video.buffered.end(i);
      }
    } catch (_) {}
    return 0;
  }

  // Notches on the track = sentence boundaries. A dense track is thinned out
  // hard (a 500-sentence video would otherwise draw a comb): keep a real
  // boundary only every 8% of the width, a dozen marks at most.
  function buildTicks(dur) {
    ticksDur = dur; ticksLen = sentences.length;
    if (!elTicks) return;
    elTicks.textContent = '';
    let last = -Infinity;
    for (const s of sentences) {
      const p = (s.start / dur) * 100;
      if (p < 1 || p > 99 || p - last < 8) continue;
      last = p;
      const tick = document.createElement('span');
      tick.className = 'ytds-tick';
      tick.style.left = p + '%';
      elTicks.appendChild(tick);
    }
  }

  // ---------- DOM helpers ----------
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  // Icons are inlined SVG strings (MV3: no icon fonts, no CDN); every size
  // comes from CSS, so the markup carries no width/height.
  function icon(name) {
    const box = document.createElement('span');
    box.innerHTML = ICONS[name];
    return box.firstElementChild;
  }
  function setIcon(node, name) {
    const old = node.querySelector('svg');
    if (old) old.replaceWith(icon(name)); else node.appendChild(icon(name));
  }
  function mkBtn(cls, title, onClick, ...kids) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    if (title) b.title = title;
    b.append(...kids);
    b.addEventListener('click', onClick);
    return b;
  }
  function txt(s) { return document.createTextNode(s); }

  function toggleKey(key) { state[key] = !state[key]; saveState(); syncUi(); }

  // A− / step / A+ tray. Lives both in the top bar and in the drawer.
  function mkFontSeg() {
    const seg = el('div', 'ytds-seg');
    seg.append(
      mkBtn('ytds-step', 'Менший шрифт', () => changeFont(-1), txt('A')),
      el('span', 'ytds-step-label'),
      mkBtn('ytds-step ytds-step-lg', 'Більший шрифт', () => changeFont(1), txt('A'))
    );
    return seg;
  }

  function mkToggle(key, onChange) {
    const b = mkBtn('ytds-toggle', '', () => {
      state[key] = !state[key];
      saveState();
      if (onChange) onChange(state[key]); else syncUi();
    }, el('span'));
    b.dataset.key = key;
    return b;
  }

  function closeMenus() {
    if (panel) panel.querySelectorAll('.ytds-menu.ytds-open').forEach((m) => m.classList.remove('ytds-open'));
  }

  // Own value picker instead of <select>: a native one drags YouTube's styles in.
  function mkMenu(opts) {
    const wrap = el('div', 'ytds-menu-wrap');
    const label = el('span');
    const menu = el('div', 'ytds-menu' + (opts.below ? ' ytds-below' : '') + (opts.text ? ' ytds-menu-text' : ''));
    const pill = mkBtn('ytds-pill', opts.title || '', (e) => {
      e.stopPropagation();
      const wasOpen = menu.classList.contains('ytds-open');
      closeMenus();
      if (!wasOpen) { fill(); menu.classList.add('ytds-open'); }
    }, label, icon('chevD'));

    const fill = () => {
      menu.textContent = '';
      for (const [value, text] of opts.items) {
        const kids = [txt(text)];
        if (value === opts.get()) kids.push(icon('check'));
        menu.appendChild(mkBtn('', '', (e) => {
          e.stopPropagation();
          closeMenus();
          opts.pick(value);
          syncUi();
        }, ...kids));
      }
    };
    wrap.append(pill, menu);
    menus.push({ sync: () => { label.textContent = opts.label(opts.get()); } });
    label.textContent = opts.label(opts.get());
    return wrap;
  }

  // ---------- panel (built once, shown only in reader) ----------
  function ensurePanel() {
    if (panel) return true;
    panel = el('div', 'ytds-panel ytds-theme-' + state.theme);
    panel.addEventListener('click', closeMenus);
    panel.append(buildTop(), buildStage(), buildStudyRow(), buildControls(), buildDrawer());
    syncUi();
    return true;
  }

  function buildTop() {
    const segLang = el('div', 'ytds-seg');
    const bEn = mkBtn('', 'Показувати оригінал', () => toggleKey('showEn'), txt('EN'));
    bEn.dataset.key = 'showEn';
    const bUa = mkBtn('', 'Показувати переклад', () => toggleKey('showUa'), txt('UK'));
    bUa.dataset.key = 'showUa';
    segLang.append(bEn, bUa);

    const left = el('div', 'ytds-top-side');
    left.append(segLang, mkFontSeg());

    elCounter = el('div', 'ytds-counter');

    const right = el('div', 'ytds-top-side ytds-right');
    right.append(
      mkBtn('ytds-icon ytds-gear', 'Налаштування', openDrawer, icon('settings')),
      mkBtn('ytds-icon', 'Вийти (Esc)', exitReader, icon('close'))
    );

    const top = el('div', 'ytds-top');
    top.append(left, elCounter, right);
    return top;
  }

  function buildStage() {
    const zEn = el('div', 'ytds-zone ytds-zone-en');
    elEn = el('span', 'ytds-line ytds-en');
    zEn.appendChild(elEn);
    const zUa = el('div', 'ytds-zone ytds-zone-ua');
    elUa = el('span', 'ytds-line ytds-ua');
    zUa.appendChild(elUa);
    elNote = el('div', 'ytds-note');
    elNote.style.display = 'none';

    elStage = el('div', 'ytds-stage');
    elStage.append(zEn, el('div', 'ytds-rule'), zUa, elNote);
    return elStage;
  }

  // Shadowing row: previous / repeat / next sentence. Repeat is the hero.
  function buildStudyRow() {
    btnLoop = mkBtn('ytds-sbtn ytds-primary', 'Повторювати це речення (R)', () => setLoop(!state.loop),
      icon('repeat'), el('span', null, 'Повторити'));

    const tray = el('div', 'ytds-study-tray');
    tray.append(
      mkBtn('ytds-sbtn ytds-prev', 'Попереднє речення (←)', () => playSentence(sentIdx - 1), icon('chevL'), el('span', null, 'Попереднє')),
      btnLoop,
      mkBtn('ytds-sbtn ytds-next', 'Наступне речення (→)', () => playSentence(sentIdx + 1), el('span', null, 'Наступне'), icon('chevR'))
    );
    const row = el('div', 'ytds-study-row');
    row.appendChild(tray);
    return row;
  }

  function buildControls() {
    const seek = (d) => { if (video && video.duration) video.currentTime = clamp(video.currentTime + d, 0, video.duration); };
    elPlay = mkBtn('ytds-icon ytds-play', 'Пауза / відтворення', togglePlay, icon('play'));
    elTime = el('div', 'ytds-time', '0:00 / 0:00');

    elControls = el('div', 'ytds-controls');
    elControls.append(
      mkBtn('ytds-icon', 'Назад 10 с', () => seek(-10), icon('rewind')),
      elPlay,
      mkBtn('ytds-icon', 'Вперед 10 с', () => seek(10), icon('forward')),
      mkSpeedMenu(false),
      elTime,
      buildScrub()
    );
    return elControls;
  }

  function mkSpeedMenu(below) {
    return mkMenu({
      title: 'Швидкість відтворення',
      below,
      items: SPEEDS.map((v) => [v, v + '×']),
      get: () => state.speed || 1,
      label: (v) => v + '×',
      pick: (v) => { state.speed = v; saveState(); applySpeed(); }
    });
  }

  function togglePlay() {
    if (!video) return;
    if (!video.paused) { video.pause(); return; }
    // After an auto-stop ▶ means "next sentence" (skips the silence); a manual
    // mid-sentence pause (stop still armed) just resumes.
    if (state.reader && stopping() && sentences.length && stopAt == null) playSentence(sentIdx + 1);
    else video.play().catch(() => {});
  }

  function buildScrub() {
    elBuffer = el('div', 'ytds-buffer');
    elFill = el('div', 'ytds-fill');
    elFill.appendChild(el('span', 'ytds-thumb'));
    elTicks = el('div', 'ytds-ticks');
    const track = el('div', 'ytds-track');
    track.append(elBuffer, elFill, elTicks);

    elBubble = el('div', 'ytds-bubble', '0:00');
    elScrub = el('div', 'ytds-scrub');
    elScrub.append(track, elBubble);

    const posOf = (e) => {
      const r = track.getBoundingClientRect();
      return clamp((e.clientX - r.left) / r.width, 0, 1);
    };
    elScrub.addEventListener('mousemove', (e) => {
      if (!video || !video.duration) return;
      const p = posOf(e);
      elBubble.style.left = (p * 100) + '%';
      elBubble.textContent = fmtTime(p * video.duration);
    });
    // Clicking snaps to the START of the sentence under the cursor — that is
    // what the notches promise, and what shadowing actually needs.
    elScrub.addEventListener('click', (e) => {
      if (!video || !video.duration) return;
      const t = posOf(e) * video.duration;
      if (sentences.length) playSentence(findSentenceAt(t));
      else video.currentTime = t;
    });
    return elScrub;
  }

  // ---------- settings drawer ----------
  function drawerIsOpen() { return !!panel && panel.classList.contains('ytds-drawer-open'); }
  function openDrawer() { if (panel) panel.classList.add('ytds-drawer-open'); }
  function closeDrawer() { if (panel) { panel.classList.remove('ytds-drawer-open'); closeMenus(); } }

  function buildDrawer() {
    const scrim = el('div', 'ytds-scrim');
    scrim.addEventListener('click', closeDrawer);

    const head = el('div', 'ytds-drawer-head');
    head.append(el('span', null, 'Налаштування'), mkBtn('', 'Закрити', closeDrawer, icon('close')));

    const row = (title, control, hint) => {
      const left = el('div');
      left.appendChild(txt(title));
      if (hint) left.appendChild(el('div', 'ytds-row-hint', hint));
      const r = el('div', 'ytds-row');
      r.append(left, control);
      return r;
    };
    const group = (title, iconName) => {
      const g = el('div', 'ytds-group-title');
      if (iconName) g.appendChild(icon(iconName));
      g.appendChild(txt(title));
      return g;
    };

    elStatus = el('div', 'ytds-status');
    elLog = el('div', 'ytds-log');

    const body = el('div', 'ytds-drawer-body');
    body.append(
      group('Субтитри'),
      row('Англійський рядок', mkToggle('showEn')),
      row('Рядок перекладу', mkToggle('showUa')),
      row('Мова перекладу', mkMenu({
        title: 'Мова перекладу',
        below: true, text: true,
        items: LANGS,
        get: () => state.targetLang,
        label: (v) => (LANGS.find((l) => l[0] === v) || [v, v])[1],
        pick: (v) => { state.targetLang = v; saveState(); loadCaptions(); }
      })),
      row('Розмір', mkFontSeg()),

      group('Відтворення'),
      row('Швидкість', mkSpeedMenu(true)),
      row('Пауза в кінці речення', mkToggle('study', setStudy), 'Дає секунду, щоб повторити вголос'),

      group('Вигляд'),
      row('Тема', buildSwatches()),

      group('Advanced', 'console'),
      elStatus,
      elLog,
      mkBtn('ytds-text-btn', '', () => {
        navigator.clipboard.writeText(elLog.textContent || '').catch(() => {});
      }, txt('Скопіювати лог'))
    );

    const keys = el('div', 'ytds-keys');
    for (const [k, t] of [['R', 'повтор'], ['←→', 'речення'], ['Esc', 'вихід']]) {
      const s = el('span');
      s.append(el('b', null, k), txt(' ' + t));
      keys.appendChild(s);
    }

    const drawer = el('aside', 'ytds-drawer');
    drawer.append(head, body, keys);

    const frag = document.createDocumentFragment();
    frag.append(scrim, drawer);
    return frag;
  }

  function buildSwatches() {
    const wrap = el('div', 'ytds-swatches');
    for (const [code, label] of THEMES) {
      const b = mkBtn('ytds-swatch ytds-swatch-' + code, label, () => {
        state.theme = code; saveState(); applyTheme(); syncUi();
      });
      b.dataset.theme = code;
      wrap.appendChild(b);
    }
    return wrap;
  }

  // ---------- syncing UI to state ----------
  function syncUi() {
    if (!panel) return;
    panel.querySelectorAll('[data-key]').forEach((b) => b.classList.toggle('ytds-on', !!state[b.dataset.key]));
    panel.querySelectorAll('.ytds-swatch').forEach((b) => b.classList.toggle('ytds-on', b.dataset.theme === state.theme));
    const step = FONT_STEPS[fontStepIdx()][0];
    panel.querySelectorAll('.ytds-step-label').forEach((n) => { n.textContent = step; });
    if (btnLoop) {
      btnLoop.classList.toggle('ytds-on', !!state.loop);
      const lab = btnLoop.querySelector('span');
      if (lab) lab.textContent = state.loop ? 'Повторюю' : 'Повторити';
    }
    for (const m of menus) m.sync();
    updateLabels();
    updateCounter();
    applyLayout();
    refresh();
  }

  function updateLabels() {
    if (!panel) return;
    const bSrc = panel.querySelector('.ytds-seg button[data-key="showEn"]');
    const bTr = panel.querySelector('.ytds-seg button[data-key="showUa"]');
    if (bSrc) bSrc.textContent = (srcLang || 'en').slice(0, 2).toUpperCase();
    if (bTr) bTr.textContent = state.targetLang.slice(0, 2).toUpperCase();
  }

  function updateCounter() {
    if (!elCounter) return;
    elCounter.textContent = sentences.length
      ? `Речення ${Math.min(sentIdx + 1, sentences.length)} / ${sentences.length}`
      : '';
  }

  function applyTheme() {
    if (!panel) return;
    panel.className = 'ytds-panel ytds-theme-' + state.theme + (drawerIsOpen() ? ' ytds-drawer-open' : '');
  }

  function applyLayout() {
    document.documentElement.style.setProperty('--font-scale', state.fontScale || 1);
  }

  // The subtitle scale is a 5-step ladder (XS…XL), not a free slider.
  function fontStepIdx() {
    const cur = state.fontScale || 1;
    let best = 0;
    for (let i = 1; i < FONT_STEPS.length; i++) {
      if (Math.abs(FONT_STEPS[i][1] - cur) < Math.abs(FONT_STEPS[best][1] - cur)) best = i;
    }
    return best;
  }

  function changeFont(delta) {
    state.fontScale = FONT_STEPS[clamp(fontStepIdx() + delta, 0, FONT_STEPS.length - 1)][1];
    saveState(); applyLayout(); syncUi();
  }

  // ---------- reader (study) mode ----------
  function enterReader() {
    ensurePanel();
    state.reader = true; saveState();
    closeDrawer();
    document.body.appendChild(panel);
    document.documentElement.classList.add('ytds-reader');
    if (panel.requestFullscreen) panel.requestFullscreen().catch(() => {});
    syncUi();
    armStudy();
  }

  function exitReader() {
    if (!state.reader && !document.documentElement.classList.contains('ytds-reader')) return;
    state.reader = false; saveState();
    stopAt = null; // let the video play normally again outside study mode
    clearTimeout(stopTimer); stopTimer = null;
    closeDrawer();
    document.documentElement.classList.remove('ytds-reader');
    if (document.fullscreenElement === panel) document.exitFullscreen().catch(() => {});
    if (panel && panel.parentElement) panel.parentElement.removeChild(panel);
    syncUi();
  }

  document.addEventListener('keydown', (e) => {
    if (!state.reader || e.altKey || e.ctrlKey || e.metaKey) return;
    const key = e.key;
    if (key === 'Escape') {
      e.stopPropagation();
      // Peel the layers one at a time: menu → drawer → reader.
      if (panel && panel.querySelector('.ytds-menu.ytds-open')) closeMenus();
      else if (drawerIsOpen()) closeDrawer();
      else exitReader();
      return;
    }
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      if (!sentences.length) return;
      e.preventDefault(); e.stopPropagation();
      playSentence(sentIdx + (key === 'ArrowRight' ? 1 : -1));
    } else if (key === 'r' || key === 'R' || key === 'к' || key === 'К') {
      e.preventDefault(); e.stopPropagation();
      setLoop(!state.loop);
    }
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
    btn.title = 'Study: dual subtitles (English + translation)';
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
