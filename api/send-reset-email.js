import nodemailer from "nodemailer";
import admin from "firebase-admin";
import { initFirebaseAdmin, fetchEmailTemplates } from "./firebase-admin.js";
import {
  buildEmailVars,
  getTemplateForType,
  renderTemplate,
  resolveTemplateType,
} from "./email-templates.js";
import { getAppUrl } from "./app-url.js";

async function createResetLink(email, appUrl) {
  initFirebaseAdmin();
  return admin.auth().generatePasswordResetLink(email, {
    url: `${appUrl}/?mode=resetPassword`,
  });
}

function createAppResetLink(firebaseLink, appUrl) {
  const parsedLink = new URL(firebaseLink);
  const oobCode = parsedLink.searchParams.get("oobCode");
  const mode = parsedLink.searchParams.get("mode") || "resetPassword";

  if (!oobCode) return firebaseLink;

  const appResetUrl = new URL(appUrl);
  appResetUrl.searchParams.set("mode", mode);
  appResetUrl.searchParams.set("oobCode", oobCode);
  return appResetUrl.toString();
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
  if (code.includes("unauthorized-continue-uri")) return { status: 400, error: "UNAUTHORIZED_CONTINUE_URI" };
  if (code === "SMTP_CONFIG_MISSING") return { status: 500, error: "SMTP_CONFIG_MISSING" };
  if (code === "FIREBASE_ADMIN_CONFIG_MISSING") return { status: 500, error: "FIREBASE_ADMIN_CONFIG_MISSING" };
  return { status: 500, error: code || "SEND_RESET_EMAIL_FAILED" };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = req.body || {};
  const {
    email,
    name = "",
    loginId = "",
    password = "",
    customTemplate,
  } = body;

  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return res.status(400).json({ error: "Missing email" });

  const templateType = resolveTemplateType(body);

  try {
    const appUrl = getAppUrl();
    const firebaseResetLink = await createResetLink(normalizedEmail, appUrl);
    const resetLink = createAppResetLink(firebaseResetLink, appUrl);
    const transporter = createTransporter();

    let storedTemplates = null;
    try {
      storedTemplates = await fetchEmailTemplates();
    } catch (e) {
      console.warn("[send-reset-email] fetchEmailTemplates failed", e.message);
    }

    const template = customTemplate?.subject && customTemplate?.html
      ? customTemplate
      : getTemplateForType(storedTemplates, templateType);

    const vars = buildEmailVars({
      name,
      email: normalizedEmail,
      loginId: String(loginId || "").trim(),
      password: String(password || "").trim(),
      resetLink,
      appUrl,
      templateType,
    });

    const rendered = renderTemplate(template, vars);

    await transporter.sendMail({
      from: process.env.SMTP_FROM || `"E-Memo TGM" <${process.env.SMTP_USER}>`,
      to: normalizedEmail,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });

    return res.status(200).json({ success: true, from: process.env.SMTP_USER, appUrl, templateType });
  } catch (err) {
    console.error("[send-reset-email]", err);
    const mapped = mapError(err);
    return res.status(mapped.status).json({ error: mapped.error });
  }
}
