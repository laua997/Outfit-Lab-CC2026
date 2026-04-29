import { REPLICATE_PROXY_URL } from "./config.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function clampDelayMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return 500;
  return Math.min(ms, 60_000);
}

function retryAfterHeaderMs(res) {
  const raw = res.headers.get("retry-after");
  if (!raw) return null;
  const asInt = Number.parseInt(raw, 10);
  if (Number.isFinite(asInt) && asInt >= 0) return clampDelayMs(asInt * 1000);
  const asDate = Date.parse(raw);
  if (Number.isFinite(asDate)) return clampDelayMs(asDate - Date.now());
  return null;
}

function retryHintFromBody(text) {
  const lower = text.toLowerCase();
  const patterns = [/resets in ~(\d+)\s*s/i, /retry after (\d+)\s*s/i];
  for (const re of patterns) {
    const m = lower.match(re);
    if (m?.[1]) {
      const sec = Number.parseInt(m[1], 10);
      if (Number.isFinite(sec)) return clampDelayMs(sec * 1000);
    }
  }
  return null;
}

async function delayForRetry(attempt, res, bodyText) {
  const headerMs = retryAfterHeaderMs(res);
  const hintMs = retryHintFromBody(bodyText);
  const backoffMs = clampDelayMs(750 * 2 ** Math.min(attempt, 6) + Math.floor(Math.random() * 250));
  await sleep(headerMs ?? hintMs ?? backoffMs);
}

function firstOutputUrl(output) {
  if (!output) return null;
  if (Array.isArray(output)) return output[0] ?? null;
  return output;
}

/**
 * Read file as raw base64 (no data: prefix) for ITP proxy hosting.
 * @param {File} file
 */
export async function fileToRawBase64(file) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  const raw = btoa(binary);
  const mime = (file.type || "image/jpeg").toLowerCase();
  const proxyFormat = mime.includes("png") ? "png" : "jpg";
  return { raw, mime, proxyFormat };
}

export function dataUrlFromStored(mimeType, imageBase64) {
  const mime = mimeType || "image/jpeg";
  return `data:${mime};base64,${imageBase64}`;
}

export function proxyFormatFromMime(mimeType) {
  const m = (mimeType || "").toLowerCase();
  if (m.includes("png")) return "png";
  return "jpg";
}

function mimeFromProxyFormat(fileFormat) {
  return fileFormat === "png" ? "image/png" : "image/jpeg";
}

/** IDM-VTON / DressCode-style portrait canvas (3:4) used in many Replicate demos. */
const IDM_OUT_W = 768;
const IDM_OUT_H = 1024;
/** Avoid decoding multi‑megapixel textures at full res in the browser before downscale. */
const MAX_BITMAP_EDGE = 2048;

function rawJpegFromCanvas(canvas, quality) {
  const out = canvas.toDataURL("image/jpeg", quality);
  const i = out.indexOf(",");
  return i >= 0 ? out.slice(i + 1) : out;
}

/**
 * Letterbox image into 768×1024 (3:4) JPEG — matches typical IDM inputs and reduces parse failures.
 * @param {string} rawBase64
 * @param {string} mimeType
 * @returns {Promise<{ raw: string, fileFormat: "jpg" }>}
 */
export async function letterboxRawBase64ToIdmCanvas(rawBase64, mimeType) {
  const dataUrl = dataUrlFromStored(mimeType, rawBase64);
  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Could not decode image for try-on."));
    el.src = dataUrl;
  });
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) {
    throw new Error("Invalid image dimensions.");
  }

  /** @type {CanvasImageSource} */
  let source = img;
  const longEdge = Math.max(iw, ih);
  if (typeof createImageBitmap === "function" && longEdge > MAX_BITMAP_EDGE) {
    const r = MAX_BITMAP_EDGE / longEdge;
    const rw = Math.max(1, Math.round(iw * r));
    const rh = Math.max(1, Math.round(ih * r));
    try {
      source = await createImageBitmap(img, { resizeWidth: rw, resizeHeight: rh, resizeQuality: "high" });
    } catch {
      source = img;
    }
  }

  let sw = iw;
  let sh = ih;
  if (source !== img && source instanceof ImageBitmap) {
    sw = source.width;
    sh = source.height;
  }

  const canvas = document.createElement("canvas");
  canvas.width = IDM_OUT_W;
  canvas.height = IDM_OUT_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not prepare image canvas.");
  }
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, IDM_OUT_W, IDM_OUT_H);

  const scale = Math.min(IDM_OUT_W / sw, IDM_OUT_H / sh);
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));
  const ox = Math.floor((IDM_OUT_W - dw) / 2);
  const oy = Math.floor((IDM_OUT_H - dh) / 2);
  ctx.drawImage(source, ox, oy, dw, dh);

  if (source !== img && typeof source.close === "function") {
    try {
      source.close();
    } catch {
      /* ignore */
    }
  }

  return { raw: rawJpegFromCanvas(canvas, 0.92), fileFormat: "jpg" };
}

/**
 * Turn local image bytes into a public HTTPS URL via ITP proxy (Flux call that only hosts media).
 * @param {string} rawBase64
 * @param {"jpg"|"png"} fileFormat
 */
export async function hostRawBase64OnItpProxy(rawBase64, fileFormat) {
  const mime = mimeFromProxyFormat(fileFormat);
  const sized = await letterboxRawBase64ToIdmCanvas(rawBase64, mime);

  const payload = {
    model: "black-forest-labs/flux-schnell",
    fieldToConvertBase64ToURL: "image",
    fileFormat: sized.fileFormat,
    input: {
      prompt: "host",
      image: sized.raw,
    },
  };

  const maxAttempts = 8;
  let lastStatus = 0;
  let lastRaw = "";

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const res = await fetch(REPLICATE_PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const raw = await res.text();
    lastStatus = res.status;
    lastRaw = raw;

    if (!res.ok) {
      if ((res.status === 429 || res.status === 503) && attempt < maxAttempts - 1) {
        await delayForRetry(attempt, res, raw);
        continue;
      }
      throw new Error(`Image hosting failed (${res.status}): ${raw.slice(0, 400)}`);
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(`Image hosting returned non-JSON: ${raw.slice(0, 300)}`);
    }
    const url = firstOutputUrl(data.output);
    if (!url) throw new Error("Image hosting did not return a URL.");
    return url;
  }

  throw new Error(`Image hosting failed (${lastStatus}): ${lastRaw.slice(0, 400)}`);
}
