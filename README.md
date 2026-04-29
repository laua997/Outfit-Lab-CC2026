# Outfit Lab CC2026

Static **GitHub Pages** app: virtual try-on (IDM‑VTON) via the **ITP/IMA Replicate proxy**, with per‑user closet data in **Firebase** (Google Auth + Realtime Database + Storage).

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

- **Authentication**: Google (you already enabled this).
- **Realtime Database**: metadata for `body` + `garments` under `users/{uid}/…`.
- **Storage**: image bytes under `users/{uid}/…`.

### Security rules (demo‑style, per‑user)

Apply rules that only let a signed‑in user read/write **their own** subtree.

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

**Storage** (console → Storage → Rules), example:

```rules
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /users/{userId}/{allPaths=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

Tighten further for production (size limits, content‑type checks, etc.).

If uploads seem to “do nothing”, check the browser **Console** for `storage/unauthorized` or `permission-denied`. That almost always means **Storage** or **Realtime Database** rules are still default‑deny (the on‑page banner now spells this out after the next deploy).

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
