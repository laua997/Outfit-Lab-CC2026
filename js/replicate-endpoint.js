import { REPLICATE_PROXY_URL, OWN_REPLICATE_PROXY_URL } from "./config.js";

const LS_PROXY = "outfit_lab_replicate_proxy_url";
const LS_TOKEN = "outfit_lab_replicate_token";

/**
 * Single HTTPS (or http://localhost) URL — rejects pasted README / shell text.
 * @param {string} s
 */
export function isValidReplicateProxyUrl(s) {
  const u = String(s || "").trim();
  if (!u || u.length > 2048) return false;
  if (/\s/.test(u)) return false;
  if (/[<>]/.test(u)) return false;
  if (/wrangler|REPLICATE_API_TOKEN|#\s*paste|cd\s+cloudflare/i.test(u)) return false;
  try {
    const parsed = new URL(u);
    const okHttpLocal = parsed.protocol === "http:" && parsed.hostname === "localhost";
    if (parsed.protocol !== "https:" && !okHttpLocal) return false;
    return !!parsed.hostname;
  } catch {
    return false;
  }
}

function readStoredProxyUrl() {
  try {
    return localStorage.getItem(LS_PROXY)?.trim() ?? "";
  } catch {
    return "";
  }
}

/** Drop junk pasted into the URL field so try-on falls back to ITP. */
function clearInvalidStoredProxyUrl() {
  const u = readStoredProxyUrl();
  if (u && !isValidReplicateProxyUrl(u)) {
    try {
      localStorage.removeItem(LS_PROXY);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Active proxy base URL (no trailing slash). ITP default unless overridden in config or localStorage.
 */
export function getReplicateProxyUrl() {
  clearInvalidStoredProxyUrl();
  try {
    const u = readStoredProxyUrl();
    if (u && isValidReplicateProxyUrl(u)) return u.replace(/\/$/, "");
  } catch {
    /* private mode */
  }
  const own = String(OWN_REPLICATE_PROXY_URL || "").trim();
  if (own && isValidReplicateProxyUrl(own)) return own.replace(/\/$/, "");
  return REPLICATE_PROXY_URL;
}

export function getReplicateTokenFromStorage() {
  try {
    return localStorage.getItem(LS_TOKEN)?.trim() ?? "";
  } catch {
    return "";
  }
}

/** URL saved in this browser only (not `OWN_REPLICATE_PROXY_URL` from config). */
export function getSavedProxyUrlOnly() {
  const u = readStoredProxyUrl();
  return u && isValidReplicateProxyUrl(u) ? u : "";
}

/** @param {string} token raw r8_… or full Bearer string */
export function saveReplicateTokenToStorage(token) {
  try {
    let t = String(token || "").trim();
    if (!t) {
      localStorage.removeItem(LS_TOKEN);
      return;
    }
    if (t.toLowerCase().startsWith("bearer ")) t = t.slice(7).trim();
    localStorage.setItem(LS_TOKEN, t);
  } catch {
    /* ignore */
  }
}

/**
 * @param {string} url full URL to worker/proxy (same contract as ITP create_n_get)
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function saveReplicateProxyUrlToStorage(url) {
  try {
    const u = String(url || "").trim().replace(/\/$/, "");
    if (!u) {
      localStorage.removeItem(LS_PROXY);
      return { ok: true };
    }
    if (!isValidReplicateProxyUrl(u)) {
      return {
        ok: false,
        error:
          "That is not a valid proxy URL. Paste only one line, starting with https:// (your Cloudflare worker URL). Do not paste README shell commands.",
      };
    }
    localStorage.setItem(LS_PROXY, u);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not save URL." };
  }
}

export function usesItpDefaultProxy() {
  return getReplicateProxyUrl() === REPLICATE_PROXY_URL;
}

/** Only send Bearer to non-ITP proxies (avoids confusing the class proxy). */
export function getReplicateProxyAuthHeaders() {
  if (usesItpDefaultProxy()) return {};
  const raw = getReplicateTokenFromStorage();
  if (!raw) return {};
  return { Authorization: raw.toLowerCase().startsWith("bearer ") ? raw : `Bearer ${raw}` };
}
