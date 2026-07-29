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
    eyeOff: S + '<path d="M2.6 10S5.5 5.4 10 5.4s7.4 4.6 7.4 4.6-2.9 4.6-7.4 4.6S2.6 10 2.6 10Z"/><circle cx="10" cy="10" r="2.1"/><path d="M4.6 15.4 15.4 4.6"/></svg>',
    // The place we kept for you: shown on the button that returns to it.
    bookmark: S + '<path d="M5.6 3.6h8.8v12.8L10 12.9l-4.4 3.5Z"/></svg>'
  };

  let state = { ...DEFAULTS };
  let enLines = [];      // free-reading mode: captions grouped into lines
  let uaLines = [];
  // "We have usable captions for this video." It used to be read off
  // enLines.length, which tied the caption-loading path to a structure that
  // only free reading renders — touch that mode and the loader changes meaning.
  let captionsReady = false;
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
  let awakeTimer = null, hintTimer = null, copyTimer = null, reloadTimer = null;
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

  // Where study stopped last time, per video. The playback position YouTube
  // restores drifts and sometimes falls back to zero, and a sentence is the
  // unit learning actually stops on.
  const MARKS_KEY = 'ytdsmarks';
  const MARKS_KEEP = 200;    // ~50 bytes each: nothing beside the caption cache
  let marks = {};            // videoId -> { t, at }
  let offeredFor = null;     // the video whose card we have already shown
  let markMoved = false;     // study actually stopped on this video this session
  let elResume = null, elResumeText = null, elResumeAgo = null, elResumeGo = null, elMark = null;

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

  // Marks live in their own key: `ytds` is rewritten whole on every theme or
  // speed click, and a map that grows has no business riding along with it —
  // nor should a sentence stop rewrite the settings.
  chrome.storage.local.get(MARKS_KEY, (r) => {
    const got = r[MARKS_KEY];
    if (!got || typeof got !== 'object') return;
    for (const [id, m] of Object.entries(got)) {
      if (m && typeof m.t === 'number') marks[id] = { t: m.t, at: m.at || 0 };
    }
    // The captions may already be up by the time this lands.
    offerResume();
  });

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
      // Same story one step further in: HTTP 200 with an empty body is the
      // token talking, not the format. A stale or missing `pot` answers exactly
      // like this, that url stays empty forever, and the second fmt would spend
      // one more request to hear the same silence.
      if (!body) { dbg(`fetch ${what}: HTTP ${res.status}, 0 bytes — stale token, not the format`); return []; }
      const units = parseUnits(body);
      dbg(`fetch ${what}: HTTP ${res.status}, ${body.length} bytes → ${units.length} units`);
      if (units.length) return units;
    }
    return [];
  }

  // ---------- caption cache ----------
  // Captions of a published video never change, so both tracks are worth
  // keeping. A cached pair costs no request at all, waits for no interception
  // and never touches `pot` — the most fragile thing here. Requests are also
  // exactly what ran us into HTTP 429.
  const CACHE_V = 2;          // bump if the shape of a record ever changes
  const CACHE_KEEP = 20;      // tracks kept on disk (~10 videos, ~300 KB each)
  const CACHE_IDX = 'ytdscap-idx';
  const CACHE_PREFIX = `ytdscap:${CACHE_V}:`;
  const memCache = new Map(); // same, for this page's life: instant relanguaging
  // The source track lives under the literal `src`: its language is exactly
  // what we do not know before the record is read, so it travels inside the
  // record instead of in the key. The translation keeps the same shape.
  const cacheKey = (slot) => `${CACHE_PREFIX}${currentVideoId}:${slot}`;

  // Whatever leaves the disk leaves this page's memory with it — otherwise the
  // Map grows for the whole session (a dozen videos is a few MB of units).
  const forget = (keys) => { for (const k of keys) memCache.delete(k); };

  async function cachedTrack(slot) {
    const key = cacheKey(slot);
    const memo = memCache.get(key);
    if (memo) return memo;
    try {
      const got = await chrome.storage.local.get(key);
      const rec = got && got[key];
      if (rec && rec.units && rec.units.length) { memCache.set(key, rec); return rec; }
    } catch (_) {}
    return null;
  }

  async function cacheTrack(slot, lang, units) {
    const key = cacheKey(slot);
    const rec = { lang, units };
    memCache.set(key, rec);
    try {
      const was = (await chrome.storage.local.get(CACHE_IDX))[CACHE_IDX] || [];
      // Keys of an older CACHE_V can no longer be read, so the first write
      // after an upgrade is what sweeps them off the disk.
      const stale = was.filter((k) => k.indexOf(CACHE_PREFIX) !== 0);
      const idx = [key, ...was.filter((k) => k !== key && k.indexOf(CACHE_PREFIX) === 0)];
      const drop = [...stale, ...idx.splice(CACHE_KEEP)];   // oldest fall off the end
      await writeCache(key, rec, idx, drop);
    } catch (e) {
      dbg('caption cache write failed: ' + e.message);
    }
  }

  // Eviction counts records, not bytes, so a set of unusually large tracks can
  // still meet the 10 MB quota — and then the cache would stay broken forever,
  // because nothing else ever shrinks it. Halve the index and try once more.
  // Remove first, publish the index second. The other order orphans keys the
  // moment a remove fails: gone from the index, still on disk, never read and
  // never evicted again — quota spent on names nobody can see. This way a
  // failure leaves dead names in the index instead, which costs nothing:
  // cachedTrack answers null for them and the next write filters them out.
  async function writeCache(key, rec, idx, drop) {
    forget(drop);
    try {
      if (drop.length) await chrome.storage.local.remove(drop);
      await chrome.storage.local.set({ [key]: rec, [CACHE_IDX]: idx });
    } catch (e) {
      const half = idx.splice(Math.max(1, idx.length >> 1));
      dbg(`cache write failed, shrinking to ${idx.length} tracks and retrying — ${e.message}`);
      forget(half);
      await chrome.storage.local.remove([...drop, ...half]);
      await chrome.storage.local.set({ [key]: rec, [CACHE_IDX]: idx });
    }
  }

  // A cache that holds a broken track holds it forever: with one on disk a
  // reload no longer reaches the network. So the gate is strict — and being
  // wrong costs only a cache miss, which is exactly today's behaviour.
  const COVER_MIN = 0.4;
  function cacheReject(units, json3) {
    if (units.length < 2) return 'too few units';
    // The XML fallback parses a truncated body partially and without a word
    // about it; a truncated json3 fails JSON.parse and never gets this far.
    if (!json3) return 'XML fallback';
    const dur = video && video.duration;
    // Covers a live stream (the track is still growing, and freezing it would
    // be a lie) and the rare load where metadata has not landed yet.
    if (!dur || !isFinite(dur)) return 'video length unknown';
    const last = units[units.length - 1].t;
    if (last < dur * COVER_MIN) return `covers ${Math.round((last / dur) * 100)}% of the video`;
    return '';
  }

  // The escape hatch a cache takes away: with one on disk Ctrl+Shift+R no
  // longer reaches the network, so a track that cached badly would stay.
  async function purgeVideoCache() {
    const mine = (k) => k.indexOf(`${CACHE_PREFIX}${currentVideoId}:`) === 0;
    forget([...memCache.keys()].filter(mine));
    try {
      const was = (await chrome.storage.local.get(CACHE_IDX))[CACHE_IDX] || [];
      const drop = was.filter(mine);
      if (drop.length) await chrome.storage.local.remove(drop);   // same order as writeCache
      await chrome.storage.local.set({ [CACHE_IDX]: was.filter((k) => !mine(k)) });
    } catch (e) { dbg('cache clear failed: ' + e.message); }
    dbg('captions cache cleared for this video');
  }

  async function translationUnits(base, lang) {
    const hit = await cachedTrack(lang);
    if (hit) { dbg(`translation ${lang}: from cache (${hit.units.length} units)`); return hit.units; }
    let units = [];
    try { units = await fetchUnits(base, lang); } catch (_) {}
    if (units.length) keepTrack(lang, lang, units, `translation ${lang}`);
    return units;
  }

  // One place decides whether a freshly parsed track earns a slot, and says so.
  function keepTrack(slot, lang, units, what) {
    // Already ours this page: a language change re-parses the same source and
    // would otherwise rewrite an identical few hundred KB on every switch.
    if (memCache.has(cacheKey(slot))) return;
    const why = cacheReject(units, lastParseJson3);
    if (why) { dbg(`${what} not cached: ${why}`); return; }
    cacheTrack(slot, lang, units);
    dbg(`${what} cached (${units.length} units, lang=${lang || '?'})`);
  }

  // Which parser produced the last units. Only json3 is safe to cache, and the
  // flag is read straight after the parse it belongs to.
  let lastParseJson3 = false;
  function parseUnits(body) {
    body = (body || '').trim();
    lastParseJson3 = false;
    if (!body) return [];
    if (body[0] === '{') {
      try {
        const units = parseJson3Units(JSON.parse(body));
        lastParseJson3 = true;
        return units;
      } catch (_) { return []; }
    }
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
  // `end` is the line's time WINDOW end — where its speech stops, not where the
  // last word starts. alignLinesTo leans on it the way alignUaToEn leans on a
  // sentence's `end`; with the last word's onset there instead, every
  // translation word timed after it was pushed into the next line.
  function groupUnitsToLines(units, minChars = 40, maxChars = 75, maxDur = 6) {
    const lines = [];
    let cur = null;
    const flush = () => {
      if (cur && cur.units.length) {
        cur.full = joinUnits(cur.units);
        const last = cur.units[cur.units.length - 1];
        const e = last.end != null ? Math.min(last.end, last.t + 0.7) : last.t + estSpeechDur(last.text);
        cur.end = Math.max(last.t, e);
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
    // A line's window may never reach into the next one: json3 hands the next
    // word's onset out as this word's `end` whenever speech is continuous.
    for (let i = 0; i + 1 < lines.length; i++) {
      lines[i].end = Math.min(lines[i].end, lines[i + 1].start - 0.03);
    }
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

  // Same reveal, but for a track whose line index is given rather than searched
  // for — the translation follows the EN line it was aligned to.
  function pickAligned(lines, idx, t) {
    if (idx < 0 || idx >= lines.length) return { idx: -1, n: 0 };
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
  const SENT_GUARD = 0.2;   // silence we ask for before the next word's onset
  // …and the silence we never give up, whatever the floor below would rather
  // have. The floor used to sit outside the clamp and quietly overrule the
  // guard: with the next onset less than 320 ms away it left as little as 60 ms,
  // which is the "Aabbb…" that survived night 11 — clean where the author
  // paused, audible where speech ran on. The price is named: on very tight
  // sentences the last word now loses a few tens of ms.
  const SENT_GUARD_MIN = 0.15;
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
        // Where we would like to pause: today's boundary, then the guarantee
        // that the floor may no longer overrule.
        const want = Math.min(
          Math.max(
            Math.min(spoken + (ridesNext ? SENT_TAIL : 0.2), next.t - SENT_GUARD),
            Math.min(u.t + 0.12, next.t - 0.06) // floor: the last unit gets to sound
          ),
          next.t - SENT_GUARD_MIN               // …which silence now outranks
        );
        // And two limits that are structural rather than a matter of taste:
        // a stop at or past the next onset plays the very word we are avoiding,
        // and a stop before the sentence began gives uaRevealCount a negative
        // span and findSentenceAt a sentence it can never be inside.
        cur.stop = Math.min(Math.max(want, cur.start + 0.02), next.t - 0.03);
        cur.gap = next.t - cur.stop;   // silence actually left, for the log
        // Under ~150 ms between the two onsets both wishes cannot hold at once,
        // and silence wins: the last word is then cut short of its own onset.
        // At that distance it is a syllable fragment on an ASR timestamp, but
        // it is a real cost and the log names it.
        cur.trimmed = cur.stop < u.t;
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
      // …but only when the EN target itself ends on punctuation. Free-reading
      // lines break mid-sentence (too long, too slow), and there a trailing
      // period inside the bucket is the middle of the line, not its end:
      // cutting on it would hand the next line words this one is showing.
      const enFull = enSents[i].full != null ? enSents[i].full : joinUnits(enSents[i].units);
      let cut = -1;
      if (endsSentence(enFull)) {
        for (let k = 0; k < u.length; k++) {
          if (endsSentence(u[k].text)) cut = k;
        }
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

  // Free reading used to pick its EN line and its translation line separately,
  // each by its own timestamps — two renderers of the same audio, and nothing
  // held them together. Line lengths are counted in characters, so a short
  // sentence merges with its neighbour on one side and not on the other, and
  // the screen shows two EN sentences over the translation of one. Study mode
  // has been index-aligned since night 5; free reading now is too — one
  // translation bucket per EN line, same index, same words.
  function alignLinesTo(uaUnits, enLines) {
    const lines = alignUaToEn(uaUnits, enLines);
    for (const l of lines) l.full = joinUnits(l.units);
    return lines;
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
    hideResume();
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
    hideResume();
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

  // Precise stop: a timer scheduled for the remaining time. rAF alone
  // overshoots by a frame (16–33+ ms, worse at 2×) and freezes in background
  // tabs; the rAF check in loop() stays only as a backup.
  //
  // The timer aims a touch EARLY on purpose. A setTimeout can only ever be
  // late, and on a watch page it has been measured 205 ms late (night 10).
  // Landing before the mark costs nothing — the branch below re-arms, and by
  // then the remaining stretch is short enough for the rAF backup to close.
  const STOP_LEAD = 0.04;
  function armStop() {
    clearTimeout(stopTimer); stopTimer = null;
    if (stopAt == null || !video || video.paused) return;
    const left = (stopAt - video.currentTime) / (video.playbackRate || 1);
    // Inside the lead there is nothing left to aim early with: aim at the mark.
    const ms = Math.max(0, left > STOP_LEAD ? left - STOP_LEAD : left) * 1000;
    stopTimer = setTimeout(() => hitStop('timer'), ms);
  }
  function hitStop(who) {
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
    // fired behind schedule (fix that here). Which of the two fired is the
    // thing to read: the rAF backup can only be a frame late, so if it is the
    // one reporting 200 ms, the main thread was blocked and no schedule helps.
    if (over > 0.05) dbg(`sentence stop overshot by ${Math.round(over * 1000)} ms (${who})`);
    // How much silence the boundary itself left before the next word. Worth a
    // line only when it fell short of what we ask for — those are the sentences
    // where a bleed can still be heard, and they are what tells a boundary
    // placed too tight apart from audio the browser had already queued out.
    const s = sentences[sentIdx];
    if (s && s.gap != null && s.gap < SENT_GUARD - 0.001) {
      dbg(`sentence ${sentIdx + 1} stopped ${Math.round(s.gap * 1000)} ms before the next word`
        + (s.trimmed ? ', last word cut' : ''));
    }
    if (over > 0.005 && over < 0.8) {
      suppressSeek = true; // our own correction — not a user seek
      try { video.currentTime = stopAt; } catch (_) { suppressSeek = false; }
    }
    stopAt = null;
    lastCtl = '';
    // Last, well clear of the timing above: this is where learning stopped,
    // and it is the sentence that just played — the same one ▶ would replay.
    saveMark();
  }

  // The stop belonging to the sentence we are in — or null when the playhead is
  // already past it. That happens in exactly one place: the tail of the video,
  // after the last sentence, where findSentenceAt has nothing further to offer
  // and hands back the last one. Arming its stop there puts the mark in the
  // PAST, and playback dies the instant it starts.
  function liveStop(t) {
    if (!stopping() || !sentences.length) return null;
    const s = sentences[sentIdx];
    return t >= s.stop - SENT_EPS ? null : s.stop;
  }

  // After any user seek or a resume outside our controls, the text must show
  // the sentence the audio is actually in — otherwise audio walks away while
  // the display stays frozen on a stale sentence.
  function resync() {
    if (!state.reader || !sentences.length || !video) return;
    const t = video.currentTime || 0;
    const i = findSentenceAt(t);
    if (i !== sentIdx) { sentIdx = i; lastSig = null; }
    stopAt = liveStop(t);
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
    const t = video.currentTime || 0;
    sentIdx = findSentenceAt(t);
    stopAt = liveStop(t);
    sentenceDone = false;
    armStop();
    lastSig = null;
  }

  function setStudy(on) {
    state.study = on; saveState();
    if (on) { armStudy(); offerResume(); }
    else { stopAt = null; sentenceDone = false; clearTimeout(stopTimer); stopTimer = null; hideResume(); } // free play again
    syncUi();
  }

  // Repeat is a plain action, not a mode: play this sentence once more.
  function repeatSentence() { playSentence(sentIdx); }

  // ---------- resume mark ----------
  // What gets stored is the TIME a sentence starts, never its number: the
  // number only exists inside today's parse, and a track swap (asr → manual,
  // or Reload captions) would leave "sentence 42" pointing somewhere else.
  function saveMark() {
    if (!currentVideoId || !state.study || !sentences.length) return;
    const s = sentences[sentIdx];
    if (!s) return;
    marks[currentVideoId] = { t: s.start, at: Date.now() };
    markMoved = true;
    const ids = Object.keys(marks);
    if (ids.length > MARKS_KEEP) {
      ids.sort((a, b) => (marks[b].at || 0) - (marks[a].at || 0));
      for (const id of ids.slice(MARKS_KEEP)) delete marks[id];
    }
    chrome.storage.local.set({ [MARKS_KEY]: marks });
    drawMark(video && video.duration);
    // No log line here on purpose: one per sentence would drown the log the
    // real bugs are read from.
  }

  // Nearest sentence start — not findSentenceAt, which answers a different
  // question ("which sentence is the playhead inside") and carries SENT_EPS:
  // a one-syllable sentence whose stop sits at start + 0.02 would resolve to
  // the NEXT one. This also absorbs boundaries that shifted by a few ms when
  // the track was parsed again.
  function markSentence(t) {
    let best = 0, dist = Infinity;
    for (let i = 0; i < sentences.length; i++) {
      const d = Math.abs(sentences[i].start - t);
      if (d < dist) { dist = d; best = i; }
    }
    return best;
  }

  // Calendar days, not elapsed hours: "yesterday" is what an evening session
  // followed by a morning one actually means.
  function fmtAgo(at) {
    if (!at) return '';
    if (Date.now() - at < 5 * 60000) return 'just now';
    const midnight = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
    const days = Math.round((midnight(Date.now()) - midnight(at)) / 86400000);
    if (days <= 0) return 'earlier today';
    if (days === 1) return 'yesterday';
    if (days <= 30) return `${days} days ago`;
    return 'a while ago';
  }

  // The mark is its own node, outside the thinning rule that drops notches
  // closer than 8% apart — the one notch that must never disappear.
  function drawMark(dur) {
    if (!elMark) return;
    const m = currentVideoId ? marks[currentVideoId] : null;
    const show = !!m && !!dur && isFinite(dur) && sentences.length > 0;
    elMark.style.display = show ? '' : 'none';
    if (show) elMark.style.left = clamp((m.t / dur) * 100, 0, 100) + '%';
  }

  // Called from both finishBuild and enterReader: the captions can land
  // seconds after the overlay opens, or sit on disk long before it. This runs
  // at the first moment every condition is true at once, and once per video.
  function offerResume() {
    if (!elResume || !video || offeredFor === currentVideoId) return;
    if (!state.reader || !state.study || !sentences.length) return;
    const m = currentVideoId ? marks[currentVideoId] : null;
    if (!m) return;
    const idx = markSentence(m.t);
    if (idx >= sentences.length - 1) return;                    // the video was finished
    if (idx === findSentenceAt(video.currentTime || 0)) return;  // already standing there
    offeredFor = currentVideoId;
    elResumeText.textContent = `You left off at sentence ${idx + 1}`;
    elResumeAgo.textContent = fmtAgo(m.at);
    elResumeGo.textContent = `Continue from ${idx + 1}`;
    elResume.dataset.idx = String(idx);
    elResume.style.display = '';
    if (panel) panel.classList.add('ytds-asking');
    dbg(`resume mark: sentence ${idx + 1} (${fmtAgo(m.at)})`);
  }

  // The card itself is the state, the way the drawer is: applyTheme() rebuilds
  // the panel's class list from scratch on every syncUi(), so a flag kept
  // anywhere else would be wiped by the next chip or theme click.
  const resumeOpen = () => !!elResume && elResume.style.display !== 'none';

  // Any transport move means the same thing as "Stay here": the card never
  // stands between the user and playback.
  function hideResume() {
    if (!resumeOpen()) return;
    elResume.style.display = 'none';
    if (panel) panel.classList.remove('ytds-asking');
  }

  function applyResume() {
    const idx = Number(elResume && elResume.dataset.idx);
    hideResume();
    if (!Number.isFinite(idx)) return;
    playSentence(idx);
    dbg(`resumed at sentence ${idx + 1}`);
  }

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

  // The one place a set of caption units becomes the app's state. Both paths —
  // cached and fetched — end here, so study mode has exactly one way to be
  // born; two would be the very flaw the bugs of nights 5–8 grew out of.
  // Units arrive as the parser gave them (pre-split): the split is cheap to
  // redo and is not what belongs on disk.
  function finishBuild(enRaw, uaRaw, sameLang, gen) {
    if (gen !== loadGen) { dbg('build finished after a newer load began — dropping it'); return true; }
    const enUnits = splitUnitsByPunct(enRaw);
    const uaUnits = sameLang ? enUnits : splitUnitsByPunct(uaRaw);

    enLines = groupUnitsToLines(enUnits);
    uaLines = sameLang ? enLines : alignLinesTo(uaUnits, enLines);
    sentences = buildSentences(enUnits);
    uaSentences = sameLang ? sentences : alignUaToEn(uaUnits, sentences);
    sentIdx = 0; stopAt = null; sentenceDone = false;
    enUnitLen = enUnits.length; uaUnitLen = uaUnits.length;
    lastSig = null; lastIdx = -1;
    dbg(`ready: EN ${enUnits.length} words / ${enLines.length} lines · ${sentences.length} sentences · ${state.targetLang.toUpperCase()} ${uaUnits.length} words`);
    captionsReady = true;
    updateStatus();
    renderKeys();   // study mode only owns the keys once there are sentences
    if (state.reader && state.study) armStudy();
    offerResume();  // the first moment sentences exist for this video
    return true;
  }

  // The cheapest path there is: no request, no interception, no `pot`. A full
  // set or nothing — the source alone would mean rendering against an empty
  // translation zone while a fetch runs behind it, and the network path below
  // already handles that case properly.
  async function buildFromCache() {
    const gen = loadGen;
    const src = await cachedTrack('src');
    if (!src) return false;
    const sameLang = state.targetLang === src.lang;
    let tr = null;
    if (!sameLang) {
      tr = await cachedTrack(state.targetLang);
      if (!tr) return false;
    }
    srcLang = src.lang;
    dbg(`source: from cache (${src.units.length} units, lang=${srcLang || '?'})`);
    if (tr) dbg(`translation ${state.targetLang}: from cache (${tr.units.length} units)`);
    return finishBuild(src.units, tr ? tr.units : [], sameLang, gen);
  }

  async function buildFromBase(base, body, capTlang) {
    const gen = loadGen;
    let enUnits = [];
    // The interception already handed us this body. Fetching the same half
    // megabyte again on every load is what spent our quota — so the network is
    // the fallback here, not the first move.
    if (!capTlang && body) enUnits = parseUnits(body);
    // Then the disk: this is the path a language change takes when only the
    // translation is missing, and the source is already sitting in the cache.
    // Before this, the intercepted body was kept in memory for exactly this
    // moment — half a megabyte held for a case the cache now covers.
    if (!enUnits.length) {
      const hit = await cachedTrack('src');
      if (hit) {
        enUnits = hit.units;
        if (!srcLang) srcLang = hit.lang || '';
        dbg(`source: from cache (${enUnits.length} units, lang=${srcLang || '?'})`);
      }
    }
    // And only then the network.
    if (!enUnits.length) {
      try { enUnits = await fetchUnits(base, null); } catch (e) { dbg('EN fetch failed: ' + e.message); }
    }
    if (!enUnits.length) return false;

    if (!srcLang) {
      try { srcLang = new URL(base, location.origin).searchParams.get('lang') || ''; } catch (_) {}
    }
    // Kept here, while the parse this decision is about is still the last one:
    // the translation below runs its own parse and moves the json3 flag on.
    keepTrack('src', srcLang, enUnits, 'source track');
    const sameLang = state.targetLang === srcLang;

    let uaUnits = [];
    if (sameLang) {
      uaUnits = enUnits;
    } else if (capTlang === state.targetLang && body) {
      uaUnits = parseUnits(body);
      if (uaUnits.length) keepTrack(state.targetLang, state.targetLang, uaUnits, `translation ${state.targetLang}`);
      else uaUnits = await translationUnits(base, state.targetLang);
    } else {
      uaUnits = await translationUnits(base, state.targetLang);
    }
    if (!sameLang && !uaUnits.length) {
      showHint(throttledUntil > performance.now()
        ? 'YouTube is rate-limiting caption requests — the translation will come back in a few minutes'
        : 'Translation did not load — pick the language again', 4500);
    }

    return finishBuild(enUnits, uaUnits, sameLang, gen);
  }

  // Every load gets a generation. A build that finishes after a newer load has
  // started (two quick language switches) belongs to a state nobody asked for.
  let loadGen = 0;

  async function loadCaptions() {
    loadGen++;
    enLines = []; uaLines = []; srcLang = ''; enUnitLen = uaUnitLen = 0;
    captionsReady = false;
    sentences = []; uaSentences = []; sentIdx = 0; stopAt = null; sentenceDone = false;
    // Without this the notches survive into the next video, and two videos of
    // the same length with the same sentence count would never redraw them.
    ticksDur = 0; ticksLen = -1;
    clearTimeout(stopTimer); stopTimer = null;
    awaitingCapture = false;
    captureRetries = 0; sawTracks = false;
    clearTimeout(captureTimer);
    clearDisplay();
    setStatus('loading…');
    dbg('--- loadCaptions for ' + currentVideoId);

    if (await buildFromCache()) return;

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
      if (!awaitingCapture || captionsReady) return;
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
    const base = reuseBase(url);
    const capTlang = (/[?&]tlang=([^&]*)/.exec(url) || [])[1] || '';

    // Recorded even when we already have captions — from the cache, say. A url
    // the player fetched on its own carries a valid `pot`, and holding one is
    // what makes a later language change cost a single request instead of the
    // whole enable-and-wait dance.
    capturedBase = base; capturedBody = body; capturedTlang = capTlang; capturedForVideo = currentVideoId;
    // Half a megabyte of json3, dropped once it is genuinely redundant — and
    // only a SOURCE body ever is, because the source cache is what replaces it.
    // A TRANSLATED body is not covered by that cache, and it is the one thing
    // that makes switching to its language free: the player fetches it on its
    // own whenever the user has auto-translate on, and measured on 2026-07-29
    // dropping it sent us back to the network for a track already in hand.
    if (!capTlang && memCache.has(cacheKey('src'))) capturedBody = null;
    if (captionsReady) return;

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
      if (captionsReady || capturedForVideo !== currentVideoId) return;
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
  // It used to run for the life of the tab, re-arming every frame and only then
  // asking whether the overlay was open — 60 frames a second on the home page,
  // on search, on every video the user merely scrolled past, forever. It now
  // starts with the reader and stops with it. The guard inside stays: a frame
  // can already be queued when exitReader flips the flag.
  function startLoop() { if (rafId == null) rafId = requestAnimationFrame(loop); }
  function stopLoop() { if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; } }
  function loop() {
    rafId = requestAnimationFrame(loop);
    if (!state.reader) return;
    updateControls();
    guardPause();
    // The precise stop timer does the real work; this is a backup.
    if (stopAt != null && video && !video.paused && video.currentTime >= stopAt) hitStop('rAF backup');
    if (!video || !captionsReady) { showPlaceholder(); return; }
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
    // The translation is not searched for: it is the bucket that belongs to
    // this EN line. Only how much of it is already spoken still comes from the
    // clock.
    const ua = pickAligned(uaLines, en.idx, t);
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
    drawMark(dur);
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
    elStage.append(elZoneEn, el('div', 'ytds-rule'), elZoneUa, elNote, buildResumeCard());
    return elStage;
  }

  // The offer to pick learning up where it stopped. It lives on the stage
  // because that is the one part of the overlay focus mode never hides — and
  // where the eyes already are.
  function buildResumeCard() {
    elResumeText = el('div', 'ytds-resume-title');
    elResumeAgo = el('div', 'ytds-resume-ago');
    elResumeGo = el('span');
    const row = el('div', 'ytds-resume-row');
    row.append(
      mkBtn('ytds-sbtn ytds-primary', 'Continue where you left off', applyResume, icon('bookmark'), elResumeGo),
      mkBtn('ytds-sbtn', 'Leave the player where it is', hideResume, el('span', null, 'Stay here'))
    );
    elResume = el('div', 'ytds-resume');
    elResume.style.display = 'none';
    elResume.append(elResumeText, elResumeAgo, row);
    return elResume;
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
    hideResume();
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
    elMark = el('div', 'ytds-mark');
    elMark.title = 'You left off here';
    elMark.style.display = 'none';
    const track = el('div', 'ytds-track');
    track.append(elBuffer, elFill, elTicks, elMark);

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

  // The log is a stack of divs, and textContent runs them together into one
  // unreadable string — every line needs its own newline. And a copy that says
  // nothing is a copy you cannot trust: the button reports what happened.
  function buildCopyLog() {
    const btn = mkBtn('ytds-text-btn', 'Copy the whole log to the clipboard', async () => {
      const text = [...elLog.children].map((n) => n.textContent).join('\n');
      let ok = false;
      try { await navigator.clipboard.writeText(text); ok = true; } catch (_) { ok = copyFallback(text); }
      clearTimeout(copyTimer);
      btn.textContent = ok ? `Copied ${elLog.childElementCount} lines` : 'Copy failed';
      btn.classList.add(ok ? 'ytds-ok' : 'ytds-bad');
      copyTimer = setTimeout(() => {
        btn.textContent = 'Copy log';
        btn.classList.remove('ytds-ok', 'ytds-bad');
      }, 1800);
    }, txt('Copy log'));
    return btn;
  }

  // Copy log's neighbour, built the same way. A cached track is otherwise
  // beyond reach: with one on disk Ctrl+Shift+R no longer touches the network,
  // so this is the only way back to a fresh fetch.
  function buildReloadCaptions() {
    const btn = mkBtn('ytds-text-btn', 'Forget the cached captions for this video and fetch them again', async () => {
      clearTimeout(reloadTimer);
      btn.textContent = 'Reloading…';
      await purgeVideoCache();
      loadCaptions();
      btn.textContent = 'Cache cleared';
      btn.classList.add('ytds-ok');
      reloadTimer = setTimeout(() => {
        btn.textContent = 'Reload captions';
        btn.classList.remove('ytds-ok');
      }, 1800);
    }, txt('Reload captions'));
    return btn;
  }

  // The clipboard API needs the document focused, and inside our own
  // fullscreen element that is not a given — the old way still works there.
  function copyFallback(text) {
    try {
      const ta = el('textarea', 'ytds-clip');
      ta.value = text;
      panel.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (_) { return false; }
  }

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
    const btnRow = el('div', 'ytds-btn-row');
    btnRow.append(buildCopyLog(), buildReloadCaptions());

    const body = el('div', 'ytds-drawer-body');
    body.append(
      group('Advanced', 'console'),
      elStatus,
      elLog,
      btnRow
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
      + (resumeOpen() ? ' ytds-asking' : '')
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
    // On the panel, not on documentElement: the variable is read only by
    // .ytds-en/.ytds-ua, both of which live inside it, and writing it to the
    // page left our custom property on YouTube with the overlay long closed.
    if (panel) panel.style.setProperty('--font-scale', state.fontScale || 1);
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
    offerResume();  // captions may have been ready long before the overlay
    startLoop();
  }

  function exitReader() {
    if (!state.reader && !document.documentElement.classList.contains('ytds-reader')) return;
    // Only if study actually stopped somewhere this session. Otherwise opening
    // the overlay and closing it again would overwrite yesterday's sentence
    // with whatever position YouTube happened to restore.
    if (markMoved) saveMark();
    hideResume();
    state.reader = false; saveState();
    stopLoop();
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
      // Peel the layers one at a time: menu → resume card → drawer → reader.
      if (panel && panel.querySelector('.ytds-menu.ytds-open')) closeMenus();
      else if (resumeOpen()) hideResume();
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

  // ---------- the two ways in ----------
  // They answer different questions. The pill under the video is how someone
  // finds out this extension exists at all; the player icon is how someone who
  // already knows starts it without leaving the controls. One glyph for both —
  // the same open book that marks the Study toggle inside the overlay — so the
  // three of them read as one thing rather than three.
  function ensureLaunchButton() {
    const rc = document.querySelector('.ytp-right-controls');
    if (!rc || rc.querySelector('.ytds-launch')) return;
    const btn = document.createElement('button');
    btn.className = 'ytp-button ytds-launch';
    // "Dual" is doing the work here: plain "subtitles" is the button standing
    // next to ours, and the glyph we used to draw claimed to be it too.
    btn.title = 'Dual subtitles — original + translation, for language study';
    btn.appendChild(icon('study'));
    btn.addEventListener('click', enterReader);
    rc.insertBefore(btn, rc.firstChild);
  }

  // The row of Share / Save buttons under the video, in the order we know it.
  // The first two shapes hold like/dislike and Share; the buttons YouTube folds
  // into "..." on a narrow window live in a different node, so appending here
  // cannot push one of them out of sight.
  const ACTION_ROWS = [
    'ytd-watch-metadata #top-level-buttons-computed',
    '#actions #top-level-buttons-computed',
    'ytd-watch-metadata #actions-inner'
  ];
  function ensureActionButton() {
    let row = null;
    for (const sel of ACTION_ROWS) { row = document.querySelector(sel); if (row) break; }
    // YouTube's markup is not a contract. When none of the shapes we know is
    // on the page, the cost is one missing convenience: the player button and
    // everything behind it stay exactly as they were.
    if (!row || row.querySelector('.ytds-cta')) return;
    // The label says what the button opens rather than which language it is
    // for: the original track can be any of them, and both modes behind this
    // button show two languages at once. Why anyone would want that is the
    // tooltip's job, where there is room to say it.
    // It is its own element so a narrow window can drop it and leave a round
    // icon button, the way the row's own buttons give up their words.
    row.appendChild(mkBtn('ytds-cta', 'Dual subtitles — original + translation, for language study',
      enterReader, icon('study'), el('span', 'ytds-cta-label', 'Dual subtitles')));
  }

  // ---------- lifecycle ----------
  function tick() {
    if (location.pathname !== '/watch') return;
    video = document.querySelector('video.html5-main-video') || document.querySelector('video');
    if (video && video !== hookedVideo) {
      // YouTube swaps the element (an ad, a quality change, a new video), and
      // the listeners we left on the old one outlive it for the whole session.
      if (hookedVideo) {
        hookedVideo.removeEventListener('play', armStop);
        hookedVideo.removeEventListener('ratechange', onRateChange);
        hookedVideo.removeEventListener('seeked', onSeeked);
      }
      hookedVideo = video;
      video.addEventListener('play', armStop);
      video.addEventListener('ratechange', onRateChange);
      video.addEventListener('seeked', onSeeked);
      applySpeed(); // a fresh element starts at 1×, whatever the menu says
    }
    ensurePanel();
    ensureLaunchButton();
    ensureActionButton();
    const id = new URLSearchParams(location.search).get('v');
    if (id && id !== currentVideoId) {
      currentVideoId = id;
      offeredFor = null;    // a new video gets its own single offer
      markMoved = false;
      hideResume();
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
  // No loop here on purpose: state.reader is forced false at startup, so there
  // would be nothing for it to draw. enterReader starts it.
})();
