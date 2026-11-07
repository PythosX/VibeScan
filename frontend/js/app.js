const KEY = "vibescan:result";

/** Results live in sessionStorage only: this tab, until cleared or closed. */
export const store = {
  save(data) { try { sessionStorage.setItem(KEY, JSON.stringify(data)); return true; } catch { return false; } },
  load() { try { return JSON.parse(sessionStorage.getItem(KEY) || "null"); } catch { return null; } },
  clear() { try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } },
};

let toastTimer;
export function toast(message) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("is-on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-on"), 2200);
}

export async function copyText(text, message = "Copied to clipboard") {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.className = "sr-only";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { /* ignore */ }
    ta.remove();
    if (!ok) { toast("Couldn't copy. Select the text and copy it manually."); return false; }
  }
  toast(message);
  return true;
}

/* Mobile navigation */
function initNav() {
  const btn = document.querySelector(".nav-toggle");
  const nav = document.getElementById("site-nav");
  if (!btn || !nav) return;
  const set = (open) => { btn.setAttribute("aria-expanded", String(open)); nav.classList.toggle("is-open", open); };
  btn.addEventListener("click", () => set(btn.getAttribute("aria-expanded") !== "true"));
  nav.addEventListener("click", (e) => { if (e.target.closest("a")) set(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && nav.classList.contains("is-open")) { set(false); btn.focus(); } });
  const page = document.body.dataset.page;
  if (page === "analyzer") nav.querySelector("[data-nav-new]")?.setAttribute("aria-current", "page");
}

/* One gentle reveal for below-the-fold landing sections */
function initReveal() {
  const items = [...document.querySelectorAll(".reveal")];
  if (!items.length || !("IntersectionObserver" in window)) return;
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) { en.target.classList.remove("reveal-wait"); io.unobserve(en.target); }
  }, { rootMargin: "0px 0px -8% 0px" });
  for (const el of items) {
    if (el.getBoundingClientRect().top > window.innerHeight) { el.classList.add("reveal-wait"); io.observe(el); }
  }
}

/* Landing page: the example preview lets you switch between its three sample phrases */
function initPreview() {
  const marks = [...document.querySelectorAll("[data-preview]")];
  if (!marks.length) return;
  const show = (mark) => {
    for (const m of marks) {
      const on = m === mark;
      m.setAttribute("aria-pressed", String(on));
      document.getElementById(m.dataset.preview).hidden = !on;
    }
  };
  for (const m of marks) {
    m.addEventListener("click", () => show(m));
    m.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); show(m); } });
  }
}

/* 18+ confirmation before first use (analyzer page) */
function initAgeGate() {
  if (!document.body.hasAttribute("data-age-gate")) return;
  const KEY_AGE = "vibescan:adult";
  let ok = false;
  try { ok = localStorage.getItem(KEY_AGE) === "1"; } catch { /* storage blocked: ask each time */ }
  if (ok) return;
  const dlg = document.getElementById("age-gate");
  if (!dlg || typeof dlg.showModal !== "function") return;
  dlg.addEventListener("cancel", (e) => e.preventDefault());
  document.getElementById("age-yes").addEventListener("click", () => {
    try { localStorage.setItem(KEY_AGE, "1"); } catch { /* ignore */ }
    dlg.close();
  });
  document.getElementById("age-no").addEventListener("click", () => {
    document.getElementById("age-ask").hidden = true;
    document.getElementById("age-denied").hidden = false;
    dlg.querySelector("a")?.focus();
  });
  dlg.showModal();
}

initNav();
initReveal();
initPreview();
initAgeGate();
