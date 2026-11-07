import { buildMessages } from "./prompt.js";
import { HttpError, validateResult } from "./validate.js";

const DEFAULT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/* ---------- Providers ----------
 * A provider is an async generator: (env, messages) => yields text chunks.
 * To add one, write another generator and register it in PROVIDERS. */

async function* workersAi(env, messages) {
  if (!env.AI) throw new HttpError(503, "provider_unavailable", "The AI service isn't configured. Please try again later.");
  const model = env.AI_MODEL || DEFAULT_MODEL;
  let stream;
  try {
    stream = await env.AI.run(model, { messages, stream: true, max_tokens: 2400, temperature: 0.2 });
  } catch (err) {
    const msg = String(err?.message || err);
    if (/4006|daily free allocation|neurons/i.test(msg)) {
      throw new HttpError(429, "quota_exceeded", "VibeScan has reached its free daily AI limit. Please try again tomorrow.");
    }
    throw new HttpError(503, "provider_unavailable", "The AI service is unavailable right now. Please try again in a moment.");
  }
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        const j = JSON.parse(data);
        const piece = j.response ?? j.choices?.[0]?.delta?.content;
        if (typeof piece === "string" && piece) yield piece;
      } catch {
        /* ignore partial frames */
      }
    }
  }
}

export const PROVIDERS = { workersai: { label: "Cloudflare Workers AI", stream: workersAi } };

export function getProvider(env) {
  const key = env.AI_PROVIDER || "workersai";
  const p = PROVIDERS[key];
  if (!p) throw new HttpError(503, "provider_unavailable", "The AI service isn't configured. Please try again later.");
  return { key, ...p };
}

/* ---------- Analysis ----------
 * Stage numbers are driven by what the model has actually written so far
 * (keys are generated in a fixed order), not by timers. */
const STAGE_MARKERS = [
  ['"positive_signals"', 3],
  ['"expectations"', 4],
  ['"observations"', 5],
];

function extractJson(full) {
  const cleaned = full.replace(/```(?:json)?/gi, "");
  const a = cleaned.indexOf("{");
  const b = cleaned.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(cleaned.slice(a, b + 1));
  } catch {
    return null;
  }
}

export async function runAnalysis(streamFn, text, onStage = () => {}) {
  let full = "";
  let stage = 1;
  const bump = (n) => {
    if (n > stage) {
      stage = n;
      onStage(n);
    }
  };
  for await (const chunk of streamFn(buildMessages(text))) {
    if (!full) bump(2);
    full += chunk;
    for (const [marker, n] of STAGE_MARKERS) if (full.includes(marker)) bump(n);
  }
  const raw = extractJson(full);
  if (!raw) {
    throw new HttpError(502, "invalid_output", "The AI returned an answer we couldn't read safely, so nothing is shown. Please try again.");
  }
  return validateResult(raw, text);
}

export async function analyze(env, text, onStage) {
  const provider = getProvider(env);
  const result = await runAnalysis((messages) => provider.stream(env, messages), text, onStage);
  result.meta.provider = provider.label;
  result.meta.model = env.AI_MODEL || DEFAULT_MODEL;
  return result;
}
