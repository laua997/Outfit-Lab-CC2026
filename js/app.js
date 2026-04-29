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
import {
  ref as stRef,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";
import { runIdmVtonStepWithCropRetry } from "./replicate-proxy.js";

const { auth, db, storage } = initFirebase(firebaseConfig);

/** @type {string | null} */
let uid = null;

/** @type {{ id: string, name: string, category: string, storagePath: string, url: string }[]} */
let garments = [];

let selectedTopId = null;
let selectedBottomId = null;
let selectedDressId = null;

/** @type {string | null} */
let bodyStoragePath = null;

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
};

function showError(msg) {
  if (!msg) {
    els.errorLine.classList.add("hidden");
    els.errorLine.textContent = "";
    return;
  }
  els.errorLine.textContent = msg;
  els.errorLine.classList.remove("hidden");
}

function setBusy(b) {
  els.btnTryOn.disabled = b;
  els.btnGoogle.disabled = b;
  els.btnSignOut.disabled = b;
}

function userRoot() {
  if (!uid) throw new Error("Not signed in");
  return `users/${uid}`;
}

async function refreshBodyPreview() {
  if (!uid) return;
  const snap = await get(dbRef(db, `${userRoot()}/body`));
  if (!snap.exists()) {
    bodyStoragePath = null;
    els.bodyPreview.classList.add("hidden");
    els.bodyPlaceholder.classList.remove("hidden");
    return;
  }
  const v = snap.val();
  bodyStoragePath = v.storagePath;
  const url = await getDownloadURL(stRef(storage, bodyStoragePath));
  els.bodyPreview.src = url;
  els.bodyPreview.classList.remove("hidden");
  els.bodyPlaceholder.classList.add("hidden");
}

async function onBodyFileChange(e) {
  const file = e.target.files?.[0];
  if (!file || !uid) return;
  showError(null);
  try {
    setBusy(true);
    const path = `${userRoot()}/body/current`;
    await uploadBytes(stRef(storage, path), file, { contentType: file.type || "image/jpeg" });
    await set(dbRef(db, `${userRoot()}/body`), {
      storagePath: path,
      updatedAt: Date.now(),
    });
    bodyStoragePath = path;
    await refreshBodyPreview();
  } catch (err) {
    showError(err instanceof Error ? err.message : "Could not upload body photo");
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
    const listRef = dbRef(db, `${userRoot()}/garments`);
    const newRef = push(listRef);
    const id = newRef.key;
    if (!id) throw new Error("Could not allocate garment id");
    const path = `${userRoot()}/garments/${id}/img`;
    await uploadBytes(stRef(storage, path), file, { contentType: file.type || "image/jpeg" });
    await set(newRef, {
      name,
      category,
      storagePath: path,
      createdAt: Date.now(),
    });
    form.reset();
  } catch (err) {
    showError(err instanceof Error ? err.message : "Could not save garment");
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
    await deleteObject(stRef(storage, g.storagePath));
    await remove(dbRef(db, `${userRoot()}/garments/${id}`));
    if (selectedTopId === id) selectedTopId = null;
    if (selectedBottomId === id) selectedBottomId = null;
    if (selectedDressId === id) selectedDressId = null;
  } catch (err) {
    showError(err instanceof Error ? err.message : "Delete failed");
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

async function bodyDownloadUrl() {
  if (!bodyStoragePath) throw new Error("Upload a body photo first.");
  return getDownloadURL(stRef(storage, bodyStoragePath));
}

async function garmentDownloadUrl(g) {
  return getDownloadURL(stRef(storage, g.storagePath));
}

async function runTryOn() {
  if (!uid) return;
  showError(null);
  els.resultPanel.classList.add("hidden");
  els.statusLine.textContent = "";

  const dressMode = els.dressMode.checked;

  try {
    setBusy(true);

    const human0 = await bodyDownloadUrl();

    if (dressMode) {
      const d = selectedDressId ? garmentById(selectedDressId) : null;
      if (!d) throw new Error("Pick a dress (or turn off dress mode).");
      els.statusLine.textContent = "Trying on dress…";
      const gUrl = await garmentDownloadUrl(d);
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
      els.statusLine.textContent = "Trying on top…";
      const gUrl = await garmentDownloadUrl(top);
      lastOut = await runIdmVtonStepWithCropRetry({
        humanUrl,
        garmUrl: gUrl,
        garmentName: top.name,
        category: "upper_body",
      });
      humanUrl = lastOut.outputUrl;
    }

    if (bottom) {
      els.statusLine.textContent = "Trying on bottom…";
      const gUrl = await garmentDownloadUrl(bottom);
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
  unsubGarments = onValue(refG, async (snap) => {
    const items = [];
    snap.forEach((child) => {
      items.push({ id: child.key, ...child.val() });
    });
    items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    try {
      garments = await Promise.all(
        items.map(async (g) => ({
          id: g.id,
          name: g.name,
          category: g.category,
          storagePath: g.storagePath,
          url: await getDownloadURL(stRef(storage, g.storagePath)),
        })),
      );
    } catch (e) {
      showError(e instanceof Error ? e.message : "Could not load closet images");
      garments = [];
    }
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
    bodyStoragePath = null;
    showError(null);
    return;
  }

  els.authStatus.textContent = `Signed in as ${user.email || user.displayName || uid}`;
  els.btnGoogle.classList.add("hidden");
  els.btnSignOut.classList.remove("hidden");
  els.gate.classList.add("hidden");
  els.app.classList.remove("hidden");

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
