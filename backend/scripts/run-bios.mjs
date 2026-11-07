// Manual QA against a running instance: BASE=http://localhost:8787 npm run test:bios
// Uses the real AI provider, so it spends free-tier Neurons (~11 requests).
import { readFile } from "node:fs/promises";

const BASE = process.env.BASE || "http://localhost:8787";
const bios = JSON.parse(await readFile(new URL("../test/bios.json", import.meta.url), "utf8"));

async function analyse(text) {
  const res = await fetch(`${BASE}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) return { error: (await res.json()).error };
  const body = await res.text();
  const frames = body.split("\n\n").filter(Boolean);
  const last = frames.at(-1) || "";
  const event = /^event: (\w+)/.exec(last)?.[1];
  const data = JSON.parse(/^data: (.*)$/m.exec(last)?.[1] || "null");
  return event === "result" ? { result: data } : { error: data };
}

for (const { id, text } of bios) {
  const { result, error } = await analyse(text);
  if (error) console.log(`${id.padEnd(26)} -> ${error.code}: ${error.message}`);
  else {
    const r = result;
    console.log(`${id.padEnd(26)} -> +${r.positive_signals.length} ?${r.ambiguous_signals.length} !${r.concerning_signals.length} dropped=${r.meta.dropped_signals} questions=${r.suggested_questions.length}`);
  }
  await new Promise((r) => setTimeout(r, 7000)); // stay under 10 req/min
}
