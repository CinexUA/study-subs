// Phrase-by-phrase translation made on the device.
//
// The reader used to be handed two independent texts — the source track and
// YouTube's own translation of it, cut and punctuated its own way — and what
// stood under what was GUESSED afterwards from lengths and times. That guess
// has a ceiling (about one phrase in five sits a fragment off), and no amount
// of tuning moves it, because lengths do not know what a word means.
//
// Here nothing is guessed: a phrase of the source is translated on its own, so
// its translation belongs to it by construction. The price is paid in
// fluency — a phrase translated without its sentence loses agreement now and
// then — and it is paid on purpose: this is a tool for studying, and an exact
// pairing teaches where a smooth one misleads.
//
// Everything in this file is free of the page and of chrome.*, so that all of
// it except the translator itself can be checked in node
// (tools/test-translate.js).
(function () {
  'use strict';

  const textOf = (words, a, b) => {
    let s = '';
    for (let i = a; i < b; i++) s += (s ? ' ' : '') + words[i].text;
    return s;
  };

  // The phrases of one sentence: [{ a, b, text, line }], word ranges in
  // reading order that together cover every range handed in.
  //
  //   words  — the sentence's words, each { text, ev?, line }: the caption
  //            event it came in and the free-reading line it is shown on.
  //   ranges — [[a, b)] from the punctuation (splitIntoChunks).
  //
  // Punctuation decides, and a range is cut further only where it has to be:
  // a stretch with no comma that is longer than one line of the stage would
  // leave a line with nothing under it, and a source with no punctuation at
  // all has no ranges worth the name. The cut then falls where the caption
  // changes — the one boundary the track itself recorded — and, on a track
  // cached before events were kept, where the line does.
  function plan(words, ranges, opts) {
    const maxChars = (opts && opts.maxChars) || 75;
    const byEvent = !!(opts && opts.byEvent);
    const out = [];
    const piece = (a, b) => ({ a, b, text: textOf(words, a, b), line: words[a].line });
    for (const [a, b] of ranges) {
      if (b <= a) continue;
      let cuts = [a];
      if (byEvent || textOf(words, a, b).length > maxChars) {
        let hasEv = false;
        for (let i = a; i < b; i++) if (words[i].ev != null) { hasEv = true; break; }
        const key = hasEv ? 'ev' : 'line';
        for (let i = a + 1; i < b; i++) if (words[i][key] !== words[i - 1][key]) cuts.push(i);
      }
      cuts.push(b);
      // A piece of one word is not a phrase: it joins the piece before it, or
      // the one after when it is the first.
      for (let k = 1; k < cuts.length && cuts.length > 2;) {
        if (cuts[k] - cuts[k - 1] > 1) { k++; continue; }
        cuts.splice(k > 1 ? k - 1 : k, 1);
      }
      for (let k = 0; k + 1 < cuts.length; k++) out.push(piece(cuts[k], cuts[k + 1]));
    }
    // A line shows the phrases that START in it, so a phrase running across a
    // whole line would leave that line with nothing under it. It is cut where
    // that line begins — and only there: a phrase that merely spills into a
    // line with a start of its own stays whole, under the line it began on.
    const starts = new Set(out.map((p) => p.line));
    for (let i = 1; i < words.length; i++) {
      const ln = words[i].line;
      if (ln === words[i - 1].line || starts.has(ln)) continue;
      const k = out.findIndex((p) => p.a < i && i < p.b);
      if (k < 0) continue;
      out.splice(k, 1, piece(out[k].a, i), piece(i, out[k].b));
      starts.add(ln);
    }
    return out;
  }

  const HAS_TEXT_RE = /[\p{L}\p{N}]/u;
  const END_RE = /[.!?…]+$/;
  const SOFT_END_RE = /[,;:]$/;
  const TRAIL_RE = /["»”'’)\]]+$/;

  // A translator answers a phrase as if it were a sentence: capital first,
  // full stop last. Both are put back to what the SOURCE phrase says — and
  // only by its shape, never by a word list, since the target can be any
  // language.
  function normalize(enText, translated) {
    const en = String(enText == null ? '' : enText).trim();
    let out = String(translated == null ? '' : translated).replace(/\s+/g, ' ').trim();
    // Nothing came back (a bare number, a lone mark): the source stands in, so
    // the phrase keeps its place and its number.
    if (!HAS_TEXT_RE.test(out)) return en;
    const enBare = en.replace(TRAIL_RE, '');
    if (!END_RE.test(enBare)) out = out.replace(END_RE, '');
    const soft = enBare.match(SOFT_END_RE);
    if (soft && !/[,;:.!?…]$/.test(out)) out += soft[0];
    const e0 = en.match(/\p{L}/u), at = out.search(/\p{L}/u);
    if (e0 && at >= 0 && e0[0] === e0[0].toLowerCase() && e0[0] !== e0[0].toUpperCase()) {
      const next = out[at + 1] || '';
      const acronym = next && next !== next.toLowerCase() && next === next.toUpperCase();
      if (!acronym) out = out.slice(0, at) + out[at].toLowerCase() + out.slice(at + 1);
    }
    return out;
  }

  // The translation of one sentence in the shape the renderer already reads:
  // `units` are WORDS, each carrying the phrase it belongs to (`g`); `phr`
  // says how many words each phrase has and when its source is spoken.
  function assemble(phrases, texts, times) {
    const units = [], phr = [];
    for (let g = 0; g < phrases.length; g++) {
      const ws = String(texts[g] || '').split(/\s+/).filter(Boolean);
      for (const w of ws) units.push({ t: 0, text: w, g });
      const tm = times[g] || { t0: 0, t1: 0 };
      phr.push({ n: ws.length, t0: tm.t0, t1: tm.t1 });
    }
    return { units, phr };
  }

  // How many translated words are out at time t: a phrase's words appear
  // while its own source phrase is being spoken, never before it starts.
  function revealByPhrase(phr, t) {
    let n = 0;
    for (const p of phr) {
      if (t >= p.t1) { n += p.n; continue; }
      if (t <= p.t0) break;
      const span = p.t1 - p.t0;
      n += span > 0 ? Math.ceil(((t - p.t0) / span) * p.n) : p.n;
      break;
    }
    return Math.max(1, n);
  }

  // What pointing at a phrase needs, in the form buildChunkPairs returns —
  // except that nothing is solved for: target i is phrase i on both sides.
  function pairsFor(phrases, enWordCount, units) {
    const enOf = new Array(enWordCount);
    phrases.forEach((p, g) => { for (let i = p.a; i < p.b && i < enWordCount; i++) enOf[i] = g; });
    return { count: phrases.length, enOf, uaOf: units.map((u) => u.g) };
  }

  // 'en-US' → 'en'. The translator is asked about languages, not regions, and
  // a track's own code may carry either.
  const baseLang = (code) => String(code == null ? '' : code).trim().toLowerCase().split(/[-_]/)[0];

  // The work list of one build. Sentences are translated one at a time and a
  // sentence is handed over only when ALL of its phrases are in: half a
  // sentence on screen is the fragment this whole file exists to get rid of.
  //
  // The order is the reader's, not the video's — the sentence being read,
  // then the ones after it, and only then back to the start — because a
  // forty-minute video is a minute of work and nobody should wait for
  // minute one while standing at minute twenty.
  //
  //   sentences — [[sourcePhrase, …], …]
  //   known     — Map sourcePhrase → translation; filled as the work goes, so
  //               the caller can put it on disk and hand it back next time.
  function queue(backend, cb) {
    const known = (cb && cb.known) || new Map();
    let sents = [], done = [], focusAt = 0, dead = false, running = false;

    const pick = () => {
      const n = sents.length;
      for (let k = 0; k < n; k++) { const i = (focusAt + k) % n; if (!done[i]) return i; }
      return -1;
    };

    async function work() {
      if (running) return;
      running = true;
      await null;   // lets a focus() that follows load() in the same turn count
      while (!dead) {
        const i = pick();
        if (i < 0) break;
        const texts = [];
        for (const src of sents[i]) {
          if (!known.has(src)) {
            let raw;
            try { raw = await backend.translate(src); }
            catch (e) {
              running = false;
              if (!dead) { dead = true; cb.onFail(e); }
              return;
            }
            if (dead) { running = false; return; }
            known.set(src, normalize(src, raw));
          }
          texts.push(known.get(src));
        }
        done[i] = true;
        cb.onSentence(i, texts);
      }
      running = false;
      if (!dead && cb.onIdle) cb.onIdle();
    }

    return {
      known,
      load(sentences) { sents = sentences || []; done = new Array(sents.length).fill(false); work(); },
      focus(i) { if (i >= 0 && i < sents.length) focusAt = i; },
      stop() { dead = true; },
    };
  }

  // The translator built into Chrome (138+). Null where there is none, and
  // the caller then leaves everything exactly as it was. One instance for one
  // pair of languages at a time: a language change makes a new one.
  function chromeBackend() {
    if (typeof Translator === 'undefined') return null;
    let tr = null;
    const pair = (src, dst) => ({ sourceLanguage: src, targetLanguage: dst });
    return {
      availability: (src, dst) => Translator.availability(pair(src, dst)),
      // Downloading the language pack needs a user gesture; with the pack
      // already on the device this resolves from anywhere.
      async create(src, dst, onProgress) {
        const made = await Translator.create(Object.assign(pair(src, dst), {
          monitor(m) { m.addEventListener('downloadprogress', (e) => { if (onProgress) onProgress(e.loaded); }); },
        }));
        if (tr && tr.destroy) { try { tr.destroy(); } catch (_) {} }
        tr = made;
      },
      translate: (text) => tr.translate(text),
    };
  }

  const YTDS_TX = { plan, normalize, assemble, revealByPhrase, pairsFor, queue, chromeBackend, baseLang };
  globalThis.YTDS_TX = YTDS_TX;
  if (typeof module !== 'undefined') module.exports = YTDS_TX;
})();
