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

## Try‑on API (ITP proxy)

The browser calls:

`https://itp-ima-replicate-proxy.web.app/api/create_n_get`

with JSON shaped like Replicate’s HTTP API (`version` + `input` for IDM‑VTON). See the proxy docs: `https://itp-ima-replicate-proxy.web.app/` (loads `docs.md`).

## Local testing

Because Firebase Auth uses your hosting domain, run a local static server (not `file://`):

```bash
npx --yes serve .
```

Then open the printed `http://localhost:3000` (or similar) and ensure `localhost` is an authorized domain in Firebase.

## Repo

Upstream GitHub repo: [laua997/Outfit-Lab-CC2026](https://github.com/laua997/Outfit-Lab-CC2026)
