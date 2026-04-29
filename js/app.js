import { firebaseConfig } from "./config.js";
import { initFirebase, GoogleAuthProvider } from "./firebase-init.js";
import {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  ref as dbRef,
  push,
  set,
  onValue,
  remove,
  get,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";
import { runIdmVtonStepWithCropRetry } from "./replicate-proxy.js";
import {
  getReplicateProxyUrl,
  usesItpDefaultProxy,
  getReplicateTokenFromStorage,
  getSavedProxyUrlOnly,
  saveReplicateTokenToStorage,
  saveReplicateProxyUrlToStorage,
} from "./replicate-endpoint.js";
import {
  fileToRawBase64,
  dataUrlFromStored,
  hostRawBase64OnItpProxy,
  proxyFormatFromMime,
} from "./host-image.js";

const { auth, db } = initFirebase(firebaseConfig);

/** @type {string | null} */
let uid = null;

/**
 * @type {{ id: string, name: string, category: string, imageBase64: string, mimeType: string, url: string }[]}
 */
let garments = [];

let selectedTopId = null;
let selectedBottomId = null;
let selectedDressId = null;

/** @type {{ imageBase64: string, mimeType: string, updatedAt?: number } | null} */
let bodySnapshot = null;

/** Cached public URL for body (ITP-hosted), invalidated when body changes. */
let cachedBodyHostedUrl = null;
/** @type {number | null} */
let cachedBodyHostVersion = null;

/** @type {null | (() => void)} */
let unsubGarments = null;

const els = {
  authStatus: document.getElementById("authStatus"),
  btnGoogle: document.getElementById("btnGoogle"),
  btnSignOut: document.getElementById("btnSignOut"),
  gate: document.getElementById("gate"),
  app: document.getElementById("app"),
  bodyFile: document.getElementById("bodyFile"),
  bodyPreview: document.getElementById("bodyPreview"),
  bodyPlaceholder: document.getElementById("bodyPlaceholder"),
  garmentForm: document.getElementById("garmentForm"),
  dressMode: document.getElementById("dressMode"),
  dressBlock: document.getElementById("dressBlock"),
  splitBlock: document.getElementById("splitBlock"),
  dressGrid: document.getElementById("dressGrid"),
  topGrid: document.getElementById("topGrid"),
  bottomGrid: document.getElementById("bottomGrid"),
  btnTryOn: document.getElementById("btnTryOn"),
  statusLine: document.getElementById("statusLine"),
  errorLine: document.getElementById("errorLine"),
  resultPanel: document.getElementById("resultPanel"),
  resultImg: document.getElementById("resultImg"),
  globalMsg: document.getElementById("globalMsg"),
  replicateProxyUrl: document.getElementById("replicateProxyUrl"),
  replicateTokenInput: document.getElementById("replicateTokenInput"),
  btnReplicateSave: document.getElementById("btnReplicateSave"),
  btnReplicateClear: document.getElementById("btnReplicateClear"),
  replicateSettingsMsg: document.getElementById("replicateSettingsMsg"),
};

function formatFirebaseError(err) {
  if (!err) return "Unknown error";
  const code = /** @type {{ code?: string; message?: string }} */ (err).code || "";
  const msg = /** @type {{ message?: string }} */ (err).message || String(err);
  if (code === "permission-denied") {
    return (
      "Firebase Realtime Database denied the write (permission denied). " +
      "Update RTDB rules so a signed-in user can read/write `users/{uid}/...` (see README)."
    );
  }
  if (code === "unavailable" || msg.toLowerCase().includes("network")) {
    return "Network error talking to Firebase. Check your connection and try again.";
  }
  return msg;
}

function setGlobalMessage(msg, kind) {
  if (!els.globalMsg) return;
  if (!msg) {
    els.globalMsg.textContent = "";
    els.globalMsg.classList.add("hidden");
    els.globalMsg.classList.remove("is-error", "is-info");
    return;
  }
  els.globalMsg.textContent = msg;
  els.globalMsg.classList.remove("hidden", "is-error", "is-info");
  els.globalMsg.classList.add(kind === "error" ? "is-error" : "is-info");
  els.globalMsg.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function showError(msg) {
  if (!msg) {
    els.errorLine.classList.add("hidden");
    els.errorLine.textContent = "";
    setGlobalMessage("", "info");
    return;
  }
  els.errorLine.textContent = msg;
  els.errorLine.classList.remove("hidden");
  setGlobalMessage(msg, "error");
}

function setBusy(b) {
  els.btnTryOn.disabled = b;
  els.btnGoogle.disabled = b;
  els.btnSignOut.disabled = b;
  if (els.btnReplicateSave) els.btnReplicateSave.disabled = b;
  if (els.btnReplicateClear) els.btnReplicateClear.disabled = b;
}

function hydrateReplicateSettingsForm() {
  if (!els.replicateProxyUrl || !els.replicateSettingsMsg) return;
  els.replicateProxyUrl.value = getSavedProxyUrlOnly();
  if (els.replicateTokenInput) els.replicateTokenInput.value = "";
  const active = getReplicateProxyUrl();
  const hasToken = !!getReplicateTokenFromStorage();
  if (usesItpDefaultProxy()) {
    els.replicateSettingsMsg.textContent =
      "Try-on uses the ITP class proxy at api.create_n_get (no Replicate token in this browser).";
  } else {
    els.replicateSettingsMsg.textContent = `Requests go to: ${active}${hasToken ? " · Bearer token saved in this browser" : " · add token below if the worker does not use a secret"}`;
  }
}

function userRoot() {
  if (!uid) throw new Error("Not signed in");
  return `users/${uid}`;
}

async function waitForAuthReady() {
  if (typeof auth.authStateReady === "function") {
    await auth.authStateReady();
  }
}

function invalidateBodyHostCache() {
  cachedBodyHostedUrl = null;
  cachedBodyHostVersion = null;
}

async function refreshBodyPreview() {
  if (!uid) return;
  const snap = await get(dbRef(db, `${userRoot()}/body`));
  if (!snap.exists()) {
    bodySnapshot = null;
    invalidateBodyHostCache();
    els.bodyPreview.classList.add("hidden");
    els.bodyPlaceholder.classList.remove("hidden");
    return;
  }
  const v = snap.val();
  if (v.storagePath && !v.imageBase64) {
    bodySnapshot = null;
    showError(
      "This account still has an old body photo stored in Firebase Storage. " +
        "This app version saves images in Realtime Database only — please upload a new body photo.",
    );
    els.bodyPreview.classList.add("hidden");
    els.bodyPlaceholder.classList.remove("hidden");
    return;
  }
  if (!v.imageBase64) {
    bodySnapshot = null;
    els.bodyPreview.classList.add("hidden");
    els.bodyPlaceholder.classList.remove("hidden");
    return;
  }
  bodySnapshot = {
    imageBase64: v.imageBase64,
    mimeType: v.mimeType || "image/jpeg",
    updatedAt: v.updatedAt,
  };
  try {
    const dataUrl = dataUrlFromStored(bodySnapshot.mimeType, bodySnapshot.imageBase64);
    els.bodyPreview.onerror = () => {
      showError("Could not display the body photo from saved data.");
      els.bodyPreview.classList.add("hidden");
      els.bodyPlaceholder.classList.remove("hidden");
    };
    els.bodyPreview.src = dataUrl;
    if ("decode" in els.bodyPreview) {
      await els.bodyPreview.decode();
    }
    els.bodyPreview.classList.remove("hidden");
    els.bodyPlaceholder.classList.add("hidden");
  } catch (err) {
    showError(err instanceof Error ? err.message : "Could not show body preview");
    els.bodyPreview.classList.add("hidden");
    els.bodyPlaceholder.classList.remove("hidden");
  }
}

async function onBodyFileChange(e) {
  const file = e.target.files?.[0];
  if (!file || !uid) return;
  showError(null);
  try {
    setBusy(true);
    await waitForAuthReady();
    if (!auth.currentUser) {
      showError("Not signed in. Please sign in again.");
      return;
    }
    setGlobalMessage("Saving body photo to your database…", "info");
    const { raw, mime } = await fileToRawBase64(file);
    const approxKb = Math.round((raw.length * 3) / 4 / 1024);
    if (approxKb > 4096) {
      showError("That image is very large for Realtime Database. Try a smaller JPEG (under ~2–3 MB).");
      return;
    }
    await set(dbRef(db, `${userRoot()}/body`), {
      imageBase64: raw,
      mimeType: mime,
      updatedAt: Date.now(),
    });
    invalidateBodyHostCache();
    await refreshBodyPreview();
    setGlobalMessage("Body photo saved.", "info");
    setTimeout(() => setGlobalMessage("", "info"), 2500);
  } catch (err) {
    showError(formatFirebaseError(err));
  } finally {
    setBusy(false);
    e.target.value = "";
  }
}

async function onGarmentSubmit(e) {
  e.preventDefault();
  if (!uid) return;
  showError(null);
  const form = els.garmentForm;
  const fd = new FormData(form);
  const name = String(fd.get("name") || "").trim() || "Untitled";
  const category = String(fd.get("category") || "upper_body");
  const file = fd.get("file");
  if (!(file instanceof File)) {
    showError("Choose an image file");
    return;
  }
  try {
    setBusy(true);
    await waitForAuthReady();
    if (!auth.currentUser) {
      showError("Not signed in. Please sign in again.");
      return;
    }
    setGlobalMessage("Saving garment to your database…", "info");
    const { raw, mime } = await fileToRawBase64(file);
    const approxKb = Math.round((raw.length * 3) / 4 / 1024);
    if (approxKb > 4096) {
      showError("That image is very large for Realtime Database. Try a smaller JPEG (under ~2–3 MB).");
      return;
    }
    const listRef = dbRef(db, `${userRoot()}/garments`);
    const newRef = push(listRef);
    const id = newRef.key;
    if (!id) throw new Error("Could not allocate garment id");
    await set(newRef, {
      name,
      category,
      imageBase64: raw,
      mimeType: mime,
      createdAt: Date.now(),
    });
    form.reset();
    setGlobalMessage("Garment saved to closet.", "info");
    setTimeout(() => setGlobalMessage("", "info"), 2500);
  } catch (err) {
    showError(formatFirebaseError(err));
  } finally {
    setBusy(false);
  }
}

async function deleteGarment(id) {
  if (!uid) return;
  showError(null);
  const g = garments.find((x) => x.id === id);
  if (!g) return;
  try {
    setBusy(true);
    await remove(dbRef(db, `${userRoot()}/garments/${id}`));
    if (selectedTopId === id) selectedTopId = null;
    if (selectedBottomId === id) selectedBottomId = null;
    if (selectedDressId === id) selectedDressId = null;
  } catch (err) {
    showError(formatFirebaseError(err));
  } finally {
    setBusy(false);
  }
}

function garmentById(id) {
  return garments.find((g) => g.id === id);
}

function renderGarmentRow(container, list, selectedId, onSelect, categoryLabel) {
  container.innerHTML = "";
  if (list.length === 0) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = `No ${categoryLabel} yet — add photos in step 2.`;
    container.appendChild(p);
    return;
  }
  for (const g of list) {
    const wrap = document.createElement("div");
    wrap.className = "garment-card";

    const pick = document.createElement("button");
    pick.type = "button";
    pick.className = "pick";
    if (selectedId === g.id) pick.classList.add("selected");
    const img = document.createElement("img");
    img.src = g.url;
    img.alt = "";
    pick.appendChild(img);
    pick.addEventListener("click", () => {
      const active = selectedId === g.id;
      onSelect(active ? null : g.id);
    });

    const del = document.createElement("button");
    del.type = "button";
    del.className = "del";
    del.setAttribute("aria-label", `Delete ${g.name}`);
    del.textContent = "×";
    del.addEventListener("click", (ev) => {
      ev.stopPropagation();
      void deleteGarment(g.id);
    });

    const cap = document.createElement("div");
    cap.className = "caption";
    cap.textContent = g.name;

    wrap.appendChild(pick);
    wrap.appendChild(del);
    wrap.appendChild(cap);
    container.appendChild(wrap);
  }
}

function renderAllGrids() {
  const tops = garments.filter((g) => g.category === "upper_body");
  const bottoms = garments.filter((g) => g.category === "lower_body");
  const dresses = garments.filter((g) => g.category === "dresses");

  renderGarmentRow(els.topGrid, tops, selectedTopId, (id) => {
    selectedTopId = id;
    renderAllGrids();
  }, "tops");

  renderGarmentRow(els.bottomGrid, bottoms, selectedBottomId, (id) => {
    selectedBottomId = id;
    renderAllGrids();
  }, "bottoms");

  renderGarmentRow(els.dressGrid, dresses, selectedDressId, (id) => {
    selectedDressId = id;
    renderAllGrids();
  }, "dresses");
}

function syncDressModeUi() {
  const dress = els.dressMode.checked;
  els.dressBlock.classList.toggle("hidden", !dress);
  els.splitBlock.classList.toggle("hidden", dress);
  if (dress) {
    selectedTopId = null;
    selectedBottomId = null;
  } else {
    selectedDressId = null;
  }
  renderAllGrids();
}

async function hostedBodyUrlForTryOn() {
  if (!bodySnapshot?.imageBase64) throw new Error("Upload a body photo first.");
  const ver = bodySnapshot.updatedAt ?? 0;
  if (cachedBodyHostedUrl != null && cachedBodyHostVersion === ver) {
    return cachedBodyHostedUrl;
  }
  setGlobalMessage("Preparing body image for try-on (one-time proxy step)…", "info");
  const fmt = proxyFormatFromMime(bodySnapshot.mimeType);
  const url = await hostRawBase64OnItpProxy(bodySnapshot.imageBase64, fmt);
  cachedBodyHostedUrl = url;
  cachedBodyHostVersion = ver;
  setGlobalMessage("", "info");
  return url;
}

async function hostedGarmentUrl(g) {
  const fmt = proxyFormatFromMime(g.mimeType);
  return hostRawBase64OnItpProxy(g.imageBase64, fmt);
}

async function runTryOn() {
  if (!uid) return;
  showError(null);
  els.resultPanel.classList.add("hidden");
  els.statusLine.textContent = "";

  const dressMode = els.dressMode.checked;

  try {
    setBusy(true);

    const human0 = await hostedBodyUrlForTryOn();

    if (dressMode) {
      const d = selectedDressId ? garmentById(selectedDressId) : null;
      if (!d) throw new Error("Pick a dress (or turn off dress mode).");
      els.statusLine.textContent = "Preparing garment + trying on dress…";
      const gUrl = await hostedGarmentUrl(d);
      els.statusLine.textContent = "Trying on dress…";
      const step = await runIdmVtonStepWithCropRetry({
        humanUrl: human0,
        garmUrl: gUrl,
        garmentName: d.name,
        category: "dresses",
      });
      els.resultImg.src = step.outputUrl;
      els.resultPanel.classList.remove("hidden");
      els.statusLine.textContent = "";
      return;
    }

    const top = selectedTopId ? garmentById(selectedTopId) : null;
    const bottom = selectedBottomId ? garmentById(selectedBottomId) : null;

    if (!top && !bottom) {
      throw new Error("Select a top, a bottom, or switch to dress mode.");
    }

    let humanUrl = human0;
    let lastOut = null;

    if (top) {
      els.statusLine.textContent = "Preparing top + trying on…";
      const gUrl = await hostedGarmentUrl(top);
      els.statusLine.textContent = "Trying on top…";
      lastOut = await runIdmVtonStepWithCropRetry({
        humanUrl,
        garmUrl: gUrl,
        garmentName: top.name,
        category: "upper_body",
      });
      humanUrl = lastOut.outputUrl;
    }

    if (bottom) {
      els.statusLine.textContent = "Preparing bottom + trying on…";
      const gUrl = await hostedGarmentUrl(bottom);
      els.statusLine.textContent = "Trying on bottom…";
      lastOut = await runIdmVtonStepWithCropRetry({
        humanUrl,
        garmUrl: gUrl,
        garmentName: bottom.name,
        category: "lower_body",
      });
    }

    if (!lastOut) throw new Error("Nothing to try on.");
    els.resultImg.src = lastOut.outputUrl;
    els.resultPanel.classList.remove("hidden");
    els.statusLine.textContent = "";
  } catch (err) {
    showError(err instanceof Error ? err.message : "Try-on failed");
  } finally {
    setBusy(false);
  }
}

function wireGarmentsListener() {
  if (!uid) return;
  if (unsubGarments) {
    unsubGarments();
    unsubGarments = null;
  }
  const refG = dbRef(db, `${userRoot()}/garments`);
  unsubGarments = onValue(refG, (snap) => {
    const items = [];
    snap.forEach((child) => {
      const v = child.val();
      if (v.imageBase64) {
        items.push({
          id: child.key,
          name: v.name,
          category: v.category,
          imageBase64: v.imageBase64,
          mimeType: v.mimeType || "image/jpeg",
          createdAt: v.createdAt || 0,
          url: dataUrlFromStored(v.mimeType || "image/jpeg", v.imageBase64),
        });
      }
    });
    items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    garments = items;
    renderAllGrids();
  });
}

async function onAuth(user) {
  uid = user?.uid ?? null;
  if (!user) {
    if (unsubGarments) {
      unsubGarments();
      unsubGarments = null;
    }
    els.authStatus.textContent = "Sign in to save your closet and run try-on.";
    els.btnGoogle.classList.remove("hidden");
    els.btnSignOut.classList.add("hidden");
    els.gate.classList.remove("hidden");
    els.app.classList.add("hidden");
    garments = [];
    selectedTopId = selectedBottomId = selectedDressId = null;
    bodySnapshot = null;
    invalidateBodyHostCache();
    showError(null);
    return;
  }

  els.authStatus.textContent = `Signed in as ${user.email || user.displayName || uid}`;
  els.btnGoogle.classList.add("hidden");
  els.btnSignOut.classList.remove("hidden");
  els.gate.classList.add("hidden");
  els.app.classList.remove("hidden");

  await waitForAuthReady();
  await refreshBodyPreview();
  wireGarmentsListener();
}

els.btnGoogle.addEventListener("click", async () => {
  showError(null);
  try {
    setBusy(true);
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  } catch (e) {
    showError(e instanceof Error ? e.message : "Sign-in failed");
  } finally {
    setBusy(false);
  }
});

els.btnSignOut.addEventListener("click", async () => {
  showError(null);
  await signOut(auth);
});

els.bodyFile.addEventListener("change", (e) => void onBodyFileChange(e));
els.garmentForm.addEventListener("submit", (e) => void onGarmentSubmit(e));
els.dressMode.addEventListener("change", () => {
  syncDressModeUi();
});
els.btnTryOn.addEventListener("click", () => void runTryOn());

onAuthStateChanged(auth, (user) => {
  void onAuth(user);
});

syncDressModeUi();
hydrateReplicateSettingsForm();

if (els.btnReplicateSave && els.btnReplicateClear) {
  els.btnReplicateSave.addEventListener("click", () => {
    showError(null);
    saveReplicateProxyUrlToStorage(els.replicateProxyUrl?.value || "");
    saveReplicateTokenToStorage(els.replicateTokenInput?.value || "");
    invalidateBodyHostCache();
    hydrateReplicateSettingsForm();
  });
  els.btnReplicateClear.addEventListener("click", () => {
    showError(null);
    saveReplicateProxyUrlToStorage("");
    saveReplicateTokenToStorage("");
    if (els.replicateProxyUrl) els.replicateProxyUrl.value = "";
    if (els.replicateTokenInput) els.replicateTokenInput.value = "";
    invalidateBodyHostCache();
    hydrateReplicateSettingsForm();
  });
}
