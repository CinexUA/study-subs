// Runs in the PAGE (MAIN) world.
// 1) Intercepts the player's own timedtext requests (they carry valid tokens)
//    and forwards the URL + body to the content script.
// 2) Can turn captions on so the player actually fetches them.
// 3) Answers track-list requests from getPlayerResponse (fast path).
(() => {
  'use strict';

  const report = (url, body) => window.postMessage({ type: 'YTDS_TT', url, body }, '*');
  const log = (msg) => window.postMessage({ type: 'YTDS_LOG', msg }, '*');
  const isTT = (u) => typeof u === 'string' && u.indexOf('/api/timedtext') !== -1;

  // ---- intercept fetch ----
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url);
    const p = origFetch.apply(this, arguments);
    if (isTT(url)) {
      p.then((r) => { r.clone().text().then((b) => report(url, b)).catch(() => {}); })
       .catch(() => {});
    }
    return p;
  };

  // ---- intercept XHR ----
  const OrigOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this._ytdsUrl = url;
    return OrigOpen.apply(this, arguments);
  };
  const OrigSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    if (isTT(this._ytdsUrl)) {
      this.addEventListener('load', () => {
        try { report(this._ytdsUrl, this.responseText); } catch (_) {}
      });
    }
    return OrigSend.apply(this, arguments);
  };

  // ---- turn captions on so the player fetches them ----
  let enableToken = 0;
  // Where the player's CC stood before we touched them, so the end of a cycle
  // can put them back. `undefined` means we never got to establish it, and then
  // restoring is not ours to do. This exists because switching CC on is not a
  // local act: YouTube remembers it for every later video and for the next
  // session, and until 2026-08-03 nothing here ever switched them off again —
  // one video was enough to leave a user with captions on their whole feed.
  let ccWas;
  let reonTimer = null;  // the pending "…and back on" half of a retoggle
  let lastTrack = null;  // the track we selected, for restoring CC on via the API
  // Where "captions stay on from here" actually lives — measured 2026-08-03,
  // and it is the reason this bug outlived a page reload: the CC button is a
  // view of this key, not the thing itself. Clicking the button writes it in
  // both directions, so restoring the button normally restores this too; the
  // raw value is kept only to cover the paths that have no button to click.
  const PERSIST_KEY = 'yt-player-caption-persistence';
  let ccWasPersist;      // its exact value before we touched anything

  const player = () => document.getElementById('movie_player');
  // Looked up INSIDE #movie_player, for the same reason the play button is:
  // sidebar and inline preview players carry the same class, and a blind
  // document-wide query can press the wrong one — which looks exactly like a
  // dead button. Only a page with no #movie_player at all falls back.
  const ccBtn = () => {
    const p = player();
    return p ? p.querySelector('.ytp-subtitles-button')
             : document.querySelector('.ytp-subtitles-button');
  };
  const ccIsOn = (b) => !!b && b.getAttribute('aria-pressed') === 'true';

  // true / false, or null when neither witness can answer yet. The button is
  // the honest one; the API is asked only because the button does not exist
  // until the controls are built, and we can be here before that.
  function ccStateNow() {
    const b = ccBtn();
    if (b && b.hasAttribute('aria-pressed')) return ccIsOn(b);
    try {
      const p = player();
      const t = p && p.getOption && p.getOption('captions', 'track');
      if (t) return !!(t.languageCode || t.vssId || t.vss_id || t.name);
    } catch (_) {}
    return null;
  }

  // Called right before the first thing we change, not when the request comes
  // in: a page that is still building has nothing to report, and a guess there
  // would be the one recorded for the whole cycle.
  function rememberCc() {
    if (ccWas !== undefined) return;
    const now = ccStateNow();
    if (now === null) return;
    ccWas = now;
    try { ccWasPersist = localStorage.getItem(PERSIST_KEY); } catch (_) {}
  }

  // The backstop for the key above. Written back verbatim — the value is one
  // YouTube itself put there, not a shape we invented — and only when it has
  // actually drifted, which after a button click it will not have.
  function restorePersistence() {
    if (ccWasPersist === undefined) return;
    const was = ccWasPersist;
    ccWasPersist = undefined;
    try {
      if (localStorage.getItem(PERSIST_KEY) === was) return;
      if (was === null) localStorage.removeItem(PERSIST_KEY);
      else localStorage.setItem(PERSIST_KEY, was);
      log('restored YouTube\'s caption-persistence flag');
    } catch (_) {}
  }

  // Put CC back where we found them. Both directions matter: off for someone
  // who was not using them, and on for someone who was — a capture landing in
  // the middle of a retoggle must not be what leaves their captions off.
  function restoreCc() {
    clearTimeout(reonTimer); reonTimer = null;
    if (ccWas === undefined) { ccWasPersist = undefined; return; }
    const want = ccWas;
    ccWas = undefined;
    if (ccStateNow() !== want) {
      const btn = ccBtn();
      if (btn) {
        btn.click();
        log(`restored CC ${want ? 'on' : 'off'}`);
      // No button: the same API move the retoggle falls back to. Switching ON
      // needs a track to select, and without one `{}` would mean the opposite
      // of what we were asked — better to leave the player alone than invert it.
      } else if (!want || lastTrack) {
        try {
          const p = player();
          if (p && p.setOption) {
            p.setOption('captions', 'track', want ? lastTrack : {});
            log(`restored CC ${want ? 'on' : 'off'} via the API`);
          }
        } catch (_) {}
      }
    }
    // After YouTube has had its own moment to write the key (measured: it lands
    // well inside a second of the click).
    setTimeout(restorePersistence, 800);
  }

  // Turn captions off and back on again, the way a user pokes CC twice. Split
  // out because this is the ONLY move that makes the player build a fresh
  // timedtext url, and both rungs below have to be able to reach it.
  function retoggle(api, track) {
    const btn = ccBtn();
    if (btn) {
      btn.click();
      // Switch it back on unconditionally — we are the ones who turned it off,
      // so a capture landing inside these 500 ms (which stops the loop) must
      // not leave the user with captions off. Held in a handle so restoreCc,
      // which runs at exactly that moment, has the last word instead of being
      // undone half a second later.
      clearTimeout(reonTimer);
      reonTimer = setTimeout(() => {
        const b = ccBtn();
        if (b && !ccIsOn(b)) b.click();
      }, 500);
      return ' | re-toggled CC off→on';
    }
    // No button yet (controls not built, or a layout we do not know): an empty
    // track object is how the player's own API turns captions off.
    if (api && track) {
      api.setOption('captions', 'track', {});
      clearTimeout(reonTimer);
      reonTimer = setTimeout(() => { try { api.setOption('captions', 'track', track); } catch (_) {} }, 300);
      return ' | re-toggled CC off→on via the API';
    }
    return '';
  }

  function enableCaptions(attempt, token) {
    if (token !== enableToken) return; // superseded or stopped
    let ok = false, info = '';
    try {
      const p = player();
      const api = (p && p.loadModule && p.getOption && p.setOption) ? p : null;
      if (api) try { api.loadModule('captions'); } catch (_) {}
      const list = api ? (api.getOption('captions', 'tracklist') || []) : [];
      const track = list.length
        ? (list.find((t) => (t.languageCode || '').startsWith('en')) || list[0])
        : null;
      if (track) lastTrack = track;
      info = api ? 'tracklist=' + list.length : 'player API not ready';
      // Last moment before anything of the player's changes.
      rememberCc();

      // Round 0 is the gentle one: select a track (which turns captions on if
      // they were off) or press CC. It is invisible, and when the player simply
      // had captions off it is the whole story — a good capture normally lands
      // within a second and stops us before anything shows on screen.
      const btn = ccBtn();
      if (attempt === 0 && track) {
        api.setOption('captions', 'track', track);
        info += ' | selected a track'; ok = true;
      } else if (btn && !ccIsOn(btn)) {
        btn.click(); info += ' | clicked CC on'; ok = true;
      } else {
        // Still here on a later round, so round 0 changed nothing we could use.
        // The player spends ONE request per enable, and when it builds that url
        // before its `pot` token is ready the answer is HTTP 200 with an empty
        // body (measured; Opera, 2026-08-02). It never asks again on its own,
        // that url stays empty forever, and re-selecting the track it already
        // has looks to the player like no change at all — which is why nine
        // rounds of setOption once left a user with nothing until they poked CC
        // by hand. Only a real off→on toggle mints a fresh, pot-carrying url.
        const did = retoggle(api, track);
        if (did) { info += did; ok = true; }
        else info += ' | nothing to toggle';
      }
    } catch (e) { info = 'error: ' + e.message; }
    log(`enable#${attempt}: ${info}${ok ? ' → triggered' : ''}`);
    // Keep nudging until the content script says it got usable captions
    // (YTDS_STOP_ENABLE invalidates the token). Only round 0 is gentle: a good
    // capture normally lands within a second and stops us before any toggling
    // is visible on screen, and if it did not, waiting longer never helps.
    if (attempt < 8) setTimeout(() => enableCaptions(attempt + 1, token), ok ? 2500 : 1200);
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data) return;

    if (e.data.type === 'YTDS_ENABLE') {
      enableCaptions(0, ++enableToken);
      return;
    }

    // A wish, not a toggle: the content script always knows which way it wants
    // playback to go, so we press the player's own control — the one the Space
    // key drives — and only when the player disagrees. That way its state
    // machine ends up agreeing with us instead of undoing us a moment later,
    // and a wish that is already granted costs nothing.
    // The button is looked up INSIDE #movie_player: sidebar preview players on
    // a watch page carry the same class, and a blind document-wide query can
    // press the wrong one — which looks exactly like a dead button.
    if (e.data.type === 'YTDS_SET_PLAY') {
      const want = !!e.data.want;
      try {
        const p = document.getElementById('movie_player');
        if (p && p.getPlayerState) {
          const st = p.getPlayerState();      // 1 = playing, 3 = buffering
          if ((st === 1 || st === 3) === want) return;
          const btn = p.querySelector && p.querySelector('.ytp-play-button');
          if (btn) { btn.click(); return; }
          if (p.playVideo && p.pauseVideo) { want ? p.playVideo() : p.pauseVideo(); return; }
        }
      } catch (_) {}
      // No player API (an early frame, a layout we do not know): the content
      // script has already driven the media element, this is just a backstop.
      const v = document.querySelector('video.html5-main-video') || document.querySelector('video');
      if (v && v.paused === want) { want ? v.play().catch(() => {}) : v.pause(); }
      return;
    }

    // Same story as playback state: the player keeps its own rate and puts it
    // back on play, seek, ad or quality change. setPlaybackRate is only honoured
    // for rates the player offers itself, so anything off that ladder (0.9, 0.7)
    // is left to the content script's element write plus its ratechange guard.
    if (e.data.type === 'YTDS_SET_RATE') {
      const rate = Number(e.data.rate) || 1;
      try {
        const p = document.getElementById('movie_player');
        if (p && p.setPlaybackRate) {
          const list = (p.getAvailablePlaybackRates && p.getAvailablePlaybackRates()) || [];
          if (!list.length || list.some((r) => Math.abs(r - rate) < 0.001)) p.setPlaybackRate(rate);
        }
      } catch (_) {}
      return;
    }

    if (e.data.type === 'YTDS_STOP_ENABLE') {
      enableToken++; // invalidate any running retry loop
      restoreCc();   // and leave the player's CC as we found them
      return;
    }

    if (e.data.type === 'YTDS_REQUEST_TRACKS') {
      let pr = null;
      try { pr = document.getElementById('movie_player')?.getPlayerResponse?.(); } catch (_) {}
      if (!pr) pr = window.ytInitialPlayerResponse;
      const raw = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
      const tracks = raw.map((t) => ({
        baseUrl: t.baseUrl,
        lang: t.languageCode,
        name: t.name?.simpleText || t.name?.runs?.[0]?.text || '',
        kind: t.kind || ''
      }));
      window.postMessage({ type: 'YTDS_TRACKS', tracks }, '*');
    }
  });
})();
