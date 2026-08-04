// Runs in the ISOLATED world.
// It stays out of YouTube's UI: it only adds one button to the player controls.
// Clicking it opens a full-screen study overlay with dual subtitles that reveal
// word by word, plus its own playback controls.
(() => {
  'use strict';

  const THROTTLE_KEY = 'ytdscap-throttle';   // when YouTube last told us to slow down
  const DEFAULTS = { showEn: true, showUa: true, targetLang: 'uk', theme: 'sepia', fontScale: 1, reader: false, speed: 1, study: true, focus: false, transcript: false, videoMode: false, tailMs: 300 };
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
  // Two steps below the old floor. XS was sized for the reader, where the text
  // IS the screen; over video the same size covers the picture it is supposed
  // to caption. The existing five keep their values, so a saved scale still
  // means what it meant (fontStepIdx snaps to the nearest step anyway).
  const FONT_STEPS = [['MIN', 0.4], ['XXS', 0.52], ['XS', 0.65], ['S', 0.8], ['M', 1], ['L', 1.25], ['XL', 1.55]];
  // How long study mode keeps playing past the point where the last word is
  // ESTIMATED to end — see sentenceStop. Typed in, not picked from a ladder:
  // the right value is a property of the speaker, and finding it is a matter
  // of nudging by 50 ms and listening, which named steps cannot express.
  const TAIL_MIN = 0, TAIL_MAX = 2000;
  // The settings the drawer's Playback group owns, and therefore the settings
  // its Reset returns to DEFAULTS. A future option joins this list and is
  // covered by the button without another line anywhere else.
  const PLAYBACK_KEYS = ['tailMs'];
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
    bookmark: S + '<path d="M5.6 3.6h8.8v12.8L10 12.9l-4.4 3.5Z"/></svg>',
    // The transcript panel. Lines of text rather than the cog's line-and-knob:
    // the last one is short, which is what makes a paragraph read as a
    // paragraph and not as a list of settings.
    list: S + '<path d="M4.4 6.2h11.2M4.4 10h11.2M4.4 13.8h7"/></svg>',
    // Video mode: the picture comes back, and the text sits on it.
    screen: S + '<rect x="3" y="4.4" width="14" height="9.6" rx="2.2"/><path d="M7.4 16.8h5.2"/></svg>'
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
  // The silent half of loadCaptions ran and came up empty, so this video still
  // needs the player switched on — and that waits for the overlay. See the tail
  // of loadCaptions for why.
  let pokePending = false;
  // Is there anything to open on this video at all — asked before the overlay,
  // not inside it. It stays 'unknown' until the player response answers (up to
  // 4.5 s, see requestTracks), and the buttons work meanwhile: a control that
  // is dead for the first seconds of every video is a worse lie than one that
  // opens onto "loading…". Nothing here touches the player's CC.
  let availability = 'unknown';   // unknown | ready | none | live
  const WHY_BLOCKED = {
    none: 'This video has no subtitles — nothing to read here',
    live: 'Live streams have no finished subtitles yet — try the recording afterwards',
    // Formally there are subtitles here, so "no subtitles" would read as a
    // broken extension rather than as a video with nothing to say.
    cues: 'These subtitles are only sound cues like [Music] — nothing to read here'
  };
  const blockedWhy = () => WHY_BLOCKED[availability] || '';
  // Live wins over everything: a stream can carry a caption track and still be
  // unreadable to us, because the timing model needs an end and there is none.
  const markAvailable = () => { if (availability !== 'live') availability = 'ready'; };

  let captureTimer = null;
  let capturedBase = null, capturedBody = null, capturedTlang = '', capturedForVideo = null;
  let captureRetries = 0, sawTracks = false;
  let video = null;
  let panel, elStage, elZoneEn, elZoneUa, elNote, elStatus, elLog, elCounter, elHint;
  let btnTailReset, inpTail;
  let btnStudy, btnFocus, btnTranscript, btnVideo;
  // Video mode borrows the player's geometry and must give it back exactly.
  // null = we have not taken it; a string (possibly empty) = what was there.
  let playerStyleWas = null;
  // The transcript panel: every sentence of the video, listed. The list is DOM,
  // not state — it is born in finishBuild and dies in loadCaptions, so it can
  // never disagree with the stage about what a sentence is.
  let elAside, elList, elFollow;
  // Where YouTube's translation stops on this video (Infinity when it reaches
  // the end). Past it the zone says so instead of standing empty: blank space
  // reads as a broken extension, and this is an answer, not a failure.
  let uaCoverEnd = Infinity;
  let listBuilt = false;    // this video's sentences are already in the list
  let listBuilding = false; // …and a long one is being built right now
  let listIdx = -1;         // which block currently wears the active class
  // Following is an intent for this sitting, like sentenceDone — never saved.
  let following = true;
  // Our own scrollTop write also fires `scroll`, and reading that as the user
  // taking over would switch following off on the very first sentence.
  let selfScrollAt = 0;
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
  // Phrase pairing per sentence, filled in the first time one is pointed at.
  // Memory only, and thrown away with the sentences it describes: it is a
  // derivative of the track, costs microseconds, and keeping it on disk would
  // be one more thing that can drift apart from a re-parse.
  let chunkCache = {};
  let litChunk = null;   // the target currently pointed at, or null
  // Does this track carry a time per WORD, or only per caption line? The
  // word-by-word reveal is only honest on the first kind; see wordLevelTrack().
  let wordLevel = true;
  let sentIdx = 0;
  let stopAt = null;
  let sentenceDone = false;  // the current sentence played out and we stopped at its end
  let stopTimer = null;      // precise stop scheduled for the exact remaining time
  let suppressSeek = false;  // our own currentTime writes must not look like user seeks
  let pauseIntentAt = 0;     // when we last asked for a pause (resume guard)
  let pauseGuardNoted = false;   // the guard logs once per pause, not per frame
  let hookedVideo = null;    // the <video> we attached play/seek/rate listeners to

  // ---------- ads ----------
  // An ad is not a small exception, it is a different clock: while one plays,
  // currentTime, duration and playbackRate all belong to the spot, not to the
  // video we are reading. Everything timing-related therefore asks adNow()
  // first. Two class names because YouTube uses both, and being wrong in the
  // over-inclusive direction is the cheap way to be wrong: freezing for a few
  // seconds too long is an inconvenience, while missing a real ad means pausing
  // it and fighting the player over its own playback.
  // The names are measured, not folklore: on a live watch page YouTube's own
  // stylesheets carry 156 rules mentioning `ad-showing` and 58 mentioning
  // `ad-interrupting` (2026-08-03).
  let hookedPlayer = null;   // #movie_player, cached so loop() does no DOM lookup
  let simulateAd = false;    // the Advanced stand; deliberately never persisted
  let adWas = false;         // previous adNow(), to catch the edges
  let adSentIdx = 0;         // the sentence an ad interrupted
  let adWaitUntil = 0;       // deadline for "the element is our video again"
  let adResumePending = false;
  function adNow() {
    if (simulateAd) return true;
    const p = hookedPlayer;
    if (!p) return false;
    return p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting');
  }

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
    // The tail is typed in, so the saved value is whatever was typed last —
    // including on a build whose limits were different. Clamp rather than
    // snap: any number in range is legitimate here, unlike the speed ladder.
    const savedTail = Math.round(Number(state.tailMs));
    state.tailMs = Number.isFinite(savedTail) ? clamp(savedTail, TAIL_MIN, TAIL_MAX) : DEFAULTS.tailMs;
    document.documentElement.classList.remove('ytds-reader');
    ensurePanel();
    syncUi();
    // This used to re-apply the speed here, to undo the default the first
    // tick() had already put on the player before the saved state arrived.
    // Now that tick() only touches the rate with the overlay open, there is
    // nothing to undo — and a page load must not take 2× off a player the
    // user set to 2× in YouTube's own menu. state.reader is false here always.
  });
  // A content script outlives the extension behind it. Chrome updates or reloads
  // the extension — most reliably a few moments after the browser starts, while
  // session-restored tabs are already alive — and every script already in a page
  // keeps running with a dead bridge: our own timers and listeners are page code,
  // so the buttons are there and they click, but the first touch of `chrome.*`
  // throws "Extension context invalidated". Nothing used to check for that, so
  // the failure was invisible — and because enterReader saved before it drew,
  // the overlay did not even open. Reloading the page fixed it, which is exactly
  // why it read as a fluke rather than a bug.
  const alive = () => { try { return !!(chrome.runtime && chrome.runtime.id); } catch (_) { return false; } };
  // "Study Subs 1.1.0" — with the product's own name, never the number alone.
  // Next to a heading a bare version reads as the version OF that heading
  // ("Settings 1.1.0" — the version of the settings?), and the one place it is
  // ever needed is a bug report, where the name is half the answer.
  // It comes through the same bridge as everything else in chrome.*, so an
  // orphaned script shows nothing here rather than losing the drawer it is in.
  const versionTag = () => {
    try {
      if (!alive()) return '';
      const m = chrome.runtime.getManifest();
      // The store name carries a tagline after an em dash; the product is the
      // part in front of it.
      const name = String(m.name || '').split('—')[0].trim();
      return [name, m.version].filter(Boolean).join(' ');
    } catch (_) { return ''; }
  };
  let toldStale = false;
  // Say it once, in the overlay, where someone who is not the author can act on
  // it. Twice is nagging, and the log keeps the full count anyway.
  function tellStale() {
    if (toldStale) return;
    toldStale = true;
    dbg('extension context is gone — nothing can be saved until the page is reloaded');
    showHint('Study Subs was updated — reload the page (Ctrl+Shift+R) to save settings again', 6000);
  }
  // Every write goes through here: a dead bridge must cost a feature, never the
  // whole overlay.
  function put(obj) {
    if (!alive()) { tellStale(); return false; }
    try { chrome.storage.local.set(obj); return true; } catch (_) { tellStale(); return false; }
  }
  const saveState = () => put({ ytds: state });

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
    if (elList) elList.textContent = '';
    listBuilt = false; listIdx = -1; following = true;
    lastSig = null; lastIdx = -1;
  };
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // ---------- MAIN-world bridge ----------
  // Resolves { tracks, isLive, answered }. `answered` is its own field because
  // "the player says this video has no caption tracks" and "the player never
  // said anything" look identical in an empty array — and only the first of
  // them is grounds for switching the entry buttons off.
  function requestTracks() {
    return new Promise((resolve) => {
      let done = false, tries = 0;
      const onMsg = (e) => {
        if (e.source !== window || !e.data || e.data.type !== 'YTDS_TRACKS') return;
        window.removeEventListener('message', onMsg);
        done = true;
        resolve({ tracks: e.data.tracks || [], isLive: !!e.data.isLive, answered: true });
      };
      window.addEventListener('message', onMsg);
      (function ask() {
        if (done) return;
        window.postMessage({ type: 'YTDS_REQUEST_TRACKS' }, '*');
        if (++tries < 15) setTimeout(ask, 300);
        else {
          window.removeEventListener('message', onMsg);
          resolve({ tracks: [], isLive: false, answered: false });
        }
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
    // `dur` below is the element's, and during an ad the element is the spot:
    // a short track measured against a short duration passes the coverage test
    // easily, and the result would sit on disk under this video's id.
    if (adNow()) return 'an ad is playing';
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
  // last word starts.
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
    if (!wordLevel) return { idx, n: lines[idx].units.length };  // same rule as revealCount
    let n = 0;
    for (const u of lines[idx].units) { if (u.t <= t + LEAD) n++; else break; }
    return { idx, n: Math.max(1, n) };
  }

  // Same reveal, but for the translation of a line whose index is already known.
  // How far in it is comes from the SOURCE line's progress, not from the
  // translation's own timestamps: those are the unreliable half of an
  // auto-translated track (see alignSentences), and study mode has read the
  // reveal off the source side since it was written.
  function revealAligned(lines, idx, frac) {
    if (idx < 0 || idx >= lines.length) return { idx: -1, n: 0 };
    return { idx, n: Math.max(1, Math.ceil(frac * lines[idx].units.length)) };
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
  //   `end`  — the sentence's time WINDOW, used by the text side (reveal
  //            progress, pre-roll, and as the weak time anchor in
  //            alignSentences).
  //   `stop` — where playback pauses in study mode, trimmed so a guard of
  //            silence always sits between it and the next word's onset.
  // The two used to be one value, and that is exactly why the next sentence's
  // first syllable bled through on every sentence the author did not pause after.
  // How long to keep playing past the estimated end of the last word, when
  // there is room for it. This was a fixed 0.12 until a live run showed why it
  // cannot be: on a line-level track the parser's end is a DISPLAY window, so
  // the estimate below is a letter-count guess at the speech, and a speaker
  // slower than the guess loses the tail of the last word ("freeze" heard as
  // "free") with seconds of silence still to spare. It is now a setting,
  // because the right value is a property of the speaker, not of the code.
  const tailSec = () => (state.tailMs || 300) / 1000;
  const SENT_GUARD = 0.2;   // silence we ask for before the next word's onset
  // …and the silence we never give up, whatever the floor below would rather
  // have. The floor used to sit outside the clamp and quietly overrule the
  // guard: with the next onset less than 320 ms away it left as little as 60 ms,
  // which is the "Aabbb…" that survived night 11 — clean where the author
  // paused, audible where speech ran on. The price is named: on very tight
  // sentences the last word now loses a few tens of ms.
  const SENT_GUARD_MIN = 0.15;

  // When the last word is spoken to the end: parser-provided end if any,
  // clamped by the next word's onset and by a max plausible word length.
  //
  // That last clamp is the one to read twice. 0.7 is a WORD, and it only makes
  // sense on a word-level track. Every manual track is line-level — one caption
  // line per unit — and there the unit is a whole clause that sounds for
  // seconds, so a flat 0.7 declares the line finished before it has been read.
  // Measured on the manual TED track of f_N3PGvnVKg: a 2.6 s line was taken to
  // end 1.9 s early, which made the silence before the next line measure 2.0 s
  // — over the 1.4 s that breaks a sentence — so the sentence was cut at the
  // LINE boundary rather than at its own end, and study mode stopped in the
  // middle of "…can go blank | when they hear those dreaded words." 50 of 138
  // sentences on that track ended mid-phrase like this.
  //
  // estSpeechDur already draws exactly this distinction (it caps single words
  // and lets a multi-word unit be as long as its text), so the cap asks it
  // instead of hardcoding a second opinion. On that track: 138 sentences → 101,
  // mid-phrase stops 50 → 13, longest cut of a last word 133 ms → 100 ms; the
  // word-level ASR track of the same video does not move by a single sentence.
  const spokenEnd = (u, nextT) => {
    let e = u.end != null ? u.end : u.t + 0.45;
    if (nextT != null && nextT > u.t) e = Math.min(e, nextT);
    return Math.min(e, u.t + Math.max(0.7, estSpeechDur(u.text)));
  };

  // The one home of the pause boundary. It lives out here, above both callers,
  // because this arithmetic has been rebuilt three times and broken twice: a
  // second copy inside restop() would drift from this one at the first edit,
  // and the symptom of that drift is audible, not a crash.
  //   u     — the sentence's last unit
  //   next  — the unit that follows it (the next sentence's first), or null
  //   start — the sentence's own start, so the stop cannot precede it
  function sentenceStop(u, next, start) {
    if (!next) return null;   // last sentence: the caller uses the window end
    const se = spokenEnd(u, next.t);
    // Trust the parser's end only when it stops SHORT of the next onset —
    // then it is a real recorded end (the author paused), and the sentence
    // keeps exactly the ending it has today. When it runs into the next
    // word, it is that word's onset wearing a disguise, and the unit's own
    // text is the better witness.
    const est = u.t + estSpeechDur(u.text);
    const ridesNext = u.end == null || u.end >= next.t - 0.05;
    // Trusted: the end the track gives, as it stands. It used to be capped by
    // the estimate as well (`Math.min(u.end, est)`), which undid the very thing
    // this branch establishes — that `u.end` is a real recorded end, because it
    // stops short of the next onset. A speaker slower than 75 ms per letter
    // then lost the difference off the end of every sentence.
    //   Measured on yhGzXULZkEw, sentence 44 (2026-08-04):
    //   "…and then I translated it into code." — line 270.36 → 276.08, next
    //   sentence 276.68. est said 274.41, so the stop fell 1.29 s inside the
    //   last word ("transle…") with 1.89 s of silence going spare after it.
    //   Across that track: 86 sentences cut by >0.3 s → 16, and on f_N3PGvnVKg
    //   49 → 0, with the sentence count unchanged on both (203 and 95).
    // The cap stays where it earns its keep: spokenEnd, which also feeds the
    // silence-based sentence break — capping there is what keeps segmentation
    // identical, and moving it moved 203 sentences to 190.
    const spoken = ridesNext ? Math.min(est, next.t) : Math.max(se, u.end);
    // The tail applies to BOTH branches. It first shipped tunable only on the
    // estimate branch, on the argument that after a real recorded end 200 ms is
    // enough by construction. Measurement killed that argument: the sentence
    // this was built for goes down the trusted branch, and the setting did
    // nothing to it at any value. On a line-level track `u.end` comes from
    // splitUnitsByPunct, which interpolates it from character positions — it
    // stops short of the next onset, so it reads as "recorded", while being a
    // guess like any other. There is no branch here that deserves a constant.
    // (What each was: 120 ms on the estimate branch, 200 on the trusted one.
    // One field cannot say both, and does not need to — this is one idea.)
    const tail = tailSec();
    // Where we would like to pause: today's boundary, then the guarantee
    // that the floor may no longer overrule.
    const want = Math.min(
      Math.max(
        Math.min(spoken + tail, next.t - SENT_GUARD),
        Math.min(u.t + 0.12, next.t - 0.06) // floor: the last unit gets to sound
      ),
      next.t - SENT_GUARD_MIN               // …which silence now outranks
    );
    // And two limits that are structural rather than a matter of taste:
    // a stop at or past the next onset plays the very word we are avoiding,
    // and a stop before the sentence began gives uaRevealCount a negative
    // span and findSentenceAt a sentence it can never be inside.
    const stop = Math.min(Math.max(want, start + 0.02), next.t - 0.03);
    // Under ~150 ms between the two onsets both wishes cannot hold at once,
    // and silence wins: the last word is then cut short of its own onset.
    // At that distance it is a syllable fragment on an ASR timestamp, but
    // it is a real cost and the log names it.
    return { stop, gap: next.t - stop, trimmed: stop < u.t };
  }

  // Recompute only the pause boundaries, in place. Everything the tail cannot
  // touch is left alone on purpose: the sentence WINDOW (`end`) does not depend
  // on it, and neither do the alignment, the lines, or the translation — those
  // cost a full rebuild and would throw the reader back to the first sentence.
  // The unit that follows a sentence is the next sentence's first, so the whole
  // input this needs is already in `sentences`.
  function restop() {
    if (!sentences.length) return;
    for (let i = 0; i < sentences.length; i++) {
      const s = sentences[i], nextS = sentences[i + 1];
      const u = s.units[s.units.length - 1];
      const next = nextS && nextS.units.length ? nextS.units[0] : null;
      if (!u || !next) { s.stop = s.end; s.gap = null; s.trimmed = false; continue; }
      const r = sentenceStop(u, next, s.start);
      if (r) { s.stop = r.stop; s.gap = r.gap; s.trimmed = r.trimmed; }
    }
    // Re-arm against the new boundary WITHOUT armStudy(): that would clear
    // sentenceDone, and the sentence you just heard cut off is exactly the one
    // you want ▶ to play again after raising the value.
    //
    // And WITHOUT re-deriving sentIdx, which is the whole reason this comment
    // is long. findSentenceAt draws its boundary at `stop`, so at an auto-stop
    // the playhead already belongs to the NEXT sentence by that measure —
    // re-deriving here walked the reader forward one sentence on every change
    // of the value, and you had to press Previous to get your sentence back.
    // Nothing here can move sentIdx anyway: sentences are entered at `start`,
    // and `start` is not what this function touches.
    if (state.reader && stopping() && video) {
      stopAt = liveStop(video.currentTime || 0);
      armStop();
      lastSig = null;
    }
  }

  function buildSentences(units) {
    const out = [];
    let cur = null, buf = '';
    const close = (i) => {
      const u = units[i], next = units[i + 1];
      const se = spokenEnd(u, next ? next.t : null);
      cur.end = next
        ? Math.max(Math.min(se + 0.2, next.t - 0.08), Math.min(u.t + 0.15, next.t - 0.03))
        : (video && video.duration ? video.duration : se + 0.6);
      const r = sentenceStop(u, next, cur.start);
      if (r) { cur.stop = r.stop; cur.gap = r.gap; cur.trimmed = r.trimmed; }
      else cur.stop = cur.end;
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

  // Letters and digits only: how much text a unit really carries, with
  // punctuation and spacing left out of the count.
  function textLen(s) { return String(s == null ? '' : s).replace(UNIT_LETTERS_RE, '').length; }

  // Sentence boundaries of a track read from its own punctuation (a long
  // silence breaks one too — ASR tracks may carry no punctuation at all).
  // Lighter than buildSentences on purpose: a translation is never what
  // playback pauses on, so it needs no stop point and no guard of silence.
  function splitIntoSentences(units) {
    const out = [];
    let cur = null, buf = '';
    // Where a word's speech actually stops. json3 hands the NEXT word's onset
    // out as this word's `end` whenever speech is continuous, so taking `end`
    // at face value leaves every gap measuring zero — and with the gaps gone a
    // track without punctuation became one single sentence, which handed the
    // whole translation to the first line and nothing to the rest. The unit's
    // own text is the better witness in that case, exactly as buildSentences
    // decides it.
    const spokenEnd = (u, nextT) => {
      const est = u.t + estSpeechDur(u.text);
      const ridesNext = u.end == null || (nextT != null && u.end >= nextT - 0.05);
      if (!ridesNext) return u.end;
      return nextT != null ? Math.min(est, nextT) : est;
    };
    const close = (i) => {
      const u = units[i], next = units[i + 1];
      cur.end = Math.max(cur.start, spokenEnd(u, next ? next.t : null));
      cur.full = joinUnits(cur.units);
      out.push(cur);
      cur = null;
    };
    // Silence breaks a sentence only on a track that has no punctuation to go
    // by. On a punctuated translation the timestamps are the noisy part, so a
    // gap rule there does nothing but invent sentence boundaries mid-sentence —
    // and a translation cut into more fragments than the source has sentences
    // is exactly what the aligner cannot put back together.
    let marks = 0;
    for (const u of units) if (endsSentence(u.text)) marks++;
    const byGaps = marks < units.length / 50;
    for (let i = 0; i < units.length; i++) {
      const u = units[i], next = units[i + 1];
      if (!cur) { cur = { start: u.t, units: [] }; buf = ''; }
      cur.units.push(u);
      buf += u.text;
      const longGap = byGaps && next && (next.t - spokenEnd(u, next.t)) >= 1.4;
      if (endsSentence(buf) || longGap) close(i);
    }
    if (cur) close(units.length - 1);
    return out;
  }

  // The share of a bucket that a target covers, cut on whole words: a unit goes
  // where its own middle falls. Shares that tile [0,1) therefore partition the
  // units — none lost, none shown twice.
  function sliceByChars(units, a, b) {
    const w = units.map((u) => Math.max(1, textLen(u.text)));
    let total = 0;
    for (const x of w) total += x;
    if (!total) return [];
    const out = [];
    let acc = 0;
    for (let i = 0; i < units.length; i++) {
      const mid = (acc + w[i] / 2) / total;
      if (mid >= a && mid < b) out.push(units[i]);
      acc += w[i];
    }
    return out;
  }

  // Fitting a translation to its source is sentence alignment, and only two
  // signals survive the trip: sentences keep their ORDER, and a translated
  // sentence keeps roughly the LENGTH of its original. A word's timestamp is
  // not one of them. An auto-translated track carries the source track's word
  // slots filled with words in a different order, so a translated word's onset
  // can sit a second either side of the sentence it belongs to — the further
  // the two languages move the words, the further the onset drifts.
  //
  // Bucketing words by that onset is what used to happen here, with the damage
  // repaired afterwards: whatever trailed a bucket's LAST period moved into the
  // next bucket. One bucket, one repair — so when the drift was wide enough for
  // a bucket to swallow a whole translated sentence, only the fragment behind
  // its final period moved on, and the screen showed the head of a sentence
  // over one English line and its tail over the next ("Я вже" under "It hit me
  // hard.", the rest of it under the sentence after). No local repair can tell
  // those cases apart: whether a bucket holds two sentences because the
  // translator split one in two, or because it stole its neighbour's, is only
  // visible in how the two streams line up as a whole.
  //
  // So both sides are cut into sentences, and we take the cheapest monotone
  // pairing of the two streams: length agreement (Gale–Church) as the signal,
  // time as a weak anchor, 1:1 preferred and a split or a merge available where
  // auto-translate really did re-place a period.
  // Weights, chosen on a stand that scores a whole video's worth of sentences
  // against the sentence each translated word really came from. They sit in the
  // middle of a wide plateau rather than on a spike: TIME_W 0.5–0.8 and SKEW
  // 1.5–4 all behave, so nothing here is balanced on a knife edge.
  const AL_TIME_W = 0.8;   // one second of onset mismatch, in units of length cost
  const AL_TIME_CAP = 12;  // past this the anchor has said all it can say
  const AL_SKEW = 2.5;     // leaving one-sentence-for-one-sentence needs real evidence
  const AL_DROP = 8;       // leaving a sentence with no partner: a last resort
  // A translation can stop short of the end of a long video. YouTube keeps
  // answering with events all the way to the last second — it just stops
  // putting TEXT in them. Measured on ikqTTXVRVog (4:52:25) 2026-08-04:
  //
  //   UK units up to 4:00:45 : 22812      after it: 3
  //   EN units after 4:00:45 :  5921
  //
  // Aligning across that boundary asks the pairing to cover an hour of video
  // with nothing to cover it with, and DP obliges: it spreads the last real
  // sentences into crumbs ("У тебе" under "You look a little tired.") and
  // leaves the rest blank. So the alignment is asked only about the part that
  // HAS a translation, and everything past it is honestly empty.
  //
  // The 60 s slack is deliberate: a track that simply ends with the speech,
  // or one whose last cue is a little early, must not trip this.
  const AL_TAIL_SLACK = 60;
  function alignCovered(uaSents, enSents) {
    uaCoverEnd = Infinity;
    const last = uaSents.length ? uaSents[uaSents.length - 1] : null;
    const reach = last ? Math.max(last.start, last.units.length ? last.units[last.units.length - 1].t : 0) : 0;
    const enEnd = enSents.length ? enSents[enSents.length - 1].start : 0;
    if (!last || reach >= enEnd - AL_TAIL_SLACK) return alignSentences(uaSents, enSents);
    uaCoverEnd = reach;
    let cut = enSents.length;
    while (cut > 0 && enSents[cut - 1].start > reach) cut--;
    dbg(`translation covers ${fmtTime(reach)} of ${fmtTime(enEnd)} — aligning the first `
        + `${cut} of ${enSents.length} sentences, the rest have no translation to show`);
    const head = alignSentences(uaSents, enSents.slice(0, cut));
    const tail = enSents.slice(cut).map((s) => ({ start: s.start, end: s.end, units: [] }));
    return head.concat(tail);
  }

  // How far from the band's centre the pairing may wander. Flat again, and
  // generous, because the centre is now the honest one — see the band below.
  const AL_BAND = 80;
  const AL_MOVES = [[1, 1], [1, 2], [2, 1], [1, 3], [3, 1], [1, 0], [0, 1]];
  function alignSentences(uaSents, enSents) {
    const n = enSents.length, m = uaSents.length;
    const out = enSents.map((s) => ({ start: s.start, end: s.end, units: [] }));
    if (!n || !m) return out;

    // Prefix sums of text length, so a block's length is one subtraction.
    // `full` is what the line builder leaves behind and what splitIntoSentences
    // sets; buildSentences keeps only units, so join them when it is missing —
    // reading `full` alone made every English length zero, and with the length
    // signal dead the aligner was left running on the time anchor by itself.
    const pre = (arr) => {
      const p = new Float64Array(arr.length + 1);
      for (let i = 0; i < arr.length; i++) {
        const s = arr[i];
        p[i + 1] = p[i] + textLen(s.full != null ? s.full : joinUnits(s.units));
      }
      return p;
    };
    const enPre = pre(enSents), uaPre = pre(uaSents);
    const ratio = (uaPre[m] || 1) / (enPre[n] || 1);

    const cost = (i, p, j, q) => {
      const ec = enPre[i + p] - enPre[i], uc = uaPre[j + q] - uaPre[j];
      const want = ratio * ec;
      // Variance of the length difference grows with the length, hence the
      // square root; the floor keeps two-word sentences from dominating.
      const len = Math.abs(uc - want) / Math.sqrt(2 * Math.max(want, 20));
      // Onsets only — never the ends. The last sentence's `end` is the video's
      // duration by construction (there is no next word to bound it), so an end
      // difference there is the length of the outro, not a misalignment, and it
      // was enough to make the aligner refuse the last sentence altogether.
      const dt = Math.min(Math.abs(uaSents[j].start - enSents[i].start), AL_TIME_CAP);
      return len + AL_TIME_W * dt + AL_SKEW * (p + q - 2);
    };

    // The table is kept to a band around the diagonal both streams have to run
    // along — they describe the same audio, in the same order, so the pairing
    // cannot wander AL_BAND sentences away from proportional and still be the
    // cheapest. A full table would cost 80 MB on a three-hour video; this costs
    // a fraction of a megabyte on any of them.
    // The band is centred on TIME, not on proportion. Both tracks are the same
    // audio on the same clock — measured on ikqTTXVRVog 2026-08-04, where the
    // translation at 233:56 says exactly what the original at 233:56 says — so
    // the UA sentence nearest in time is the best prior there is for where the
    // pairing runs.
    //
    // Proportion assumes the ratio of sentence counts is CONSTANT, and on a long
    // video it is not: on that track the true pairing wandered up to 798
    // sentences away from the proportional diagonal (median 397, p90 715),
    // rising through the video and falling back at the end. No sane band around
    // that diagonal covers it — 80 failed, 407 failed, and the next video would
    // want a different number. Around the time diagonal, 80 is generous.
    //
    // `c` only ever moves forward, so lo/hi stay non-decreasing and the table
    // stays walkable; the two ends are pinned because the DP starts at (0,0) and
    // must be able to finish at (n,m).
    const lo = new Int32Array(n + 1), hi = new Int32Array(n + 1);
    let c = 0;
    for (let i = 0; i <= n; i++) {
      if (i < n) {
        const t = enSents[i].start;
        while (c + 1 < m && Math.abs(uaSents[c + 1].start - t) <= Math.abs(uaSents[c].start - t)) c++;
      } else {
        c = m;
      }
      lo[i] = Math.max(0, c - AL_BAND);
      hi[i] = Math.min(m, c + AL_BAND);
    }
    lo[0] = 0;
    hi[n] = m;
    const W = 2 * AL_BAND + 2;
    const at = (i, j) => (j < lo[i] || j > hi[i] ? -1 : i * W + (j - lo[i]));
    const best = new Float64Array((n + 1) * W).fill(Infinity);
    const from = new Int8Array((n + 1) * W).fill(-1);
    best[at(0, 0)] = 0;
    for (let i = 0; i <= n; i++) {
      for (let j = lo[i]; j <= hi[i]; j++) {
        const base = best[i * W + (j - lo[i])];
        if (!isFinite(base)) continue;
        for (let k = 0; k < AL_MOVES.length; k++) {
          const p = AL_MOVES[k][0], q = AL_MOVES[k][1];
          if (i + p > n || j + q > m) continue;
          const to = at(i + p, j + q);
          if (to < 0) continue;
          const c = base + (p && q ? cost(i, p, j, q) : AL_DROP);
          if (c < best[to]) { best[to] = c; from[to] = k; }
        }
      }
    }

    // Walk the pairing back to read the blocks off, then apply them front to
    // back: a block may add to the bucket of a sentence an earlier block
    // already wrote to, and only in reading order does adding mean adding.
    const blocks = [];
    for (let i = n, j = m; i > 0 || j > 0;) {
      const cell = at(i, j);
      const k = cell < 0 ? -1 : from[cell];
      if (k < 0) break;   // unreachable: leave the rest empty rather than wrong
      const p = AL_MOVES[k][0], q = AL_MOVES[k][1];
      i -= p; j -= q;
      blocks.push([i, p, j, q]);
    }
    blocks.reverse();
    for (const [i, p, j, q] of blocks) {
      let units = [];
      for (let x = j; x < j + q; x++) units = units.concat(uaSents[x].units);
      if (!p) {
        // A translated sentence with no sentence of its own to sit under: it
        // reads as part of the one before it, which is where it goes.
        const t = out[i > 0 ? i - 1 : 0];
        t.units = t.units.concat(units);
      } else if (p === 1) {
        out[i].units = out[i].units.concat(units);
      } else {
        // One translated sentence over several English ones: split it by the
        // share of the English text each of them carries.
        const ec = enPre[i + p] - enPre[i] || 1;
        for (let x = 0; x < p; x++) {
          const a = (enPre[i + x] - enPre[i]) / ec;
          const b = (enPre[i + x + 1] - enPre[i]) / ec;
          out[i + x].units = out[i + x].units.concat(sliceByChars(units, a, b));
        }
      }
    }
    return out;
  }

  // ---- Pointing at a phrase --------------------------------------------
  //
  // A long sentence reads fine until one place in it does not, and then the
  // work is finding that place again in the translation below. Pointing at it
  // should answer that, and the unit of the answer is a PHRASE, never a word:
  // "an apple" is "яблуко", and no local rule can pair those two — English and
  // Ukrainian share neither roots nor alphabet, so a word-level pairing needs a
  // dictionary, a network call and a host permission. A phrase between commas
  // is what the data can honestly support.
  //
  // Which makes this the same problem as fitting a translation to its source,
  // one floor down — so it is the same solver: alignSentences knows nothing
  // about sentences, it is a monotone DP over two arrays of {start, units,
  // full}. Measured on a real track (f_N3PGvnVKg, 2026-08-03): of the sentences
  // longer than one screen line, 69% carry two or more phrases, and of 86
  // targets not one came out with an empty translation.
  const CHUNK_END_RE = /[,;:—–]$/;
  const CHUNK_TRAIL_RE = /["»”'’)\]]+$/;

  // A phrase ends where a WORD ends with one of those marks. Reading the word
  // rather than the character is what keeps 1,500 and 3:45 whole for free.
  function splitIntoChunks(text) {
    const words = String(text == null ? '' : text).trim().split(/\s+/).filter(Boolean);
    const chunks = [];
    let cur = [];
    for (let i = 0; i < words.length; i++) {
      cur.push({ t: 0, text: words[i], i });
      if (CHUNK_END_RE.test(words[i].replace(CHUNK_TRAIL_RE, ''))) { chunks.push(cur); cur = []; }
    }
    if (cur.length) chunks.push(cur);
    // `start: 0` on every phrase is deliberate: it makes the aligner's time
    // anchor a constant, which is the honest reading of what we have. Inside a
    // sentence a translated word's onset is either interpolated (a line-level
    // track has no word times at all) or moved along with the word itself.
    // `units` are the phrase's WORDS so that sliceByChars can really divide a
    // merged phrase — handed an empty array it returns nothing, and the text of
    // every 2:1 and 3:1 move would be lost. `i` is how the words are read back
    // afterwards: the objects travel through concat and sliceByChars unchanged.
    return chunks.map((ws) => ({ start: 0, units: ws, full: ws.map((w) => w.text).join(' ') }));
  }

  // When there is nothing finer to say, the sentence is one target: pointing
  // anywhere in it lights the whole translation. Which is worth having rather
  // than falling silent — with the UK chip off it is the only way to see the
  // line at all, and silence reads as a broken feature rather than as an
  // honest "no finer answer exists". A sentence gets here whenever EITHER side
  // lacks internal punctuation, and the translation is the common case: "In
  // 2014, my beautiful wife, Sandra, and I were expecting our first child."
  // carries four phrases, "У 2014 році ми з моєю прекрасною дружиною Сандрою
  // чекали на нашу першу дитину." carries none, and the gate is min(EN, UA).
  function wholeAsOne(enText, uaText) {
    const zeros = (s) => s.split(/\s+/).filter(Boolean).map(() => 0);
    return { count: 1, enOf: zeros(enText), uaOf: zeros(uaText) };
  }

  // Targets of one sentence: the phrases it can be pointed at, in word-index
  // form for each side.
  function buildChunkPairs(enText, uaText) {
    const enC = splitIntoChunks(enText), uaC = splitIntoChunks(uaText);
    if (enC.length < 2 || uaC.length < 2) return wholeAsOne(enText, uaText);
    const buckets = alignSentences(uaC, enC);   // one bucket per English phrase

    // Pointing must never answer with nothing, so a phrase the aligner left
    // without a translation is not a target of its own: it joins the neighbour
    // that has one. Fewer targets than commas, but every one of them says
    // something.
    const groups = [];
    for (let i = 0; i < buckets.length; i++) {
      const words = buckets[i].units;
      if (!words.length && groups.length) { groups[groups.length - 1].en.push(i); continue; }
      groups.push({ en: [i], ua: words.map((w) => w.i) });
    }
    while (groups.length > 1 && !groups[0].ua.length) {
      groups[1].en = groups[0].en.concat(groups[1].en);
      groups.shift();
    }
    if (groups.length < 2) return wholeAsOne(enText, uaText);

    // Word index -> target, for both sides, which is all the renderer needs: it
    // walks its own words and asks which target each of them belongs to.
    const enOf = [], uaOf = [];
    groups.forEach((g, gi) => {
      for (const ci of g.en) for (const w of enC[ci].units) enOf[w.i] = gi;
      for (const wi of g.ua) uaOf[wi] = gi;
    });
    return { count: groups.length, enOf, uaOf };
  }

  // Lazy on purpose: nothing here runs until the reader points at a sentence,
  // so the render loop and the caption build stay exactly as cheap as they are.
  function chunkPairs(i) {
    if (i < 0 || i >= sentences.length) return null;
    if (Object.prototype.hasOwnProperty.call(chunkCache, i)) return chunkCache[i];
    const uaS = uaSentences[i];
    const pairs = uaS && uaS.units.length
      ? buildChunkPairs(joinUnits(sentences[i].units), joinUnits(uaS.units))
      : null;
    chunkCache[i] = pairs;
    return pairs;
  }

  // Free reading shows lines, not sentences, and a line may start mid-sentence
  // (too long, too slow) or hold two short ones. So the translation is aligned
  // once, per sentence, and the lines then take their share of it: a line gets
  // the part of a sentence's translation matching the part of the sentence's own
  // text it shows. Both partitions are built from the same word array, so the
  // overlap is counted in words rather than guessed from timestamps.
  function spreadToLines(uaSents, enSents, enLines) {
    const lines = enLines.map((l) => ({ start: l.start, end: l.end, units: [] }));
    let li = 0, lineAt = 0, sentAt = 0;
    for (let si = 0; si < enSents.length; si++) {
      const u = enSents[si].units;
      // Character offset at every word boundary of this sentence, so a line's
      // slice of it is two lookups.
      const cum = new Float64Array(u.length + 1);
      for (let x = 0; x < u.length; x++) cum[x + 1] = cum[x] + Math.max(1, textLen(u[x].text));
      const total = cum[u.length] || 1;
      const sa = sentAt, sb = sentAt + u.length;
      // Rewind is never needed: lines and sentences both run forward.
      while (li < lines.length && lineAt + enLines[li].units.length <= sa) {
        lineAt += enLines[li].units.length; li++;
      }
      let k = li, at = lineAt;
      while (k < lines.length && at < sb) {
        const la = at, lb = at + enLines[k].units.length;
        const from = Math.max(la, sa), to = Math.min(lb, sb);
        if (to > from) {
          const part = sliceByChars(uaSents[si].units, cum[from - sa] / total, cum[to - sa] / total);
          if (part.length) lines[k].units = lines[k].units.concat(part);
        }
        at = lb; k++;
      }
      sentAt = sb;
    }
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
    if (adNow()) return;   // never hold a pause against an ad
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
    // This one is also the `play` listener, and an ad starting to play fires it
    // — which is exactly how a stop meant for our sentence ended up scheduled
    // against the spot's clock.
    if (stopAt == null || !video || video.paused || adNow()) return;
    const left = (stopAt - video.currentTime) / (video.playbackRate || 1);
    // Inside the lead there is nothing left to aim early with: aim at the mark.
    const ms = Math.max(0, left > STOP_LEAD ? left - STOP_LEAD : left) * 1000;
    stopTimer = setTimeout(() => hitStop('timer'), ms);
  }
  function hitStop(who) {
    clearTimeout(stopTimer); stopTimer = null;
    if (adNow()) return;   // that time belongs to the spot, not to a sentence
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
    if (!state.reader || !sentences.length || !video || adNow()) return;
    const t = video.currentTime || 0;
    const i = findSentenceAt(t);
    if (i !== sentIdx) { sentIdx = i; lastSig = null; }
    stopAt = liveStop(t);
    sentenceDone = false;   // the playhead moved: nothing is waiting to be replayed
    armStop();
  }

  function onSeeked() {
    if (suppressSeek) { suppressSeek = false; return; }
    if (adNow()) return;   // the ad's own seeks are not ours to answer
    resync();
  }

  // ---------- the two edges of an ad ----------
  function onAdStart() {
    adSentIdx = sentIdx;
    // The stop timer is scheduled in real milliseconds against a clock that has
    // just been swapped underneath it. Left armed it fires inside the spot and
    // pauses it — and guardPause would then hold that pause for a quarter
    // second against the player's own attempts to carry on.
    clearTimeout(stopTimer); stopTimer = null;
    stopAt = null;
    adResumePending = false;
    if (panel) panel.classList.add('ytds-ad');
    dbg('ad started — the reader steps aside');
  }

  // True once the element is the video we have subtitles for again. When
  // `ad-showing` clears, the element can still hold the spot's duration for
  // another beat, and writing currentTime then lands inside the ad instead of
  // inside our sentence. It also covers an ad pod for free: between two spots
  // the duration is still an ad's, so we simply do not come back yet.
  function contentBack() {
    const dur = video && video.duration;
    if (!dur || !isFinite(dur)) return false;
    if (!sentences.length) return true;
    return dur >= sentences[sentences.length - 1].end - 1;
  }

  function onAdLeave() {
    // The panel returns first and unconditionally: it is what the user is
    // waiting for, and it does not depend on the clock being trustworthy yet.
    if (panel) panel.classList.remove('ytds-ad');
    dbg('ad over');
    // An ad's player response carries no caption tracks of ours, so loadCaptions
    // deliberately left availability alone if it was answered during the spot.
    // This is the first moment the real question can be asked.
    if (availability === 'unknown' && !captionsReady) loadCaptions();
    if (!state.reader) return;
    adResumePending = true;
    adWaitUntil = performance.now() + 3000;
  }

  function tryAdResume() {
    // Bounded on purpose: on a video whose captions stop long before it does,
    // contentBack() may never hold, and a frozen reader with no way out would
    // be worse than resuming a beat early.
    if (!contentBack() && performance.now() < adWaitUntil) return;
    adResumePending = false;
    if (!state.reader) return;
    applySpeed();   // first — armStop computes its timer from playbackRate
    if (state.study && sentences.length && adSentIdx >= 0) {
      // A sentence half-heard before the ad and half after is not a repetition,
      // it is noise. Free reading has no such unit, so it just picks up where
      // the video is.
      playSentence(adSentIdx);
      dbg(`reader back — replaying sentence ${adSentIdx + 1}`);
    } else {
      resync();
      dbg('reader back');
    }
  }

  // Called from loop() while the reader is open, so the panel steps aside in
  // the same frame the ad starts; and from tick() otherwise, where once a
  // second is plenty for the things that still matter with the reader closed.
  function pumpAd() {
    const now = adNow();
    if (now !== adWas) {
      adWas = now;
      if (now) onAdStart(); else onAdLeave();
    }
    if (adResumePending && !now) tryAdResume();
    return now;
  }

  // Begin shadowing at whatever sentence the playhead is currently in.
  function armStudy() {
    if (!video || !sentences.length || adNow()) return;
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
    put({ [MARKS_KEY]: marks });
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
    // The guard belongs here too, not only in rateDrifted: tick() calls this on
    // every video change while the reader is open, and a pre-roll is exactly
    // when that lands.
    if (adNow()) return;
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
  // An ad has no drift to speak of: its rate is its own business, and putting
  // ours back onto a spot is both wrong and the kind of interference nobody
  // wants a subtitle extension doing.
  const rateDrifted = () => !!video && !adNow() && Math.abs(video.playbackRate - (state.speed || 1)) > 0.01;
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
  // A track either times every word or only whole caption lines, and nothing in
  // the response says which — the shape of the units is the only witness. ASR
  // tracks hand out one word per segment, hand-made ones one line (measured on
  // f_N3PGvnVKg: the ASR track is 100% single-word units, the manual one 0.7%).
  // The two are that far apart, so the threshold does not have to be clever.
  function wordLevelTrack(units) {
    if (units.length < 8) return true;   // too little to judge: keep the reveal
    let one = 0;
    for (const u of units) if (!/\s/.test(String(u.text).trim())) one++;
    return one > units.length * 0.6;
  }

  // ---------- sound cues ----------
  // Tracks carry lines nobody says out loud: [applause], [Music], (laughs), a
  // bare ♪ between verses. They are not material to shadow, and until now they
  // were sentences like any other — on the TED talk that prompted this,
  // SENTENCE 1 / 129 was "[applause]", and the aligner then had to find it a
  // partner in the translation and dragged the start of a real phrase along
  // with it (measured from two screenshots, 2026-08-03).
  //
  // The test is structural and never a word list: the source track can be in
  // any language, and `applause, music, laughter` would miss [Музика] and [拍手]
  // on the first foreign video. Brackets mean the same thing in all of them.
  const CUE_SQUARE_RE = /\[[^\]]*\]/g;
  const CUE_NOTES_RE = /[♪♫]/g;
  // ">>" opening a line is the captioning convention for "a different person
  // is speaking now". It is punctuation about the transcript, not words anyone
  // said, and it lands in the reader as the first thing on screen (spotted in
  // the wild 2026-08-03: ">> In 2014, my beautiful wife…"). Only at the START,
  // and only the ASCII form: "»" is a closing quote in half the languages this
  // has to survive, Ukrainian among them.
  const CUE_SPEAKER_RE = /^\s*>>+\s*/;
  // Round brackets are the careful half, and the only place this can eat real
  // speech. Square ones are YouTube's own convention for non-speech and never
  // hold spoken words, so they come out wherever they sit — including a long
  // [upbeat instrumental music playing]. Round ones do appear inside speech —
  // "I went there (in 2014) and…" — so they count only when they are the WHOLE
  // unit and hold at most two words: (laughs) and (upbeat music) go, a spoken
  // "(and I mean it)" stays.
  const CUE_ROUND_ONLY_RE = /^\s*\(([^)]*)\)\s*$/;
  const CUE_ROUND_MAX_WORDS = 2;

  function stripCues(text) {
    const s = String(text == null ? '' : text);
    const round = CUE_ROUND_ONLY_RE.exec(s);
    if (round && round[1].trim().split(/\s+/).filter(Boolean).length <= CUE_ROUND_MAX_WORDS) return '';
    return s.replace(CUE_SPEAKER_RE, '').replace(CUE_SQUARE_RE, ' ')
      .replace(CUE_NOTES_RE, ' ').replace(/\s+/g, ' ').trim();
  }

  // Units keep their identity — only the text changes — so the timing model
  // sees what it always saw, minus the lines that were never speech. Dropping a
  // unit only ever WIDENS the silence around it, and the rule that reads
  // silence (a gap of 1.4 s closes a sentence) is safe in that direction.
  // `textLen` is the emptiness test because it already counts letters and
  // digits in any script: /[^\p{L}\p{N}']/gu.
  function dropCues(units) {
    const out = [];
    for (const u of units) {
      const text = stripCues(u.text);
      if (!textLen(text)) continue;
      out.push(text === u.text ? u : { ...u, text });
    }
    return out;
  }

  function finishBuild(enRaw, uaRaw, sameLang, gen) {
    if (gen !== loadGen) { dbg('build finished after a newer load began — dropping it'); return true; }
    // Before the split, so that nothing downstream — sentences, lines, the
    // aligner — ever sees a cue. This is the one place both paths meet, cached
    // and fetched, which is also why the cache never needs clearing for it:
    // what sits on disk stays raw and is filtered on every build.
    const enClean = dropCues(enRaw);
    // Logged even when it is zero: otherwise "the filter found nothing" and
    // "the filter never ran" look identical, and only one of them is fine.
    dbg(`sound cues: ${enRaw.length - enClean.length} of ${enRaw.length} units filtered out`);
    if (!enClean.length) {
      availability = 'cues';
      dbg('every unit on this track is a sound cue — nothing to read here');
      setStatus('these subtitles are only sound cues');
      return true;
    }
    const enUnits = splitUnitsByPunct(enClean);
    const uaUnits = sameLang ? enUnits : splitUnitsByPunct(dropCues(uaRaw));
    wordLevel = wordLevelTrack(enUnits);

    // Sentences first: the translation is aligned to them, and the lines then
    // take their share of that one alignment.
    enLines = groupUnitsToLines(enUnits);
    sentences = buildSentences(enUnits);
    const uaSents = sameLang ? sentences : splitIntoSentences(uaUnits);
    uaSentences = sameLang ? sentences : alignCovered(uaSents, sentences);
    uaLines = sameLang ? enLines : spreadToLines(uaSentences, sentences, enLines);
    sentIdx = 0; stopAt = null; sentenceDone = false;
    enUnitLen = enUnits.length; uaUnitLen = uaUnits.length;
    lastSig = null; lastIdx = -1;
    dbg(`ready: source ${enUnits.length} units / ${enLines.length} lines · ${sentences.length} sentences · ` +
        `${state.targetLang.toUpperCase()} ${uaUnits.length} units / ${uaSents.length} sentences · ` +
        `${wordLevel ? 'word-level track: reveal word by word (recorded onsets)'
                     : 'line-level track: reveal word by word (interpolated, visual only)'}`);
    if (!sameLang) {
      const blank = uaSentences.reduce((k, s) => k + (s.units.length ? 0 : 1), 0);
      if (blank) dbg(`alignment: ${blank} of ${sentences.length} sentences got no translation`);
    }
    captionsReady = true;
    markAvailable();   // subtitles in hand is the last word on whether any exist
    updateStatus();
    renderKeys();   // study mode only owns the keys once there are sentences
    // The transcript is born here for the same reason the stage is: this is the
    // one place both paths meet, cached and fetched, so the list cannot end up
    // disagreeing with the stage about what a sentence is.
    listBuilt = false; listIdx = -1;
    ensureTranscript();
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
    sentences = []; uaSentences = []; chunkCache = {}; sentIdx = 0; stopAt = null; sentenceDone = false;
    // Without this the notches survive into the next video, and two videos of
    // the same length with the same sentence count would never redraw them.
    ticksDur = 0; ticksLen = -1;
    clearTimeout(stopTimer); stopTimer = null;
    awaitingCapture = false; pokePending = false;
    captureRetries = 0; sawTracks = false;
    availability = 'unknown';
    clearTimeout(captureTimer);
    clearDisplay();
    setStatus('loading…');
    dbg('--- loadCaptions for ' + currentVideoId);

    // A hit here is the strongest answer there is: we have read this video's
    // subtitles before and they are on disk.
    if (await buildFromCache()) return;

    if (capturedBase && capturedForVideo === currentVideoId) {
      dbg('using cached valid URL');
      if (await buildFromBase(capturedBase, capturedBody, capturedTlang)) return;
      dbg('cached URL failed (token may have expired)');
    }

    const { tracks, isLive, answered } = await requestTracks();
    // The one place the entry buttons learn there is nothing to open. Silence
    // leaves them alone: see requestTracks on why `answered` is separate.
    // Not while an ad is on. During a pre-roll the player can answer for the
    // spot, whose response carries no caption tracks of ours — and a single
    // 'none' settled there would grey the pill out for the whole video, on a
    // video that does have subtitles. onAdLeave asks again.
    if (answered && !adNow()) availability = isLive ? 'live' : (tracks.length ? 'ready' : 'none');
    dbg(`tracks from playerResponse: ${tracks.length}` +
        (tracks.length ? ' [' + tracks.map((t) => `${t.lang}${t.kind === 'asr' ? '/asr' : ''}`).join(', ') + ']' : '') +
        (isLive ? ' · live stream' : '') + (answered ? '' : ' · the player never answered'));
    if (isLive) {
      dbg('live stream: no finished track to time against — not offering the reader');
      setStatus('live streams have no finished subtitles yet');
      return;
    }
    if (tracks.length) {
      sawTracks = true;
      const src = pickSrc(tracks);
      srcLang = src.lang || '';
      if (await buildFromBase(src.baseUrl, null, '')) { dbg('direct fetch succeeded'); return; }
      dbg('direct fetch returned 0 → need interception');
    }

    // The player has spoken and it lists no tracks. Switching its CC on could
    // not produce a request for something that does not exist — it would only
    // leave the captions on. This used to run anyway, on the hope that
    // interception would turn something up.
    if (availability === 'none') {
      dbg('the player lists no caption tracks — nothing to enable, and nothing to wait for');
      setStatus('this video has no YouTube captions');
      return;
    }

    // Everything above this line is silent: it reads our own cache, fetches a
    // url the page already handed us, or listens in on a request the player was
    // making anyway. What is left is the loud part — switching the player's CC
    // on — and that is not a local act: YouTube remembers it for every video
    // after this one, and for the next session too. Running it on every watch
    // page meant installing the extension turned captions on for good, whether
    // or not the reader was ever opened (reported 2026-08-03: CC come on by
    // themselves now, and they are in the way). So it waits for the overlay,
    // the one moment captions are actually wanted. Interception stays armed
    // either way — that part costs the player nothing: a
    // user who has CC on for their own reasons is captured for free.
    if (!state.reader) {
      pokePending = true;
      dbg('captions need the player switched on — holding off until the reader is opened');
      setStatus('open the reader to load captions');
      return;
    }
    pokePlayer();
  }

  // The loud half of loadCaptions, split out so enterReader can run it on its
  // own — by then the silent half has already had its turn for this video.
  function pokePlayer() {
    pokePending = false;
    awaitingCapture = true;
    setStatus('enabling player captions…');
    dbg('→ asking player to enable CC (YTDS_ENABLE)');
    window.postMessage({ type: 'YTDS_ENABLE' }, '*');
    clearTimeout(captureTimer);
    captureTimer = setTimeout(() => {
      if (!awaitingCapture || captionsReady) return;
      awaitingCapture = false;
      window.postMessage({ type: 'YTDS_STOP_ENABLE' }, '*');
      if (sawTracks) {
        dbg('gave up: the player never returned usable captions for this track');
        // Not "switch CC off and on" any more: giving up restores the player's
        // captions to whatever they were before we asked, so half that
        // instruction can now be the half that does nothing.
        setStatus('the player returned no captions — try toggling CC in the player, or reload the page');
      } else {
        dbg('gave up: no caption tracks at all — the video likely has none');
        setStatus('this video has no YouTube captions');
      }
    }, 25000);
  }

  async function handleCaptured(url, body) {
    // Ads carry captions of their own. Taking one here would label the spot's
    // track as this video's — in capturedBase, and from there into the cache
    // under the video's id.
    if (adNow()) { dbg('intercepted timedtext during an ad — ignored'); return; }
    const base = reuseBase(url);
    const capTlang = (/[?&]tlang=([^&]*)/.exec(url) || [])[1] || '';
    const empty = !(body || '').length;

    // An empty answer is the url talking, not the track: the player built it
    // before its `pot` was ready, and a url without a valid one answers HTTP
    // 200 with 0 bytes for as long as it exists (measured on Opera, 2026-08-02
    // — nine rounds of retries, every one of them 0 bytes). Such a url is not
    // worth remembering: `capturedBase` is what a later language change reuses
    // instead of running the whole enable-and-wait dance, and a dead one there
    // would send that change straight into the same silence.
    if (!empty) {
      // Recorded even when we already have captions — from the cache, say.
      capturedBase = base; capturedBody = body; capturedTlang = capTlang; capturedForVideo = currentVideoId;
      // Half a megabyte of json3, dropped once it is genuinely redundant — and
      // only a SOURCE body ever is, because the source cache is what replaces
      // it. A TRANSLATED body is not covered by that cache, and it is the one
      // thing that makes switching to its language free: the player fetches it
      // on its own whenever the user has auto-translate on, and measured on
      // 2026-07-29 dropping it sent us back to the network for a track already
      // in hand.
      if (!capTlang && memCache.has(cacheKey('src'))) capturedBody = null;
    }
    if (captionsReady) return;

    // No body AND no token in the url: there is nothing here to fetch with, and
    // asking anyway spends a request on a quota that answers 429. An empty body
    // with a token is a different story — the translation can be missing over a
    // source that is perfectly there — so that one still gets its try.
    if (empty && !/[?&]pot=/.test(url)) {
      dbg('captured url has no pot and answered with nothing — waiting for the player to mint a fresh one');
      return;
    }

    if (!(await buildFromBase(base, body, capTlang))) {
      dbg(`capture had no usable EN (body=${(body || '').length} bytes)` +
          (empty ? ' — an empty url never recovers, waiting for a fresh one'
                 : ' — retrying the same URL'));
      // Retrying an empty url is what the enable loop's off→on toggle is for;
      // this retry only ever helps the case where the BODY was the problem.
      if (!empty) scheduleCaptureRetry();
      return;
    }
    // It worked despite the player's own answer being empty, so the url is
    // proven after all and worth keeping for the next language change.
    if (empty) {
      capturedBase = base; capturedBody = null; capturedTlang = ''; capturedForVideo = currentVideoId;
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
    // First in the frame, before anything reads the clock. An ad frame is
    // therefore cheaper than an ordinary one: no controls, no guard, no render.
    if (pumpAd()) return;
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
      // `paused` is in the signature because stopping is what turns the
      // sentence into pointable phrases: without it the frame that stops looks
      // identical to the one before and the gate would eat the repaint.
      // The soft counts belong in the signature: on a line-level track enN
      // never moves, so without them the gate would eat every repaint and the
      // sentence would sit there fully lit from its first frame.
      const enW = softCount(enS, t);
      const uaW = softCountUa(enS, uaS, t);
      const sig = `S${sentIdx}:${enN}:${uaN}:${enW}:${uaW}:${state.showEn ? 1 : 0}${state.showUa ? 1 : 0}${video.paused ? 'P' : ''}`;
      if (sig === lastSig) return;
      const fresh = sentIdx !== lastIdx;
      lastSig = sig; lastIdx = sentIdx;
      renderStudy(enS, uaS, enN, uaN, fresh, enW, uaW);
      if (fresh) { updateCounter(); syncTranscript(); }
      return;
    }

    // Free reading: the rolling transcript — previous line dimmed above the
    // current one, which fills in word by word.
    const en = pickLine(enLines, t);
    // The translation is not searched for: it is the bucket that belongs to
    // this EN line, revealed as far as the EN line itself has got.
    const enLen = en.idx >= 0 ? enLines[en.idx].units.length : 0;
    const ua = revealAligned(uaLines, en.idx, enLen ? en.n / enLen : 0);
    const sig = `${en.idx}:${en.n}|${ua.idx}:${ua.n}|${state.showEn ? 1 : 0}${state.showUa ? 1 : 0}`;
    if (sig === lastSig) return;
    const fresh = en.idx !== lastIdx;
    lastSig = sig; lastIdx = en.idx;
    renderLines(en, ua, fresh);
    // Keep the counter (and the sentence the shadowing row would resume from)
    // honest even while we are not driving playback.
    if (fresh && sentences.length) { sentIdx = findSentenceAt(t); updateCounter(); syncTranscript(); }
  }

  // How many EN words of a sentence should be visible at time t.
  //
  // On a line-level track: all of them, from the first frame. The reveal walks
  // unit onsets, and there a unit is a whole caption line — so "word by word"
  // was really "line by line", half a sentence appearing at once and taking the
  // layout with it. The alternative is to invent the missing times by spreading
  // them across the characters, and an invented time shows a word before it is
  // spoken, which is worse than not pretending at all: a sentence is the unit
  // this mode works in anyway (it is what playback stops at, and what you
  // repeat), so on such a track it simply appears whole.
  function revealCount(s, t) {
    if (!s) return 0;
    if (!wordLevel) return s.units.length;
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
    // The translation follows the source, including the decision above: a
    // half-shown translation under a whole sentence is the same fragment
    // ("…можуть зойкнути," with nothing to finish it) read twice.
    if (!wordLevel) return uaS.units.length;
    const span = ((enS.stop != null ? enS.stop : enS.end) - enS.start) || 1;
    const p = clamp((t - enS.start) / span, 0, 1);
    return Math.max(1, Math.ceil(p * uaS.units.length));
  }

  // ---------- the soft reveal (line-level tracks only) ----------
  //
  // On a line-level track a unit is a whole caption line, so there are no word
  // times to walk — the reveal above hands back the entire sentence at once.
  // This puts the typing back, and it is honest about being VISUAL: the words
  // are placed by interpolating the sentence's own span across its characters,
  // not by any time YouTube recorded.
  //
  // What makes it safe is that it never changes the TEXT that is on screen. The
  // sentence is drawn whole from the first frame and the unspoken tail is only
  // made transparent, so the layout is settled before the first word appears —
  // which is precisely the fault that killed the previous attempt (2026-08-02:
  // half a sentence arriving at once and taking the line breaks with it).
  // Nothing here touches `stop`, segmentation or the alignment: they all still
  // work in units, and this counts words for the eye alone.
  function sentText(s) {
    if (s._text == null) s._text = joinUnits(s.units);
    return s._text;
  }

  function sentenceFrac(s, t) {
    if (!s) return 0;
    // Against `stop`, like the translation reveal: the last word then lands
    // exactly as playback pauses, instead of a beat after it.
    const span = ((s.stop != null ? s.stop : s.end) - s.start) || 1;
    return clamp((t + LEAD - s.start) / span, 0, 1);
  }

  // By characters rather than by word count, so "extraordinarily" is given more
  // of the sentence than "in" — the same way splitUnitsByPunct spreads a line.
  function wordsShown(text, frac) {
    const words = String(text).trim().split(/\s+/).filter(Boolean);
    if (!words.length) return 0;
    if (frac >= 1) return words.length;
    if (frac <= 0) return 0;
    const total = text.replace(/\s+/g, '').length || 1;
    let acc = 0, n = 0;
    for (const w of words) { acc += w.length; n++; if (acc / total >= frac) break; }
    return n;
  }

  // −1 means "not applicable": a word-level track reveals by real onsets, and
  // the value also sits in the frame signature, where −1 keeps it constant.
  function softCount(s, t) { return !s || wordLevel ? -1 : wordsShown(sentText(s), sentenceFrac(s, t)); }
  function softCountUa(enS, uaS, t) {
    return !uaS || !enS || wordLevel ? -1 : wordsShown(sentText(uaS), sentenceFrac(enS, t));
  }

  // Pointing at a phrase needs the sentence in pieces, and it is only offered
  // while playback is stopped ON A WHOLE sentence. Two reasons, and the second
  // is the real one: a pairing computed against half a sentence is a DIFFERENT
  // pairing, so it would answer confidently and wrongly. (On a line-level track
  // the sentence is whole from its first frame, so an ordinary pause counts
  // there too — which is why this asks the reveal rather than `sentenceDone`.)
  function pointable(enS, enN) {
    return !!(video && video.paused && enS && enN >= enS.units.length && !adNow());
  }

  // Two fixed zones split by the hairline: EN sits just ABOVE it (grows
  // upward, its baseline never moves), the translation just below.
  function renderStudy(enS, uaS, enN, uaN, fresh, enW, uaW) {
    if (!elZoneEn) return;
    hideNote();
    const pairs = pointable(enS, enN) ? chunkPairs(sentIdx) : null;
    // On a line-level track the slice is the whole sentence anyway; the soft
    // count then decides how much of it is visible. Phrases win when they are
    // offered — by then playback has stopped and every word is out.
    const enWords = enS ? joinUnits(enS.units.slice(0, enN)) : '';
    const uaWords = uaS ? joinUnits(uaS.units.slice(0, uaN)) : '';
    paint(elZoneEn, 'ytds-en', state.showEn && enS
      ? [{ text: enWords, fresh, chunks: pairs && pairs.enOf, words: pairs ? -1 : enW }] : []);
    // The translation zone is painted even with the UK chip off, hidden by
    // class rather than left empty: that is what lets one phrase appear on
    // demand, and appear in the PLACE it holds in the line. Hover then only
    // ever toggles classes — it can never reach the render loop.
    // Past the end of YouTube's translation the zone says why it is empty. Only
    // there: a single sentence the aligner left without a partner is a normal
    // gap and does not deserve an announcement on every one of them.
    const beyond = !!(enS && enS.start > uaCoverEnd);
    if (beyond && state.showUa && !pairs) {
      paint(elZoneUa, 'ytds-ua ytds-ua-none',
        [{ text: `YouTube's translation ends at ${fmtTime(uaCoverEnd)}` }]);
    } else {
      paint(elZoneUa, 'ytds-ua', (state.showUa || pairs) && uaS
        ? [{ text: uaWords, fresh, chunks: pairs && pairs.uaOf, words: pairs ? -1 : uaW }] : []);
    }
    elZoneUa.classList.toggle('ytds-ua-off', !state.showUa);
    elStage.classList.toggle('ytds-pointable', !!pairs);
    elStage.classList.toggle('ytds-one-target', !!pairs && pairs.count === 1);
    // Only where there is a CHOICE of phrases: on a sentence that is one
    // target the line says "point at a phrase" and there is only the whole of
    // it to point at, which teaches the wrong thing on first sight.
    if (pairs && pairs.count > 1) hintOnce();
  }

  function renderLines(en, ua, fresh) {
    if (!elZoneEn) return;
    hideNote();
    paint(elZoneEn, 'ytds-en', state.showEn ? lineItems(enLines, en, fresh) : []);
    paint(elZoneUa, 'ytds-ua', state.showUa ? lineItems(uaLines, ua, fresh) : []);
    // Free reading shows lines, and lines are aligned by a different route
    // (spreadToLines), so there are no phrases to point at here. Both marks
    // are dropped rather than left over from the mode before.
    elZoneUa.classList.remove('ytds-ua-off');
    elStage.classList.remove('ytds-pointable');
  }

  // The previous line (dimmed) plus the current one, revealed word by word.
  function lineItems(lines, sel, fresh) {
    if (sel.idx < 0) return [];
    const items = [];
    if (sel.idx > 0) items.push({ text: lines[sel.idx - 1].full, dim: true });
    items.push({ text: joinUnits(lines[sel.idx].units.slice(0, sel.n)), fresh });
    return items;
  }

  // One span per phrase, carrying the target it belongs to. Words the pairing
  // does not know (it is built from the whole sentence, the reveal may be
  // showing less) go in a span of their own with no target, so they are never
  // silently attached to a neighbour's answer.
  function chunkSpans(line, text, ofWord) {
    const words = text.split(/\s+/).filter(Boolean);
    let at = 0;
    while (at < words.length) {
      const g = ofWord[at];
      let to = at;
      while (to + 1 < words.length && ofWord[to + 1] === g) to++;
      const span = el('span', 'ytds-chunk', words.slice(at, to + 1).join(' '));
      if (g != null) span.dataset.g = String(g);
      line.appendChild(span);
      // The space between two phrases stays OUTSIDE both, or the highlight
      // would run a space past its last word and touch the next phrase.
      if (to + 1 < words.length) line.appendChild(document.createTextNode(' '));
      at = to + 1;
    }
  }

  // One span per word, the whole sentence every time. What changes between
  // frames is which spans are lit — the line breaks are settled from the first
  // frame, so nothing below the text can move as the speaker talks.
  function wordSpans(line, text, shown) {
    const words = String(text).trim().split(/\s+/).filter(Boolean);
    words.forEach((w, i) => {
      line.appendChild(el('span', 'ytds-word' + (i < shown ? '' : ' ytds-unsaid'), w));
      if (i + 1 < words.length) line.appendChild(document.createTextNode(' '));
    });
  }

  // `fresh` only on a new line/sentence: the node is rebuilt on every word, so
  // carrying the class over would replay the entrance animation each time.
  function paint(zone, cls, items) {
    // The spans a highlight was living on are about to be thrown away, so the
    // memory of it has to go too — otherwise pointing back at the same phrase
    // is a no-op and it never lights again.
    litChunk = null;
    if (elStage) elStage.classList.remove('ytds-pointing');
    zone.textContent = '';
    for (const it of items) {
      const block = el('div', 'ytds-block' + (it.dim ? '' : ' ytds-active') + (it.fresh ? ' ytds-fresh' : ''));
      if (it.chunks) {
        const line = el('span', 'ytds-line ' + cls);
        chunkSpans(line, it.text, it.chunks);
        block.appendChild(line);
        zone.appendChild(block);
        continue;
      }
      if (it.words != null && it.words >= 0) {
        const line = el('span', 'ytds-line ' + cls);
        wordSpans(line, it.text, it.words);
        block.appendChild(line);
        zone.appendChild(block);
        continue;
      }
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

  // Whether the keys belong to a field rather than to study mode. Checked on
  // the event target, so it covers anything focusable we may add later without
  // that thing having to know the hotkeys exist.
  function isTyping(node) {
    if (!node || !node.tagName) return false;
    const tag = node.tagName.toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || node.isContentEditable === true;
  }

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
    // The stage and the transcript share one row, so opening the list narrows
    // the stage instead of covering it — that is the whole difference between
    // this and the settings drawer, which floats above everything.
    const body = el('div', 'ytds-body');
    body.append(buildStage(), buildAside());
    panel.append(buildTop(), body, buildStudyRow(), buildControls(), buildDrawer(),
                 buildSimExit(), elHint);
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

    btnVideo = mkBtn('ytds-pill ytds-pill-text', 'Video mode: keep the picture, with the text over it',
      () => toggleKey('videoMode'), icon('screen'), el('span', null, 'Video'));
    btnVideo.dataset.key = 'videoMode';

    // A named pill beside the other two modes, not an unlabelled icon among the
    // themes and the gear: it turns a whole column of the screen on and off, and
    // as an icon it was not read as the thing that does that.
    btnTranscript = mkBtn('ytds-pill ytds-pill-text', 'Transcript: every sentence of this video',
      () => toggleKey('transcript'), icon('list'), el('span', null, 'Transcript'));
    btnTranscript.dataset.key = 'transcript';

    const left = el('div', 'ytds-top-side');
    left.append(segLang, mkLangMenu(), mkFontSeg(), btnStudy, btnVideo, btnTranscript);

    btnFocus = mkBtn('ytds-icon ytds-focus-btn', 'Focus mode: hide everything but the text (move the mouse to bring it back)',
      () => { toggleKey('focus'); if (state.focus) showHint('Move the mouse to bring the controls back'); }, icon('eye'));
    btnFocus.dataset.key = 'focus';

    const right = el('div', 'ytds-top-side ytds-right');
    right.append(
      buildSwatches(),
      btnFocus,
      mkBtn('ytds-icon ytds-settings', 'Settings', openDrawer, icon('settings')),
      mkBtn('ytds-icon', 'Exit (Esc)', exitReader, icon('close'))
    );

    const top = el('div', 'ytds-top');
    top.append(left, right);
    return top;
  }

  function buildStage() {
    elZoneEn = el('div', 'ytds-zone ytds-zone-en');
    elZoneUa = el('div', 'ytds-zone ytds-zone-ua');
    elNote = el('div', 'ytds-note');
    elNote.style.display = 'none';

    elStage = el('div', 'ytds-stage');
    elStage.append(elZoneEn, el('div', 'ytds-rule'), elZoneUa, elNote, buildResumeCard());

    // One listener for the whole stage rather than one per phrase: the
    // sentence is rebuilt on every revealed word, and per-span listeners would
    // be re-attached that many times. Nothing here reads geometry, and nothing
    // here can reach the render loop — pointing only ever moves classes.
    elStage.addEventListener('mouseover', (e) => {
      const t = e.target;
      if (!t || !t.closest) return;
      const span = t.closest('.ytds-chunk');
      if (span) { lightChunk(span.dataset.g != null ? span.dataset.g : null); return; }
      // The bare space between two phrases belongs to neither. Letting it
      // clear the highlight would blink it off every time the cursor crosses
      // a word boundary, so inside a line nothing is cleared.
      if (t.closest('.ytds-line')) return;
      lightChunk(null);
    });
    elStage.addEventListener('mouseleave', () => lightChunk(null));
    return elStage;
  }

  function lightChunk(g) {
    if (g === litChunk) return;
    litChunk = g;
    if (!elStage) return;
    elStage.querySelectorAll('.ytds-chunk.ytds-lit').forEach((n) => n.classList.remove('ytds-lit'));
    elStage.classList.toggle('ytds-pointing', g != null);
    if (g == null) return;
    elStage.querySelectorAll(`.ytds-chunk[data-g="${g}"]`).forEach((n) => n.classList.add('ytds-lit'));
  }

  // Said once per page session, and only where there is something to point at:
  // the phrases carry no permanent marking, so without a word the first time
  // the whole feature is invisible.
  let hintedPointing = false;
  function hintOnce() {
    if (hintedPointing) return;
    hintedPointing = true;
    showHint('Point at a phrase to see its translation');
  }

  // ---------- transcript panel ----------

  // Every sentence of the video, listed beside the stage. The unit is OUR
  // sentence — the one playback stops at, Repeat repeats and the counter counts
  // — and not a caption line: YouTube's own transcript already lists those, so
  // a list of lines would be a worse copy of something the page already has.
  function buildAside() {
    elList = el('div', 'ytds-list');
    // One listener for the whole list rather than one per block: a long video
    // runs to thousands of them, and they are rebuilt on every caption load.
    elList.addEventListener('click', (e) => {
      const cue = e.target && e.target.closest && e.target.closest('.ytds-cue');
      if (!cue) return;
      const i = Number(cue.dataset.i);
      if (!Number.isFinite(i)) return;
      setFollow(true);   // a click is a request to be back with the player
      playSentence(i);
    });
    // Scrolling by hand takes the list out of the player's hands. Our own
    // scrollTop write fires this event too — hence the guard, without which
    // following would switch itself off on the very first sentence.
    elList.addEventListener('scroll', () => {
      if (performance.now() - selfScrollAt < 150) return;
      setFollow(false);
    });
    elFollow = mkBtn('ytds-sbtn ytds-follow', 'Follow the player again',
      () => { setFollow(true); scrollToActive(); }, icon('chevD'), el('span', null, 'Follow'));
    elAside = el('div', 'ytds-aside');
    elAside.append(elList, elFollow);
    return elAside;
  }

  function setFollow(on) {
    if (following === on) return;
    following = on;
    if (elAside) elAside.classList.toggle('ytds-lost', !on);
  }

  // Built lazily: a closed panel costs nothing, and a video watched without
  // opening it should not pay for thousands of nodes nobody asked to see.
  //
  // On a four-hour video (ikqTTXVRVog) that build is long enough for the button
  // to look dead. Saying "working on it" does not fix that on its own: the
  // build blocks the main thread, so a class set immediately before it would
  // never get painted. Hence two frames — one for the browser to draw the busy
  // state, one to be sure it did — and only then the work.
  const LIST_ASYNC_FROM = 400;   // fewer than this and the build beats a frame
  function ensureTranscript() {
    if (!elList || !state.transcript || !captionsReady || listBuilt || listBuilding) return;
    if (sentences.length < LIST_ASYNC_FROM) { renderTranscript(); return; }
    listBuilding = true;
    setListBusy(true);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      // Two frames is long enough for the video, the language or the panel to
      // have moved on — the conditions are asked again, not assumed.
      if (elList && state.transcript && captionsReady && !listBuilt) renderTranscript();
      listBuilding = false;
      setListBusy(false);
    }));
  }

  function setListBusy(on) {
    if (!btnTranscript) return;
    btnTranscript.classList.toggle('ytds-busy', on);
    btnTranscript.disabled = on || !sentences.length;
  }

  function renderTranscript() {
    const t0 = performance.now();
    elList.textContent = '';
    listIdx = -1;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < sentences.length; i++) {
      const s = sentences[i];
      const ua = uaSentences[i];
      const cue = el('div', 'ytds-cue');
      cue.dataset.i = String(i);
      cue.append(el('div', 'ytds-cue-time', fmtTime(s.start)),
                 el('div', 'ytds-cue-en', joinUnits(s.units)));
      // A sentence with no translation gets no second block at all, rather than
      // an empty one: a rough auto-translation does leave gaps (the aligner
      // logs them), and a blank line reads as a broken block instead of as
      // text that is simply not there.
      const uaText = ua ? joinUnits(ua.units) : '';
      if (uaText) cue.appendChild(el('div', 'ytds-cue-ua', uaText));
      frag.appendChild(cue);
    }
    elList.appendChild(frag);
    listBuilt = true;
    // The number is here to be compared later: this is the one place in the
    // reader whose cost grows with the length of the video.
    dbg(`transcript: ${sentences.length} sentences listed in ${Math.round(performance.now() - t0)} ms`);
  }

  // Called from exactly where updateCounter() is called — under the frame gate,
  // so at most once per sentence. It reads no clock and measures no geometry
  // beyond the one block it moves to: the render loop stays as cheap as it was.
  function syncTranscript() {
    if (!listBuilt || sentIdx === listIdx) return;
    const prev = listIdx >= 0 ? elList.children[listIdx] : null;
    if (prev) prev.classList.remove('ytds-cur');
    listIdx = sentIdx;
    const cur = elList.children[listIdx];
    if (cur) cur.classList.add('ytds-cur');
    if (following) scrollToActive();
  }

  function scrollToActive() {
    const cur = listIdx >= 0 && elList ? elList.children[listIdx] : null;
    if (!cur) return;
    // A third of the way down, not centred: what is coming is worth more of the
    // panel than what has already been said.
    selfScrollAt = performance.now();
    elList.scrollTop = Math.max(0, cur.offsetTop - elList.clientHeight * 0.34);
  }

  // ---------- video mode ----------

  // Nothing is reparented: the player stays exactly where YouTube put it and is
  // handed a box. With the PAGE in fullscreen (see enterReader) it is already
  // inside what the browser is showing, so the only thing between it and the
  // eye is our own opaque background — which this mode takes away.
  //
  // Measured on a live watch page 2026-08-04: forced to 70vw × 100vh the player
  // becomes 1344×961 and re-fits its <video> to 1344×756, centred — and that
  // fit survives a seek, a quality change and a window resize with our
  // `position: fixed` still in place.
  function applyVideoMode() {
    const p = hookedPlayer || document.getElementById('movie_player');
    if (!p) return;
    const want = !!(state.reader && state.videoMode);
    // During an ad the player's own controls come back: Skip Ad lives in that
    // chrome, and hiding it to spare the user two rows of buttons is not worth
    // trapping them in a spot they cannot skip. The box stays as it is.
    document.documentElement.classList.toggle('ytds-vmode', want && !adNow());
    if (!want) {
      if (playerStyleWas == null) return;
      if (playerStyleWas) p.setAttribute('style', playerStyleWas);
      else p.removeAttribute('style');
      playerStyleWas = null;
      fitPlayer();
      dbg('video mode off — player geometry given back');
      return;
    }
    if (playerStyleWas == null) {
      playerStyleWas = p.getAttribute('style') || '';
      dbg('video mode on — player geometry taken over');
    }
    // The transcript keeps its column; with it closed the picture takes the width.
    const aside = state.transcript && elAside ? elAside.getBoundingClientRect().width : 0;
    const box = {
      position: 'fixed', left: '0px', top: '0px', margin: '0px',
      width: Math.max(160, Math.round(window.innerWidth - aside)) + 'px',
      height: '100vh', zIndex: '2147483000'
    };
    // Written only where it differs: this runs from tick() once a second, and
    // YouTube rewriting the element's style is exactly what we want to undo —
    // but rewriting our own values every second would re-fit the video forever.
    let changed = false;
    for (const k in box) if (p.style[k] !== box[k]) { p.style[k] = box[k]; changed = true; }
    if (changed) fitPlayer();
  }

  // Only the player can re-lay the <video> inside its box, and `setSize` is its
  // own method — it exists in the MAIN world alone, where injected.js lives:
  // the content script can see the element but not what YouTube hung on it.
  // The resize event goes too, because that is what the player listens to
  // anyway, and it costs nothing when setSize has already done the work.
  function fitPlayer() {
    window.postMessage({ type: 'YTDS_FIT_PLAYER' }, '*');
    window.dispatchEvent(new Event('resize'));
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
    elCounter = el('div', 'ytds-counter');

    elControls = el('div', 'ytds-controls');
    elControls.append(
      mkBtn('ytds-icon', 'Back 10s', () => seekBy(-10), icon('rewind')),
      elPlay,
      mkBtn('ytds-icon', 'Forward 10s', () => seekBy(10), icon('forward')),
      mkSpeedMenu(),
      elTime,
      elCounter,
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
  // The drawer's Playback group. It earns its place there by the rule the
  // drawer is built on — what you set once and never touch while watching.
  // The steps carry names rather than milliseconds: the number means nothing
  // to the ear, and the only way to choose is to hear the difference.
  function buildPlaybackGroup() {
    const field = el('div', 'ytds-field');
    inpTail = document.createElement('input');
    inpTail.type = 'number';
    inpTail.className = 'ytds-input';
    inpTail.min = String(TAIL_MIN);
    inpTail.max = String(TAIL_MAX);
    inpTail.step = '10';
    inpTail.title = `Milliseconds, ${TAIL_MIN}–${TAIL_MAX}. Default ${DEFAULTS.tailMs}.`;
    // On `change`, not on every keystroke: `input` fires per digit, so typing
    // 450 would apply 4, then 45 — three rebuilds and two of them nonsense.
    // Enter commits without leaving the field, because that is what a number
    // field is expected to do.
    inpTail.addEventListener('change', commitTail);
    inpTail.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commitTail(); } });
    field.append(inpTail, el('span', 'ytds-field-unit', 'ms'));

    btnTailReset = mkBtn('ytds-text-btn', 'Return the playback settings to their defaults', () => {
      for (const k of PLAYBACK_KEYS) state[k] = DEFAULTS[k];
      saveState(); restop(); syncUi();
    }, icon('replay'), txt('Reset playback settings'));
    const row = el('div', 'ytds-btn-row');
    row.appendChild(btnTailReset);
    return [
      el('div', 'ytds-setting-label', 'Sentence tail'),
      field,
      el('div', 'ytds-setting-note',
        `How long to keep playing after the last word is estimated to end, in milliseconds. `
        + `Raise it if endings sound cut off, lower it if the pause drags. `
        + `${DEFAULTS.tailMs} is the default.`),
      row
    ];
  }

  // An empty or unparseable field means "leave it alone" rather than zero:
  // clearing a box to retype is not a request for no tail at all.
  function commitTail() {
    const raw = parseInt(inpTail.value, 10);
    const ms = Number.isFinite(raw) ? clamp(Math.round(raw), TAIL_MIN, TAIL_MAX) : state.tailMs;
    const changed = ms !== state.tailMs;
    state.tailMs = ms;
    if (changed) { saveState(); restop(); }
    syncUi();   // always: the field must show what was actually accepted
  }

  function buildCopyLog() {
    const btn = mkBtn('ytds-text-btn', 'Copy the whole log to the clipboard', async () => {
      // A log without a version is a report nobody can place: the first line
      // says which build produced everything under it.
      const tag = versionTag();
      const text = (tag ? tag + '\n' : '') + [...elLog.children].map((n) => n.textContent).join('\n');
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

  // A stand, not a feature. Ads are the one path the author cannot reach —
  // a Premium account never shows one — so without this the whole ad branch
  // would be written blind and every later regression in it would be invisible.
  // It drives the same adNow() the real class does, which is the point: what is
  // exercised here is the code that runs for real, not a rehearsal of it.
  // Never persisted (see simulateAd): a debug flag that survives a reload is a
  // trap, and this one freezes the reader.
  let btnSimAd = null;   // the drawer's stand button, whose label follows the flag

  // One place sets the flag, because two controls turn it off: the drawer
  // button and the chip below. They must never disagree about the label.
  function setSimulateAd(on) {
    simulateAd = !!on;
    if (panel) panel.classList.toggle('ytds-sim', simulateAd);
    if (btnSimAd) {
      btnSimAd.textContent = simulateAd ? 'Stop simulating' : 'Simulate ad';
      btnSimAd.classList.toggle('ytds-ok', simulateAd);
    }
    // The edge is normally caught by loop(), which is not running while the
    // click that asked for it is still in flight — pump it here so the panel
    // reacts to that very click.
    pumpAd();
  }

  function buildSimulateAd() {
    btnSimAd = mkBtn('ytds-text-btn', 'Pretend a YouTube ad is playing, to check that the reader steps aside and comes back',
      () => setSimulateAd(!simulateAd), txt('Simulate ad'));
    return btnSimAd;
  }

  // The stand's way out, and the reason it needs one: everything inside the
  // panel goes visibility:hidden while an ad is on — including the drawer
  // button that started the simulation. Simulate ad was a one-way door, and
  // since the flag survives closing the reader, reopening it just showed an
  // invisible panel again; only a page reload cleared it.
  // Visible ONLY while simulating (`ytds-sim`), never during a real ad: putting
  // a control of ours on top of somebody's advert is the one thing this whole
  // feature exists to avoid.
  function buildSimExit() {
    return mkBtn('ytds-sim-exit', 'End the simulated ad and bring the reader back',
      () => setSimulateAd(false), txt('Simulating an ad — click to stop'));
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
    btnRow.append(buildCopyLog(), buildReloadCaptions(), buildSimulateAd());

    // Under Advanced, above the log: the version is read in exactly the moment
    // the log is, and it is the first line of what Copy log hands over — so
    // what you see here and what you paste say the same thing.
    const tag = versionTag();
    const body = el('div', 'ytds-drawer-body');
    body.append(
      group('Playback', 'pause'),
      ...buildPlaybackGroup(),
      group('Advanced', 'console'),
      ...(tag ? [el('div', 'ytds-ver', tag)] : []),
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
    // Never while it is being typed into: rewriting the value under the caret
    // is how a field fights back at the person filling it in.
    if (inpTail && document.activeElement !== inpTail) inpTail.value = String(state.tailMs);
    // Nothing to undo, nothing to press: the button says so rather than
    // silently doing nothing, which is how a dead control is usually read.
    if (btnTailReset) btnTailReset.disabled = !PLAYBACK_KEYS.some((k) => state[k] !== DEFAULTS[k]);
    for (const m of menus) m.sync();
    if (btnFocus) setIcon(btnFocus, state.focus ? 'eyeOff' : 'eye');
    // Nothing to list, nothing to press — the same answer the pill gives on a
    // video with no captions, rather than opening an empty panel. Never while a
    // long list is being built, or syncUi would re-enable the button mid-build.
    if (btnTranscript && !listBuilding) btnTranscript.disabled = !sentences.length;
    ensureTranscript();
    applyVideoMode();
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
      + (state.transcript ? ' ytds-transcript-open' : '')
      + (state.videoMode ? ' ytds-video' : '')
      // The transcript follows the UK chip rather than owning a setting of its
      // own: turn the translation off and the list is the original alone,
      // twice as much of it on screen.
      + (state.showUa ? '' : ' ytds-no-ua')
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
    if (!panel) return;
    panel.style.setProperty('--font-scale', state.fontScale || 1);
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
    // The buttons are already off by now, but they are not the only door — and
    // a rule about whether the feature may open belongs with the opening, not
    // scattered across the two things that draw a button.
    const why = blockedWhy();
    if (why) { dbg('not opening the reader — ' + why); return; }
    ensurePanel();
    // Draw first, persist last. Remembering that the overlay was open is a
    // convenience; opening it is the whole feature, and a write that throws
    // (see `put`) used to take the feature down with it — one dead line above
    // the appendChild and the click did nothing at all, silently.
    state.reader = true;
    closeDrawer();
    document.body.appendChild(panel);
    document.documentElement.classList.add('ytds-reader');
    // The PAGE goes fullscreen, not our panel — and the difference only shows
    // during an ad. With the panel as the fullscreen element, hiding it did
    // reveal the page underneath (a transparent ::backdrop is enough for that,
    // confirmed on a real ad 2026-08-03) but left it dead to the pointer: in
    // fullscreen only the fullscreen element takes clicks, so Skip Ad could be
    // seen and not pressed. With the page as the fullscreen element the player
    // sits INSIDE it, so hiding our panel gives back both the picture and the
    // clicks. Our panel is fixed/inset:0 either way, so the reader looks the
    // same; nothing here depends on which element the browser is showing.
    const fsHost = document.documentElement;
    if (fsHost.requestFullscreen) fsHost.requestFullscreen().catch(() => {});
    syncUi();
    // Opening the reader in the middle of an ad passes no edge, so pumpAd()
    // would never put the panel aside — it would come back on top of the spot.
    // `-1` says "we never saw which sentence this was": there is nothing to
    // replay, so the return picks up wherever the video actually is.
    if (adNow()) {
      panel.classList.add('ytds-ad');
      adSentIdx = -1;
      adResumePending = true;
      adWaitUntil = performance.now() + 3000;
      dbg('reader opened during an ad — waiting it out');
    }
    wake();         // never greet an empty screen: focus mode fades in a moment
    applySpeed();   // from here on the speed in the transport row is the law
    armStudy();
    // The load for this video stopped short of the player on purpose (see the
    // tail of loadCaptions): opening the overlay is the permission it waited
    // for. Not while a capture is already in flight, and not once we have the
    // captions anyway — the player may well have been switched on by its owner.
    if (pokePending && !captionsReady && !awaitingCapture) pokePlayer();
    offerResume();  // captions may have been ready long before the overlay
    startLoop();
    saveState();    // last: by now nothing it does can keep the overlay shut
  }

  function exitReader() {
    if (!state.reader && !document.documentElement.classList.contains('ytds-reader')) return;
    // Only if study actually stopped somewhere this session. Otherwise opening
    // the overlay and closing it again would overwrite yesterday's sentence
    // with whatever position YouTube happened to restore.
    if (markMoved) saveMark();
    hideResume();
    // Closing the overlay withdraws the permission that started the enable loop
    // (see the tail of loadCaptions). Left running it would go on poking the
    // player for another twenty seconds after the feature was put away — and
    // the CC it switched on would have nothing to switch them off again.
    if (awaitingCapture) {
      awaitingCapture = false;
      clearTimeout(captureTimer);
      pokePending = true;   // reopening the overlay is what may ask again
      window.postMessage({ type: 'YTDS_STOP_ENABLE' }, '*');
      dbg('reader closed mid-capture — stopped asking the player');
    }
    state.reader = false; saveState();
    // Before anything else undoes the overlay: the player must leave with the
    // geometry it came in with, whether we are closing by Esc, by the ✕ or by
    // the browser dropping out of fullscreen.
    applyVideoMode();
    stopLoop();
    stopAt = null; // let the video play normally again outside study mode
    sentenceDone = false;
    clearTimeout(stopTimer); stopTimer = null;
    closeDrawer();
    // Otherwise a reader reopened during the same ad would come back invisible.
    if (panel) panel.classList.remove('ytds-ad');
    adResumePending = false;
    document.documentElement.classList.remove('ytds-reader');
    // Ours is now the page, not the panel (see enterReader). Still a comparison
    // rather than a blind exit: the user may have put the player into ITS own
    // fullscreen, and that one is not ours to close.
    if (document.fullscreenElement === document.documentElement) document.exitFullscreen().catch(() => {});
    if (panel && panel.parentElement) panel.parentElement.removeChild(panel);
    // The stand belongs to a reading session, so closing it ends the pretence.
    // Left on, adNow() would keep answering yes with the reader shut — the
    // caption loader and the cache would go on believing an ad was playing, and
    // nothing on screen would say why. Last, when state.reader is already false.
    if (simulateAd) setSimulateAd(false);
    syncUi();
  }

  // On `window`, not `document`: YouTube's own hotkey handler sits on document,
  // and being first to register it would otherwise run before ours — Space then
  // toggled playback twice (play, then instantly pause). The window is the first
  // node of the capture phase, so stopping the event here means YouTube never
  // sees the keys study mode has claimed.
  window.addEventListener('keydown', (e) => {
    if (!state.reader || e.altKey || e.ctrlKey || e.metaKey) return;
    // A field being typed into owns its keys. Study mode claims Space and the
    // arrows, which are exactly the keys a number field needs for a caret and
    // a nudge — without this, typing a value moves you through sentences.
    // Escape still gets through: it is how you leave the field's layer.
    if (e.key !== 'Escape' && isTyping(e.target)) return;
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
    if (isTyping(e.target)) return;   // the field's space bar, not ours
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
    // Inside #movie_player, like every other control we press: sidebar and
    // inline preview players carry the same classes, and the main player is
    // only first in document order until YouTube decides otherwise.
    const p = document.getElementById('movie_player');
    const rc = (p || document).querySelector('.ytp-right-controls');
    if (!rc) return;
    const existing = rc.querySelector('.ytds-launch');
    // In the control bar the convention is set by the neighbours: YouTube's own
    // CC button is simply absent on a video with no captions, so ours goes too
    // rather than sitting there greyed among controls that are never greyed. It
    // comes back on the next video that has subtitles — this runs every tick.
    if (blockedWhy()) { if (existing) existing.remove(); return; }
    if (existing) return;
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
  const CTA_TITLE = 'Dual subtitles — original + translation, for language study';
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
    if (!row) return;
    // The shapes above are not alternatives: `#actions-inner` CONTAINS
    // `#top-level-buttons-computed` (checked in a live page, 2026-08-02), and
    // they do not appear at the same moment. A script that starts while the
    // metadata section is half built — seen on the first video after
    // installing the extension — finds the outer one, puts the pill there, and
    // a tick later the inner one exists and wins the loop. Asking
    // `row.querySelector` then looks inside a row our pill is not in, and a
    // SECOND pill appears: one in the button row, one stretched across the row
    // below it. So the question is asked of the page, not of the row — exactly
    // one pill, in the row we would pick now. It also repairs itself: a pill
    // left in the outer row moves down as soon as the inner one shows up.
    const found = document.querySelectorAll('.ytds-cta');
    let pill = (found.length === 1 && found[0].parentNode === row) ? found[0] : null;
    if (!pill) {
      for (const n of found) n.remove();
      // The label says what the button opens rather than which language it is
      // for: the original track can be any of them, and both modes behind this
      // button show two languages at once. Why anyone would want that is the
      // tooltip's job, where there is room to say it.
      // It is its own element so a narrow window can drop it and leave a round
      // icon button, the way the row's own buttons give up their words.
      pill = mkBtn('ytds-cta', CTA_TITLE,
        enterReader, icon('study'), el('span', 'ytds-cta-label', 'Dual subtitles'));
      row.appendChild(pill);
    }
    // Here the convention is the opposite of the player's: nothing in the row
    // of Share / Save ever disappears, and a button that comes and goes reads
    // as an extension that broke rather than as a video with nothing to read.
    // So it stays put, goes quiet, and says why on hover.
    const why = blockedWhy();
    pill.disabled = !!why;
    pill.title = why || CTA_TITLE;
  }

  // ---------- lifecycle ----------
  function tick() {
    if (location.pathname !== '/watch') return;
    // Cached here, where the swapped <video> is already dealt with, so that
    // adNow() costs two classList reads per frame instead of a DOM lookup.
    hookedPlayer = document.getElementById('movie_player');
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
      if (state.reader) applySpeed(); // a fresh element starts at 1×, whatever our menu says
    }
    // After the element is in hand, not before: coming back from an ad reads
    // its duration. With the reader open loop() pumps this 60 times a second;
    // this call covers the rest — the caption load and the cache, which care
    // about ads just as much and are in no hurry.
    pumpAd();
    ensurePanel();
    // Once a second is enough to put the box back after the things that take it
    // away — a window resize, an ad ending, YouTube rewriting the element's
    // style, a new video arriving without a page load. It writes only what
    // differs, so a settled screen costs six string compares.
    if (state.reader || playerStyleWas != null) applyVideoMode();
    const id = new URLSearchParams(location.search).get('v');
    if (id && id !== currentVideoId) {
      currentVideoId = id;
      offeredFor = null;    // a new video gets its own single offer
      markMoved = false;
      hideResume();
      // Only ours to set while the overlay is open. YouTube remembers the speed
      // you picked in its own menu and carries it from video to video; putting
      // state.speed back here took that away from anyone who had never opened
      // the overlay at all — they set 2×, an ad or a quality switch swapped the
      // element, and the player silently went back to 1×.
      if (state.reader) applySpeed();
      loadCaptions();
    }
    // After the block above, not before it: the buttons show what we know about
    // THIS video, and loadCaptions resets that knowledge synchronously before
    // its first await. Drawn earlier they would spend a tick answering for the
    // video we just left — a pill greyed out on a video that does have
    // subtitles, which is the one mistake this whole gate exists to avoid.
    ensureLaunchButton();
    ensureActionButton();
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
