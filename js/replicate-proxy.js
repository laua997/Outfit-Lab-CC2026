import { REPLICATE_PROXY_URL, IDM_VTON_VERSION } from "./config.js";

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
  const patterns = [
    /resets in ~(\d+)\s*s/i,
    /retry after (\d+)\s*s/i,
    /try again in (\d+)\s*s/i,
    /wait (\d+)\s*seconds/i,
  ];
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
  const chosen = headerMs ?? hintMs ?? backoffMs;
  await sleep(chosen);
}

function firstOutputUrl(output) {
  if (!output) return null;
  if (Array.isArray(output)) return output[0] ?? null;
  return output;
}

function normalizeTryOnErrorMessage(raw) {
  const msg = String(raw || "").trim();
  const lower = msg.toLowerCase();
  if (lower.includes("list index out of range")) {
    return (
      "Try-on failed while processing this image pair. " +
      "Use a clearer full-body person photo and a cleaner garment-only image, then try again."
    );
  }
  return msg || "Try-on failed";
}

function parseProxyError(status, raw) {
  const trimmed = String(raw || "").trim();
  try {
    const j = JSON.parse(trimmed);
    const parts = [j.error, j.details].filter(Boolean);
    if (parts.length) return `Proxy (${status}): ${parts.join(": ").slice(0, 800)}`;
  } catch {
    /* ignore */
  }
  return `Proxy (${status}): ${trimmed.slice(0, 800)}`;
}

/** Map noisy HTTP 500 bodies to the same copy as JSON `failed` predictions (and keep crop-retry matching). */
function friendlyHttpProxyError(status, raw) {
  const msg = parseProxyError(status, raw);
  const lower = msg.toLowerCase();
  if (lower.includes("list index out of range") || lower.includes("index out of range")) {
    return normalizeTryOnErrorMessage("list index out of range");
  }
  return msg;
}

/**
 * Run IDM-VTON via ITP create_n_get proxy.
 * @param {{ humanUrl: string, garmUrl: string, garmentName: string, category: string, crop: boolean, proxyToken?: string }} p
 */
export async function runIdmVtonStep(p) {
  const body = {
    version: IDM_VTON_VERSION,
    input: {
      human_img: p.humanUrl,
      garm_img: p.garmUrl,
      garment_des: p.garmentName,
      category: p.category,
      crop: p.crop,
    },
  };

  const headers = { "Content-Type": "application/json" };
  const t = p.proxyToken?.trim();
  if (t) headers.Authorization = `Bearer ${t}`;

  const maxAttempts = 8;
  let lastStatus = 0;
  let lastRaw = "";

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const res = await fetch(REPLICATE_PROXY_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const raw = await res.text();
    lastStatus = res.status;
    lastRaw = raw;

    if (!res.ok) {
      if ((res.status === 429 || res.status === 503) && attempt < maxAttempts - 1) {
        await delayForRetry(attempt, res, raw);
        continue;
      }
      throw new Error(friendlyHttpProxyError(res.status, raw));
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(`Proxy returned non-JSON: ${raw.slice(0, 300)}`);
    }

    if (data.status === "failed" || data.status === "canceled") {
      throw new Error(normalizeTryOnErrorMessage(data.error || "Prediction failed"));
    }

    const outUrl = firstOutputUrl(data.output);
    if (data.status === "succeeded") {
      if (!outUrl) {
        throw new Error(
          normalizeTryOnErrorMessage(data.error || "Try-on finished but no output URL was returned."),
        );
      }
      return { predictionId: data.id, outputUrl: outUrl };
    }

    throw new Error(normalizeTryOnErrorMessage(data.error || `Unexpected status: ${data.status || "unknown"}`));
  }

  throw new Error(friendlyHttpProxyError(lastStatus, lastRaw));
}

export function isRecoverableModelError(message) {
  const lower = String(message || "").toLowerCase();
  return (
    lower.includes("processing this image pair") ||
    lower.includes("list index out of range") ||
    lower.includes("index out of range")
  );
}

/**
 * Try crop false then true on recoverable model errors.
 */
export async function runIdmVtonStepWithCropRetry(p) {
  /** Replicate notes: use crop when the person photo is not ~3:4 — most phone shots need this first. */
  const attempts = [true, false];
  let lastErr = null;
  for (let i = 0; i < attempts.length; i += 1) {
    try {
      return await runIdmVtonStep({ ...p, crop: attempts[i] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      lastErr = e instanceof Error ? e : new Error(msg);
      if (i < attempts.length - 1 && isRecoverableModelError(msg)) continue;
      throw lastErr;
    }
  }
  throw lastErr ?? new Error("Try-on failed");
}
