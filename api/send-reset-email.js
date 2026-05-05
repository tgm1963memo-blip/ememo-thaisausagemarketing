// api/send-reset-email.js
// ส่ง reset password ผ่าน SMTP บริษัท (noreply.ememo@tgm.co.th)
// ไม่ต้องใช้ Firebase Admin SDK — ใช้ Firebase REST API สร้าง link แทน
//
// Environment Variables ที่ต้องตั้งใน Vercel:
//   SMTP_HOST        = mail.tgm.co.th
//   SMTP_PORT        = 465
//   SMTP_USER        = noreply.ememo@tgm.co.th
//   SMTP_PASS        = <password>
//   SMTP_FROM        = "E-Memo TGM" <noreply.ememo@tgm.co.th>
//   FIREBASE_API_KEY = AIzaSy...  (Web API Key จาก Firebase Console → Project Settings)
//   APP_URL          = https://ememo-thaisauces.vercel.app

import nodemailer from "nodemailer";

const COMPANY = "บริษัท ไทยซอสเซส มาร์เก็ตติ้ง จำกัด";

// สร้าง Firebase password reset link ผ่าน REST API (ไม่ต้อง Admin SDK)
async function getFirebaseResetLink(email) {
  const apiKey = process.env.FIREBASE_API_KEY;
  if (!apiKey) throw new Error("FIREBASE_API_KEY not set in environment variables");

  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestType: "PASSWORD_RESET",
        email,
        // returnOobLink: true would return the link without sending Firebase email
        // but requires Admin SDK. Instead we intercept by using our own email.
      }),
    }
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || data.error.code);
  // Firebase REST API sends its own email AND returns email field
  // We return success — our SMTP email supplements it
  return { email: data.email };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { email, name = "", isNew = false } = req.body;
  if (!email) return res.status(400).json({ error: "Missing email" });

  // ── Step 1: ให้ Firebase ส่ง reset link (และส่ง Firebase email ออกไปด้วย) ──
  // พร้อมกันนั้นเราส่ง SMTP email ของบริษัทซ้อนออกไปอีกฉบับ
  let firebaseOk = false;
  try {
    await getFirebaseResetLink(email);
    firebaseOk = true;
  } catch (fbErr) {
    // Common errors: USER_NOT_FOUND, INVALID_EMAIL
    const code = fbErr.message;
    if (code === "USER_NOT_FOUND" || code === "EMAIL_NOT_FOUND") {
      return res.status(404).json({ error: "USER_NOT_FOUND" });
    }
    if (code === "INVALID_EMAIL") {
      return res.status(400).json({ error: "INVALID_EMAIL" });
    }
    // Other errors — still try to send SMTP notification
    console.warn("[send-reset-email] Firebase error:", code);
  }

  // ── Step 2: ส่ง SMTP email จากเมล์บริษัทพร้อมกัน ──────────────────────────
  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    const appUrl = process.env.APP_URL || "https://ememo-thaisauces.vercel.app";
    const subjectText = isNew
      ? `[E-Memo] ตั้งรหัสผ่านสำหรับบัญชีของคุณ`
      : `[E-Memo] รีเซ็ตรหัสผ่าน E-Memo`;

    const html = `
<div style="font-family:'Noto Sans Thai',Sarabun,Arial,sans-serif;max-width:560px;margin:0 auto;background:#fff;">
  <div style="background:#1E3A5F;padding:20px 28px;border-radius:8px 8px 0 0;">
    <div style="font-size:16px;font-weight:700;color:#fff;">${COMPANY}</div>
    <div style="font-size:11px;color:rgba(255,255,255,.6);margin-top:2px;">E-Memo System</div>
  </div>
  <div style="border:1px solid #E5E7EB;border-top:3px solid #CC2229;padding:28px;border-radius:0 0 8px 8px;">
    <p style="margin:0 0 16px;font-size:14px;line-height:1.7;">
      ${isNew
        ? `ยินดีต้อนรับ${name ? " คุณ" + name : ""}!<br/>บัญชี E-Memo ของคุณถูกสร้างแล้ว`
        : `เราได้รับคำขอรีเซ็ตรหัสผ่านสำหรับ <strong>${email}</strong>`}
    </p>
    <p style="margin:0 0 20px;font-size:13px;color:#6B7280;">
      ระบบได้ส่งลิงก์${isNew ? "ตั้ง" : "รีเซ็ต"}รหัสผ่านไปยัง <strong>${email}</strong> แล้ว<br/>
      หากไม่พบในกล่องจดหมาย กรุณาตรวจสอบโฟลเดอร์ <strong>Spam / Junk</strong>
    </p>
    <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:16px 20px;margin-bottom:20px;">
      <p style="margin:0 0 8px;font-size:12px;color:#6B7280;font-weight:600;">วิธีตั้งรหัสผ่าน:</p>
      <ol style="margin:0;padding-left:18px;font-size:13px;color:#374151;line-height:1.8;">
        <li>เปิดอีเมล์และกดลิงก์ "Reset Password" ที่ได้รับ</li>
        <li>ตั้งรหัสผ่านใหม่อย่างน้อย 6 ตัวอักษร</li>
        <li>กลับมาเข้าสู่ระบบที่ <a href="${appUrl}" style="color:#1E3A5F;">${appUrl}</a></li>
      </ol>
    </div>
    <p style="font-size:11px;color:#9CA3AF;margin:0 0 4px;">ลิงก์มีอายุ 1 ชั่วโมง หากหมดอายุให้ขอใหม่จากหน้า Login</p>
    <p style="font-size:11px;color:#9CA3AF;margin:0;">หากไม่ได้ดำเนินการ สามารถเพิกเฉยอีเมล์นี้ได้</p>
    <div style="border-top:1px solid #F3F4F6;margin-top:24px;padding-top:14px;font-size:10px;color:#D1D5DB;text-align:center;">
      ${COMPANY} — E-Memo System
    </div>
  </div>
</div>`;

    try {
      const transporter = nodemailer.createTransport({
        host:   process.env.SMTP_HOST || "mail.tgm.co.th",
        port:   parseInt(process.env.SMTP_PORT || "465"),
        secure: parseInt(process.env.SMTP_PORT || "465") === 465,
        auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        tls:    { rejectUnauthorized: false },
      });

      await transporter.sendMail({
        from:    process.env.SMTP_FROM || `"E-Memo TGM" <${process.env.SMTP_USER}>`,
        to:      email,
        subject: subjectText,
        html,
        text: `ระบบได้ส่งลิงก์รีเซ็ตรหัสผ่านไปยัง ${email} แล้ว กรุณาตรวจสอบกล่องจดหมาย (รวมถึง Spam)\nลิงก์มีอายุ 1 ชั่วโมง`,
      });
    } catch (smtpErr) {
      console.error("[send-reset-email] SMTP error:", smtpErr.message);
      // SMTP failed but Firebase email already sent — still return success
    }
  }

  return res.status(200).json({ success: true, firebaseEmailSent: firebaseOk });
}
