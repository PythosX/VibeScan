// Runs entirely in the browser. The image is never sent to any server.
// Only the Tesseract.js library and its English language data are downloaded (from jsDelivr).
const SRC = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";

function loadLibrary() {
  if (window.Tesseract) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SRC;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error("Couldn't load the text reader. Check your connection, or paste the text instead."));
    document.head.appendChild(s);
  });
}

const LABELS = {
  "loading tesseract core": "Loading the text reader…",
  "initializing tesseract": "Loading the text reader…",
  "loading language traineddata": "Downloading language data…",
  "initializing api": "Getting ready…",
  "recognizing text": "Reading text in your browser…",
};

export async function extractText(file, onProgress = () => {}) {
  await loadLibrary();
  let worker;
  try {
    worker = await window.Tesseract.createWorker("eng", 1, {
      logger: (m) => onProgress({ label: LABELS[m.status] || "Working…", percent: Math.round((m.progress || 0) * 100) }),
    });
    const { data } = await worker.recognize(file);
    const text = (data.text || "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    return { text, confidence: Math.round(data.confidence || 0) };
  } finally {
    if (worker) await worker.terminate().catch(() => {});
  }
}
