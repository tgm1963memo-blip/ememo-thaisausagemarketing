import admin from "firebase-admin";
import { initFirebaseAdmin } from "../lib/firebase-admin.js";

function mapError(err) {
  const code = err?.code || err?.message || "";
  if (code.includes("user-not-found") || code === "auth/user-not-found") {
    return { status: 404, error: "USER_NOT_FOUND" };
  }
  if (code.includes("invalid-email") || code === "INVALID_EMAIL") {
    return { status: 400, error: "INVALID_EMAIL" };
  }
  if (code.includes("weak-password")) {
    return { status: 400, error: "WEAK_PASSWORD" };
  }
  if (code === "FIREBASE_ADMIN_CONFIG_MISSING") {
    return { status: 500, error: "FIREBASE_ADMIN_CONFIG_MISSING" };
  }
  return { status: 500, error: code || "UPDATE_AUTH_PASSWORD_FAILED" };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { email, password } = req.body || {};
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const newPassword = String(password || "");

  if (!normalizedEmail) return res.status(400).json({ error: "Missing email" });
  if (newPassword.length < 6) return res.status(400).json({ error: "WEAK_PASSWORD" });

  try {
    initFirebaseAdmin();
    const user = await admin.auth().getUserByEmail(normalizedEmail);
    await admin.auth().updateUser(user.uid, { password: newPassword });
    return res.status(200).json({ success: true, uid: user.uid });
  } catch (err) {
    console.error("[update-auth-password]", err);
    const mapped = mapError(err);
    return res.status(mapped.status).json({ error: mapped.error });
  }
}
