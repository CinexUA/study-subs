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
  function enableCaptions(attempt, token) {
    if (token !== enableToken) return; // superseded or stopped
    let ok = false, info = '';
    try {
      const p = document.getElementById('movie_player');
      if (p && p.loadModule && p.getOption && p.setOption) {
        p.loadModule('captions');
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
        // Fallback: click the CC button so the player fetches captions itself.
        const btn = document.querySelector('.ytp-subtitles-button');
        if (btn) {
          if (btn.getAttribute('aria-pressed') === 'true') { info += ' | CC already on'; }
          else { btn.click(); info += ' | clicked CC'; ok = true; }
        } else { info += ' | no CC button'; }
      }
    } catch (e) { info = 'error: ' + e.message; }
    log(`enable#${attempt}: ${info}${ok ? ' → triggered' : ''}`);
    if (!ok && attempt < 10) setTimeout(() => enableCaptions(attempt + 1, token), 400);
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
