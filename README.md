# Outfit Lab CC2026



Static **GitHub Pages** app: virtual try-on (IDM‑VTON) via the **ITP/IMA Replicate proxy**, with per‑user closet data in **Firebase** (Google Auth + **Realtime Database only** — no Firebase Storage).



Images are stored as **base64 strings** under `users/{uid}/body` and `users/{uid}/garments/{id}`. Before try‑on, the app asks the ITP proxy to host each image (Flux Schnell “URL from base64” path) so IDM‑VTON receives normal `https://` URLs.



Live site URL (after you enable Pages): `https://laua997.github.io/Outfit-Lab-CC2026/`



## GitHub Pages (recommended: `main` / root)



1. Push this repo to GitHub (`main` branch, files at repo root including `index.html`).

2. Repo → **Settings** → **Pages**

3. **Build and deployment** → Source: **Deploy from a branch**

4. Branch: **`main`**, folder: **`/ (root)`**

5. Save. After a minute, open `https://laua997.github.io/Outfit-Lab-CC2026/`



`.nojekyll` is included so GitHub does not ignore paths it associates with Jekyll.



## Firebase setup



### Products in use



- **Authentication**: Google.

- **Realtime Database**: body + garments (including **imageBase64** + **mimeType** + metadata) under `users/{uid}/…`.



You do **not** need to enable **Storage** or **Blaze** for this app’s image flow.



### Security rules (demo‑style, per‑user)



**Realtime Database** (console → Realtime Database → Rules), example:



```json

{

  "rules": {

    "users": {

      "$uid": {

        ".read": "$uid === auth.uid",

        ".write": "$uid === auth.uid"

      }

    }

  }

}

```



Tighten further for production (payload size, validation, etc.). Large base64 payloads count toward **Realtime Database** download/upload and can hit **single‑write size limits** (~16 MB on RTDB); prefer reasonably sized JPEG/PNG uploads.



If saves seem to “do nothing”, check the browser **Console** for `permission-denied`. That usually means **Realtime Database** rules are still default‑deny.



### Authorized domains



Firebase console → Authentication → Settings → **Authorized domains** must include:



- `localhost` (for local testing)

- `laua997.github.io` (GitHub Pages)



## Try‑on API (Replicate)



By default the browser POSTs to the **ITP class proxy**:

`https://itp-ima-replicate-proxy.web.app/api/create_n_get`

with JSON shaped like Replicate’s HTTP API (`version` + `input` for IDM‑VTON, or the Flux “host base64” payload). See `https://itp-ima-replicate-proxy.web.app/` (loads `docs.md`).

**Your own Replicate billing:** `api.replicate.com` does not send CORS headers, so a static GitHub Pages app cannot call it with your API token. Use the included **Cloudflare Worker** as a tiny CORS-safe bridge:

1. Install [Wrangler](https://developers.cloudflare.com/workers/wrangler/install-and-update/), then from `cloudflare-worker/` run `wrangler login` and `wrangler secret put REPLICATE_API_TOKEN` (paste `r8_…`).
2. `wrangler deploy` — note the worker URL (e.g. `https://outfit-lab-replicate-proxy.<you>.workers.dev`).
3. On the live site, open **Your Replicate (optional)**, paste that URL, **Save in this browser**. Leave the token field empty if the worker secret is set; otherwise paste `r8_…` so the worker receives `Authorization: Bearer …` from the browser (less ideal, but works for personal use).

Alternatively set `OWN_REPLICATE_PROXY_URL` in `js/config.js` before building so the default proxy is yours without localStorage.

If the worker times out on very slow runs, upgrade the Workers plan or rely on Replicate’s `Prefer: wait` behavior (the worker sends that header).



## Local testing



Because Firebase Auth uses your hosting domain, run a local static server (not `file://`):



```bash

npx --yes serve .

```



Then open the printed `http://localhost:3000` (or similar) and ensure `localhost` is an authorized domain in Firebase.



## Repo



Upstream GitHub repo: [laua997/Outfit-Lab-CC2026](https://github.com/laua997/Outfit-Lab-CC2026)


