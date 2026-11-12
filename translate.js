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
      for (let k = 0; k + 1 < cuts.length; k++) {
        out.push({ a: cuts[k], b: cuts[k + 1], text: textOf(words, cuts[k], cuts[k + 1]), line: words[cuts[k]].line });
      }
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

  const YTDS_TX = { plan, normalize, assemble, revealByPhrase, pairsFor };
  globalThis.YTDS_TX = YTDS_TX;
  if (typeof module !== 'undefined') module.exports = YTDS_TX;
})();
