import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const TEXT = "Looking for something real. No drama, just honest conversation. Tell me about your favourite book.";
const MODEL_JSON = JSON.stringify({
  summary: "A friendly bio.", relationship_intentions: ["Something real"], communication_style: "Direct.",
  positive_signals: [{ phrase: "honest conversation", explanation: "Values openness.", why_it_matters: "x", alternative_interpretation: "y", clarification_question: "z?" }],
  ambiguous_signals: [{ phrase: "No drama", explanation: "Calm preference.", why_it_matters: "x", alternative_interpretation: "y", clarification_question: "z?" }],
  concerning_signals: [], expectations: [{ category: "communication", statement: "No drama" }],
  suggested_questions: ["a?", "b?", "c?", "d?", "e?"], observations: ["1", "2", "3"], things_to_clarify: ["1", "2"], practical_suggestion: "Ask.",
});

function aiStream(json) {
  const enc = new TextEncoder();
  const frames = [];
  for (let i = 0; i < json.length; i += 40) frames.push(`data: ${JSON.stringify({ response: json.slice(i, i + 40) })}\n\n`);
  frames.push("data: [DONE]\n\n");
  return new ReadableStream({ start(c) { for (const f of frames) c.enqueue(enc.encode(f)); c.close(); } });
}
const ctxFactory = () => { const p = []; return { waitUntil: (x) => p.push(x), done: () => Promise.all(p) }; };
const req = (body, headers = {}, method = "POST") =>
  new Request("https://vibescan.test/api/analyze", { method, headers: { "Content-Type": "application/json", "CF-Connecting-IP": headers.ip || "1.1.1.1", ...headers }, body: method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined });

test("streams stage events then a validated result", async () => {
  const env = { AI: { run: async () => aiStream(MODEL_JSON) }, ALLOWED_ORIGINS: "" };
  const ctx = ctxFactory();
  const res = await worker.fetch(req({ text: TEXT }, { ip: "2.2.2.2" }), env, ctx);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("Content-Type"), /event-stream/);
  const body = await res.text();
  await ctx.done();
  assert.match(body, /event: stage\ndata: {"stage":1}/);
  assert.match(body, /event: stage\ndata: {"stage":5}/);
  const result = JSON.parse(/event: result\ndata: (.*)\n/.exec(body)[1]);
  assert.equal(result.positive_signals[0].phrase, "honest conversation");
  assert.equal(TEXT.slice(result.ambiguous_signals[0].start, result.ambiguous_signals[0].end), "No drama");
  assert.equal(result.meta.provider, "Cloudflare Workers AI");
  assert.ok(!body.includes("SYSTEM") && !body.includes("responsible dating-language"), "prompt must never leak");
});

test("rejects bad requests with proper status codes", async () => {
  const env = { AI: { run: async () => aiStream(MODEL_JSON) } };
  const ctx = ctxFactory();
  assert.equal((await worker.fetch(req({ text: "" }, { ip: "3.3.3.3" }), env, ctx)).status, 400);
  assert.equal((await worker.fetch(req({ text: "a".repeat(3001) }, { ip: "3.3.3.3" }), env, ctx)).status, 400);
  assert.equal((await worker.fetch(req("not json", { ip: "3.3.3.3" }), env, ctx)).status, 400);
  assert.equal((await worker.fetch(req({ text: TEXT }, { ip: "3.3.3.3", "Content-Type": "text/plain" }), env, ctx)).status, 415);
  assert.equal((await worker.fetch(req(null, { ip: "3.3.3.3" }, "GET"), env, ctx)).status, 405);
  const big = await worker.fetch(req({ text: TEXT }, { ip: "3.3.3.3", "Content-Length": "999999" }), env, ctx);
  assert.equal(big.status, 413);
});

test("blocks unknown cross-origin callers, allows configured ones", async () => {
  const env = { AI: { run: async () => aiStream(MODEL_JSON) }, ALLOWED_ORIGINS: "https://app.example" };
  const ctx = ctxFactory();
  assert.equal((await worker.fetch(req({ text: TEXT }, { ip: "4.4.4.4", Origin: "https://evil.example" }), env, ctx)).status, 403);
  const ok = await worker.fetch(req({ text: TEXT }, { ip: "4.4.4.4", Origin: "https://app.example" }), env, ctx);
  assert.equal(ok.headers.get("Access-Control-Allow-Origin"), "https://app.example");
  await ok.text(); await ctx.done();
});

test("rate limits after 10 requests per minute per client", async () => {
  const env = { AI: { run: async () => aiStream(MODEL_JSON) } };
  const ctx = ctxFactory();
  let last;
  for (let i = 0; i < 11; i++) { last = await worker.fetch(req({ text: "" }, { ip: "5.5.5.5" }), env, ctx); }
  assert.equal(last.status, 429);
  assert.equal(last.headers.get("Retry-After"), "60");
});

test("provider failures become clear errors, never fabricated results", async () => {
  const ctx = ctxFactory();
  const quota = { AI: { run: async () => { throw new Error("4006: you have used up your daily free allocation of 10,000 neurons"); } } };
  let res = await worker.fetch(req({ text: TEXT }, { ip: "6.6.6.6" }), quota, ctx);
  let body = await res.text(); await ctx.done();
  assert.match(body, /event: error\ndata: {"code":"quota_exceeded"/);
  assert.ok(!body.includes("event: result"));

  const down = { AI: { run: async () => { throw new Error("boom"); } } };
  res = await worker.fetch(req({ text: TEXT }, { ip: "7.7.7.7" }), down, ctx);
  body = await res.text(); await ctx.done();
  assert.match(body, /"code":"provider_unavailable"/);
  assert.ok(!body.includes("boom"), "raw provider errors must not leak");

  const junk = { AI: { run: async () => aiStream("Sorry, I can't do that.") } };
  res = await worker.fetch(req({ text: TEXT }, { ip: "8.8.8.8" }), junk, ctx);
  body = await res.text(); await ctx.done();
  assert.match(body, /"code":"invalid_output"/);
  assert.ok(!body.includes("event: result"));
});
