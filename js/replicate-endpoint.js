import { REPLICATE_PROXY_URL, OWN_REPLICATE_PROXY_URL } from "./config.js";

const LS_PROXY = "outfit_lab_replicate_proxy_url";
const LS_TOKEN = "outfit_lab_replicate_token";

/**
 * Active proxy base URL (no trailing slash). ITP default unless overridden in config or localStorage.
 */
export function getReplicateProxyUrl() {
  try {
    const u = localStorage.getItem(LS_PROXY)?.trim();
    if (u) return u.replace(/\/$/, "");
  } catch {
    /* private mode */
  }
  const own = String(OWN_REPLICATE_PROXY_URL || "").trim();
  if (own) return own.replace(/\/$/, "");
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
  try {
    return localStorage.getItem(LS_PROXY)?.trim() ?? "";
  } catch {
    return "";
  }
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

/** @param {string} url full URL to worker/proxy (same contract as ITP create_n_get) */
export function saveReplicateProxyUrlToStorage(url) {
  try {
    const u = String(url || "").trim().replace(/\/$/, "");
    if (!u) {
      localStorage.removeItem(LS_PROXY);
      return;
    }
    localStorage.setItem(LS_PROXY, u);
  } catch {
    /* ignore */
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
