import admin from "firebase-admin";
import nodemailer from "nodemailer";

const DEFAULT_APP_URL = "https://e-memo-thaisausagemarketing.vercel.app";
const COMPANY = "บริษัท ไทยซอสเซส มาร์เก็ตติ้ง จำกัด";

function getAppUrl() {
  return (process.env.APP_URL || DEFAULT_APP_URL).replace(/\/+$/, "");
}

function initFirebaseAdmin() {
  if (admin.apps.length) return admin.app();

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("FIREBASE_ADMIN_CONFIG_MISSING");
  }

  return admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
  });
}

async function createResetLink(email) {
  initFirebaseAdmin();
  return admin.auth().generatePasswordResetLink(email, {
    url: getAppUrl(),
    handleCodeInApp: false,
  });
}

function createTransporter() {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    throw new Error("SMTP_CONFIG_MISSING");
  }

  const port = Number(process.env.SMTP_PORT || 465);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || "mail.tgm.co.th",
    port,
    secure: port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    tls: { rejectUnauthorized: false },
  });
}

function mapError(err) {
  const code = err?.code || err?.message || "";
  if (code.includes("user-not-found") || code === "USER_NOT_FOUND") return { status: 404, error: "USER_NOT_FOUND" };
  if (code.includes("invalid-email") || code === "INVALID_EMAIL") return { status: 400, error: "INVALID_EMAIL" };
  if (code === "SMTP_CONFIG_MISSING") return { status: 500, error: "SMTP_CONFIG_MISSING" };
  if (code === "FIREBASE_ADMIN_CONFIG_MISSING") return { status: 500, error: "FIREBASE_ADMIN_CONFIG_MISSING" };
  return { status: 500, error: code || "SEND_RESET_EMAIL_FAILED" };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { email, name = "", isNew = false } = req.body || {};
  const normalizedEmail = String(email || "").trim();
  if (!normalizedEmail) return res.status(400).json({ error: "Missing email" });

  try {
    const resetLink = await createResetLink(normalizedEmail);
    const appUrl = getAppUrl();
    const transporter = createTransporter();
    const subject = isNew
      ? "[E-Memo] ตั้งรหัสผ่านสำหรับบัญชีของคุณ"
      : "[E-Memo] รีเซ็ตรหัสผ่าน E-Memo";

    const safeResetLink = escapeHtml(resetLink);
    const safeAppUrl = escapeHtml(appUrl);
    const greeting = escapeHtml(name ? `คุณ${name}` : normalizedEmail);
    const actionText = isNew ? "ตั้งรหัสผ่าน" : "รีเซ็ตรหัสผ่าน";

    const html = `
<div style="font-family:'Noto Sans Thai',Sarabun,Arial,sans-serif;max-width:560px;margin:0 auto;background:#fff;">
  <div style="background:#1E3A5F;padding:20px 28px;border-radius:8px 8px 0 0;">
    <div style="font-size:16px;font-weight:700;color:#fff;">${COMPANY}</div>
    <div style="font-size:11px;color:rgba(255,255,255,.7);margin-top:2px;">E-Memo System</div>
  </div>
  <div style="border:1px solid #E5E7EB;border-top:3px solid #D4AF37;padding:28px;border-radius:0 0 8px 8px;">
    <p style="margin:0 0 14px;font-size:14px;line-height:1.7;color:#111;">
      เรียน ${greeting}<br/>
      ${isNew ? "บัญชี E-Memo ของคุณถูกสร้างแล้ว" : "เราได้รับคำขอรีเซ็ตรหัสผ่านสำหรับบัญชีนี้"}
    </p>
    <div style="text-align:center;margin:24px 0;">
      <a href="${safeResetLink}" style="background:#D4AF37;color:#111;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px;display:inline-block;">
        ${actionText}
      </a>
    </div>
    <p style="margin:0 0 12px;font-size:12px;color:#6B7280;line-height:1.7;">
      หากปุ่มไม่ทำงาน ให้คัดลอกลิงก์นี้ไปเปิดในเบราว์เซอร์:<br/>
      <a href="${safeResetLink}" style="color:#1E3A5F;word-break:break-all;">${safeResetLink}</a>
    </p>
    <p style="margin:0 0 4px;font-size:11px;color:#9CA3AF;">ลิงก์มีอายุ 1 ชั่วโมง</p>
    <p style="margin:0;font-size:11px;color:#9CA3AF;">หลังตั้งรหัสผ่านแล้วให้กลับเข้าใช้งานที่ <a href="${safeAppUrl}" style="color:#1E3A5F;">${safeAppUrl}</a></p>
    <div style="border-top:1px solid #F3F4F6;margin-top:24px;padding-top:14px;font-size:10px;color:#D1D5DB;text-align:center;">
      ${COMPANY} - E-Memo System
    </div>
  </div>
</div>`;

    await transporter.sendMail({
      from: process.env.SMTP_FROM || `"E-Memo TGM" <${process.env.SMTP_USER}>`,
      to: normalizedEmail,
      subject,
      html,
      text: `${actionText}: ${resetLink}\n\nหลังตั้งรหัสผ่านแล้วให้กลับเข้าใช้งานที่ ${appUrl}\nลิงก์มีอายุ 1 ชั่วโมง`,
    });

    return res.status(200).json({ success: true, from: process.env.SMTP_USER, appUrl });
  } catch (err) {
    console.error("[send-reset-email]", err);
    const mapped = mapError(err);
    return res.status(mapped.status).json({ error: mapped.error });
  }
}
