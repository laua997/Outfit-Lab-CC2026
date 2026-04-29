import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";

/** @type {import("firebase/app").FirebaseApp | null} */
let app = null;

/**
 * @param {import("firebase/app").FirebaseOptions} config
 */
export function initFirebase(config) {
  if (!app) {
    app = initializeApp(config);
  }
  const auth = getAuth(app);
  const db = getDatabase(app);
  return { app, auth, db };
}

export { GoogleAuthProvider };
