import React, { useState, useEffect, useRef, useCallback } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { ref, onValue, set, push, update } from "firebase/database";
import { auth, db, DATA_PATH } from "./firebase";
import Login from "./Login";
import ResetPassword from "./ResetPassword";
import { isResetPasswordLink, isPublicMemoLink } from "./authActionParams";
import PublicMemoView from "./PublicMemoView";
import ChangePasswordModal from "./ChangePasswordModal";
import OnboardingTour from "./OnboardingTour";
import { getOnboardingSteps } from "./onboardingSteps";
import AcknowledgementPanel from "./AcknowledgementPanel";
import UserGuideView from "./UserGuideView";
import {
  buildApprovedEmailRecipients,
  buildMemoShareLink,
  getAckSummary,
  getMemoApproverSearchText,
  getMemoCreatorSearchText,
  collectUniqueApprovers,
  collectUniqueCreators,
  isValidAckRecipient,
  isRecipientAcknowledged,
  isMemoDeleted,
  emailToKey,
  normalizeEmail as normalizeMemoEmail,
} from "./memoHelpers";
import {
  DEFAULT_EMAIL_TEMPLATES,
  EMAIL_PLACEHOLDERS,
  EMAIL_TEMPLATE_TABS,
  mergeEmailTemplates,
  getTemplateByType,
} from "./emailTemplates";

// ── Firebase Auth REST API ─────────────────────────────────────────────────
// ข้อ 1 & 4: สร้าง Auth user ผ่าน REST API โดยไม่ต้อง logout admin
// Firebase ส่งอีเมล์จาก noreply@[project].firebaseapp.com
// → ตั้ง custom email ได้ที่: Firebase Console → Authentication → Templates → Customize
// → ปุ่ม "Customize action URL" และกำหนด custom domain ให้อีเมล์ไม่ตก Spam
const DEFAULT_LOGIN_DOMAIN = import.meta.env.VITE_LOGIN_EMAIL_DOMAIN || "tgm.co.th";

function normalizeLoginId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "");
}

function makeLoginEmail(loginId) {
  const raw = String(loginId || "").trim().toLowerCase();
  if (raw.includes("@")) return raw;
  const clean = normalizeLoginId(raw);
  return `${clean}@${DEFAULT_LOGIN_DOMAIN}`;
}

function loginIdFromUser(user) {
  return user?.loginId || String(user?.email || "").split("@")[0] || "";
}

function parseNameAndNickname(name, nicknameField = "") {
  const raw = String(name || "").trim();
  const embedded = raw.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (embedded) return { name: embedded[1].trim(), nickname: embedded[2].trim() };
  const nick = String(nicknameField || "").trim();
  return { name: raw, nickname: nick };
}

function formatUserLabel(u, { withDept = true, withEmail = false } = {}) {
  if (!u) return "";
  const { name, nickname } = parseNameAndNickname(u.name, u.nickname);
  const nickPart = nickname ? ` (${nickname})` : "";
  const deptPart = withDept && u.dept ? ` · ${u.dept}` : "";
  const emailPart = withEmail && u.email ? ` — ${u.email}` : "";
  return `${name}${nickPart}${deptPart}${emailPart}`;
}

function groupUsersByDept(userList) {
  const sorted = [...userList].sort((a, b) => {
    const da = (a.dept || "").localeCompare(b.dept || "", "th");
    if (da !== 0) return da;
    return (a.name || "").localeCompare(b.name || "", "th");
  });
  const groups = new Map();
  for (const u of sorted) {
    const dept = u.dept?.trim() || "— ไม่ระบุแผนก —";
    if (!groups.has(dept)) groups.set(dept, []);
    groups.get(dept).push(u);
  }
  return [...groups.entries()].map(([dept, users]) => ({ dept, users }));
}

function userByEmailMap(users) {
  return Object.fromEntries(
    (users || []).filter(u => u.email).map(u => [String(u.email).toLowerCase(), u])
  );
}

async function createAuthUserREST(email, password) {
  const apiKey = auth.app.options.apiKey;
  // สร้าง random password ชั่วคราว user จะ reset ผ่านลิงก์
  const tmpPwd = password || (Math.random().toString(36).slice(2,8) + "X9!" + Math.random().toString(36).slice(2,5));
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`,
    { method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ email, password: tmpPwd, returnSecureToken: false }) }
  );
  const data = await res.json();
  if (data.error) {
    // INVALID_EMAIL, EMAIL_EXISTS etc.
    throw new Error(data.error.message);
  }
  return data; // { email, localId, ... }
}

// ── Email via SMTP บริษัท (Vercel API route) ─────────────────────────────────
const API_BASE = typeof window !== "undefined"
  ? (window.location.origin.includes("localhost") ? "http://localhost:3000" : "")
  : "";

async function sendResetEmailREST({
  email,
  name = "",
  loginId = "",
  password = "",
  templateType = "forgot",
  emailTemplates = null,
}) {
  const customTemplate = emailTemplates ? getTemplateByType(emailTemplates, templateType) : null;
  let res;
  try {
    res = await fetch(`${API_BASE}/api/send-reset-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        name,
        loginId,
        password,
        templateType,
        customTemplate,
      }),
    });
  } catch (err) {
    throw new Error("เรียก API ส่งอีเมลไม่ได้ — ถ้าทดสอบบนเครื่องให้รัน npm run dev:api (vercel dev) หรือ deploy ขึ้น Vercel");
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(resetEmailErrorMessage(data.error));
    error.code = data.error;
    throw error;
  }
  return data;
}

async function updateAuthPasswordREST(email, password) {
  let res;
  try {
    res = await fetch(`${API_BASE}/api/update-auth-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch (err) {
    throw new Error("เรียก API อัปเดตรหัสผ่านไม่ได้ — กรุณารัน vercel dev หรือ deploy");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(updatePasswordErrorMessage(data.error));
    error.code = data.error;
    throw error;
  }
  return data;
}

function updatePasswordErrorMessage(code) {
  return {
    USER_NOT_FOUND: "ไม่พบ Auth user นี้ใน Firebase",
    WEAK_PASSWORD: "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร",
    FIREBASE_ADMIN_CONFIG_MISSING: "ระบบยังไม่ได้ตั้งค่า Firebase Admin บน Vercel",
  }[code] || (code || "อัปเดตรหัสผ่านไม่สำเร็จ");
}

function resetEmailErrorMessage(code) {
  return {
    USER_NOT_FOUND: "ไม่พบ Auth user นี้ใน Firebase — กรุณาสร้างบัญชี Auth ก่อน",
    EMAIL_NOT_FOUND: "ไม่พบ Auth user นี้ใน Firebase — กรุณาสร้างบัญชี Auth ก่อน",
    INVALID_EMAIL: "รูปแบบ Email ไม่ถูกต้อง",
    SMTP_CONFIG_MISSING: "ระบบยังไม่ได้ตั้งค่า SMTP ของ noreply.ememo@tgm.co.th",
    FIREBASE_ADMIN_CONFIG_MISSING: "ระบบยังไม่ได้ตั้งค่า Firebase Admin บน Vercel",
    UNAUTHORIZED_CONTINUE_URI: "โดเมน reset password ยังไม่ได้รับอนุญาตใน Firebase",
  }[code] || (code || "ส่งลิงก์รีเซ็ตรหัสผ่านไม่สำเร็จ");
}

/** สร้าง Auth (ถ้ายังไม่มี) แล้วส่งอีเมลทันที */
async function ensureAuthAndSendAccountEmail({
  email, name, loginId, password, templateType, emailTemplates,
}) {
  const payload = { email, name, loginId, password, templateType, emailTemplates };
  try {
    await sendResetEmailREST(payload);
    return { ok: true };
  } catch (err) {
    const notFound = err.code === "USER_NOT_FOUND" || err.code === "EMAIL_NOT_FOUND";
    if (notFound && password?.length >= 6) {
      await createAuthUserREST(email, password);
      await sendResetEmailREST(payload);
      return { ok: true, createdAuth: true };
    }
    throw err;
  }
}

async function sendMemoEmail({ to, subject, html, text, attachments }) {
  const res = await fetch(`${API_BASE}/api/send-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, subject, html, text, attachments }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "ส่งอีเมล์ไม่สำเร็จ");
  return data;
}

// ── Theme ─────────────────────────────────────────────────────────────────────
const GOLD  = "#D4AF37";
const BLACK = "#111111";

// ── Constants ─────────────────────────────────────────────────────────────────
const COMPANY       = "บริษัท ไทยซอสเซส มาร์เก็ตติ้ง จำกัด";
const COMPANY_SHORT = "Thai Sauces Marketing";

// ── Built-in system template (used when no custom .docx template uploaded) ──
const SYSTEM_TEMPLATE_ID = "__system__";
const BASE_CATEGORIES = ["ทั่วไป","งบประมาณ","จัดซื้อจัดจ้าง","รายงาน","นโยบาย","HR","IT","อื่นๆ"];

const STATUS_LABEL = {
  draft:"ร่าง", pending:"รออนุมัติ", approved:"อนุมัติแล้ว",
  rejected:"ปฏิเสธ", recalled:"เรียกคืนแล้ว"
};
const STATUS_COLOR = {
  draft:    { bg:"#F9FAFB", text:"#6B7280", border:"#E5E7EB" },
  pending:  { bg:"#FFFBEB", text:"#B45309", border:"#FCD34D" },
  approved: { bg:"#ECFDF5", text:"#065F46", border:"#A7F3D0" },
  rejected: { bg:"#FFF1F1", text:"#991B1B", border:"#FECACA" },
  recalled: { bg:"#EFF6FF", text:"#1E40AF", border:"#BFDBFE" },
};
const ROLE_CONFIG = {
  superadmin: { label:"Super Admin", bg:"#EEEDFE", text:"#3C3489", border:"#AFA9EC" },
  admin:      { label:"Admin",       bg:"#FFFBEB", text:"#B45309", border:"#FCD34D" },
  user:       { label:"User",        bg:"#F9FAFB", text:"#6B7280", border:"#E5E7EB" },
};
const PALETTES = [
  {bg:"#E6F1FB",text:"#1E40AF"},{bg:"#ECFDF5",text:"#065F46"},{bg:"#FFFBEB",text:"#B45309"},
  {bg:"#FFF1F2",text:"#9F1239"},{bg:"#F0FDF4",text:"#166534"},{bg:"#EEEDFE",text:"#3C3489"},
  {bg:"#FFF7ED",text:"#9A3412"},{bg:"#F0F9FF",text:"#0C4A6E"},
];

// ── Permissions ───────────────────────────────────────────────────────────────
// [4] สิทธิ์การเข้าถึงแบบละเอียด
const ROLE_PERMS = {
  superadmin: ["manageUsers","settings","viewAll","create","approve","recall","editTemplate","viewReports","manageCategories","deleteMemo"],
  admin:      ["viewAll","create","approve","recall","viewReports"],
  user:       ["create","recall","viewOwn","approve"],  // user ต้องอนุมัติ Memo ที่ได้รับมอบหมายได้
};
const can = (role, action) => ROLE_PERMS[role]?.includes(action) ?? false;

// ── Firebase helpers ──────────────────────────────────────────────────────────
const writeMemo = async (memoData, isNew) => {
  if (isNew) {
    // If caller provided a deterministic id, use it (prevents duplicate pushes).
    if (memoData && memoData.id) {
      await set(ref(db, `${DATA_PATH}/memos/${memoData.id}`), memoData);
      return memoData.id;
    }
    const r = push(ref(db, `${DATA_PATH}/memos`));
    const id = r.key;
    await set(r, { ...memoData, id });
    return id;
  }
  await set(ref(db, `${DATA_PATH}/memos/${memoData.id}`), memoData);
  return memoData.id;
};
const patchMemo        = (id, p)   => update(ref(db, `${DATA_PATH}/memos/${id}`), p);
const writeUsers       = (obj)     => set(ref(db, `${DATA_PATH}/users`), obj);
const patchUser        = (id, p)   => update(ref(db, `${DATA_PATH}/users/${id}`), p);
const writeNotifyConfig= (cfg)     => set(ref(db, `${DATA_PATH}/notifyConfig`), cfg);
const writeEmailTemplates=(tpls)   => set(ref(db, `${DATA_PATH}/emailTemplates`), tpls);
const writePdfTemplates= (tpls)    => set(ref(db, `${DATA_PATH}/pdfTemplates`), tpls);
const writeDocCounters = (ctrs)    => set(ref(db, `${DATA_PATH}/docCounters`), ctrs);
const writeRouteTemplates=(routes) => set(ref(db, `${DATA_PATH}/routeTemplates`), routes||[]);

async function assignDocNo(memo, users, docCounters) {
  const creator = users.find(u => u.id === memo.createdBy) || {};
  const dept    = (creator.dept || "GEN").toUpperCase().replace(/\s+/g,"").slice(0,6);
  const year    = new Date().getFullYear() + 543;
  const key     = `${dept}_${year}`;
  const cur     = (docCounters?.[key] || 0) + 1;
  const docNo   = `${dept}-${year}-${String(cur).padStart(4,"0")}`;
  await update(ref(db, `${DATA_PATH}/docCounters`), { [key]: cur });
  return docNo;
}

// [6] ส่งอีเมล์หาผู้อนุมัติเมื่อถึงคิว ─────────────────────────────────────
// Strip HTML tags helper for email plain-text fields
const stripHtml = s => (s||"").replace(/<br\s*\/?>/gi,"\n").replace(/<[^>]+>/g,"").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").trim();

const normalizeEmail = email => String(email || "").trim().toLowerCase();

function generateShareToken() {
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, "0")).join("");
}

function buildMemoShareLinkLocal(memo, appUrl = window.location.origin, recipientEmail = "") {
  return buildMemoShareLink(memo, appUrl, recipientEmail);
}

function isMemoCcRecipient(memo, userEmail) {
  if (memo.status !== "approved") return false;
  const email = normalizeEmail(userEmail);
  if (!email) return false;
  return (memo.notify?.emailList || []).some(e => normalizeEmail(e) === email);
}

async function runShareTokenBackfill(memosObj) {
  try {
    const res = await fetch(`${API_BASE}/api/backfill-share-tokens`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return data;
  } catch (_) {
    /* fallback to client-side update below */
  }

  const needs = Object.values(memosObj || {}).filter(m => m.status === "approved" && !m.shareToken);
  if (!needs.length) return { updated: 0 };

  const updates = Object.fromEntries(
    needs.map(m => [`${DATA_PATH}/memos/${m.id}/shareToken`, generateShareToken()])
  );
  await update(ref(db), updates);
  return { updated: needs.length };
}

function countMemosNeedingShareToken(memosObj) {
  return Object.values(memosObj || {}).filter(m => m.status === "approved" && !m.shareToken).length;
}

function displayUserName(u) {
  if (!u) return "-";
  const { name, nickname } = parseNameAndNickname(String(u.name || "").replace(/^undefined/i, ""), u.nickname);
  return nickname ? `${name} (${nickname})` : (name || "-");
}

async function sendApproverEmail(cfg, memo, level, users) {
  if (!cfg.email?.enabled) return;
  const creator   = users.find(u => u.id === memo.createdBy) || {};
  const modeLabel = level.mode === "any" ? "ผู้ใดผู้หนึ่ง" : "ทุกคน";
  const attList   = (memo.attachments||[]).map(a=>a.name).join(", ") || "-";
  const appUrl    = window.location.origin;

  for (const ap of level.approvers) {
    const toEmail    = ap.email || (users.find(u=>u.id===ap.userId)||{}).email;
    const toName     = ap.name  || toEmail;
    if (!toEmail) continue;
    try {
      const html = `
        <div style="font-family:'Noto Sans Thai',Sarabun,sans-serif;max-width:560px;margin:0 auto;">
          <div style="background:#1E3A5F;padding:20px 28px;border-radius:8px 8px 0 0;">
            <div style="font-size:16px;font-weight:700;color:#fff;">${COMPANY}</div>
            <div style="font-size:11px;color:rgba(255,255,255,.6);margin-top:2px;">E-Memo System — แจ้งเตือนการอนุมัติ</div>
          </div>
          <div style="border:1px solid #E5E7EB;border-top:3px solid #D4AF37;padding:28px;border-radius:0 0 8px 8px;background:#fff;">
            <p style="margin:0 0 8px;font-size:15px;font-weight:600;color:#111;">คุณ${toName} มีเอกสารรออนุมัติ</p>
            <table style="width:100%;border-collapse:collapse;font-size:13px;margin:12px 0;">
              <tr><td style="color:#6B7280;padding:4px 0;width:100px;">ชื่อเรื่อง:</td><td style="font-weight:600;color:#111;">${memo.title}</td></tr>
              <tr><td style="color:#6B7280;padding:4px 0;">หมวดหมู่:</td><td>${memo.category||"-"}</td></tr>
              <tr><td style="color:#6B7280;padding:4px 0;">ผู้สร้าง:</td><td>${creator.name||"-"}</td></tr>
              <tr><td style="color:#6B7280;padding:4px 0;">ลำดับ:</td><td>ขั้นที่ ${level.level||""} (${modeLabel}อนุมัติ)</td></tr>
              ${attList!=="-"?`<tr><td style="color:#6B7280;padding:4px 0;">เอกสารแนบ:</td><td>${attList}</td></tr>`:""}
            </table>
            <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:6px;padding:12px 16px;margin:12px 0;font-size:12px;color:#374151;max-height:120px;overflow:hidden;">
              ${stripHtml(memo.content).slice(0,300)}${stripHtml(memo.content).length>300?"...":""}
            </div>
            <div style="text-align:center;margin:20px 0;">
              <a href="${appUrl}" style="background:#D4AF37;color:#111;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px;display:inline-block;">
                เข้าสู่ระบบเพื่ออนุมัติ →
              </a>
            </div>
            <div style="border-top:1px solid #F3F4F6;margin-top:20px;padding-top:12px;font-size:10px;color:#D1D5DB;text-align:center;">
              ${COMPANY} — E-Memo System
            </div>
          </div>
        </div>`;
      await sendMemoEmail({
        to: toEmail,
        subject: `[E-Memo] รออนุมัติ: ${memo.title}`,
        html,
      });
    } catch(e) { console.warn("[sendApproverEmail]", toEmail, e.message); }

    // ── LINE OA push ให้ผู้อนุมัติโดยตรง ────────────────────────────────
    console.log("[LINE DEBUG] cfg.line:", JSON.stringify(cfg.line));
    console.log("[LINE DEBUG] ap:", JSON.stringify(ap));
    if (cfg.line?.enabled && cfg.line?.channelAccessToken) {
      const approverUser = users.find(u => u.id === ap.userId);
      const lineId = approverUser?.lineId;
      console.log("[LINE DEBUG] approverUser found:", JSON.stringify(approverUser));
      console.log("[LINE DEBUG] lineId:", lineId);
      if (lineId) {
        try {
          const lineMsg = [
            `\uD83D\uDCCB [${COMPANY_SHORT}] มีเอกสารรออนุมัติ`,
            `ชื่อเรื่อง: ${memo.title}`,
            `ผู้สร้าง: ${creator.name||"-"}`,
            `ขั้นที่ ${level.level||""} (${modeLabel}อนุมัติ)`,
            `\n\uD83D\uDD17 กดลิงก์เพื่อเข้าระบบและอนุมัติ:\n${appUrl}`,
          ].join("\n");
          const resp = await fetch("/api/approval-notify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              to: lineId,
              message: lineMsg,
              channelAccessToken: cfg.line.channelAccessToken,
            }),
          });
          const result = await resp.json();
          console.log("[LINE DEBUG] API response:", resp.status, JSON.stringify(result));
        } catch(e) { console.warn("[sendApproverEmail] LINE", lineId, e.message); }
      } else {
        console.warn("[LINE DEBUG] lineId ว่าง — ผู้อนุมัติไม่มี lineId ใน Firebase");
      }
    } else {
      console.warn("[LINE DEBUG] LINE ไม่ enabled หรือไม่มี channelAccessToken");
    }
    // ────────────────────────────────────────────────────────────────────
  }
}

async function sendApprovedNotifications(cfg, memo, users) {
  const creator      = users.find(u => u.id === memo.createdBy) || {};
  const approvedDate = new Date().toLocaleDateString("th-TH",{day:"2-digit",month:"long",year:"numeric"});
  const summary      = stripHtml(memo.content||"").slice(0,200);
  const appUrl       = window.location.origin;
  const approvedEmailRecipients = buildApprovedEmailRecipients(memo, users);
  const emailReceipts = [];

  // ส่งอีเมล์ผ่าน SMTP บริษัท
  if (!cfg.email?.enabled) {
    const skippedAt = new Date().toISOString();
    for (const recipient of approvedEmailRecipients) {
      emailReceipts.push({ ...recipient, status: "skipped", sentAt: skippedAt, error: "Email notification is disabled" });
    }
  } else if (approvedEmailRecipients.length) {
    for (const recipient of approvedEmailRecipients) {
      const sentAt = new Date().toISOString();
      const viewLink = buildMemoShareLinkLocal(memo, appUrl, recipient.email);
      const html = `
      <div style="font-family:'Noto Sans Thai',Sarabun,sans-serif;max-width:560px;margin:0 auto;">
        <div style="background:#1E3A5F;padding:20px 28px;border-radius:8px 8px 0 0;">
          <div style="font-size:16px;font-weight:700;color:#fff;">${COMPANY}</div>
          <div style="font-size:11px;color:rgba(255,255,255,.6);margin-top:2px;">E-Memo System — แจ้งผลการอนุมัติ</div>
        </div>
        <div style="border:1px solid #E5E7EB;border-top:3px solid #22C55E;padding:28px;border-radius:0 0 8px 8px;background:#fff;">
          <p style="margin:0 0 4px;font-size:22px;">✅</p>
          <p style="margin:0 0 12px;font-size:15px;font-weight:600;color:#111;">คุณ${recipient.name||""} — Memo ได้รับการอนุมัติครบแล้ว</p>
          <table style="width:100%;border-collapse:collapse;font-size:13px;margin:8px 0;">
            <tr><td style="color:#6B7280;padding:4px 0;width:100px;">ชื่อเรื่อง:</td><td style="font-weight:600;color:#111;">${memo.title}</td></tr>
            <tr><td style="color:#6B7280;padding:4px 0;">หมวดหมู่:</td><td>${memo.category||"-"}</td></tr>
            <tr><td style="color:#6B7280;padding:4px 0;">ผู้สร้าง:</td><td>${creator.name||"-"}</td></tr>
            <tr><td style="color:#6B7280;padding:4px 0;">วันที่อนุมัติ:</td><td>${approvedDate}</td></tr>
            ${memo.docNo?`<tr><td style="color:#6B7280;padding:4px 0;">เลขที่เอกสาร:</td><td style="font-family:monospace;color:#1D4ED8;">${memo.docNo}</td></tr>`:""}
          </table>
          ${summary?`<div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:6px;padding:12px;margin:12px 0;font-size:12px;color:#374151;">${summary}${summary.length>=200?"...":""}</div>`:""}
          <div style="text-align:center;margin:20px 0;display:flex;flex-direction:column;gap:10px;align-items:center;">
            <a href="${viewLink}" style="background:#D4AF37;color:#111;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px;display:inline-block;">
              ดูเอกสาร →
            </a>
            <a href="${viewLink}" style="background:#22C55E;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px;display:inline-block;">
              ✓ รับทราบเอกสาร
            </a>
          </div>
          <p style="margin:0;font-size:11px;color:#9CA3AF;text-align:center;line-height:1.6;">
            เปิดลิงก์นี้ได้โดยไม่ต้องมีบัญชีในระบบ — กดปุ่ม "รับทราบ" เพื่อให้ผู้สร้างทราบว่าคุณได้รับทราบแล้ว
          </p>
          <div style="border-top:1px solid #F3F4F6;margin-top:20px;padding-top:12px;font-size:10px;color:#D1D5DB;text-align:center;">
            ${COMPANY} — E-Memo System
          </div>
        </div>
      </div>`;
      try {
        const result = await sendMemoEmail({
          to: recipient.email,
          subject: `[E-Memo] ✅ อนุมัติแล้ว: ${memo.title}`,
          html,
        });
        emailReceipts.push({ ...recipient, status: "sent", sentAt, messageId: result?.messageId || null });
      } catch(e) {
        emailReceipts.push({ ...recipient, status: "failed", sentAt, error: e.message || String(e) });
        console.warn("[sendApprovedNotifications]", recipient.email, e.message);
      }
    }
  }
  // Notify memo creator via LINE OA if enabled and creator has lineId
  if (cfg.line?.enabled && memo.notify?.postToLine && creator.lineId) {
    try {
      await fetch('/api/approval-notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: creator.lineId,
          message: `✅ Memo ได้รับการอนุมัติครบแล้ว: ${memo.title}\n${appUrl}/?memoId=${memo.id}`,
          channelAccessToken: cfg.line.channelAccessToken,
        })
      });
    } catch (e) { console.warn('[sendApprovedNotifications] LINE creator', creator.lineId, e.message); }
  }

  if (cfg.teams?.enabled && cfg.teams?.webhookUrl && memo.notify?.postToTeams) {
    try { await fetch(cfg.teams.webhookUrl,{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({"@type":"MessageCard",themeColor:"D4AF37",summary:`✅ อนุมัติ: ${memo.title}`,
        sections:[{activityTitle:"✅ Memo อนุมัติครบ",activitySubtitle:COMPANY,
          facts:[{name:"📋",value:memo.title},{name:"👤",value:creator.name||"-"},{name:"📅",value:approvedDate}],markdown:true}]})}); } catch {}
  }
  if (cfg.powerauto?.enabled && cfg.powerauto?.webhookUrl && memo.notify?.postToPowerAuto) {
    try { await fetch(cfg.powerauto.webhookUrl,{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({memo_id:memo.id,memo_title:memo.title,creator_name:creator.name,
        category:memo.category,approved_date:approvedDate,summary,company:COMPANY,status:"approved"})}); } catch {}
  }
  if (cfg.line?.enabled && cfg.line?.channelAccessToken && cfg.line?.groupId && memo.notify?.postToLine) {
    try {
      const msg=[`✅ [${COMPANY_SHORT}] Memo อนุมัติครบ`,`📋 ${memo.title}`,`👤 ${creator.name||"-"}`,`📅 ${approvedDate}`,
        summary?`\n📝 ${summary.slice(0,100)}${summary.length>100?"...":""}`:""  ].filter(Boolean).join("\n");
      await fetch("/api/line-push",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({to:cfg.line.groupId,message:msg,channelAccessToken:cfg.line.channelAccessToken})});
        // Send individual LINE notifications to approvers with lineId
        if (users && users.length) {
          for (const u of users) {
            if (u.lineId) {
              try {
                await fetch("/api/approval-notify",{method:"POST",headers:{"Content-Type":"application/json"},
                  body:JSON.stringify({to:u.lineId,message:msg,channelAccessToken:cfg.line.channelAccessToken})});
              } catch (e) { console.warn("[approval-notify]", u.lineId, e.message); }
            }
          }
        }
      } catch {}
  }

  const sentAt = new Date().toISOString();
  let status;
  if (emailReceipts.length === 0) status = "skipped";
  else if (emailReceipts.every(r => r.status === "sent" || r.status === "skipped")) status = "success";
  else if (emailReceipts.every(r => r.status !== "sent")) status = "failed";
  else status = "partial";

  return {
    sentAt,
    recipients: emailReceipts,
    status,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtDate  = s => !s?"-":new Date(s).toLocaleDateString("th-TH",{day:"2-digit",month:"short",year:"numeric"})+" "+new Date(s).toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit"});
const fmtShort = s => !s?"-":new Date(s).toLocaleDateString("th-TH",{day:"2-digit",month:"short",year:"2-digit"});
const getInit  = (name="") => { const p=name.trim().split(" "); return p.length>=2?p[0][0]+p[1][0]:name.slice(0,2); };
const newId    = (pfx="") => pfx+Date.now()+Math.random().toString(36).slice(2,5);

// Built-in PDF using browser print — no .docx needed
function printSystemPDF(memo, users) {
  const creator = users.find(u=>u.id===memo.createdBy)||{};
  const approvals = (memo.workflowLevels||[]).flatMap(lv=>lv.approvers||[]);
  const fD = s => !s?"-":new Date(s).toLocaleDateString("th-TH",{day:"2-digit",month:"long",year:"numeric"})+" "+new Date(s).toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit"});
  let root = document.getElementById("ememo-print-root");
  if(!root){ root=document.createElement("div"); root.id="ememo-print-root"; document.body.appendChild(root); }
  if(!document.getElementById("ememo-print-css")){
    const s=document.createElement("style"); s.id="ememo-print-css";
    s.textContent=`
      @media print {
        body > * { display:none !important; }
        #ememo-print-root { display:block !important; }
        /* Fixed header repeats on every page */
        #ememo-print-root .rpt-header {
          position: fixed;
          top: 0; left: 0; right: 0;
          background: #fff;
          padding: 8mm 16mm 4mm;
          border-bottom: 2px solid #1E3A5F;
          z-index: 1000;
        }
        /* Fixed footer with page number */
        #ememo-print-root .rpt-footer {
          position: fixed;
          bottom: 0; left: 0; right: 0;
          background: #fff;
          padding: 3mm 16mm 5mm;
          border-top: 1px solid #E5E7EB;
          font-size: 9px;
          color: #9CA3AF;
          display: flex;
          justify-content: space-between;
          z-index: 1000;
        }
        /* Push content down to clear fixed header */
        #ememo-print-root .rpt-body {
          margin-top: 36mm;
          margin-bottom: 16mm;
          padding: 0 16mm;
        }
        #ememo-print-root table { page-break-inside: avoid; }
        @page {
          margin: 0;
          size: A4;
          @bottom-right { content: "หน้า " counter(page) " / " counter(pages); font-size: 9px; color: #9CA3AF; }
        }
      }
      #ememo-print-root { display:none; font-family:'Noto Sans Thai','Sarabun',sans-serif; }
    `;
    document.head.appendChild(s);
  }
  // ── Fixed header (position:fixed repeats on every printed page) ──────────
  let html = '<div class="rpt-header">';
  html += '<div style="display:flex;align-items:center;gap:14px;">';
  html += '<img src="https://img1.pic.in.th/images/logo-tss-03.png" style="height:40px;object-fit:contain;" alt="logo"/>';
  html += '<div style="flex:1;">';
  html += '<div style="font-size:11px;font-weight:700;color:#1E3A5F;">'+COMPANY+'</div>';
  html += '<div style="font-size:14px;font-weight:700;">บันทึกข้อความ (Memo)';
  const _docNo = memo.docNo || ('DRAFT-'+(memo.id||'').slice(-6).toUpperCase());
  html += ' <span style="font-size:10px;color:#6B7280;font-family:monospace;font-weight:400;">เลขที่ '+_docNo+'</span>';
  html += '</div>';
  html += '<div style="font-size:11px;color:#374151;margin-top:2px;">ผู้สร้าง: <span style="font-weight:600;">'+(creator.name||"-")+(creator.dept?' ('+creator.dept+')':'')+'</span></div>';
  html += '</div></div>';
  html += '<div style="font-size:9px;color:#9CA3AF;">'+fD(new Date().toISOString())+'</div>';
  html += '</div></div>';
  // Fixed footer
  html += '<div class="rpt-footer">';
  html += '<span>'+COMPANY+'</span>';
  html += '<span>เลขที่ '+_docNo+'</span>';
  html += '</div>';
  // Body content
  html += '<div class="rpt-body" style="font-family:Noto Sans Thai,Sarabun,sans-serif;font-size:13px;color:#111;">';

  // If uploaded image file, embed as doc
  if(memo.uploadedFile && (memo.uploadedFile.type==="png"||memo.uploadedFile.type==="jpg"||memo.uploadedFile.type==="jpeg")){
    html += '<img src="'+memo.uploadedFile.data+'" style="max-width:100%;display:block;margin:0 auto 12px;"/>';
    if(memo.content) html += '<div style="font-size:12px;color:#374151;margin-bottom:8px;white-space:pre-wrap;">หมายเหตุ: '+memo.content+'</div>';
  } else {
  html += '<table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:12px;"><tbody>';
  html += '<tr><td style="width:90px;color:#6B7280;padding:3px 0;">เรื่อง:</td><td style="font-weight:600;">'+(memo.title||"")+'</td>';
  html += '<td style="width:80px;color:#6B7280;text-align:right;">หมวดหมู่:</td><td style="text-align:right;">'+(memo.category||"")+'</td></tr>';
  html += '<tr><td style="color:#6B7280;padding:3px 0;">ผู้สร้าง:</td><td>'+(creator.name||"-")+(creator.dept?" ("+creator.dept+")":"")+'</td>';
  html += '<td style="color:#6B7280;text-align:right;">วันที่:</td><td style="text-align:right;">'+(memo.createdAt?fD(memo.createdAt):"")+'</td></tr>';
  if(memo.docNo) html += '<tr><td style="color:#6B7280;padding:3px 0;">เลขที่:</td><td colspan="3" style="font-family:monospace;font-weight:600;">'+memo.docNo+'</td></tr>';
  html += '</tbody></table>';
  html += '<div style="border-top:1px solid #E5E7EB;margin-bottom:20px;"></div>';
  html += '<div style="font-size:13px;line-height:1.9;white-space:pre-wrap;margin-bottom:32px;word-break:break-word;">'+(memo.content||"")+'</div>';
  // Signature zones
  const zones = memo.signatureZones||[];
  if(zones.length>0){
    html += '<div style="margin-top:24px;border-top:1px solid #E5E7EB;padding-top:20px;">';
    html += '<div style="font-size:11px;color:#6B7280;font-weight:600;margin-bottom:14px;">ลงนาม</div>';
    html += '<div style="display:flex;gap:24px;flex-wrap:wrap;">';
    zones.forEach(z=>{
      const u=users.find(x=>x.id===z.assignedTo)||{};
      const sig=u.signature||"";
      html += '<div style="flex:1;min-width:140px;text-align:center;">';
      if(sig) html += '<img src="'+sig+'" style="height:48px;display:block;margin:0 auto 4px;"/>';
      else html += '<div style="height:48px;border-bottom:1px solid #111;margin-bottom:6px;"></div>';
      html += '<div style="font-size:11px;font-weight:600;">'+(z.label||"จุดลงนาม")+'</div>';
      if(u.name||z.signerName) html += '<div style="font-size:10px;color:#6B7280;">'+(u.name||z.signerName||"")+'</div>';
      html += '</div>';
    });
    html += '</div></div>';
  }
  // Approval table
  if(approvals.length>0){
    html += '<div style="margin-top:24px;border-top:1px solid #E5E7EB;padding-top:16px;">';
    html += '<div style="font-size:11px;color:#6B7280;font-weight:600;margin-bottom:10px;">ขั้นตอนการอนุมัติ</div>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:11px;">';
    html += '<tr style="background:#F9FAFB;"><th style="text-align:left;padding:5px 8px;border:1px solid #E5E7EB;">ผู้อนุมัติ</th>';
    html += '<th style="text-align:center;padding:5px 8px;border:1px solid #E5E7EB;width:80px;">สถานะ</th>';
    html += '<th style="text-align:center;padding:5px 8px;border:1px solid #E5E7EB;width:140px;">วันที่ / เวลา</th>';
    html += '<th style="text-align:left;padding:5px 8px;border:1px solid #E5E7EB;">ลายเซ็น / ความคิดเห็น</th></tr>';
    approvals.forEach(ap=>{
      const u=users.find(x=>x.id===ap.userId)||{};
      const sl=ap.status==="approved"?"✓ อนุมัติ":ap.status==="rejected"?"✗ ปฏิเสธ":"○ รอ";
      const sig=ap.signature||u.signature||"";
      html += '<tr><td style="padding:5px 8px;border:1px solid #E5E7EB;">'+(ap.name||u.name||ap.email||"-")+'</td>';
      html += '<td style="padding:5px 8px;border:1px solid #E5E7EB;text-align:center;">'+sl+'</td>';
      html += '<td style="padding:5px 8px;border:1px solid #E5E7EB;text-align:center;">'+(ap.actionAt?fD(ap.actionAt):"-")+'</td>';
      html += '<td style="padding:5px 8px;border:1px solid #E5E7EB;">';
      if(sig) html += '<img src="'+sig+'" style="height:32px;display:block;margin-bottom:2px;border:1px solid #E5E7EB;border-radius:3px;background:#fff;padding:2px;"/>';
      html += (ap.comment||"")+'</td></tr>';
    });
    html += '</table></div>';
  }
  }
  html += '</div>'; // close rpt-body
  root.innerHTML = html;
  // Inject page numbers via afterprint / pagedjs not available; use simple JS
  // The @page counter is set in CSS and works in Chrome/Edge natively
  setTimeout(()=>{ window.print(); setTimeout(()=>{ root.innerHTML=""; },500); }, 200);
}

// [3] Level-based workflow helpers ────────────────────────────────────────────
// workflowLevels: [{id, level(1-based), mode:"all"|"any", approvers:[{id?, email, name, status, comment, actionAt}]}]
const isLevelDone = (level) => {
  const aps = level.approvers || [];
  if (!aps.length) return false;
  if (aps.some(a=>a.status==="rejected")) return false; // rejected = blocked
  if (level.mode === "any") return aps.some(a=>a.status==="approved");
  return aps.every(a=>a.status==="approved"); // "all"
};
const isLevelRejected = (level) => (level.approvers||[]).some(a=>a.status==="rejected");
const allLevelsDone   = (levels) => (levels||[]).every(isLevelDone);
const getActiveLevel  = (memo) => (memo.workflowLevels||[])[memo.currentLevel||0];

// [7] approval status for creator: compute who did what ───────────────────────
const getApprovalStatus = (memo, users) => {
  const levels = memo.workflowLevels || [];
  return levels.map((lv, li) => ({
    level: lv.level,
    mode: lv.mode,
    done: isLevelDone(lv),
    rejected: isLevelRejected(lv),
    active: li === (memo.currentLevel||0) && memo.status==="pending",
    approvers: (lv.approvers||[]).map(ap => {
      const u = users.find(u => u.id===ap.userId) || {};
      return { ...ap, resolvedName: ap.name || u.name || ap.email || "-" };
    }),
  }));
};

// ── Shared styles ─────────────────────────────────────────────────────────────
const IS      = { width:"100%", padding:"8px 10px", border:"1px solid #E5E7EB", borderRadius:6, fontSize:13, background:"#fff", color:"#111", boxSizing:"border-box" };
const BTN_GOLD= { display:"inline-flex", alignItems:"center", justifyContent:"center", gap:4, padding:"7px 14px", background:GOLD, color:BLACK, border:"none", borderRadius:6, fontSize:12, fontWeight:600, cursor:"pointer", flexShrink:0, whiteSpace:"nowrap" };
const BTN_GRAY= { padding:"4px 10px", fontSize:11, borderRadius:6, background:"#F9FAFB", color:"#6B7280", border:"1px solid #E5E7EB", cursor:"pointer", flexShrink:0, whiteSpace:"nowrap" };
const BTN_X   = { background:"none", border:"none", cursor:"pointer", fontSize:12, color:"#9CA3AF", padding:"0 2px", flexShrink:0 };
const ATT_ROW = { display:"flex", alignItems:"center", gap:8, padding:"6px 10px", background:"#F9FAFB", borderRadius:6, marginBottom:4, fontSize:12, border:"1px solid #F3F4F6", minWidth:0 };
const FLEX_ROW = { display:"flex", gap:6, alignItems:"center", minWidth:0, width:"100%" };
const FLEX_INPUT = { flex:1, minWidth:0, width:0, padding:"5px 8px", border:"1px solid #E5E7EB", borderRadius:6, fontSize:12, background:"#fff", color:"#111", boxSizing:"border-box" };

// ── UI Components ─────────────────────────────────────────────────────────────
function Avatar({ userId, users, size=28 }) {
  const u=users.find(x=>x.id===userId)||{}; const idx=users.findIndex(x=>x.id===userId);
  const c=PALETTES[(idx<0?0:idx)%PALETTES.length];
  return <div style={{width:size,height:size,borderRadius:"50%",background:c.bg,color:c.text,display:"flex",alignItems:"center",justifyContent:"center",fontSize:size*.36,fontWeight:600,flexShrink:0}}>{getInit(u.name||"?")}</div>;
}
function RoleBadge({role}){const c=ROLE_CONFIG[role]||ROLE_CONFIG.user;return <span style={{background:c.bg,color:c.text,border:`1px solid ${c.border}`,borderRadius:4,padding:"2px 7px",fontSize:11,fontWeight:500,whiteSpace:"nowrap"}}>{c.label}</span>;}
function StatusBadge({status}){const c=STATUS_COLOR[status]||STATUS_COLOR.draft;return <span style={{background:c.bg,color:c.text,border:`1px solid ${c.border}`,borderRadius:4,padding:"2px 7px",fontSize:11,fontWeight:500,whiteSpace:"nowrap"}}>{STATUS_LABEL[status]||status}</span>;}
function Toast({t}){if(!t)return null;const ok=t.type!=="error";return <div style={{position:"fixed",top:20,right:20,zIndex:300,padding:"10px 16px",borderRadius:8,background:ok?"#ECFDF5":"#FFF1F1",color:ok?"#065F46":"#991B1B",border:`1px solid ${ok?"#A7F3D0":"#FECACA"}`,fontSize:13,fontWeight:500,boxShadow:"0 4px 20px rgba(0,0,0,.12)"}}>{t.msg}</div>;}
function Empty({msg}){return <div style={{textAlign:"center",padding:"48px 20px",color:"#9CA3AF",fontSize:13}}><div style={{fontSize:32,opacity:.25,marginBottom:8}}>○</div>{msg}</div>;}
function Section({title,children,extra}){return <div style={{background:"#fff",border:"1px solid #F3F4F6",borderRadius:10,padding:16,marginBottom:12}}>{title&&<div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10,paddingBottom:8,borderBottom:"1px solid #F3F4F6"}}><span style={{fontSize:11,fontWeight:600,color:"#9CA3AF",textTransform:"uppercase",letterSpacing:.6}}>{title}</span>{extra}</div>}{children}</div>;}
function Field({label,children}){return <div style={{marginBottom:10}}><label style={{fontSize:11,fontWeight:600,color:"#6B7280",display:"block",marginBottom:3}}>{label}</label>{children}</div>;}
function Toggle({value,onChange}){
  return <div
    onClick={e=>{ e.stopPropagation(); onChange(!value); }}
    style={{width:38,height:21,borderRadius:11,background:value?GOLD:"#D1D5DB",cursor:"pointer",position:"relative",transition:"background .2s",flexShrink:0}}
  >
    <div style={{width:15,height:15,borderRadius:"50%",background:"#fff",position:"absolute",top:3,left:value?20:3,transition:"left .2s"}}/>
  </div>;
}

// [5] CategoryField — handles "อื่นๆ" custom input ────────────────────────────
function CategoryField({ value, onChange }) {
  const isCustom = value && !BASE_CATEGORIES.includes(value);
  const selVal   = isCustom ? "อื่นๆ" : (value || "ทั่วไป");
  return (
    <div style={{display:"flex",gap:8,alignItems:"flex-start",flexWrap:"wrap"}}>
      <select value={selVal} onChange={e=>{
        if (e.target.value!=="อื่นๆ") onChange(e.target.value);
        else onChange("อื่นๆ:");
      }} style={{...IS,width:"auto",flex:"0 0 auto"}}>
        {BASE_CATEGORIES.map(c=><option key={c}>{c}</option>)}
      </select>
      {(selVal==="อื่นๆ"||isCustom) && (
        <input value={isCustom?value:value.replace("อื่นๆ:","")} onChange={e=>onChange(e.target.value||"อื่นๆ")}
          placeholder="ระบุหมวดหมู่..." style={{...IS,flex:1,minWidth:120}}/>
      )}
    </div>
  );
}

// [1] SignaturePad — draw or upload signature ──────────────────────────────────
function SignaturePad({ value, onChange }) {
  const canvasRef = useRef();
  const drawing   = useRef(false);
  const fileRef   = useRef();

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle="#fff"; ctx.fillRect(0,0,canvas.width,canvas.height);
    if (value) { const img=new Image(); img.onload=()=>ctx.drawImage(img,0,0); img.src=value; }
  }, []);

  const getPos = (e, canvas) => {
    const r = canvas.getBoundingClientRect();
    const src = e.touches?.[0] || e;
    return { x: (src.clientX-r.left)*(canvas.width/r.width), y: (src.clientY-r.top)*(canvas.height/r.height) };
  };
  const startDraw = e => {
    drawing.current=true;
    const canvas=canvasRef.current; const ctx=canvas.getContext("2d"); const pos=getPos(e,canvas);
    ctx.beginPath(); ctx.moveTo(pos.x,pos.y);
    e.preventDefault();
  };
  const draw = e => {
    if (!drawing.current) return;
    const canvas=canvasRef.current; const ctx=canvas.getContext("2d"); const pos=getPos(e,canvas);
    ctx.lineWidth=2; ctx.lineCap="round"; ctx.strokeStyle="#111";
    ctx.lineTo(pos.x,pos.y); ctx.stroke();
    e.preventDefault();
  };
  const endDraw = () => {
    drawing.current=false;
    onChange(canvasRef.current.toDataURL("image/png"));
  };
  const clear = () => {
    const canvas=canvasRef.current; const ctx=canvas.getContext("2d");
    ctx.fillStyle="#fff"; ctx.fillRect(0,0,canvas.width,canvas.height);
    onChange(null);
  };
  const handleUpload = e => {
    const f=e.target.files[0]; if(!f) return;
    const r=new FileReader();
    r.onload=ev=>{
      const img=new Image(); img.onload=()=>{
        const canvas=canvasRef.current; const ctx=canvas.getContext("2d");
        ctx.fillStyle="#fff"; ctx.fillRect(0,0,canvas.width,canvas.height);
        const scale=Math.min(canvas.width/img.width,canvas.height/img.height);
        const w=img.width*scale; const h=img.height*scale;
        ctx.drawImage(img,(canvas.width-w)/2,(canvas.height-h)/2,w,h);
        onChange(canvas.toDataURL("image/png"));
      }; img.src=ev.target.result;
    };
    r.readAsDataURL(f); e.target.value="";
  };
  return (
    <div>
      <div style={{border:"1px solid #E5E7EB",borderRadius:8,overflow:"hidden",background:"#fff",marginBottom:8,touchAction:"none"}}>
        <canvas ref={canvasRef} width={320} height={120}
          style={{display:"block",cursor:"crosshair",width:"100%"}}
          onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw}
          onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={endDraw}/>
      </div>
      <div style={{display:"flex",gap:6}}>
        <button onClick={clear} style={BTN_GRAY}>ล้าง</button>
        <button onClick={()=>fileRef.current?.click()} style={BTN_GRAY}>📁 อัปโหลดรูป</button>
        <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={handleUpload}/>
      </div>
      <div style={{fontSize:10,color:"#9CA3AF",marginTop:4}}>วาดลายเซ็นในกล่องด้านบน หรืออัปโหลดไฟล์รูปภาพ</div>
    </div>
  );
}

// [1] ProfileModal — view/edit profile + signature ────────────────────────────
function ProfileModal({ curUser, onClose, showToast }) {
  const [sig, setSig]   = useState(curUser.signature || null);
  const [name, setName] = useState(curUser.name || "");
  const [saving, setSaving] = useState(false);

  // สร้าง lineCode อัตโนมัติถ้ายังไม่มี
  const lineCode = curUser.lineCode || null;
  const isLineLinked = !!(curUser.lineId);

  const save = async () => {
    setSaving(true);
    try {
      const patch = { name: name.trim() || curUser.name, signature: sig || null };
      // สร้าง lineCode ถ้ายังไม่มี
      if (!curUser.lineCode) {
        patch.lineCode = "TGM-" + Math.random().toString(36).slice(2,6).toUpperCase();
      }
      await patchUser(curUser.id, patch);
      showToast("บันทึกโปรไฟล์แล้ว");
      onClose();
    }
    catch { showToast("บันทึกไม่สำเร็จ", "error"); }
    finally { setSaving(false); }
  };

  // สร้าง lineCode ทันทีถ้าเปิด modal แล้วยังไม่มี
  useEffect(() => {
    if (!curUser.lineCode) {
      const code = "TGM-" + Math.random().toString(36).slice(2,6).toUpperCase();
      patchUser(curUser.id, { lineCode: code }).catch(() => {});
    }
  }, [curUser.id, curUser.lineCode]);

  const displayCode = curUser.lineCode || "กำลังสร้างรหัส...";

  return (
    <div style={{position:"fixed",inset:0,zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,.5)"}}>
      <div style={{background:"#fff",borderRadius:14,padding:24,width:420,boxShadow:"0 20px 60px rgba(0,0,0,.2)",maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}>
          <div style={{fontSize:15,fontWeight:600,color:"#111"}}>โปรไฟล์ของฉัน</div>
          <button onClick={onClose} style={{...BTN_X,fontSize:16}}>✕</button>
        </div>
        <div style={{textAlign:"center",marginBottom:16}}>
          <Avatar userId={curUser.id} users={[curUser]} size={56}/>
          <div style={{fontSize:13,fontWeight:500,color:"#111",marginTop:8}}>{curUser.email}</div>
          <RoleBadge role={curUser.role}/>
        </div>
        <Field label="ชื่อ-สกุล">
          <input value={name} onChange={e=>setName(e.target.value)} style={IS}/>
        </Field>
        <Field label="ลายเซ็น">
          <SignaturePad value={sig} onChange={setSig}/>
        </Field>

        {/* LINE Linking Section */}
        <div style={{background: isLineLinked ? "#F0FDF4" : "#FFFBEB", border:`1px solid ${isLineLinked?"#86EFAC":"#FCD34D"}`,borderRadius:8,padding:"12px 14px",marginBottom:12}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
            <span style={{fontSize:18}}>🟢</span>
            <div style={{fontSize:13,fontWeight:600,color:"#111"}}>เชื่อมต่อ LINE OA</div>
            {isLineLinked && <span style={{fontSize:11,background:"#22C55E",color:"#fff",padding:"2px 8px",borderRadius:10,fontWeight:600}}>✓ เชื่อมต่อแล้ว</span>}
          </div>
          {isLineLinked ? (
            <div style={{fontSize:12,color:"#065F46"}}>✅ LINE ของคุณเชื่อมต่อกับระบบแล้ว จะได้รับแจ้งเตือนผ่าน LINE OA</div>
          ) : (
            <>
              <div style={{fontSize:12,color:"#92400E",marginBottom:8}}>ส่งรหัสด้านล่างนี้ให้ LINE OA เพื่อเชื่อมต่อ:</div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <div style={{flex:1,background:"#FEF3C7",border:"1px dashed #F59E0B",borderRadius:6,padding:"8px 12px",fontFamily:"monospace",fontSize:20,fontWeight:700,color:"#92400E",letterSpacing:2,textAlign:"center"}}>
                  {displayCode}
                </div>
                <button onClick={()=>{navigator.clipboard?.writeText(displayCode);showToast("คัดลอกรหัสแล้ว");}}
                  style={{padding:"8px 10px",background:"#F59E0B",color:"#fff",border:"none",borderRadius:6,fontSize:12,cursor:"pointer",fontWeight:600,flexShrink:0}}>
                  คัดลอก
                </button>
              </div>
              <div style={{fontSize:11,color:"#6B7280",marginTop:8,lineHeight:1.5}}>
                1. Add friend กับ LINE OA ของบริษัท<br/>
                2. ส่งรหัส <strong>{displayCode}</strong> ใน chat<br/>
                3. ระบบจะเชื่อมต่อ LINE ของคุณอัตโนมัติ
              </div>
            </>
          )}
        </div>

        {sig && (
          <div style={{marginBottom:12}}>
            <div style={{fontSize:11,color:"#6B7280",marginBottom:4}}>ตัวอย่างลายเซ็น:</div>
            <img src={sig} alt="sig" style={{maxHeight:60,border:"1px solid #F3F4F6",borderRadius:6,background:"#F9FAFB",padding:4}}/>
          </div>
        )}
        <div style={{display:"flex",gap:8}}>
          <button onClick={save} disabled={saving} style={{...BTN_GOLD,flex:1,padding:"10px",opacity:saving?.7:1}}>{saving?"กำลังบันทึก...":"บันทึก"}</button>
          <button onClick={onClose} style={{flex:1,padding:"10px",background:"#F9FAFB",color:"#6B7280",border:"1px solid #E5E7EB",borderRadius:6,fontSize:12,cursor:"pointer"}}>ยกเลิก</button>
        </div>
      </div>
    </div>
  );
}

// [7] ApprovalTimeline — enhanced status display ────────────────────────────────
function ApprovalTimeline({ memo, users, compact=false }) {
  const levels = memo.workflowLevels || [];
  if (!levels.length) return null;
  return (
    <div>
      {levels.map((lv, li) => {
        const done    = isLevelDone(lv);
        const rej     = isLevelRejected(lv);
        const active  = li===(memo.currentLevel||0) && memo.status==="pending";
        const modeTag = lv.mode==="any" ? "ผู้ใดผู้หนึ่ง" : "ทุกคน";
        return (
          <div key={lv.id||li}>
            {li>0 && <div style={{display:"flex",justifyContent:"center",margin:"4px 0"}}><div style={{width:1,height:12,background:done?"#A7F3D0":"#E5E7EB"}}/></div>}
            <div style={{border:`1px solid ${rej?"#FECACA":done?"#A7F3D0":active?"#FCD34D":"#E5E7EB"}`,borderRadius:8,padding:"8px 10px",background:rej?"#FFF1F1":done?"#F0FDF4":active?"#FFFBEB":"#F9FAFB"}}>
              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:compact?0:6}}>
                <span style={{fontSize:10,fontWeight:600,color:"#9CA3AF"}}>ลำดับที่ {lv.level}</span>
                <span style={{fontSize:10,background:"#F3F4F6",color:"#6B7280",borderRadius:4,padding:"1px 5px"}}>{modeTag}</span>
                {done&&<span style={{fontSize:10,color:"#065F46",fontWeight:600}}>✓ ผ่านแล้ว</span>}
                {rej &&<span style={{fontSize:10,color:"#991B1B",fontWeight:600}}>✗ ปฏิเสธ</span>}
                {active&&!rej&&!done&&<span style={{fontSize:10,color:"#B45309",fontWeight:600}}>● กำลังรอ</span>}
              </div>
              {!compact && (lv.approvers||[]).map((ap,ai)=>{
                const u=users.find(x=>x.id===ap.userId)||{};
                const sc=STATUS_COLOR[ap.status]||STATUS_COLOR.draft;
                return (
                  <div key={ai} style={{display:"flex",alignItems:"center",gap:6,padding:"5px 0",borderTop:ai>0?"1px solid #F3F4F6":"none"}}>
                    {ap.userId ? <Avatar userId={ap.userId} users={users} size={20}/> : <div style={{width:20,height:20,borderRadius:"50%",background:"#F3F4F6",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,color:"#9CA3AF"}}>✉</div>}
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:11,fontWeight:500,color:"#374151",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ap.name||u.name||ap.email||"-"}</div>
                      {ap.email && ap.email!==(u.email||"") && <div style={{fontSize:10,color:"#9CA3AF"}}>{ap.email}</div>}
                    </div>
                    <span style={{background:sc.bg,color:sc.text,border:`1px solid ${sc.border}`,borderRadius:4,padding:"1px 6px",fontSize:10,whiteSpace:"nowrap"}}>{STATUS_LABEL[ap.status]||"รอ"}</span>
                    {ap.proxyByName&&<span style={{fontSize:9,background:"#FFF7ED",color:"#C2410C",border:"1px solid #FED7AA",borderRadius:4,padding:"1px 5px",whiteSpace:"nowrap"}}>แทนโดย {ap.proxyByName}</span>}
                    {ap.signature && <img src={ap.signature} alt="sig" style={{height:24,border:"1px solid #E5E7EB",borderRadius:4,background:"#fff"}}/>}
                  </div>
                );
              })}
              {!compact && (lv.approvers||[]).some(ap=>ap.comment) && (
                <div style={{marginTop:6,paddingTop:6,borderTop:"1px solid #F3F4F6"}}>
                  {(lv.approvers||[]).filter(ap=>ap.comment).map((ap,ai)=>(
                    <div key={ai} style={{fontSize:11,color:"#6B7280",marginBottom:2}}><strong>{ap.name}:</strong> {ap.comment}</div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// compact chain for memo rows
function WorkflowChain({ memo, users }) {
  const levels = memo.workflowLevels || [];
  if (!levels.length) return null;
  return (
    <div style={{display:"flex",alignItems:"center",gap:3,flexWrap:"wrap"}}>
      {levels.map((lv, li) => {
        const done   = isLevelDone(lv);
        const rej    = isLevelRejected(lv);
        const active = li===(memo.currentLevel||0) && memo.status==="pending";
        const names  = (lv.approvers||[]).map(ap=>{ const u=users.find(x=>x.id===ap.userId)||{}; return (ap.name||u.name||"?").split(" ")[0]; }).join(lv.mode==="any"?"/":"+");
        return (
          <div key={li} style={{display:"flex",alignItems:"center",gap:3}}>
            {li>0&&<div style={{width:12,height:1,background:"#E5E7EB"}}/>}
            <div style={{padding:"2px 7px",borderRadius:20,fontSize:11,fontWeight:500,
              background:done?"#ECFDF5":rej?"#FFF1F1":active?"#FFFBEB":"#F9FAFB",
              color:done?"#065F46":rej?"#991B1B":active?"#B45309":"#6B7280",
              border:`1px solid ${done?"#A7F3D0":rej?"#FECACA":active?"#FCD34D":"#E5E7EB"}`}}>
              {done?"✓":rej?"✗":active?"●":"○"} {names}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// [2] SignatureZonesModal — define where signatures should appear in document ──
function SignatureZonesModal({ memo, users, curUser, onSave, onClose }) {
  const [zones, setZones] = useState(memo.signatureZones || []);
  const addZone = () => setZones(p=>[...p, { id:newId("sz"), label:"ลายเซ็น", assignedTo:"", note:"" }]);
  const updZone = (i,k,v) => setZones(p=>p.map((z,j)=>j===i?{...z,[k]:v}:z));
  const remZone = i => setZones(p=>p.filter((_,j)=>j!==i));
  const allUsers = users.filter(u=>u.active);
  return (
    <div style={{position:"fixed",inset:0,zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,.5)"}}>
      <div style={{background:"#fff",borderRadius:14,padding:24,width:480,maxHeight:"85vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,.2)"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
          <div style={{fontSize:15,fontWeight:600,color:"#111"}}>✍ กำหนดจุดลงนาม</div>
          <button onClick={onClose} style={{...BTN_X,fontSize:16}}>✕</button>
        </div>
        <div style={{fontSize:12,color:"#9CA3AF",marginBottom:16}}>กำหนดว่าใครต้องลงนามที่ตำแหน่งใดในเอกสาร Placeholder <code style={{background:"#F0F9FF",padding:"1px 4px",borderRadius:3}}>{"{{sigZone_N}}"}</code> จะถูกแทนใน .docx</div>
        {zones.map((z,i)=>(
          <div key={z.id} style={{display:"grid",gridTemplateColumns:"auto 1fr 1fr auto",gap:8,alignItems:"center",padding:"8px 0",borderBottom:"1px solid #F3F4F6"}}>
            <span style={{fontSize:11,color:"#9CA3AF",fontWeight:600,minWidth:20}}>{i+1}</span>
            <input value={z.label} onChange={e=>updZone(i,"label",e.target.value)} placeholder="ชื่อตำแหน่ง เช่น ผู้สร้าง" style={{...IS,fontSize:12}}/>
            <select value={z.assignedTo} onChange={e=>updZone(i,"assignedTo",e.target.value)} style={{...IS,fontSize:12}}>
              <option value="">-- เลือกผู้ลงนาม --</option>
              <option value={curUser.id}>ฉัน ({curUser.name})</option>
              {(memo.workflowLevels||[]).flatMap(lv=>lv.approvers||[]).map((ap,ai)=>(
                <option key={ai} value={ap.userId||ap.email}>{ap.name||ap.email}</option>
              ))}
              {allUsers.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <button onClick={()=>remZone(i)} style={{...BTN_X,color:"#DC2626"}}>✕</button>
          </div>
        ))}
        <button onClick={addZone} style={{width:"100%",padding:"9px",background:"#F9FAFB",border:"1px dashed #E5E7EB",borderRadius:7,fontSize:12,cursor:"pointer",color:"#374151",marginTop:8}}>+ เพิ่มจุดลงนาม</button>
        <div style={{display:"flex",gap:8,marginTop:16}}>
          <button onClick={()=>onSave(zones)} style={{...BTN_GOLD,flex:1,padding:"10px"}}>บันทึก</button>
          <button onClick={onClose} style={{flex:1,padding:"10px",background:"#F9FAFB",color:"#6B7280",border:"1px solid #E5E7EB",borderRadius:6,fontSize:12,cursor:"pointer"}}>ยกเลิก</button>
        </div>
      </div>
    </div>
  );
}

function MemoRow({ memo, users, onClick, highlight, curUser, onRecall, onEdit }) {
  const creator=users.find(u=>u.id===memo.createdBy)||{}; const isOwn=memo.createdBy===curUser?.id;
  const ackSummary = memo.status === "approved" ? getAckSummary(memo, users) : null;
  return (
    <div onClick={onClick} style={{background:"#fff",border:`1px solid ${highlight?"#FCD34D":"#F3F4F6"}`,borderRadius:8,padding:"10px 14px",marginBottom:6,cursor:"pointer"}}>
      <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
        <Avatar userId={memo.createdBy} users={users} size={28}/>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4,flexWrap:"wrap"}}>
            <span style={{fontSize:13,fontWeight:500,color:"#111",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:260}}>{memo.title}</span>
            <StatusBadge status={memo.status}/>
            <span style={{fontSize:11,color:"#9CA3AF",background:"#F9FAFB",padding:"1px 6px",borderRadius:4,border:"1px solid #F3F4F6"}}>{memo.category}</span>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            <span style={{fontSize:11,color:"#9CA3AF"}}>{creator.name} · {fmtShort(memo.createdAt)}</span>
            {memo.attachments?.length>0&&<span style={{fontSize:11,color:"#9CA3AF"}}>📎 {memo.attachments.length}</span>}
            {memo.signatureZones?.length>0&&<span style={{fontSize:11,color:"#9CA3AF"}}>✍ {memo.signatureZones.length}</span>}
            {isOwn && ackSummary?.total > 0 && (
              <span style={{ fontSize: 11, color: ackSummary.allAcked ? "#065F46" : "#92400E", background: ackSummary.allAcked ? "#ECFDF5" : "#FFFBEB", padding: "1px 6px", borderRadius: 4, border: `1px solid ${ackSummary.allAcked ? "#A7F3D0" : "#FDE68A"}` }}>
                {ackSummary.ackCount}/{ackSummary.total} รับทราบ
              </span>
            )}
            <WorkflowChain memo={memo} users={users}/>
          </div>
        </div>
        {isOwn&&onRecall&&(
          <div style={{display:"flex",gap:4,flexShrink:0}} onClick={e=>e.stopPropagation()}>
            {memo.status==="pending"&&can(curUser.role,"recall")&&<button onClick={()=>onRecall(memo)} style={BTN_GRAY}>เรียกคืน</button>}
            {(memo.status==="draft"||memo.status==="recalled")&&<button onClick={()=>onEdit(memo)} style={{...BTN_GRAY,background:"#EFF6FF",color:"#1D4ED8",border:"1px solid #BFDBFE"}}>แก้ไข</button>}
          </div>
        )}
      </div>
    </div>
  );
}

function ActionModal({ modal, onClose, onApprove, onReject, curUser, isProxy=false, proxyFor=null }) {
  const [comment,      setComment]      = useState("");
  const [lineComments, setLineComments] = useState({}); // { lineIdx: "text" }
  const [showLines,    setShowLines]    = useState(false);
  const [sigMode,      setSigMode]      = useState("saved");
  const [drawnSig,     setDrawnSig]     = useState(null);
  const canvasRef = useRef();
  const drawing   = useRef(false);
  const isA       = modal.type === "approve";
  const now       = new Date();
  const nowTh     = now.toLocaleDateString("th-TH",{weekday:"long",day:"2-digit",month:"long",year:"numeric"})
                  + " " + now.toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit"});

  // Extract text lines from memo content (strip HTML tags for display)
  const rawContent = modal.memo.content || "";
  const contentLines = rawContent.replace(/<[^>]+>/g," ").split("\n").map(l=>l.trim()).filter(l=>l.length>0).slice(0,40);

  const getPos = (e, canvas) => {
    const r = canvas.getBoundingClientRect(); const src = e.touches?.[0] || e;
    return { x:(src.clientX-r.left)*(canvas.width/r.width), y:(src.clientY-r.top)*(canvas.height/r.height) };
  };
  const startDraw = e => { drawing.current=true; const c=canvasRef.current; const ctx=c.getContext("2d"); const p=getPos(e,c); ctx.beginPath(); ctx.moveTo(p.x,p.y); e.preventDefault(); };
  const draw      = e => { if(!drawing.current)return; const c=canvasRef.current; const ctx=c.getContext("2d"); const p=getPos(e,c); ctx.lineWidth=2.2; ctx.lineCap="round"; ctx.strokeStyle="#111"; ctx.lineTo(p.x,p.y); ctx.stroke(); ctx.beginPath(); ctx.moveTo(p.x,p.y); e.preventDefault(); };
  const endDraw   = () => { drawing.current=false; setDrawnSig(canvasRef.current?.toDataURL("image/png")||null); };
  const clearCanvas = () => { const c=canvasRef.current; if(!c)return; c.getContext("2d").clearRect(0,0,c.width,c.height); setDrawnSig(null); };

  const activeSig = sigMode==="draw" ? drawnSig : (curUser.signature||null);
  const activeLineComments = Object.entries(lineComments).filter(([,v])=>v.trim()).reduce((o,[k,v])=>({...o,[k]:v}),{});

  const handleConfirm = () => {
    const sigToUse = activeSig || null;
    const fullComment = [
      comment,
      ...Object.entries(activeLineComments).map(([i,c])=>`[บรรทัด ${+i+1}] ${c}`)
    ].filter(Boolean).join("\n");
    isA ? onApprove(fullComment, sigToUse) : onReject(fullComment);
  };

  return (
    <div style={{position:"fixed",inset:0,zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,.55)"}}>
      <div style={{background:"#fff",border:"1px solid #E5E7EB",borderRadius:14,padding:24,width:480,maxHeight:"92vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,.25)"}}>
        <div style={{fontSize:15,fontWeight:700,marginBottom:2,color:"#111"}}>{isA?"✅ ยืนยันการอนุมัติ":"❌ ยืนยันการปฏิเสธ"}</div>
        <div style={{fontSize:12,color:"#6B7280",marginBottom:4,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{modal.memo.title}</div>
        <div style={{display:"inline-flex",alignItems:"center",gap:5,background:"#F0FDF4",border:"1px solid #A7F3D0",borderRadius:6,padding:"4px 10px",fontSize:11,color:"#065F46",marginBottom:14}}>
          🕐 {nowTh}
        </div>

        {/* Signature */}
        {isA && (
          <div style={{marginBottom:14}}>
            <div style={{fontSize:11,fontWeight:700,color:"#6B7280",marginBottom:6,textTransform:"uppercase",letterSpacing:.4}}>ลายเซ็น</div>
            {curUser.signature && (
              <div style={{display:"flex",gap:4,marginBottom:8}}>
                {[["saved","ใช้ที่บันทึก"],["draw","วาดใหม่"]].map(([k,l])=>(
                  <button key={k} onClick={()=>setSigMode(k)} style={{flex:1,padding:"5px 0",fontSize:11,fontWeight:sigMode===k?600:400,background:sigMode===k?"#111":"#F9FAFB",color:sigMode===k?"#fff":"#6B7280",border:"1px solid #E5E7EB",borderRadius:5,cursor:"pointer"}}>{l}</button>
                ))}
              </div>
            )}
            {sigMode==="saved" && curUser.signature && (
              <div style={{border:"1px solid #E5E7EB",borderRadius:8,padding:8,background:"#FAFAFA",textAlign:"center"}}>
                <img src={curUser.signature} alt="sig" style={{maxHeight:60,maxWidth:"100%",objectFit:"contain"}}/>
              </div>
            )}
            {(sigMode==="draw"||!curUser.signature) && (
              <div>
                <canvas ref={canvasRef} width={420} height={90}
                  style={{border:"1.5px dashed #D1D5DB",borderRadius:8,background:"#fff",cursor:"crosshair",touchAction:"none",width:"100%",display:"block"}}
                  onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw}
                  onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={endDraw}/>
                <div style={{display:"flex",justifyContent:"space-between",marginTop:4}}>
                  <span style={{fontSize:10,color:"#9CA3AF"}}>วาดลายเซ็นในกล่องนี้</span>
                  <button onClick={clearCanvas} style={{fontSize:10,color:"#DC2626",background:"none",border:"none",cursor:"pointer",padding:0}}>ล้าง</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* General comment */}
        <Field label="ความคิดเห็นทั่วไป">
          <textarea value={comment} onChange={e=>setComment(e.target.value)} rows={2} style={{...IS,resize:"none",fontFamily:"inherit"}}/>
        </Field>

        {/* Line-by-line comment toggle */}
        {contentLines.length > 0 && (
          <div style={{marginBottom:12}}>
            <button onClick={()=>setShowLines(p=>!p)}
              style={{fontSize:11,color:"#1D4ED8",background:"none",border:"1px solid #BFDBFE",borderRadius:5,padding:"4px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:5}}>
              💬 {showLines?"ซ่อน":"แสดง"}การ comment รายบรรทัด
              {Object.keys(activeLineComments).length>0&&<span style={{background:"#1D4ED8",color:"#fff",borderRadius:10,fontSize:10,padding:"1px 5px"}}>{Object.keys(activeLineComments).length}</span>}
            </button>
            {showLines && (
              <div style={{marginTop:8,border:"1px solid #E5E7EB",borderRadius:8,overflow:"hidden",maxHeight:260,overflowY:"auto"}}>
                {contentLines.map((line,i)=>(
                  <div key={i} style={{borderBottom:i<contentLines.length-1?"1px solid #F3F4F6":"none",padding:"6px 10px",background:lineComments[i]?"#EFF6FF":"#fff"}}>
                    <div style={{fontSize:11,color:"#374151",marginBottom:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:"100%"}}>
                      <span style={{color:"#9CA3AF",fontSize:10,marginRight:5}}>{i+1}.</span>{line}
                    </div>
                    <input
                      value={lineComments[i]||""}
                      onChange={e=>setLineComments(p=>({...p,[i]:e.target.value}))}
                      placeholder="comment บรรทัดนี้..."
                      style={{width:"100%",fontSize:11,padding:"3px 7px",border:"1px solid #E5E7EB",borderRadius:4,boxSizing:"border-box",fontFamily:"inherit",background:lineComments[i]?"#EFF6FF":"#F9FAFB"}}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={{display:"flex",gap:8,marginTop:4}}>
          <button onClick={handleConfirm} style={{flex:1,padding:10,background:isA?GOLD:"#DC2626",color:isA?BLACK:"#fff",border:"none",borderRadius:6,fontSize:13,fontWeight:600,cursor:"pointer"}}>
            {isA?"✓ อนุมัติ":"✕ ปฏิเสธ"}
          </button>
          <button onClick={onClose} style={{flex:1,padding:10,background:"#F9FAFB",color:"#6B7280",border:"1px solid #E5E7EB",borderRadius:6,fontSize:13,cursor:"pointer"}}>ยกเลิก</button>
        </div>
      </div>
    </div>
  );
}

// ── Route Template Manager ────────────────────────────────────────────────────
// User สร้าง/แก้ไข route template ที่ใช้บ่อย แล้วโหลดเข้า CreateView ได้เลย
function RouteTemplateModal({ users, curUser, routeTemplates, onSave, onClose }) {
  const myRoutes = (routeTemplates||[]).filter(r=>r.createdBy===curUser.id);
  const [editing, setEditing] = useState(null); // null | route object
  const blank = () => ({ id:"rt"+Date.now(), name:"", desc:"", createdBy:curUser.id, levels:[] });

  const saveRoute = async (r) => {
    if(!r.name.trim()){ alert("กรุณาใส่ชื่อ Route"); return; }
    if(!r.levels.length){ alert("กรุณาเพิ่มลำดับอนุมัติอย่างน้อย 1 ลำดับ"); return; }
    const updated = [...(routeTemplates||[]).filter(x=>x.id!==r.id), r];
    await onSave(updated);
    setEditing(null);
  };
  const deleteRoute = async (id) => {
    await onSave((routeTemplates||[]).filter(r=>r.id!==id));
  };

  return (
    <div style={{position:"fixed",inset:0,zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,.6)"}}>
      <div style={{background:"#fff",borderRadius:14,width:600,maxHeight:"90vh",overflowY:"auto",boxShadow:"0 24px 80px rgba(0,0,0,.3)"}}>
        <div style={{padding:"20px 24px 0",borderBottom:"1px solid #F3F4F6",paddingBottom:16}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <div>
              <div style={{fontSize:15,fontWeight:700,color:"#111"}}>🔀 Route การอนุมัติที่ใช้บ่อย</div>
              <div style={{fontSize:12,color:"#9CA3AF",marginTop:2}}>บันทึก workflow ที่ใช้บ่อยไว้ใช้ซ้ำได้ทันที</div>
            </div>
            <button onClick={onClose} style={{background:"none",border:"none",fontSize:18,cursor:"pointer",color:"#9CA3AF"}}>✕</button>
          </div>
        </div>
        <div style={{padding:"16px 24px"}}>
          {myRoutes.length===0 && !editing && (
            <div style={{textAlign:"center",padding:"32px 0",color:"#9CA3AF",fontSize:13,border:"2px dashed #E5E7EB",borderRadius:10,marginBottom:12}}>
              ยังไม่มี Route — กดสร้างใหม่
            </div>
          )}
          {!editing && myRoutes.map(r=>(
            <div key={r.id} style={{border:"1px solid #F3F4F6",borderRadius:10,padding:"12px 14px",marginBottom:8,display:"flex",alignItems:"flex-start",gap:10}}>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:600,color:"#111"}}>{r.name}</div>
                {r.desc&&<div style={{fontSize:11,color:"#9CA3AF",marginTop:1}}>{r.desc}</div>}
                <div style={{display:"flex",gap:4,marginTop:6,flexWrap:"wrap"}}>
                  {(r.levels||[]).map((lv,i)=>(
                    <span key={i} style={{fontSize:10,background:"#F3F4F6",color:"#374151",borderRadius:4,padding:"2px 7px"}}>
                      {i+1}. {(lv.approvers||[]).map(a=>a.name||a.email||"?").join(", ")}
                      {lv.mode==="any"&&" (คนใดคนหนึ่ง)"}
                    </span>
                  ))}
                </div>
              </div>
              <div style={{display:"flex",gap:4,flexShrink:0}}>
                <button onClick={()=>setEditing({...r,levels:r.levels.map(lv=>({...lv,approvers:[...lv.approvers]}))})} style={{...BTN_GRAY,fontSize:11}}>แก้ไข</button>
                <button onClick={()=>deleteRoute(r.id)} style={{padding:"4px 8px",background:"#FFF1F1",color:"#DC2626",border:"1px solid #FECACA",borderRadius:5,fontSize:11,cursor:"pointer"}}>ลบ</button>
              </div>
            </div>
          ))}
          {!editing && (
            <button onClick={()=>setEditing(blank())} style={{width:"100%",padding:"10px",background:"#F9FAFB",color:"#374151",border:"2px dashed #E5E7EB",borderRadius:8,fontSize:12,cursor:"pointer",marginTop:4}}>
              + สร้าง Route ใหม่
            </button>
          )}
          {editing && (
            <RouteEditor route={editing} users={users} curUser={curUser}
              onChange={setEditing} onSave={()=>saveRoute(editing)} onCancel={()=>setEditing(null)}/>
          )}
        </div>
      </div>
    </div>
  );
}

function RouteEditor({ route, users, curUser, onChange, onSave, onCancel }) {
  const up = (k,v) => onChange(p=>({...p,[k]:v}));
  const setLevels = fn => onChange(p=>({...p,levels:typeof fn==="function"?fn(p.levels||[]):fn}));
  const addLevel = () => setLevels(p=>[...p,{id:"lv"+Date.now(),mode:"all",approvers:[]}]);
  const remLevel = i  => setLevels(p=>p.filter((_,j)=>j!==i));
  const addApp   = (li,uid) => {
    const u=users.find(x=>x.id===uid); if(!u) return;
    setLevels(p=>p.map((lv,j)=>j!==li?lv:{...lv,approvers:[...(lv.approvers||[]),{userId:u.id,name:u.name,email:u.email,status:"pending"}]}));
  };
  const remApp = (li,ai) => setLevels(p=>p.map((lv,j)=>j!==li?lv:{...lv,approvers:(lv.approvers||[]).filter((_,k)=>k!==ai)}));

  return (
    <div style={{border:"1px solid #E5E7EB",borderRadius:10,padding:16,background:"#FAFAFA"}}>
      <div style={{fontSize:13,fontWeight:700,color:"#111",marginBottom:12}}>{route.id.startsWith("rt")?"สร้าง Route ใหม่":"แก้ไข Route"}</div>
      <Field label="ชื่อ Route *"><input value={route.name||""} onChange={e=>up("name",e.target.value)} placeholder="เช่น: อนุมัติงบแผนก IT" style={IS}/></Field>
      <Field label="คำอธิบาย"><input value={route.desc||""} onChange={e=>up("desc",e.target.value)} placeholder="รายละเอียดเพิ่มเติม..." style={IS}/></Field>
      <div style={{fontSize:11,fontWeight:600,color:"#6B7280",marginBottom:6,marginTop:4}}>ลำดับการอนุมัติ</div>
      {(route.levels||[]).map((lv,li)=>(
        <div key={lv.id||li} style={{border:"1px solid #E5E7EB",borderRadius:8,padding:10,marginBottom:8,background:"#fff"}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
            <span style={{fontSize:11,fontWeight:600,color:"#374151"}}>ลำดับ {li+1}</span>
            <select value={lv.mode||"all"} onChange={e=>setLevels(p=>p.map((l,j)=>j===li?{...l,mode:e.target.value}:l))}
              style={{fontSize:11,padding:"2px 6px",border:"1px solid #E5E7EB",borderRadius:4,background:"#F9FAFB"}}>
              <option value="all">ทุกคนต้องอนุมัติ</option>
              <option value="any">คนใดคนหนึ่งอนุมัติ</option>
            </select>
            <button onClick={()=>remLevel(li)} style={{marginLeft:"auto",background:"none",border:"none",cursor:"pointer",color:"#DC2626",fontSize:12}}>✕ ลบ</button>
          </div>
          <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:6}}>
            {(lv.approvers||[]).map((ap,ai)=>(
              <span key={ai} style={{fontSize:11,background:"#F3F4F6",borderRadius:4,padding:"2px 8px",display:"inline-flex",alignItems:"center",gap:4,maxWidth:"100%",wordBreak:"break-word",overflowWrap:"anywhere"}}>
                <span style={{display:"inline-block",maxWidth:"calc(100% - 22px)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ap.name||ap.email}</span>
                <button onClick={()=>remApp(li,ai)} style={{background:"none",border:"none",cursor:"pointer",color:"#9CA3AF",fontSize:10,padding:0}}>✕</button>
              </span>
            ))}
          </div>
          <select defaultValue="" onChange={e=>{addApp(li,e.target.value);e.target.value="";}}
            style={{fontSize:11,padding:"4px 8px",border:"1px solid #E5E7EB",borderRadius:5,width:"100%",background:"#F9FAFB"}}>
            <option value="" disabled>+ เพิ่ม</option>
            {users.filter(u=>u.active&&!lv.approvers?.find(a=>a.userId===u.id)).map(u=>(
              <option key={u.id} value={u.id}>{u.name} ({u.dept||"-"})</option>
            ))}
          </select>
        </div>
      ))}
      <button onClick={addLevel} style={{width:"100%",padding:"7px",background:"transparent",border:"1px dashed #D1D5DB",borderRadius:6,fontSize:11,cursor:"pointer",color:"#6B7280",marginBottom:10}}>+ เพิ่มลำดับ</button>
      <div style={{display:"flex",gap:8}}>
        <button onClick={onSave} style={{...BTN_GOLD,flex:1,padding:"9px"}}>💾 บันทึก Route</button>
        <button onClick={onCancel} style={{flex:1,padding:"9px",background:"#F9FAFB",color:"#6B7280",border:"1px solid #E5E7EB",borderRadius:6,fontSize:12,cursor:"pointer"}}>ยกเลิก</button>
      </div>
    </div>
  );
}

function NotifyPanel({ notify, setNotify, users, notifyConfig, curUser }) {
  const [emailIn, setEmailIn] = useState("");
  const emailMap = userByEmailMap(users);
  const addEmail = () => { const e=emailIn.trim(); if(!e||!e.includes("@")||(notify.emailList||[]).includes(e))return; setNotify(p=>({...p,emailList:[...(p.emailList||[]),e]})); setEmailIn(""); };
  const remEmail = e => setNotify(p=>({...p,emailList:(p.emailList||[]).filter(x=>x!==e)}));
  const pickable = users.filter(u=>u.email&&u.active&&!(notify.emailList||[]).includes(u.email));
  const grouped = groupUsersByDept(pickable);
  const channels = [
    {key:"postToTeams",enabled:notifyConfig.teams?.enabled,label:"Microsoft Teams",icon:"🔵"},
    {key:"postToPowerAuto",enabled:notifyConfig.powerauto?.enabled,label:"SharePoint / Power Automate",icon:"🟣"},
    {key:"postToLine",enabled:notifyConfig.line?.enabled,label:"LINE Group",icon:"🟢"},
  ];
  return (
    <Section title="แจ้งเตือนเมื่ออนุมัติครบ">
      <div style={{marginBottom:10}}>
        <div style={{fontSize:11,fontWeight:600,color:"#6B7280",marginBottom:5}}>✉ อีเมล์</div>
        {notifyConfig.email?.enabled ? (<>
          <div style={{display:"flex",alignItems:"center",gap:8,padding:"6px 8px",background:"#ECFDF5",border:"1px solid #A7F3D0",borderRadius:6,marginBottom:6}}>
            <span>✉</span>
            <span style={{flex:1,fontSize:11,color:"#065F46",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
              ผู้สร้างเอกสารจะได้รับอีเมลอัตโนมัติหลังอนุมัติครบ{curUser?.email?` (${curUser.email})`:""}
            </span>
            <span style={{fontSize:10,fontWeight:700,color:"#065F46"}}>AUTO</span>
          </div>
          <div style={FLEX_ROW}>
            <input value={emailIn} onChange={e=>setEmailIn(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addEmail()} placeholder="กรอกอีเมล์..." style={FLEX_INPUT}/>
            <button onClick={addEmail} style={{...BTN_GOLD,padding:"5px 10px",fontSize:11}}>เพิ่ม</button>
          </div>
          <div style={{maxHeight:220,overflowY:"auto",marginBottom:6,marginTop:6,paddingRight:2}}>
            {grouped.map(({ dept, users: deptUsers }) => (
              <div key={dept} style={{marginBottom:8}}>
                <div style={{fontSize:10,fontWeight:700,color:"#9CA3AF",marginBottom:4,paddingBottom:2,borderBottom:"1px solid #F3F4F6"}}>{dept}</div>
                <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                  {deptUsers.map(u=>(
                    <button key={u.id} title={formatUserLabel(u,{withEmail:true})}
                      onClick={()=>setNotify(p=>({...p,emailList:[...(p.emailList||[]),u.email]}))}
                      style={{fontSize:10,padding:"3px 8px",borderRadius:4,background:"#F9FAFB",color:"#374151",border:"1px solid #E5E7EB",cursor:"pointer",maxWidth:"100%",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                      + {formatUserLabel(u,{withDept:false})}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {!grouped.length && <div style={{fontSize:11,color:"#9CA3AF"}}>ไม่มี User ให้เลือกเพิ่ม</div>}
          </div>
          {(notify.emailList||[]).map(e=>{
            const u = emailMap[String(e).toLowerCase()];
            const label = u ? formatUserLabel(u) : e;
            return (
              <div key={e} style={ATT_ROW}>
                <span style={{flexShrink:0}}>✉</span>
                <div style={{flex:1,minWidth:0,overflow:"hidden"}}>
                  <div style={{fontSize:12,color:"#374151",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{label}</div>
                  {u && <div style={{fontSize:10,color:"#9CA3AF",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e}</div>}
                </div>
                <button onClick={()=>remEmail(e)} style={BTN_X}>✕</button>
              </div>
            );
          })}
          {!(notify.emailList||[]).length&&<div style={{fontSize:11,color:"#9CA3AF"}}>ยังไม่มีผู้รับ</div>}
        </>) : <div style={{fontSize:11,color:"#9CA3AF",padding:"4px 8px",background:"#F9FAFB",borderRadius:5}}>ยังไม่ได้ตั้งค่า → ไปที่ ตั้งค่าระบบ</div>}
      </div>
      <div style={{borderTop:"1px solid #F3F4F6",paddingTop:8}}>
        <div style={{fontSize:11,fontWeight:600,color:"#6B7280",marginBottom:6}}>📢 ช่องทางอื่น</div>
        {channels.map(ch=>(
          <div key={ch.key} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 8px",borderRadius:6,background:ch.enabled?"#F9FAFB":"transparent",marginBottom:3,opacity:ch.enabled?1:.4}}>
            <span style={{fontSize:14}}>{ch.icon}</span><span style={{flex:1,fontSize:12}}>{ch.label}</span>
            {ch.enabled?<Toggle value={notify[ch.key]||false} onChange={v=>setNotify(p=>({...p,[ch.key]:v}))}/>:<span style={{fontSize:10,color:"#9CA3AF"}}>ยังไม่ตั้งค่า</span>}
          </div>
        ))}
      </div>
    </Section>
  );
}

// ── DOCX export (same as original) ────────────────────────────────────────────
async function exportMemoDocx(memo, users, template) {
  if (!template?.fileBase64) { alert("Template ยังไม่มีไฟล์ .docx"); return; }
  const creator  = users.find(u=>u.id===memo.createdBy)||{};
  const approvedAt = (memo.workflowLevels||[]).flatMap(lv=>lv.approvers||[]).filter(a=>a.status==="approved").slice(-1)[0]?.actionAt;
  const replacements = {
    "{{docNo}}":memo.docNo||memo.id,"{{title}}":memo.title||"","{{content}}":memo.content||"",
    "{{category}}":memo.category||"","{{createdBy}}":creator.name||"","{{dept}}":creator.dept||"",
    "{{createdAt}}":memo.createdAt?fmtDate(memo.createdAt):"","{{approvedDate}}":approvedAt?fmtDate(approvedAt):"",
    "{{company}}":COMPANY,"{{status}}":"อนุมัติแล้ว",
  };
  // approverN from level-based workflow
  let idx=1;
  (memo.workflowLevels||[]).forEach(lv=>{
    (lv.approvers||[]).forEach(ap=>{
      const u=users.find(x=>x.id===ap.userId)||{};
      replacements[`{{approver${idx}}}`]     = ap.name||u.name||"";
      replacements[`{{approver${idx}Dept}}`] = u.dept||"";
      replacements[`{{approver${idx}Date}}`] = ap.actionAt?fmtDate(ap.actionAt):"";
      replacements[`{{approver${idx}Status}}`] = ap.status==="approved"?"✓ อนุมัติ":ap.status==="rejected"?"✗ ปฏิเสธ":"○ รอ";
      idx++;
    });
  });
  // signature zones — แทรก label และชื่อผู้ลงนาม
  (memo.signatureZones||[]).forEach((z,i)=>{
    const u=users.find(x=>x.id===z.assignedTo)||{};
    replacements[`{{sigZone_${i+1}}}`]        = z.label||`จุดลงนาม ${i+1}`;
    replacements[`{{sigZoneName_${i+1}}}`]    = u.name||z.assignedTo||"";
    // sigDate: วันที่ที่ผู้ลงนามอนุมัติ
    const apStep = (memo.workflowLevels||[]).flatMap(lv=>lv.approvers||[]).find(ap=>ap.userId===z.assignedTo||ap.email===(u.email||""));
    replacements[`{{sigZoneDate_${i+1}}}`]    = apStep?.actionAt ? fmtDate(apStep.actionAt) : "";
  });
  try {
    const bin=atob(template.fileBase64); const buf=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) buf[i]=bin.charCodeAt(i);
    const JSZip=(await import("https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js")).default||window.JSZip;
    const zip=await JSZip.loadAsync(buf.buffer);
    const xmlFiles=["word/document.xml","word/header1.xml","word/header2.xml","word/footer1.xml","word/footer2.xml"].filter(p=>zip.files[p]);
    for(const xmlPath of xmlFiles){
      let xml=await zip.files[xmlPath].async("string");
      xml=xml.replace(/\{\{[^}]*\}\}/g,ph=>replacements[ph]??ph);
      Object.entries(replacements).forEach(([ph,val])=>{
        const safe=val.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
        xml=xml.replace(new RegExp(ph.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),"g"),safe);
      });
      zip.file(xmlPath,xml);
    }
    const outBuf=await zip.generateAsync({type:"blob",mimeType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"});
    const url=URL.createObjectURL(outBuf); const a=document.createElement("a");
    a.href=url; a.download=`${memo.docNo||memo.id}_${(memo.title||"memo").slice(0,30)}.docx`; a.click();
    setTimeout(()=>URL.revokeObjectURL(url),3000);
  } catch(err){ alert("Export ไม่สำเร็จ: "+err.message); }
}

function DocxTemplateManager({ templates, onSave, onClose }) {
  const [list,setList]=useState(Object.values(templates||{})); const [editing,setEditing]=useState(null); const [saving,setSaving]=useState(false);
  const fileRef=useRef();
  const newTpl=()=>setEditing({id:"tpl"+Date.now(),name:"",dept:"ทั่วไป",isDefault:false,fileBase64:null,fileName:null,updatedAt:new Date().toISOString()});
  const handleFile=e=>{const f=e.target.files[0];if(!f)return;if(!f.name.endsWith(".docx")){alert("กรุณาอัพโหลด .docx");return;}const r=new FileReader();r.onload=ev=>{const b64=btoa(new Uint8Array(ev.target.result).reduce((s,b)=>s+String.fromCharCode(b),""));setEditing(p=>({...p,fileBase64:b64,fileName:f.name,updatedAt:new Date().toISOString()}));};r.readAsArrayBuffer(f);e.target.value="";};
  const saveTpl=()=>{if(!editing.name.trim()){alert("กรุณากรอกชื่อ");return;}setList(prev=>{const idx=prev.findIndex(t=>t.id===editing.id);if(idx>=0){const n=[...prev];n[idx]=editing;return n;}return[...prev,editing];});setEditing(null);};
  const delTpl=id=>setList(prev=>prev.filter(t=>t.id!==id));
  const setDefault=id=>setList(prev=>prev.map(t=>({...t,isDefault:t.id===id})));
  const saveAll=async()=>{setSaving(true);const obj=Object.fromEntries(list.map(t=>[t.id,t]));await onSave(obj);setSaving(false);};
  const GUIDE=[["{{docNo}}","เลขที่"],["{{title}}","ชื่อเรื่อง"],["{{content}}","เนื้อหา"],["{{category}}","หมวดหมู่"],["{{createdBy}}","ผู้สร้าง"],["{{dept}}","แผนก"],["{{createdAt}}","วันที่สร้าง"],["{{approvedDate}}","วันที่อนุมัติ"],["{{approver1}}","ผู้อนุมัติ 1"],["{{approver1Date}}","วันอนุมัติ 1"],["{{sigZone_1}}","จุดลงนาม 1"],["{{company}}","ชื่อบริษัท"]];
  return (
    <div style={{position:"fixed",inset:0,zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,.65)"}}>
      <div style={{background:"#fff",borderRadius:14,width:660,maxHeight:"92vh",overflowY:"auto",boxShadow:"0 24px 80px rgba(0,0,0,.3)",display:"flex",flexDirection:"column"}}>
        <div style={{padding:"20px 24px 0",borderBottom:"1px solid #F3F4F6",paddingBottom:16,flexShrink:0}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <div><div style={{fontSize:15,fontWeight:700,color:"#111"}}>📄 จัดการ Template เอกสาร</div><div style={{fontSize:12,color:"#9CA3AF",marginTop:2}}>อัพโหลด .docx แล้วใส่ Placeholder เพื่อดึงข้อมูล Memo อัตโนมัติ</div></div>
            <button onClick={onClose} style={{...BTN_X,fontSize:18,padding:"4px 8px"}}>✕</button>
          </div>
        </div>
        <div style={{padding:"16px 24px",flex:1,overflowY:"auto"}}>
          <div style={{background:"#F0F9FF",border:"1px solid #BAE6FD",borderRadius:8,padding:"10px 14px",marginBottom:16}}>
            <div style={{fontSize:11,fontWeight:700,color:"#0369A1",marginBottom:8}}>📋 Placeholder ที่ใช้ได้</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:"3px 12px"}}>
              {GUIDE.map(([ph,desc])=><div key={ph} style={{display:"flex",gap:4,alignItems:"baseline"}}><code style={{fontSize:10,background:"#E0F2FE",color:"#0369A1",padding:"1px 4px",borderRadius:3,whiteSpace:"nowrap"}}>{ph}</code><span style={{fontSize:10,color:"#6B7280"}}>{desc}</span></div>)}
            </div>
          </div>
          {list.length===0&&<div style={{textAlign:"center",padding:"32px 0",color:"#9CA3AF",fontSize:13,border:"2px dashed #E5E7EB",borderRadius:10}}>ยังไม่มี Template</div>}
          {list.map(t=>(
            <div key={t.id} style={{border:`1px solid ${t.isDefault?"#A7F3D0":"#F3F4F6"}`,borderRadius:10,padding:"12px 14px",marginBottom:8,background:t.isDefault?"#F0FDF4":"#fff",display:"flex",alignItems:"center",gap:12}}>
              <div style={{fontSize:22}}>📄</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}><span style={{fontSize:13,fontWeight:600,color:"#111"}}>{t.name}</span>{t.isDefault&&<span style={{fontSize:10,background:"#ECFDF5",color:"#065F46",border:"1px solid #A7F3D0",borderRadius:4,padding:"1px 6px",fontWeight:600}}>Default</span>}<span style={{fontSize:10,background:"#F9FAFB",color:"#6B7280",border:"1px solid #E5E7EB",borderRadius:4,padding:"1px 6px"}}>{t.dept||"ทุกแผนก"}</span></div>
                <div style={{fontSize:11,color:"#9CA3AF",marginTop:2}}>{t.fileName?`📎 ${t.fileName}`:"⚠ ยังไม่มีไฟล์"}{t.updatedAt&&` · ${fmtShort(t.updatedAt)}`}</div>
              </div>
              <div style={{display:"flex",gap:4,flexShrink:0}}>
                {!t.isDefault&&<button onClick={()=>setDefault(t.id)} style={{...BTN_GRAY,fontSize:10}}>ตั้งเป็น Default</button>}
                <button onClick={()=>setEditing({...t})} style={{...BTN_GRAY,fontSize:11}}>แก้ไข</button>
                <button onClick={()=>delTpl(t.id)} style={{...BTN_X,color:"#DC2626",border:"1px solid #FECACA",borderRadius:5,background:"#FFF1F1",padding:"3px 7px",fontSize:11}}>ลบ</button>
              </div>
            </div>
          ))}
          <button onClick={newTpl} style={{width:"100%",padding:"10px",background:"#F9FAFB",color:"#374151",border:"2px dashed #E5E7EB",borderRadius:8,fontSize:12,cursor:"pointer",marginTop:4}}>+ เพิ่ม Template</button>
        </div>
        <div style={{padding:"14px 24px",borderTop:"1px solid #F3F4F6",display:"flex",gap:8,flexShrink:0}}>
          <button onClick={saveAll} disabled={saving} style={{...BTN_GOLD,flex:1,padding:"10px",opacity:saving?.6:1}}>{saving?"กำลังบันทึก...":"💾 บันทึกทั้งหมด"}</button>
          <button onClick={onClose} style={{flex:1,padding:"10px",background:"#F9FAFB",color:"#6B7280",border:"1px solid #E5E7EB",borderRadius:6,fontSize:12,cursor:"pointer"}}>ปิด</button>
        </div>
      </div>
      {editing&&(
        <div style={{position:"fixed",inset:0,zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,.5)"}}>
          <div style={{background:"#fff",borderRadius:12,padding:24,width:440,boxShadow:"0 20px 60px rgba(0,0,0,.25)"}}>
            <div style={{fontSize:14,fontWeight:700,color:"#111",marginBottom:16}}>{list.find(t=>t.id===editing.id)?"แก้ไข Template":"สร้างใหม่"}</div>
            <Field label="ชื่อ Template *"><input value={editing.name} onChange={e=>setEditing(p=>({...p,name:e.target.value}))} placeholder="เช่น Memo ทั่วไป..." style={IS}/></Field>
            <Field label="แผนก (ว่าง = ทุกแผนก)"><input value={editing.dept||""} onChange={e=>setEditing(p=>({...p,dept:e.target.value}))} style={IS}/></Field>
            <Field label="ไฟล์ .docx">
              <input ref={fileRef} type="file" accept=".docx" style={{display:"none"}} onChange={handleFile}/>
              <div style={{display:"flex",gap:8,alignItems:"center"}}><button onClick={()=>fileRef.current?.click()} style={{...BTN_GRAY,padding:"7px 14px",fontSize:12}}>📁 เลือกไฟล์</button>{editing.fileName?<span style={{fontSize:12,color:"#065F46",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>✓ {editing.fileName}</span>:<span style={{fontSize:12,color:"#9CA3AF"}}>ยังไม่มีไฟล์</span>}</div>
            </Field>
            <div style={{display:"flex",gap:8,marginTop:8}}><button onClick={saveTpl} style={{...BTN_GOLD,flex:1,padding:"10px"}}>บันทึก</button><button onClick={()=>setEditing(null)} style={{flex:1,padding:"10px",background:"#F9FAFB",color:"#6B7280",border:"1px solid #E5E7EB",borderRadius:6,fontSize:12,cursor:"pointer"}}>ยกเลิก</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

function TemplatePicker({ templates, memo, users, onClose }) {
  const creator=users.find(u=>u.id===memo.createdBy)||{};
  const eligible=templates.filter(t=>!t.dept||t.dept===creator.dept||creator.dept?.includes(t.dept));
  return (
    <div style={{position:"fixed",inset:0,zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,.5)"}}>
      <div style={{background:"#fff",borderRadius:12,padding:24,width:400,boxShadow:"0 20px 60px rgba(0,0,0,.2)"}}>
        <div style={{fontSize:14,fontWeight:700,color:"#111",marginBottom:4}}>📄 เลือก Template Export</div>
        <div style={{fontSize:12,color:"#9CA3AF",marginBottom:16}}>เลขที่: <strong style={{color:"#111"}}>{memo.docNo||memo.id}</strong></div>
        {eligible.length===0?<div style={{color:"#9CA3AF",fontSize:13,textAlign:"center",padding:"20px 0"}}>ไม่มี Template สำหรับแผนกนี้</div>
        :eligible.map(t=>(
          <div key={t.id} onClick={()=>{exportMemoDocx(memo,users,t);onClose();}}
            style={{display:"flex",alignItems:"center",gap:10,padding:"11px 14px",border:"1px solid #F3F4F6",borderRadius:8,marginBottom:6,cursor:"pointer",background:"#F9FAFB"}}
            onMouseEnter={e=>e.currentTarget.style.background="#F0F9FF"} onMouseLeave={e=>e.currentTarget.style.background="#F9FAFB"}>
            <span style={{fontSize:20}}>📄</span>
            <div style={{flex:1}}><div style={{fontSize:13,fontWeight:500,color:"#111"}}>{t.name}</div><div style={{fontSize:11,color:"#9CA3AF"}}>{t.dept||"ทุกแผนก"}{t.isDefault?"· Default":""}</div></div>
            <span style={{fontSize:11,color:"#9CA3AF"}}>⬇ Export</span>
          </div>
        ))}
        <button onClick={onClose} style={{width:"100%",marginTop:8,padding:"9px",background:"#F9FAFB",color:"#6B7280",border:"1px solid #E5E7EB",borderRadius:6,fontSize:12,cursor:"pointer"}}>ยกเลิก</button>
      </div>
    </div>
  );
}

// ── Views ─────────────────────────────────────────────────────────────────────
function Dashboard({ memoList, users, curUser, inboxCount, onOpen }) {
  const stats=[
    {l:"ทั้งหมด",v:memoList.length,c:GOLD},
    {l:"รออนุมัติ",v:memoList.filter(m=>m.status==="pending").length,c:"#F59E0B"},
    {l:"อนุมัติแล้ว",v:memoList.filter(m=>m.status==="approved").length,c:"#059669"},
    {l:"รอฉัน",v:inboxCount,c:"#DC2626"},
  ];
  return (
    <div style={{padding:24}}>
      <div style={{marginBottom:20}}>
        <div style={{fontSize:18,fontWeight:600,color:"#111"}}>ภาพรวม</div>
        <div style={{fontSize:13,color:"#6B7280",display:"flex",alignItems:"center",gap:6,marginTop:2}}>สวัสดี {curUser.name} · <RoleBadge role={curUser.role}/></div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:24}}>
        {stats.map(s=><div key={s.l} style={{background:"#fff",border:"1px solid #F3F4F6",borderRadius:10,padding:"14px 16px",borderTop:`3px solid ${s.c}`}}><div style={{fontSize:11,color:"#9CA3AF",marginBottom:6,fontWeight:500}}>{s.l}</div><div style={{fontSize:28,fontWeight:700,color:s.c}}>{s.v}</div></div>)}
      </div>
      <div style={{fontSize:13,fontWeight:600,color:"#374151",marginBottom:10}}>Memo ล่าสุด</div>
      {[...memoList].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,5).map(m=><MemoRow key={m.id} memo={m} users={users} onClick={()=>onOpen(m.id)} curUser={curUser}/>)}
    </div>
  );
}

// Excel export helper
async function exportMemosToExcel(memoList, users) {
  const XLSX = await import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs");
  const fmtD = s => !s?"-":new Date(s).toLocaleDateString("th-TH",{day:"2-digit",month:"2-digit",year:"numeric"});
  const rows = memoList.map(m => {
    const creator = users.find(u=>u.id===m.createdBy)||{};
    const approvals = (m.workflowLevels||[]).flatMap(lv=>lv.approvers||[]);
    const lastAction = approvals.filter(a=>a.actionAt).sort((a,b)=>new Date(b.actionAt)-new Date(a.actionAt))[0];
    return {
      "เลขที่เอกสาร": m.docNo||"-",
      "ชื่อเรื่อง": m.title||"",
      "หมวดหมู่": m.category||"",
      "สถานะ": STATUS_LABEL[m.status]||m.status,
      "ผู้สร้าง": creator.name||"-",
      "แผนก": creator.dept||"-",
      "วันที่สร้าง": fmtD(m.createdAt),
      "ผู้อนุมัติล่าสุด": lastAction ? (users.find(u=>u.id===lastAction.userId)||{}).name||lastAction.email||"-" : "-",
      "วันที่อนุมัติ": lastAction ? fmtD(lastAction.actionAt) : "-",
      "ความคิดเห็น": (approvals.map(a=>a.comment).filter(Boolean).join("; "))||"-",
    };
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  // Column widths
  ws["!cols"] = [14,40,16,14,20,14,14,20,14,30].map(w=>({wch:w}));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Memos");
  XLSX.writeFile(wb, `memo_export_${new Date().toISOString().slice(0,10)}.xlsx`);
}

function MemoListView({ memoList, users, title, subtitle, curUser, onOpen, onRecall, onEdit, highlight, trashMode, onRestore }) {
  const [fStatus,   setFStatus]   = useState("");
  const [fCategory, setFCategory] = useState("");
  const [fDateFrom, setFDateFrom] = useState("");
  const [fDateTo,   setFDateTo]   = useState("");
  const [exporting, setExporting] = useState(false);
  const [sortKey,   setSortKey]   = useState(trashMode ? "deletedAt" : "createdAt");
  const [sortDir,   setSortDir]   = useState("desc"); // "asc" | "desc"

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d==="asc"?"desc":"asc");
    else { setSortKey(key); setSortDir("desc"); }
  };

  const filtered = memoList.filter(m => {
    if (fStatus   && m.status   !== fStatus)   return false;
    if (fCategory && m.category !== fCategory) return false;
    if (fDateFrom && m.createdAt < fDateFrom)  return false;
    if (fDateTo   && m.createdAt > fDateTo+"T23:59:59") return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    let av, bv;
    if (sortKey === "createdAt") { av = a.createdAt||""; bv = b.createdAt||""; }
    else if (sortKey === "title")    { av = (a.title||"").toLowerCase(); bv = (b.title||"").toLowerCase(); }
    else if (sortKey === "status")   { av = a.status||""; bv = b.status||""; }
    else if (sortKey === "category") { av = a.category||""; bv = b.category||""; }
    else if (sortKey === "creator")  { av = (users.find(u=>u.id===a.createdBy)||{}).name||""; bv = (users.find(u=>u.id===b.createdBy)||{}).name||""; av=av.toLowerCase(); bv=bv.toLowerCase(); }
    else if (sortKey === "docNo")    { av = a.docNo||""; bv = b.docNo||""; }
    else if (sortKey === "deletedAt") { av = a.deletedAt||""; bv = b.deletedAt||""; }
    else { av = ""; bv = ""; }
    if (av < bv) return sortDir==="asc" ? -1 : 1;
    if (av > bv) return sortDir==="asc" ? 1 : -1;
    return 0;
  });

  const hasFilter = fStatus||fCategory||fDateFrom||fDateTo;

  const SortHeader = ({ label, col, style={} }) => {
    const active = sortKey === col;
    return (
      <div onClick={()=>toggleSort(col)}
        style={{fontSize:11,fontWeight:600,color:active?"#111":"#9CA3AF",textTransform:"uppercase",letterSpacing:.4,
          cursor:"pointer",userSelect:"none",display:"flex",alignItems:"center",gap:3,...style}}>
        {label}
        <span style={{fontSize:10,color:active?GOLD:"#D1D5DB",lineHeight:1}}>
          {active ? (sortDir==="asc"?"▲":"▼") : "⇅"}
        </span>
      </div>
    );
  };

  const handleExport = async () => {
    setExporting(true);
    try { await exportMemosToExcel(sorted, users); }
    catch(e) { alert("Export ไม่สำเร็จ: "+e.message); }
    finally { setExporting(false); }
  };

  return (
    <div style={{padding:24}}>
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:16,gap:12,flexWrap:"wrap"}}>
        <div>
          <div style={{fontSize:18,fontWeight:600,color:"#111"}}>{title}</div>
          <div style={{fontSize:12,color:"#9CA3AF",marginTop:2}}>
            {hasFilter ? `${sorted.length} / ${memoList.length} รายการ (ตัวกรองอยู่)` : subtitle||sorted.length+" รายการ"}
          </div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <select value={fStatus} onChange={e=>setFStatus(e.target.value)}
            style={{padding:"6px 8px",border:"1px solid #E5E7EB",borderRadius:6,fontSize:12,color:"#374151",background:"#fff"}}>
            <option value="">สถานะทั้งหมด</option>
            {Object.entries(STATUS_LABEL).map(([k,v])=><option key={k} value={k}>{v}</option>)}
          </select>
          <select value={fCategory} onChange={e=>setFCategory(e.target.value)}
            style={{padding:"6px 8px",border:"1px solid #E5E7EB",borderRadius:6,fontSize:12,color:"#374151",background:"#fff"}}>
            <option value="">หมวดหมู่ทั้งหมด</option>
            {BASE_CATEGORIES.map(c=><option key={c}>{c}</option>)}
          </select>
          <input type="date" value={fDateFrom} onChange={e=>setFDateFrom(e.target.value)}
            style={{padding:"6px 8px",border:"1px solid #E5E7EB",borderRadius:6,fontSize:12}}/>
          <input type="date" value={fDateTo} onChange={e=>setFDateTo(e.target.value)}
            style={{padding:"6px 8px",border:"1px solid #E5E7EB",borderRadius:6,fontSize:12}}/>
          {hasFilter && <button onClick={()=>{setFStatus("");setFCategory("");setFDateFrom("");setFDateTo("");}}
            style={{padding:"6px 10px",border:"1px solid #E5E7EB",borderRadius:6,fontSize:11,background:"#F9FAFB",cursor:"pointer",color:"#6B7280"}}>
            ✕ ล้างตัวกรอง
          </button>}
          <button onClick={handleExport} disabled={exporting||trashMode}
            style={{padding:"6px 12px",background:exporting||trashMode?"#9CA3AF":"#16A34A",color:"#fff",border:"none",borderRadius:6,fontSize:12,fontWeight:600,cursor:exporting||trashMode?"not-allowed":"pointer",display:trashMode?"none":"flex",alignItems:"center",gap:4}}>
            {exporting?"กำลัง Export...":"📊 Export Excel"}
          </button>
        </div>
      </div>

      {sorted.length===0 ? <Empty msg={trashMode?"ถังขยะว่าง":"ไม่พบ Memo"}/> : (
        <div style={{background:"#fff",border:"1px solid #F3F4F6",borderRadius:10,overflow:"hidden"}}>
          {/* Sortable header */}
          <div style={{display:"grid",gridTemplateColumns:trashMode?"140px 1fr 110px 100px 120px 110px 90px":"140px 1fr 110px 100px 120px 90px",padding:"9px 14px",background:"#F9FAFB",borderBottom:"1px solid #F3F4F6"}}>
            <SortHeader label="เลขที่เอกสาร" col="docNo"/>
            <SortHeader label="ชื่อเรื่อง"   col="title"/>
            <SortHeader label="หมวดหมู่"     col="category"/>
            <SortHeader label="สถานะ"        col="status"/>
            <SortHeader label="ผู้สร้าง"     col="creator"/>
            <SortHeader label={trashMode?"ลบเมื่อ":"วันที่"} col={trashMode?"deletedAt":"createdAt"}/>
            {trashMode&&<div style={{fontSize:11,fontWeight:600,color:"#9CA3AF",textTransform:"uppercase",letterSpacing:.4}}>กู้คืน</div>}
          </div>
          {sorted.map(m=>{
            const creator=users.find(u=>u.id===m.createdBy)||{};
            const deleter=users.find(u=>u.id===m.deletedBy)||{};
            const sc=STATUS_COLOR[m.status]||STATUS_COLOR.draft;
            const fmtS=s=>!s?"-":new Date(s).toLocaleDateString("th-TH",{day:"2-digit",month:"short",year:"2-digit"});
            return (
              <div key={m.id} onClick={()=>onOpen(m.id)}
                style={{display:"grid",gridTemplateColumns:trashMode?"140px 1fr 110px 100px 120px 110px 90px":"140px 1fr 110px 100px 120px 90px",padding:"9px 14px",borderBottom:"1px solid #F9FAFB",cursor:"pointer",transition:"background .1s",alignItems:"center"}}
                onMouseEnter={e=>e.currentTarget.style.background="#F9FAFB"}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <div style={{fontSize:11,fontFamily:"monospace",color:"#2563EB",fontWeight:500}}>
                  {m.docNo||<span style={{color:"#D1D5DB"}}>—</span>}
                </div>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:500,color:"#111",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",paddingRight:8}}>{m.title}</div>
                  {trashMode&&deleter.name&&<span style={{fontSize:10,color:"#9CA3AF"}}>ลบโดย {deleter.name}</span>}
                  {!trashMode&&m.attachments?.length>0&&<span style={{fontSize:10,color:"#9CA3AF"}}>📎 {m.attachments.length}</span>}
                </div>
                <div style={{fontSize:11,color:"#6B7280"}}>{m.category}</div>
                <div><span style={{background:sc.bg,color:sc.text,border:`1px solid ${sc.border}`,borderRadius:4,padding:"2px 6px",fontSize:11,fontWeight:500,whiteSpace:"nowrap"}}>{STATUS_LABEL[m.status]||m.status}</span></div>
                <div style={{fontSize:12,color:"#374151",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{creator.name||"-"}</div>
                <div style={{fontSize:11,color:"#9CA3AF",whiteSpace:"nowrap"}}>{fmtS(trashMode?m.deletedAt:m.createdAt)}</div>
                {trashMode&&(
                  <button onClick={e=>{e.stopPropagation();onRestore?.(m);}} style={{...BTN_GRAY,padding:"4px 8px",fontSize:11,background:"#ECFDF5",color:"#065F46",border:"1px solid #A7F3D0"}}>↩ กู้คืน</button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SearchView({ memoList, users, curUser, onOpen }) {
  const [q,setQ]=useState(""); const [fS,setFS]=useState(""); const [fC,setFC]=useState(""); const [fF,setFF]=useState(""); const [fT,setFT]=useState(""); const [fA,setFA]=useState(""); const [fCr,setFCr]=useState("");
  const approvers = collectUniqueApprovers(memoList, users);
  const creators = collectUniqueCreators(memoList, users);
  const res=memoList.filter(m=>{
    if(q.trim()){
      const ql=q.toLowerCase();
      if(!m.title?.toLowerCase().includes(ql)&&!m.content?.toLowerCase().includes(ql)&&!getMemoApproverSearchText(m,users).includes(ql)&&!getMemoCreatorSearchText(m,users).includes(ql))return false;
    }
    if(fS&&m.status!==fS)return false; if(fC&&m.category!==fC)return false;
    if(fF&&m.createdAt<fF)return false; if(fT&&m.createdAt>fT+"T23:59:59")return false;
    if(fCr&&m.createdBy!==fCr)return false;
    if(fA){
      const hit=(m.workflowLevels||[]).some(lv=>(lv.approvers||[]).some(ap=>ap.userId===fA||normalizeEmail(ap.email)===normalizeEmail(approvers.find(a=>a.id===fA)?.email)));
      if(!hit)return false;
    }
    return true;
  }).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  const has=q||fS||fC||fF||fT||fA||fCr;
  return (
    <div style={{padding:24}}>
      <div style={{fontSize:18,fontWeight:600,color:"#111",marginBottom:14}}>ค้นหา Memo</div>
      <input value={q} onChange={e=>setQ(e.target.value)} placeholder="ค้นหาชื่อเรื่อง, เนื้อหา, ผู้ส่ง, ผู้อนุมัติ..." style={{...IS,marginBottom:10}}/>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:8,marginBottom:14}}>
        <select value={fS} onChange={e=>setFS(e.target.value)} style={{...IS,width:"auto"}}><option value="">สถานะทั้งหมด</option>{Object.entries(STATUS_LABEL).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>
        <select value={fC} onChange={e=>setFC(e.target.value)} style={{...IS,width:"auto"}}><option value="">หมวดหมู่ทั้งหมด</option>{BASE_CATEGORIES.map(c=><option key={c}>{c}</option>)}</select>
        <select value={fCr} onChange={e=>setFCr(e.target.value)} style={{...IS,width:"auto"}}><option value="">ผู้ส่งทั้งหมด</option>{creators.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select value={fA} onChange={e=>setFA(e.target.value)} style={{...IS,width:"auto"}}><option value="">ผู้อนุมัติทั้งหมด</option>{approvers.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <input type="date" value={fF} onChange={e=>setFF(e.target.value)} style={{...IS,width:"auto"}} title="ตั้งแต่วันที่"/>
        <input type="date" value={fT} onChange={e=>setFT(e.target.value)} style={{...IS,width:"auto"}} title="ถึงวันที่"/>
      </div>
      {has?<><div style={{fontSize:12,color:"#9CA3AF",marginBottom:8}}>พบ {res.length} รายการ</div>{res.map(m=><MemoRow key={m.id} memo={m} users={users} onClick={()=>onOpen(m.id)} curUser={curUser}/>)}{res.length===0&&<Empty msg="ไม่พบผลลัพธ์"/>}</>:<Empty msg="พิมพ์คำค้นหาหรือเลือกตัวกรอง"/>}
    </div>
  );
}

// [3] WorkflowLevelBuilder — levels with any/all + [6] email-based approver ────
function WorkflowLevelBuilder({ levels, setLevels, users, curUser }) {
  const [newEmail, setNewEmail]   = useState({});  // levelIdx → email input
  const [newUserId, setNewUserId] = useState({}); // levelIdx → userId select

  const addLevel = () => setLevels(p=>[...p, { id:newId("lv"), level:p.length+1, mode:"all", approvers:[] }]);
  const remLevel = i => setLevels(p=>p.filter((_,j)=>j!==i).map((lv,j)=>({...lv,level:j+1})));
  const setMode  = (i,mode) => setLevels(p=>p.map((lv,j)=>j===i?{...lv,mode}:lv));
  const moveLevel= (i,d) => setLevels(p=>{const a=[...p];const t=i+d;if(t<0||t>=a.length)return a;[a[i],a[t]]=[a[t],a[i]];return a.map((lv,j)=>({...lv,level:j+1}));});

  const addApproverFromUser = (li) => {
    const uid=newUserId[li]; if(!uid) return;
    if(uid === curUser.id){ alert("ไม่สามารถเพิ่มตัวเองเป็นผู้อนุมัติได้"); return; }
    const u=users.find(x=>x.id===uid)||{};
    setLevels(p=>p.map((lv,j)=>j!==li?lv:{...lv,approvers:[...(lv.approvers||[]),{userId:uid,email:u.email||"",name:u.name||"",status:"pending",comment:"",actionAt:null}]}));
    setNewUserId(p=>({...p,[li]:""}));
  };
  const addApproverFromEmail = (li) => {
    const email=(newEmail[li]||"").trim();
    if(!email||!email.includes("@")) return;
    // ห้ามผู้สร้างอนุมัติตัวเอง
    if(email.toLowerCase() === curUser.email.toLowerCase()){
      alert("ไม่สามารถเพิ่มตัวเองเป็นผู้อนุมัติได้"); return;
    }
    const u=users.find(x=>x.email===email)||{};
    setLevels(p=>p.map((lv,j)=>j!==li?lv:{...lv,approvers:[...(lv.approvers||[]),{userId:u.id||null,email,name:u.name||email,status:"pending",comment:"",actionAt:null}]}));
    setNewEmail(p=>({...p,[li]:""}));
  };
  const remApprover = (li,ai) => setLevels(p=>p.map((lv,j)=>j!==li?lv:{...lv,approvers:(lv.approvers||[]).filter((_,k)=>k!==ai)}));

  const avail = users.filter(u => u.id !== curUser.id && u.active);
  const groupedAvail = groupUsersByDept(avail);

  return (
    <div style={{minWidth:0,maxWidth:"100%"}}>
      {levels.map((lv,li)=>(
        <div key={lv.id||li} style={{border:"1px solid #E5E7EB",borderRadius:8,padding:12,marginBottom:8,background:"#F9FAFB",minWidth:0,overflow:"hidden"}}>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8,flexWrap:"wrap",minWidth:0}}>
            <span style={{fontSize:12,fontWeight:600,color:"#374151",minWidth:52,flexShrink:0}}>ลำดับที่ {lv.level}</span>
            {/* mode toggle */}
            <div style={{display:"flex",gap:0,border:"1px solid #E5E7EB",borderRadius:6,overflow:"hidden",flexShrink:0}}>
              {["all","any"].map(m=>(
                <button key={m} onClick={()=>setMode(li,m)} style={{padding:"3px 10px",fontSize:11,fontWeight:500,background:lv.mode===m?GOLD:"#fff",color:lv.mode===m?BLACK:"#6B7280",border:"none",cursor:"pointer"}}>
                  {m==="all"?"ทุกคน":"ผู้ใดผู้หนึ่ง"}
                </button>
              ))}
            </div>
            <div style={{marginLeft:"auto",display:"flex",gap:4,flexShrink:0}}>
              <button onClick={()=>moveLevel(li,-1)} disabled={li===0} style={{...BTN_X,opacity:li===0?0.3:1}}>↑</button>
              <button onClick={()=>moveLevel(li,1)} disabled={li===levels.length-1} style={{...BTN_X,opacity:li===levels.length-1?0.3:1}}>↓</button>
              <button onClick={()=>remLevel(li)} style={{...BTN_X,color:"#DC2626"}}>✕</button>
            </div>
          </div>
          {/* approvers in this level */}
          {(lv.approvers||[]).map((ap,ai)=>(
            <div key={ai} style={{display:"flex",alignItems:"center",gap:6,padding:"4px 6px",background:"#fff",borderRadius:5,marginBottom:4,border:"1px solid #F3F4F6",minWidth:0}}>
              {ap.userId?<Avatar userId={ap.userId} users={users} size={18}/>:<span style={{fontSize:14,flexShrink:0}}>✉</span>}
              <span style={{flex:1,minWidth:0,fontSize:11,color:"#374151",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={ap.name||ap.email}>{ap.userId ? formatUserLabel(users.find(x=>x.id===ap.userId)||{name:ap.name,email:ap.email}) : (ap.name||ap.email)}</span>
              <button onClick={()=>remApprover(li,ai)} style={{...BTN_X,color:"#DC2626"}}>✕</button>
            </div>
          ))}
          {/* add from user list */}
          <div style={{...FLEX_ROW,marginTop:4}}>
            <select value={newUserId[li]||""} onChange={e=>setNewUserId(p=>({...p,[li]:e.target.value}))} style={{...FLEX_INPUT,fontSize:11,padding:"5px 7px"}}>
              <option value="">เลือก User ในระบบ...</option>
              {groupedAvail.map(({ dept, users: deptUsers }) => (
                <optgroup key={dept} label={dept}>
                  {deptUsers.filter(u=>!(lv.approvers||[]).find(a=>a.userId===u.id)).map(u=>(
                    <option key={u.id} value={u.id}>{formatUserLabel(u)}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button onClick={()=>addApproverFromUser(li)} style={{...BTN_GOLD,padding:"5px 10px",fontSize:11}}>เพิ่ม</button>
          </div>
          {/* [6] add by email */}
          <div style={{...FLEX_ROW,marginTop:4}}>
            <input value={newEmail[li]||""} onChange={e=>setNewEmail(p=>({...p,[li]:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&addApproverFromEmail(li)} placeholder="หรือระบุอีเมล์ภายนอก..." style={{...FLEX_INPUT,fontSize:11,padding:"5px 7px"}}/>
            <button onClick={()=>addApproverFromEmail(li)} style={{...BTN_GRAY,fontSize:11,padding:"5px 8px"}}>+ อีเมล์</button>
          </div>
        </div>
      ))}
      <button onClick={addLevel} style={{width:"100%",padding:"8px",background:"#F9FAFB",border:"1px dashed #D4AF37",borderRadius:7,fontSize:12,cursor:"pointer",color:"#374151",fontWeight:500}}>+ เพิ่มลำดับการอนุมัติ</button>
    </div>
  );
}

// ── RichEditor — paste Excel table + insert image + auto page break ──────────
// ── PdfBlobViewer — converts base64 data URL to Blob URL for iframe ──────────
function PdfBlobViewer({ dataUrl, name, height=600 }) {
  const [blobUrl, setBlobUrl] = useState(null);
  useEffect(() => {
    if (!dataUrl) return;
    try {
      const b64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      setBlobUrl(url);
      return () => URL.revokeObjectURL(url);
    } catch(e) { setBlobUrl(null); }
  }, [dataUrl]);

  if (!blobUrl) return (
    <div style={{padding:24,textAlign:"center",background:"#F9FAFB",borderRadius:8,border:"1px solid #E5E7EB"}}>
      <div style={{fontSize:28,marginBottom:8}}>📄</div>
      <div style={{fontSize:13,fontWeight:500,color:"#374151",marginBottom:4}}>{name}</div>
      <div style={{fontSize:12,color:"#9CA3AF"}}>กำลังเตรียม PDF...</div>
    </div>
  );
  return (
    <div>
      <iframe src={blobUrl} title={name||"pdf"}
        style={{width:"100%",height:height,border:"none",display:"block",borderRadius:4,boxShadow:"0 2px 8px rgba(0,0,0,.08)"}}/>
      <div style={{fontSize:11,color:"#6B7280",textAlign:"center",marginTop:5}}>
        📄 {name} —{" "}
        <a href={blobUrl} download={name} style={{color:"#2563EB",textDecoration:"none"}}>⬇ ดาวน์โหลด</a>
      </div>
    </div>
  );
}

// ── TABLE STYLE injected once ─────────────────────────────────────────────────
const EDITOR_TABLE_STYLE = `
  .rich-ed-wrap [contenteditable] table {
    border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 13px;
  }
  .rich-ed-wrap [contenteditable] table td,
  .rich-ed-wrap [contenteditable] table th {
    border: 1px solid #CBD5E1; padding: 5px 9px; min-width: 80px;
    vertical-align: top; background: #fff;
  }
  .rich-ed-wrap [contenteditable] table th,
  .rich-ed-wrap [contenteditable] table tr:first-child td {
    background: #F1F5F9; font-weight: 600;
  }
  .rich-ed-wrap [contenteditable]:empty:before {
    content: attr(data-placeholder); color: #9CA3AF; pointer-events: none;
  }
  .rich-ed-wrap [contenteditable]:focus { outline: none; }
  /* Print: keep table borders */
  @media print { .rich-ed-wrap table { border-collapse:collapse!important; } }
`;

function RichEditor({ value, onChange }) {
  const editorRef  = useRef();
  const imageRef   = useRef();
  const [showTable, setShowTable] = useState(false);
  const [rows, setRows]   = useState(3);
  const [cols, setCols]   = useState(4);

  // Init: render HTML content (value may contain <table> from paste)
  useEffect(() => {
    if (!editorRef.current) return;
    if (editorRef.current.innerHTML !== (value||"")) {
      editorRef.current.innerHTML = value || "";
    }
  }, []); // only on mount

  // Sync external value changes (e.g. AI content injection) when editor is not focused
  useEffect(() => {
    if (!editorRef.current) return;
    if (document.activeElement === editorRef.current) return;
    if (editorRef.current.innerHTML !== (value||"")) {
      editorRef.current.innerHTML = value || "";
    }
  }, [value]);

  // Save HTML (preserves table structure)
  const handleInput = () => {
    if (editorRef.current) onChange(editorRef.current.innerHTML || "");
  };

  // Paste: keep HTML tables, strip other unsafe tags
  const handlePaste = e => {
    e.preventDefault();
    const html  = e.clipboardData.getData("text/html");
    const plain = e.clipboardData.getData("text/plain");
    if (html && html.includes("<table")) {
      // Clean and insert the HTML table directly
      const tmp = document.createElement("div");
      tmp.innerHTML = html;
      // Remove styles/scripts, keep structure
      tmp.querySelectorAll("style,script,meta,link").forEach(el=>el.remove());
      tmp.querySelectorAll("*").forEach(el=>{
        // Keep only border/width attrs on table cells
        const keep = ["colspan","rowspan"];
        [...el.attributes].forEach(a=>{ if(!keep.includes(a.name)) el.removeAttribute(a.name); });
      });
      // Find the table(s)
      const tables = tmp.querySelectorAll("table");
      if (tables.length) {
        tables.forEach(t => {
          document.execCommand("insertHTML", false, t.outerHTML);
        });
      } else {
        document.execCommand("insertText", false, plain);
      }
    } else {
      // Plain text: preserve line breaks
      const escaped = plain.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\n/g,"<br>");
      document.execCommand("insertHTML", false, escaped);
    }
    onChange(editorRef.current.innerHTML || "");
  };

  // Insert image as <img> tag
  const handleImageFile = e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = ev => {
      document.execCommand("insertHTML", false,
        `<img src="${ev.target.result}" style="max-width:100%;margin:4px 0;border-radius:4px;" alt="${f.name}"/>`
      );
      onChange(editorRef.current.innerHTML || "");
    };
    r.readAsDataURL(f); e.target.value = "";
  };

  // Insert blank HTML table
  const insertTable = () => {
    const thead = `<tr>${Array.from({length:cols},(_,i)=>`<th>คอลัมน์ ${i+1}</th>`).join("")}</tr>`;
    const tbody = Array.from({length:rows},()=>`<tr>${Array(cols).fill("<td>&nbsp;</td>").join("")}</tr>`).join("");
    const tableHtml = `<table><thead>${thead}</thead><tbody>${tbody}</tbody></table><p><br></p>`;
    document.execCommand("insertHTML", false, tableHtml);
    onChange(editorRef.current.innerHTML || "");
    setShowTable(false);
  };

  return (
    <div className="rich-ed-wrap" style={{border:"1px solid #E5E7EB",borderRadius:8,overflow:"hidden"}}>
      <style>{EDITOR_TABLE_STYLE}</style>
      {/* Toolbar */}
      <div style={{display:"flex",gap:6,padding:"6px 10px",background:"#F9FAFB",borderBottom:"1px solid #E5E7EB",flexWrap:"wrap",alignItems:"center"}}>
        <button type="button" onClick={()=>{document.execCommand("bold");editorRef.current?.focus();}}
          style={{padding:"2px 8px",fontSize:12,borderRadius:4,background:"#fff",border:"1px solid #E5E7EB",cursor:"pointer",fontWeight:700}}>B</button>
        <button type="button" onClick={()=>{document.execCommand("italic");editorRef.current?.focus();}}
          style={{padding:"2px 8px",fontSize:12,borderRadius:4,background:"#fff",border:"1px solid #E5E7EB",cursor:"pointer",fontStyle:"italic"}}>I</button>
        <div style={{width:1,height:18,background:"#E5E7EB",margin:"0 2px"}}/>
        <button type="button" onClick={()=>imageRef.current?.click()}
          style={{padding:"2px 8px",fontSize:11,borderRadius:4,background:"#fff",border:"1px solid #E5E7EB",cursor:"pointer",color:"#374151"}}>
          🖼 รูปภาพ
        </button>
        <input ref={imageRef} type="file" accept="image/*" style={{display:"none"}} onChange={handleImageFile}/>
        <div style={{position:"relative"}}>
          <button type="button" onClick={()=>setShowTable(s=>!s)}
            style={{padding:"2px 8px",fontSize:11,borderRadius:4,background:"#fff",border:"1px solid #E5E7EB",cursor:"pointer",color:"#374151"}}>
            📊 ตาราง
          </button>
          {showTable && (
            <div style={{position:"absolute",top:"calc(100% + 4px)",left:0,zIndex:50,background:"#fff",border:"1px solid #E5E7EB",borderRadius:8,padding:12,boxShadow:"0 4px 16px rgba(0,0,0,.12)",whiteSpace:"nowrap"}}>
              <div style={{fontSize:11,color:"#6B7280",marginBottom:8,fontWeight:600}}>สร้างตาราง</div>
              <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:8}}>
                <span style={{fontSize:11}}>แถว</span>
                <input type="number" value={rows} min={1} max={20} onChange={e=>setRows(+e.target.value)}
                  style={{width:50,padding:"4px 6px",border:"1px solid #E5E7EB",borderRadius:5,fontSize:12}}/>
                <span style={{fontSize:11}}>× คอลัมน์</span>
                <input type="number" value={cols} min={1} max={10} onChange={e=>setCols(+e.target.value)}
                  style={{width:50,padding:"4px 6px",border:"1px solid #E5E7EB",borderRadius:5,fontSize:12}}/>
              </div>
              <button type="button" onClick={insertTable}
                style={{width:"100%",padding:"6px",background:"#2563EB",color:"#fff",border:"none",borderRadius:5,fontSize:11,fontWeight:600,cursor:"pointer"}}>
                แทรกตาราง {rows}×{cols}
              </button>
              <button type="button" onClick={()=>setShowTable(false)}
                style={{width:"100%",marginTop:4,padding:"4px",background:"none",border:"none",fontSize:11,color:"#9CA3AF",cursor:"pointer"}}>ยกเลิก</button>
            </div>
          )}
        </div>
        <span style={{fontSize:10,color:"#9CA3AF",marginLeft:"auto"}}>💡 วาง Ctrl+V จาก Excel ได้โดยตรง</span>
      </div>
      {/* Editor */}
      <div ref={editorRef}
        contentEditable suppressContentEditableWarning
        onInput={handleInput} onPaste={handlePaste}
        data-placeholder="กรอกเนื้อหา... วางตารางจาก Excel ได้โดยตรง"
        style={{minHeight:200,padding:"10px 12px",fontSize:13,lineHeight:1.8,fontFamily:"inherit",color:"#111",background:"#fff",cursor:"text"}}
      />
    </div>
  );
}

const AI_STYLES = [
  { key:"formal",    label:"ทางการ",    icon:"🏛",  desc:"ภาษาราชการ เป็นระเบียบ" },
  { key:"concise",   label:"กระชับ",    icon:"⚡",  desc:"สั้น ตรงประเด็น" },
  { key:"detailed",  label:"ละเอียด",   icon:"📋",  desc:"อธิบายครบถ้วน มีเหตุผล" },
  { key:"approval",  label:"ขออนุมัติ", icon:"✅",  desc:"เน้น proposal & ROI" },
  { key:"circular",  label:"แจ้งเวียน", icon:"📢",  desc:"แจ้งให้ทราบทั่วกัน" },
  { key:"report",    label:"รายงานผล",  icon:"📊",  desc:"รายงานความคืบหน้า/ผล" },
];

function AiWriteModal({ title, category, onUse, onClose }) {
  const [brief,   setBrief]   = useState("");
  const [style,   setStyle]   = useState("formal");
  const [loading, setLoading] = useState(false);
  const [result,  setResult]  = useState(null);
  const [err,     setErr]     = useState("");

  const generate = async () => {
    if (!brief.trim()) return;
    setLoading(true); setErr(""); setResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/ai-assist`, {
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ mode:"write", title, category, brief, style }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "เกิดข้อผิดพลาด");
      setResult({ content: data.content, suggestedTitle: data.suggestedTitle || "" });
    } catch(e) { setErr(e.message); }
    finally { setLoading(false); }
  };

  const selectedStyle = AI_STYLES.find(s=>s.key===style);

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{background:"#fff",borderRadius:12,padding:24,width:"100%",maxWidth:620,maxHeight:"88vh",overflow:"auto",boxShadow:"0 20px 60px rgba(0,0,0,.22)"}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16}}>
          <span style={{fontSize:20}}>✨</span>
          <div style={{fontSize:15,fontWeight:600,color:"#111"}}>AI ช่วยเขียน Memo</div>
          <button onClick={onClose} style={{marginLeft:"auto",background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#9CA3AF",lineHeight:1,padding:0}}>✕</button>
        </div>
        <div style={{fontSize:12,color:"#6B7280",marginBottom:14}}>
          ชื่อเรื่อง: <b style={{color:"#111"}}>{title||"(ยังไม่ได้กรอก)"}</b> · หมวด: <b style={{color:"#111"}}>{category}</b>
        </div>

        {/* Style Selector */}
        <label style={{fontSize:11,fontWeight:600,color:"#6B7280",display:"block",marginBottom:6}}>รูปแบบการเขียน</label>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6,marginBottom:14}}>
          {AI_STYLES.map(s=>(
            <button key={s.key} onClick={()=>setStyle(s.key)}
              style={{padding:"8px 6px",borderRadius:7,border:`2px solid ${style===s.key?"#7C3AED":"#E5E7EB"}`,background:style===s.key?"#F5F3FF":"#fff",cursor:"pointer",textAlign:"left",transition:"all .15s"}}>
              <div style={{fontSize:14,marginBottom:2}}>{s.icon}</div>
              <div style={{fontSize:12,fontWeight:600,color:style===s.key?"#7C3AED":"#374151"}}>{s.label}</div>
              <div style={{fontSize:10,color:"#9CA3AF",lineHeight:1.3}}>{s.desc}</div>
            </button>
          ))}
        </div>
        {selectedStyle&&<div style={{fontSize:11,color:"#7C3AED",background:"#F5F3FF",border:"1px solid #DDD6FE",borderRadius:5,padding:"5px 10px",marginBottom:12}}>
          {selectedStyle.icon} รูปแบบ <b>{selectedStyle.label}</b>: {selectedStyle.desc}
        </div>}

        <label style={{fontSize:11,fontWeight:600,color:"#6B7280",display:"block",marginBottom:4}}>บรีฟหัวข้อ / วัตถุประสงค์ *</label>
        <textarea value={brief} onChange={e=>setBrief(e.target.value)} rows={3}
          placeholder="เช่น ขออนุมัติซื้อคอมพิวเตอร์ 5 เครื่อง งบ 150,000 บาท เพื่อทดแทนเครื่องเก่าที่ชำรุด..."
          style={{width:"100%",padding:"9px 10px",border:"1px solid #E5E7EB",borderRadius:6,fontSize:13,fontFamily:"inherit",resize:"vertical",boxSizing:"border-box"}}
        />
        <button onClick={generate} disabled={loading||!brief.trim()}
          style={{marginTop:10,padding:"9px 20px",background:GOLD,color:BLACK,border:"none",borderRadius:6,fontSize:13,fontWeight:600,cursor:loading||!brief.trim()?"not-allowed":"pointer",opacity:loading||!brief.trim()?0.6:1}}>
          {loading?"⏳ กำลังสร้าง...":"✨ สร้างเนื้อหา"}
        </button>
        {err&&<div style={{marginTop:10,fontSize:12,color:"#DC2626",background:"#FFF1F1",padding:"8px 10px",borderRadius:6}}>{err}</div>}
        {result&&(
          <div style={{marginTop:16}}>
            <div style={{fontSize:11,fontWeight:600,color:"#6B7280",textTransform:"uppercase",letterSpacing:.4,marginBottom:6}}>ผลลัพธ์จาก AI</div>
            {result.suggestedTitle&&(
              <div style={{background:"#FFFBEB",border:"1px solid #FDE68A",borderRadius:6,padding:"8px 12px",marginBottom:8,fontSize:13}}>
                <span style={{color:"#92400E",fontWeight:600,fontSize:11}}>ชื่อเรื่องที่แนะนำ: </span>
                <span style={{color:"#111"}}>{result.suggestedTitle}</span>
              </div>
            )}
            <div style={{border:"1px solid #DDD6FE",borderRadius:8,padding:"12px 14px",fontSize:13,lineHeight:1.7,color:"#374151",background:"#FAFAFE",maxHeight:260,overflow:"auto"}}
              dangerouslySetInnerHTML={{__html:result.content}}/>
            <div style={{display:"flex",gap:8,marginTop:10}}>
              <button onClick={()=>{onUse(result.content, result.suggestedTitle);onClose();}} style={{padding:"8px 20px",background:"#059669",color:"#fff",border:"none",borderRadius:6,fontSize:12,fontWeight:600,cursor:"pointer"}}>✓ ใช้เนื้อหานี้</button>
              <button onClick={generate} disabled={loading} style={{padding:"8px 16px",background:"#F9FAFB",color:"#374151",border:"1px solid #E5E7EB",borderRadius:6,fontSize:12,cursor:"pointer"}}>🔄 สร้างใหม่</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AiFeatureUpdateModal({ onClose }) {
  const [tab, setTab] = useState("write");
  const steps = {
    write: [
      { icon: "1", text: 'คลิก “+ สร้าง Memo ใหม่” เพื่อเปิดหน้าสร้าง Memo' },
      { icon: "2", text: "กรอกชื่อเรื่อง และเลือกหมวดหมู่ก่อน (AI จะใช้ข้อมูลนี้)" },
      { icon: "3", text: "กดปุ่ม ✨ AI ช่วยเขียน ที่อยู่เหนือช่องเนื้อหา" },
      { icon: "4", text: "เลือกรูปแบบการเขียน เช่น ทางการ / กระชับ / ขออนุมัติ" },
      { icon: "5", text: "พิมพ์บรีฟสั้นๆ ว่าต้องการเขียนเรื่องอะไร แล้วกด ✨ สร้างเนื้อหา" },
      { icon: "6", text: "ตรวจสอบผลลัพธ์ แล้วกด ✓ ใช้เนื้อหานี้ หรือ 🔄 สร้างใหม่" },
    ],
    summarize: [
      { icon: "1", text: "เปิด Memo ที่ต้องการอ่านโดยคลิกเข้าไปในรายการ" },
      { icon: "2", text: "เลื่อนลงมาใต้เนื้อหา Memo จะเห็นปุ่ม ✨ AI สรุปเอกสาร" },
      { icon: "3", text: "คลิกปุ่มนั้น รอ 2-3 วินาที AI จะวิเคราะห์เนื้อหาให้" },
      { icon: "4", text: "อ่านสาระสำคัญ และ Key Points ที่ AI สรุปไว้" },
      { icon: "5", text: "กด ✕ ปิด AI สรุป เพื่อซ่อนผลลัพธ์เมื่อไม่ต้องการ" },
    ],
  };
  const styles = [
    { key:"formal",   icon:"🏛", label:"ทางการ",    desc:"เหมาะกับหนังสือราชการ และเอกสารสำคัญ" },
    { key:"concise",  icon:"⚡", label:"กระชับ",    desc:"สั้น ตรงประเด็น อ่านง่าย ไม่เยิ่นเย้อ" },
    { key:"detailed", icon:"📋", label:"ละเอียด",   desc:"อธิบายครบถ้วน มีเหตุผลและรายละเอียด" },
    { key:"approval", icon:"✅", label:"ขออนุมัติ", desc:"เน้น proposal ประโยชน์ และ ROI" },
    { key:"circular", icon:"📢", label:"แจ้งเวียน", desc:"แจ้งให้ทราบทั่วกัน รูปแบบประกาศ" },
    { key:"report",   icon:"📊", label:"รายงานผล",  desc:"รายงานความคืบหน้าและผลการดำเนินงาน" },
  ];
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.6)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{background:"#fff",borderRadius:16,width:"100%",maxWidth:680,maxHeight:"92vh",overflow:"auto",boxShadow:"0 24px 80px rgba(0,0,0,.28)",fontFamily:"'Noto Sans Thai','Sarabun',sans-serif"}}>
        {/* Header */}
        <div style={{background:"linear-gradient(135deg,#1E1E2E 0%,#2D1B69 100%)",padding:"24px 28px 20px",borderRadius:"16px 16px 0 0",position:"relative"}}>
          <div style={{position:"absolute",top:14,right:14}}>
            <button onClick={onClose} style={{background:"rgba(255,255,255,.15)",border:"none",color:"#fff",width:30,height:30,borderRadius:"50%",fontSize:16,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",lineHeight:1}}>✕</button>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:10}}>
            <div style={{width:44,height:44,background:GOLD,borderRadius:12,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0}}>✨</div>
            <div>
              <div style={{fontSize:9,fontWeight:600,color:"rgba(255,255,255,.5)",letterSpacing:1.5,textTransform:"uppercase",marginBottom:3}}>อัปเดตฟีเจอร์ใหม่</div>
              <div style={{fontSize:20,fontWeight:700,color:"#fff",lineHeight:1.2}}>AI ช่วยเขียน &amp; สรุป Memo</div>
            </div>
          </div>
          <div style={{fontSize:12,color:"rgba(255,255,255,.65)",lineHeight:1.6,maxWidth:480}}>
            ระบบ E-Memo ได้เพิ่มฟีเจอร์ปัญญาประดิษฐ์ (AI) เพื่อช่วยให้การเขียนและอ่าน Memo ง่ายและรวดเร็วยิ่งขึ้น
          </div>
        </div>

        {/* Tab Switcher */}
        <div style={{display:"flex",borderBottom:"1px solid #F3F4F6",background:"#FAFAFA"}}>
          {[
            { k:"write",     label:"✨ AI ช่วยเขียน",   badge:"ใหม่" },
            { k:"summarize", label:"✨ AI สรุปเอกสาร",  badge:"ใหม่" },
          ].map(t=>(
            <button key={t.k} onClick={()=>setTab(t.k)}
              style={{flex:1,padding:"14px 16px",background:"transparent",border:"none",borderBottom:tab===t.k?`3px solid #7C3AED`:"3px solid transparent",
                color:tab===t.k?"#7C3AED":"#6B7280",fontWeight:tab===t.k?700:400,fontSize:13,cursor:"pointer",
                fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:6,transition:"all .15s"}}>
              {t.label}
              <span style={{background:tab===t.k?"#7C3AED":"#E5E7EB",color:tab===t.k?"#fff":"#9CA3AF",borderRadius:10,fontSize:9,padding:"1px 6px",fontWeight:700}}>{t.badge}</span>
            </button>
          ))}
        </div>

        <div style={{padding:"22px 28px"}}>
          {tab==="write" && (
            <div>
              {/* Feature Card */}
              <div style={{background:"#F5F3FF",border:"1px solid #DDD6FE",borderRadius:10,padding:"14px 18px",marginBottom:18,display:"flex",gap:12,alignItems:"flex-start"}}>
                <div style={{fontSize:28,flexShrink:0,marginTop:2}}>✍️</div>
                <div>
                  <div style={{fontSize:14,fontWeight:700,color:"#5B21B6",marginBottom:4}}>AI ช่วยเขียน Memo</div>
                  <div style={{fontSize:12,color:"#6B7280",lineHeight:1.7}}>
                    เพียงบอกหัวข้อและวัตถุประสงค์คร่าวๆ AI จะสร้างเนื้อหา Memo ที่สมบูรณ์ให้ทันที
                    พร้อมแนะนำชื่อเรื่องที่เหมาะสม
                  </div>
                </div>
              </div>

              {/* Step by step */}
              <div style={{fontSize:12,fontWeight:700,color:"#374151",marginBottom:10}}>วิธีใช้งาน</div>
              <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:20}}>
                {steps.write.map((s,i)=>(
                  <div key={i} style={{display:"flex",gap:10,alignItems:"flex-start"}}>
                    <div style={{width:22,height:22,background:"#7C3AED",color:"#fff",borderRadius:"50%",fontSize:11,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:1}}>{s.icon}</div>
                    <div style={{fontSize:12,color:"#374151",lineHeight:1.6,paddingTop:2}}>{s.text}</div>
                  </div>
                ))}
              </div>

              {/* Writing Styles */}
              <div style={{fontSize:12,fontWeight:700,color:"#374151",marginBottom:8}}>รูปแบบการเขียนที่รองรับ</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:18}}>
                {styles.map(s=>(
                  <div key={s.key} style={{background:"#FAFAFA",border:"1px solid #E5E7EB",borderRadius:8,padding:"10px 12px"}}>
                    <div style={{fontSize:18,marginBottom:4}}>{s.icon}</div>
                    <div style={{fontSize:12,fontWeight:600,color:"#374151",marginBottom:2}}>{s.label}</div>
                    <div style={{fontSize:10,color:"#9CA3AF",lineHeight:1.4}}>{s.desc}</div>
                  </div>
                ))}
              </div>

              {/* Tip */}
              <div style={{background:"#FFFBEB",border:"1px solid #FDE68A",borderRadius:8,padding:"10px 14px",display:"flex",gap:8,alignItems:"flex-start"}}>
                <span style={{fontSize:14,flexShrink:0}}>💡</span>
                <div style={{fontSize:11,color:"#92400E",lineHeight:1.6}}>
                  <strong>เคล็ดลับ:</strong> กรอกชื่อเรื่องและเลือกหมวดหมู่ก่อนกด AI จะได้ผลลัพธ์ที่ตรงกับความต้องการมากขึ้น
                  หากผลลัพธ์ยังไม่ถูกใจ สามารถกด 🔄 สร้างใหม่ได้เลย
                </div>
              </div>
            </div>
          )}

          {tab==="summarize" && (
            <div>
              {/* Feature Card */}
              <div style={{background:"#F5F3FF",border:"1px solid #DDD6FE",borderRadius:10,padding:"14px 18px",marginBottom:18,display:"flex",gap:12,alignItems:"flex-start"}}>
                <div style={{fontSize:28,flexShrink:0,marginTop:2}}>📖</div>
                <div>
                  <div style={{fontSize:14,fontWeight:700,color:"#5B21B6",marginBottom:4}}>AI สรุปเอกสาร</div>
                  <div style={{fontSize:12,color:"#6B7280",lineHeight:1.7}}>
                    เปิด Memo ยาวๆ แล้วไม่อยากอ่านทั้งหมด? AI จะอ่านแทนและสรุปสาระสำคัญ
                    พร้อม Key Points ที่ต้องรู้ให้ภายในไม่กี่วินาที
                  </div>
                </div>
              </div>

              {/* Step by step */}
              <div style={{fontSize:12,fontWeight:700,color:"#374151",marginBottom:10}}>วิธีใช้งาน</div>
              <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:20}}>
                {steps.summarize.map((s,i)=>(
                  <div key={i} style={{display:"flex",gap:10,alignItems:"flex-start"}}>
                    <div style={{width:22,height:22,background:"#7C3AED",color:"#fff",borderRadius:"50%",fontSize:11,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:1}}>{s.icon}</div>
                    <div style={{fontSize:12,color:"#374151",lineHeight:1.6,paddingTop:2}}>{s.text}</div>
                  </div>
                ))}
              </div>

              {/* Output preview */}
              <div style={{fontSize:12,fontWeight:700,color:"#374151",marginBottom:8}}>ผลลัพธ์ที่ได้จาก AI สรุป</div>
              <div style={{border:"1px solid #DDD6FE",borderRadius:8,overflow:"hidden",marginBottom:18}}>
                <div style={{background:"#7C3AED",color:"#fff",padding:"8px 14px",fontSize:11,fontWeight:600}}>✨ AI สรุปเอกสาร (ตัวอย่าง)</div>
                <div style={{padding:"12px 14px"}}>
                  <div style={{marginBottom:10}}>
                    <div style={{fontSize:10,fontWeight:700,color:"#6B7280",textTransform:"uppercase",letterSpacing:.5,marginBottom:4}}>สาระสำคัญ</div>
                    <div style={{fontSize:12,color:"#374151",lineHeight:1.6,fontStyle:"italic"}}>เอกสารนี้มีวัตถุประสงค์เพื่อ... [AI จะเขียนให้อัตโนมัติ]</div>
                  </div>
                  <div>
                    <div style={{fontSize:10,fontWeight:700,color:"#6B7280",textTransform:"uppercase",letterSpacing:.5,marginBottom:6}}>ประเด็นสำคัญ</div>
                    {["• ประเด็นที่ 1 ที่ต้องทราบ","• ประเด็นที่ 2 ที่ต้องทราบ","• ประเด็นที่ 3 ที่ต้องทราบ"].map((p,i)=>(
                      <div key={i} style={{fontSize:12,color:"#374151",padding:"3px 0",lineHeight:1.5,fontStyle:"italic"}}>{p}</div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Tip */}
              <div style={{background:"#FFFBEB",border:"1px solid #FDE68A",borderRadius:8,padding:"10px 14px",display:"flex",gap:8,alignItems:"flex-start"}}>
                <span style={{fontSize:14,flexShrink:0}}>💡</span>
                <div style={{fontSize:11,color:"#92400E",lineHeight:1.6}}>
                  <strong>เคล็ดลับ:</strong> ฟีเจอร์นี้เหมาะที่สุดกับ Memo ที่มีเนื้อหายาว หรือเมื่อต้องการอ่านภาพรวมก่อนอนุมัติ
                  ผลลัพธ์จะแม่นยำขึ้นเมื่อ Memo มีเนื้อหาที่ชัดเจน
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{padding:"16px 28px 22px",borderTop:"1px solid #F3F4F6",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
          <div style={{fontSize:11,color:"#9CA3AF"}}>ฟีเจอร์นี้ใช้ได้กับผู้ใช้ทุกระดับ — อัปเดตเมื่อ พ.ค. 2568</div>
          <button onClick={onClose}
            style={{padding:"10px 28px",background:GOLD,color:BLACK,border:"none",borderRadius:8,fontSize:13,fontWeight:700,cursor:"pointer",letterSpacing:.3}}>
            เข้าใจแล้ว เริ่มใช้งาน →
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateView({ editMemo, setEditMemo, users, curUser, notifyConfig, routeTemplates, onSubmit, onCancel, isRecall, onOpenSigZones, syncing }) {
  const fileRef      = useRef();
  const memoFileRef  = useRef();
  const [showPreview, setShowPreview] = useState(false);
  const [showAiWrite, setShowAiWrite] = useState(false);
  const [memoMode,    setMemoMode]    = useState(editMemo.uploadedFile ? "upload" : "type"); // "type"|"upload"
  const update   = (k,v) => setEditMemo(p=>({...p,[k]:v}));
  const setNotify= fn    => setEditMemo(p=>({...p,notify:typeof fn==="function"?fn(p.notify||{}):fn}));

  const handleFile = ev => {
    const f=ev.target.files[0]; if(!f) return;
    const r=new FileReader();
    r.onload=e=>{const att={id:newId("a"),name:f.name,size:f.size>1024*1024?(f.size/1024/1024).toFixed(1)+" MB":Math.round(f.size/1024)+" KB",type:f.name.split(".").pop().toLowerCase(),data:e.target.result};setEditMemo(p=>({...p,attachments:[...(p.attachments||[]),att]}));};
    r.readAsDataURL(f); ev.target.value="";
  };

  // Upload the main memo document (PDF/Word)
  const handleMemoFile = ev => {
    const f = ev.target.files[0]; if(!f) return;
    const allowed = ["pdf","doc","docx","png","jpg","jpeg"];
    const ext = f.name.split(".").pop().toLowerCase();
    if(!allowed.includes(ext)){ alert("รองรับ PDF, Word (.doc/.docx), หรือรูปภาพเท่านั้น"); return; }
    const r = new FileReader();
    r.onload = e => {
      setEditMemo(p=>({...p,
        uploadedFile: { name:f.name, size:f.size>1024*1024?(f.size/1024/1024).toFixed(1)+" MB":Math.round(f.size/1024)+" KB", type:ext, data:e.target.result },
        content: p.content || `[แนบไฟล์: ${f.name}]`,
      }));
    };
    r.readAsDataURL(f); ev.target.value="";
  };

  const levels    = editMemo.workflowLevels || [];
  const setLevels = fn => setEditMemo(p=>({...p,workflowLevels:typeof fn==="function"?fn(p.workflowLevels||[]):fn}));

  return (
    <div style={{padding:24,minWidth:0,overflow:"hidden",boxSizing:"border-box"}}>
      {showPreview && (
        <ErrorBoundary>
          <MemoPDFPreview memo={editMemo} users={users} curUser={curUser}
            onSaveZones={zones=>{ setEditMemo(p=>({...p,signatureZones:zones})); setShowPreview(false); }}
            onClose={()=>setShowPreview(false)}
          />
        </ErrorBoundary>
      )}
      {showAiWrite && (
        <AiWriteModal
          title={editMemo.title} category={editMemo.category||"ทั่วไป"}
          onUse={(html, suggestedTitle)=>{ update("content",html); if(suggestedTitle) update("title",suggestedTitle); }}
          onClose={()=>setShowAiWrite(false)}
        />
      )}
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:20}}>
        <button onClick={onCancel} style={{background:"none",border:"none",cursor:"pointer",fontSize:20,color:"#9CA3AF",padding:0,lineHeight:1}}>←</button>
        <div style={{fontSize:18,fontWeight:600,color:"#111"}}>{editMemo.id?(isRecall?"แก้ไข Memo (เรียกคืน)":"แก้ไข Memo"):"สร้าง Memo ใหม่"}</div>
        <button onClick={()=>setShowPreview(true)} style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:6,padding:"7px 14px",background:"#1D4ED8",color:"#fff",border:"none",borderRadius:6,fontSize:12,fontWeight:600,cursor:"pointer"}}>
          👁 ตัวอย่าง / PDF
        </button>
      </div>
      <div className="two-col create-layout">
        <div style={{minWidth:0}}>
          <Section>
            <Field label="ชื่อเรื่อง *"><input value={editMemo.title||""} onChange={e=>update("title",e.target.value)} placeholder="กรอกชื่อเรื่อง..." style={IS}/></Field>
            <Field label="หมวดหมู่"><CategoryField value={editMemo.category||"ทั่วไป"} onChange={v=>update("category",v)}/></Field>

            {/* Mode toggle */}
            <div style={{display:"flex",gap:4,marginBottom:10,background:"#F9FAFB",borderRadius:8,padding:3,border:"1px solid #F3F4F6"}}>
              {[["type","✏ พิมพ์เนื้อหา"],["upload","📤 Upload ไฟล์เอกสาร"]].map(([k,l])=>(
                <button key={k} onClick={()=>setMemoMode(k)} style={{flex:1,padding:"7px 0",fontSize:12,fontWeight:memoMode===k?600:400,background:memoMode===k?"#fff":"transparent",color:memoMode===k?"#111":"#9CA3AF",border:memoMode===k?"1px solid #E5E7EB":"1px solid transparent",borderRadius:6,cursor:"pointer",transition:"all .15s"}}>{l}</button>
              ))}
            </div>

            {memoMode==="type" ? (
              <div style={{marginBottom:10}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:3}}>
                  <label style={{fontSize:11,fontWeight:600,color:"#6B7280"}}>เนื้อหา</label>
                  <button onClick={()=>setShowAiWrite(true)} style={{display:"flex",alignItems:"center",gap:4,padding:"4px 11px",background:"#F5F3FF",color:"#7C3AED",border:"1px solid #DDD6FE",borderRadius:5,fontSize:11,fontWeight:600,cursor:"pointer"}}>✨ AI ช่วยเขียน</button>
                </div>
                <RichEditor value={editMemo.content||""} onChange={v=>update("content",v)}/>
              </div>
            ) : (
              <div>
                <input ref={memoFileRef} type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" style={{display:"none"}} onChange={handleMemoFile}/>
                {editMemo.uploadedFile ? (
                  <div style={{border:"1px solid #A7F3D0",borderRadius:8,padding:"12px 14px",background:"#ECFDF5",display:"flex",alignItems:"center",gap:10}}>
                    <span style={{fontSize:24}}>{editMemo.uploadedFile.type==="pdf"?"📄":editMemo.uploadedFile.type==="docx"||editMemo.uploadedFile.type==="doc"?"📝":"🖼"}</span>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:600,color:"#065F46",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{editMemo.uploadedFile.name}</div>
                      <div style={{fontSize:11,color:"#9CA3AF"}}>{editMemo.uploadedFile.size}</div>
                    </div>
                    <button onClick={()=>{ update("uploadedFile",null); }} style={{...BTN_X,color:"#DC2626",border:"1px solid #FECACA",borderRadius:5,background:"#FFF1F1",padding:"3px 7px"}}>✕</button>
                  </div>
                ) : (
                  <div onClick={()=>memoFileRef.current?.click()} style={{border:"2px dashed #E5E7EB",borderRadius:8,padding:"32px 16px",textAlign:"center",cursor:"pointer",background:"#FAFAFA"}}
                    onDragOver={e=>{e.preventDefault();e.currentTarget.style.borderColor=GOLD;}}
                    onDragLeave={e=>e.currentTarget.style.borderColor="#E5E7EB"}
                    onDrop={e=>{ e.preventDefault(); e.currentTarget.style.borderColor="#E5E7EB"; const f=e.dataTransfer.files[0]; if(f){const fakeEv={target:{files:[f],value:""}};handleMemoFile(fakeEv);} }}>
                    <div style={{fontSize:28,marginBottom:6}}>📤</div>
                    <div style={{fontSize:13,fontWeight:500,color:"#374151"}}>คลิกหรือลากไฟล์มาวาง</div>
                    <div style={{fontSize:11,color:"#9CA3AF",marginTop:2}}>PDF, Word (.doc/.docx), หรือรูปภาพ</div>
                  </div>
                )}
                {/* ยังพิมพ์ note เพิ่มได้ */}
                <Field label="หมายเหตุ (ถ้ามี)">
                  <textarea value={editMemo.content||""} onChange={e=>update("content",e.target.value)} rows={3} placeholder="หมายเหตุเพิ่มเติม..." style={{...IS,resize:"none",fontFamily:"inherit"}}/>
                </Field>
              </div>
            )}
          </Section>

          <Section title="เอกสารแนบ" extra={<button onClick={()=>fileRef.current?.click()} style={BTN_GRAY}>+ แนบไฟล์</button>}>
            <input ref={fileRef} type="file" style={{display:"none"}} onChange={handleFile}/>
            {(editMemo.attachments||[]).map(a=>(
              <div key={a.id} style={ATT_ROW}><span>📎</span><span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.name}</span><span style={{color:"#9CA3AF"}}>{a.size}</span><button onClick={()=>setEditMemo(p=>({...p,attachments:p.attachments.filter(x=>x.id!==a.id)}))} style={BTN_X}>✕</button></div>
            ))}
            {!(editMemo.attachments||[]).length&&<div style={{fontSize:12,color:"#9CA3AF",textAlign:"center",padding:"4px 0"}}>ยังไม่มีเอกสารแนบ</div>}
          </Section>
          {editMemo.id && (
            <button onClick={onOpenSigZones} style={{...BTN_GRAY,width:"100%",padding:"9px",marginBottom:12,textAlign:"center"}}>
              ✍ กำหนดจุดลงนาม {editMemo.signatureZones?.length?`(${editMemo.signatureZones.length} จุด)`:""}
            </button>
          )}
        </div>
        <div className="create-sidebar">
          <Section title="ขั้นตอนการอนุมัติ">
            {/* Route Template Picker */}
            {(routeTemplates||[]).filter(r=>r.createdBy===curUser.id).length > 0 && (
              <div style={{marginBottom:8}}>
                <div style={{fontSize:10,color:"#9CA3AF",marginBottom:4}}>โหลดจาก Route ที่บันทึกไว้:</div>
                <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                  {(routeTemplates||[]).filter(r=>r.createdBy===curUser.id).map(r=>(
                    <button key={r.id} onClick={()=>{
                      const lvs = (r.levels||[]).map(lv=>({...lv,id:"lv"+Date.now()+Math.random(),approvers:(lv.approvers||[]).map(ap=>({...ap,status:"pending",comment:"",actionAt:null}))}));
                      setLevels(lvs);
                    }} style={{fontSize:11,padding:"3px 10px",background:"#F5F3FF",color:"#7C3AED",border:"1px solid #DDD6FE",borderRadius:5,cursor:"pointer"}}>
                      🔀 {r.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <WorkflowLevelBuilder levels={levels} setLevels={setLevels} users={users} curUser={curUser}/>
          </Section>
          <NotifyPanel notify={editMemo.notify||{emailList:[],postToTeams:false,postToPowerAuto:false,postToLine:false}} setNotify={setNotify} users={users} notifyConfig={notifyConfig} curUser={curUser}/>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            <button onClick={()=>!syncing&&onSubmit(false)} disabled={syncing} style={{...BTN_GOLD,width:"100%",padding:"11px",fontSize:13,opacity:syncing?0.6:1}}>{syncing?"กำลังส่ง...":(isRecall?"ส่งกลับเพื่ออนุมัติ":"ส่งเพื่ออนุมัติ")}</button>
            <button onClick={()=>!syncing&&onSubmit(true)}  disabled={syncing} style={{padding:"11px",background:"#F9FAFB",color:"#6B7280",border:"1px solid #E5E7EB",borderRadius:6,fontSize:12,cursor:"pointer",opacity:syncing?0.6:1}}>บันทึกร่าง</button>
            <button onClick={()=>setShowPreview(true)} style={{padding:"11px",background:"#EFF6FF",color:"#1E40AF",border:"1px solid #BFDBFE",borderRadius:6,fontSize:12,fontWeight:500,cursor:"pointer"}}>👁 ดูตัวอย่าง / กำหนดจุดลงนาม / โหลด PDF</button>
            <button onClick={onCancel} style={{padding:"11px",background:"none",color:"#9CA3AF",border:"none",borderRadius:6,fontSize:12,cursor:"pointer"}}>ยกเลิก</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailView({ memo, users, curUser, notifyConfig, pdfTemplates, onBack, onRecall, onEdit, onAddFile, onRemoveFile, setModal, onCloneMemo, onApproverAddLevel, onAcknowledge, onDelete, onRestore }) {
  const fileRef   = useRef();
  const [showPicker,   setShowPicker]   = useState(false);
  const [showAddLevel, setShowAddLevel] = useState(false);
  const [newLvUsers,   setNewLvUsers]   = useState([]);
  const [newLvMode,    setNewLvMode]    = useState("all");
  const [aiSummary,    setAiSummary]    = useState(null);
  const [aiSumLoading, setAiSumLoading] = useState(false);
  const isCreator = memo.createdBy===curUser.id;

  const handleAiSummarize = async () => {
    if (aiSummary) { setAiSummary(null); return; }
    setAiSumLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/ai-assist`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ mode:"summarize", title:memo.title, content:memo.content||"" }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "เกิดข้อผิดพลาด");
      setAiSummary(d);
    } catch(e) { alert("AI สรุปไม่สำเร็จ: "+e.message); }
    finally { setAiSumLoading(false); }
  };

  // [3][7] find if current user can approve in the active level
  const activeLevel    = getActiveLevel(memo);
  const myStep         = activeLevel?.approvers?.find(ap=>(ap.userId&&ap.userId===curUser.id)||(ap.email&&ap.email===curUser.email));
  const isSuperAdmin   = curUser.role === "superadmin";
  const isDeleted      = isMemoDeleted(memo);
  const deleter        = users.find(u => u.id === memo.deletedBy) || {};
  // Superadmin can approve on behalf of any pending approver in the active level
  const canApproveOwn  = !isDeleted && memo.status==="pending" && !!myStep && myStep.status==="pending" && can(curUser.role,"approve");
  const canApproveProxy= !isDeleted && memo.status==="pending" && isSuperAdmin &&
    (activeLevel?.approvers||[]).some(ap=>ap.status==="pending") && !canApproveOwn;
  const canApprove     = canApproveOwn || canApproveProxy;

  const ALABEL={created:"สร้าง",submitted:"ส่งอนุมัติ",approved:"อนุมัติ",rejected:"ปฏิเสธ",recalled:"เรียกคืน",edited:"แก้ไข",resubmitted:"ส่งกลับ",addedLevel:"เพิ่มลำดับ",deleted:"ลบ",restored:"กู้คืน",acknowledged:"รับทราบ"};
  const fmtHistAction = (h) => h.proxyFor ? `อนุมัติแทน ${h.proxyFor}` : (ALABEL[h.action]||h.action);
  const ACOLOR={approved:"#065F46",rejected:"#991B1B",recalled:"#1E40AF",submitted:"#B45309",addedLevel:"#7C3AED",deleted:"#991B1B",restored:"#065F46",acknowledged:"#065F46"};
  const handleFile=e=>{const f=e.target.files[0];if(f)onAddFile(f);e.target.value="";};
  const notify=memo.notify||{};
  const notifySummary=[
    ...(notifyConfig.email?.enabled&&notify.emailList?.length?[`✉ ${notify.emailList.length} อีเมล์`]:[]),
    ...(notifyConfig.teams?.enabled&&notify.postToTeams?["🔵 Teams"]:[]),
    ...(notifyConfig.powerauto?.enabled&&notify.postToPowerAuto?["🟣 SharePoint"]:[]),
    ...(notifyConfig.line?.enabled&&notify.postToLine?["🟢 LINE Group"]:[]),
  ];
  const canViewEmailNotifications = isCreator || ["admin","superadmin"].includes(curUser.role);
  const canViewAcknowledgements = memo.status === "approved" && (canViewEmailNotifications || isValidAckRecipient(memo, users, curUser.email) || isMemoCcRecipient(memo, curUser.email));
  const approvedEmailNotifications = memo.approvedEmailNotifications || null;
  const emailStatusMeta = {
    sent: { label:"ส่งสำเร็จ", color:"#065F46", bg:"#ECFDF5", border:"#A7F3D0" },
    failed: { label:"ส่งไม่สำเร็จ", color:"#991B1B", bg:"#FFF1F1", border:"#FECACA" },
    skipped: { label:"ข้าม", color:"#92400E", bg:"#FFFBEB", border:"#FDE68A" },
  };
  const tplList=Object.values(pdfTemplates||{}).filter(t=>t.fileBase64);

  // Feature 4: approver adds a next level
  const addLvUser = (uid) => {
    const u=users.find(x=>x.id===uid); if(!u||newLvUsers.find(x=>x.userId===uid)) return;
    setNewLvUsers(p=>[...p,{userId:u.id,name:u.name,email:u.email,status:"pending"}]);
  };
  const submitAddLevel = () => {
    if(!newLvUsers.length){ alert("กรุณาเลือกผู้อนุมัติอย่างน้อย 1 คน"); return; }
    onApproverAddLevel(memo, {mode:newLvMode, approvers:newLvUsers});
    setShowAddLevel(false); setNewLvUsers([]); setNewLvMode("all");
  };

  return (
    <div style={{padding:24}}>
      {showPicker&&<TemplatePicker templates={tplList} memo={memo} users={users} onClose={()=>setShowPicker(false)}/>}
      {isDeleted&&(
        <div style={{background:"#FFF1F1",border:"1px solid #FECACA",borderRadius:8,padding:"10px 14px",marginBottom:14,fontSize:12,color:"#991B1B"}}>
          🗑 Memo นี้อยู่ในถังขยะ — ลบเมื่อ {fmtDate(memo.deletedAt)}{deleter.name ? ` โดย ${deleter.name}` : ""}
        </div>
      )}
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:18}}>
        <button onClick={onBack} style={{background:"none",border:"none",cursor:"pointer",fontSize:20,color:"#9CA3AF",padding:0,lineHeight:1}}>←</button>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:16,fontWeight:600,color:"#111",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{memo.title}</div>
          {memo.docNo&&<div style={{fontSize:11,color:"#9CA3AF",marginTop:1}}>เลขที่: <span style={{fontWeight:600,color:"#374151",fontFamily:"monospace"}}>{memo.docNo}</span></div>}
        </div>
        <StatusBadge status={memo.status}/>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 290px",gap:16,alignItems:"start"}}>
        <div>
          <Section>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12,paddingBottom:12,borderBottom:"1px solid #F3F4F6"}}>
              <Avatar userId={memo.createdBy} users={users} size={32}/>
              <div><div style={{fontSize:13,fontWeight:500,color:"#111"}}>{(users.find(u=>u.id===memo.createdBy)||{}).name}</div><div style={{fontSize:11,color:"#9CA3AF"}}>{fmtDate(memo.createdAt)} · {memo.category}</div></div>
            </div>
            {/* Uploaded file viewer */}
            {memo.uploadedFile && (
              <div style={{marginBottom:12}}>
                <div style={{fontSize:11,fontWeight:700,color:"#6B7280",marginBottom:6,textTransform:"uppercase",letterSpacing:.4}}>ไฟล์เอกสารหลัก</div>
                <div style={{border:"1px solid #E5E7EB",borderRadius:8,overflow:"hidden",background:"#FAFAFA"}}>
                  {memo.uploadedFile.type==="pdf" && memo.uploadedFile.data ? (
                    <PdfBlobViewer dataUrl={memo.uploadedFile.data} name={memo.uploadedFile.name} height={400}/>
                  ) : (memo.uploadedFile.type==="png"||memo.uploadedFile.type==="jpg"||memo.uploadedFile.type==="jpeg") && memo.uploadedFile.data ? (
                    <img src={memo.uploadedFile.data} alt="memo" style={{width:"100%",maxHeight:480,objectFit:"contain",display:"block"}}/>
                  ) : (
                    <div style={{padding:"16px 20px",display:"flex",alignItems:"center",gap:10}}>
                      <span style={{fontSize:24}}>{memo.uploadedFile.type==="docx"||memo.uploadedFile.type==="doc"?"📝":"📄"}</span>
                      <div style={{flex:1}}>
                        <div style={{fontSize:13,fontWeight:500,color:"#111"}}>{memo.uploadedFile.name}</div>
                        <div style={{fontSize:11,color:"#9CA3AF"}}>{memo.uploadedFile.size}</div>
                      </div>
                      {memo.uploadedFile.data&&<a href={memo.uploadedFile.data} download={memo.uploadedFile.name} style={{padding:"6px 14px",background:GOLD,color:BLACK,borderRadius:6,fontSize:12,fontWeight:600,textDecoration:"none"}}>⬇ ดาวน์โหลด</a>}
                    </div>
                  )}
                </div>
              </div>
            )}
                <div style={{fontSize:14,lineHeight:1.7,color:"#374141"}} dangerouslySetInnerHTML={{__html: memo.content||""}}/>
            {/* AI Summary */}
            <div style={{marginTop:14,borderTop:"1px solid #F3F4F6",paddingTop:10}}>
              <button onClick={handleAiSummarize} disabled={aiSumLoading}
                style={{display:"flex",alignItems:"center",gap:5,padding:"5px 13px",background:aiSummary?"#F9FAFB":"#F5F3FF",color:aiSummary?"#9CA3AF":"#7C3AED",border:`1px solid ${aiSummary?"#E5E7EB":"#DDD6FE"}`,borderRadius:5,fontSize:11,fontWeight:600,cursor:aiSumLoading?"not-allowed":"pointer",opacity:aiSumLoading?0.7:1}}>
                {aiSumLoading?"⏳ กำลังวิเคราะห์...":(aiSummary?"✕ ปิด AI สรุป":"✨ AI สรุปเอกสาร")}
              </button>
              {aiSummary&&(
                <div style={{marginTop:10,border:"1px solid #DDD6FE",borderRadius:8,overflow:"hidden"}}>
                  <div style={{background:"#7C3AED",color:"#fff",padding:"8px 14px",fontSize:12,fontWeight:600}}>✨ AI สรุปเอกสาร</div>
                  <div style={{padding:"12px 14px",fontSize:13,lineHeight:1.7}}>
                    <div style={{marginBottom:10}}>
                      <div style={{fontSize:10,fontWeight:700,color:"#6B7280",textTransform:"uppercase",letterSpacing:.4,marginBottom:4}}>สาระสำคัญ</div>
                      <div style={{color:"#374151"}}>{aiSummary.summary}</div>
                    </div>
                    {aiSummary.keyPoints?.length>0&&(
                      <div style={{marginBottom:10}}>
                        <div style={{fontSize:10,fontWeight:700,color:"#6B7280",textTransform:"uppercase",letterSpacing:.4,marginBottom:4}}>ประเด็นสำคัญ</div>
                        <ul style={{margin:0,paddingLeft:18,color:"#374151"}}>
                          {aiSummary.keyPoints.map((p,i)=><li key={i} style={{marginBottom:2}}>{p}</li>)}
                        </ul>
                      </div>
                    )}
                    {aiSummary.budget&&(
                      <div style={{marginBottom:10,background:"#FFFBEB",border:"1px solid #FCD34D",borderRadius:6,padding:"8px 12px"}}>
                        <div style={{fontSize:10,fontWeight:700,color:"#B45309",textTransform:"uppercase",letterSpacing:.4,marginBottom:4}}>💰 งบประมาณ</div>
                        <div style={{color:"#92400E"}}>{aiSummary.budget}</div>
                      </div>
                    )}
                    {aiSummary.risks?.length>0&&(
                      <div style={{background:"#FFF1F1",border:"1px solid #FECACA",borderRadius:6,padding:"8px 12px"}}>
                        <div style={{fontSize:10,fontWeight:700,color:"#991B1B",textTransform:"uppercase",letterSpacing:.4,marginBottom:4}}>⚠ ความเสี่ยง</div>
                        <ul style={{margin:0,paddingLeft:18,color:"#7F1D1D"}}>
                          {aiSummary.risks.map((r,i)=><li key={i} style={{marginBottom:2}}>{r}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </Section>
          <Section title="เอกสารแนบ" extra={(isCreator||canApprove)&&<><button onClick={()=>fileRef.current?.click()} style={BTN_GRAY}>+ แนบไฟล์</button><input ref={fileRef} type="file" style={{display:"none"}} onChange={handleFile}/></>}>
            {!(memo.attachments||[]).length?<div style={{fontSize:12,color:"#9CA3AF",textAlign:"center"}}>ไม่มีเอกสารแนบ</div>
            :(memo.attachments||[]).map(a=>(
              <div key={a.id} style={ATT_ROW}><span>📎</span>
                {a.data?<a href={a.data} download={a.name} style={{flex:1,fontSize:12,color:"#1D4ED8",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",textDecoration:"none"}}>{a.name}</a>
                       :<span style={{flex:1,fontSize:12,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.name}</span>}
                <span style={{fontSize:11,color:"#9CA3AF"}}>{a.size}</span>
                {isCreator&&<button onClick={()=>onRemoveFile(a.id)} style={BTN_X}>✕</button>}
              </div>
            ))}
          </Section>
          {memo.signatureZones?.length>0&&(
            <Section title="จุดลงนาม">
              {memo.signatureZones.map((z,i)=>{
                const u=users.find(x=>x.id===z.assignedTo)||{};
                return <div key={z.id||i} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 0",borderBottom:"1px solid #F3F4F6"}}>
                  <span style={{fontSize:11,color:"#9CA3AF",minWidth:20}}>{i+1}.</span>
                  <span style={{fontSize:12,flex:1}}>{z.label}</span>
                  <span style={{fontSize:11,color:"#6B7280"}}>{u.name||z.assignedTo||"-"}</span>
                  {u.signature&&<img src={u.signature} alt="sig" style={{height:24,border:"1px solid #E5E7EB",borderRadius:4}}/>}
                </div>;
              })}
            </Section>
          )}
          <Section title="ประวัติการดำเนินงาน">
            {[...(memo.history||[])].reverse().map((h,i)=>{
              const u=users.find(x=>x.id===h.by)||{};
              return <div key={i} style={{display:"flex",gap:10,padding:"8px 0",borderBottom:i<(memo.history||[]).length-1?"1px solid #F9FAFB":"none"}}>
                <Avatar userId={h.by} users={users} size={24}/>
                <div style={{flex:1}}>
                  <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                    <span style={{fontSize:12,fontWeight:500,color:"#374151"}}>{u.name||"-"}</span>
                    <span style={{fontSize:12,color:h.proxyFor?"#C2410C":(ACOLOR[h.action]||"#9CA3AF"),fontWeight:500}}>{fmtHistAction(h)}</span>
                    <span style={{fontSize:11,color:"#9CA3AF",marginLeft:"auto",whiteSpace:"nowrap"}}>
                      {h.at ? new Date(h.at).toLocaleDateString("th-TH",{day:"2-digit",month:"short",year:"2-digit"})+" "+new Date(h.at).toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit"}) : "-"}
                    </span>
                  </div>
                  {h.comment&&<div style={{fontSize:11,color:"#6B7280",marginTop:2}}>{h.comment}</div>}
                </div>
              </div>;
            })}
          </Section>
        </div>
        <div>
          {/* [7] Approval timeline — visible to creator + approvers */}
          <Section title="สถานะการอนุมัติ">
            <ApprovalTimeline memo={memo} users={users}/>
            {!(memo.workflowLevels||[]).length&&<div style={{fontSize:12,color:"#9CA3AF",textAlign:"center"}}>ยังไม่มีขั้นตอนการอนุมัติ</div>}
          </Section>
          {notifySummary.length>0&&<Section title="แจ้งเตือนเมื่ออนุมัติ"><div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{notifySummary.map(s=><span key={s} style={{fontSize:11,background:"#F9FAFB",border:"1px solid #F3F4F6",borderRadius:5,padding:"3px 8px"}}>{s}</span>)}</div></Section>}
          {memo.status==="approved"&&memo.shareToken&&(
            <Section title="ลิงก์ดูเอกสาร (CC)">
              <div style={{fontSize:11,color:"#6B7280",lineHeight:1.6,marginBottom:8}}>ผู้รับ CC เปิดลิงก์นี้ได้โดยไม่ต้องมีบัญชีในระบบ</div>
              <div style={{fontSize:11,color:"#1E40AF",wordBreak:"break-all",background:"#F9FAFB",border:"1px solid #E5E7EB",borderRadius:6,padding:"8px 10px",marginBottom:8}}>{buildMemoShareLinkLocal(memo)}</div>
              <button onClick={()=>{const link=buildMemoShareLinkLocal(memo);navigator.clipboard?.writeText(link).then(()=>alert("คัดลอกลิงก์แล้ว")).catch(()=>prompt("คัดลอกลิงก์:",link));}} style={{...BTN_GRAY,padding:"6px 12px",fontSize:12}}>📋 คัดลอกลิงก์</button>
            </Section>
          )}
          {canViewAcknowledgements && (
            <Section title="สถานะการรับทราบ">
              <AcknowledgementPanel memo={memo} users={users} curUser={curUser} onAcknowledge={onAcknowledge} />
            </Section>
          )}
          {canViewEmailNotifications && approvedEmailNotifications && (
            <Section title="สถานะอีเมลแจ้งผลอนุมัติ">
              <div style={{fontSize:10,color:"#9CA3AF",marginBottom:8}}>
                อัปเดตล่าสุด: {approvedEmailNotifications.sentAt ? fmtDate(approvedEmailNotifications.sentAt) : "-"}
              </div>
              {(approvedEmailNotifications.recipients||[]).length ? (
                (approvedEmailNotifications.recipients||[]).map((r,i)=>{
                  const meta = emailStatusMeta[r.status] || { label:r.status||"-", color:"#6B7280", bg:"#F9FAFB", border:"#E5E7EB" };
                  return (
                    <div key={`${r.email||i}-${i}`} style={{padding:"8px 0",borderBottom:i<(approvedEmailNotifications.recipients||[]).length-1?"1px solid #F3F4F6":"none"}}>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <span style={{flex:1,minWidth:0,fontSize:12,color:"#374151",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.name||r.email||"-"}</span>
                        <span style={{fontSize:10,fontWeight:700,color:meta.color,background:meta.bg,border:`1px solid ${meta.border}`,borderRadius:5,padding:"2px 6px",whiteSpace:"nowrap"}}>{meta.label}</span>
                      </div>
                      <div style={{fontSize:10,color:"#9CA3AF",marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.email||"-"}{r.source==="creator"?" • ผู้สร้าง":""}</div>
                      {r.error&&<div style={{fontSize:10,color:"#991B1B",marginTop:2,wordBreak:"break-word"}}>{r.error}</div>}
                    </div>
                  );
                })
              ) : (
                <div style={{fontSize:11,color:"#9CA3AF"}}>ไม่มีรายการอีเมลที่ต้องส่ง</div>
              )}
            </Section>
          )}
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {(memo.status==="approved"||memo.status==="pending"||memo.status==="rejected")&&(
              tplList.length>0 ? (
                <button onClick={()=>{if(tplList.length===1)exportMemoDocx(memo,users,tplList[0]);else setShowPicker(true);}}
                  style={{padding:11,background:memo.status==="approved"?"#EFF6FF":"#F9FAFB",color:memo.status==="approved"?"#1E40AF":"#6B7280",border:`1px solid ${memo.status==="approved"?"#BFDBFE":"#E5E7EB"}`,borderRadius:6,fontSize:13,fontWeight:500,cursor:"pointer"}}>
                  {memo.status==="approved"?"📄 Export .docx (อนุมัติครบ)":"📄 ดูตัวอย่าง .docx"}
                </button>
              ) : (
                <button onClick={()=>printSystemPDF(memo,users)}
                  style={{padding:11,background:"#ECFDF5",color:"#065F46",border:"1px solid #A7F3D0",borderRadius:6,fontSize:13,fontWeight:500,cursor:"pointer"}}>
                  🖨️ {memo.status==="approved"?"พิมพ์ PDF (อนุมัติครบ)":"พิมพ์ตัวอย่าง PDF"}
                </button>
              )
            )}

            {/* Feature 3: Clone เป็นร่างใหม่ — ทุก status ยกเว้น draft */}
            {memo.status!=="draft" && (
              <button onClick={()=>onCloneMemo(memo)}
                style={{padding:11,background:"#F5F3FF",color:"#7C3AED",border:"1px solid #DDD6FE",borderRadius:6,fontSize:13,cursor:"pointer",fontWeight:500}}>
                📋 ใช้เป็นแบบร่างใหม่
              </button>
            )}

            {canApproveOwn&&(
              <>
                <button onClick={()=>setModal({type:"approve",memo})} style={{padding:11,background:GOLD,color:BLACK,border:"none",borderRadius:6,fontSize:13,fontWeight:600,cursor:"pointer"}}>✓ อนุมัติ</button>
                <button onClick={()=>setModal({type:"reject",memo})}  style={{padding:11,background:"#FFF1F1",color:"#991B1B",border:"1px solid #FECACA",borderRadius:6,fontSize:13,cursor:"pointer"}}>✕ ปฏิเสธ</button>
                {/* Feature 4: เพิ่มลำดับต่อเอง */}
                <button onClick={()=>setShowAddLevel(p=>!p)}
                  style={{padding:11,background:"#F5F3FF",color:"#7C3AED",border:"1px solid #DDD6FE",borderRadius:6,fontSize:12,cursor:"pointer"}}>
                  ➕ เพิ่มลำดับอนุมัติต่อ
                </button>
                {showAddLevel && (
                  <div style={{border:"1px solid #DDD6FE",borderRadius:8,padding:12,background:"#FAFAFA"}}>
                    <div style={{fontSize:11,fontWeight:700,color:"#7C3AED",marginBottom:8}}>เพิ่มลำดับอนุมัติต่อจากลำดับนี้</div>
                    <div style={{display:"flex",gap:4,marginBottom:8}}>
                      {[["all","ทุกคนต้องอนุมัติ"],["any","คนใดคนหนึ่ง"]].map(([k,l])=>(
                        <button key={k} onClick={()=>setNewLvMode(k)} style={{flex:1,padding:"4px 0",fontSize:10,fontWeight:newLvMode===k?600:400,background:newLvMode===k?"#7C3AED":"#F9FAFB",color:newLvMode===k?"#fff":"#6B7280",border:"1px solid #E5E7EB",borderRadius:4,cursor:"pointer"}}>{l}</button>
                      ))}
                    </div>
                    {newLvUsers.length>0&&(
                      <div style={{display:"flex",gap:3,flexWrap:"wrap",marginBottom:6}}>
                        {newLvUsers.map((u,i)=>(
                          <span key={i} style={{fontSize:10,background:"#EDE9FE",color:"#7C3AED",borderRadius:4,padding:"2px 7px",display:"flex",alignItems:"center",gap:3}}>
                            {u.name}
                            <button onClick={()=>setNewLvUsers(p=>p.filter((_,j)=>j!==i))} style={{background:"none",border:"none",cursor:"pointer",color:"#9CA3AF",fontSize:10,padding:0}}>✕</button>
                          </span>
                        ))}
                      </div>
                    )}
                    <select defaultValue="" onChange={e=>{addLvUser(e.target.value);e.target.value="";}}
                      style={{width:"100%",fontSize:11,padding:"5px 8px",border:"1px solid #E5E7EB",borderRadius:5,marginBottom:8,background:"#F9FAFB"}}>
                      <option value="" disabled>+ เลือกผู้อนุมัติ</option>
                      {users.filter(u=>u.active&&!newLvUsers.find(x=>x.userId===u.id)).map(u=>(
                        <option key={u.id} value={u.id}>{u.name} ({u.dept||"-"})</option>
                      ))}
                    </select>
                    <div style={{display:"flex",gap:6}}>
                      <button onClick={submitAddLevel} style={{...BTN_GOLD,flex:1,padding:"7px",fontSize:11}}>✓ เพิ่มลำดับ</button>
                      <button onClick={()=>{setShowAddLevel(false);setNewLvUsers([]);}} style={{flex:1,padding:"7px",background:"#F9FAFB",color:"#6B7280",border:"1px solid #E5E7EB",borderRadius:5,fontSize:11,cursor:"pointer"}}>ยกเลิก</button>
                    </div>
                  </div>
                )}
              </>
            )}
            {/* Proxy approve for superadmin */}
            {canApproveProxy&&(
              <div style={{background:"#FFF7ED",border:"1px solid #FED7AA",borderRadius:8,padding:12}}>
                <div style={{fontSize:12,fontWeight:600,color:"#C2410C",marginBottom:8}}>⚡ อนุมัติแทน (Super Admin)</div>
                <div style={{fontSize:11,color:"#92400E",marginBottom:10}}>
                  เลือกผู้อนุมัติที่ต้องการอนุมัติแทน:
                </div>
                {(activeLevel?.approvers||[]).filter(ap=>ap.status==="pending").map((ap,ai)=>{
                  const u=users.find(x=>x.id===ap.userId)||{};
                  const nm=ap.name||u.name||ap.email||"-";
                  return (
                    <button key={ai}
                      onClick={()=>setModal({type:"approve",memo,proxyFor:{userId:ap.userId,email:ap.email,name:nm}})}
                      style={{width:"100%",padding:"8px 12px",marginBottom:4,background:"#fff",border:"1px solid #FED7AA",borderRadius:6,fontSize:12,cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontSize:14}}>👤</span>
                      <span style={{flex:1}}>{nm}</span>
                      <span style={{fontSize:10,color:"#C2410C",background:"#FFF7ED",padding:"2px 7px",borderRadius:4,border:"1px solid #FED7AA"}}>อนุมัติแทน</span>
                    </button>
                  );
                })}
              </div>
            )}
            {isCreator&&memo.status==="pending"&&!isDeleted&&can(curUser.role,"recall")&&<button onClick={onRecall} style={{padding:11,background:"#EFF6FF",color:"#1E40AF",border:"1px solid #BFDBFE",borderRadius:6,fontSize:13,cursor:"pointer"}}>↩ เรียกคืน Memo</button>}
            {isCreator&&!isDeleted&&(memo.status==="draft"||memo.status==="recalled")&&<button onClick={onEdit} style={{padding:11,background:GOLD,color:BLACK,border:"none",borderRadius:6,fontSize:13,fontWeight:600,cursor:"pointer"}}>✎ แก้ไข Memo</button>}
            {can(curUser.role,"deleteMemo")&&!isDeleted&&onDelete&&(
              <button onClick={()=>onDelete(memo)} style={{padding:11,background:"#FFF1F1",color:"#991B1B",border:"1px solid #FECACA",borderRadius:6,fontSize:13,cursor:"pointer",fontWeight:500}}>
                🗑 ลบ (ย้ายไปถังขยะ)
              </button>
            )}
            {can(curUser.role,"deleteMemo")&&isDeleted&&onRestore&&(
              <button onClick={()=>onRestore(memo)} style={{padding:11,background:"#ECFDF5",color:"#065F46",border:"1px solid #A7F3D0",borderRadius:6,fontSize:13,cursor:"pointer",fontWeight:600}}>
                ↩ กู้คืนจากถังขยะ
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// UsersMgmt, SettingsView — same as original ──────────────────────────────────
function UsersMgmt({ users, curUser, showToast, emailTemplates }) {
  const [editing,setEditing]=useState(null); const [delConfirm,setDelConfirm]=useState(null); const [importPreview,setImportPreview]=useState(null);
  const [importSendNew,setImportSendNew]=useState(true); const [importSendUpdated,setImportSendUpdated]=useState(false);
  const [importing,setImporting]=useState(false); const [importStatus,setImportStatus]=useState("");
  const [deptFilter,setDeptFilter]=useState("");
  const xlsxRef=useRef(); const blank={name:"",nickname:"",loginId:"",password:"",email:"",dept:"",role:"user",active:true,sendNotifyEmail:false};
  const handleXlsxImport=async(e)=>{const file=e.target.files[0];if(!file)return;e.target.value="";try{const XLSX=await import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs");const buf=await file.arrayBuffer();const wb=XLSX.read(buf,{type:"array"});const ws=wb.Sheets[wb.SheetNames[0]];const rows=XLSX.utils.sheet_to_json(ws,{defval:""});const parsed=rows.map(r=>{const name=String(r["ชื่อ-สกุล"]||r["name"]||"").trim();const loginId=normalizeLoginId(r["username"]||r["Username"]||r["loginId"]||String(name).replace(/\s+/g,"."));const rawEmail=String(r["email"]||r["Email"]||"").trim().toLowerCase();return{name,nickname:String(r["ชื่อเล่น"]||r["nickname"]||"").trim(),loginId,email:rawEmail||makeLoginEmail(loginId),password:String(r["รหัสผ่าน"]||r["password"]||"").trim(),dept:String(r["แผนก"]||r["dept"]||"").trim(),role:["superadmin","admin","user"].includes(String(r["สิทธิ์"]||r["role"]||"").toLowerCase())?String(r["สิทธิ์"]||r["role"]||"user").toLowerCase():"user",active:true};}).filter(r=>r.name&&r.loginId&&r.password.length>=6);if(!parsed.length){showToast("ไม่พบข้อมูลที่ถูกต้อง","error");return;}setImportSendNew(true);setImportSendUpdated(false);setImportPreview(parsed);}catch(err){showToast("อ่านไฟล์ไม่ได้: "+err.message,"error");}};
  const confirmImport=async()=>{
    if(!importPreview || importing) return;
    setImporting(true);
    setImportStatus("กำลังนำเข้าข้อมูล...");
    const existing = Object.fromEntries(users.map(u=>[u.id,u]));
    let added=0, updated=0, authFailed=0, emailsSent=0, emailFailed=0;
    const emailErrors = [];

    try {
      for (const r of importPreview) {
        const dup = users.find(u => (u.loginId||loginIdFromUser(u))===r.loginId || u.email===r.email);
        const shouldSendNew = importSendNew && !dup && r.email;
        const shouldSendUpdated = importSendUpdated && dup && r.email;

        if (dup) {
          existing[dup.id] = {
            ...dup, name: r.name, nickname: r.nickname || dup.nickname || "", loginId: r.loginId, email: r.email, dept: r.dept, role: r.role,
            ...(shouldSendUpdated && r.password ? { mustChangePassword: true } : {}),
          };
          updated++;
          if (r.password) {
            try {
              await updateAuthPasswordREST(r.email, r.password);
            } catch (authErr) {
              if (authErr.code !== "USER_NOT_FOUND") {
                authFailed++;
                console.warn("Auth password update failed for", r.loginId, authErr.message);
              }
            }
          }
          if (shouldSendUpdated) {
            setImportStatus(`กำลังส่งอีเมลให้ ${r.email}...`);
            try {
              await ensureAuthAndSendAccountEmail({
                email: r.email, name: r.name, loginId: r.loginId, password: r.password,
                templateType: "update", emailTemplates,
              });
              emailsSent++;
            } catch (e) {
              emailFailed++;
              emailErrors.push(`${r.email}: ${e.message || e.code}`);
              console.warn('[confirmImport] email failed', r.email, e.message || e);
            }
          }
        } else {
          const id = newId("u");
          const { password, ...userData } = r;
          existing[id] = { ...userData, id, mustChangePassword: true, onboardingPending: true };
          added++;
          try {
            await createAuthUserREST(r.email, r.password);
          } catch (authErr) {
            if (authErr.message !== "EMAIL_EXISTS") {
              authFailed++;
              console.warn("Auth failed for", r.loginId, authErr.message);
            }
          }
          if (shouldSendNew) {
            setImportStatus(`กำลังส่งอีเมลให้ ${r.email}...`);
            try {
              await ensureAuthAndSendAccountEmail({
                email: r.email, name: r.name, loginId: r.loginId, password: r.password,
                templateType: "new", emailTemplates,
              });
              emailsSent++;
            } catch (e) {
              emailFailed++;
              emailErrors.push(`${r.email}: ${e.message || e.code}`);
              console.warn('[confirmImport] email failed', r.email, e.message || e);
            }
          }
        }
      }

      setImportStatus("กำลังบันทึกข้อมูล...");
      await writeUsers(existing);

      const parts = [`นำเข้าสำเร็จ: เพิ่ม ${added} คน, อัปเดต ${updated} คน`];
      if (emailsSent > 0) parts.push(`ส่งอีเมลแล้ว ${emailsSent} ฉบับ`);
      if (authFailed > 0) parts.push(`Auth ไม่สำเร็จ ${authFailed} คน`);
      if (emailFailed > 0) parts.push(`ส่งอีเมลไม่สำเร็จ ${emailFailed} ฉบับ`);
      showToast(parts.join(" — "), emailFailed > 0 ? "error" : "success");
      if (emailErrors.length) {
        setTimeout(() => showToast(emailErrors[0], "error"), 3500);
      }
      setImportPreview(null);
    } catch (err) {
      showToast("Import ไม่สำเร็จ: "+err.message, "error");
    } finally {
      setImporting(false);
      setImportStatus("");
    }
  };

  const save=async()=>{
    const name = editing.name.trim();
    const loginId = normalizeLoginId(editing.loginId || editing.email || name.replace(/\s+/g,"."));
    const email = editing.email?.trim() && editing.email.includes("@") ? editing.email.trim().toLowerCase() : makeLoginEmail(loginId);
    const password = String(editing.password || "");
    if(!name||!loginId){showToast("กรุณากรอกชื่อและ Username","error");return;}
    if(!editing.id&&password.length<6){showToast("กรุณาตั้งรหัสผ่านอย่างน้อย 6 ตัวอักษร","error");return;}
    if(!editing.id&&users.find(u=>(u.loginId||"")===loginId||u.email===email)){showToast("Username นี้มีในระบบแล้ว","error");return;}
    const id=editing.id||newId("u");
    const { password: _password, sendNotifyEmail, ...editingSafe } = editing;
    const newUser={...editingSafe,id,name,loginId,email};
    if (!editing.id) {
      newUser.mustChangePassword = true;
      newUser.onboardingPending = true;
    }
    const newObj={...Object.fromEntries(users.map(u=>[u.id,u])),[id]:newUser};
    await writeUsers(newObj);
    if(!editing.id){
      try{
        await createAuthUserREST(email, password);
        showToast("✅ เพิ่ม User แล้ว — ใช้ Username "+loginId+" เข้าสู่ระบบได้ทันที");
        try {
          await ensureAuthAndSendAccountEmail({ email, name, loginId, password, templateType: "new", emailTemplates });
          showToast("ส่งอีเมลแจ้งการใช้งานให้ "+email+" แล้ว");
        } catch(e){ console.warn('[save] sendResetEmailREST', e.message || e); showToast("ส่งอีเมลไม่สำเร็จ: "+e.message,"error"); }
      }catch(authErr){
        if(authErr.message==="EMAIL_EXISTS"){
          showToast("✅ เพิ่ม User แล้ว (มี Auth account อยู่แล้ว)");
          try {
            await ensureAuthAndSendAccountEmail({ email, name, loginId, password, templateType: "new", emailTemplates });
            showToast("ส่งอีเมลแจ้งการใช้งานให้ "+email+" แล้ว");
          } catch(e){ console.warn('[save] sendResetEmailREST', e.message || e); showToast("ส่งอีเมลไม่สำเร็จ: "+e.message,"error"); }
        } else {
          showToast("⚠️ เพิ่มใน DB แล้ว แต่สร้าง Auth ไม่สำเร็จ ("+authErr.message+") → สร้างใน Firebase Console → Auth → Add user","error");
        }
      }
    } else {
      showToast("บันทึกแล้ว");
      if (editing.sendNotifyEmail) {
        try {
          await ensureAuthAndSendAccountEmail({
            email, name, loginId,
            password: password.length >= 6 ? password : "",
            templateType: "update", emailTemplates,
          });
          showToast("ส่งอีเมลแจ้งการอัปเดตให้ "+email+" แล้ว");
        } catch (e) {
          showToast("ส่งอีเมลไม่สำเร็จ: "+(e.message||e.code),"error");
        }
      }
    }
    setEditing(null);
  };
  const toggle=async u=>{if(u.id===curUser.id){showToast("ไม่สามารถระงับตัวเองได้","error");return;}await update(ref(db,`${DATA_PATH}/users/${u.id}`),{active:!u.active});showToast(u.active?"ระงับแล้ว":"เปิดแล้ว");};
  const del=async u=>{const newObj=Object.fromEntries(users.filter(x=>x.id!==u.id).map(x=>[x.id,x]));await writeUsers(newObj);showToast("ลบแล้ว");setDelConfirm(null);};
  // [4] Role descriptions with permission list
  const RDESC={superadmin:"เข้าถึงทุกส่วน จัดการ User ตั้งค่าระบบ Template รายงาน",admin:"สร้าง อนุมัติ ดู Memo ทั้งหมด ดูรายงาน",user:"สร้าง Memo ของตัวเอง อนุมัติ Memo ที่ได้รับมอบหมาย"};
  const NO_DEPT_KEY = "__no_dept__";
  const deptOptions = [...new Set(users.map(u => u.dept?.trim() || NO_DEPT_KEY))].sort((a, b) => {
    if (a === NO_DEPT_KEY) return 1;
    if (b === NO_DEPT_KEY) return -1;
    return a.localeCompare(b, "th");
  });
  const deptLabel = (key) => key === NO_DEPT_KEY ? "— ไม่ระบุแผนก —" : key;
  const userDeptKey = (u) => u.dept?.trim() || NO_DEPT_KEY;
  const filteredUsers = deptFilter
    ? users.filter(u => userDeptKey(u) === deptFilter)
    : users;
  return (
    <div style={{padding:24}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
        <div><div style={{fontSize:18,fontWeight:600,color:"#111"}}>จัดการ User</div><div style={{fontSize:12,color:"#9CA3AF",marginTop:2}}>{deptFilter ? `${filteredUsers.length} / ${users.length}` : users.length} บัญชี</div></div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <input ref={xlsxRef} type="file" accept=".xlsx,.xls" style={{display:"none"}} onChange={handleXlsxImport}/>
          <button onClick={async()=>{const XLSX=await import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs");const ws=XLSX.utils.aoa_to_sheet([["ชื่อ-สกุล","ชื่อเล่น","username","email","รหัสผ่าน","แผนก","สิทธิ์"],["สมชาย ใจดี","ชาย","somchai","somchai@tgm.co.th","123456","IT","user"]]);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Users");XLSX.writeFile(wb,"user_template.xlsx");}} style={{...BTN_GRAY,padding:"6px 12px",fontSize:12}}>⬇ Template</button>
          <button onClick={()=>xlsxRef.current?.click()} style={{padding:"7px 14px",background:"#ECFDF5",color:"#065F46",border:"1px solid #A7F3D0",borderRadius:6,fontSize:12,fontWeight:600,cursor:"pointer"}}>📥 Import Excel</button>
          <button onClick={()=>setEditing(blank)} style={BTN_GOLD}>+ เพิ่ม User</button>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:16}}>
        {["superadmin","admin","user"].map(r=>{const c=ROLE_CONFIG[r];const n=filteredUsers.filter(u=>u.role===r&&u.active).length;return <div key={r} style={{background:c.bg,border:`1px solid ${c.border}`,borderRadius:8,padding:"10px 14px"}}><div style={{fontSize:11,color:c.text,fontWeight:600}}>{c.label}</div><div style={{fontSize:22,fontWeight:700,color:c.text,marginTop:2}}>{n}</div></div>;})}
      </div>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12,flexWrap:"wrap"}}>
        <span style={{fontSize:12,fontWeight:600,color:"#6B7280"}}>กรองแผนก</span>
        <select
          value={deptFilter}
          onChange={e => setDeptFilter(e.target.value)}
          style={{...IS,width:"auto",minWidth:200,maxWidth:"100%",fontSize:12,padding:"7px 10px",cursor:"pointer"}}
        >
          <option value="">ทุกแผนก ({users.length})</option>
          {deptOptions.map(d => (
            <option key={d} value={d}>
              {deptLabel(d)} ({users.filter(u => userDeptKey(u) === d).length})
            </option>
          ))}
        </select>
        {deptFilter && (
          <button onClick={() => setDeptFilter("")} style={{...BTN_GRAY,padding:"6px 12px",fontSize:12}}>ล้างตัวกรอง</button>
        )}
      </div>
      <div style={{background:"#fff",border:"1px solid #F3F4F6",borderRadius:10,overflow:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",tableLayout:"fixed",minWidth:860}}>
          <colgroup>
            <col style={{width:"22%"}} />
            <col style={{width:"14%"}} />
            <col style={{width:"14%"}} />
            <col style={{width:"10%"}} />
            <col style={{width:"14%"}} />
            <col style={{width:"10%"}} />
            <col style={{width:"16%"}} />
          </colgroup>
          <thead>
            <tr style={{background:"#F9FAFB",borderBottom:"1px solid #F3F4F6"}}>
              {["ชื่อ","Username","แผนก","สิทธิ์","การมองเห็น","สถานะ","จัดการ"].map(h=>(
                <th key={h} style={{padding:"8px 12px",fontSize:11,fontWeight:600,color:"#9CA3AF",textAlign:"left",verticalAlign:"middle"}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
        {filteredUsers.length === 0 ? (
          <tr><td colSpan={7} style={{padding:"32px 16px",textAlign:"center",color:"#9CA3AF",fontSize:13}}>ไม่พบ User ในแผนกนี้</td></tr>
        ) : filteredUsers.map(u=>{
          const scope = u.viewScope||"dept";
          const scopeInfo = scope==="all"||u.role==="superadmin"||u.role==="admin"
            ? {l:"👁 ทั้งหมด",     c:"#1E40AF", bg:"#EFF6FF"}
            : scope==="own"
            ? {l:"🔒 ตัวเอง",     c:"#6B7280", bg:"#F9FAFB"}
            : {l:`📁 ${u.dept||"แผนก"}`, c:"#7C3AED", bg:"#F5F3FF"};
          return (
          <tr key={u.id} style={{borderBottom:"1px solid #F3F4F6",opacity:u.active?1:.45}}>
            <td style={{padding:"10px 12px",verticalAlign:"middle"}}>
              <div style={{display:"flex",alignItems:"center",gap:8,minWidth:0}}>
                <Avatar userId={u.id} users={users} size={26}/>
                <span style={{fontSize:12,fontWeight:u.id===curUser.id?600:400,color:"#374151",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  {displayUserName(u)}
                  {u.id===curUser.id&&<span style={{fontSize:10,color:GOLD,marginLeft:4}}>(คุณ)</span>}
                </span>
              </div>
            </td>
            <td style={{padding:"10px 12px",fontSize:12,color:"#6B7280",verticalAlign:"middle",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{loginIdFromUser(u)}</td>
            <td style={{padding:"10px 12px",fontSize:12,color:"#374151",verticalAlign:"middle",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.dept||"-"}</td>
            <td style={{padding:"10px 12px",verticalAlign:"middle"}}><RoleBadge role={u.role}/></td>
            <td style={{padding:"10px 12px",verticalAlign:"middle"}}><span style={{fontSize:10,fontWeight:500,color:scopeInfo.c,background:scopeInfo.bg,borderRadius:4,padding:"2px 7px",whiteSpace:"nowrap",display:"inline-block"}}>{scopeInfo.l}</span></td>
            <td style={{padding:"10px 12px",verticalAlign:"middle"}}><span style={{fontSize:11,fontWeight:500,color:u.active?"#065F46":"#991B1B",background:u.active?"#ECFDF5":"#FFF1F1",border:`1px solid ${u.active?"#A7F3D0":"#FECACA"}`,borderRadius:4,padding:"2px 7px",whiteSpace:"nowrap",display:"inline-block"}}>{u.active?"ใช้งาน":"ระงับ"}</span></td>
            <td style={{padding:"10px 12px",verticalAlign:"middle"}}>
            <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
              <button onClick={()=>setEditing({...u})} style={BTN_GRAY}>แก้ไข</button>
              <button onClick={async()=>{try{await sendResetEmailREST({email:u.email,name:u.name,loginId:loginIdFromUser(u),templateType:"forgot",emailTemplates});showToast("ส่งลิงก์รีเซ็ตรหัสผ่านให้ "+u.email+" แล้ว");}catch(e){showToast("ส่งไม่สำเร็จ: "+(e.message||e.code),"error");}}} style={{padding:"3px 7px",fontSize:11,borderRadius:5,background:"#EFF6FF",color:"#1E40AF",border:"1px solid #BFDBFE",cursor:"pointer"}} title="ส่งลิงก์รีเซ็ตรหัสผ่าน">🔑</button>
              <button onClick={()=>toggle(u)} style={{padding:"3px 7px",fontSize:11,borderRadius:5,background:u.active?"#FFFBEB":"#ECFDF5",color:u.active?"#B45309":"#065F46",border:`1px solid ${u.active?"#FCD34D":"#A7F3D0"}`,cursor:"pointer"}}>{u.active?"ระงับ":"เปิด"}</button>
              {u.id!==curUser.id&&<button onClick={()=>setDelConfirm(u)} style={{...BTN_X,color:"#DC2626",padding:"3px 6px",border:"1px solid #FECACA",borderRadius:5,background:"#FFF1F1"}}>ลบ</button>}
            </div>
            </td>
          </tr>
          );
        })}
          </tbody>
        </table>
      </div>
      {editing&&<div style={{position:"fixed",inset:0,zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,.5)"}}>
        <div style={{background:"#fff",border:"1px solid #E5E7EB",borderRadius:12,padding:24,width:420,boxShadow:"0 20px 60px rgba(0,0,0,.2)"}}>
          <div style={{fontSize:15,fontWeight:600,marginBottom:16,color:"#111"}}>{editing.id?"แก้ไข User":"เพิ่ม User ใหม่"}</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
            <Field label="ชื่อ-สกุล *"><input value={editing.name} onChange={e=>setEditing(p=>({...p,name:e.target.value}))} style={IS}/></Field>
            <Field label="ชื่อเล่น"><input value={editing.nickname||""} onChange={e=>setEditing(p=>({...p,nickname:e.target.value}))} placeholder="เช่น บูม, ฝน" style={IS}/></Field>
            <Field label="แผนก"><input value={editing.dept||""} onChange={e=>setEditing(p=>({...p,dept:e.target.value}))} style={IS}/></Field>
            <div style={{gridColumn:"1/-1"}}><Field label="Username *"><input value={editing.loginId||loginIdFromUser(editing)} onChange={e=>setEditing(p=>({...p,loginId:e.target.value}))} style={IS} disabled={!!editing.id}/></Field></div>
              <div style={{gridColumn:"1/-1"}}><Field label="Email"><input value={editing.email||""} onChange={e=>setEditing(p=>({...p,email:e.target.value}))} placeholder="user@yourdomain.com" style={IS}/></Field></div>
            {!editing.id&&<div style={{gridColumn:"1/-1"}}><Field label="รหัสผ่าน *"><input type="password" value={editing.password||""} onChange={e=>setEditing(p=>({...p,password:e.target.value}))} style={IS}/></Field></div>}
            <Field label="สิทธิ์">
              <select value={editing.role} onChange={e=>setEditing(p=>({...p,role:e.target.value}))} style={IS}>
                <option value="superadmin">Super Admin</option>
                <option value="admin">Admin</option>
                <option value="user">User</option>
              </select>
            </Field>
            <Field label="สถานะ"><select value={editing.active?"1":"0"} onChange={e=>setEditing(p=>({...p,active:e.target.value==="1"}))} style={IS}><option value="1">ใช้งาน</option><option value="0">ระงับ</option></select></Field>
            <div style={{gridColumn:"1/-1"}}>
              <Field label="การมองเห็น Memo">
                <select value={editing.viewScope||"dept"} onChange={e=>setEditing(p=>({...p,viewScope:e.target.value}))} style={IS}>
                  <option value="dept">📁 เห็นของแผนกตัวเองทั้งหมด (default)</option>
                  <option value="own">🔒 เฉพาะของตัวเองและที่ได้รับมอบหมาย</option>
                  <option value="all">👁 เห็นทั้งหมด (เหมือน Admin)</option>
                </select>
              </Field>
              <div style={{fontSize:10,color:"#9CA3AF",marginTop:3,lineHeight:1.6,padding:"4px 8px",background:"#F9FAFB",borderRadius:4}}>
                {(editing.viewScope||"dept")==="dept"
                  ? `📁 เห็น Memo ทุกอันในแผนก "${editing.dept||"(ยังไม่ได้ระบุแผนก)"}" + ของตัวเอง + ที่ได้รับมอบหมาย`
                  : (editing.viewScope)==="all"
                  ? "👁 เห็น Memo ทั้งหมดในระบบ (ควรใช้กับ Admin ขึ้นไป)"
                  : "🔒 เห็นเฉพาะ Memo ที่ตัวเองสร้าง และที่ได้รับมอบหมายให้อนุมัติ"}
              </div>
            </div>
          </div>
          <div style={{padding:"8px 12px",background:"#F9FAFB",borderRadius:6,fontSize:11,color:"#6B7280",marginBottom:14,lineHeight:1.6}}>
            <strong>สิทธิ์:</strong> {RDESC[editing.role]}
          </div>
          {editing.id && (
            <label style={{display:"flex",alignItems:"center",gap:8,marginBottom:14,fontSize:12,color:"#374151",cursor:"pointer"}}>
              <input type="checkbox" checked={!!editing.sendNotifyEmail} onChange={e=>setEditing(p=>({...p,sendNotifyEmail:e.target.checked}))}/>
              ส่งอีเมลแจ้งเตือนผู้ใช้ (template อัปเดตบัญชี)
            </label>
          )}
          <div style={{display:"flex",gap:8}}><button onClick={save} style={{...BTN_GOLD,flex:1,padding:"10px"}}>บันทึก</button><button onClick={()=>setEditing(null)} style={{flex:1,padding:"10px",background:"#F9FAFB",color:"#6B7280",border:"1px solid #E5E7EB",borderRadius:6,fontSize:12,cursor:"pointer"}}>ยกเลิก</button></div>
        </div>
      </div>}
      {delConfirm&&<div style={{position:"fixed",inset:0,zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,.5)"}}>
        <div style={{background:"#fff",border:"1px solid #E5E7EB",borderRadius:12,padding:24,width:340,boxShadow:"0 20px 60px rgba(0,0,0,.2)"}}>
          <div style={{fontSize:15,fontWeight:600,marginBottom:8,color:"#111"}}>ยืนยันการลบ User</div>
          <div style={{fontSize:13,color:"#6B7280",marginBottom:20}}>ต้องการลบ <strong>{delConfirm.name}</strong>? Memo ที่สร้างไว้จะยังคงอยู่</div>
          <div style={{display:"flex",gap:8}}><button onClick={()=>del(delConfirm)} style={{flex:1,padding:"10px",background:"#DC2626",color:"#fff",border:"none",borderRadius:6,fontSize:13,fontWeight:600,cursor:"pointer"}}>ลบ</button><button onClick={()=>setDelConfirm(null)} style={{flex:1,padding:"10px",background:"#F9FAFB",color:"#6B7280",border:"1px solid #E5E7EB",borderRadius:6,fontSize:13,cursor:"pointer"}}>ยกเลิก</button></div>
        </div>
      </div>}
      {importPreview&&<div style={{position:"fixed",inset:0,zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,.5)"}}>
        <div style={{background:"#fff",border:"1px solid #E5E7EB",borderRadius:12,padding:24,width:560,maxHeight:"80vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,.2)"}}>
          <div style={{fontSize:15,fontWeight:600,marginBottom:4,color:"#111"}}>📥 ตรวจสอบก่อน Import</div>
          <div style={{fontSize:12,color:"#9CA3AF",marginBottom:14}}>
            พบ {importPreview.length} รายการ — เพิ่ม {importPreview.filter(r=>!users.find(u=>(u.loginId||loginIdFromUser(u))===r.loginId||u.email===r.email)).length} / อัปเดต {importPreview.filter(r=>!!users.find(u=>(u.loginId||loginIdFromUser(u))===r.loginId||u.email===r.email)).length}
          </div>
          <div style={{background:"#F9FAFB",borderRadius:8,overflow:"hidden",border:"1px solid #F3F4F6",marginBottom:16}}>
            <div style={{display:"grid",gridTemplateColumns:"2fr 2fr 2fr 1fr 1fr",padding:"7px 12px",borderBottom:"1px solid #F3F4F6",background:"#F3F4F6"}}>{["ชื่อ-สกุล","Username","Email","แผนก","สิทธิ์"].map(h=><div key={h} style={{fontSize:10,fontWeight:700,color:"#6B7280"}}>{h}</div>)}</div>
            {importPreview.map((r,i)=>{const isDup=!!users.find(u=>(u.loginId||loginIdFromUser(u))===r.loginId||u.email===r.email);return <div key={i} style={{display:"grid",gridTemplateColumns:"2fr 2fr 2fr 1fr 1fr",padding:"7px 12px",borderBottom:"1px solid #F3F4F6",background:isDup?"#FFFBEB":"#fff"}}><div style={{fontSize:12,color:"#374151"}}>{r.name}{isDup&&<span style={{fontSize:10,color:"#B45309"}}> (อัปเดต)</span>}</div><div style={{fontSize:11,color:"#6B7280",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.loginId}</div><div style={{fontSize:11,color:"#6B7280",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.email}</div><div style={{fontSize:12,color:"#374151"}}>{r.dept||"-"}</div><div><RoleBadge role={r.role}/></div></div>;})}
          </div>
          <div style={{background:"#EFF6FF",border:"1px solid #BFDBFE",borderRadius:8,padding:"12px 14px",marginBottom:16}}>
            <div style={{fontSize:12,fontWeight:600,color:"#1E40AF",marginBottom:8}}>การส่งอีเมลแจ้งเตือน</div>
            <label style={{display:"flex",alignItems:"center",gap:8,marginBottom:6,fontSize:12,color:"#374151",cursor:"pointer"}}>
              <input type="checkbox" checked={importSendNew} onChange={e=>setImportSendNew(e.target.checked)}/>
              ส่งอีเมลให้ผู้ใช้ใหม่ (username + password + ลิงก์ตั้งรหัสผ่าน)
            </label>
            <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:"#374151",cursor:"pointer"}}>
              <input type="checkbox" checked={importSendUpdated} onChange={e=>setImportSendUpdated(e.target.checked)}/>
              ส่งอีเมลแจ้งผู้ใช้ที่ได้รับการอัปเดต
            </label>
          </div>
          {importStatus && (
            <div style={{background:"#FFFBEB",border:"1px solid #FCD34D",borderRadius:8,padding:"10px 14px",marginBottom:12,fontSize:12,color:"#92400E"}}>
              ⏳ {importStatus}
            </div>
          )}
          <div style={{display:"flex",gap:8}}>
            <button onClick={confirmImport} disabled={importing} style={{...BTN_GOLD,flex:1,padding:"10px",opacity:importing?0.6:1,cursor:importing?"wait":"pointer"}}>
              {importing ? "กำลังดำเนินการ..." : "✓ ยืนยัน Import"}
            </button>
            <button onClick={()=>!importing&&setImportPreview(null)} disabled={importing} style={{flex:1,padding:"10px",background:"#F9FAFB",color:"#6B7280",border:"1px solid #E5E7EB",borderRadius:6,fontSize:12,cursor:importing?"not-allowed":"pointer",opacity:importing?0.6:1}}>ยกเลิก</button>
          </div>
        </div>
      </div>}
    </div>
  );
}

// Default notify config shape (used by SettingsView)
const DEFAULT_NOTIFY = {
  email:     { enabled:false },
  teams:     { enabled:false, webhookUrl:"" },
  powerauto: { enabled:false, webhookUrl:"" },
  line:      { enabled:true, channelAccessToken:"", groupId:"" },
};

function SettingsView({ notifyConfig, emailTemplatesStored, showToast, onOpenPdfTemplate, onBackfillShareTokens, backfillPendingCount }) {
  const safe = ch => ({ ...(DEFAULT_NOTIFY[ch]||{}), ...((notifyConfig||{})[ch]||{}) });
  const [email,     setEmail]     = useState(()=>safe("email"));
  const [teams,     setTeams]     = useState(()=>safe("teams"));
  const [powerauto, setPowerauto] = useState(()=>safe("powerauto"));
  const [line,      setLine]      = useState(()=>safe("line"));
  const [emailTplTab, setEmailTplTab] = useState("forgotPassword");
  const [emailTemplates, setEmailTemplates] = useState(() => mergeEmailTemplates(emailTemplatesStored));
  const [backfilling, setBackfilling] = useState(false);

  useEffect(() => {
    setEmailTemplates(mergeEmailTemplates(emailTemplatesStored));
  }, [emailTemplatesStored]);

  const cfgMap  = { email, teams, powerauto, line };
  const setMap  = { email:setEmail, teams:setTeams, powerauto:setPowerauto, line:setLine };
  const setF    = (ch,k,v) => setMap[ch](p=>({...p,[k]:v}));

  const save = async () => {
    try {
      await writeNotifyConfig({ email, teams, powerauto, line });
      await writeEmailTemplates(emailTemplates);
      showToast("บันทึกการตั้งค่าแล้ว");
    } catch(e) { showToast("บันทึกไม่สำเร็จ: "+e.message,"error"); }
  };

  const resetEmailTemplate = () => {
    const def = DEFAULT_EMAIL_TEMPLATES[emailTplTab];
    setEmailTemplates(prev => ({ ...prev, [emailTplTab]: { ...def } }));
    showToast("รีเซ็ต template เป็นค่าเริ่มต้นแล้ว");
  };

  const setEmailTplField = (field, value) => {
    setEmailTemplates(prev => ({
      ...prev,
      [emailTplTab]: { ...prev[emailTplTab], [field]: value },
    }));
  };

  const activeTpl = emailTemplates[emailTplTab] || DEFAULT_EMAIL_TEMPLATES[emailTplTab];

  const CHANNELS = [
    { id:"email", icon:"✉", label:"อีเมล์ (SMTP บริษัท)", color:"#1E40AF",
      fields:[],
      guide:["ส่งจาก noreply.ememo@tgm.co.th ผ่าน mail.tgm.co.th:465 โดยอัตโนมัติ","ตั้งค่าตัวแปรใน Vercel Dashboard → Settings → Environment Variables:","SMTP_HOST = mail.tgm.co.th  |  SMTP_PORT = 465","SMTP_USER = noreply.ememo@tgm.co.th  |  SMTP_PASS = (รหัสผ่าน)","SMTP_FROM = \"E-Memo TGM\" <noreply.ememo@tgm.co.th>","เปิด Toggle แล้ว Redeploy — ไม่ต้องตั้งค่าอะไรเพิ่มในหน้านี้"] },
    { id:"teams",    icon:"🔵", label:"Microsoft Teams Webhook",        color:"#464EB8",
      fields:[{k:"webhookUrl",label:"Webhook URL",ph:"https://your-org.webhook.office.com/..."}],
      guide:["Teams → Channel → ⋯ → Connectors → Incoming Webhook","ตั้งชื่อ E-Memo → Create → Copy URL"] },
    { id:"powerauto",icon:"🟣", label:"SharePoint / Power Automate",   color:"#742774",
      fields:[{k:"webhookUrl",label:"HTTP Trigger URL",ph:"https://prod-xx.logic.azure.com/..."}],
      guide:["Power Automate → Automated Cloud Flow → When HTTP request received","Action: SharePoint Create news / Send email","Copy HTTP POST URL"] },
    { id:"line",     icon:"🟢", label:"LINE Messaging API (Group)",     color:"#06C755",
      fields:[{k:"channelAccessToken",label:"Channel Access Token",ph:"eyJ..."},{k:"groupId",label:"Group ID",ph:"C1234567890..."}],
      guide:["manager.line.biz → สร้าง Messaging API","developers.line.biz → Copy Token","เพิ่ม Bot เข้า Group → บันทึก Group ID จาก webhook event"] },
  ];

  return (
    <div style={{padding:24}}>
      <div style={{fontSize:18,fontWeight:600,color:"#111",marginBottom:4}}>ตั้งค่าระบบ</div>
      <div style={{fontSize:13,color:"#6B7280",marginBottom:20}}>ตั้งค่าการแจ้งเตือนและ Template เอกสาร</div>

      {/* CC link backfill */}
      <div style={{background:"#FFFBEB",border:"1px solid #FCD34D",borderRadius:10,padding:"12px 16px",marginBottom:20,display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
        <div>
          <div style={{fontSize:13,fontWeight:600,color:"#92400E"}}>🔗 ลิงก์ดูเอกสาร CC (ย้อนหลัง)</div>
          <div style={{fontSize:11,color:"#6B7280",marginTop:2,lineHeight:1.6}}>
            สร้างลิงก์ให้ Memo ที่อนุมัติครบแล้วก่อนหน้านี้ — ผู้รับ CC เปิดดูได้โดยไม่ต้อง login
            {backfillPendingCount > 0 && (
              <span style={{display:"block",marginTop:4,color:"#B45309",fontWeight:600}}>
                รออัปเดต {backfillPendingCount} ฉบับ
              </span>
            )}
          </div>
        </div>
        <button
          onClick={async () => {
            if (backfilling) return;
            setBackfilling(true);
            try {
              await onBackfillShareTokens?.(true);
            } finally {
              setBackfilling(false);
            }
          }}
          disabled={backfilling || backfillPendingCount === 0}
          style={{padding:"8px 16px",background:backfillPendingCount===0?"#E5E7EB":"#D4AF37",color:backfillPendingCount===0?"#9CA3AF":"#000",border:"none",borderRadius:6,fontSize:12,fontWeight:600,cursor:backfillPendingCount===0?"not-allowed":"pointer",flexShrink:0,fontFamily:"inherit"}}
        >
          {backfilling ? "กำลังอัปเดต..." : backfillPendingCount === 0 ? "✓ อัปเดตครบแล้ว" : "อัปเดตลิงก์ย้อนหลัง"}
        </button>
      </div>

      {/* PDF Template */}
      <div style={{background:"#EEEDFE",border:"1px solid #AFA9EC",borderRadius:10,padding:"12px 16px",marginBottom:20,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div>
          <div style={{fontSize:13,fontWeight:600,color:"#3C3489"}}>📄 Template เอกสาร (.docx)</div>
          <div style={{fontSize:11,color:"#6B7280",marginTop:2}}>อัปโหลด .docx template เพื่อ export เอกสารพร้อมลายเซ็น (ถ้าไม่มี ระบบใช้ built-in template แทน)</div>
        </div>
        <button onClick={onOpenPdfTemplate} style={{padding:"8px 16px",background:"#3C3489",color:"#fff",border:"none",borderRadius:6,fontSize:12,fontWeight:600,cursor:"pointer",flexShrink:0}}>
          จัดการ Template
        </button>
      </div>

      {/* Email account templates */}
      <div style={{background:"#fff",border:"1px solid #E5E7EB",borderRadius:10,padding:"16px",marginBottom:20}}>
        <div style={{fontSize:14,fontWeight:600,color:"#111",marginBottom:4}}>✉ Template อีเมลบัญชีผู้ใช้</div>
        <div style={{fontSize:11,color:"#6B7280",marginBottom:12}}>ส่งจาก noreply.ememo@tgm.co.th — ใช้ placeholder ด้านล่างใน Subject และ HTML</div>
        <div style={{display:"flex",gap:6,marginBottom:14,flexWrap:"wrap"}}>
          {EMAIL_TEMPLATE_TABS.map(tab => (
            <button key={tab.id} onClick={()=>setEmailTplTab(tab.id)}
              style={{padding:"6px 12px",borderRadius:6,border:`1px solid ${emailTplTab===tab.id?"#D4AF37":"#E5E7EB"}`,
                background:emailTplTab===tab.id?"#FFFBEB":"#F9FAFB",color:emailTplTab===tab.id?"#92400E":"#6B7280",
                fontSize:12,fontWeight:emailTplTab===tab.id?600:400,cursor:"pointer",fontFamily:"inherit"}}>
              {tab.label}
            </button>
          ))}
        </div>
        <div style={{fontSize:10,color:"#9CA3AF",marginBottom:10,lineHeight:1.8}}>
          Placeholder: {EMAIL_PLACEHOLDERS.join(", ")}
        </div>
        <div style={{marginBottom:10}}>
          <label style={{fontSize:11,fontWeight:600,color:"#6B7280",display:"block",marginBottom:4}}>Subject</label>
          <input value={activeTpl.subject||""} onChange={e=>setEmailTplField("subject",e.target.value)}
            style={{width:"100%",padding:"8px 10px",border:"1px solid #E5E7EB",borderRadius:6,fontSize:12,boxSizing:"border-box"}}/>
        </div>
        <div style={{marginBottom:10}}>
          <label style={{fontSize:11,fontWeight:600,color:"#6B7280",display:"block",marginBottom:4}}>HTML Body</label>
          <textarea value={activeTpl.html||""} onChange={e=>setEmailTplField("html",e.target.value)} rows={12}
            style={{width:"100%",padding:"8px 10px",border:"1px solid #E5E7EB",borderRadius:6,fontSize:11,fontFamily:"monospace",boxSizing:"border-box",resize:"vertical"}}/>
        </div>
        <div style={{marginBottom:10}}>
          <label style={{fontSize:11,fontWeight:600,color:"#6B7280",display:"block",marginBottom:4}}>Plain Text (fallback)</label>
          <textarea value={activeTpl.text||""} onChange={e=>setEmailTplField("text",e.target.value)} rows={4}
            style={{width:"100%",padding:"8px 10px",border:"1px solid #E5E7EB",borderRadius:6,fontSize:11,fontFamily:"monospace",boxSizing:"border-box",resize:"vertical"}}/>
        </div>
        <button onClick={resetEmailTemplate} style={{padding:"6px 12px",background:"#F9FAFB",color:"#6B7280",border:"1px solid #E5E7EB",borderRadius:6,fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>
          ↺ รีเซ็ตแท็บนี้เป็นค่าเริ่มต้น
        </button>
      </div>

      {/* Notification channels */}
      {CHANNELS.map(ch => {
        const c = cfgMap[ch.id] || {};
        return (
          <div key={ch.id} style={{background:"#fff",border:`1px solid ${c.enabled?"#E5E7EB":"#F3F4F6"}`,borderRadius:10,marginBottom:12,overflow:"hidden"}}>
            <div style={{display:"flex",alignItems:"center",gap:12,padding:"14px 16px",cursor:"pointer",background:c.enabled?"#F9FAFB":"transparent"}}
              onClick={()=>setF(ch.id,"enabled",!c.enabled)}>
              <span style={{fontSize:20}}>{ch.icon}</span>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:500,color:"#111"}}>{ch.label}</div>
                <div style={{fontSize:11,color:"#9CA3AF"}}>{c.enabled?"เปิดใช้งาน — กรอกข้อมูลด้านล่าง":"คลิกเพื่อเปิดใช้งาน"}</div>
              </div>
              <Toggle value={!!c.enabled} onChange={v=>{setF(ch.id,"enabled",v);}}/>
            </div>
            {c.enabled && (
              <div style={{padding:"14px 16px",borderTop:"1px solid #F3F4F6"}}>
                <div style={{padding:"10px 12px",background:ch.color+"18",border:`1px solid ${ch.color}44`,borderRadius:6,marginBottom:12}}>
                  <div style={{fontSize:11,fontWeight:600,color:ch.color,marginBottom:4}}>วิธีตั้งค่า</div>
                  {ch.guide.map((g,i)=><div key={i} style={{fontSize:11,color:"#6B7280",padding:"1px 0"}}>{i+1}. {g}</div>)}
                </div>
                <div style={{display:"grid",gridTemplateColumns:ch.fields.length>1?"1fr 1fr":"1fr",gap:8}}>
                  {ch.fields.map(f=>(
                    <div key={f.k} style={{marginBottom:6}}>
                      <label style={{fontSize:11,fontWeight:600,color:"#6B7280",display:"block",marginBottom:3}}>{f.label}</label>
                      <input value={c[f.k]||""} onChange={e=>setF(ch.id,f.k,e.target.value)} placeholder={f.ph}
                        style={{width:"100%",padding:"7px 9px",border:"1px solid #E5E7EB",borderRadius:6,fontSize:12,background:"#fff",color:"#111",boxSizing:"border-box"}}/>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}

      <button onClick={save} style={{display:"inline-flex",alignItems:"center",gap:4,padding:"9px 20px",background:"#D4AF37",color:"#111",border:"none",borderRadius:6,fontSize:13,fontWeight:600,cursor:"pointer"}}>
        💾 บันทึกการตั้งค่า
      </button>
    </div>
  );
}


class ErrorBoundary extends React.Component {
  constructor(props){ super(props); this.state={error:null}; }
  static getDerivedStateFromError(e){ return {error:e}; }
  componentDidCatch(e,info){ console.error("[E-Memo Error]",e,info); }
  render(){
    if(this.state.error){
      return (
        <div style={{padding:32,textAlign:"center",fontFamily:"'Noto Sans Thai','Sarabun',sans-serif"}}>
          <div style={{fontSize:32,marginBottom:12}}>⚠️</div>
          <div style={{fontSize:15,fontWeight:600,color:"#991B1B",marginBottom:8}}>เกิดข้อผิดพลาด</div>
          <div style={{fontSize:12,color:"#6B7280",marginBottom:20,maxWidth:400,margin:"0 auto 20px"}}>{this.state.error.message}</div>
          <button onClick={()=>this.setState({error:null})}
            style={{padding:"9px 20px",background:"#D4AF37",color:"#111",border:"none",borderRadius:7,fontSize:13,fontWeight:600,cursor:"pointer"}}>
            ลองใหม่
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Inline PDF Preview (no external import needed) ────────────────────────
function injectPrintCss(){
  if(document.getElementById("ememo-print-css"))return;
  const s=document.createElement("style");s.id="ememo-print-css";
  s.textContent=`@media print{body>*{display:none!important;}#ememo-print-root{display:block!important;}#ememo-print-root table{page-break-inside:avoid;}#ememo-print-root .page-break{page-break-before:always;}}#ememo-print-root{display:none;font-family:'Noto Sans Thai','Sarabun',sans-serif;}`;
  document.head.appendChild(s);
}

function MemoPDFPreview({ memo, users, curUser, onSaveZones, onClose }) {
  const [zones, setZones] = useState((memo.signatureZones||[]).map((z,i)=>({...z,x:z.x??(10+i*35),y:z.y??72})));
  const [printing, setPrinting] = useState(false);
  const [dragInfo, setDragInfo] = useState(null); // {idx, startX, startY, origX, origY}
  const previewRef = useRef();

  useEffect(()=>{ injectPrintCss(); }, []);

  // fallback to curUser when memo.createdBy not set yet (new unsaved memo)
  const creator = users.find(u=>u.id===memo.createdBy) || curUser || {};
  const allUsers = users.filter(u=>u.active);
  const approvals = (memo.workflowLevels||[]).flatMap(lv=>lv.approvers||[]);
  const fmtD = s => !s?"-":new Date(s).toLocaleDateString("th-TH",{day:"2-digit",month:"long",year:"numeric"})+" "+new Date(s).toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit"});

  const addZone  = () => setZones(p=>[...p,{id:"sz"+Date.now(),label:`จุดลงนาม ${p.length+1}`,x:10+(p.length%3)*30,y:70+Math.floor(p.length/3)*15,assignedTo:"",signerName:""}]);
  const remZone  = i => setZones(p=>p.filter((_,j)=>j!==i));
  const labelZone= (i,v) => setZones(p=>p.map((z,j)=>j===i?{...z,label:v}:z));
  const assignZone=(i,uid)=>{ const u=users.find(x=>x.id===uid)||{}; setZones(p=>p.map((z,j)=>j===i?{...z,assignedTo:uid,signerName:u.name||""}:z)); };

  // Mouse drag on preview
  const onZoneMouseDown=(e,i)=>{
    if(e.target.tagName==="INPUT"||e.target.tagName==="BUTTON"||e.target.tagName==="SELECT")return;
    e.preventDefault();
    const rect=previewRef.current?.getBoundingClientRect();
    if(!rect)return;
    setDragInfo({idx:i,mx:e.clientX,my:e.clientY,ox:zones[i].x||0,oy:zones[i].y||0,cw:rect.width,ch:rect.height});
  };
  useEffect(()=>{
    if(!dragInfo)return;
    const onMove=e=>{
      const dx=((e.clientX-dragInfo.mx)/dragInfo.cw)*100;
      const dy=((e.clientY-dragInfo.my)/dragInfo.ch)*100;
      const nx=Math.max(0,Math.min(dragInfo.ox+dx,82));
      const ny=Math.max(0,Math.min(dragInfo.oy+dy,90));
      setZones(p=>p.map((z,j)=>j===dragInfo.idx?{...z,x:nx,y:ny}:z));
    };
    const onUp=()=>setDragInfo(null);
    window.addEventListener("mousemove",onMove);
    window.addEventListener("mouseup",onUp);
    return()=>{ window.removeEventListener("mousemove",onMove); window.removeEventListener("mouseup",onUp); };
  },[dragInfo]);

  const handlePrint=()=>{
    setPrinting(true);
    const fD=fmtD; const C=COMPANY;
    let root=document.getElementById("ememo-print-root");
    if(!root){root=document.createElement("div");root.id="ememo-print-root";document.body.appendChild(root);}
    // Inject print CSS once
    if(!document.getElementById("ememo-print-css")){
      const s=document.createElement("style");s.id="ememo-print-css";
      s.textContent=`
        @media print{
          body>*{display:none!important;}
          #ememo-print-root{display:block!important;}
          #ememo-print-root .rpt-header{position:fixed;top:0;left:0;right:0;background:#fff;padding:8mm 16mm 4mm;border-bottom:2px solid #1E3A5F;z-index:1000;}
          #ememo-print-root .rpt-footer{position:fixed;bottom:0;left:0;right:0;background:#fff;padding:3mm 16mm 5mm;border-top:1px solid #E5E7EB;font-size:9px;color:#9CA3AF;display:flex;justify-content:space-between;}
          #ememo-print-root .rpt-body{margin-top:36mm;margin-bottom:16mm;padding:0 16mm;}
          #ememo-print-root table{page-break-inside:avoid;}
          @page{margin:0;size:A4;@bottom-right{content:"หน้า " counter(page) " / " counter(pages);font-size:9px;color:#9CA3AF;}}
        }
        #ememo-print-root{display:none;font-family:'Noto Sans Thai','Sarabun',sans-serif;}
      `;
      document.head.appendChild(s);
    }
    // Generate draft docNo for preview if not yet assigned
    const displayDocNo = memo.docNo || ("DRAFT-"+memo.id?.slice(-6)?.toUpperCase());
    // Fixed header
    let html='<div class="rpt-header">';
    html+='<div style="display:flex;align-items:center;gap:14px;">';
    html+='<img src="https://img1.pic.in.th/images/logo-tss-03.png" style="height:40px;object-fit:contain;" alt="logo"/>';
    html+='<div style="flex:1;">';
    html+='<div style="font-size:11px;font-weight:700;color:#1E3A5F;">'+C+'</div>';
    html+='<div style="font-size:14px;font-weight:700;">บันทึกข้อความ (Memo)';
    html+=' <span style="font-size:10px;color:#6B7280;font-family:monospace;font-weight:400;">เลขที่ '+displayDocNo+'</span></div>';
    html+='</div>';
    html+='<div style="font-size:9px;color:#9CA3AF;text-align:right;">'+fD(new Date().toISOString())+'</div>';
    html+='</div></div>';
    // Fixed footer
    html+='<div class="rpt-footer"><span>'+C+'</span><span>เลขที่ '+displayDocNo+'</span></div>';
    // Body content
    html+='<div class="rpt-body" style="font-family:Noto Sans Thai,Sarabun,sans-serif;font-size:13px;color:#111;">';
    // If uploaded file (image), embed
    if(memo.uploadedFile&&(memo.uploadedFile.type==="png"||memo.uploadedFile.type==="jpg"||memo.uploadedFile.type==="jpeg")){
      html+='<img src="'+memo.uploadedFile.data+'" style="max-width:100%;display:block;margin:0 auto 12px;"/>';
      if(memo.content) html+='<div style="font-size:12px;color:#374151;white-space:pre-wrap;margin-bottom:12px;">หมายเหตุ: '+memo.content+'</div>';
    } else {
      // Meta table (uses creator from outer scope — fallback to curUser already applied)
      html+='<table style="width:100%;border-collapse:collapse;margin-bottom:14px;font-size:12px;"><tbody>';
      html+='<tr><td style="color:#6B7280;padding:3px 0;">เรื่อง:</td><td style="font-weight:600;" colspan="3">'+(memo.title||"")+'</td></tr>';
      html+='<tr><td style="color:#6B7280;padding:3px 0;">หมวดหมู่:</td><td>'+(memo.category||"")+'</td><td style="color:#6B7280;text-align:right;">ผู้สร้าง:</td><td style="text-align:right;">'+(creator.name||"-")+(creator.dept?" ("+creator.dept+")": "")+'</td></tr>';
      html+='</tbody></table>';
      html+='<div style="border-top:1px solid #E5E7EB;margin-bottom:18px;"></div>';
      // Content
      html+='<div style="font-size:13px;line-height:1.9;word-break:break-word;margin-bottom:28px;">'+(memo.content||"")+'</div>';
    }
    // Signature zones
    if(zones.length>0){
      html+='<div style="margin-top:24px;border-top:1px solid #E5E7EB;padding-top:18px;"><div style="font-size:11px;color:#6B7280;font-weight:600;margin-bottom:12px;">ลงนาม</div>';
      html+='<div style="display:flex;gap:24px;flex-wrap:wrap;">';
      zones.forEach(z=>{
        const u=users.find(x=>x.id===z.assignedTo)||{};
        const sig=u.signature||"";
        html+='<div style="flex:1;min-width:140px;text-align:center;">';
        if(sig) html+='<img src="'+sig+'" style="height:48px;display:block;margin:0 auto 4px;"/>';
        else html+='<div style="height:48px;border-bottom:1px solid #111;margin-bottom:6px;"></div>';
        html+='<div style="font-size:11px;font-weight:600;">'+(z.label||"จุดลงนาม")+'</div>';
        if(u.name||z.signerName) html+='<div style="font-size:10px;color:#6B7280;">'+(u.name||z.signerName||"")+'</div>';
        html+='</div>';
      });
      html+='</div></div>';
    }
    // Approval table
    const approvals=(memo.workflowLevels||[]).flatMap(lv=>lv.approvers||[]);
    if(approvals.length>0){
      html+='<div style="margin-top:24px;border-top:1px solid #E5E7EB;padding-top:14px;">';
      html+='<div style="font-size:11px;color:#6B7280;font-weight:600;margin-bottom:8px;">ขั้นตอนการอนุมัติ</div>';
      html+='<table style="width:100%;border-collapse:collapse;font-size:11px;">';
      html+='<tr style="background:#F9FAFB;"><th style="text-align:left;padding:5px 8px;border:1px solid #E5E7EB;">ผู้อนุมัติ</th><th style="text-align:center;padding:5px 8px;border:1px solid #E5E7EB;width:80px;">สถานะ</th><th style="text-align:center;padding:5px 8px;border:1px solid #E5E7EB;width:140px;">วันที่ / เวลา</th><th style="text-align:left;padding:5px 8px;border:1px solid #E5E7EB;">ลายเซ็น / ความคิดเห็น</th></tr>';
      approvals.forEach(ap=>{
        const u2=users.find(x=>x.id===ap.userId)||{};
        const sl=ap.status==="approved"?"✓ อนุมัติ":ap.status==="rejected"?"✗ ปฏิเสธ":"○ รอ";
        const sig2=ap.signature||u2.signature||"";
        html+='<tr><td style="padding:5px 8px;border:1px solid #E5E7EB;">'+(ap.name||u2.name||ap.email||"-")+'</td>';
        html+='<td style="padding:5px 8px;border:1px solid #E5E7EB;text-align:center;">'+sl+'</td>';
        html+='<td style="padding:5px 8px;border:1px solid #E5E7EB;text-align:center;">'+(ap.actionAt?fD(ap.actionAt):"-")+'</td>';
        html+='<td style="padding:5px 8px;border:1px solid #E5E7EB;">';
        if(sig2) html+='<img src="'+sig2+'" style="height:32px;display:block;margin-bottom:2px;border:1px solid #E5E7EB;border-radius:3px;background:#fff;padding:2px;"/>';
        html+=(ap.comment||"")+'</td></tr>';
      });
      html+='</table></div>';
    }
    html+='</div>'; // close rpt-body
    root.innerHTML=html;
    setTimeout(()=>{ window.print(); setTimeout(()=>{ root.innerHTML=""; setPrinting(false); },500); },200);
  };


  return (
    <div style={{position:"fixed",inset:0,zIndex:300,display:"flex",background:"rgba(0,0,0,.75)",fontFamily:"'Noto Sans Thai','Sarabun',sans-serif"}}>
      {/* Left controls */}
      <div style={{width:260,background:"#111",color:"#fff",display:"flex",flexDirection:"column",flexShrink:0}}>
        <div style={{padding:"16px 16px 12px",borderBottom:"1px solid #222"}}>
          <div style={{fontSize:13,fontWeight:600,color:GOLD}}>ตัวอย่างเอกสาร + PDF</div>
          <div style={{fontSize:11,color:"#555",marginTop:2}}>ลากจุด ✍ บนเอกสารเพื่อย้ายตำแหน่ง</div>
        </div>
        <div style={{flex:1,overflowY:"auto",padding:14}}>
          <div style={{fontSize:11,fontWeight:600,color:"#aaa",marginBottom:10,textTransform:"uppercase",letterSpacing:.5}}>จุดลงนาม</div>
          {zones.map((z,i)=>(
            <div key={z.id||i} style={{background:"#1a1a1a",border:"1px solid #333",borderRadius:7,padding:10,marginBottom:8}}>
              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:7}}>
                <span style={{fontSize:11,color:GOLD,fontWeight:600}}>✍ จุด {i+1}</span>
                <button onClick={()=>remZone(i)} style={{marginLeft:"auto",background:"none",border:"none",cursor:"pointer",fontSize:14,color:"#666",padding:0,fontFamily:"inherit"}}>✕</button>
              </div>
              <div style={{marginBottom:6}}>
                <div style={{fontSize:10,color:"#666",marginBottom:3}}>ชื่อตำแหน่ง</div>
                <input value={z.label||""} onChange={e=>labelZone(i,e.target.value)} style={{width:"100%",background:"#222",border:"1px solid #333",borderRadius:5,color:"#fff",fontSize:11,padding:"5px 8px",fontFamily:"inherit",boxSizing:"border-box"}}/>
              </div>
              <div>
                <div style={{fontSize:10,color:"#666",marginBottom:3}}>มอบหมายให้</div>
                <select value={z.assignedTo||""} onChange={e=>assignZone(i,e.target.value)} style={{width:"100%",background:"#222",border:"1px solid #333",borderRadius:5,color:"#fff",fontSize:11,padding:"5px 8px",fontFamily:"inherit"}}>
                  <option value="">-- เลือกผู้ลงนาม --</option>
                  {users.filter(u=>u.active).map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
            </div>
          ))}
          <button onClick={addZone} style={{width:"100%",padding:"8px",background:"transparent",border:`1px dashed ${GOLD}`,borderRadius:6,color:GOLD,fontSize:12,cursor:"pointer",fontFamily:"inherit",fontWeight:500}}>+ เพิ่มจุดลงนาม</button>
        </div>
        <div style={{padding:14,borderTop:"1px solid #222",display:"flex",flexDirection:"column",gap:8}}>
          <button onClick={handlePrint} disabled={printing} style={{width:"100%",padding:"10px",background:GOLD,color:BLACK,border:"none",borderRadius:6,fontSize:13,fontWeight:700,cursor:printing?"not-allowed":"pointer",fontFamily:"inherit",opacity:printing?.7:1}}>
            {printing?"กำลังเตรียม...":"🖨️ โหลด / พิมพ์ PDF"}
          </button>
          <button onClick={()=>onSaveZones(zones)} style={{width:"100%",padding:"10px",background:"#1D4ED8",color:"#fff",border:"none",borderRadius:6,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
            💾 บันทึกจุดลงนาม
          </button>
          <button onClick={onClose} style={{width:"100%",padding:"9px",background:"transparent",color:"#666",border:"1px solid #333",borderRadius:6,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
            ✕ ปิด
          </button>
        </div>
      </div>
      {/* A4 preview */}
      <div style={{flex:1,overflowY:"auto",padding:"24px 32px",display:"flex",justifyContent:"center",alignItems:"flex-start"}}>
        <div style={{width:"100%",maxWidth:720}}>
          <div style={{fontSize:12,color:"#888",marginBottom:12}}>ตัวอย่างเอกสาร A4 — ลากจุด ✍ เพื่อย้ายตำแหน่ง</div>
          <div ref={previewRef} style={{background:"#fff",borderRadius:4,boxShadow:"0 4px 40px rgba(0,0,0,.5)",padding:"32px 36px",position:"relative",minHeight:900,userSelect:"none"}}>
            {zones.map((z,i)=>(
              <div key={z.id||i} onMouseDown={e=>{
                if(e.target.tagName==="INPUT"||e.target.tagName==="BUTTON"||e.target.tagName==="SELECT")return;
                e.preventDefault();
                const rect=previewRef.current?.getBoundingClientRect();
                if(!rect)return;
                setDragInfo({idx:i,mx:e.clientX,my:e.clientY,ox:zones[i].x||0,oy:zones[i].y||0,cw:rect.width,ch:rect.height});
              }}
                style={{position:"absolute",left:`${z.x||10}%`,top:`${z.y||70}%`,width:160,border:`2px dashed ${GOLD}`,borderRadius:4,background:"rgba(212,175,55,.08)",padding:"4px 8px",cursor:"move",zIndex:10,boxSizing:"border-box"}}>
                <div style={{fontSize:10,color:GOLD,fontWeight:600,marginBottom:2}}>✍ จุด {i+1} — {z.label||"ลงนาม"}</div>
                {z.signerName&&<div style={{fontSize:9,color:"#6B7280"}}>@ {z.signerName}</div>}
                <div style={{height:32,borderBottom:"1px solid #333",margin:"4px 0"}}/>
              </div>
            ))}
            {/* If uploaded file (image), show as preview doc */}
            {memo.uploadedFile && (memo.uploadedFile.type==="png"||memo.uploadedFile.type==="jpg"||memo.uploadedFile.type==="jpeg") ? (
              <div>
                <img src={memo.uploadedFile.data} alt="uploaded"
                  style={{maxWidth:"100%",display:"block",margin:"0 auto 12px"}}/>
                <div style={{borderTop:"1px solid #E5E7EB",paddingTop:8,marginBottom:12,fontSize:11,color:"#6B7280",textAlign:"center"}}>
                  📄 {memo.uploadedFile.name} — ลากจุด ✍ เพื่อวางลายเซ็น
                </div>
                {memo.content&&<div style={{fontSize:12,color:"#374151",marginBottom:12}}><span style={{color:"#9CA3AF"}}>หมายเหตุ: </span><span dangerouslySetInnerHTML={{__html:memo.content}}/></div>}
              </div>
            ) : memo.uploadedFile && memo.uploadedFile.type==="pdf" ? (
              <div>
                <PdfBlobViewer dataUrl={memo.uploadedFile.data} name={memo.uploadedFile.name} height={620}/>
                {memo.content&&<div style={{fontSize:12,color:"#374151",marginBottom:12}}><span style={{color:"#9CA3AF"}}>หมายเหตุ: </span><span dangerouslySetInnerHTML={{__html:memo.content}}/></div>}
              </div>
            ) : (
            <div style={{display:"flex",alignItems:"center",gap:14,borderBottom:"2px solid #1E3A5F",paddingBottom:10,marginBottom:18}}>
              <img
                src="https://img1.pic.in.th/images/logo-tss-03.png"
                alt="logo"
                style={{height:52,objectFit:"contain",flexShrink:0,borderRadius:4}}
                onError={e=>e.target.style.display="none"}
              />
              <div style={{flex:1}}>
                <div style={{fontSize:12,fontWeight:700,color:"#1E3A5F"}}>{COMPANY}</div>
                <div style={{fontSize:17,fontWeight:700,marginTop:2}}>บันทึกข้อความ (Memo)</div>
              </div>
              <div style={{textAlign:"right",flexShrink:0}}>
                <div style={{fontSize:12,fontFamily:"monospace",fontWeight:700,color:"#1E3A5F"}}>{memo.docNo||("DRAFT-"+(memo.id||"").slice(-6).toUpperCase())}</div>
                <div style={{fontSize:10,color:"#9CA3AF",marginTop:2}}>{memo.createdAt?new Date(memo.createdAt).toLocaleDateString("th-TH",{day:"2-digit",month:"long",year:"numeric"}):""}</div>
              </div>
            </div>
            )} {/* end uploadedFile ternary */}
            {!memo.uploadedFile && <><table style={{width:"100%",borderCollapse:"collapse",marginBottom:14,fontSize:12}}>
              <tbody>
                <tr>
                  <td style={{width:80,color:"#6B7280",padding:"3px 0",verticalAlign:"top"}}>เรื่อง:</td>
                  <td style={{fontWeight:600,padding:"3px 0"}} colSpan={3}>{memo.title||<span style={{color:"#ccc"}}>ยังไม่ได้กรอก</span>}</td>
                </tr>
                <tr>
                  <td style={{color:"#6B7280",padding:"3px 0"}}>หมวดหมู่:</td>
                  <td style={{padding:"3px 0"}}>{memo.category||"-"}</td>
                  <td style={{width:70,color:"#6B7280",padding:"3px 0",textAlign:"right"}}>ผู้สร้าง:</td>
                  <td style={{padding:"3px 0",textAlign:"right"}}>
                    {creator.name||<span style={{color:"#ccc"}}>ไม่พบ</span>}
                    {creator.dept&&<span style={{color:"#9CA3AF",fontWeight:400}}> ({creator.dept})</span>}
                  </td>
                </tr>
              </tbody>
            </table>
            <div style={{borderTop:"1px solid #E5E7EB",marginBottom:20}}/>
            <div style={{fontSize:13,lineHeight:1.9,color:"#374151",minHeight:100,marginBottom:28}}
              dangerouslySetInnerHTML={{__html: memo.content||'<span style="color:#ccc;font-style:italic">เนื้อหาจะแสดงที่นี่...</span>'}}/>
            </>}
            {zones.length===0&&<div style={{padding:16,background:"#F9FAFB",border:"1px dashed #E5E7EB",borderRadius:6,textAlign:"center",color:"#9CA3AF",fontSize:12}}>กด "+ เพิ่มจุดลงนาม" แล้วลากไปวางตำแหน่งที่ต้องการบนเอกสาร</div>}
            {approvals.length>0&&(
              <div style={{marginTop:32,borderTop:"1px solid #E5E7EB",paddingTop:16}}>
                <div style={{fontSize:11,color:"#6B7280",marginBottom:10,fontWeight:600,textTransform:"uppercase",letterSpacing:.5}}>ขั้นตอนการอนุมัติ</div>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}><thead>
                  <tr style={{background:"#F9FAFB"}}>{["ผู้อนุมัติ","สถานะ","วันที่","ลายเซ็น/ความคิดเห็น"].map(h=><th key={h} style={{textAlign:"left",padding:"6px 10px",border:"1px solid #E5E7EB",fontWeight:600,color:"#6B7280"}}>{h}</th>)}</tr>
                </thead><tbody>
                  {approvals.map((ap,i)=>{
                    const u=users.find(x=>x.id===ap.userId)||{};
                    const sc=ap.status==="approved"?{c:"#065F46",l:"✓ อนุมัติ"}:ap.status==="rejected"?{c:"#991B1B",l:"✗ ปฏิเสธ"}:{c:"#B45309",l:"○ รอ"};
                    const sigImg=ap.signature||u.signature||null;
                    return <tr key={i}>
                      <td style={{padding:"6px 10px",border:"1px solid #E5E7EB"}}>{ap.name||u.name||ap.email||"-"}</td>
                      <td style={{padding:"6px 10px",border:"1px solid #E5E7EB",color:sc.c,fontWeight:500}}>{sc.l}</td>
                      <td style={{padding:"6px 10px",border:"1px solid #E5E7EB",color:"#6B7280",whiteSpace:"nowrap"}}>
                        {ap.actionAt
                          ? <><div>{new Date(ap.actionAt).toLocaleDateString("th-TH",{day:"2-digit",month:"short",year:"numeric"})}</div>
                              <div style={{fontSize:10,color:"#9CA3AF"}}>{new Date(ap.actionAt).toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit"})}</div></>
                          : "-"}
                      </td>
                      <td style={{padding:"6px 10px",border:"1px solid #E5E7EB"}}>
                        {sigImg&&<img src={sigImg} alt="sig" style={{height:32,display:"block",marginBottom:2,border:"1px solid #E5E7EB",borderRadius:3,background:"#fff",padding:2}}/>}
                        <span style={{fontSize:11,color:"#6B7280"}}>{ap.comment||""}</span>
                      </td>
                    </tr>;
                  })}
                </tbody></table>
              </div>
            )}
            <div style={{marginTop:48,borderTop:"1px solid #F3F4F6",paddingTop:8,display:"flex",justifyContent:"space-between",fontSize:10,color:"#9CA3AF"}}>
              <span>{COMPANY}</span><span>พิมพ์เมื่อ {fmtD(new Date().toISOString())}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
// ── RouteListView ─────────────────────────────────────────────────────────────
function RouteListView({ routeTemplates, curUser, onManage }) {
  const myRoutes = (routeTemplates||[]).filter(r=>r.createdBy===curUser.id);
  return (
    <div style={{padding:24}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}>
        <div>
          <div style={{fontSize:18,fontWeight:600,color:"#111"}}>🔀 Route การอนุมัติที่ใช้บ่อย</div>
          <div style={{fontSize:12,color:"#9CA3AF",marginTop:2}}>บันทึก workflow ที่ต้องการใช้ซ้ำ — โหลดเข้า Memo ใหม่ได้ในคลิกเดียว</div>
        </div>
        <button onClick={onManage} style={{...BTN_GOLD,padding:"8px 16px"}}>+ จัดการ Route</button>
      </div>
      {myRoutes.length===0 ? (
        <div style={{textAlign:"center",padding:"64px 0",color:"#9CA3AF",fontSize:13,border:"2px dashed #E5E7EB",borderRadius:12}}>
          <div style={{fontSize:36,marginBottom:8}}>🔀</div>
          <div style={{fontWeight:500,marginBottom:4}}>ยังไม่มี Route</div>
          <div style={{fontSize:12}}>กด "จัดการ Route" เพื่อสร้าง workflow ที่ใช้บ่อย</div>
        </div>
      ) : (
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:12}}>
          {myRoutes.map(r=>(
            <div key={r.id} style={{background:"#fff",border:"1px solid #F3F4F6",borderRadius:10,padding:16,boxShadow:"0 1px 4px rgba(0,0,0,.05)"}}>
              <div style={{fontSize:14,fontWeight:600,color:"#111",marginBottom:4}}>🔀 {r.name}</div>
              {r.desc&&<div style={{fontSize:12,color:"#6B7280",marginBottom:8}}>{r.desc}</div>}
              <div style={{display:"flex",flexDirection:"column",gap:4}}>
                {(r.levels||[]).map((lv,i)=>(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:6,padding:"5px 8px",background:"#F9FAFB",borderRadius:5,fontSize:11}}>
                    <span style={{width:18,height:18,background:GOLD,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700,color:BLACK,flexShrink:0}}>{i+1}</span>
                    <span style={{flex:1,color:"#374151"}}>{(lv.approvers||[]).map(a=>a.name||a.email).join(", ")}</span>
                    <span style={{color:"#9CA3AF",fontSize:10}}>{lv.mode==="any"?"คนใดคนหนึ่ง":"ทุกคน"}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RecallSmartModal({ memo, onRecallAndEdit, onRecallOnly, onCancel }) {
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.45)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999,padding:16}}>
      <div style={{background:"#fff",border:"1px solid #E5E7EB",borderRadius:14,padding:24,width:380,maxWidth:"100%",boxShadow:"0 20px 60px rgba(0,0,0,.25)",fontFamily:"'Noto Sans Thai','Sarabun',sans-serif"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
          <span style={{fontSize:26,lineHeight:1}}>🤖</span>
          <div>
            <div style={{fontSize:15,fontWeight:700,color:"#111"}}>ต้องการแก้ไขข้อความด้วยไหม?</div>
            <div style={{fontSize:11,color:"#6B7280",marginTop:2}}>ลดการสร้างเอกสารใหม่ทุกครั้ง</div>
          </div>
        </div>
        <div style={{background:"#EFF6FF",border:"1px solid #BFDBFE",borderRadius:8,padding:"10px 12px",marginBottom:16,fontSize:12,color:"#1E40AF"}}>
          <strong style={{display:"block",marginBottom:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{memo.title}</strong>
          ระบบตรวจพบว่าคุณกำลังเรียกคืน Memo — หากต้องการแก้ไขเนื้อหา สามารถเปิดหน้าแก้ไขได้ทันทีโดยไม่ต้องสร้างเอกสารใหม่
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          <button onClick={onRecallAndEdit} style={{padding:11,background:"#1D4ED8",color:"#fff",border:"none",borderRadius:8,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
            ✎ เรียกคืนและแก้ไขทันที
          </button>
          <button onClick={onRecallOnly} style={{padding:10,background:"#EFF6FF",color:"#1E40AF",border:"1px solid #BFDBFE",borderRadius:8,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
            ↩ เรียกคืนเท่านั้น
          </button>
          <button onClick={onCancel} style={{padding:10,background:"#F9FAFB",color:"#6B7280",border:"1px solid #E5E7EB",borderRadius:8,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
            ยกเลิก
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteConfirmModal({ memo, onConfirm, onCancel }) {
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.45)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999,padding:16}}>
      <div style={{background:"#fff",border:"1px solid #E5E7EB",borderRadius:14,padding:24,width:400,maxWidth:"100%",boxShadow:"0 20px 60px rgba(0,0,0,.25)",fontFamily:"'Noto Sans Thai','Sarabun',sans-serif"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
          <span style={{fontSize:26,lineHeight:1}}>🗑</span>
          <div>
            <div style={{fontSize:15,fontWeight:700,color:"#111"}}>ย้าย Memo ไปถังขยะ?</div>
            <div style={{fontSize:11,color:"#6B7280",marginTop:2}}>Super Admin เท่านั้นที่กู้คืนได้ภายหลัง</div>
          </div>
        </div>
        <div style={{background:"#FFF1F1",border:"1px solid #FECACA",borderRadius:8,padding:"10px 12px",marginBottom:16,fontSize:12,color:"#991B1B"}}>
          <strong style={{display:"block",marginBottom:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{memo.title}</strong>
          Memo จะหายจากรายการทั้งหมด แต่ยังเก็บไว้ในเมนู "ถังขยะ"
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          <button onClick={onConfirm} style={{padding:11,background:"#DC2626",color:"#fff",border:"none",borderRadius:8,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
            🗑 ยืนยันลบ (ย้ายไปถังขยะ)
          </button>
          <button onClick={onCancel} style={{padding:10,background:"#F9FAFB",color:"#6B7280",border:"1px solid #E5E7EB",borderRadius:8,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
            ยกเลิก
          </button>
        </div>
      </div>
    </div>
  );
}

export default function EMemo() {
  const resetLinkActive = isResetPasswordLink();
  const [authUser,      setAuthUser]      = useState(undefined);
  const [data,          setData]          = useState(null);
  const [view,          setView]          = useState("dashboard");
  const [selId,         setSelId]         = useState(null);
  const [editMemo,      setEditMemo]      = useState(null);
  const [modal,         setModal]         = useState(null);
  const [recallConfirm, setRecallConfirm] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [toast,         setToast]         = useState(null);
  const [syncing,       setSyncing]       = useState(false);
  const [showTplManager,  setShowTplManager]  = useState(false);
  const [showRouteManager,setShowRouteManager]= useState(false);
  const [showProfile,     setShowProfile]     = useState(false);
  const [showSigZones,    setShowSigZones]    = useState(false);
  const [showAiUpdate,    setShowAiUpdate]    = useState(false);
  const shareBackfillRan = useRef(false);

  useEffect(()=>{ const u=onAuthStateChanged(auth,u=>setAuthUser(u||null)); return()=>u(); },[]);
  useEffect(() => {
    if (!authUser || !data) return;
    const u = Object.values(data.users || {}).find(x => x.email === authUser.email);
    if (u?.onboardingPending || u?.mustChangePassword) return;
    if (!localStorage.getItem("ememo_ai_update_v1_seen")) {
      const t = setTimeout(() => setShowAiUpdate(true), 800);
      return () => clearTimeout(t);
    }
  }, [authUser, data]);
  useEffect(()=>{ if(!authUser)return; const u=onValue(ref(db,DATA_PATH),snap=>setData(snap.val()||{users:{},memos:{},notifyConfig:{}})); return()=>u(); },[authUser]);
  useEffect(() => {
    if (!data?.memos || !authUser || shareBackfillRan.current) return;
    const cur = Object.values(data.users || {}).find(u => u.email === authUser.email);
    if (!cur || !["superadmin", "admin"].includes(cur.role)) return;
    if (countMemosNeedingShareToken(data.memos) === 0) return;

    shareBackfillRan.current = true;
    (async () => {
      try {
        const result = await runShareTokenBackfill(data.memos);
        if (result.updated > 0) {
          setToast({ msg: `อัปเดตลิงก์ CC ย้อนหลัง ${result.updated} ฉบับ`, type: "success" });
          setTimeout(() => setToast(null), 3200);
        }
      } catch (err) {
        console.warn("[share-token-backfill]", err.message || err);
        shareBackfillRan.current = false;
      }
    })();
  }, [data, authUser]);

  // ── History API (must be before early returns — Rules of Hooks) ──────────
  useEffect(() => {
    if (resetLinkActive) return;
    const onPop = (e) => {
      const s = e.state;
      if (s?.view) { setView(s.view); setSelId(s.selId||null); setEditMemo(null); }
      else { setView("dashboard"); setSelId(null); }
    };
    window.addEventListener("popstate", onPop);
    window.history.replaceState({ view:"dashboard" }, "", window.location.pathname);
    return () => window.removeEventListener("popstate", onPop);
  }, [resetLinkActive]);

  const showToast=(msg,type="success")=>{ setToast({msg,type}); setTimeout(()=>setToast(null),3200); };

  const handleBackfillShareTokens = async (manual = false) => {
    if (!data?.memos) return { updated: 0 };
    const pending = countMemosNeedingShareToken(data.memos);
    if (!pending) {
      if (manual) showToast("ลิงก์ CC ย้อนหลังอัปเดตครบแล้ว");
      return { updated: 0 };
    }
    const result = await runShareTokenBackfill(data.memos);
    if (result.updated > 0) {
      showToast(`อัปเดตลิงก์ CC ย้อนหลัง ${result.updated} ฉบับ`);
    } else if (manual) {
      showToast("ไม่มี Memo ที่ต้องอัปเดต");
    }
    return result;
  };

  if (resetLinkActive) return <ResetPassword/>;
  if (isPublicMemoLink()) return <PublicMemoView/>;
  if (authUser===undefined) return <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:BLACK,fontFamily:"'Noto Sans Thai','Sarabun',sans-serif"}}><div style={{textAlign:"center"}}><div style={{width:40,height:40,background:GOLD,borderRadius:10,margin:"0 auto 12px",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,color:BLACK,fontWeight:700}}>E</div><div style={{color:"#666",fontSize:13}}>กำลังโหลด...</div></div></div>;
  if (!authUser) return <Login/>;
  if (!data) return <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"#F9FAFB",fontSize:13,color:"#6B7280",fontFamily:"'Noto Sans Thai','Sarabun',sans-serif"}}>กำลังโหลดข้อมูล...</div>;

  const pushHistory = (v, extra={}) => window.history.pushState({ view:v, ...extra }, "", window.location.pathname);

  const users         = Object.values(data.users    ||{});
  const memoList      = Object.values(data.memos    ||{}).filter(m => !isMemoDeleted(m));
  const trashMemos    = Object.values(data.memos    ||{}).filter(m => isMemoDeleted(m));
  const notifyConfig  = data.notifyConfig||{email:{},teams:{},powerauto:{},line:{}};
  const emailTemplates = mergeEmailTemplates(data.emailTemplates);
  const pdfTemplates  = data.pdfTemplates ||{};
  const docCounters   = data.docCounters  ||{};
  const routeTemplates= Array.isArray(data.routeTemplates) ? data.routeTemplates : Object.values(data.routeTemplates||{});

  const curUser = users.find(u=>u.email===authUser.email) || {
    id:authUser.uid, name:authUser.displayName||authUser.email,
    role:"user", dept:"-", email:authUser.email, active:true
  };

  // [3][7] inbox: find memos where curUser is an approver in the active level
  const inbox = memoList.filter(m=>{
    if(m.status!=="pending") return false;
    const lv=getActiveLevel(m);
    return (lv?.approvers||[]).some(ap=>(ap.userId&&ap.userId===curUser.id)||(ap.email&&ap.email===curUser.email)&&ap.status==="pending");
  });
  const myMemos = memoList.filter(m=>m.createdBy===curUser.id);
  const ccMemos = memoList.filter(m => isMemoCcRecipient(m, curUser.email));

  // ── Dept-based visibility ──────────────────────────────────────────────────
  // superadmin: เห็นทุก Memo / admin: แผนกตัวเอง + assigned / user: ของตัวเอง + assigned
  const visibleMemos = (() => {
    if (curUser.role === "superadmin") return memoList;
    // viewScope="all" หรือ admin → เห็นทั้งหมด
    if (curUser.viewScope === "all" || curUser.role === "admin") return memoList;
    // default คือ "dept" (เห็นของแผนกตัวเอง)
    const scope = curUser.viewScope || "dept";
    return memoList.filter(m => {
      // เห็น Memo ตัวเองเสมอ
      if (m.createdBy === curUser.id) return true;
      // เห็น Memo ที่ได้รับมอบหมายให้อนุมัติเสมอ
      const isApprover = (m.workflowLevels||[]).flatMap(lv=>lv.approvers||[])
        .some(ap=>(ap.userId&&ap.userId===curUser.id)||(ap.email&&ap.email===curUser.email));
      if (isApprover) return true;
      // CC ถึงอีเมลของ user → ดูได้เมื่ออนุมัติครบแล้ว
      if (isMemoCcRecipient(m, curUser.email)) return true;
      // scope="dept" → เห็น Memo ทั้งแผนก
      if (scope === "dept" && curUser.dept) {
        const creator = users.find(u=>u.id===m.createdBy);
        const memoDept = m.dept || creator?.dept;
        if (memoDept && memoDept === curUser.dept) return true;
      }
      return false;
    });
  })();

  const selMemo = [...visibleMemos, ...(curUser.role === "superadmin" ? trashMemos : [])].find(m => m.id === selId);

  const openMemo    = id   => { setSelId(id); setView("detail"); pushHistory("detail", { selId:id }); };
  const startCreate = ()   => { setEditMemo({title:"",content:"",category:"ทั่วไป",workflowLevels:[],notify:{emailList:[],postToTeams:false,postToPowerAuto:false,postToLine:false},attachments:[]}); setView("create"); pushHistory("create"); };
  const startEdit   = memo => { setEditMemo({...memo,workflowLevels:(memo.workflowLevels||[]).map(lv=>({...lv,approvers:(lv.approvers||[]).map(a=>({...a}))})),attachments:[...(memo.attachments||[])],notify:{...memo.notify,emailList:[...(memo.notify?.emailList||[])]}}); setView("create"); pushHistory("create"); };

  const submitMemo = async (isDraft) => {
    if(!editMemo.title?.trim()){showToast("กรุณากรอกชื่อเรื่อง","error");return;}
    if(!isDraft&&!(editMemo.workflowLevels||[]).length){showToast("กรุณาเพิ่มลำดับการอนุมัติอย่างน้อย 1 ลำดับ","error");return;}
    if(!isDraft&&(editMemo.workflowLevels||[]).some(lv=>!(lv.approvers||[]).length)){showToast("ทุกลำดับต้องมีผู้อนุมัติ","error");return;}
    setSyncing(true);
    const now=new Date().toISOString(); const isNew=!editMemo.id; const old=isNew?null:memoList.find(m=>m.id===editMemo.id);
    const levels=(editMemo.workflowLevels||[]).map((lv,i)=>({...lv,level:i+1,approvers:(lv.approvers||[]).map(ap=>({...ap,status:isDraft?ap.status:"pending",comment:"",actionAt:null}))}));
    const payload={...editMemo,id:editMemo.id||undefined,createdBy:old?.createdBy||curUser.id,createdAt:old?.createdAt||now,updatedAt:now,
      status:isDraft?"draft":"pending",currentLevel:0,workflowLevels:levels,
      history:[...(old?.history||[]),...(!old?[{action:"created",by:curUser.id,at:now,comment:""}]:[]),
        ...(isDraft?[{action:"edited",by:curUser.id,at:now,comment:""}]:[{action:old?"resubmitted":"submitted",by:curUser.id,at:now,comment:"ส่งเพื่อขออนุมัติ"}])]};
    try {
      // Assign docNo at submit time so it appears in print immediately
      if(!isDraft && !payload.docNo) {
        const docNo = await assignDocNo(payload, users, docCounters);
        payload.docNo = docNo;
      }
        // Ensure deterministic client id for new memos to avoid duplicate creations
        if (isNew && !payload.id) payload.id = "m"+Date.now()+Math.floor(Math.random()*100000);
        await writeMemo(payload,isNew);
      // [6] Send email to level 1 approvers when submitting
      if(!isDraft&&levels.length) await sendApproverEmail(notifyConfig,payload,levels[0],users);
    } finally { setSyncing(false); }
    setEditMemo(null); showToast(isDraft?"บันทึกร่างแล้ว":"ส่ง Memo เพื่ออนุมัติแล้ว"); setView("myMemos");
  };

  const recallMemo = (memo) => setRecallConfirm({ memo });

  const doRecall = async (memo, andEdit = false) => {
    setRecallConfirm(null);
    const now = new Date().toISOString();
    const clearedLevels = (memo.workflowLevels||[]).map(lv => ({
      ...lv,
      approvers: (lv.approvers||[]).map(ap => ({
        ...ap, status:"pending", comment:"", actionAt:null, signature:null,
      })),
    }));
    await patchMemo(memo.id, {
      status:"recalled", currentLevel:0, workflowLevels:clearedLevels,
      history:[...(memo.history||[]),{action:"recalled",by:curUser.id,at:now,comment:"เรียกคืน Memo"}],
    });
    if (andEdit) {
      startEdit({ ...memo, status:"recalled", workflowLevels:clearedLevels, currentLevel:0 });
    } else {
      showToast("เรียกคืน Memo แล้ว — ลายเซ็นถูกล้างแล้ว");
    }
  };

  // [3] Level-based approval ─────────────────────────────────────────────────
  const approveMemo = async (memo, comment, drawnSig, proxyForUser=null) => {
    const now     = new Date().toISOString();
    const lvIdx   = memo.currentLevel||0;
    const sigToUse = drawnSig || curUser.signature || null;
    const levels  = (memo.workflowLevels||[]).map((lv,li)=>{
      if(li!==lvIdx) return lv;
      return {...lv, approvers:(lv.approvers||[]).map(ap=>{
        const matchUser  = ap.userId&&ap.userId===curUser.id;
        const matchEmail = ap.email&&ap.email===curUser.email;
        // Proxy: superadmin approves on behalf of a specific pending approver
        const matchProxy = proxyForUser && ap.status==="pending" &&
          (ap.userId===proxyForUser.userId || ap.email===proxyForUser.email);
        if((matchUser||matchEmail||matchProxy)&&ap.status==="pending")
          return {...ap, status:"approved", comment, actionAt:now, signature:sigToUse,
            proxyBy: proxyForUser ? curUser.id : null,
            proxyByName: proxyForUser ? curUser.name : null};
        return ap;
      })};
    });
    const curLevel  = levels[lvIdx];
    const lvDone    = isLevelDone(curLevel);
    const nextLevel = lvIdx+1;
    const allDone   = lvDone && nextLevel>=levels.length;
    const newStatus = allDone?"approved":"pending";
    const newLvIdx  = lvDone&&!allDone ? nextLevel : lvIdx;
    const histEntry = proxyForUser
      ? { action:"approved", by:curUser.id, at:now, comment,
          proxyFor: proxyForUser.name||proxyForUser.email,
          label: `อนุมัติแทน ${proxyForUser.name||proxyForUser.email}` }
      : { action:"approved", by:curUser.id, at:now, comment };
    const patch     = { workflowLevels:levels, currentLevel:newLvIdx, status:newStatus,
      history:[...(memo.history||[]), histEntry] };
    if(allDone&&!memo.docNo){ const docNo=await assignDocNo(memo,users,docCounters); patch.docNo=docNo; }
    if(allDone && !memo.shareToken) patch.shareToken = generateShareToken();
    await patchMemo(memo.id,patch);
    setModal(null); setSelId(memo.id);
    showToast(allDone?"✅ อนุมัติครบทุกลำดับ กำลังส่งแจ้งเตือน...":lvDone?"อนุมัติลำดับนี้แล้ว ส่งต่อลำดับถัดไป":"อนุมัติแล้ว รอผู้อนุมัติคนอื่นในลำดับเดียวกัน");
    if(allDone) {
      try {
        const approvedEmailNotifications = await sendApprovedNotifications(notifyConfig,{...memo,...patch},users);
        await patchMemo(memo.id,{ approvedEmailNotifications });
      } catch(e) {
        console.warn("[approvedEmailNotifications]", e.message);
      }
    }
    // [6] email next level approvers
    else if(lvDone && levels[newLvIdx]) {
        // Duplicate approval notification block removed
        // Notify next level approvers via LINE if they have a LINE User ID
        const nextApprovers = (levels[newLvIdx].approvers || []);
        const appUrl = window.location.origin;
        for (const ap of nextApprovers) {
          const u = users.find(u => u.id === ap.userId || u.email === ap.email);
          if (u && u.lineId) {
            try {
              await fetch("/api/approval-notify",{
                method:"POST",
                headers:{"Content-Type":"application/json"},
                body:JSON.stringify({
                  to:u.lineId,
                  message:`📣 มีเมโมใหม่ที่ต้องการการอนุมัติ: ${memo.title}\n${appUrl}/?memoId=${memo.id}`,
                  channelAccessToken:cfg.line.channelAccessToken
                })
              });
            } catch(e){ console.warn("[approval-notify]", u.lineId, e.message); }
          }
        }
      }
        












  };

  const rejectMemo = async (memo, comment) => {
    const now   = new Date().toISOString();
    const lvIdx = memo.currentLevel||0;
    const levels=(memo.workflowLevels||[]).map((lv,li)=>{
      if(li!==lvIdx) return lv;
      return {...lv,approvers:(lv.approvers||[]).map(ap=>{
        const match=(ap.userId&&ap.userId===curUser.id)||(ap.email&&ap.email===curUser.email);
        return match&&ap.status==="pending"?{...ap,status:"rejected",comment,actionAt:now}:ap;
      })};
    });
    await patchMemo(memo.id,{workflowLevels:levels,status:"rejected",history:[...(memo.history||[]),{action:"rejected",by:curUser.id,at:now,comment}]});
    setModal(null); showToast("ปฏิเสธ Memo แล้ว","error");
  };

  const addAtt=(memo,file)=>{const r=new FileReader();r.onload=async e=>{const att={id:newId("a"),name:file.name,size:file.size>1024*1024?(file.size/1024/1024).toFixed(1)+" MB":Math.round(file.size/1024)+" KB",type:file.name.split(".").pop().toLowerCase(),data:e.target.result};await patchMemo(memo.id,{attachments:[...(memo.attachments||[]),att]});showToast("แนบไฟล์แล้ว");};r.readAsDataURL(file);};
  const remAtt=async(memo,id)=>patchMemo(memo.id,{attachments:(memo.attachments||[]).filter(a=>a.id!==id)});

  // Feature 3: Clone memo เป็นร่างใหม่
  const cloneMemo = (memo) => {
    const now = new Date().toISOString();
    const draft = {
      title: `[ร่าง] ${memo.title}`,
      content: memo.content || "",
      category: memo.category || "ทั่วไป",
      uploadedFile: memo.uploadedFile || null,
      attachments: [],
      workflowLevels: (memo.workflowLevels||[]).map(lv=>({
        ...lv, id:"lv"+Date.now()+Math.random(),
        approvers: (lv.approvers||[]).map(ap=>({...ap,status:"pending",comment:"",actionAt:null,signature:null})),
      })),
      notify: { ...memo.notify, emailList:[...(memo.notify?.emailList||[])] },
      clonedFrom: memo.id,
    };
    setEditMemo(draft);
    setView("create");
    pushHistory("create");
    showToast("โหลดเป็นร่างใหม่แล้ว — ตรวจสอบและส่งอนุมัติได้เลย");
  };

  // Feature 4: ผู้อนุมัติเพิ่มลำดับต่อเอง
  const approverAddLevel = async (memo, newLevel) => {
    const now    = new Date().toISOString();
    const curIdx = memo.currentLevel || 0;
    // Insert new level right after current index
    const levels = [...(memo.workflowLevels||[])];
    levels.splice(curIdx+1, 0, {
      id: "lv"+Date.now(),
      mode: newLevel.mode,
      approvers: newLevel.approvers.map(ap=>({...ap,status:"pending",comment:"",actionAt:null})),
    });
    await patchMemo(memo.id, {
      workflowLevels: levels,
      history: [...(memo.history||[]), {action:"addedLevel",by:curUser.id,at:now,comment:`เพิ่มลำดับอนุมัติ: ${newLevel.approvers.map(a=>a.name).join(", ")}`}],
    });
    showToast("เพิ่มลำดับอนุมัติต่อแล้ว");
  };

  const saveSigZones = async (zones) => {
    if(!editMemo?.id) return;
    await patchMemo(editMemo.id,{signatureZones:zones});
    setEditMemo(p=>({...p,signatureZones:zones}));
    showToast("บันทึกจุดลงนามแล้ว");
    setShowSigZones(false);
  };

  const acknowledgeMemo = async (memo, { email, name, via = "system" }) => {
    const key = normalizeMemoEmail(email);
    if (!isValidAckRecipient(memo, users, key)) {
      showToast("ไม่สามารถรับทราบได้ — อีเมลไม่อยู่ในรายชื่อผู้รับแจ้งเตือน", "error");
      return;
    }
    if (isRecipientAcknowledged(memo, key)) {
      showToast("คุณรับทราบเอกสารนี้แล้ว");
      return;
    }
    const acknowledgement = {
      email: key,
      name: name || curUser.name || key,
      at: new Date().toISOString(),
      via,
    };
    await patchMemo(memo.id, {
      [`acknowledgements/${emailToKey(key)}`]: acknowledgement,
      history: [...(memo.history || []), { action: "acknowledged", by: curUser.id, at: acknowledgement.at, comment: `${acknowledgement.name} รับทราบ` }],
    });
    showToast("บันทึกการรับทราบแล้ว");
  };

  const deleteMemo = async (memo) => {
    const now = new Date().toISOString();
    await patchMemo(memo.id, {
      deletedAt: now,
      deletedBy: curUser.id,
      history: [...(memo.history || []), { action: "deleted", by: curUser.id, at: now, comment: "ย้ายไปถังขยะ" }],
    });
    setDeleteConfirm(null);
    setSelId(null);
    setView("trash");
    pushHistory("trash");
    showToast("ย้าย Memo ไปถังขยะแล้ว");
  };

  const restoreMemo = async (memo) => {
    const now = new Date().toISOString();
    await patchMemo(memo.id, {
      deletedAt: null,
      deletedBy: null,
      history: [...(memo.history || []), { action: "restored", by: curUser.id, at: now, comment: "กู้คืนจากถังขยะ" }],
    });
    setSelId(null);
    setView("all");
    pushHistory("all");
    showToast("กู้คืน Memo แล้ว");
  };

  const NAV=[
    {k:"dashboard",l:"ภาพรวม",       i:"⊞",roles:["superadmin","admin","user"]},
    {k:"inbox",    l:"กล่องขาเข้า",  i:"↓",badge:inbox.length||null,roles:["superadmin","admin","user"]},
    {k:"myMemos",  l:"Memo ของฉัน",  i:"◉",roles:["superadmin","admin","user"]},
    {k:"ccMemos",  l:"CC ถึงฉัน",    i:"✉",badge:ccMemos.length||null,roles:["superadmin","admin","user"]},
    {k:"all",      l:"ทั้งหมด",      i:"≡",roles:["superadmin","admin"]},
    {k:"search",   l:"ค้นหา",        i:"⌕",roles:["superadmin","admin","user"]},
    {k:"guide",    l:"คู่มือ",       i:"📖",roles:["superadmin","admin","user"]},
    {k:"routes",   l:"Route อนุมัติ",i:"🔀",roles:["superadmin","admin","user"]},
    {k:"users",    l:"จัดการ User",  i:"◎",roles:["superadmin"]},
    {k:"settings", l:"ตั้งค่าระบบ", i:"⚙",roles:["superadmin"]},
    {k:"trash",    l:"ถังขยะ",      i:"🗑",badge:trashMemos.length||null,roles:["superadmin"]},
  ];
  const MOBILE_NAV=[
    {k:"dashboard",l:"ภาพรวม", i:"⊞",roles:["superadmin","admin","user"]},
    {k:"inbox",    l:"ขาเข้า", i:"↓",badge:inbox.length||null,roles:["superadmin","admin","user"]},
    {k:"myMemos",  l:"ของฉัน", i:"◉",roles:["superadmin","admin","user"]},
    {k:"ccMemos",  l:"CC",     i:"✉",badge:ccMemos.length||null,roles:["superadmin","admin","user"]},
    {k:"search",   l:"ค้นหา",  i:"⌕",roles:["superadmin","admin","user"]},
    {k:"guide",    l:"คู่มือ", i:"📖",roles:["superadmin","admin","user"]},
    {k:"settings", l:"ตั้งค่า",i:"⚙",roles:["superadmin"]},
  ];

  const mobileNavItems = MOBILE_NAV.filter(n=>n.roles.includes(curUser.role));

  if (curUser.mustChangePassword) {
    return <ChangePasswordModal user={curUser} showToast={showToast} />;
  }

  const finishOnboarding = async () => {
    await update(ref(db, `${DATA_PATH}/users/${curUser.id}`), {
      onboardingPending: false,
      onboardingCompleted: true,
    });
    showToast("ยินดีต้อนรับสู่ E-Memo — พร้อมใช้งานแล้ว");
  };

  return (
    <div style={{fontFamily:"'Noto Sans Thai','Sarabun',sans-serif",display:"flex",height:"100vh",overflow:"hidden"}}>
      <style>{`
        .app-sidebar{display:flex;flex-direction:column;flex-shrink:0;}
        .app-mobile-header{display:none;position:fixed;top:0;left:0;right:0;z-index:50;background:${BLACK};color:#fff;padding:10px 14px;align-items:center;justify-content:space-between;border-bottom:1px solid #222;height:52px;box-sizing:border-box;}
        .app-mobile-bottomnav{display:none;position:fixed;bottom:0;left:0;right:0;z-index:50;background:${BLACK};border-top:1px solid #222;height:60px;align-items:stretch;}
        .app-main{flex:1;overflow-y:auto;background:#F9FAFB;}
        @media(max-width:640px){
          .app-sidebar{display:none!important;}
          .app-mobile-header{display:flex!important;}
          .app-mobile-bottomnav{display:flex!important;}
          .app-main{padding-top:52px;padding-bottom:64px;}
          .syncing-ind{left:12px!important;bottom:72px!important;}
        }
      `}</style>
      <Toast t={toast}/>
      {syncing&&<div className="syncing-ind" style={{position:"fixed",bottom:16,left:216,background:"#FFFBEB",color:"#B45309",border:"1px solid #FCD34D",borderRadius:6,padding:"4px 10px",fontSize:11,zIndex:100}}>⟳ กำลังบันทึก...</div>}
      {modal&&<ActionModal modal={modal} onClose={()=>setModal(null)}
        onApprove={(c,sig)=>approveMemo(modal.memo,c,sig,modal.proxyFor||null)}
        onReject={c=>rejectMemo(modal.memo,c)}
        curUser={curUser}
        isProxy={!!modal.proxyFor}
        proxyFor={modal.proxyFor?.name||modal.proxyFor?.email||null}
      />}
      {recallConfirm&&<RecallSmartModal memo={recallConfirm.memo} onRecallAndEdit={()=>doRecall(recallConfirm.memo,true)} onRecallOnly={()=>doRecall(recallConfirm.memo,false)} onCancel={()=>setRecallConfirm(null)}/>}
      {deleteConfirm&&<DeleteConfirmModal memo={deleteConfirm.memo} onConfirm={()=>deleteMemo(deleteConfirm.memo)} onCancel={()=>setDeleteConfirm(null)}/>}
      {curUser.onboardingPending && (
        <OnboardingTour
          steps={getOnboardingSteps(curUser.role)}
          onStepChange={(step) => {
            if (step?.view) {
              setView(step.view);
              pushHistory(step.view);
            }
          }}
          onComplete={finishOnboarding}
          onSkip={finishOnboarding}
        />
      )}
      {showAiUpdate&&<AiFeatureUpdateModal onClose={()=>{ setShowAiUpdate(false); localStorage.setItem("ememo_ai_update_v1_seen","1"); }}/>}
      {showProfile&&<ProfileModal curUser={curUser} onClose={()=>setShowProfile(false)} showToast={showToast}/>}
      {showTplManager&&can(curUser.role,"settings")&&<DocxTemplateManager templates={pdfTemplates} onSave={async tpls=>{await writePdfTemplates(tpls);showToast("บันทึก Template แล้ว");setShowTplManager(false);}} onClose={()=>setShowTplManager(false)}/>}
      {showSigZones&&editMemo&&<SignatureZonesModal memo={editMemo} users={users} curUser={curUser} onSave={saveSigZones} onClose={()=>setShowSigZones(false)}/>}
      {showRouteManager&&<RouteTemplateModal users={users} curUser={curUser} routeTemplates={routeTemplates} onSave={async routes=>{await writeRouteTemplates(routes);showToast("บันทึก Route แล้ว");}} onClose={()=>setShowRouteManager(false)}/>}

      {/* Mobile Top Header */}
      <div className="app-mobile-header">
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <div style={{width:26,height:26,background:GOLD,borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,color:BLACK,fontWeight:700}}>E</div>
          <span style={{fontSize:13,fontWeight:600,color:GOLD}}>E-Memo</span>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <button data-tour="create-memo" onClick={startCreate} style={{...BTN_GOLD,padding:"6px 12px",fontSize:12,borderRadius:6}}>+ สร้าง Memo</button>
          <button data-tour="profile" onClick={()=>setShowProfile(true)} style={{background:"transparent",border:"none",cursor:"pointer",padding:0}}>
            <Avatar userId={curUser.id} users={users.length?users:[curUser]} size={28}/>
          </button>
        </div>
      </div>

      {/* Desktop Sidebar */}
      <div className="app-sidebar" style={{width:210,background:BLACK,color:"#fff"}}>
        <div style={{padding:"16px 16px 12px",borderBottom:"1px solid #222"}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <img src="https://img1.pic.in.th/images/logo-tss-03.png" alt="TSS Logo" style={{width:28,height:28,borderRadius:6,objectFit:"cover",flexShrink:0,background:GOLD}} onError={e=>{e.target.style.display="none";e.target.nextSibling.style.display="flex";}}/>
            <div style={{width:28,height:28,background:GOLD,borderRadius:6,display:"none",alignItems:"center",justifyContent:"center",fontSize:14,color:BLACK,fontWeight:700,flexShrink:0}}>E</div>
            <div><div style={{fontSize:12,fontWeight:600,color:GOLD,letterSpacing:.3}}>E-Memo System</div><div style={{fontSize:9,color:"#555",lineHeight:1.3,marginTop:1}}>ไทยซอสเซส มาร์เก็ตติ้ง</div></div>
          </div>
        </div>
        <div style={{padding:"10px 10px 6px"}}><button data-tour="create-memo" onClick={startCreate} style={{...BTN_GOLD,width:"100%",padding:"9px",fontSize:12,borderRadius:6}}>+ สร้าง Memo ใหม่</button></div>
        <nav style={{flex:1,padding:"4px 8px",overflowY:"auto"}}>
          {NAV.filter(n=>n.roles.includes(curUser.role)).map(n=>(
            <button key={n.k} data-tour={`nav-${n.k}`} onClick={()=>{ setView(n.k); pushHistory(n.k); }} style={{width:"100%",padding:"8px 10px",borderRadius:6,background:view===n.k?"#1e1e1e":"transparent",color:view===n.k?GOLD:"#888",border:"none",fontSize:12,cursor:"pointer",display:"flex",alignItems:"center",gap:8,marginBottom:1,textAlign:"left"}}>
              <span style={{fontSize:13,width:16,textAlign:"center"}}>{n.i}</span>
              <span style={{flex:1}}>{n.l}</span>
              {n.badge?<span style={{background:"#DC2626",color:"#fff",borderRadius:10,fontSize:10,padding:"1px 5px",fontWeight:600}}>{n.badge}</span>:null}
            </button>
          ))}
        </nav>
        <div style={{borderTop:"1px solid #222",padding:"10px 12px"}}>
          <button data-tour="profile" onClick={()=>setShowProfile(true)} style={{width:"100%",display:"flex",alignItems:"center",gap:8,marginBottom:8,background:"transparent",border:"none",cursor:"pointer",padding:"2px 0"}}>
            <Avatar userId={curUser.id} users={users.length?users:[curUser]} size={26}/>
            <div style={{minWidth:0,textAlign:"left"}}>
              <div style={{fontSize:11,fontWeight:500,color:"#ddd",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{curUser.name}</div>
              <div style={{fontSize:10,color:GOLD}}>{curUser.signature?"✍ มีลายเซ็น":"คลิกตั้งลายเซ็น"}</div>
            </div>
          </button>
          <button onClick={()=>signOut(auth)} style={{width:"100%",padding:"7px",background:"#1a1a1a",color:"#666",border:"1px solid #2a2a2a",borderRadius:6,fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>ออกจากระบบ</button>
        </div>
      </div>

      {/* Main Content */}
      <div className="app-main">
        {view==="dashboard"&&<Dashboard memoList={visibleMemos} users={users} curUser={curUser} inboxCount={inbox.length} onOpen={openMemo}/>}
        {view==="inbox"    &&<MemoListView memoList={inbox}   users={users} title="กล่องขาเข้า" subtitle={`${inbox.length} รายการรอการอนุมัติ`} curUser={curUser} onOpen={openMemo} highlight/>}
        {view==="myMemos"  &&<MemoListView memoList={myMemos} users={users} title="Memo ของฉัน" curUser={curUser} onOpen={openMemo} onRecall={recallMemo} onEdit={startEdit}/>}
        {view==="ccMemos"  &&<MemoListView memoList={ccMemos} users={users} title="CC ถึงฉัน" subtitle={`${ccMemos.length} เอกสารที่คุณได้รับ CC หลังอนุมัติครบ`} curUser={curUser} onOpen={openMemo}/>}
        {view==="all"      &&can(curUser.role,"viewAll")&&<MemoListView memoList={visibleMemos} users={users} title="Memo ทั้งหมด" curUser={curUser} onOpen={openMemo}/>}
        {view==="search"   &&<SearchView memoList={visibleMemos} users={users} curUser={curUser} onOpen={openMemo}/>}
        {view==="guide"    &&<UserGuideView/>}
        {view==="routes"   &&<RouteListView routeTemplates={routeTemplates} curUser={curUser} onManage={()=>setShowRouteManager(true)}/>}
        {view==="users"    &&can(curUser.role,"manageUsers")&&<UsersMgmt users={users} curUser={curUser} showToast={showToast} emailTemplates={emailTemplates}/>}
        {view==="settings" &&(
          can(curUser.role,"settings")
            ? <ErrorBoundary><SettingsView notifyConfig={notifyConfig} emailTemplatesStored={data.emailTemplates} showToast={showToast} onOpenPdfTemplate={()=>setShowTplManager(true)} onBackfillShareTokens={handleBackfillShareTokens} backfillPendingCount={countMemosNeedingShareToken(data.memos)}/></ErrorBoundary>
            : <div style={{padding:32,textAlign:"center",color:"#9CA3AF",fontSize:13}}><div style={{fontSize:24,marginBottom:8}}>🔒</div><div>สิทธิ์ไม่เพียงพอ</div></div>
        )}
        {view==="trash"&&can(curUser.role,"deleteMemo")&&(
          <MemoListView key="trash" memoList={trashMemos} users={users} title="ถังขยะ" subtitle={`${trashMemos.length} Memo ที่ถูกลบ — กู้คืนได้`} curUser={curUser} onOpen={openMemo} trashMode onRestore={restoreMemo}/>
        )}
        {view==="create"&&editMemo&&<CreateView editMemo={editMemo} setEditMemo={setEditMemo} users={users} curUser={curUser} notifyConfig={notifyConfig} routeTemplates={routeTemplates} onSubmit={submitMemo} onCancel={()=>{setEditMemo(null);setView("myMemos");}} isRecall={!!editMemo.id&&editMemo.status==="recalled"} onOpenSigZones={()=>setShowSigZones(true)} syncing={syncing}/>}
        {view==="detail"&&selMemo&&<DetailView memo={selMemo} users={users} curUser={curUser} notifyConfig={notifyConfig} pdfTemplates={pdfTemplates} onBack={()=>{setView(isMemoDeleted(selMemo)?"trash":"myMemos");pushHistory(isMemoDeleted(selMemo)?"trash":"myMemos");}} onRecall={()=>recallMemo(selMemo)} onEdit={()=>startEdit(selMemo)} onAddFile={f=>addAtt(selMemo,f)} onRemoveFile={id=>remAtt(selMemo,id)} setModal={setModal} onCloneMemo={cloneMemo} onApproverAddLevel={approverAddLevel} onAcknowledge={payload=>acknowledgeMemo(selMemo,payload)} onDelete={m=>setDeleteConfirm({memo:m})} onRestore={restoreMemo}/>}
      </div>

      {/* Mobile Bottom Navigation */}
      <div className="app-mobile-bottomnav">
        {mobileNavItems.map(n=>(
          <button key={n.k} data-tour={`nav-${n.k}`} onClick={()=>{ setView(n.k); pushHistory(n.k); }}
            style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:2,
              background:"transparent",border:"none",cursor:"pointer",
              color:view===n.k?GOLD:"#666",padding:"6px 0",position:"relative",fontFamily:"inherit"}}>
            <span style={{fontSize:17,lineHeight:1}}>{n.i}</span>
            <span style={{fontSize:9,fontWeight:view===n.k?600:400}}>{n.l}</span>
            {n.badge?<span style={{position:"absolute",top:4,right:"50%",transform:"translateX(10px)",background:"#DC2626",color:"#fff",borderRadius:10,fontSize:9,padding:"1px 4px",fontWeight:600,lineHeight:1.2}}>{n.badge}</span>:null}
            {view===n.k&&<div style={{position:"absolute",top:0,left:"50%",transform:"translateX(-50%)",width:24,height:2,background:GOLD,borderRadius:1}}/>}
          </button>
        ))}
      </div>
    </div>
  );
}
