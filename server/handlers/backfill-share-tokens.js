import crypto from "crypto";
import admin from "firebase-admin";
import { initFirebaseAdmin } from "../lib/firebase-admin.js";
import { DATA_PATH } from "../lib/email-templates.js";

function generateShareToken() {
  return crypto.randomBytes(24).toString("hex");
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    initFirebaseAdmin();
    const db = admin.database();
    const snap = await db.ref(`${DATA_PATH}/memos`).once("value");
    const memos = snap.val() || {};

    const updates = {};
    let updated = 0;
    for (const [id, memo] of Object.entries(memos)) {
      if (memo?.status === "approved" && !memo?.shareToken) {
        updates[`${DATA_PATH}/memos/${id}/shareToken`] = generateShareToken();
        updated++;
      }
    }

    if (updated > 0) {
      await db.ref().update(updates);
    }

    return res.status(200).json({
      success: true,
      updated,
      skipped: Object.keys(memos).length - updated,
    });
  } catch (err) {
    console.error("[backfill-share-tokens]", err);
    return res.status(500).json({ error: err.message || "BACKFILL_FAILED" });
  }
}
