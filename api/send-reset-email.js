// api/send-reset-email.js
// ส่ง reset password link ผ่าน SMTP บริษัท
// ใช้ Firebase Admin SDK สร้าง link แล้วส่งเอง

import nodemailer from "nodemailer";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

// Init Firebase Admin (ครั้งเดียว)
function getAdminAuth() {
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey:  (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
      }),
    });
  }
  return getAuth();
}

const COMPANY = "บริษัท ไทยซอสเซส มาร์เก็ตติ้ง จำกัด";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { email, name = "", isNew = false } = req.body;
  if (!email) return res.status(400).json({ error: "Missing email" });

  try {
    const auth = getAdminAuth();

    // Generate Firebase password reset link
    const resetLink = await auth.generatePasswordResetLink(email, {
      url: process.env.APP_URL || "https://ememo-thaisauces.vercel.app",
    });

    // Build email HTML
    const subjectText = isNew
      ? `[${COMPANY}] ตั้งรหัสผ่านสำหรับบัญชี E-Memo ของคุณ`
      : `[${COMPANY}] รีเซ็ตรหัสผ่าน E-Memo`;

    const greeting = isNew
      ? `ยินดีต้อนรับ${name ? " คุณ" + name : ""}!<br/>บัญชี E-Memo ของคุณถูกสร้างแล้ว กรุณาตั้งรหัสผ่านเพื่อเข้าใช้งาน`
      : `คุณ${name ? name : ""}ได้ขอรีเซ็ตรหัสผ่าน`;

    const html = `
      <div style="font-family:'Noto Sans Thai',Sarabun,sans-serif;max-width:560px;margin:0 auto;">
        <div style="background:#1E3A5F;padding:20px 28px;border-radius:8px 8px 0 0;">
          <div style="font-size:16px;font-weight:700;color:#fff;">${COMPANY}</div>
          <div style="font-size:11px;color:rgba(255,255,255,.6);margin-top:2px;">E-Memo System</div>
        </div>
        <div style="border:1px solid #E5E7EB;border-top:3px solid #CC2229;padding:28px;border-radius:0 0 8px 8px;background:#fff;">
          <p style="margin:0 0 16px;font-size:14px;line-height:1.7;">${greeting}</p>
          <p style="margin:0 0 8px;font-size:13px;color:#6B7280;">กดปุ่มด้านล่างเพื่อ${isNew ? "ตั้งรหัสผ่าน" : "รีเซ็ตรหัสผ่าน"}:</p>
          <div style="text-align:center;margin:24px 0;">
            <a href="${resetLink}"
              style="background:#CC2229;color:#fff;padding:13px 32px;border-radius:7px;text-decoration:none;font-weight:700;font-size:14px;display:inline-block;">
              ${isNew ? "ตั้งรหัสผ่าน →" : "รีเซ็ตรหัสผ่าน →"}
            </a>
          </div>
          <p style="font-size:11px;color:#9CA3AF;margin:0 0 4px;">ลิงก์นี้จะหมดอายุใน 1 ชั่วโมง</p>
          <p style="font-size:11px;color:#9CA3AF;margin:0;">หากไม่ได้ดำเนินการ สามารถเพิกเฉยอีเมล์นี้ได้</p>
          <div style="border-top:1px solid #F3F4F6;margin-top:24px;padding-top:14px;font-size:10px;color:#D1D5DB;text-align:center;">
            ${COMPANY} — E-Memo System
          </div>
        </div>
      </div>`;

    const transporter = nodemailer.createTransport({
      host:   process.env.SMTP_HOST || "mail.tgm.co.th",
      port:   parseInt(process.env.SMTP_PORT || "465"),
      secure: true,   // Port 465 = SSL โดยตรง
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      tls:    { rejectUnauthorized: false },
    });

    await transporter.sendMail({
      from:    process.env.SMTP_FROM || `"E-Memo TGM" <${process.env.SMTP_USER}>`,
      to:      email,
      subject: subjectText,
      html,
      text:    `${greeting}\n\nกดลิงก์นี้เพื่อ${isNew ? "ตั้ง" : "รีเซ็ต"}รหัสผ่าน:\n${resetLink}\n\n(ลิงก์หมดอายุใน 1 ชั่วโมง)`,
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("[send-reset-email] Error:", err);
    // Fallback: try Firebase REST API reset
    return res.status(500).json({ error: err.message });
  }
}
