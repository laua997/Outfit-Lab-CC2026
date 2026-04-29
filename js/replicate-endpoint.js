import { REPLICATE_PROXY_URL, OWN_REPLICATE_PROXY_URL } from "./config.js";

const LS_PROXY = "outfit_lab_replicate_proxy_url";
const LS_TOKEN = "outfit_lab_replicate_token";

/**
 * Reject docs/chat placeholders (e.g. &lt;your-subdomain&gt;) that still parse as URLs.
 * @param {string} hostname
 */
function hostnameLooksLikePlaceholder(hostname) {
  const h = String(hostname || "").toLowerCase();
  if (!h) return true;
  if (h.includes("&lt;") || h.includes("&gt;") || h.includes("&amp;") || h.includes("&")) return true;
  if (h.includes("<") || h.includes(">")) return true;
  if (h.includes("your-subdomain") || h.includes("yoursubdomain")) return true;
  if (/\byour-worker\b\.workers\.dev$/i.test(h)) return true;
  return false;
}

/**
 * Single HTTPS (or http://localhost) URL — rejects pasted README / shell text / placeholders.
 * @param {string} s
 */
export function isValidReplicateProxyUrl(s) {
  const u = String(s || "").trim();
  if (!u || u.length > 2048) return false;
  if (/\s/.test(u)) return false;
  if (/[<>]/.test(u)) return false;
  if (/&#?\w+;/.test(u)) return false;
  if (/wrangler|REPLICATE_API_TOKEN|#\s*paste|cd\s+cloudflare/i.test(u)) return false;
  try {
    const parsed = new URL(u);
    const okHttpLocal = parsed.protocol === "http:" && parsed.hostname === "localhost";
    if (parsed.protocol !== "https:" && !okHttpLocal) return false;
    if (!parsed.hostname || hostnameLooksLikePlaceholder(parsed.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * fetch() to the try-on proxy with a clearer error than "Failed to fetch".
 * @param {string} url
 * @param {RequestInit} [init]
 */
export async function proxyFetch(url, init) {
  try {
    return await fetch(url, init);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (e instanceof TypeError || /failed to fetch/i.test(m)) {
      throw new Error(
        "Could not reach the try-on proxy (network error or invalid URL). " +
          "If you use a Cloudflare worker, paste the exact https URL from Wrangler (no placeholders). " +
          "Click “Clear saved” to fall back to the class ITP proxy.",
      );
    }
    throw e instanceof Error ? e : new Error(m);
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

/** True when `OWN_REPLICATE_PROXY_URL` in config.js is set (deploy-time binding — no form needed). */
export function isOwnProxyConfiguredInSiteConfig() {
  const own = String(OWN_REPLICATE_PROXY_URL || "").trim();
  return !!(own && isValidReplicateProxyUrl(own));
}

/**
 * Active proxy base URL (no trailing slash). Site config wins, then localStorage, then ITP default.
 */
export function getReplicateProxyUrl() {
  clearInvalidStoredProxyUrl();
  const own = String(OWN_REPLICATE_PROXY_URL || "").trim();
  if (own && isValidReplicateProxyUrl(own)) return own.replace(/\/$/, "");
  try {
    const u = readStoredProxyUrl();
    if (u && isValidReplicateProxyUrl(u)) return u.replace(/\/$/, "");
  } catch {
    /* private mode */
  }
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
          "That is not a valid proxy URL. Use the real https://…workers.dev link from Wrangler (replace any placeholder text with your actual subdomain). Do not paste README commands.",
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
