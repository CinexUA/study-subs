// Runs in the ISOLATED world.
// It stays out of YouTube's UI: it only adds one button to the player controls.
// Clicking it opens a full-screen study overlay with dual subtitles that reveal
// word by word, plus its own playback controls.
(() => {
  'use strict';

  const THROTTLE_KEY = 'ytdscap-throttle';   // when YouTube last told us to slow down
  const DEFAULTS = { showEn: true, showUa: true, targetLang: 'uk', theme: 'sepia', fontScale: 1, reader: false, speed: 1, study: true, focus: false };
  const LANGS = [
    ['uk', 'Ukrainian'], ['en', 'English'], ['pl', 'Polish'],
    ['de', 'German'], ['es', 'Spanish'], ['fr', 'French'],
    ['it', 'Italian'], ['ru', 'Russian']
  ];
  const THEMES = [['sepia', 'Sepia'], ['dark', 'Dark'], ['light', 'Light']];
  // Fine below 1×, where the listening actually happens; coarse above it.
  // 0.6/0.7/0.8/0.9 are off the player's own ladder, so they live on our
  // element write and the ratechange guard (see applySpeed).
  const SPEEDS = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.25, 1.5, 2];
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
    // Study mode only: shown instead of ▶ once a sentence has played out, where
    // pressing it means "this sentence again" rather than "carry on".
    // The one glyph not drawn on the shared 20×20 pencil: it is Vitaliy's own
    // reference shape (svgrepo "replay symbol"), kept on its native 30-unit
    // grid and merely recoloured — the silhouette is the spec here.
    // The path fills that grid edge to edge, while play/pause take ~55% of
    // theirs, so the viewBox is padded out to 48.3 (≈62%) — otherwise this
    // glyph sits noticeably larger than the rest of the transport.
    replay: '<svg viewBox="-9.18 -9.18 48.33 48.33" fill="none"><path fill="currentColor" d="' +
      'M29.133,9.215c-0.775-0.428-1.751-0.146-2.178,0.63l-0.518,0.937c-1.772-5.424-6.874-9.356-12.882-9.356' +
      'C6.081,1.426,0,7.507,0,14.981s6.081,13.555,13.555,13.555c0.886,0,1.604-0.718,1.604-1.603' +
      'c0-0.885-0.718-1.603-1.604-1.603c-5.706,0-10.349-4.643-10.349-10.35S7.849,4.632,13.555,4.632' +
      'c4.525,0,8.372,2.924,9.775,6.978l-0.876-0.483c-0.775-0.428-1.751-0.147-2.178,0.629' +
      'c-0.428,0.776-0.147,1.751,0.629,2.178l3.169,1.748c0.261,0.531,0.801,0.901,1.434,0.901' +
      'c0.16,0,0.311-0.031,0.456-0.074c0.009,0,0.016,0.003,0.025,0.003c0.565,0,1.112-0.298,1.406-0.829' +
      'l2.368-4.292C30.191,10.618,29.909,9.643,29.133,9.215z"/></svg>',
    rewind: S + '<path d="M9.4 5.6 5 10l4.4 4.4M16 5.6 11.6 10 16 14.4"/></svg>',
    forward: S + '<path d="M10.6 5.6 15 10l-4.4 4.4M4 5.6 8.4 10 4 14.4"/></svg>',
    repeat: S + '<path d="M4.6 9.4v-.8A2.8 2.8 0 0 1 7.4 5.8h6.3M11.7 3.6 14 5.8l-2.3 2.2M15.4 10.6v.8a2.8 2.8 0 0 1-2.8 2.8H6.3M8.3 16.4 6 14.2l2.3-2.2"/></svg>',
    chevL: S + '<path d="M12.4 5.2 7.4 10l5 4.8"/></svg>',
    chevR: S + '<path d="M7.6 5.2 12.6 10l-5 4.8"/></svg>',
    chevD: S + '<path d="M5.4 8 10 12.6 14.6 8"/></svg>',
    close: S + '<path d="M5.8 5.8 14.2 14.2M14.2 5.8 5.8 14.2"/></svg>',
    settings: S + '<path d="M3.6 6.6h2.1M10.4 6.6h6M3.6 13.4h6.9M15.1 13.4h1.3"/><circle cx="8.1" cy="6.6" r="2.3"/><circle cx="12.8" cy="13.4" r="2.3"/></svg>',
    check: S + '<path d="M4.8 10.5 8.2 13.9 15.2 6.5"/></svg>',
    study: S + '<path d="M4 15.4V6.1a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v9.3"/><path d="M4 15.4a2 2 0 0 1 2-1.9h10"/><path d="M10 4.1v9.4"/></svg>',
    console: S + '<rect x="3.2" y="4.4" width="13.6" height="11.2" rx="2.6"/><path d="M6.6 8.6 8.9 10.9l-2.3 2.3M11.2 13.2h3.1"/></svg>',
    // Focus mode toggle: the eye shows what the interface is doing, not what
    // the click will do — open while the controls are on screen, struck
    // through once they are hidden.
    eye: S + '<path d="M2.6 10S5.5 5.4 10 5.4s7.4 4.6 7.4 4.6-2.9 4.6-7.4 4.6S2.6 10 2.6 10Z"/><circle cx="10" cy="10" r="2.1"/></svg>',
    eyeOff: S + '<path d="M2.6 10S5.5 5.4 10 5.4s7.4 4.6 7.4 4.6-2.9 4.6-7.4 4.6S2.6 10 2.6 10Z"/><circle cx="10" cy="10" r="2.1"/><path d="M4.6 15.4 15.4 4.6"/></svg>'
  };

  let state = { ...DEFAULTS };
  let enLines = [];      // free-reading mode: captions grouped into lines
  let uaLines = [];
  let enUnitLen = 0, uaUnitLen = 0;
  let srcLang = '';
  let lastSig = null, lastCtl = '', lastIdx = -1, ticksDur = 0, ticksLen = -1;
  let lastPlayIcon = '';  // transport glyph currently in the DOM (play/pause/replay)
  let currentVideoId = null;
  let throttledUntil = 0;    // HTTP 429: when we may ask for a translation again
  let awaitingCapture = false;
  let captureTimer = null;
  let capturedBase = null, capturedBody = null, capturedTlang = '', capturedForVideo = null;
  let captureRetries = 0, sawTracks = false;
  let video = null;
  let panel, elStage, elZoneEn, elZoneUa, elNote, elStatus, elLog, elCounter, elHint;
  let btnStudy, btnFocus;
  let awakeTimer = null, hintTimer = null;
  let ptr = { x: 0, y: 0 };   // last known pointer position inside the panel
  let sleepPt = null;         // where it was when the interface hid
  let elControls, elPlay, elTime, elFill, elBuffer, elTicks, elBubble, elScrub, elKeys;
  const menus = [];   // value pickers (speed, language) that syncUi() refreshes
  let rafId = null;
  // Shadowing: sentence boundaries (from EN units), current sentence, and the
  // time at which playback should stop (null = free play).
  let sentences = [];    // EN sentences (drive playback timing + EN reveal)
  let uaSentences = [];  // translation sentences, index-aligned to `sentences`
  let sentIdx = 0;
  let stopAt = null;
  let sentenceDone = false;  // the current sentence played out and we stopped at its end
  let stopTimer = null;      // precise stop scheduled for the exact remaining time
  let suppressSeek = false;  // our own currentTime writes must not look like user seeks
  let pauseIntentAt = 0;     // when we last asked for a pause (resume guard)
  let pauseGuardNoted = false;   // the guard logs once per pause, not per frame
  let hookedVideo = null;    // the <video> we attached play/seek/rate listeners to

  // ---------- state ----------
  // A back-off started on a previous page load still counts.
  chrome.storage.local.get(THROTTLE_KEY, (r) => {
    const left = (r[THROTTLE_KEY] || 0) - Date.now();
    if (left > 0) { throttledUntil = performance.now() + left; dbg(`captions rate-limited, ${Math.ceil(left / 1000)}s to go`); }
  });

  chrome.storage.local.get('ytds', (r) => {
    if (r.ytds) state = { ...state, ...r.ytds };
    state.reader = false; // never start a page already in reader mode
    // A speed saved before the ladder changed (0.75×) would sit in the menu
    // with nothing ticked: snap it to the nearest step we now offer.
    if (!SPEEDS.some((v) => Math.abs(v - state.speed) < 0.001)) {
      state.speed = SPEEDS.reduce((a, b) => (Math.abs(b - state.speed) < Math.abs(a - state.speed) ? b : a));
    }
    document.documentElement.classList.remove('ytds-reader');
    ensurePanel();
    syncUi();
    // The saved state lands AFTER the first tick(), so the speed applied there
    // was still the default: without this the menu showed 0.5× while 1× played.
    applySpeed();
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
    if (elZoneEn) { elZoneEn.textContent = ''; elZoneUa.textContent = ''; }
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

  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  const RETRY_MS = 3000;      // one second chance after a 429: a burst can be bad luck
  const THROTTLE_MS = 60000;  // twice in a row is the quota talking — stop asking

  // Every attempt says what came back. The translation is the one track we
  // fetch ourselves — the original arrives inside the interception — so when
  // it comes back empty this is the only place that can tell whether the
  // server refused (HTTP), answered with nothing (the pot signature) or
  // answered with something we failed to parse.
  async function fetchUnits(baseUrl, tlang) {
    const left = throttledUntil - performance.now();
    if (tlang && left > 0) {
      dbg(`fetch ${tlang}: skipped — rate-limited, ${Math.ceil(left / 1000)}s to go`);
      return [];
    }
    const tl = tlang ? '&tlang=' + encodeURIComponent(tlang) : '';
    for (const fmt of ['&fmt=json3', '']) {
      const what = `${tlang || 'source'}${fmt ? ' json3' : ' no-fmt'}`;
      const ask = () => fetch(baseUrl + fmt + tl);
      let res;
      try {
        res = await ask();
        if (res.status === 429) {
          dbg(`fetch ${what}: HTTP 429 — waiting ${RETRY_MS / 1000}s and asking once more`);
          await delay(RETRY_MS);
          res = await ask();
        }
      } catch (e) {
        dbg(`fetch ${what}: network error — ${e.message}`);
        continue;
      }
      if (res.status === 429) {
        throttledUntil = performance.now() + THROTTLE_MS;
        // Survives a page reload on purpose: without it every Ctrl+Shift+R
        // spends two more requests on a quota that is already refusing us,
        // which is how a short cool-off turns into a long one.
        try { chrome.storage.local.set({ [THROTTLE_KEY]: Date.now() + THROTTLE_MS }); } catch (_) {}
        dbg(`fetch ${what}: HTTP 429 again — backing off for ${THROTTLE_MS / 1000}s`);
        return [];
      }
      // A refusal is about the request, not the format: asking again with a
      // different fmt only spends another slice of the same quota.
      if (!res.ok) { dbg(`fetch ${what}: HTTP ${res.status}`); return []; }
      const body = (await res.text()).trim();
      const units = body ? parseUnits(body) : [];
      dbg(`fetch ${what}: HTTP ${res.status}, ${body.length} bytes → ${units.length} units`);
      if (units.length) return units;
    }
    return [];
  }

  // ---------- translation cache ----------
  // Captions of a published video never change, so a translation is worth
  // keeping: a cached one costs no request at all, and requests are exactly
  // what ran us into HTTP 429. The source track is never cached — the player's
  // own interception hands us its body for free on every load.
  const CACHE_V = 1;          // bump if the shape of a unit ever changes
  const CACHE_KEEP = 10;      // tracks kept on disk (~5 videos, ~200 KB each)
  const CACHE_IDX = 'ytdscap-idx';
  const memCache = new Map(); // same, for this page's life: instant relanguaging
  const cacheKey = (lang) => `ytdscap:${CACHE_V}:${currentVideoId}:${lang}`;

  async function cachedUnits(lang) {
    const memo = memCache.get(cacheKey(lang));
    if (memo) return memo;
    try {
      const key = cacheKey(lang);
      const got = await chrome.storage.local.get(key);
      const units = got && got[key];
      if (units && units.length) { memCache.set(key, units); return units; }
    } catch (_) {}
    return null;
  }

  async function cacheUnits(lang, units) {
    const key = cacheKey(lang);
    memCache.set(key, units);
    try {
      const got = await chrome.storage.local.get(CACHE_IDX);
      const idx = [key, ...(got[CACHE_IDX] || []).filter((k) => k !== key)];
      const drop = idx.splice(CACHE_KEEP);   // oldest fall off the end
      await chrome.storage.local.set({ [key]: units, [CACHE_IDX]: idx });
      if (drop.length) await chrome.storage.local.remove(drop);
    } catch (e) {
      dbg('translation cache write failed: ' + e.message);
    }
  }

  async function translationUnits(base, lang) {
    const hit = await cachedUnits(lang);
    if (hit) { dbg(`translation ${lang}: from cache (${hit.length} units)`); return hit; }
    let units = [];
    try { units = await fetchUnits(base, lang); } catch (_) {}
    if (units.length) cacheUnits(lang, units);
    return units;
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

  // Free-reading mode groups words into readable lines: a line closes on a
  // sentence end once it is long enough, or when it gets too long / too slow.
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
      if ((endsSentence(buf) && buf.length >= minChars) || buf.length >= maxChars || (u.t - cur.start) >= maxDur) flush();
    }
    flush();
    return lines;
  }

  // The line playing at time t, and how many of its words are already spoken.
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

  // How long a caption unit plausibly sounds, guessed from its own text: json3
  // hands us the NEXT word's onset as this word's `end` whenever speech is
  // continuous, so on those words the parser end is not the end of speech at
  // all. Letters stand in for syllables well enough — "understanding" earns its
  // time, "is" does not. The 0.9 cap guards a single word claiming a huge
  // duration; a multi-word unit (a whole line, as coarse tracks give us) is
  // meant to be long, so it is capped only by the next unit's onset.
  const UNIT_LETTERS_RE = /[^\p{L}\p{N}']/gu;
  function estSpeechDur(text) {
    const s = String(text || '').trim();
    const d = 0.08 + 0.075 * s.replace(UNIT_LETTERS_RE, '').length;
    return /\s/.test(s) ? Math.max(d, 0.18) : clamp(d, 0.18, 0.9);
  }

  // Split word units into sentences (period/!/?/… ends one; a long silence
  // also breaks — ASR tracks may lack punctuation entirely). Each sentence
  // keeps its units (word-by-word reveal) plus two times:
  //   `end`  — the sentence's time WINDOW, used by the text side (translation
  //            alignment, reveal progress, pre-roll). Never move it: alignUaToEn
  //            leans on it to decide which words belong to the next sentence.
  //   `stop` — where playback pauses in study mode, trimmed so a guard of
  //            silence always sits between it and the next word's onset.
  // The two used to be one value, and that is exactly why the next sentence's
  // first syllable bled through on every sentence the author did not pause after.
  const SENT_TAIL = 0.12;   // let the last word ring out when there is room
  const SENT_GUARD = 0.2;   // silence we insist on before the next word's onset
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
      if (next) {
        // Trust the parser's end only when it stops SHORT of the next onset —
        // then it is a real recorded end (the author paused), and the sentence
        // keeps exactly the ending it has today. When it runs into the next
        // word, it is that word's onset wearing a disguise, and the unit's own
        // text is the better witness.
        const est = u.t + estSpeechDur(u.text);
        const ridesNext = u.end == null || u.end >= next.t - 0.05;
        // Trusted: today's value, except a multi-word unit may outlive the
        // single-word cap baked into spokenEnd — a whole line is meant to be long.
        const spoken = ridesNext ? Math.min(est, next.t) : Math.max(se, Math.min(u.end, est));
        cur.stop = Math.max(
          Math.min(spoken + (ridesNext ? SENT_TAIL : 0.2), next.t - SENT_GUARD),
          Math.min(u.t + 0.12, next.t - 0.06) // floor: the last unit gets to sound
        );
      } else {
        cur.stop = cur.end;
      }
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

  // The auto-stop leaves the playhead a hair short of the sentence end (the
  // clock keeps ticking between the pause and our correction seek). Without
  // this margin "resume" lands back in the sentence that just finished and
  // arms a stop 1 ms away, so playback dies the instant it starts.
  const SENT_EPS = 0.02;
  function findSentenceAt(t) {
    for (let i = 0; i < sentences.length; i++) if (t < sentences[i].stop - SENT_EPS) return i;
    return Math.max(0, sentences.length - 1);
  }

  // Playback stops at the end of a sentence only in study mode.
  function stopping() { return !!state.study; }

  // The player keeps its own idea of whether the video should be playing, and
  // when we drive the media element behind its back it puts playback back on a
  // moment later — a pause that "does not stick", and every sentence stop lost
  // with it. So each play/pause also states the wish to the page world, which
  // presses the player's own button (the path the Space key takes) whenever the
  // player disagrees. The element call stays first: it is synchronous, which
  // the stop needs.
  const wishPlay = (want) => window.postMessage({ type: 'YTDS_SET_PLAY', want }, '*');
  function playVideo() {
    if (!video) return;
    pauseIntentAt = 0;
    video.play().catch(() => {});
    wishPlay(true);
  }
  function pauseVideo() {
    if (!video) return;
    pauseIntentAt = performance.now();
    pauseGuardNoted = false;
    video.pause();
    wishPlay(false);
  }
  function seekBy(d) {
    if (!video || !video.duration) return;
    video.currentTime = clamp(video.currentTime + d, 0, video.duration);
  }

  // Last line of defence: if playback is on again within a blink of our pause,
  // nobody asked for it — hold the pause. The window is measured from the
  // original request and never extended, so this can fight the player for at
  // most 250 ms and can never trap a user who wants to resume.
  function guardPause() {
    if (!pauseIntentAt || !video || video.paused) return;
    if (performance.now() - pauseIntentAt > 250) { pauseIntentAt = 0; return; }
    if (!pauseGuardNoted) { pauseGuardNoted = true; dbg('playback resumed right after our pause — holding it'); }
    video.pause();
    wishPlay(false);
  }

  // Seek to just before a sentence's first word and play until its end.
  function playSentence(i) {
    if (!video || !sentences.length) return;
    sentIdx = clamp(i, 0, sentences.length - 1);
    const s = sentences[sentIdx];
    stopAt = stopping() ? s.stop : null;
    sentenceDone = false;
    const prevEnd = sentIdx > 0 ? sentences[sentIdx - 1].end : 0;
    // A touch early, so the first word's attack isn't clipped by the seek.
    const from = Math.min(Math.max(s.start - 0.15, prevEnd), s.start);
    try { video.currentTime = from; } catch (_) {}
    playVideo();
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
    pauseVideo();
    // The one place this is set: from here on ▶ means "play it again", not
    // "carry on into the next sentence".
    sentenceDone = true;
    const over = video.currentTime - stopAt;
    // Tells apart the two ways a stop can be late: a boundary placed too close
    // to the next word (fix that in buildSentences) or a timer that simply
    // fired behind schedule (fix that here).
    if (over > 0.05) dbg(`sentence stop overshot by ${Math.round(over * 1000)} ms`);
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
  function resync() {
    if (!state.reader || !sentences.length || !video) return;
    const i = findSentenceAt(video.currentTime || 0);
    if (i !== sentIdx) { sentIdx = i; lastSig = null; }
    stopAt = stopping() ? sentences[sentIdx].stop : null;
    sentenceDone = false;   // the playhead moved: nothing is waiting to be replayed
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
    stopAt = stopping() ? sentences[sentIdx].stop : null;
    sentenceDone = false;
    armStop();
    lastSig = null;
  }

  function setStudy(on) {
    state.study = on; saveState();
    if (on) armStudy();
    else { stopAt = null; sentenceDone = false; clearTimeout(stopTimer); stopTimer = null; } // free play again
    syncUi();
  }

  // Repeat is a plain action, not a mode: play this sentence once more.
  function repeatSentence() { playSentence(sentIdx); }

  // The rate belongs to the player exactly as playback state does: writing it
  // on the element alone held only until the next play, seek, ad or quality
  // change, when the player put its own back — "0.75× in the menu, 1× in the
  // ears". So the element is written first (the stop timer needs it now) and
  // the wish goes to the player too.
  function applySpeed() {
    const want = state.speed || 1;
    if (video) { try { video.playbackRate = want; } catch (_) {} }
    window.postMessage({ type: 'YTDS_SET_RATE', rate: want }, '*');
    armStop(); // the stop timer depends on the playback rate
  }

  // Last line of defence, the rate's answer to guardPause: whatever put another
  // rate on, ours goes back — but at most once every 400 ms, so a player that
  // insists cannot turn this into a loop. Only while the overlay is open: with
  // it closed the speed on YouTube is the user's own business, not ours.
  let rateFixAt = 0, rateFixNoted = false;
  const rateDrifted = () => !!video && Math.abs(video.playbackRate - (state.speed || 1)) > 0.01;
  function enforceRate() {
    const now = performance.now();
    if (now - rateFixAt < 400) return;
    rateFixAt = now;
    if (!rateFixNoted) {
      rateFixNoted = true;
      dbg(`playback rate came back as ${video.playbackRate}× — putting ${state.speed || 1}× back`);
    }
    applySpeed();
  }
  function onRateChange() {
    armStop();
    if (state.reader && rateDrifted()) enforceRate();
  }

  function updateStatus() {
    const uaNote = (state.targetLang !== srcLang && !uaUnitLen) ? ' · translation unavailable' : '';
    const srcU = (srcLang || 'en').toUpperCase();
    setStatus(`source: ${srcLang || '?'} · ${srcU} ${enUnitLen} words · ${state.targetLang.toUpperCase()} ${uaUnitLen} words · ${enLines.length} lines · ${sentences.length} sentences${uaNote}`);
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
    // The interception already handed us this body. Fetching the same half
    // megabyte again on every load is what spent our quota — so the network is
    // the fallback here, not the first move.
    if (!capTlang && body) enUnits = parseUnits(body);
    if (!enUnits.length) {
      try { enUnits = await fetchUnits(base, null); } catch (e) { dbg('EN fetch failed: ' + e.message); }
    }
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
      if (uaUnits.length) cacheUnits(state.targetLang, uaUnits);
      else uaUnits = await translationUnits(base, state.targetLang);
    } else {
      uaUnits = await translationUnits(base, state.targetLang);
    }
    if (!sameLang) uaUnits = splitUnitsByPunct(uaUnits);
    if (!sameLang && !uaUnits.length) {
      showHint(throttledUntil > performance.now()
        ? 'YouTube is rate-limiting caption requests — the translation will come back in a few minutes'
        : 'Translation did not load — pick the language again', 4500);
    }

    enLines = groupUnitsToLines(enUnits);
    uaLines = sameLang ? enLines : groupUnitsToLines(uaUnits);
    sentences = buildSentences(enUnits);
    uaSentences = sameLang ? sentences : alignUaToEn(uaUnits, sentences);
    sentIdx = 0; stopAt = null; sentenceDone = false;
    enUnitLen = enUnits.length; uaUnitLen = uaUnits.length;
    lastSig = null; lastIdx = -1;
    dbg(`ready: EN ${enUnits.length} words / ${enLines.length} lines · ${sentences.length} sentences · ${state.targetLang.toUpperCase()} ${uaUnits.length} words`);
    updateStatus();
    renderKeys();   // study mode only owns the keys once there are sentences
    if (state.reader && state.study) armStudy();
    return true;
  }

  async function loadCaptions() {
    enLines = []; uaLines = []; srcLang = ''; enUnitLen = uaUnitLen = 0;
    sentences = []; uaSentences = []; sentIdx = 0; stopAt = null; sentenceDone = false;
    clearTimeout(stopTimer); stopTimer = null;
    awaitingCapture = false;
    captureRetries = 0; sawTracks = false;
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
      sawTracks = true;
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
      if (!awaitingCapture || enLines.length) return;
      awaitingCapture = false;
      window.postMessage({ type: 'YTDS_STOP_ENABLE' }, '*');
      if (sawTracks) {
        dbg('gave up: the player never returned usable captions for this track');
        setStatus('the player returned no captions — switch CC off and on in the player, or reload the page');
      } else {
        dbg('gave up: no caption tracks at all — the video likely has none');
        setStatus('this video has no YouTube captions');
      }
    }, 25000);
  }

  async function handleCaptured(url, body) {
    if (enLines.length) return;
    const base = reuseBase(url);
    const capTlang = (/[?&]tlang=([^&]*)/.exec(url) || [])[1] || '';

    capturedBase = base; capturedBody = body; capturedTlang = capTlang; capturedForVideo = currentVideoId;

    if (!(await buildFromBase(base, body, capTlang))) {
      dbg(`capture had no usable EN (body=${(body || '').length} bytes) — retrying the same URL`);
      scheduleCaptureRetry();
      return;
    }
    captureDone();
  }

  function captureDone() {
    awaitingCapture = false;
    captureRetries = 0;
    clearTimeout(captureTimer);
    window.postMessage({ type: 'YTDS_STOP_ENABLE' }, '*');
  }

  // The player sometimes answers its own first request with a body we cannot
  // use: a stale translation (`tlang=ru` when nothing on screen says so), or
  // nothing at all — an invalid/missing `pot` returns HTTP 200 with 0 bytes.
  // Dropping the translation and asking again fixes the first case; the second
  // one never recovers on this url, and the CC off→on toggle in injected.js
  // (which makes the player mint a new one) is what saves us there.
  function scheduleCaptureRetry() {
    if (!capturedBase || captureRetries >= 4) return;
    const attempt = ++captureRetries;
    setTimeout(async () => {
      if (enLines.length || capturedForVideo !== currentVideoId) return;
      dbg(`retry #${attempt} on the captured URL`);
      if (await buildFromBase(capturedBase, null, '')) captureDone();
      else scheduleCaptureRetry();
    }, 1500 * attempt);
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data) return;
    if (e.data.type === 'YTDS_LOG') {
      dbg(e.data.msg);
    } else if (e.data.type === 'YTDS_TT') {
      const tl = /[?&]tlang=([^&]*)/.exec(e.data.url);
      const pot = /[?&]pot=/.test(e.data.url) ? 'yes' : 'NO';
      dbg(`intercepted timedtext (tlang=${tl ? tl[1] : '-'}, pot=${pot}, body=${(e.data.body || '').length} bytes)`);
      handleCaptured(e.data.url, e.data.body);
    }
  });

  // ---------- render loop (only while reading) ----------
  function loop() {
    rafId = requestAnimationFrame(loop);
    if (!state.reader) return;
    updateControls();
    guardPause();
    // The precise stop timer does the real work; this is a backup.
    if (stopAt != null && video && !video.paused && video.currentTime >= stopAt) hitStop();
    if (!video || (!sentences.length && !enLines.length)) { showPlaceholder(); return; }
    const t = video.currentTime;

    // Study mode: one sentence at a time, EN and the translation index-aligned,
    // so the next sentence's words can never bleed across the two tracks.
    if (state.study && sentences.length) {
      // Playing with no stop armed = playback started behind our back (Space,
      // YouTube's own controls, autoplay right after our stop). Study mode must
      // not quietly switch itself off: take the sentence the audio is in and
      // arm its end again. resync() does both, and once stopAt is set this
      // costs nothing on the following frames.
      if (!video.paused && stopAt == null) resync();
      const enS = sentences[sentIdx];
      const uaS = uaSentences[sentIdx];
      const enN = revealCount(enS, t);
      const uaN = uaRevealCount(enS, uaS, t);
      const sig = `S${sentIdx}:${enN}:${uaN}:${state.showEn ? 1 : 0}${state.showUa ? 1 : 0}`;
      if (sig === lastSig) return;
      const fresh = sentIdx !== lastIdx;
      lastSig = sig; lastIdx = sentIdx;
      renderStudy(enS, uaS, enN, uaN, fresh);
      if (fresh) updateCounter();
      return;
    }

    // Free reading: the rolling transcript — previous line dimmed above the
    // current one, which fills in word by word.
    const en = pickLine(enLines, t);
    const ua = pickLine(uaLines, t);
    const sig = `${en.idx}:${en.n}|${ua.idx}:${ua.n}|${state.showEn ? 1 : 0}${state.showUa ? 1 : 0}`;
    if (sig === lastSig) return;
    const fresh = en.idx !== lastIdx;
    lastSig = sig; lastIdx = en.idx;
    renderLines(en, ua, fresh);
    // Keep the counter (and the sentence the shadowing row would resume from)
    // honest even while we are not driving playback.
    if (fresh && sentences.length) { sentIdx = findSentenceAt(t); updateCounter(); }
  }

  // How many EN words of a sentence should be visible at time t.
  function revealCount(s, t) {
    if (!s) return 0;
    let n = 0;
    for (const u of s.units) { if (u.t <= t + LEAD) n++; else break; }
    return Math.max(1, n);
  }

  // Translation reveal follows the EN sentence's PROGRESS (not UA timestamps),
  // so it stays in step and shows fully exactly when playback stops — hence
  // `stop`, not `end`: measured against the window, the last word of the
  // translation would still be missing at the moment the sentence pauses.
  function uaRevealCount(enS, uaS, t) {
    if (!enS || !uaS) return 0;
    const span = ((enS.stop != null ? enS.stop : enS.end) - enS.start) || 1;
    const p = clamp((t - enS.start) / span, 0, 1);
    return Math.max(1, Math.ceil(p * uaS.units.length));
  }

  // Two fixed zones split by the hairline: EN sits just ABOVE it (grows
  // upward, its baseline never moves), the translation just below.
  function renderStudy(enS, uaS, enN, uaN, fresh) {
    if (!elZoneEn) return;
    hideNote();
    paint(elZoneEn, 'ytds-en', state.showEn && enS ? [{ text: joinUnits(enS.units.slice(0, enN)), fresh }] : []);
    paint(elZoneUa, 'ytds-ua', state.showUa && uaS ? [{ text: joinUnits(uaS.units.slice(0, uaN)), fresh }] : []);
  }

  function renderLines(en, ua, fresh) {
    if (!elZoneEn) return;
    hideNote();
    paint(elZoneEn, 'ytds-en', state.showEn ? lineItems(enLines, en, fresh) : []);
    paint(elZoneUa, 'ytds-ua', state.showUa ? lineItems(uaLines, ua, fresh) : []);
  }

  // The previous line (dimmed) plus the current one, revealed word by word.
  function lineItems(lines, sel, fresh) {
    if (sel.idx < 0) return [];
    const items = [];
    if (sel.idx > 0) items.push({ text: lines[sel.idx - 1].full, dim: true });
    items.push({ text: joinUnits(lines[sel.idx].units.slice(0, sel.n)), fresh });
    return items;
  }

  // `fresh` only on a new line/sentence: the node is rebuilt on every word, so
  // carrying the class over would replay the entrance animation each time.
  function paint(zone, cls, items) {
    zone.textContent = '';
    for (const it of items) {
      const block = el('div', 'ytds-block' + (it.dim ? '' : ' ytds-active') + (it.fresh ? ' ytds-fresh' : ''));
      block.appendChild(el('span', 'ytds-line ' + cls, it.text));
      zone.appendChild(block);
    }
  }

  function hideNote() { if (elNote && elNote.style.display !== 'none') elNote.style.display = 'none'; }

  // Shown in reader when there are no captions yet: surfaces the status/error.
  function showPlaceholder() {
    if (!elNote) return;
    const msg = (elStatus && elStatus.textContent) || 'loading captions…';
    if (elNote.style.display !== 'none' && elNote.textContent === msg) return;
    if (elZoneEn) { elZoneEn.textContent = ''; elZoneUa.textContent = ''; }
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
    const sig = `${cur.toFixed(1)}|${video.paused ? 0 : 1}|${sentenceDone ? 1 : 0}|${Math.floor(dur)}`;
    if (sig === lastCtl) return;
    lastCtl = sig;
    // The glyph is the only place the third state is visible: after an auto-stop
    // ▶ would silently mean something else, so it stops looking like ▶.
    if (elPlay) {
      const name = video.paused ? (sentenceDone ? 'replay' : 'play') : 'pause';
      if (name !== lastPlayIcon) {
        lastPlayIcon = name;
        setIcon(elPlay, name);
        elPlay.title = name === 'pause' ? 'Pause' : name === 'replay' ? 'Replay sentence (R)' : 'Play';
      }
    }
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
    b.addEventListener('click', (e) => {
      // A clicked button keeps focus, and Space then re-presses it — on top of
      // YouTube's own Space handler. That makes every later Space toggle
      // playback twice and look like our controls are fighting the player.
      b.blur();
      onClick(e);
    });
    return b;
  }
  function txt(s) { return document.createTextNode(s); }

  function toggleKey(key) { state[key] = !state[key]; saveState(); syncUi(); }

  // A− / step / A+ tray in the top bar.
  function mkFontSeg() {
    const seg = el('div', 'ytds-seg');
    seg.append(
      mkBtn('ytds-step', 'Smaller text', () => changeFont(-1), txt('A')),
      el('span', 'ytds-step-label'),
      mkBtn('ytds-step ytds-step-lg', 'Larger text', () => changeFont(1), txt('A'))
    );
    return seg;
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
    // Focus mode hides the chrome until the mouse says otherwise. The listener
    // is on the panel and never swallows the event, so nothing else that
    // watches for pointer movement is affected.
    panel.addEventListener('mousemove', (e) => { ptr = { x: e.clientX, y: e.clientY }; wake(e); });
    panel.addEventListener('click', wake);
    elHint = el('div', 'ytds-hint');
    panel.append(buildTop(), buildStage(), buildStudyRow(), buildControls(), buildDrawer(), elHint);
    syncUi();
    return true;
  }

  function buildTop() {
    const segLang = el('div', 'ytds-seg');
    const bEn = mkBtn('', 'Show the original line', () => toggleKey('showEn'), txt('EN'));
    bEn.dataset.key = 'showEn';
    // Both chip labels follow the real languages (updateLabels), so the second
    // one never claims "UK" while the menu next to it says German.
    const bUa = mkBtn('', 'Show the translation line', () => toggleKey('showUa'), txt('UK'));
    bUa.dataset.key = 'showUa';
    segLang.append(bEn, bUa);

    btnStudy = mkBtn('ytds-pill ytds-pill-text', 'Study mode: one sentence at a time, stops at each period',
      () => setStudy(!state.study), icon('study'), el('span', null, 'Study'));
    btnStudy.dataset.key = 'study';

    const left = el('div', 'ytds-top-side');
    left.append(segLang, mkLangMenu(), mkFontSeg(), btnStudy);

    elCounter = el('div', 'ytds-counter');

    btnFocus = mkBtn('ytds-icon ytds-focus-btn', 'Focus mode: hide everything but the text (move the mouse to bring it back)',
      () => { toggleKey('focus'); if (state.focus) showHint('Move the mouse to bring the controls back'); }, icon('eye'));
    btnFocus.dataset.key = 'focus';

    const right = el('div', 'ytds-top-side ytds-right');
    right.append(
      buildSwatches(),
      btnFocus,
      mkBtn('ytds-icon ytds-gear', 'Settings', openDrawer, icon('settings')),
      mkBtn('ytds-icon', 'Exit (Esc)', exitReader, icon('close'))
    );

    const top = el('div', 'ytds-top');
    top.append(left, elCounter, right);
    return top;
  }

  function buildStage() {
    elZoneEn = el('div', 'ytds-zone ytds-zone-en');
    elZoneUa = el('div', 'ytds-zone ytds-zone-ua');
    elNote = el('div', 'ytds-note');
    elNote.style.display = 'none';

    elStage = el('div', 'ytds-stage');
    elStage.append(elZoneEn, el('div', 'ytds-rule'), elZoneUa, elNote);
    return elStage;
  }

  // Shadowing row: previous / repeat / next sentence. Repeat is the hero.
  function buildStudyRow() {
    const tray = el('div', 'ytds-study-tray');
    tray.append(
      mkBtn('ytds-sbtn ytds-prev', 'Previous sentence (←)', () => playSentence(sentIdx - 1), icon('chevL'), el('span', null, 'Previous')),
      mkBtn('ytds-sbtn ytds-primary', 'Repeat this sentence (R)', repeatSentence, icon('repeat'), el('span', null, 'Repeat')),
      mkBtn('ytds-sbtn ytds-next', 'Next sentence (→)', () => playSentence(sentIdx + 1), el('span', null, 'Next'), icon('chevR'))
    );
    const row = el('div', 'ytds-study-row');
    row.appendChild(tray);
    return row;
  }

  function buildControls() {
    elPlay = mkBtn('ytds-icon ytds-play', 'Play', togglePlay, icon('play'));
    lastPlayIcon = 'play';   // a rebuilt panel starts from a known glyph
    elTime = el('div', 'ytds-time', '0:00 / 0:00');

    elControls = el('div', 'ytds-controls');
    elControls.append(
      mkBtn('ytds-icon', 'Back 10s', () => seekBy(-10), icon('rewind')),
      elPlay,
      mkBtn('ytds-icon', 'Forward 10s', () => seekBy(10), icon('forward')),
      mkSpeedMenu(),
      elTime,
      buildScrub()
    );
    return elControls;
  }

  function mkSpeedMenu() {
    return mkMenu({
      title: 'Playback speed',
      items: SPEEDS.map((v) => [v, v + '×']),
      get: () => state.speed || 1,
      label: (v) => v + '×',
      pick: (v) => { state.speed = v; saveState(); rateFixNoted = false; applySpeed(); }
    });
  }

  function mkLangMenu() {
    return mkMenu({
      title: 'Translate into',
      below: true, text: true,
      items: LANGS,
      get: () => state.targetLang,
      label: (v) => (LANGS.find((l) => l[0] === v) || [v, v])[1],
      pick: (v) => { state.targetLang = v; saveState(); loadCaptions(); }
    });
  }

  // Three states, not two — a plain toggle cannot tell "I paused in the middle
  // of a sentence" from "the sentence played out", and those want opposite
  // things from ▶. The player owns neither distinction, so the intent lives
  // here and only the execution goes through the player (see wishPlay).
  function togglePlay() {
    if (!video) return;
    if (!state.study || !sentences.length) {   // free reading: plain play/pause
      video.paused ? playVideo() : pauseVideo();
      return;
    }
    if (!video.paused) { pauseVideo(); return; }
    if (sentenceDone) playSentence(sentIdx);   // played out → this sentence again
    else { playVideo(); armStop(); }           // paused mid-sentence → carry on
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
    head.append(el('span', null, 'Settings'), mkBtn('', 'Close', closeDrawer, icon('close')));

    const group = (title, iconName) => {
      const g = el('div', 'ytds-group-title');
      if (iconName) g.appendChild(icon(iconName));
      g.appendChild(txt(title));
      return g;
    };

    elStatus = el('div', 'ytds-status');
    elLog = el('div', 'ytds-log');

    // Everything that has a control on the main screen — the two lines, the
    // language, size, speed, study mode, the theme — is deliberately NOT
    // duplicated here. What is left is what you never touch while watching.
    const body = el('div', 'ytds-drawer-body');
    body.append(
      group('Advanced', 'console'),
      elStatus,
      elLog,
      mkBtn('ytds-text-btn', '', () => {
        navigator.clipboard.writeText(elLog.textContent || '').catch(() => {});
      }, txt('Copy log'))
    );

    elKeys = el('div', 'ytds-keys');
    renderKeys();

    const drawer = el('aside', 'ytds-drawer');
    drawer.append(head, body, elKeys);

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
  // The same keys mean different things in the two modes: study mode claims
  // Space, R and the arrows, while free reading hands Space and R back to the
  // player and keeps only the ±5 s seek. One fixed list would therefore be a
  // lie half the time, so the hints follow the mode. Same condition the key
  // handler uses — without sentences there is nothing for study mode to claim.
  function renderKeys() {
    if (!elKeys) return;
    const study = !!state.study && sentences.length > 0;
    elKeys.textContent = '';
    elKeys.appendChild(el('span', 'ytds-keys-mode', study ? 'Study' : 'Free'));
    const rows = study
      ? [['Space', 'play / pause'], ['R', 'repeat'], ['←→', 'sentence'], ['Esc', 'exit']]
      : [['←→', 'seek 5 s'], ['Esc', 'exit'], ['Space R', 'player']];
    for (const [k, t] of rows) {
      const s = el('span');
      s.append(el('b', null, k), txt(' ' + t));
      elKeys.appendChild(s);
    }
  }

  function syncUi() {
    if (!panel) return;
    applyTheme();   // also carries the study/drawer state classes
    panel.querySelectorAll('[data-key]').forEach((b) => b.classList.toggle('ytds-on', !!state[b.dataset.key]));
    panel.querySelectorAll('.ytds-swatch').forEach((b) => b.classList.toggle('ytds-on', b.dataset.theme === state.theme));
    const step = FONT_STEPS[fontStepIdx()][0];
    panel.querySelectorAll('.ytds-step-label').forEach((n) => { n.textContent = step; });
    for (const m of menus) m.sync();
    if (btnFocus) setIcon(btnFocus, state.focus ? 'eyeOff' : 'eye');
    renderKeys();
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
      ? `Sentence ${Math.min(sentIdx + 1, sentences.length)} / ${sentences.length}`
      : '';
  }

  function applyTheme() {
    if (!panel) return;
    const awake = panel.classList.contains('ytds-awake');
    panel.className = 'ytds-panel ytds-theme-' + state.theme
      + (state.study ? ' ytds-study' : '')
      + (state.focus ? ' ytds-focus' : '')
      + (awake ? ' ytds-awake' : '')
      + (drawerIsOpen() ? ' ytds-drawer-open' : '');
  }

  // Focus mode: the bar, the shadowing row and the transport fade out, leaving
  // the text alone on the screen — and the cursor with them. Any mouse move
  // brings them back for a breath. They keep their space while hidden (opacity,
  // not display): the reading line must not jump every time the chrome returns.
  const AWAKE_MS = 2500;
  // A hand resting on the mouse still sends events — sub-pixel jitter, a knock
  // on the desk. Waking on any of them meant the interface came back on its own
  // a blink after it hid, which read as "the button does nothing". So the
  // pointer has to actually TRAVEL this far from where it was when we hid.
  const WAKE_PX = 16;
  function wake(e) {
    if (!panel || !state.focus) return;
    // The click that switches focus on is a request to hide NOW, not a sign of
    // life: it bubbles up here, and without this it woke what it just hid.
    // Only the click itself — moving across the eye must never hide the
    // controls out from under the cursor that came to press it.
    if (e && e.type === 'click' && e.target.closest && e.target.closest('.ytds-focus-btn')) { sleep(); return; }
    if (sleepPt && Math.hypot(ptr.x - sleepPt.x, ptr.y - sleepPt.y) < WAKE_PX) return;
    sleepPt = null;
    panel.classList.add('ytds-awake');
    clearTimeout(awakeTimer);
    awakeTimer = setTimeout(sleep, AWAKE_MS);
  }
  function sleep() {
    clearTimeout(awakeTimer); awakeTimer = null;
    if (!panel) return;
    // An open menu or drawer would vanish from under the cursor; wait it out.
    if (drawerIsOpen() || panel.querySelector('.ytds-menu.ytds-open')) {
      awakeTimer = setTimeout(sleep, AWAKE_MS);
      return;
    }
    sleepPt = { x: ptr.x, y: ptr.y };
    panel.classList.remove('ytds-awake');
  }

  // A line that says itself and leaves. Used where silence would read as a
  // bug: focus mode hiding the whole interface (and the way back with it), or
  // a translation that never arrived.
  function showHint(msg, ms = 2200) {
    if (!elHint) return;
    elHint.textContent = msg;
    elHint.classList.add('ytds-hint-on');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => elHint.classList.remove('ytds-hint-on'), ms);
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
    wake();         // never greet an empty screen: focus mode fades in a moment
    applySpeed();   // from here on the speed in the transport row is the law
    armStudy();
  }

  function exitReader() {
    if (!state.reader && !document.documentElement.classList.contains('ytds-reader')) return;
    state.reader = false; saveState();
    stopAt = null; // let the video play normally again outside study mode
    sentenceDone = false;
    clearTimeout(stopTimer); stopTimer = null;
    closeDrawer();
    document.documentElement.classList.remove('ytds-reader');
    if (document.fullscreenElement === panel) document.exitFullscreen().catch(() => {});
    if (panel && panel.parentElement) panel.parentElement.removeChild(panel);
    syncUi();
  }

  // On `window`, not `document`: YouTube's own hotkey handler sits on document,
  // and being first to register it would otherwise run before ours — Space then
  // toggled playback twice (play, then instantly pause). The window is the first
  // node of the capture phase, so stopping the event here means YouTube never
  // sees the keys study mode has claimed.
  window.addEventListener('keydown', (e) => {
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
    // Study mode owns the transport keys; with it off they belong to the player
    // — except the arrows, which the player cannot hear under our fullscreen,
    // so we do its own ±5 s ourselves.
    const study = state.study && sentences.length;
    const claim = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      claim();
      const fwd = key === 'ArrowRight';
      if (study) playSentence(sentIdx + (fwd ? 1 : -1));
      else seekBy(fwd ? 5 : -5);
    } else if (e.code === 'Space') {
      if (!study) return;   // free reading: the player's own key, untouched
      claim();
      togglePlay();
    } else if (e.code === 'KeyR') {   // by physical key: layout-independent
      if (!study) return;
      claim();
      repeatSentence();
    }
  }, true);

  // The player also acts on keyup for Space. Swallowing it costs nothing and
  // closes the last door through which one press could reach playback twice.
  window.addEventListener('keyup', (e) => {
    if (!state.reader || !state.study || !sentences.length) return;
    if (e.code !== 'Space' || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault(); e.stopImmediatePropagation();
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
      video.addEventListener('ratechange', onRateChange);
      video.addEventListener('seeked', onSeeked);
      applySpeed(); // a fresh element starts at 1×, whatever the menu says
    }
    ensurePanel();
    ensureLaunchButton();
    const id = new URLSearchParams(location.search).get('v');
    if (id && id !== currentVideoId) {
      currentVideoId = id;
      applySpeed(); // playbackRate resets on each new video
      loadCaptions();
    }
    // The player takes the rate back at moments that do not always announce
    // themselves with a ratechange event (a swapped element, an ad, a quality
    // switch). One comparison a second, and only while the overlay is open.
    if (state.reader && rateDrifted()) enforceRate();
  }

  document.addEventListener('yt-navigate-finish', tick);
  setInterval(tick, 1000);
  tick();
  if (!rafId) loop();
})();
