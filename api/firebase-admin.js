import admin from "firebase-admin";
import { DATA_PATH } from "./email-templates.js";

export function initFirebaseAdmin() {
  if (admin.apps.length) return admin.app();

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("FIREBASE_ADMIN_CONFIG_MISSING");
  }

  return admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
}

export async function fetchEmailTemplates() {
  initFirebaseAdmin();
  const dbUrl = process.env.FIREBASE_DATABASE_URL;
  if (!dbUrl) return null;

  const snap = await admin.database().ref(`${DATA_PATH}/emailTemplates`).once("value");
  return snap.val() || null;
}
