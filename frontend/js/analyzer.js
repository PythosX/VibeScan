import { store, toast } from "./app.js";
import { validateText, validateImage, MAX_CHARS } from "./validation.js";
import { analyzeProfile } from "./api.js";
import { extractText } from "./ocr.js";

const $ = (id) => document.getElementById(id);
const el = {
  inputView: $("inputView"), progressView: $("progressView"),
  tabs: { paste: $("tab-paste"), upload: $("tab-upload") },
  panels: { paste: $("panel-paste"), upload: $("panel-upload") },
  bio: $("bio"), count: $("count"), counter: $("bio-count"), bioError: $("bio-error"),
  example: $("example"), exampleNote: $("example-note"), clear: $("clear"), ocrNotice: $("ocr-notice"),
  analyse: $("analyse"),
  file: $("file"), dropzone: $("dropzone"), dropWrap: $("drop-zone-wrap"), previewWrap: $("preview-wrap"),
  previewImg: $("preview-img"), fileName: $("file-name"), extract: $("extract"), remove: $("remove"),
  ocrProgress: $("ocr-progress"), ocrBar: $("ocr-bar"), ocrLabel: $("ocr-label"), fileError: $("file-error"),
  stages: $("stages"), bar: $("bar"), barFill: $("bar-fill"), cancel: $("cancel"), progressTitle: $("progress-title"),
};

const EXAMPLE = `Sample bio (made up): Product designer, weekend climber, terrible at small talk. Looking for something real. No drama, no games, I know my worth and I don't chase. I have traditional values but I'm happy to split the bill and the chores. Tell me about the last book that changed your mind.`;

let currentTab = "paste";
let imageFile = null;
let imageUrl = null;
let controller = null;

/* ---------- Messages ---------- */
function showMsg(node, message) {
  node.innerHTML = "";
  const strong = document.createElement("strong");
  strong.textContent = "Can't continue. ";
  node.append(strong, document.createTextNode(message));
  node.hidden = false;
}
const hideMsg = (node) => { node.hidden = true; node.textContent = ""; };

/* ---------- Tabs ---------- */
function selectTab(name, focus = false) {
  currentTab = name;
  for (const [key, tab] of Object.entries(el.tabs)) {
    const on = key === name;
    tab.setAttribute("aria-selected", String(on));
    tab.tabIndex = on ? 0 : -1;
    el.panels[key].hidden = !on;
  }
  if (focus) el.tabs[name].focus();
}
for (const [key, tab] of Object.entries(el.tabs)) {
  tab.addEventListener("click", () => selectTab(key));
  tab.addEventListener("keydown", (e) => {
    if (["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      selectTab(e.key === "ArrowLeft" || e.key === "Home" ? "paste" : "upload", true);
    }
  });
}

/* ---------- Text input ---------- */
function updateCount() {
  const n = el.bio.value.length;
  el.count.textContent = n.toLocaleString("en");
  const over = n > MAX_CHARS;
  el.counter.classList.toggle("is-over", over);
  if (over) showMsg(el.bioError, `That's ${n.toLocaleString("en")} characters. The limit is ${MAX_CHARS.toLocaleString("en")}.`);
  else if (!el.bioError.hidden) hideMsg(el.bioError);
  el.bio.setAttribute("aria-invalid", String(over));
}
el.bio.addEventListener("input", () => { el.ocrNotice.hidden = true; el.exampleNote.hidden = true; updateCount(); });

el.example.addEventListener("click", () => {
  selectTab("paste");
  el.bio.value = EXAMPLE;
  el.exampleNote.hidden = false;
  el.ocrNotice.hidden = true;
  updateCount();
  el.bio.focus();
});

function resetImage() {
  if (imageUrl) URL.revokeObjectURL(imageUrl);
  imageFile = null; imageUrl = null;
  el.file.value = "";
  el.previewImg.removeAttribute("src");
  el.previewWrap.hidden = true;
  el.dropWrap.hidden = false;
  el.ocrProgress.hidden = true;
  hideMsg(el.fileError);
}

el.clear.addEventListener("click", () => {
  el.bio.value = "";
  el.ocrNotice.hidden = true;
  el.exampleNote.hidden = true;
  hideMsg(el.bioError);
  resetImage();
  store.clear(); // also removes any previous report held in this tab
  updateCount();
  el.bio.focus();
  toast("Cleared. Nothing is stored.");
});

/* ---------- Screenshot upload + OCR ---------- */
async function handleFile(file) {
  hideMsg(el.fileError);
  const check = await validateImage(file);
  if (!check.ok) { showMsg(el.fileError, check.error); el.file.value = ""; return; }
  resetImage();
  imageFile = file;
  imageUrl = URL.createObjectURL(file);
  el.previewImg.src = imageUrl;
  el.fileName.textContent = `${file.name} (${(file.size / 1024).toFixed(0)} KB)`;
  el.previewWrap.hidden = false;
  el.dropWrap.hidden = true;
  el.extract.focus();
}
el.file.addEventListener("change", () => el.file.files[0] && handleFile(el.file.files[0]));
for (const ev of ["dragenter", "dragover"]) el.dropzone.addEventListener(ev, (e) => { e.preventDefault(); el.dropzone.classList.add("is-over"); });
for (const ev of ["dragleave", "drop"]) el.dropzone.addEventListener(ev, (e) => { e.preventDefault(); el.dropzone.classList.remove("is-over"); });
el.dropzone.addEventListener("drop", (e) => {
  const files = e.dataTransfer?.files;
  if (files?.length > 1) showMsg(el.fileError, "Drop one screenshot at a time.");
  else if (files?.[0]) handleFile(files[0]);
});
el.remove.addEventListener("click", () => { resetImage(); el.file.focus(); });

el.extract.addEventListener("click", async () => {
  if (!imageFile) return;
  hideMsg(el.fileError);
  el.extract.disabled = true; el.remove.disabled = true;
  el.ocrProgress.hidden = false; el.ocrBar.value = 0;
  try {
    const { text, confidence } = await extractText(imageFile, ({ label, percent }) => {
      el.ocrLabel.textContent = label;
      el.ocrBar.value = percent;
    });
    if (!text || !/\p{L}/u.test(text)) {
      showMsg(el.fileError, "No readable text was found. Try a sharper, closer screenshot, or paste the text instead.");
      return;
    }
    el.bio.value = text.slice(0, MAX_CHARS + 1);
    el.ocrNotice.textContent = confidence < 70
      ? "The scanner wasn't very confident about this screenshot, so expect mistakes. Check and fix the text before analysing."
      : "Text read from your screenshot. Check it and fix any mistakes before analysing.";
    el.ocrNotice.hidden = false;
    updateCount();
    selectTab("paste");
    el.bio.focus();
  } catch (err) {
    showMsg(el.fileError, err.message || "Couldn't read that image. Paste the text instead.");
  } finally {
    el.extract.disabled = false; el.remove.disabled = false;
    el.ocrProgress.hidden = true;
  }
});

/* ---------- Analysis ---------- */
function setStage(n, finished = false) {
  const items = [...el.stages.children];
  items.forEach((li, i) => {
    const num = i + 1;
    const done = finished || num < n;
    const active = !finished && num === n;
    li.classList.toggle("is-done", done);
    li.classList.toggle("is-active", active);
    li.querySelector(".stage-state").textContent = done ? "Done" : active ? "In progress" : "Waiting";
  });
  const completed = finished ? 5 : Math.max(0, n - 1);
  el.bar.setAttribute("aria-valuenow", String(completed));
  el.barFill.style.width = `${(completed / 5) * 100}%`;
}

function showView(name) {
  el.inputView.hidden = name !== "input";
  el.progressView.hidden = name !== "progress";
  if (name === "progress") el.progressTitle.focus();
}

el.analyse.addEventListener("click", async () => {
  hideMsg(el.bioError); hideMsg(el.fileError);

  if (currentTab === "upload") {
    if (!el.bio.value.trim()) {
      showMsg(el.fileError, imageFile ? "Extract the text first, then review it before analysing." : "Upload a screenshot, or switch to Paste text.");
      return;
    }
    selectTab("paste");
    el.ocrNotice.textContent = "Review this text, then choose Analyse profile.";
    el.ocrNotice.hidden = false;
    el.bio.focus();
    return;
  }

  const v = validateText(el.bio.value);
  if (!v.ok) { showMsg(el.bioError, v.error); el.bio.setAttribute("aria-invalid", "true"); el.bio.focus(); return; }

  controller = new AbortController();
  setStage(1);
  showView("progress");
  try {
    const result = await analyzeProfile(v.text, { signal: controller.signal, onStage: setStage });
    setStage(5, true);
    if (!store.save({ result, createdAt: Date.now() })) {
      throw new Error("Your browser blocked temporary storage, so the report can't be shown. Allow site storage and try again.");
    }
    setTimeout(() => location.assign("results.html"), 250);
  } catch (err) {
    showView("input");
    if (err.name === "AbortError") { toast("Analysis cancelled."); return; }
    showMsg(el.bioError, err.message || "Something went wrong. Please try again.");
    el.bio.focus();
  } finally {
    controller = null;
  }
});

el.cancel.addEventListener("click", () => controller?.abort());
window.addEventListener("pageshow", (e) => { if (e.persisted) showView("input"); });
updateCount();
