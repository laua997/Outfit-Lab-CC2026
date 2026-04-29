/**
 * CORS bridge for static Outfit Lab → Replicate HTTP API (no browser CORS on api.replicate.com).
 *
 * Deploy: wrangler deploy (set secret REPLICATE_API_TOKEN), or paste worker URL + token in the app UI.
 *
 * Expected POST bodies (same as ITP class proxy):
 * - { version, input } → POST /v1/predictions, poll until terminal state
 * - { model, fieldToConvertBase64ToURL, fileFormat, input } → POST /v1/files from base64 field, return { status, output }
 */

const REPLICATE = "https://api.replicate.com/v1";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json" },
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function base64ToUint8Array(b64) {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function resolveAuth(request, env) {
  const h = request.headers.get("Authorization")?.trim();
  if (h) return h;
  const t = env.REPLICATE_API_TOKEN?.trim();
  if (t) return t.toLowerCase().startsWith("bearer ") ? t : `Bearer ${t}`;
  return "";
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (request.method !== "POST") {
      return json({ error: "Use POST" }, 405);
    }

    const auth = resolveAuth(request, env);
    if (!auth) {
      return json(
        {
          error: "Missing Authorization header or REPLICATE_API_TOKEN secret",
          details: "Send Authorization: Bearer r8_… or configure the worker secret.",
        },
        401,
      );
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    try {
      if (body.version && body.input) {
        const { pred, httpStatus } = await createPredictionAndPoll(auth, body.version, body.input);
        if (httpStatus != null) {
          return json(pred, httpStatus >= 400 ? httpStatus : 500);
        }
        return json(pred, 200);
      }

      if (body.model && body.fieldToConvertBase64ToURL && body.input) {
        const field = body.fieldToConvertBase64ToURL;
        const b64 = body.input[field];
        if (typeof b64 !== "string" || !b64.length) {
          return json({ error: `Missing base64 in input.${field}` }, 400);
        }
        const fmt = String(body.fileFormat || "jpg").toLowerCase();
        const mime = fmt === "png" ? "image/png" : "image/jpeg";
        const ext = fmt === "png" ? "png" : "jpg";
        const bytes = base64ToUint8Array(b64);
        const form = new FormData();
        form.append("content", new Blob([bytes], { type: mime }), `upload.${ext}`);

        const fr = await fetch(`${REPLICATE}/files`, {
          method: "POST",
          headers: { Authorization: auth },
          body: form,
        });
        const file = await fr.json();
        if (!fr.ok) {
          return json(file, fr.status);
        }
        const url = file.urls?.get ?? file.url;
        if (!url) {
          return json({ error: "File upload did not return a URL", details: JSON.stringify(file).slice(0, 500) }, 502);
        }
        return json({ id: file.id || "file", status: "succeeded", output: url }, 200);
      }

      return json(
        { error: "Unrecognized body", details: "Expected {version,input} or {model,fieldToConvertBase64ToURL,...}" },
        400,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return json({ error: "Worker error", details: msg.slice(0, 500) }, 500);
    }
  },
};

/**
 * @param {string} auth
 * @param {string} version
 * @param {Record<string, unknown>} input
 */
/**
 * @returns {Promise<{ pred: Record<string, unknown>, httpStatus: number | null }>}
 */
async function createPredictionAndPoll(auth, version, input) {
  const res = await fetch(`${REPLICATE}/predictions`, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
      Prefer: "wait",
    },
    body: JSON.stringify({ version, input }),
  });
  let pred = await res.json();
  if (!res.ok) {
    return { pred, httpStatus: res.status };
  }
  const getUrl = pred.urls?.get;
  if (!getUrl) {
    return { pred, httpStatus: null };
  }

  for (let i = 0; i < 90; i += 1) {
    if (pred.status === "succeeded" || pred.status === "failed" || pred.status === "canceled") {
      break;
    }
    await sleep(1000);
    const pr = await fetch(getUrl, { headers: { Authorization: auth } });
    pred = await pr.json();
  }
  return { pred, httpStatus: null };
}
