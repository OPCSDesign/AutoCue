// Self-check for the voice-follow matcher: node test-matcher.mjs
import { normWords, advance } from './matcher.js';
import assert from 'node:assert';

const script = normWords(
  `Brethren, it is my intention to open the lodge in due form.
   To order, brethren. In the name of the Great Architect of the Universe
   I declare the lodge open for the despatch of business.
   To order, brethren, and observe the ancient customs of the order.`
);

// Exact reading advances to just past the heard words.
let p = advance(script, 0, normWords('Brethren it is my intention'));
assert.strictEqual(p, 5, `exact reading: got ${p}`);

// Continues from mid-script.
p = advance(script, 5, normWords('to open the lodge in due form'));
assert.strictEqual(p, 12, `mid-script: got ${p}`);

// One mis-recognised word still advances ("loose" for "lodge").
p = advance(script, 5, normWords('to open the loose in due form'));
assert.strictEqual(p, 12, `fuzzy: got ${p}`);

// Filler/stopwords alone never advance.
p = advance(script, 12, normWords('um er the and'));
assert.strictEqual(p, 12, `filler: got ${p}`);

// A repeated phrase ("to order brethren") matches the NEAR occurrence, not the far one.
p = advance(script, 12, normWords('to order brethren'));
assert.ok(p >= 15 && p <= 16, `repeat resolves near: got ${p}`);

// Never moves backwards even if earlier text is heard again.
p = advance(script, 30, normWords('brethren it is my intention'));
assert.strictEqual(p, 30, `no backwards: got ${p}`);

// Single word is never enough.
p = advance(script, 0, normWords('brethren'));
assert.strictEqual(p, 0, `single word: got ${p}`);

// Empty input is a no-op.
assert.strictEqual(advance(script, 7, []), 7);

// Long realistic chunk with a mis-recognised word ("dispatch" for "despatch")
// lands at the true position: "business" is token 34, so 35 tokens spoken.
p = advance(script, 20, normWords('declare the lodge open for the dispatch of business'));
assert.ok(Math.abs(p - 35) <= 1, `long fuzzy chunk: got ${p}, expected ~35`);

console.log('matcher self-check: all assertions passed');
