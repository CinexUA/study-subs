// Checks for translate.js. No runner, no dependencies: `node tools/test-translate.js`.
// The phrase strings are the ones the built-in translator really returned for
// sentence 7 of aVLX0Pg1ZCI (measured 2026-11-12), not invented ones.
const assert = require('assert');
const TX = require('../translate.js');
const { plan, normalize, assemble, revealByPhrase, pairsFor } = TX;

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const eq = (a, b) => assert.deepStrictEqual(a, b);

// 'a b, c d' → words on line 0; `evs` / `lines` give each word its caption event and line.
const W = (text, evs, lines) => text.split(' ').map((t, i) => {
  const w = { text: t, line: lines ? lines[i] : 0 };
  if (evs) w.ev = evs[i];
  return w;
});
const LONG = 'internationally recognised organisations frequently underestimate straightforward communication problems';

test('plan: a comma ends a phrase', () => {
  eq(plan(W('a b, c d'), [[0, 2], [2, 4]]).map((p) => p.text), ['a b,', 'c d']);
});
test('plan: a phrase carries the line of its first word', () => {
  eq(plan(W('a b, c d', null, [0, 0, 0, 0]), [[0, 2], [2, 4]]).map((p) => p.line), [0, 0]);
  eq(plan(W('a b, c d', null, [0, 0, 1, 1]), [[0, 2], [2, 4]]).map((p) => p.line), [0, 1]);
});
test('plan: no line is left without a phrase that starts in it', () => {
  // 'a b, c | d e f.' — the second phrase would cover the whole of line 1.
  eq(plan(W('a b, c d e f.', null, [0, 0, 0, 1, 1, 1]), [[0, 2], [2, 6]]).map((p) => [p.a, p.b, p.line]),
    [[0, 2, 0], [2, 3, 0], [3, 6, 1]]);
});
test('plan: a phrase that runs into a line with a start of its own stays whole', () => {
  eq(plan(W('a b, c d, e f.', null, [0, 0, 0, 1, 1, 1]), [[0, 2], [2, 4], [4, 6]]).map((p) => [p.a, p.b]),
    [[0, 2], [2, 4], [4, 6]]);
});
test('plan: a long phrase with no commas is cut at caption events, a lone word joins its neighbour', () => {
  assert.ok(LONG.length > 75);
  eq(plan(W(LONG, [1, 1, 1, 2, 2, 2, 3]), [[0, 7]]).map((p) => [p.a, p.b]), [[0, 3], [3, 7]]);
});
test('plan: a short phrase is left whole', () => {
  eq(plan(W('one two three four', [1, 1, 2, 2]), [[0, 4]]).length, 1);
});
test('plan: an unpunctuated source is cut at caption events whatever the length', () => {
  eq(plan(W('one two three four', [1, 1, 2, 2]), [[0, 4]], { byEvent: true }).map((p) => p.text), ['one two', 'three four']);
});
test('plan: with no events at all the cut falls on the line break', () => {
  eq(plan(W('one two three four five', null, [0, 0, 0, 1, 1]), [[0, 5]], { byEvent: true }).map((p) => p.line), [0, 1]);
});
test('plan: a lone first word joins the piece after it', () => {
  eq(plan(W('one two three', [1, 2, 2]), [[0, 3]], { byEvent: true }).map((p) => [p.a, p.b]), [[0, 3]]);
});

test('normalize: a phrase from inside a sentence starts lower-case', () => {
  eq(normalize('like no matter how much you try,', 'Як би ти не намагався,'), 'як би ти не намагався,');
});
test('normalize: a phrase that opens the sentence keeps its capital', () => {
  eq(normalize('If you feel like your brain is always distracted,', 'Якщо ви відчуваєте, що ваш мозок завжди відволікається,'),
    'Якщо ви відчуваєте, що ваш мозок завжди відволікається,');
});
test('normalize: the end mark follows the source phrase', () => {
  eq(normalize('foggy, lazy, unmotivated,', 'туманний, ледачий, невмотивований.'), 'туманний, ледачий, невмотивований,');
  eq(normalize('this video is for you.', 'Це відео для вас.'), 'це відео для вас.');
  eq(normalize('your mind keeps jumping', 'Ваш розум продовжує стрибати.'), 'ваш розум продовжує стрибати');
});
test('normalize: an acronym is not lowered', () => {
  eq(normalize('and the usa,', 'США,'), 'США,');
});
test('normalize: empty translation falls back to the source phrase', () => {
  eq(normalize('2014,', ''), '2014,');
  eq(normalize('you would do,', ','), 'you would do,');
  eq(normalize('you would do,', null), 'you would do,');
});

const P3 = [{ a: 0, b: 2, text: 'one two,', line: 0 }, { a: 2, b: 4, text: 'three four,', line: 0 }, { a: 4, b: 6, text: 'five six.', line: 1 }];
const T3 = [{ t0: 0, t1: 1 }, { t0: 1, t1: 2 }, { t0: 2, t1: 3 }];
test('assemble: every translated word carries its phrase', () => {
  const A = assemble(P3, ['один два,', 'три,', 'чотири п’ять.'], T3);
  eq(A.units.map((u) => u.g), [0, 0, 1, 2, 2]);
  eq(A.units.map((u) => u.text), ['один', 'два,', 'три,', 'чотири', 'п’ять.']);
  eq(A.phr, [{ n: 2, t0: 0, t1: 1 }, { n: 1, t0: 1, t1: 2 }, { n: 2, t0: 2, t1: 3 }]);
});
test('pairsFor: phrase i answers for phrase i', () => {
  const A = assemble(P3, ['один два,', 'три,', 'чотири п’ять.'], T3);
  eq(pairsFor(P3, 6, A.units), { count: 3, enOf: [0, 0, 1, 1, 2, 2], uaOf: [0, 0, 1, 2, 2] });
});
test('pairsFor: one phrase is one target', () => {
  const P1 = [{ a: 0, b: 4, text: 'one two three four.', line: 0 }];
  const A1 = assemble(P1, ['один два три.'], [{ t0: 0, t1: 1 }]);
  eq(pairsFor(P1, 4, A1.units), { count: 1, enOf: [0, 0, 0, 0], uaOf: [0, 0, 0] });
});

test('revealByPhrase: words appear while their own phrase is spoken', () => {
  const phr = [{ n: 2, t0: 0, t1: 1 }, { n: 3, t0: 1, t1: 2 }];
  eq(revealByPhrase(phr, 0.5), 1);
  eq(revealByPhrase(phr, 1.0), 2);
  eq(revealByPhrase(phr, 1.5), 4);
  eq(revealByPhrase(phr, 5), 5);
});
test('revealByPhrase: never less than one word', () => {
  eq(revealByPhrase([{ n: 2, t0: 3, t1: 4 }], 0), 1);
});

// ---------- the queue ----------
const { queue, baseLang } = TX;
// A stand-in translator: upper-cases, and remembers what it was asked.
function fake(opts) {
  const calls = [];
  return {
    calls,
    translate: async (t) => {
      calls.push(t);
      await null;
      if (opts && opts.failOn === t) throw new Error('model gone');
      return t.toUpperCase();
    },
  };
}
// Ten one-phrase sentences: 's0.' … 's9.'
const S10 = () => Array.from({ length: 10 }, (_, i) => [`s${i}.`]);
function run(be, sentences, setup, known) {
  return new Promise((resolve) => {
    const order = [], got = {}, fails = [];
    const q = queue(be, {
      known,
      onSentence: (i, texts) => { order.push(i); got[i] = texts; if (setup && setup.onSentence) setup.onSentence(q, order); },
      onFail: (e) => { fails.push(e.message); setTimeout(() => resolve({ order, got, fails, q }), 20); },
      onIdle: () => resolve({ order, got, fails, q }),
    });
    q.load(sentences);
    if (setup && setup.after) setup.after(q);
  });
}

test('queue: the sentence in focus first, then onward, then the start', async () => {
  const r = await run(fake(), S10(), { after: (q) => q.focus(6) });
  eq(r.order, [6, 7, 8, 9, 0, 1, 2, 3, 4, 5]);
});
test('queue: seek reprioritises — a focus moved mid-run is served next', async () => {
  let moved = false;
  const r = await run(fake(), S10(), { onSentence: (q) => { if (!moved) { moved = true; q.focus(8); } } });
  eq(r.order.slice(0, 3), [0, 8, 9]);
  eq(r.order.length, 10);
});
test('queue: a phrase already known never reaches the translator', async () => {
  const be = fake();
  const r = await run(be, [['a,', 'b.']], null, new Map([['a,', 'а,']]));
  eq(be.calls, ['b.']);
  eq(r.got[0], ['а,', 'b.']);   // 'B.' from the stand-in, lowered like any phrase
});
test('queue: a sentence wholly known is still delivered', async () => {
  const be = fake();
  const r = await run(be, [['a.']], null, new Map([['a.', 'а.']]));
  eq(be.calls, []);
  eq(r.order, [0]);
});
test('queue: the same phrase in two sentences is translated once', async () => {
  const be = fake();
  const r = await run(be, [['yes,', 'x.'], ['yes,', 'y.']]);
  eq(be.calls.filter((c) => c === 'yes,').length, 1);
  eq(r.order, [0, 1]);
});
test('queue: what it learns is kept in `known`, normalised', async () => {
  const r = await run({ translate: async () => 'Ось так.' }, [['like this,']]);
  eq(r.q.known.get('like this,'), 'ось так,');
});
test('queue: backend failure — reported once, and nothing is delivered after it', async () => {
  const r = await run(fake({ failOn: 's2.' }), S10());
  eq(r.fails, ['model gone']);
  eq(r.order, [0, 1]);
});
test('queue: nothing arrives after stop()', async () => {
  const order = [];
  const q = queue(fake(), { onSentence: (i) => { order.push(i); q.stop(); }, onFail: () => {}, onIdle: () => order.push('idle') });
  q.load(S10());
  await new Promise((r) => setTimeout(r, 30));
  eq(order, [0]);
});
test('queue: an empty load is idle at once', async () => {
  const r = await run(fake(), []);
  eq(r.order, []);
});
test('baseLang: the language without its region', () => {
  eq(baseLang('en-US'), 'en'); eq(baseLang('pt_BR'), 'pt'); eq(baseLang('UK'), 'uk'); eq(baseLang(''), ''); eq(baseLang(null), '');
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${String(e.message).split('\n').slice(0, 6).join('\n     ')}`); }
  }
  console.log(failed ? `${failed} of ${tests.length} failed` : `ok — ${tests.length} tests`);
  process.exit(failed ? 1 : 0);
})();
