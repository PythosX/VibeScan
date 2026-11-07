export const MAX_CHARS = 3000;
export const MIN_CHARS = 20;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

export function validateText(raw) {
  const text = String(raw ?? "").replace(/\r\n?/g, "\n").trim();
  if (!text) return { ok: false, error: "Add some profile text first, or try the example profile." };
  if (text.length < MIN_CHARS || !/\p{L}/u.test(text)) {
    return { ok: false, error: `That's very short. Add at least ${MIN_CHARS} characters so there's something to interpret.` };
  }
  if (text.length > MAX_CHARS) {
    return { ok: false, error: `That's ${text.length.toLocaleString("en")} characters. The limit is ${MAX_CHARS.toLocaleString("en")}. Trim it to the profile text itself.` };
  }
  return { ok: true, text };
}

/** Checks declared type, size and the file's real signature (magic bytes). */
export async function validateImage(file) {
  if (!file) return { ok: false, error: "Choose an image first." };
  if (!IMAGE_TYPES.includes(file.type)) {
    return { ok: false, error: "That file type isn't supported. Use a JPG, PNG or WEBP screenshot." };
  }
  if (file.size === 0) return { ok: false, error: "That file is empty." };
  if (file.size > MAX_IMAGE_BYTES) {
    return { ok: false, error: `That image is ${(file.size / 1048576).toFixed(1)} MB. The limit is 5 MB.` };
  }
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const isJpeg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  const isPng = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  const isWebp = String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP";
  if (!(isJpeg || isPng || isWebp)) {
    return { ok: false, error: "That file doesn't look like a real JPG, PNG or WEBP image." };
  }
  return { ok: true };
}
