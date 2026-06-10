import admin from "firebase-admin";
import { initFirebaseAdmin } from "./firebase-admin.js";
import { COMPANY, DATA_PATH } from "./email-templates.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const memoId = String(req.query.memoId || req.query.id || "").trim();
  const token = String(req.query.token || "").trim();
  if (!memoId || !token) return res.status(400).json({ error: "Missing memoId or token" });

  try {
    initFirebaseAdmin();
    const db = admin.database();
    const memoSnap = await db.ref(`${DATA_PATH}/memos/${memoId}`).once("value");
    const memo = memoSnap.val();

    if (!memo) return res.status(404).json({ error: "NOT_FOUND" });
    if (memo.deletedAt) return res.status(403).json({ error: "DELETED" });
    if (memo.status !== "approved") return res.status(403).json({ error: "NOT_APPROVED" });
    if (!memo.shareToken || memo.shareToken !== token) return res.status(403).json({ error: "INVALID_TOKEN" });

    const usersSnap = await db.ref(`${DATA_PATH}/users`).once("value");
    const usersRaw = usersSnap.val() || {};
    const users = Object.entries(usersRaw).map(([id, u]) => ({
      id: u.id || id,
      name: u.name || "",
      nickname: u.nickname || "",
      dept: u.dept || "",
    }));

    const creator = users.find(u => u.id === memo.createdBy) || null;

    return res.status(200).json({
      company: COMPANY,
      creator,
      users,
      memo: {
        id: memoId,
        title: memo.title || "",
        content: memo.content || "",
        category: memo.category || "",
        docNo: memo.docNo || "",
        status: memo.status,
        createdAt: memo.createdAt || null,
        workflowLevels: memo.workflowLevels || [],
        attachments: (memo.attachments || []).map(a => ({
          id: a.id,
          name: a.name,
          size: a.size,
          type: a.type,
          data: a.data,
        })),
        acknowledgements: memo.acknowledgements || {},
        notify: { emailList: memo.notify?.emailList || [] },
      },
    });
  } catch (err) {
    console.error("[public-memo]", err);
    return res.status(500).json({ error: err.message || "PUBLIC_MEMO_FAILED" });
  }
}
