import { analyze } from "./ai.js";
import { HttpError, LIMITS, validateRequest } from "./validate.js";

const encoder = new TextEncoder();
const buckets = new Map(); // best-effort fallback limiter (per isolate only)

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return {};
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const sameOrigin = origin === new URL(request.url).origin;
  if (!sameOrigin && !allowed.includes(origin)) return null; // blocked
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

async function isRateLimited(request, env) {
  const key = request.headers.get("CF-Connecting-IP") || "unknown";
  if (env.RATE_LIMITER) {
    const { success } = await env.RATE_LIMITER.limit({ key });
    return !success;
  }
  const now = Date.now();
  const hits = (buckets.get(key) || []).filter((t) => now - t < 60_000);
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > 5000) buckets.clear();
  return hits.length > 10;
}

const json = (status, code, message, extra = {}) =>
  new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra },
  });

async function handleAnalyze(request, env, ctx, cors) {
  if (!(request.headers.get("Content-Type") || "").includes("application/json")) {
    return json(415, "unsupported_type", "Send JSON with Content-Type: application/json.", cors);
  }
  if (Number(request.headers.get("Content-Length") || 0) > LIMITS.maxBodyBytes) {
    return json(413, "too_large", "That request is too large.", cors);
  }
  if (await isRateLimited(request, env)) {
    return json(429, "rate_limited", "You're going a little fast. Wait a minute and try again.", { ...cors, "Retry-After": "60" });
  }
  let text;
  try {
    const raw = await request.text();
    if (raw.length > LIMITS.maxBodyBytes) throw new HttpError(413, "too_large", "That request is too large.");
    text = validateRequest(JSON.parse(raw));
  } catch (err) {
    if (err instanceof HttpError) return json(err.status, err.code, err.message, cors);
    return json(400, "invalid_request", "That request couldn't be read.", cors);
  }

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const send = (event, data) => writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

  ctx.waitUntil(
    (async () => {
      try {
        await send("stage", { stage: 1 });
        const result = await analyze(env, text, (n) => send("stage", { stage: n }));
        await send("result", result);
      } catch (err) {
        const e = err instanceof HttpError ? err : new HttpError(500, "internal", "Something went wrong on our side. Please try again.");
        try { await send("error", { code: e.code, message: e.message }); } catch { /* client left */ }
      } finally {
        try { await writer.close(); } catch { /* client left */ }
      }
    })()
  );

  return new Response(readable, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no", ...cors },
  });
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/api/")) {
      const cors = corsHeaders(request, env);
      if (cors === null) return json(403, "origin_not_allowed", "This origin isn't allowed.");
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
      if (pathname === "/api/health" && request.method === "GET") {
        return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json", ...cors } });
      }
      if (pathname === "/api/analyze") {
        if (request.method !== "POST") return json(405, "method_not_allowed", "Use POST.", cors);
        return handleAnalyze(request, env, ctx, cors);
      }
      return json(404, "not_found", "Not found.", cors);
    }
    return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Not found", { status: 404 });
  },
};
