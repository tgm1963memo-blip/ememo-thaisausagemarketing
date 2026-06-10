import admin from "firebase-admin";
import { initFirebaseAdmin } from "./firebase-admin.js";
import { DATA_PATH } from "./email-templates.js";
import { normalizeEmail, emailToKey, buildApprovedEmailRecipients } from "./memo-api-helpers.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = req.body || {};
  const memoId = String(body.memoId || "").trim();
  const token = String(body.token || "").trim();
  const email = normalizeEmail(body.email);
  const name = String(body.name || "").trim();

  if (!memoId || !token || !email) {
    return res.status(400).json({ error: "Missing memoId, token, or email" });
  }

  try {
    initFirebaseAdmin();
    const db = admin.database();
    const memoRef = db.ref(`${DATA_PATH}/memos/${memoId}`);
    const memoSnap = await memoRef.once("value");
    const memo = memoSnap.val();

    if (!memo) return res.status(404).json({ error: "NOT_FOUND" });
    if (memo.deletedAt) return res.status(403).json({ error: "DELETED" });
    if (memo.status !== "approved") return res.status(403).json({ error: "NOT_APPROVED" });
    if (!memo.shareToken || memo.shareToken !== token) return res.status(403).json({ error: "INVALID_TOKEN" });

    const usersSnap = await db.ref(`${DATA_PATH}/users`).once("value");
    const usersRaw = usersSnap.val() || {};
    const users = Object.entries(usersRaw).map(([id, u]) => ({ ...u, id: u.id || id }));

    const recipients = buildApprovedEmailRecipients(memo, users);
    if (!recipients.has(email)) return res.status(403).json({ error: "NOT_RECIPIENT" });

    const existingSnap = await memoRef.child("acknowledgements").child(emailToKey(email)).once("value");
    if (existingSnap.val()) {
      return res.status(200).json({ success: true, alreadyAcked: true, acknowledgement: existingSnap.val() });
    }

    const recipient = recipients.get(email);
    const comment = String(body.comment || "").trim().slice(0, 500);
    const acknowledgement = {
      email,
      name: name || recipient?.name || email,
      at: new Date().toISOString(),
      via: body.via || "link",
      ...(comment ? { comment } : {}),
    };

    await memoRef.child("acknowledgements").child(emailToKey(email)).set(acknowledgement);

    return res.status(200).json({ success: true, acknowledgement });
  } catch (err) {
    console.error("[acknowledge-memo]", err);
    return res.status(500).json({ error: err.message || "ACK_FAILED" });
  }
}
