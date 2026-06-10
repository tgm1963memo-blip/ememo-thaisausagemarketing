// /api/line-webhook.js — Vercel Serverless Function
// รับ LINE webhook events แล้วจับคู่ linking code → บันทึก lineId ใน Firebase

import { initializeApp, getApps } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { credential } from "firebase-admin";

// Initialize Firebase Admin (only once)
function getAdminDb() {
  if (!getApps().length) {
    initializeApp({
      credential: credential.cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey:  (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
      }),
      databaseURL: process.env.VITE_FIREBASE_DATABASE_URL,
    });
  }
  return getDatabase();
}

const DATA_PATH = "ememo/data";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = req.body;
  const events = body?.events || [];

  // ส่ง reply 200 ให้ LINE ก่อนเสมอ (LINE ต้องการ response ภายใน 3 วินาที)
  res.status(200).json({ ok: true });

  const db = getAdminDb();

  for (const event of events) {
    const lineUserId = event?.source?.userId;
    if (!lineUserId) continue;

    // รองรับทั้ง message event และ follow event
    if (event.type === "follow") {
      // ส่ง welcome message แนะนำวิธีเชื่อมต่อ
      await replyLine(event.replyToken, 
        "👋 ยินดีต้อนรับสู่ E-Memo System!\n\nเพื่อรับแจ้งเตือน กรุณาส่งรหัสเชื่อมต่อของคุณ (ดูได้ที่ โปรไฟล์ → รหัส LINE)\n\nตัวอย่าง: TGM-A3F9",
        process.env.LINE_CHANNEL_ACCESS_TOKEN
      );
      continue;
    }

    if (event.type !== "message" || event.message?.type !== "text") continue;

    const text = (event.message.text || "").trim().toUpperCase();

    // ตรวจว่าข้อความตรงกับ pattern ของ linking code (TGM-XXXX)
    if (!text.startsWith("TGM-") || text.length !== 8) continue;

    // ค้นหา user ที่มี lineCode ตรงกัน
    const usersSnap = await db.ref(`${DATA_PATH}/users`).get();
    const usersObj  = usersSnap.val() || {};

    let matchedUserId = null;
    let matchedUserName = "";

    for (const [uid, user] of Object.entries(usersObj)) {
      if ((user.lineCode || "").toUpperCase() === text) {
        matchedUserId   = uid;
        matchedUserName = user.name || user.email || "";
        break;
      }
    }

    if (!matchedUserId) {
      // ไม่พบรหัส
      await replyLine(event.replyToken,
        `❌ ไม่พบรหัส "${text}" ในระบบ\n\nกรุณาตรวจสอบรหัสที่ โปรไฟล์ → รหัส LINE อีกครั้ง`,
        process.env.LINE_CHANNEL_ACCESS_TOKEN
      );
      continue;
    }

    // บันทึก lineId ลง Firebase
    await db.ref(`${DATA_PATH}/users/${matchedUserId}`).update({ lineId: lineUserId });

    // ตอบกลับยืนยัน
    await replyLine(event.replyToken,
      `✅ เชื่อมต่อ LINE สำเร็จแล้ว!\n\nสวัสดีคุณ ${matchedUserName}\nจากนี้คุณจะได้รับแจ้งเตือนจาก E-Memo System ผ่าน LINE นี้`,
      process.env.LINE_CHANNEL_ACCESS_TOKEN
    );
  }
}

async function replyLine(replyToken, text, token) {
  if (!replyToken || !token) return;
  try {
    await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        replyToken,
        messages: [{ type: "text", text }],
      }),
    });
  } catch (e) {
    console.warn("[line-webhook] replyLine error:", e.message);
  }
}
