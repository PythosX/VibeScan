export const LIMITS = { minChars: 20, maxChars: 3000, maxBodyBytes: 16 * 1024 };
export const CATEGORIES = ["intentions", "communication", "lifestyle", "values", "boundaries"];

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const QUOTES = "'\u2018\u2019\"\u201C\u201D";

export function validateRequest(body) {
  if (!body || typeof body !== "object" || typeof body.text !== "string") {
    throw new HttpError(400, "invalid_request", 'Send the profile as JSON: {"text": "..."}.');
  }
  const text = body.text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .trim();
  if (!text) throw new HttpError(400, "empty", "Add some profile text first.");
  if (!/\p{L}/u.test(text) || text.length < LIMITS.minChars) {
    throw new HttpError(400, "too_short", `Add a little more text (at least ${LIMITS.minChars} characters) so there is something to interpret.`);
  }
  if (text.length > LIMITS.maxChars) {
    throw new HttpError(400, "too_long", `That's ${text.length.toLocaleString("en")} characters. The limit is ${LIMITS.maxChars.toLocaleString("en")}.`);
  }
  return text;
}

function toPattern(p) {
  let out = "";
  for (const ch of p.trim()) {
    if (/\s/.test(ch)) {
      if (!out.endsWith("\\s+")) out += "\\s+";
    } else if (QUOTES.includes(ch)) {
      out += `[${QUOTES}]`;
    } else {
      out += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return out;
}

/** Find a phrase in the original text, tolerant to whitespace, case and quote style. */
export function findSpan(text, phrase) {
  if (typeof phrase !== "string") return null;
  const trimmed = phrase.replace(new RegExp(`^[\\s${QUOTES}]+|[\\s${QUOTES}.,;:!?\u2026]+$`, "g"), "");
  for (const v of [phrase, trimmed]) {
    if (v.trim().length < 2 || v.length > 200) continue;
    const m = new RegExp(toPattern(v), "i").exec(text);
    if (m) return { start: m.index, end: m.index + m[0].length };
  }
  return null;
}

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strList = (v, n, max = 300) =>
  Array.isArray(v) ? v.map((x) => str(x, max)).filter(Boolean).slice(0, n) : [];

const invalid = () =>
  new HttpError(502, "invalid_output", "The AI returned an answer we couldn't read safely, so nothing is shown. Please try again.");

/** Validate and normalise model output. Never trusts the model's shape or quotes. */
export function validateResult(raw, text) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw invalid();
  const summary = str(raw.summary, 900);
  if (!summary) throw invalid();

  let dropped = 0;
  const signals = (list) => {
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const s of list.slice(0, 8)) {
      if (!s || typeof s !== "object") continue;
      const span = findSpan(text, s.phrase);
      const explanation = str(s.explanation, 500);
      if (!span || !explanation) {
        dropped++;
        continue;
      }
      out.push({
        phrase: text.slice(span.start, span.end),
        start: span.start,
        end: span.end,
        explanation,
        why_it_matters: str(s.why_it_matters, 500),
        alternative_interpretation: str(s.alternative_interpretation, 500),
        clarification_question: str(s.clarification_question, 300),
        context: str(s.context, 400),
      });
    }
    return out;
  };

  const expectations = (Array.isArray(raw.expectations) ? raw.expectations : [])
    .map((e) => ({ category: str(e?.category, 20).toLowerCase(), statement: str(e?.statement, 300) }))
    .filter((e) => CATEGORIES.includes(e.category) && e.statement)
    .slice(0, 12);

  return {
    summary,
    relationship_intentions: strList(raw.relationship_intentions, 6),
    communication_style: str(raw.communication_style, 500),
    positive_signals: signals(raw.positive_signals),
    ambiguous_signals: signals(raw.ambiguous_signals),
    concerning_signals: signals(raw.concerning_signals),
    expectations,
    suggested_questions: strList(raw.suggested_questions, 5),
    observations: strList(raw.observations, 3),
    things_to_clarify: strList(raw.things_to_clarify, 2),
    practical_suggestion: str(raw.practical_suggestion, 400),
    analysed_text: text,
    meta: { dropped_signals: dropped },
  };
}
