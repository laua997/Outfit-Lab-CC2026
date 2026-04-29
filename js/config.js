/** @type {import("firebase/app").FirebaseOptions} */
export const firebaseConfig = {
  apiKey: "AIzaSyAnlZScIsuJoEXFPZshO7c7xhspR7eP8wY",
  authDomain: "outfit-lab-cc2026.firebaseapp.com",
  databaseURL: "https://outfit-lab-cc2026-default-rtdb.firebaseio.com",
  projectId: "outfit-lab-cc2026",
  /** From Firebase console; app does not use Storage — field kept for a valid web config object. */
  storageBucket: "outfit-lab-cc2026.firebasestorage.app",
  messagingSenderId: "185858829919",
  appId: "1:185858829919:web:0c24a952b400b7ebddb5ea",
};

/** ITP/IMA Replicate proxy (unauthenticated ok). */
export const REPLICATE_PROXY_URL = "https://itp-ima-replicate-proxy.web.app/api/create_n_get";

/**
 * Optional: your Cloudflare Worker URL (same POST JSON as the ITP endpoint). Put your billing here without any UI:
 * set this string, deploy Pages — token stays only in `wrangler secret put REPLICATE_API_TOKEN`.
 * Takes precedence over “saved in browser” proxy URL when non-empty.
 */
export const OWN_REPLICATE_PROXY_URL = "";

/** IDM-VTON version id (Replicate HTTP API). */
export const IDM_VTON_VERSION =
  "906425dbca90663ff5427624839572cc56ea7d380343d13e2a4c4b09d3f0c30f";
