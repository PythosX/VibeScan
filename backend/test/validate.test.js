import { test } from "node:test";
import assert from "node:assert/strict";
import { findSpan, validateRequest, validateResult, HttpError } from "../src/validate.js";
import { runAnalysis } from "../src/ai.js";

const TEXT = 'Looking for something real. No drama, just honest talk.\nI don\u2019t chase anyone.';

test("validateRequest rejects empty, short, long and non-string input", () => {
  assert.throws(() => validateRequest({ text: "   " }), (e) => e.code === "empty");
  assert.throws(() => validateRequest({ text: "hi" }), (e) => e.code === "too_short");
  assert.throws(() => validateRequest({ text: "1234567890123456789012345" }), (e) => e.code === "too_short");
  assert.throws(() => validateRequest({ text: "a".repeat(3001) }), (e) => e.code === "too_long");
  assert.throws(() => validateRequest({ text: 42 }), (e) => e.code === "invalid_request");
  assert.throws(() => validateRequest(null), HttpError);
  assert.equal(validateRequest({ text: "  Hello there, I like walking.  " }), "Hello there, I like walking.");
});

test("findSpan tolerates case, whitespace and quote style", () => {
  const s = findSpan(TEXT, "no  DRAMA");
  assert.equal(TEXT.slice(s.start, s.end), "No drama");
  const q = findSpan(TEXT, "I don't chase");
  assert.equal(TEXT.slice(q.start, q.end), "I don\u2019t chase");
  assert.equal(findSpan(TEXT, "not in the text"), null);
});

test("validateResult drops invented quotes and counts them", () => {
  const raw = {
    summary: "A short bio.",
    positive_signals: [{ phrase: "honest talk", explanation: "Values open communication." }],
    ambiguous_signals: [{ phrase: "I never said this", explanation: "invented" }],
    concerning_signals: [],
    expectations: [{ category: "values", statement: "Honesty" }, { category: "nonsense", statement: "x" }],
    suggested_questions: ["a", "b", "c", "d", "e", "f"],
  };
  const out = validateResult(raw, TEXT);
  assert.equal(out.positive_signals.length, 1);
  assert.equal(out.ambiguous_signals.length, 0);
  assert.equal(out.meta.dropped_signals, 1);
  assert.equal(out.expectations.length, 1);
  assert.equal(out.suggested_questions.length, 5);
  assert.equal(TEXT.slice(out.positive_signals[0].start, out.positive_signals[0].end), "honest talk");
});

test("validateResult rejects output without a summary", () => {
  assert.throws(() => validateResult({ positive_signals: [] }, TEXT), (e) => e.code === "invalid_output");
  assert.throws(() => validateResult("nope", TEXT), (e) => e.code === "invalid_output");
});

async function* fake(chunks) { for (const c of chunks) yield c; }

test("runAnalysis reports stages from real output and parses fenced JSON", async () => {
  const json = JSON.stringify({
    summary: "Short bio.", relationship_intentions: [], communication_style: "Plain.",
    positive_signals: [{ phrase: "honest talk", explanation: "ok" }], ambiguous_signals: [], concerning_signals: [],
    expectations: [], suggested_questions: [], observations: [], things_to_clarify: [], practical_suggestion: "Ask.",
  });
  const stages = [];
  const parts = ["```json\n", json.slice(0, 80), json.slice(80, 160), json.slice(160), "\n```"];
  const out = await runAnalysis(() => fake(parts), TEXT, (n) => stages.push(n));
  assert.deepEqual(stages, [2, 3, 4, 5]);
  assert.equal(out.summary, "Short bio.");
});

test("runAnalysis throws invalid_output on non-JSON", async () => {
  await assert.rejects(() => runAnalysis(() => fake(["I cannot help with that."]), TEXT), (e) => e.code === "invalid_output");
  await assert.rejects(() => runAnalysis(() => fake(["{ broken"]), TEXT), (e) => e.code === "invalid_output");
});
