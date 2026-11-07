import { API_BASE } from "./config.js";

export class ApiError extends Error {
  constructor(message, code = "error") {
    super(message);
    this.code = code;
  }
}

function parseFrame(frame) {
  let event = "message";
  const data = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  try {
    return { event, data: JSON.parse(data.join("\n")) };
  } catch {
    return null;
  }
}

/**
 * Sends the text to the backend and resolves with the validated result.
 * onStage(n) fires with real progress reported by the server (1-5).
 */
export async function analyzeProfile(text, { signal, onStage } = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal,
    });
  } catch (err) {
    if (err.name === "AbortError") throw err;
    throw new ApiError("Couldn't reach the analysis service. Check your connection and try again.", "network");
  }

  if (!res.ok) {
    let msg = "The analysis service returned an error. Please try again.";
    let code = "http";
    try {
      const body = await res.json();
      msg = body?.error?.message || msg;
      code = body?.error?.code || code;
    } catch { /* keep default */ }
    throw new ApiError(msg, code);
  }
  if (!res.body) throw new ApiError("Your browser can't read streamed responses. Try a current browser.", "unsupported");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result = null;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const msg = parseFrame(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 2);
        if (!msg) continue;
        if (msg.event === "stage") onStage?.(msg.data.stage);
        else if (msg.event === "result") result = msg.data;
        else if (msg.event === "error") throw new ApiError(msg.data.message, msg.data.code);
      }
    }
  } catch (err) {
    if (err.name === "AbortError" || err instanceof ApiError) throw err;
    throw new ApiError("The connection was interrupted. Please try again.", "network");
  }
  if (!result) throw new ApiError("The analysis ended unexpectedly. Please try again.", "incomplete");
  return result;
}
