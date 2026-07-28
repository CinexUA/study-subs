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
  const ccBtn = () => document.querySelector('.ytp-subtitles-button');
  const ccIsOn = (b) => !!b && b.getAttribute('aria-pressed') === 'true';

  function enableCaptions(attempt, token) {
    if (token !== enableToken) return; // superseded or stopped
    let ok = false, info = '';
    try {
      const p = document.getElementById('movie_player');
      if (p && p.loadModule && p.getOption && p.setOption) {
        try { p.loadModule('captions'); } catch (_) {}
        const list = p.getOption('captions', 'tracklist') || [];
        info = 'tracklist=' + list.length;
        if (list.length) {
          const en = list.find((t) => (t.languageCode || '').startsWith('en')) || list[0];
          p.setOption('captions', 'track', en);
          ok = true;
        }
      } else {
        info = 'player API not ready';
      }
      if (!ok) {
        // Fallback: drive the CC button so the player fetches captions itself.
        const btn = ccBtn();
        if (!btn) {
          info += ' | no CC button';
        } else if (!ccIsOn(btn)) {
          btn.click(); info += ' | clicked CC on'; ok = true;
        } else if (attempt >= 2) {
          // CC is on, yet we still have nothing: the player already spent its
          // one request, built it before the captions module had settled, and
          // got an empty body back — an invalid or missing `pot` answers with
          // HTTP 200 and 0 bytes (measured). It never asks again on its own,
          // and refetching that same url stays empty forever. Only a real
          // off→on toggle makes the player build a fresh url, and once it is
          // settled that one carries a valid pot and returns the full track.
          btn.click();
          // Switch it back on unconditionally — we are the ones who turned it
          // off, so a capture landing inside these 500 ms (which stops the
          // loop) must not leave the user with captions off.
          setTimeout(() => {
            const b = ccBtn();
            if (b && !ccIsOn(b)) b.click();
          }, 500);
          info += ' | re-toggled CC off→on'; ok = true;
        } else {
          info += ' | CC already on';
        }
      }
    } catch (e) { info = 'error: ' + e.message; }
    log(`enable#${attempt}: ${info}${ok ? ' → triggered' : ''}`);
    // Keep nudging until the content script says it got usable captions
    // (YTDS_STOP_ENABLE invalidates the token). The first two rounds are gentle
    // — a good capture normally lands within a second and stops us before any
    // toggling is visible on screen.
    if (attempt < 8) setTimeout(() => enableCaptions(attempt + 1, token), ok ? 2500 : 1200);
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data) return;

    if (e.data.type === 'YTDS_ENABLE') {
      enableCaptions(0, ++enableToken);
      return;
    }

    if (e.data.type === 'YTDS_STOP_ENABLE') {
      enableToken++; // invalidate any running retry loop
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
