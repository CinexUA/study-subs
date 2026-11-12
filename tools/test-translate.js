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
  eq(plan(W('a b, c d', null, [0, 0, 0, 1]), [[0, 2], [2, 4]]).map((p) => p.line), [0, 0]);
  eq(plan(W('a b, c d', null, [0, 0, 1, 1]), [[0, 2], [2, 4]]).map((p) => p.line), [0, 1]);
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

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${String(e.message).split('\n').slice(0, 6).join('\n     ')}`); }
  }
  console.log(failed ? `${failed} of ${tests.length} failed` : `ok — ${tests.length} tests`);
  process.exit(failed ? 1 : 0);
})();
