// api/send-email.js
// Vercel Serverless Function — ส่งอีเมล์ผ่าน SMTP บริษัท
// รองรับ: HTML body, รูปภาพ inline (cid:), แนบไฟล์ base64
//
// ตั้งค่า Environment Variables ใน Vercel Dashboard:
//   SMTP_HOST     = mail.tgm.co.th  (หรือ smtp.gmail.com)
//   SMTP_PORT     = 587
//   SMTP_USER     = noreply.ememo@tgm.co.th
//   SMTP_PASS     = TSStss2026
//   SMTP_FROM     = "Thai Sausage Marketing" <noreply.ememo@tgm.co.th>

import nodemailer from "nodemailer";

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const {
    to,           // string | string[] — ผู้รับ
    subject,      // string
    html,         // string — HTML body (อาจมี {{var}} ถูก replace แล้ว)
    text,         // string — fallback plaintext (optional)
    attachments,  // [{ filename, content (base64), contentType }] (optional)
    inlineImages, // [{ cid, content (base64), contentType }] (optional)
  } = req.body;

  if (!to || !subject || !html) {
    return res.status(400).json({ error: "Missing required fields: to, subject, html" });
  }

  // ── SMTP config from env ──────────────────────────────────────────────────
  const smtpConfig = {
    host:   process.env.SMTP_HOST || "smtp.gmail.com",
    port:   parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_SECURE === "false", // true for 465, false for 587
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    tls: { rejectUnauthorized: false },
  };

  if (!smtpConfig.auth.user || !smtpConfig.auth.pass) {
    return res.status(500).json({
      error: "SMTP ยังไม่ได้ตั้งค่า — กรุณาเพิ่ม SMTP_HOST, SMTP_USER, SMTP_PASS ใน Vercel Environment Variables แล้ว Redeploy",
    });
  }

  try {
    const transporter = nodemailer.createTransport(smtpConfig);

    // Build attachments array
    const mailAttachments = [];

    // Inline images (embedded in HTML via cid:)
    if (inlineImages && Array.isArray(inlineImages)) {
      inlineImages.forEach(img => {
        mailAttachments.push({
          filename:    img.filename || img.cid,
          cid:         img.cid,
          content:     img.content,   // base64 string
          encoding:    "base64",
          contentType: img.contentType || "image/png",
        });
      });
    }

    // Regular attachments
    if (attachments && Array.isArray(attachments)) {
      attachments.forEach(att => {
        mailAttachments.push({
          filename:    att.filename,
          content:     att.content,   // base64 string
          encoding:    "base64",
          contentType: att.contentType || "application/octet-stream",
        });
      });
    }

    const recipients = Array.isArray(to) ? to.join(",") : to;

    const info = await transporter.sendMail({
      from:        process.env.SMTP_FROM || smtpConfig.auth.user,
      to:          recipients,
      subject,
      html,
      text:        text || html.replace(/<[^>]+>/g, ""),
      attachments: mailAttachments,
    });

    return res.status(200).json({ success: true, messageId: info.messageId });
  } catch (err) {
    console.error("[send-email] Error:", err);
    return res.status(500).json({ error: err.message });
  }
}
