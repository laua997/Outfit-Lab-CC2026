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

/**
 * Decode base64 image, downscale if larger than maxSide (long edge), re-encode as JPEG.
 * Helps IDM-VTON / parsing pipelines that can throw on extreme resolutions.
 * @param {string} rawBase64
 * @param {string} mimeType
 * @param {number} maxSide
 * @returns {Promise<{ raw: string, fileFormat: "jpg"|"png" }>}
 */
export async function clampRawBase64ToMaxSide(rawBase64, mimeType, maxSide = 1024) {
  const dataUrl = dataUrlFromStored(mimeType, rawBase64);
  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Could not decode image for resize."));
    el.src = dataUrl;
  });
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) {
    return { raw: rawBase64, fileFormat: proxyFormatFromMime(mimeType) };
  }
  const long = Math.max(w, h);
  if (long <= maxSide) {
    return { raw: rawBase64, fileFormat: proxyFormatFromMime(mimeType) };
  }
  const scale = maxSide / long;
  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return { raw: rawBase64, fileFormat: proxyFormatFromMime(mimeType) };
  }
  ctx.drawImage(img, 0, 0, tw, th);
  const out = canvas.toDataURL("image/jpeg", 0.9);
  const i = out.indexOf(",");
  const raw = i >= 0 ? out.slice(i + 1) : out;
  return { raw, fileFormat: "jpg" };
}

/**
 * Turn local image bytes into a public HTTPS URL via ITP proxy (Flux call that only hosts media).
 * @param {string} rawBase64
 * @param {"jpg"|"png"} fileFormat
 */
export async function hostRawBase64OnItpProxy(rawBase64, fileFormat) {
  const mime = mimeFromProxyFormat(fileFormat);
  const sized = await clampRawBase64ToMaxSide(rawBase64, mime, 1024);

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
