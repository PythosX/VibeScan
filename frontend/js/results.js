import { store, copyText, toast } from "./app.js";

const $ = (id) => document.getElementById(id);
const DISCLAIMER = "An AI analysis is only a starting point. A dating profile cannot establish someone's complete personality or intentions.";
const KINDS = [
  { key: "positive_signals", kind: "positive", label: "Positive", heading: "Positive signals", none: "No clearly positive language was identified." },
  { key: "ambiguous_signals", kind: "ambiguous", label: "Ambiguous", heading: "Ambiguous signals", none: "No ambiguous phrases were identified." },
  { key: "concerning_signals", kind: "concerning", label: "Concerning", heading: "Explicitly concerning language", none: "No explicitly concerning language was identified. That only reflects what is written; it isn't a clean bill of health." },
];
const CATEGORIES = [
  ["intentions", "Relationship intentions"], ["communication", "Communication expectations"],
  ["lifestyle", "Lifestyle preferences"], ["values", "Personal values"], ["boundaries", "Boundaries"],
];

/* Safe DOM builder: all model text goes through textContent, never innerHTML. */
function h(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) node.append(kid.nodeType ? kid : document.createTextNode(kid));
  return node;
}
const tag = (kind, text) => h("span", { class: "tag", "data-kind": kind }, text);

/* ---------- State ---------- */
const saved = store.load();
const mobile = window.matchMedia("(max-width: 959px)");
let lastTrigger = null;
let s_nodes = []; // signals that have a highlight in the bio


function render(r, createdAt) {
  const flat = KINDS.flatMap(({ key, kind, label }) => (r[key] || []).map((s) => ({ ...s, kind, label })));
  const main = $("report-main");
  main.append(sectionSummary(r), sectionSignals(r, flat), sectionBio(r, flat), sectionExpectations(r), sectionQuestions(r), sectionFinal(r));

  const time = new Date(createdAt || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  $("report-meta").textContent = `Analysed at ${time} by ${r.meta?.provider || "an AI model"}. Kept only in this browser tab.`;
  if (r.meta?.dropped_signals > 0) {
    const n = r.meta.dropped_signals;
    $("dropped-note").textContent = `${n} item${n > 1 ? "s were" : " was"} removed because the AI quoted wording that doesn't appear in your text.`;
    $("dropped-note").hidden = false;
  }
  resetDetail();
  $("report").hidden = false;
  $("report-title").focus({ preventScroll: true });

  $("copy-report").addEventListener("click", () => copyText(reportText(r), "Report copied"));
  $("copy-questions").addEventListener("click", () => {
    if (!r.suggested_questions.length) return toast("There are no suggested questions to copy.");
    copyText(r.suggested_questions.map((q, i) => `${i + 1}. ${q}`).join("\n"), "Questions copied");
  });
  $("clear-analysis").addEventListener("click", () => {
    store.clear();
    $("report").hidden = true;
    $("empty-title").textContent = "Analysis cleared";
    $("empty-text").textContent = "The report and the profile text were removed from this tab. Nothing is stored.";
    $("empty").hidden = false;
    $("empty-title").focus();
  });
}

/* ---------- Sections ---------- */
const section = (id, title, ...kids) => h("section", { class: "report-section", "aria-labelledby": id }, h("h2", { id, text: title }), ...kids);

function sectionSummary(r) {
  const counts = KINDS.map(({ key, kind }) => tag(kind, `${(r[key] || []).length} ${kind}`));
  return section("sec-summary", "Overall summary",
    h("p", { class: "summary-text", text: r.summary }),
    h("dl", { class: "facts" },
      h("div", {}, h("dt", { text: "What the profile says it wants" }),
        h("dd", {}, r.relationship_intentions.length ? h("ul", { class: "plain" }, r.relationship_intentions.map((t) => h("li", { text: t }))) : "Nothing explicit.")),
      h("div", {}, h("dt", { text: "Overall language interpretation" }), h("dd", { text: r.communication_style || "Not enough text to say." })),
      h("div", {}, h("dt", { text: "Phrases found" }), h("dd", { class: "tag-row" }, counts))));
}

function signalBody(s, withQuote = true) {
  const rows = [
    ["What it says", s.explanation], ["Context", s.context], ["Why it might matter", s.why_it_matters],
    ["Another way to read it", s.alternative_interpretation],
  ].filter(([, v]) => v);
  return [
    withQuote && h("blockquote", { class: "quote", text: `“${s.phrase}”` }),
    h("dl", { class: "signal-rows" }, rows.map(([k, v]) => h("div", {}, h("dt", { text: k }), h("dd", { text: v })))),
    s.clarification_question && h("div", { class: "ask" },
      h("div", {}, h("span", { class: "label-sm", text: "Question you could ask" }), h("p", { text: s.clarification_question })),
      h("button", { class: "btn btn-quiet btn-sm", type: "button", "aria-label": `Copy question about “${s.phrase}”`, onclick: () => copyText(s.clarification_question, "Question copied") }, "Copy")),
  ];
}

function sectionSignals(r, flat) {
  const groups = KINDS.map(({ key, kind, label, heading, none }) => {
    const list = flat.filter((s) => s.kind === kind);
    return h("div", { class: "signal-group", "data-kind": kind },
      h("h3", {}, heading, h("span", { class: "count", text: ` (${list.length})` })),
      list.length ? list.map((s) => h("article", { class: "signal", "data-kind": kind },
        h("div", { class: "signal-head" }, tag(kind, label),
          h("button", { class: "btn btn-quiet btn-sm", type: "button", onclick: (e) => openDetail(s, e.currentTarget, true) }, "Show in bio")),
        signalBody(s))) : h("p", { class: "muted", text: none }));
  });
  return section("sec-signals", "Language signals",
    h("p", { class: "hint", text: "These classify the wording, not the person. Context can change what a phrase means." }), groups);
}

function sectionBio(r, flat) {
  const text = r.analysed_text;
  const ranges = flat.filter((s) => Number.isInteger(s.start)).sort((a, b) => a.start - b.start || b.end - a.end);
  const kids = [];
  let pos = 0;
  for (const s of ranges) {
    if (s.start < pos) continue; // overlapping phrase: still listed above
    if (s.start > pos) kids.push(text.slice(pos, s.start));
    const span = h("span", {
      class: "hl", "data-kind": s.kind, role: "button", tabindex: "0", "aria-pressed": "false",
      "aria-label": `${s.label} signal: ${s.phrase}. Open explanation`,
    }, text.slice(s.start, s.end));
    s.node = span;
    const open = () => openDetail(s, span, false);
    span.addEventListener("click", open);
    span.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
    kids.push(span);
    pos = s.end;
  }
  if (pos < text.length) kids.push(text.slice(pos));
  s_nodes = ranges.filter((x) => x.node);
  return section("sec-bio", "Phrase-by-phrase breakdown",
    h("p", { class: "hint", text: "Select a highlighted phrase to see what it may mean." }),
    h("p", { class: "bio-view", id: "bio-view" }, kids),
    h("ul", { class: "legend", "aria-label": "Legend" }, KINDS.map(({ kind, label }) => h("li", {}, tag(kind, label)))));
}
function sectionExpectations(r) {
  const groups = CATEGORIES.map(([cat, label]) => {
    const items = r.expectations.filter((e) => e.category === cat).map((e) => e.statement);
    if (cat === "intentions") for (const t of r.relationship_intentions) if (!items.includes(t)) items.push(t);
    return h("div", {}, h("dt", { text: label }),
      h("dd", {}, items.length ? h("ul", { class: "plain" }, items.map((t) => h("li", { text: t }))) : h("span", { class: "muted", text: "Not stated in the profile." })));
  });
  return section("sec-expect", "Relationship expectations",
    h("p", { class: "hint", text: "Only what the profile itself says. Nothing here is inferred." }),
    h("dl", { class: "facts facts-wide" }, groups),
    h("p", { class: "muted small", text: "Questions for comparing compatibility are in the next section." }));
}

function sectionQuestions(r) {
  return section("sec-questions", "Questions to ask",
    r.suggested_questions.length
      ? h("ol", { class: "questions" }, r.suggested_questions.map((q, i) =>
          h("li", {}, h("span", { text: q }),
            h("button", { class: "btn btn-quiet btn-sm", type: "button", "aria-label": `Copy question ${i + 1}`, onclick: () => copyText(q, "Question copied") }, "Copy"))))
      : h("p", { class: "muted", text: "There wasn't enough text to suggest questions." }));
}

function sectionFinal(r) {
  const list = (items) => h("ul", { class: "plain bullets" }, items.map((t) => h("li", { text: t })));
  return section("sec-final", "Final observations",
    r.observations.length ? [h("h3", { text: "Three important observations" }), list(r.observations)] : null,
    r.things_to_clarify.length ? [h("h3", { text: "Two things worth clarifying" }), list(r.things_to_clarify)] : null,
    r.practical_suggestion ? [h("h3", { text: "One practical suggestion" }), h("p", { text: r.practical_suggestion })] : null,
    h("p", { class: "disclaimer", text: DISCLAIMER }),
    h("div", { class: "final-actions" }, h("a", { class: "btn btn-primary", href: "analyzer.html", text: "Analyse another profile" })));
}

/* ---------- Detail panel: side panel on desktop, bottom sheet on mobile ---------- */
function resetDetail() {
  const d = $("detail");
  d.replaceChildren(h("h2", { text: "Explanation" }),
    h("p", { class: "muted", text: "Select a highlighted phrase in the breakdown to see what it may mean, how else it could be read, and what you could ask." }));
}

function openDetail(s, trigger, scrollToBio) {
  const d = $("detail");
  lastTrigger = trigger;
  for (const x of s_nodes) x.node?.setAttribute("aria-pressed", String(x === s));
  d.replaceChildren(
    h("div", { class: "detail-head" }, tag(s.kind, s.label),
      h("button", { class: "btn btn-quiet btn-sm detail-close", type: "button", onclick: closeDetail }, "Close")),
    h("h2", { id: "detail-title", text: "Explanation" }),
    ...signalBody(s).filter(Boolean));
  d.dataset.kind = s.kind;
  if (scrollToBio) $("bio-view")?.scrollIntoView({ block: "center", behavior: "smooth" });
  if (mobile.matches) {
    d.setAttribute("role", "dialog"); d.setAttribute("aria-modal", "true"); d.setAttribute("aria-labelledby", "detail-title");
    d.classList.add("is-open"); $("scrim").hidden = false;
    d.focus();
  }
}

function closeDetail() {
  const d = $("detail");
  d.classList.remove("is-open"); $("scrim").hidden = true;
  d.removeAttribute("role"); d.removeAttribute("aria-modal"); d.removeAttribute("aria-labelledby");
  resetDetail();
  for (const x of s_nodes) x.node?.setAttribute("aria-pressed", "false");
  if (lastTrigger?.isConnected) lastTrigger.focus();
}
$("scrim").addEventListener("click", closeDetail);
document.addEventListener("keydown", (e) => {
  const d = $("detail");
  if (!d.classList.contains("is-open")) return;
  if (e.key === "Escape") closeDetail();
  if (e.key === "Tab") { // keep focus inside the open sheet
    const f = [...d.querySelectorAll("button, [href]")];
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === d)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});
mobile.addEventListener("change", () => { $("detail").classList.remove("is-open"); $("scrim").hidden = true; });

/* ---------- Plain-text report ---------- */
function reportText(r) {
  const out = ["VIBESCAN ANALYSIS", "", "SUMMARY", r.summary, ""];
  if (r.relationship_intentions.length) out.push("What the profile says it wants:", ...r.relationship_intentions.map((t) => `- ${t}`), "");
  if (r.communication_style) out.push("Overall language interpretation:", r.communication_style, "");
  for (const { key, heading } of KINDS) {
    const list = r[key] || [];
    if (!list.length) continue;
    out.push(heading.toUpperCase());
    for (const s of list) {
      out.push(`"${s.phrase}"`, `  What it says: ${s.explanation}`);
      if (s.context) out.push(`  Context: ${s.context}`);
      if (s.why_it_matters) out.push(`  Why it might matter: ${s.why_it_matters}`);
      if (s.alternative_interpretation) out.push(`  Another reading: ${s.alternative_interpretation}`);
      if (s.clarification_question) out.push(`  Ask: ${s.clarification_question}`);
      out.push("");
    }
  }
  if (r.suggested_questions.length) out.push("QUESTIONS TO ASK", ...r.suggested_questions.map((q, i) => `${i + 1}. ${q}`), "");
  if (r.observations.length) out.push("OBSERVATIONS", ...r.observations.map((t) => `- ${t}`), "");
  if (r.things_to_clarify.length) out.push("WORTH CLARIFYING", ...r.things_to_clarify.map((t) => `- ${t}`), "");
  if (r.practical_suggestion) out.push("SUGGESTION", r.practical_suggestion, "");
  out.push(DISCLAIMER);
  return out.join("\n");
}

/* ---------- Start (last, so every helper above is initialised) ---------- */
if (!saved?.result?.summary) {
  $("empty").hidden = false;
  $("empty-title").focus();
} else {
  render(saved.result, saved.createdAt);
}
