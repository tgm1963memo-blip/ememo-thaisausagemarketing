// api/send-email.js
// Vercel Serverless Function — ส่งอีเมล์ผ่าน SMTP บริษัท
// รองรับ: HTML body, รูปภาพ inline (cid:), แนบไฟล์ base64
//
// ตั้งค่า Environment Variables ใน Vercel Dashboard:
//   SMTP_HOST     = mail.tgm.co.th
//   SMTP_PORT     = 465
//   SMTP_USER     = noreply.ememo@tgm.co.th
//   SMTP_PASS     = <password>
//   SMTP_FROM     = "E-Memo TGM" <noreply.ememo@tgm.co.th>

import nodemailer from "nodemailer";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { to, subject, html, text, attachments, inlineImages } = req.body;

  if (!to || !subject || !html)
    return res.status(400).json({ error: "Missing required fields: to, subject, html" });

  if (!process.env.SMTP_USER || !process.env.SMTP_PASS)
    return res.status(500).json({ error: "SMTP ยังไม่ได้ตั้งค่า — กรุณาเพิ่ม SMTP_USER, SMTP_PASS ใน Vercel Environment Variables" });

  // Port 465 → secure: true (SSL โดยตรง, ไม่ใช่ STARTTLS)
  const transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST || "mail.tgm.co.th",
    port:   parseInt(process.env.SMTP_PORT || "465"),
    secure: true,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    tls: { rejectUnauthorized: false },
  });

  try {
    const mailAttachments = [];

    if (Array.isArray(inlineImages)) {
      inlineImages.forEach(img => mailAttachments.push({
        filename: img.filename || img.cid, cid: img.cid,
        content: img.content, encoding: "base64",
        contentType: img.contentType || "image/png",
      }));
    }

    if (Array.isArray(attachments)) {
      attachments.forEach(att => mailAttachments.push({
        filename: att.filename, content: att.content,
        encoding: "base64", contentType: att.contentType || "application/octet-stream",
      }));
    }

    const info = await transporter.sendMail({
      from:        process.env.SMTP_FROM || `"E-Memo TGM" <${process.env.SMTP_USER}>`,
      to:          Array.isArray(to) ? to.join(",") : to,
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
