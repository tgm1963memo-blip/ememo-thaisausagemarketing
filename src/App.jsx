import React, { useState, useEffect, useRef, useCallback } from "react";
import { onAuthStateChanged, signOut, sendPasswordResetEmail } from "firebase/auth";
import { ref, onValue, set, push, update } from "firebase/database";
import { auth, db, DATA_PATH } from "./firebase";
import Login from "./Login";

// ── Firebase Auth REST API ─────────────────────────────────────────────────
// ข้อ 1 & 4: สร้าง Auth user ผ่าน REST API โดยไม่ต้อง logout admin
// Firebase ส่งอีเมล์จาก noreply@[project].firebaseapp.com
// → ตั้ง custom email ได้ที่: Firebase Console → Authentication → Templates → Customize
// → ปุ่ม "Customize action URL" และกำหนด custom domain ให้อีเมล์ไม่ตก Spam
async function createAuthUserREST(email) {
  const apiKey = auth.app.options.apiKey;
  // สร้าง random password ชั่วคราว user จะ reset ผ่านลิงก์
  const tmpPwd = Math.random().toString(36).slice(2,8) + "X9!" + Math.random().toString(36).slice(2,5);
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

async function sendResetEmailREST(email) {
  const apiKey = auth.app.options.apiKey;
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${apiKey}`,
    { method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ requestType:"PASSWORD_RESET", email }) }
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data;
}

// ── Theme ─────────────────────────────────────────────────────────────────────

// ── Constants ─────────────────────────────────────────────────────────────────
const COMPANY       = "บริษัท ไทยซอสเซส มาร์เก็ตติ้ง จำกัด";
const COMPANY_SHORT = "Thai Sauces Marketing";

// ── Design System ─────────────────────────────────────────────────────────
const LOGO_URL      = "/logo-tss-03.png";
// Brand
const BRAND_NAVY    = "#1E3A5F";   // sidebar, headings
const BRAND_RED     = "#C0392B";   // logo accent (used sparingly)
// Standard button palette
const CLR_PRIMARY   = "#2563EB";   // blue — primary actions
const CLR_SUCCESS   = "#16A34A";   // green — approve / save
const CLR_DANGER    = "#DC2626";   // red — reject / delete
const CLR_NEUTRAL   = "#6B7280";   // gray — secondary
// Aliases kept for existing refs
const GOLD          = "#2563EB";   // map old GOLD → blue
const BLACK         = "#111827";
const BRAND_PRIMARY = BRAND_NAVY;
const BRAND_ACCENT  = CLR_PRIMARY;
const BRAND_TEXT    = "#FFFFFF";
const BRAND_LIGHT   = "#EFF6FF";

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
  superadmin: ["manageUsers","settings","viewAll","create","approve","recall","editTemplate","viewReports","manageCategories"],
  admin:      ["viewAll","create","approve","recall","viewReports"],
  user:       ["create","recall","viewOwn","approve"],  // user ต้องอนุมัติ Memo ที่ได้รับมอบหมายได้
};
const can = (role, action) => ROLE_PERMS[role]?.includes(action) ?? false;

// ── Firebase helpers ──────────────────────────────────────────────────────────
const writeMemo = async (memoData, isNew) => {
  if (isNew) {
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
const writePdfTemplates= (tpls)    => set(ref(db, `${DATA_PATH}/pdfTemplates`), tpls);
const writeDocCounters = (ctrs)    => set(ref(db, `${DATA_PATH}/docCounters`), ctrs);

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
async function sendApproverEmail(cfg, memo, level, users) {
  if (!cfg.email?.enabled || !cfg.email?.serviceId) return;
  const creator    = users.find(u => u.id === memo.createdBy) || {};
  const modeLabel  = level.mode === "any" ? "ผู้ใดผู้หนึ่ง" : "ทุกคน";
  const attList    = (memo.attachments||[]).map(a=>a.name).join(", ") || "-";

  for (const ap of level.approvers) {
    const toEmail = ap.email || (users.find(u=>u.id===ap.userId)||{}).email;
    if (!toEmail) continue;
    try {
      await fetch("https://api.emailjs.com/api/v1.0/email/send", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          service_id:  cfg.email.serviceId,
          template_id: cfg.email.approverTemplateId || cfg.email.templateId,
          user_id:     cfg.email.publicKey,
          template_params: {
            to_email:      toEmail,
            approver_name: ap.name || toEmail,
            memo_title:    memo.title,
            memo_content:  (memo.content||"").slice(0,300),
            creator_name:  creator.name,
            category:      memo.category,
            memo_id:       memo.id,
            level_num:     level.level,
            mode_label:    modeLabel,
            attachments:   attList,
            company:       COMPANY,
            app_url:       window.location.origin,
          },
        }),
      });
    } catch {}
  }
}

async function sendApprovedNotifications(cfg, memo, users) {
  const creator      = users.find(u => u.id === memo.createdBy) || {};
  const approvedDate = new Date().toLocaleDateString("th-TH",{day:"2-digit",month:"long",year:"numeric"});
  const summary      = (memo.content||"").slice(0,200);

  if (cfg.email?.enabled && cfg.email?.serviceId && memo.notify?.emailList?.length) {
    for (const toEmail of memo.notify.emailList) {
      try {
        await fetch("https://api.emailjs.com/api/v1.0/email/send", {
          method:"POST", headers:{"Content-Type":"application/json"},
          body: JSON.stringify({ service_id:cfg.email.serviceId, template_id:cfg.email.templateId, user_id:cfg.email.publicKey,
            template_params:{ to_email:toEmail, memo_title:memo.title, creator_name:creator.name,
              approved_date:approvedDate, category:memo.category, memo_summary:summary, company:COMPANY }}),
        });
      } catch {}
    }
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
        body:JSON.stringify({to:cfg.line.groupId,message:msg,channelAccessToken:cfg.line.channelAccessToken})}); } catch {}
  }
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
  const fD = s => !s?"-":new Date(s).toLocaleDateString("th-TH",{day:"2-digit",month:"long",year:"numeric"});
  let root = document.getElementById("ememo-print-root");
  if(!root){ root=document.createElement("div"); root.id="ememo-print-root"; document.body.appendChild(root); }
  if(!document.getElementById("ememo-print-css")){
    const s=document.createElement("style"); s.id="ememo-print-css";
    s.textContent=`@media print{body>*{display:none!important;}#ememo-print-root{display:block!important;}}#ememo-print-root{display:none;font-family:'Noto Sans Thai','Sarabun',sans-serif;}`;
    document.head.appendChild(s);
  }
  let html = '<div style="width:210mm;min-height:297mm;margin:0 auto;padding:20mm 22mm;box-sizing:border-box;font-family:Noto Sans Thai,Sarabun,sans-serif;font-size:13px;color:#111;">';
  html += '<div style="border-bottom:2px solid #D4AF37;padding-bottom:12px;margin-bottom:20px;display:flex;align-items:center;gap:16px;">';
  // Logo ซ้าย
  html += '<img src="'+LOGO_URL+'" style="height:52px;width:auto;object-fit:contain;flex-shrink:0;display:block;"/>';
  // ชื่อบริษัทและหัวเรื่อง
  html += '<div style="flex:1;">';
  html += '<div style="font-size:13px;font-weight:700;color:#1A2F6B;">'+COMPANY+'</div>';
  html += '<div style="font-size:18px;font-weight:700;margin-top:3px;">บันทึกข้อความ (Memo)</div>';
  if(memo.docNo) html += '<div style="font-size:11px;color:#6B7280;margin-top:2px;">เลขที่ '+memo.docNo+'</div>';
  html += '</div>';
  html += '</div>';
  html += '<table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:12px;"><tbody>';
  html += '<tr><td style="width:90px;color:#6B7280;padding:3px 0;">เรื่อง:</td><td style="font-weight:600;">'+(memo.title||"")+'</td>';
  html += '<td style="width:80px;color:#6B7280;text-align:right;">หมวดหมู่:</td><td style="text-align:right;">'+(memo.category||"")+'</td></tr>';
  html += '<tr><td style="color:#6B7280;padding:3px 0;">ผู้สร้าง:</td><td>'+(creator.name||"")+(creator.dept?" ("+creator.dept+")":"")+'</td>';
  html += '<td style="color:#6B7280;text-align:right;">วันที่:</td><td style="text-align:right;">'+(memo.createdAt?fD(memo.createdAt):"")+'</td></tr>';
  if(memo.docNo) html += '<tr><td style="color:#6B7280;padding:3px 0;">เลขที่:</td><td colspan="3" style="font-family:monospace;font-weight:600;">'+memo.docNo+'</td></tr>';
  html += '</tbody></table>';
  html += '<div style="border-top:1px solid #E5E7EB;margin-bottom:20px;"></div>';
  html += '<div style="font-size:13px;line-height:1.9;white-space:pre-wrap;min-height:140px;margin-bottom:32px;">'+(memo.content||"")+'</div>';
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
    html += '<th style="text-align:center;padding:5px 8px;border:1px solid #E5E7EB;width:100px;">วันที่</th>';
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
  html += '<div style="margin-top:32px;border-top:1px solid #F3F4F6;padding-top:8px;display:flex;justify-content:space-between;font-size:10px;color:#9CA3AF;">';
  html += '<span>'+COMPANY+'</span><span>พิมพ์เมื่อ '+fD(new Date().toISOString())+'</span></div>';
  html += '</div>';
  root.innerHTML = html;
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
const BTN_GOLD   = { display:"inline-flex",alignItems:"center",justifyContent:"center",gap:4,padding:"7px 14px",background:CLR_PRIMARY,color:"#fff",border:"none",borderRadius:6,fontSize:12,fontWeight:600,cursor:"pointer" };
const BTN_SUCCESS = { display:"inline-flex",alignItems:"center",justifyContent:"center",gap:4,padding:"7px 14px",background:"#16A34A",color:"#fff",border:"none",borderRadius:6,fontSize:12,fontWeight:600,cursor:"pointer" };
const BTN_DANGER  = { display:"inline-flex",alignItems:"center",justifyContent:"center",gap:4,padding:"7px 14px",background:"#DC2626",color:"#fff",border:"none",borderRadius:6,fontSize:12,fontWeight:600,cursor:"pointer" };
const BTN_GRAY= { padding:"4px 10px", fontSize:11, borderRadius:6, background:"#F9FAFB", color:"#6B7280", border:"1px solid #E5E7EB", cursor:"pointer" };
const BTN_X   = { background:"none", border:"none", cursor:"pointer", fontSize:12, color:"#9CA3AF", padding:"0 2px" };
const ATT_ROW = { display:"flex", alignItems:"center", gap:8, padding:"6px 10px", background:"#F9FAFB", borderRadius:6, marginBottom:4, fontSize:12, border:"1px solid #F3F4F6" };

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
  const save = async () => {
    setSaving(true);
    try { await patchUser(curUser.id, { name:name.trim()||curUser.name, signature:sig||null }); showToast("บันทึกโปรไฟล์แล้ว"); onClose(); }
    catch { showToast("บันทึกไม่สำเร็จ","error"); }
    finally { setSaving(false); }
  };
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

function ActionModal({ modal, onClose, onApprove, onReject, curUser }) {
  const [comment,    setComment]    = useState("");
  const [sigData,    setSigData]    = useState(curUser?.signature || null);
  const [step,       setStep]       = useState("confirm"); // "confirm" | "sign"
  const isA = modal.type === "approve";

  const handleConfirm = () => {
    if (isA) {
      // ถ้ายังไม่มีลายเซ็น ให้วาดก่อน
      if (!sigData) { setStep("sign"); return; }
      onApprove(comment, sigData);
    } else {
      onReject(comment);
    }
  };

  return (
    <div style={{position:"fixed",inset:0,zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,.55)"}}>
      <div style={{background:"#fff",border:"1px solid #E5E7EB",borderRadius:14,padding:24,width:400,boxShadow:"0 20px 60px rgba(0,0,0,.25)",fontFamily:"'Noto Sans Thai','Sarabun',sans-serif"}}>
        <div style={{fontSize:15,fontWeight:600,marginBottom:4,color:"#111"}}>{isA?"ยืนยันการอนุมัติ":"ยืนยันการปฏิเสธ"}</div>
        <div style={{fontSize:12,color:"#6B7280",marginBottom:16,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{modal.memo.title}</div>

        {step === "confirm" && (<>
          <div style={{marginBottom:12}}>
            <label style={{fontSize:11,fontWeight:600,color:"#6B7280",display:"block",marginBottom:3}}>ความคิดเห็น (ถ้ามี)</label>
            <textarea value={comment} onChange={e=>setComment(e.target.value)} rows={3}
              style={{width:"100%",padding:"7px 9px",border:"1px solid #E5E7EB",borderRadius:6,fontSize:12,fontFamily:"inherit",resize:"none",boxSizing:"border-box"}}/>
          </div>
          {isA && (
            <div style={{marginBottom:14}}>
              <div style={{fontSize:11,fontWeight:600,color:"#6B7280",marginBottom:4}}>ลายเซ็น</div>
              {sigData ? (
                <div style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",background:"#F9FAFB",borderRadius:6,border:"1px solid #E5E7EB"}}>
                  <img src={sigData} alt="sig" style={{height:36,border:"1px solid #E5E7EB",borderRadius:4,background:"#fff"}}/>
                  <div style={{flex:1,fontSize:11,color:"#065F46"}}>✓ มีลายเซ็น</div>
                  <button onClick={()=>setSigData(null)} style={{background:"none",border:"none",cursor:"pointer",fontSize:11,color:"#9CA3AF"}}>เปลี่ยน</button>
                </div>
              ) : (
                <div style={{padding:"10px 12px",background:"#FFFBEB",border:"1px solid #FCD34D",borderRadius:6,fontSize:12,color:"#B45309",cursor:"pointer"}}
                  onClick={()=>setStep("sign")}>
                  ✍ คลิกเพื่อวาดลายเซ็น (จำเป็นสำหรับการอนุมัติ)
                </div>
              )}
            </div>
          )}
          <div style={{display:"flex",gap:8}}>
            <button onClick={handleConfirm}
              style={{flex:1,padding:10,background:isA?"#16A34A":"#DC2626",color:"#fff",border:"none",borderRadius:6,fontSize:13,fontWeight:600,cursor:"pointer"}}>
              {isA ? (sigData?"✓ ยืนยันอนุมัติ":"✍ วาดลายเซ็น") : "✕ ปฏิเสธ"}
            </button>
            <button onClick={onClose}
              style={{flex:1,padding:10,background:"#F9FAFB",color:"#6B7280",border:"1px solid #E5E7EB",borderRadius:6,fontSize:13,cursor:"pointer"}}>
              ยกเลิก
            </button>
          </div>
        </>)}

        {step === "sign" && (
          <div>
            <div style={{fontSize:12,color:"#6B7280",marginBottom:8}}>วาดลายเซ็นของคุณ:</div>
            <SignaturePad value={sigData} onChange={setSigData}/>
            <div style={{display:"flex",gap:8,marginTop:12}}>
              <button onClick={()=>{ if(sigData){ onApprove(comment,sigData); } else setStep("confirm"); }}
                style={{flex:1,padding:10,background:sigData?CLR_PRIMARY:"#9CA3AF",color:"#fff",border:"none",borderRadius:6,fontSize:13,fontWeight:600,cursor:sigData?"pointer":"not-allowed"}}>
                {sigData?"✓ ยืนยันอนุมัติพร้อมลายเซ็น":"วาดลายเซ็นก่อน"}
              </button>
              <button onClick={()=>setStep("confirm")}
                style={{flex:1,padding:10,background:"#F9FAFB",color:"#6B7280",border:"1px solid #E5E7EB",borderRadius:6,fontSize:13,cursor:"pointer"}}>
                ← กลับ
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


function NotifyPanel({ notify, setNotify, users, notifyConfig }) {
  const [emailIn, setEmailIn] = useState("");
  const addEmail = () => { const e=emailIn.trim(); if(!e||!e.includes("@")||(notify.emailList||[]).includes(e))return; setNotify(p=>({...p,emailList:[...(p.emailList||[]),e]})); setEmailIn(""); };
  const remEmail = e => setNotify(p=>({...p,emailList:(p.emailList||[]).filter(x=>x!==e)}));
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
          <div style={{display:"flex",gap:6,marginBottom:5}}>
            <input value={emailIn} onChange={e=>setEmailIn(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addEmail()} placeholder="กรอกอีเมล์..." style={{flex:1,padding:"5px 8px",border:"1px solid #E5E7EB",borderRadius:6,fontSize:12}}/>
            <button onClick={addEmail} style={BTN_GOLD}>เพิ่ม</button>
          </div>
          <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:5}}>
            {users.filter(u=>u.email&&u.active&&!(notify.emailList||[]).includes(u.email)).map(u=>(
              <button key={u.id} onClick={()=>setNotify(p=>({...p,emailList:[...(p.emailList||[]),u.email]}))} style={{fontSize:10,padding:"2px 6px",borderRadius:4,background:"#F9FAFB",color:"#6B7280",border:"1px solid #E5E7EB",cursor:"pointer"}}>+ {u.name.split(" ")[0]}</button>
            ))}
          </div>
          {(notify.emailList||[]).map(e=><div key={e} style={ATT_ROW}><span>✉</span><span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e}</span><button onClick={()=>remEmail(e)} style={BTN_X}>✕</button></div>)}
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

function MemoListView({ memoList, users, title, subtitle, curUser, onOpen, onRecall, onEdit, highlight }) {
  const sorted=[...memoList].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  return (
    <div style={{padding:24}}>
      <div style={{marginBottom:16}}><div style={{fontSize:18,fontWeight:600,color:"#111"}}>{title}</div><div style={{fontSize:12,color:"#9CA3AF",marginTop:2}}>{subtitle||sorted.length+" รายการ"}</div></div>
      {sorted.length===0?<Empty msg="ไม่พบ Memo"/>:sorted.map(m=><MemoRow key={m.id} memo={m} users={users} onClick={()=>onOpen(m.id)} highlight={highlight} curUser={curUser} onRecall={onRecall} onEdit={onEdit}/>)}
    </div>
  );
}

function SearchView({ memoList, users, curUser, onOpen }) {
  const [q,setQ]=useState(""); const [fS,setFS]=useState(""); const [fC,setFC]=useState(""); const [fF,setFF]=useState(""); const [fT,setFT]=useState("");
  const res=memoList.filter(m=>{
    if(q.trim()&&!m.title?.toLowerCase().includes(q.toLowerCase())&&!m.content?.toLowerCase().includes(q.toLowerCase()))return false;
    if(fS&&m.status!==fS)return false; if(fC&&m.category!==fC)return false;
    if(fF&&m.createdAt<fF)return false; if(fT&&m.createdAt>fT+"T23:59:59")return false;
    return true;
  }).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  const has=q||fS||fC||fF||fT;
  return (
    <div style={{padding:24}}>
      <div style={{fontSize:18,fontWeight:600,color:"#111",marginBottom:14}}>ค้นหา Memo</div>
      <input value={q} onChange={e=>setQ(e.target.value)} placeholder="ค้นหาชื่อเรื่อง, เนื้อหา..." style={{...IS,marginBottom:10}}/>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8,marginBottom:14}}>
        <select value={fS} onChange={e=>setFS(e.target.value)} style={{...IS,width:"auto"}}><option value="">สถานะทั้งหมด</option>{Object.entries(STATUS_LABEL).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>
        <select value={fC} onChange={e=>setFC(e.target.value)} style={{...IS,width:"auto"}}><option value="">หมวดหมู่ทั้งหมด</option>{BASE_CATEGORIES.map(c=><option key={c}>{c}</option>)}</select>
        <input type="date" value={fF} onChange={e=>setFF(e.target.value)} style={{...IS,width:"auto"}}/>
        <input type="date" value={fT} onChange={e=>setFT(e.target.value)} style={{...IS,width:"auto"}}/>
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

  return (
    <div>
      {levels.map((lv,li)=>(
        <div key={lv.id||li} style={{border:"1px solid #E5E7EB",borderRadius:8,padding:12,marginBottom:8,background:"#F9FAFB"}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
            <span style={{fontSize:12,fontWeight:600,color:"#374151",minWidth:52}}>ลำดับที่ {lv.level}</span>
            {/* mode toggle */}
            <div style={{display:"flex",gap:0,border:"1px solid #E5E7EB",borderRadius:6,overflow:"hidden"}}>
              {["all","any"].map(m=>(
                <button key={m} onClick={()=>setMode(li,m)} style={{padding:"3px 10px",fontSize:11,fontWeight:500,background:lv.mode===m?GOLD:"#fff",color:lv.mode===m?BLACK:"#6B7280",border:"none",cursor:"pointer"}}>
                  {m==="all"?"ทุกคน":"ผู้ใดผู้หนึ่ง"}
                </button>
              ))}
            </div>
            <div style={{marginLeft:"auto",display:"flex",gap:4}}>
              <button onClick={()=>moveLevel(li,-1)} disabled={li===0} style={{...BTN_X,opacity:li===0?.3:1}}>↑</button>
              <button onClick={()=>moveLevel(li,1)} disabled={li===levels.length-1} style={{...BTN_X,opacity:li===levels.length-1?.3:1}}>↓</button>
              <button onClick={()=>remLevel(li)} style={{...BTN_X,color:"#DC2626"}}>✕</button>
            </div>
          </div>
          {/* approvers in this level */}
          {(lv.approvers||[]).map((ap,ai)=>(
            <div key={ai} style={{display:"flex",alignItems:"center",gap:6,padding:"4px 6px",background:"#fff",borderRadius:5,marginBottom:4,border:"1px solid #F3F4F6"}}>
              {ap.userId?<Avatar userId={ap.userId} users={users} size={18}/>:<span style={{fontSize:14}}>✉</span>}
              <span style={{flex:1,fontSize:11,color:"#374151",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ap.name||ap.email}</span>
              <button onClick={()=>remApprover(li,ai)} style={{...BTN_X,color:"#DC2626"}}>✕</button>
            </div>
          ))}
          {/* add from user list */}
          <div style={{display:"flex",gap:5,marginTop:4}}>
            <select value={newUserId[li]||""} onChange={e=>setNewUserId(p=>({...p,[li]:e.target.value}))} style={{flex:1,padding:"5px 7px",border:"1px solid #E5E7EB",borderRadius:5,fontSize:11}}>
              <option value="">เลือก User ในระบบ...</option>
              {avail.filter(u=>!(lv.approvers||[]).find(a=>a.userId===u.id)).map(u=><option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
            </select>
            <button onClick={()=>addApproverFromUser(li)} style={{...BTN_GOLD,padding:"5px 10px",fontSize:11}}>เพิ่ม</button>
          </div>
          {/* [6] add by email */}
          <div style={{display:"flex",gap:5,marginTop:4}}>
            <input value={newEmail[li]||""} onChange={e=>setNewEmail(p=>({...p,[li]:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&addApproverFromEmail(li)} placeholder="หรือระบุอีเมล์ภายนอก..." style={{flex:1,padding:"5px 7px",border:"1px solid #E5E7EB",borderRadius:5,fontSize:11}}/>
            <button onClick={()=>addApproverFromEmail(li)} style={{...BTN_GRAY,fontSize:11}}>+ อีเมล์</button>
          </div>
        </div>
      ))}
      <button onClick={addLevel} style={{width:"100%",padding:"8px",background:"#F9FAFB",border:"1px dashed #D4AF37",borderRadius:7,fontSize:12,cursor:"pointer",color:"#374151",fontWeight:500}}>+ เพิ่มลำดับการอนุมัติ</button>
    </div>
  );
}

function CreateView({ editMemo, setEditMemo, users, curUser, notifyConfig, onSubmit, onCancel, isRecall, onOpenSigZones }) {
  const fileRef = useRef();
  const [showPreview, setShowPreview] = useState(false);
  const update  = (k,v) => setEditMemo(p=>({...p,[k]:v}));
  const setNotify=(fn)=>setEditMemo(p=>({...p,notify:typeof fn==="function"?fn(p.notify||{}):fn}));
  const handleFile = ev => {
    const f=ev.target.files[0]; if(!f) return;
    const r=new FileReader();
    r.onload=e=>{const att={id:newId("a"),name:f.name,size:f.size>1024*1024?(f.size/1024/1024).toFixed(1)+" MB":Math.round(f.size/1024)+" KB",type:f.name.split(".").pop().toLowerCase(),data:e.target.result};setEditMemo(p=>({...p,attachments:[...(p.attachments||[]),att]}));};
    r.readAsDataURL(f); ev.target.value="";
  };
  const levels = editMemo.workflowLevels || [];
  const setLevels = fn => setEditMemo(p=>({...p,workflowLevels:typeof fn==="function"?fn(p.workflowLevels||[]):fn}));

  return (
    <div style={{padding:24}}>
      {showPreview && (
        <ErrorBoundary>
          <MemoPDFPreview
            memo={editMemo}
            users={users}
            onSaveZones={zones => { setEditMemo(p=>({...p,signatureZones:zones})); setShowPreview(false); }}
            onClose={() => setShowPreview(false)}
          />
        </ErrorBoundary>
      )}
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:20}}>
        <button onClick={onCancel} style={{background:"none",border:"none",cursor:"pointer",fontSize:20,color:"#9CA3AF",padding:0,lineHeight:1}}>←</button>
        <div style={{fontSize:18,fontWeight:600,color:"#111"}}>{editMemo.id?(isRecall?"แก้ไข Memo (เรียกคืน)":"แก้ไข Memo"):"สร้าง Memo ใหม่"}</div>
        <button onClick={()=>setShowPreview(true)} style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:6,padding:"7px 14px",background:"#1D4ED8",color:"#fff",border:"none",borderRadius:6,fontSize:12,fontWeight:600,cursor:"pointer"}}>
          👁 ตัวอย่าง / PDF
        </button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 320px",gap:16,alignItems:"start"}}>
        <div>
          <Section>
            <Field label="ชื่อเรื่อง *"><input value={editMemo.title||""} onChange={e=>update("title",e.target.value)} placeholder="กรอกชื่อเรื่อง..." style={IS}/></Field>
            {/* [5] Category with custom input */}
            <Field label="หมวดหมู่"><CategoryField value={editMemo.category||"ทั่วไป"} onChange={v=>update("category",v)}/></Field>
            <Field label="เนื้อหา"><textarea value={editMemo.content||""} onChange={e=>update("content",e.target.value)} rows={8} placeholder="กรอกเนื้อหา..." style={{...IS,resize:"vertical",lineHeight:1.7,fontFamily:"inherit"}}/></Field>
          </Section>
          <Section title="เอกสารแนบ" extra={<button onClick={()=>fileRef.current?.click()} style={BTN_GRAY}>+ แนบไฟล์</button>}>
            <input ref={fileRef} type="file" style={{display:"none"}} onChange={handleFile}/>
            {(editMemo.attachments||[]).map(a=>(
              <div key={a.id} style={ATT_ROW}><span>📎</span><span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.name}</span><span style={{color:"#9CA3AF"}}>{a.size}</span><button onClick={()=>setEditMemo(p=>({...p,attachments:p.attachments.filter(x=>x.id!==a.id)}))} style={BTN_X}>✕</button></div>
            ))}
            {!(editMemo.attachments||[]).length&&<div style={{fontSize:12,color:"#9CA3AF",textAlign:"center",padding:"4px 0"}}>ยังไม่มีเอกสารแนบ</div>}
          </Section>
          {/* [2] Signature zones button */}
          {editMemo.id && (
            <button onClick={onOpenSigZones} style={{...BTN_GRAY,width:"100%",padding:"9px",marginBottom:12,textAlign:"center"}}>
              ✍ กำหนดจุดลงนาม {editMemo.signatureZones?.length?`(${editMemo.signatureZones.length} จุด)`:""}
            </button>
          )}
        </div>
        <div>
          {/* [3] Level-based workflow builder */}
          <Section title="ขั้นตอนการอนุมัติ">
            <WorkflowLevelBuilder levels={levels} setLevels={setLevels} users={users} curUser={curUser}/>
          </Section>
          <NotifyPanel notify={editMemo.notify||{emailList:[],postToTeams:false,postToPowerAuto:false,postToLine:false}} setNotify={setNotify} users={users} notifyConfig={notifyConfig}/>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            <button onClick={()=>onSubmit(false)} style={{...BTN_GOLD,width:"100%",padding:"11px",fontSize:13}}>{isRecall?"ส่งกลับเพื่ออนุมัติ":"ส่งเพื่ออนุมัติ"}</button>
            <button onClick={()=>onSubmit(true)}  style={{padding:"11px",background:"#F9FAFB",color:"#6B7280",border:"1px solid #E5E7EB",borderRadius:6,fontSize:12,cursor:"pointer"}}>บันทึกร่าง</button>
            <button onClick={()=>setShowPreview(true)} style={{padding:"11px",background:"#EFF6FF",color:"#1E40AF",border:"1px solid #BFDBFE",borderRadius:6,fontSize:12,fontWeight:500,cursor:"pointer"}}>👁 ดูตัวอย่าง / กำหนดจุดลงนาม / โหลด PDF</button>
            <button onClick={onCancel}             style={{padding:"11px",background:"none",color:"#9CA3AF",border:"none",borderRadius:6,fontSize:12,cursor:"pointer"}}>ยกเลิก</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailView({ memo, users, curUser, notifyConfig, pdfTemplates, onBack, onRecall, onEdit, onAddFile, onRemoveFile, setModal }) {
  const fileRef   = useRef();
  const [showPicker, setShowPicker] = useState(false);
  const isCreator = memo.createdBy===curUser.id;

  // [3][7] find if current user can approve in the active level
  const activeLevel    = getActiveLevel(memo);
  const myStep         = activeLevel?.approvers?.find(ap=>(ap.userId&&ap.userId===curUser.id)||(ap.email&&ap.email===curUser.email));
  const canApprove     = memo.status==="pending" && !!myStep && myStep.status==="pending" && can(curUser.role,"approve");

  const ALABEL={created:"สร้าง",submitted:"ส่งอนุมัติ",approved:"อนุมัติ",rejected:"ปฏิเสธ",recalled:"เรียกคืน",edited:"แก้ไข",resubmitted:"ส่งกลับ"};
  const ACOLOR={approved:"#065F46",rejected:"#991B1B",recalled:"#1E40AF",submitted:"#B45309"};
  const handleFile=e=>{const f=e.target.files[0];if(f)onAddFile(f);e.target.value="";};
  const notify=memo.notify||{};
  const notifySummary=[
    ...(notifyConfig.email?.enabled&&notify.emailList?.length?[`✉ ${notify.emailList.length} อีเมล์`]:[]),
    ...(notifyConfig.teams?.enabled&&notify.postToTeams?["🔵 Teams"]:[]),
    ...(notifyConfig.powerauto?.enabled&&notify.postToPowerAuto?["🟣 SharePoint"]:[]),
    ...(notifyConfig.line?.enabled&&notify.postToLine?["🟢 LINE Group"]:[]),
  ];
  const tplList=Object.values(pdfTemplates||{}).filter(t=>t.fileBase64);

  return (
    <div style={{padding:24}}>
      {showPicker&&<TemplatePicker templates={tplList} memo={memo} users={users} onClose={()=>setShowPicker(false)}/>}
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
            <div style={{fontSize:14,lineHeight:1.8,whiteSpace:"pre-wrap",color:"#374141"}}>{memo.content}</div>
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
              return <div key={i} style={{display:"flex",gap:10,padding:"7px 0",borderBottom:i<(memo.history||[]).length-1?"1px solid #F3F4F6":"none"}}>
                <Avatar userId={h.by} users={users} size={24}/>
                <div style={{flex:1}}><div style={{fontSize:12,display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}><span style={{fontWeight:500,color:"#374151"}}>{u.name||"-"}</span><span style={{color:ACOLOR[h.action]||"#9CA3AF",fontWeight:500}}>{ALABEL[h.action]||h.action}</span><span style={{color:"#9CA3AF",marginLeft:"auto"}}>{fmtShort(h.at)}</span></div>{h.comment&&<div style={{fontSize:11,color:"#6B7280",marginTop:2}}>{h.comment}</div>}</div>
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
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {/* ── ข้อ 3 & 6: แสดงปุ่ม PDF preview/export ทุก status ยกเว้น draft/recalled ── */}
            {/* PDF export — ใช้ system template ถ้ายังไม่มี custom template */}
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
            {canApprove&&<><button onClick={()=>setModal({type:"approve",memo})} style={{padding:11,background:"#16A34A",color:"#fff",border:"none",borderRadius:6,fontSize:13,fontWeight:600,cursor:"pointer"}}>✓ อนุมัติ</button><button onClick={()=>setModal({type:"reject",memo})} style={{padding:11,background:"#DC2626",color:"#fff",border:"none",borderRadius:6,fontSize:13,fontWeight:600,cursor:"pointer"}}>✕ ปฏิเสธ</button></>}
            {isCreator&&memo.status==="pending"&&can(curUser.role,"recall")&&<button onClick={onRecall} style={{padding:11,background:"#F9FAFB",color:"#374151",border:"1px solid #E5E7EB",borderRadius:6,fontSize:13,cursor:"pointer"}}>↩ เรียกคืน Memo</button>}
            {isCreator&&(memo.status==="draft"||memo.status==="recalled")&&<button onClick={onEdit} style={{padding:11,background:CLR_PRIMARY,color:"#fff",border:"none",borderRadius:6,fontSize:13,fontWeight:600,cursor:"pointer"}}>✎ แก้ไข Memo</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

// UsersMgmt, SettingsView — same as original ──────────────────────────────────
function UsersMgmt({ users, curUser, showToast }) {
  const [editing,setEditing]=useState(null); const [delConfirm,setDelConfirm]=useState(null); const [importPreview,setImportPreview]=useState(null);
  const xlsxRef=useRef(); const blank={name:"",email:"",dept:"",role:"user",active:true};
  const handleXlsxImport=async(e)=>{const file=e.target.files[0];if(!file)return;e.target.value="";try{const XLSX=await import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs");const buf=await file.arrayBuffer();const wb=XLSX.read(buf,{type:"array"});const ws=wb.Sheets[wb.SheetNames[0]];const rows=XLSX.utils.sheet_to_json(ws,{defval:""});const parsed=rows.map(r=>({name:String(r["ชื่อ-สกุล"]||r["name"]||"").trim(),email:String(r["อีเมล์"]||r["email"]||"").trim().toLowerCase(),dept:String(r["แผนก"]||r["dept"]||"").trim(),role:["superadmin","admin","user"].includes(String(r["สิทธิ์"]||r["role"]||"").toLowerCase())?String(r["สิทธิ์"]||r["role"]||"user").toLowerCase():"user",active:true})).filter(r=>r.name&&r.email&&r.email.includes("@"));if(!parsed.length){showToast("ไม่พบข้อมูลที่ถูกต้อง","error");return;}setImportPreview(parsed);}catch(err){showToast("อ่านไฟล์ไม่ได้: "+err.message,"error");}};
  const confirmImport=async()=>{if(!importPreview)return;const existing=Object.fromEntries(users.map(u=>[u.id,u]));let added=0,updated=0;importPreview.forEach(r=>{const dup=users.find(u=>u.email===r.email);if(dup){existing[dup.id]={...dup,name:r.name,dept:r.dept,role:r.role};updated++;}else{const id=newId("u");existing[id]={...r,id};added++;}});await writeUsers(existing);showToast(`นำเข้าสำเร็จ: เพิ่ม ${added} คน, อัปเดต ${updated} คน`);setImportPreview(null);};
  const save=async()=>{
    if(!editing.name.trim()||!editing.email.trim()){showToast("กรุณากรอกชื่อและอีเมล์","error");return;}
    if(!editing.email.includes("@")){showToast("รูปแบบอีเมล์ไม่ถูกต้อง","error");return;}
    if(!editing.id&&users.find(u=>u.email===editing.email.trim())){showToast("อีเมล์นี้มีในระบบแล้ว","error");return;}
    const id=editing.id||newId("u");
    const newUser={...editing,id,name:editing.name.trim(),email:editing.email.trim()};
    const newObj={...Object.fromEntries(users.map(u=>[u.id,u])),[id]:newUser};
    await writeUsers(newObj);
    // ── ข้อ 4: สร้าง Firebase Auth user ผ่าน REST API (admin ไม่ logout) ──
    if(!editing.id){
      try{
        await createAuthUserREST(editing.email.trim());
        // ส่งลิงก์ตั้งรหัสผ่านทันที
        await sendResetEmailREST(editing.email.trim());
        showToast("✅ เพิ่ม User แล้ว — ส่งลิงก์ตั้งรหัสผ่านไปที่ "+editing.email.trim());
      }catch(authErr){
        if(authErr.message==="EMAIL_EXISTS"){
          // มี Auth account แล้ว ส่ง reset link
          try{
            await sendResetEmailREST(editing.email.trim());
            showToast("✅ เพิ่ม User แล้ว — ส่งลิงก์รีเซ็ตรหัสผ่านให้แล้ว");
          }catch{ showToast("✅ เพิ่ม User แล้ว (มี Auth account อยู่แล้ว)"); }
        } else {
          // REST สร้างไม่ได้ → แนะนำสร้างเองใน Console
          showToast("⚠️ เพิ่มใน DB แล้ว แต่สร้าง Auth ไม่สำเร็จ ("+authErr.message+") → สร้างใน Firebase Console → Auth → Add user","error");
        }
      }
    } else {
      showToast("บันทึกแล้ว");
    }
    setEditing(null);
  };
  const toggle=async u=>{if(u.id===curUser.id){showToast("ไม่สามารถระงับตัวเองได้","error");return;}await update(ref(db,`${DATA_PATH}/users/${u.id}`),{active:!u.active});showToast(u.active?"ระงับแล้ว":"เปิดแล้ว");};
  const del=async u=>{const newObj=Object.fromEntries(users.filter(x=>x.id!==u.id).map(x=>[x.id,x]));await writeUsers(newObj);showToast("ลบแล้ว");setDelConfirm(null);};
  // [4] Role descriptions with permission list
  const RDESC={superadmin:"เข้าถึงทุกส่วน จัดการ User ตั้งค่าระบบ Template รายงาน",admin:"สร้าง อนุมัติ ดู Memo ทั้งหมด ดูรายงาน",user:"สร้าง Memo ของตัวเอง อนุมัติ Memo ที่ได้รับมอบหมาย"};
  return (
    <div style={{padding:24}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
        <div><div style={{fontSize:18,fontWeight:600,color:"#111"}}>จัดการ User</div><div style={{fontSize:12,color:"#9CA3AF",marginTop:2}}>{users.length} บัญชี</div></div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <input ref={xlsxRef} type="file" accept=".xlsx,.xls" style={{display:"none"}} onChange={handleXlsxImport}/>
          <button onClick={async()=>{const XLSX=await import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs");const ws=XLSX.utils.aoa_to_sheet([["ชื่อ-สกุล","อีเมล์","แผนก","สิทธิ์"],["สมชาย ใจดี","somchai@company.com","IT","user"]]);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Users");XLSX.writeFile(wb,"user_template.xlsx");}} style={{...BTN_GRAY,padding:"6px 12px",fontSize:12}}>⬇ Template</button>
          <button onClick={()=>xlsxRef.current?.click()} style={{padding:"7px 14px",background:"#ECFDF5",color:"#065F46",border:"1px solid #A7F3D0",borderRadius:6,fontSize:12,fontWeight:600,cursor:"pointer"}}>📥 Import Excel</button>
          <button onClick={()=>setEditing(blank)} style={BTN_GOLD}>+ เพิ่ม User</button>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:16}}>
        {["superadmin","admin","user"].map(r=>{const c=ROLE_CONFIG[r];const n=users.filter(u=>u.role===r&&u.active).length;return <div key={r} style={{background:c.bg,border:`1px solid ${c.border}`,borderRadius:8,padding:"10px 14px"}}><div style={{fontSize:11,color:c.text,fontWeight:600}}>{c.label}</div><div style={{fontSize:22,fontWeight:700,color:c.text,marginTop:2}}>{n}</div></div>;})}
      </div>
      <div style={{background:"#fff",border:"1px solid #F3F4F6",borderRadius:10,overflow:"hidden"}}>
        <div style={{display:"grid",gridTemplateColumns:"2fr 2fr 1fr 1fr 1fr auto",padding:"8px 16px",borderBottom:"1px solid #F3F4F6",background:"#F9FAFB"}}>{["ชื่อ","อีเมล์","แผนก","สิทธิ์","สถานะ",""].map((h,i)=><div key={i} style={{fontSize:11,fontWeight:600,color:"#9CA3AF"}}>{h}</div>)}</div>
        {users.map(u=>(
          <div key={u.id} style={{display:"grid",gridTemplateColumns:"2fr 2fr 1fr 1fr 1fr auto",padding:"10px 16px",borderBottom:"1px solid #F3F4F6",alignItems:"center",opacity:u.active?1:.45}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}><Avatar userId={u.id} users={users} size={26}/><span style={{fontSize:12,fontWeight:u.id===curUser.id?600:400,color:"#374151"}}>{u.name}{u.id===curUser.id&&<span style={{fontSize:10,color:GOLD,marginLeft:4}}>(คุณ)</span>}</span></div>
            <div style={{fontSize:12,color:"#6B7280",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.email}</div>
            <div style={{fontSize:12,color:"#374151"}}>{u.dept||"-"}</div>
            <div><RoleBadge role={u.role}/></div>
            <div><span style={{fontSize:11,fontWeight:500,color:u.active?"#065F46":"#991B1B",background:u.active?"#ECFDF5":"#FFF1F1",border:`1px solid ${u.active?"#A7F3D0":"#FECACA"}`,borderRadius:4,padding:"2px 7px"}}>{u.active?"ใช้งาน":"ระงับ"}</span></div>
            <div style={{display:"flex",gap:4}}>
              <button onClick={()=>setEditing({...u})} style={BTN_GRAY}>แก้ไข</button>
              <button onClick={async()=>{try{await sendResetEmailREST(u.email);showToast("ส่งลิงก์รีเซ็ตรหัสผ่านให้ "+u.email+" แล้ว");}catch(e){showToast("ส่งไม่สำเร็จ: "+e.code,"error");}}} style={{padding:"3px 7px",fontSize:11,borderRadius:5,background:"#EFF6FF",color:"#1E40AF",border:"1px solid #BFDBFE",cursor:"pointer"}} title="ส่งลิงก์รีเซ็ตรหัสผ่าน">🔑</button>
              <button onClick={()=>toggle(u)} style={{padding:"3px 7px",fontSize:11,borderRadius:5,background:u.active?"#FFFBEB":"#ECFDF5",color:u.active?"#B45309":"#065F46",border:`1px solid ${u.active?"#FCD34D":"#A7F3D0"}`,cursor:"pointer"}}>{u.active?"ระงับ":"เปิด"}</button>
              {u.id!==curUser.id&&<button onClick={()=>setDelConfirm(u)} style={{...BTN_X,color:"#DC2626",padding:"3px 6px",border:"1px solid #FECACA",borderRadius:5,background:"#FFF1F1"}}>ลบ</button>}
            </div>
          </div>
        ))}
      </div>
      {editing&&<div style={{position:"fixed",inset:0,zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,.5)"}}>
        <div style={{background:"#fff",border:"1px solid #E5E7EB",borderRadius:12,padding:24,width:420,boxShadow:"0 20px 60px rgba(0,0,0,.2)"}}>
          <div style={{fontSize:15,fontWeight:600,marginBottom:16,color:"#111"}}>{editing.id?"แก้ไข User":"เพิ่ม User ใหม่"}</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
            <Field label="ชื่อ-สกุล *"><input value={editing.name} onChange={e=>setEditing(p=>({...p,name:e.target.value}))} style={IS}/></Field>
            <Field label="แผนก"><input value={editing.dept||""} onChange={e=>setEditing(p=>({...p,dept:e.target.value}))} style={IS}/></Field>
            <div style={{gridColumn:"1/-1"}}><Field label="อีเมล์ *"><input value={editing.email} onChange={e=>setEditing(p=>({...p,email:e.target.value}))} style={IS}/></Field></div>
            {/* [4] Role with detailed permissions */}
            <Field label="สิทธิ์">
              <select value={editing.role} onChange={e=>setEditing(p=>({...p,role:e.target.value}))} style={IS}>
                <option value="superadmin">Super Admin</option>
                <option value="admin">Admin</option>
                <option value="user">User</option>
              </select>
            </Field>
            <Field label="สถานะ"><select value={editing.active?"1":"0"} onChange={e=>setEditing(p=>({...p,active:e.target.value==="1"}))} style={IS}><option value="1">ใช้งาน</option><option value="0">ระงับ</option></select></Field>
          </div>
          <div style={{padding:"8px 12px",background:"#F9FAFB",borderRadius:6,fontSize:11,color:"#6B7280",marginBottom:14,lineHeight:1.6}}>
            <strong>สิทธิ์:</strong> {RDESC[editing.role]}
          </div>
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
          <div style={{fontSize:12,color:"#9CA3AF",marginBottom:14}}>พบ {importPreview.length} รายการ</div>
          <div style={{background:"#F9FAFB",borderRadius:8,overflow:"hidden",border:"1px solid #F3F4F6",marginBottom:16}}>
            <div style={{display:"grid",gridTemplateColumns:"2fr 2fr 1fr 1fr",padding:"7px 12px",borderBottom:"1px solid #F3F4F6",background:"#F3F4F6"}}>{["ชื่อ-สกุล","อีเมล์","แผนก","สิทธิ์"].map(h=><div key={h} style={{fontSize:10,fontWeight:700,color:"#6B7280"}}>{h}</div>)}</div>
            {importPreview.map((r,i)=>{const isDup=!!users.find(u=>u.email===r.email);return <div key={i} style={{display:"grid",gridTemplateColumns:"2fr 2fr 1fr 1fr",padding:"7px 12px",borderBottom:"1px solid #F3F4F6",background:isDup?"#FFFBEB":"#fff"}}><div style={{fontSize:12,color:"#374151"}}>{r.name}{isDup&&<span style={{fontSize:10,color:"#B45309"}}> (อัปเดต)</span>}</div><div style={{fontSize:11,color:"#6B7280",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.email}</div><div style={{fontSize:12,color:"#374151"}}>{r.dept||"-"}</div><div><RoleBadge role={r.role}/></div></div>;})}
          </div>
          <div style={{display:"flex",gap:8}}><button onClick={confirmImport} style={{...BTN_GOLD,flex:1,padding:"10px"}}>✓ ยืนยัน Import</button><button onClick={()=>setImportPreview(null)} style={{flex:1,padding:"10px",background:"#F9FAFB",color:"#6B7280",border:"1px solid #E5E7EB",borderRadius:6,fontSize:12,cursor:"pointer"}}>ยกเลิก</button></div>
        </div>
      </div>}
    </div>
  );
}

// Default notify config shape (used by SettingsView)
const DEFAULT_NOTIFY = {
  email:     { enabled:false, serviceId:"", templateId:"", approverTemplateId:"", publicKey:"" },
  teams:     { enabled:false, webhookUrl:"" },
  powerauto: { enabled:false, webhookUrl:"" },
  line:      { enabled:false, channelAccessToken:"", groupId:"" },
};

function SettingsView({ notifyConfig, showToast, onOpenPdfTemplate }) {
  const safe = ch => ({ ...(DEFAULT_NOTIFY[ch]||{}), ...((notifyConfig||{})[ch]||{}) });
  const [email,     setEmail]     = useState(()=>safe("email"));
  const [teams,     setTeams]     = useState(()=>safe("teams"));
  const [powerauto, setPowerauto] = useState(()=>safe("powerauto"));
  const [line,      setLine]      = useState(()=>safe("line"));

  const cfgMap  = { email, teams, powerauto, line };
  const setMap  = { email:setEmail, teams:setTeams, powerauto:setPowerauto, line:setLine };
  const setF    = (ch,k,v) => setMap[ch](p=>({...p,[k]:v}));

  const save = async () => {
    try {
      await writeNotifyConfig({ email, teams, powerauto, line });
      showToast("บันทึกการตั้งค่าแล้ว");
    } catch(e) { showToast("บันทึกไม่สำเร็จ: "+e.message,"error"); }
  };

  const CHANNELS = [
    { id:"email",    icon:"✉",  label:"อีเมล์ (EmailJS)",             color:"#1E40AF",
      fields:[{k:"serviceId",label:"Service ID",ph:"service_xxxxxxx"},{k:"templateId",label:"Template ID (แจ้งเมื่ออนุมัติ)",ph:"template_xxxxxxx"},{k:"approverTemplateId",label:"Template ID (แจ้งผู้อนุมัติ)",ph:"template_xxxxxxx"},{k:"publicKey",label:"Public Key",ph:"your_public_key"}],
      guide:["สมัครที่ emailjs.com (ฟรี 200/เดือน)","สร้าง Email Service → Gmail/Outlook","สร้าง Template ใช้ตัวแปร {{memo_title}} {{creator_name}} {{to_email}}","คัดลอก Service ID / Template ID / Public Key มากรอก"] },
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

      <button onClick={save} style={{display:"inline-flex",alignItems:"center",gap:4,padding:"9px 20px",background:CLR_PRIMARY,color:"#fff",border:"none",borderRadius:6,fontSize:13,fontWeight:600,cursor:"pointer"}}>
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
            style={{padding:"9px 20px",background:CLR_PRIMARY,color:"#fff",border:"none",borderRadius:7,fontSize:13,fontWeight:600,cursor:"pointer"}}>
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
  s.textContent=`@media print{body>*{display:none!important;}#ememo-print-root{display:block!important;}}#ememo-print-root{display:none;font-family:'Noto Sans Thai','Sarabun',sans-serif;}`;
  document.head.appendChild(s);
}

function MemoPDFPreview({ memo, users, onSaveZones, onClose }) {
  const [zones, setZones] = useState((memo.signatureZones||[]).map((z,i)=>({...z,x:z.x??(10+i*35),y:z.y??72})));
  const [printing, setPrinting] = useState(false);
  const [dragInfo, setDragInfo] = useState(null); // {idx, startX, startY, origX, origY}
  const previewRef = useRef();

  useEffect(()=>{ injectPrintCss(); }, []);

  const creator = users.find(u=>u.id===memo.createdBy)||{};
  const allUsers = users.filter(u=>u.active);
  const approvals = (memo.workflowLevels||[]).flatMap(lv=>lv.approvers||[]);
  const fmtD = s => !s?"-":new Date(s).toLocaleDateString("th-TH",{day:"2-digit",month:"long",year:"numeric"});

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
    let root=document.getElementById("ememo-print-root");
    if(!root){root=document.createElement("div");root.id="ememo-print-root";document.body.appendChild(root);}
    const fD=fmtD;
    const C=COMPANY;
    // Build HTML using string concatenation — avoids nested template literal parsing issues
    let html='<div style="width:210mm;min-height:297mm;margin:0 auto;padding:20mm 22mm;box-sizing:border-box;font-family:Noto Sans Thai,Sarabun,sans-serif;font-size:13px;color:#111;position:relative;">';
    // Header
    html+='<div style="text-align:center;border-bottom:2px solid #D4AF37;padding-bottom:12px;margin-bottom:20px;">';
    html+='<div style="font-size:14px;font-weight:700;">'+C+'</div>';
    html+='<div style="font-size:20px;font-weight:700;margin-top:6px;">บันทึกข้อความ (Memo)</div>';
    if(memo.docNo) html+='<div style="font-size:11px;color:#6B7280;">เลขที่ '+memo.docNo+'</div>';
    html+='</div>';
    // Meta table
    html+='<table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:12px;"><tbody>';
    html+='<tr><td style="width:100px;color:#6B7280;padding:3px 0;">เรื่อง:</td><td style="font-weight:600;">'+(memo.title||"")+'</td>';
    html+='<td style="width:80px;color:#6B7280;text-align:right;">หมวดหมู่:</td><td style="text-align:right;">'+(memo.category||"")+'</td></tr>';
    html+='<tr><td style="color:#6B7280;padding:3px 0;">ผู้สร้าง:</td><td>'+(creator.name||"")+(creator.dept?" ("+creator.dept+")":"")+'</td>';
    html+='<td style="color:#6B7280;text-align:right;">วันที่:</td><td style="text-align:right;">'+(memo.createdAt?fD(memo.createdAt):"")+'</td></tr>';
    html+='</tbody></table>';
    html+='<div style="border-top:1px solid #E5E7EB;margin-bottom:20px;"></div>';
    // Content
    html+='<div style="font-size:13px;line-height:1.9;white-space:pre-wrap;min-height:120px;margin-bottom:28px;">'+(memo.content||"")+'</div>';
    // Signature zones
    if(zones.length>0){
      html+='<div style="margin-top:32px;border-top:1px solid #E5E7EB;padding-top:20px;">';
      html+='<div style="font-size:11px;color:#6B7280;font-weight:600;margin-bottom:14px;">ลงนาม</div>';
      html+='<div style="display:flex;gap:24px;flex-wrap:wrap;">';
      zones.forEach(z=>{
        html+='<div style="flex:1;min-width:140px;text-align:center;">';
        html+='<div style="height:52px;border-bottom:1px solid #111;margin-bottom:6px;position:relative;">';
        if(z.signerName) html+='<div style="font-size:9px;color:#9CA3AF;position:absolute;bottom:4px;left:0;right:0;">(ลายเซ็น)</div>';
        html+='</div>';
        html+='<div style="font-size:11px;font-weight:600;">'+(z.label||"จุดลงนาม")+'</div>';
        if(z.signerName) html+='<div style="font-size:10px;color:#6B7280;">'+z.signerName+'</div>';
        html+='</div>';
      });
      html+='</div></div>';
    }
    // Approval table
    if(approvals.length>0){
      html+='<div style="margin-top:24px;border-top:1px solid #E5E7EB;padding-top:16px;">';
      html+='<div style="font-size:11px;color:#6B7280;font-weight:600;margin-bottom:10px;">ขั้นตอนการอนุมัติ</div>';
      html+='<table style="width:100%;border-collapse:collapse;font-size:11px;">';
      html+='<tr style="background:#F9FAFB;"><th style="text-align:left;padding:5px 8px;border:1px solid #E5E7EB;">ผู้อนุมัติ</th>';
      html+='<th style="text-align:center;padding:5px 8px;border:1px solid #E5E7EB;width:80px;">สถานะ</th>';
      html+='<th style="text-align:center;padding:5px 8px;border:1px solid #E5E7EB;width:100px;">วันที่</th>';
      html+='<th style="text-align:left;padding:5px 8px;border:1px solid #E5E7EB;">ลายเซ็น / ความคิดเห็น</th></tr>';
      approvals.forEach(ap=>{
        const u2=users.find(x=>x.id===ap.userId)||{};
        const sl=ap.status==="approved"?"✓ อนุมัติ":ap.status==="rejected"?"✗ ปฏิเสธ":"○ รอ";
        const sig=ap.signature||u2.signature||"";
        html+='<tr><td style="padding:5px 8px;border:1px solid #E5E7EB;">'+(ap.name||u2.name||ap.email||"-")+'</td>';
        html+='<td style="padding:5px 8px;border:1px solid #E5E7EB;text-align:center;">'+sl+'</td>';
        html+='<td style="padding:5px 8px;border:1px solid #E5E7EB;text-align:center;">'+(ap.actionAt?fD(ap.actionAt):"-")+'</td>';
        html+='<td style="padding:5px 8px;border:1px solid #E5E7EB;">';
        if(sig) html+='<img src="'+sig+'" style="height:32px;display:block;margin-bottom:2px;border:1px solid #E5E7EB;border-radius:3px;background:#fff;padding:2px;"/>';
        html+=(ap.comment||"");
        html+='</td></tr>';
      });
      html+='</table></div>';
    }
    // Footer
    html+='<div style="position:absolute;bottom:16mm;left:22mm;right:22mm;display:flex;justify-content:space-between;font-size:10px;color:#9CA3AF;border-top:1px solid #F3F4F6;padding-top:8px;">';
    html+='<span>'+C+'</span><span>พิมพ์เมื่อ '+fD(new Date().toISOString())+'</span></div>';
    html+='</div>';
    root.innerHTML=html;
    setTimeout(()=>{ window.print(); setTimeout(()=>{ root.innerHTML=""; setPrinting(false); },500); },200);
  };

  return (
    <div style={{position:"fixed",inset:0,zIndex:300,display:"flex",background:"rgba(0,0,0,.75)",fontFamily:"'Noto Sans Thai','Sarabun',sans-serif"}}>
      {/* Left controls */}
      <div style={{width:260,background:"#111",color:"#fff",display:"flex",flexDirection:"column",flexShrink:0}}>
        <div style={{padding:"16px 16px 14px",borderBottom:"1px solid #F3F4F6",background:BRAND_NAVY}}>
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
          <button onClick={addZone} style={{width:"100%",padding:"8px",background:"transparent",border:"1px dashed #2563EB",borderRadius:6,color:CLR_PRIMARY,fontSize:12,cursor:"pointer",fontFamily:"inherit",fontWeight:500}}>+ เพิ่มจุดลงนาม</button>
        </div>
        <div style={{padding:14,borderTop:"1px solid #222",display:"flex",flexDirection:"column",gap:8}}>
          <button onClick={handlePrint} disabled={printing} style={{width:"100%",padding:"10px",background:CLR_PRIMARY,color:"#fff",border:"none",borderRadius:6,fontSize:13,fontWeight:700,cursor:printing?"not-allowed":"pointer",fontFamily:"inherit",opacity:printing?.7:1}}>
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
            <div style={{borderBottom:`2px solid ${BRAND_ACCENT}`,paddingBottom:12,marginBottom:20,display:"flex",alignItems:"center",gap:14}}>
              <img src={LOGO_URL} alt="logo" onError={e=>e.target.style.display="none"}
                style={{height:52,width:"auto",objectFit:"contain",flexShrink:0}}/>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:700,color:BRAND_PRIMARY}}>{COMPANY}</div>
                <div style={{fontSize:18,fontWeight:700,marginTop:3}}>บันทึกข้อความ (Memo)</div>
                {memo.docNo&&<div style={{fontSize:11,color:"#6B7280",marginTop:2}}>เลขที่ {memo.docNo}</div>}
              </div>
            </div>
            <table style={{width:"100%",borderCollapse:"collapse",marginBottom:16,fontSize:12}}><tbody>
              <tr><td style={{width:100,color:"#6B7280",paddingBottom:5}}>เรื่อง:</td><td style={{fontWeight:600,paddingBottom:5}}>{memo.title||<span style={{color:"#ccc"}}>ยังไม่ได้กรอก</span>}</td><td style={{width:80,color:"#6B7280",paddingBottom:5,textAlign:"right"}}>หมวดหมู่:</td><td style={{paddingBottom:5,textAlign:"right"}}>{memo.category||"-"}</td></tr>
              <tr><td style={{color:"#6B7280"}}>ผู้สร้าง:</td><td>{creator.name||"-"} {creator.dept?`(${creator.dept})`:""}</td><td style={{color:"#6B7280",textAlign:"right"}}>วันที่:</td><td style={{textAlign:"right"}}>{fmtD(memo.createdAt||new Date().toISOString())}</td></tr>
            </tbody></table>
            <div style={{borderTop:"1px solid #E5E7EB",marginBottom:20}}/>
            <div style={{fontSize:13,lineHeight:1.9,whiteSpace:"pre-wrap",color:"#374151",minHeight:120,marginBottom:28}}>
              {memo.content||<span style={{color:"#ccc",fontStyle:"italic"}}>เนื้อหาจะแสดงที่นี่...</span>}
            </div>
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
                      <td style={{padding:"6px 10px",border:"1px solid #E5E7EB",color:"#6B7280"}}>{ap.actionAt?fmtD(ap.actionAt):"-"}</td>
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

// ── UploadMemoView — อัปโหลดเอกสารที่มีอยู่แล้วและเซ็นชื่อบนเอกสาร ───────────
function UploadMemoView({ curUser, users, showToast, pdfTemplates }) {
  const [file,     setFile]     = useState(null);   // { name, dataUrl, type }
  const [sigPos,   setSigPos]   = useState(null);   // { x%, y% }
  const [sigData,  setSigData]  = useState(curUser?.signature || null);
  const [placing,  setPlacing]  = useState(false);
  const previewRef = useRef();
  const fileRef    = useRef();

  const handleUpload = e => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = ev => setFile({ name:f.name, dataUrl:ev.target.result, type:f.type });
    r.readAsDataURL(f);
    e.target.value = "";
  };

  const handlePreviewClick = e => {
    if (!placing || !previewRef.current) return;
    const rect = previewRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top)  / rect.height) * 100;
    setSigPos({ x: Math.max(0,Math.min(x,80)), y: Math.max(0,Math.min(y,90)) });
    setPlacing(false);
  };

  const handlePrint = () => {
    if (!file) return;
    const root = document.getElementById("ememo-print-root") || (() => {
      const d = document.createElement("div"); d.id = "ememo-print-root"; document.body.appendChild(d); return d;
    })();
    const sigHtml = (sigData && sigPos)
      ? `<img src="${sigData}" style="position:absolute;left:${sigPos.x}%;top:${sigPos.y}%;height:48px;z-index:10;background:rgba(255,255,255,.7);border-radius:3px;padding:2px;"/>`
      : "";
    root.innerHTML = `
      <div style="position:relative;width:210mm;min-height:297mm;margin:0 auto;">
        <img src="${file.dataUrl}" style="width:100%;display:block;"/>
        ${sigHtml}
      </div>`;
    setTimeout(() => { window.print(); setTimeout(() => { root.innerHTML = ""; }, 500); }, 200);
  };

  return (
    <div style={{padding:24}}>
      <div style={{fontSize:18,fontWeight:600,color:"#111",marginBottom:4}}>อัปโหลดเอกสารและลงนาม</div>
      <div style={{fontSize:13,color:"#6B7280",marginBottom:20}}>อัปโหลดไฟล์ PDF หรือรูปภาพเอกสารที่ต้องการเซ็นชื่อ</div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 300px",gap:16,alignItems:"start"}}>
        {/* Preview area */}
        <div>
          {!file ? (
            <div onClick={()=>fileRef.current?.click()}
              style={{border:"2px dashed #E5E7EB",borderRadius:10,padding:"48px 32px",textAlign:"center",cursor:"pointer",background:"#F9FAFB"}}>
              <div style={{fontSize:36,marginBottom:8}}>📄</div>
              <div style={{fontSize:14,fontWeight:500,color:"#374151",marginBottom:4}}>คลิกเพื่ออัปโหลดเอกสาร</div>
              <div style={{fontSize:12,color:"#9CA3AF"}}>รองรับ PDF, PNG, JPG</div>
              <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg" style={{display:"none"}} onChange={handleUpload}/>
            </div>
          ) : (
            <div style={{position:"relative"}}>
              <div style={{fontSize:12,color:"#6B7280",marginBottom:8,display:"flex",alignItems:"center",gap:8}}>
                <span>📄 {file.name}</span>
                {placing && <span style={{background:"#FFFBEB",color:"#B45309",border:"1px solid #FCD34D",borderRadius:4,padding:"2px 8px",fontSize:11,fontWeight:500}}>คลิกบนเอกสารเพื่อวางลายเซ็น</span>}
              </div>
              <div ref={previewRef} onClick={handlePreviewClick}
                style={{position:"relative",border:"1px solid #E5E7EB",borderRadius:6,overflow:"hidden",cursor:placing?"crosshair":"default",background:"#fff",boxShadow:"0 2px 16px rgba(0,0,0,.08)"}}>
                <img src={file.dataUrl} alt="doc" style={{width:"100%",display:"block"}}/>
                {sigData && sigPos && (
                  <img src={sigData} alt="sig" draggable={false}
                    style={{position:"absolute",left:`${sigPos.x}%`,top:`${sigPos.y}%`,height:48,zIndex:10,background:"rgba(255,255,255,.8)",borderRadius:3,padding:2,border:`1px solid ${BRAND_ACCENT}`}}/>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Controls */}
        <div>
          {/* Signature */}
          <div style={{background:"#fff",border:"1px solid #F3F4F6",borderRadius:10,padding:14,marginBottom:12}}>
            <div style={{fontSize:11,fontWeight:600,color:"#9CA3AF",textTransform:"uppercase",letterSpacing:.5,marginBottom:10}}>ลายเซ็น</div>
            <SignaturePad value={sigData} onChange={setSigData}/>
          </div>

          {/* Place signature */}
          {file && sigData && (
            <button onClick={()=>setPlacing(true)} style={{width:"100%",padding:"10px",background:placing?"#EFF6FF":CLR_PRIMARY,color:placing?"#1E40AF":"#fff",border:placing?"2px solid #FCD34D":"none",borderRadius:6,fontSize:12,fontWeight:600,cursor:"pointer",marginBottom:8,fontFamily:"inherit"}}>
              {placing ? "🎯 คลิกบนเอกสารเพื่อวางตำแหน่ง" : (sigPos ? "📍 เปลี่ยนตำแหน่งลายเซ็น" : "📍 วางลายเซ็นบนเอกสาร")}
            </button>
          )}
          {sigPos && (
            <button onClick={()=>setSigPos(null)} style={{width:"100%",padding:"8px",background:"#F9FAFB",color:"#9CA3AF",border:"1px solid #E5E7EB",borderRadius:6,fontSize:11,cursor:"pointer",marginBottom:8,fontFamily:"inherit"}}>
              ✕ ลบลายเซ็นออกจากเอกสาร
            </button>
          )}
          {file && (
            <button onClick={handlePrint} style={{width:"100%",padding:"11px",background:"#16A34A",color:"#fff",border:"none",borderRadius:6,fontSize:13,fontWeight:700,cursor:"pointer",marginBottom:8,fontFamily:"inherit"}}>
              🖨️ พิมพ์ / บันทึก PDF
            </button>
          )}
          <button onClick={()=>{setFile(null);setSigPos(null);}} style={{width:"100%",padding:"9px",background:"#F9FAFB",color:"#6B7280",border:"1px solid #E5E7EB",borderRadius:6,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
            🔄 เริ่มใหม่
          </button>

          <div style={{marginTop:14,padding:"10px 12px",background:"#F0F9FF",border:"1px solid #BAE6FD",borderRadius:8,fontSize:11,color:"#0369A1",lineHeight:1.7}}>
            <strong>วิธีใช้:</strong><br/>
            1. อัปโหลดเอกสาร PDF หรือรูปภาพ<br/>
            2. วาดลายเซ็นในช่องด้านบน<br/>
            3. กด "วางลายเซ็น" แล้วคลิกตำแหน่งบนเอกสาร<br/>
            4. กด "พิมพ์ / บันทึก PDF"
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function EMemo() {
  const [authUser,      setAuthUser]      = useState(undefined);
  const [data,          setData]          = useState(null);
  const [view,          setView]          = useState("dashboard");
  const [selId,         setSelId]         = useState(null);
  const [editMemo,      setEditMemo]      = useState(null);
  const [modal,         setModal]         = useState(null);
  const [toast,         setToast]         = useState(null);
  const [syncing,       setSyncing]       = useState(false);
  const [showTplManager,setShowTplManager]= useState(false);
  const [showProfile,   setShowProfile]   = useState(false);   // [1]
  const [showSigZones,  setShowSigZones]  = useState(false);   // [2]

  useEffect(()=>{ const u=onAuthStateChanged(auth,u=>setAuthUser(u||null)); return()=>u(); },[]);
  useEffect(()=>{ if(!authUser)return; const u=onValue(ref(db,DATA_PATH),snap=>setData(snap.val()||{users:{},memos:{},notifyConfig:{}})); return()=>u(); },[authUser]);

  // ── History API (must be before early returns — Rules of Hooks) ──────────
  useEffect(() => {
    const onPop = (e) => {
      const s = e.state;
      if (s?.view) { setView(s.view); setSelId(s.selId||null); setEditMemo(null); }
      else { setView("dashboard"); setSelId(null); }
    };
    window.addEventListener("popstate", onPop);
    window.history.replaceState({ view:"dashboard" }, "", window.location.pathname);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const showToast=(msg,type="success")=>{ setToast({msg,type}); setTimeout(()=>setToast(null),3200); };

  if (authUser===undefined) return <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"#F8FAFC",fontFamily:"'Noto Sans Thai','Sarabun',sans-serif"}}><div style={{textAlign:"center"}}><div style={{width:40,height:40,background:CLR_PRIMARY,borderRadius:10,margin:"0 auto 12px",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,color:BLACK,fontWeight:700}}>E</div><div style={{color:"#666",fontSize:13}}>กำลังโหลด...</div></div></div>;
  if (!authUser) return <Login/>;
  if (!data) return <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"#F9FAFB",fontSize:13,color:"#6B7280",fontFamily:"'Noto Sans Thai','Sarabun',sans-serif"}}>กำลังโหลดข้อมูล...</div>;

  const pushHistory = (v, extra={}) => window.history.pushState({ view:v, ...extra }, "", window.location.pathname);

  const users        = Object.values(data.users    ||{});
  const memoList     = Object.values(data.memos    ||{});
  const notifyConfig = data.notifyConfig||{email:{},teams:{},powerauto:{},line:{}};
  const pdfTemplates = data.pdfTemplates ||{};
  const docCounters  = data.docCounters  ||{};

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

  // ── Dept-based visibility ──────────────────────────────────────────────────
  // superadmin: เห็นทุก Memo / admin: แผนกตัวเอง + assigned / user: ของตัวเอง + assigned
  const visibleMemos = (() => {
    if (curUser.role === "superadmin") return memoList;
    return memoList.filter(m => {
      if (m.createdBy === curUser.id) return true;
      const isApprover = (m.workflowLevels||[]).flatMap(lv=>lv.approvers||[])
        .some(ap=>(ap.userId&&ap.userId===curUser.id)||(ap.email&&ap.email===curUser.email));
      if (isApprover) return true;
      if (curUser.role === "admin" && curUser.dept) {
        const creator = users.find(u=>u.id===m.createdBy);
        const memoDept = m.dept || creator?.dept;
        if (memoDept && memoDept === curUser.dept) return true;
      }
      return false;
    });
  })();

  const selMemo = visibleMemos.find(m=>m.id===selId);

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
      await writeMemo(payload,isNew);
      // [6] Send email to level 1 approvers when submitting
      if(!isDraft&&levels.length) await sendApproverEmail(notifyConfig,payload,levels[0],users);
    } finally { setSyncing(false); }
    setEditMemo(null); showToast(isDraft?"บันทึกร่างแล้ว":"ส่ง Memo เพื่ออนุมัติแล้ว"); setView("myMemos");
  };

  const recallMemo = async memo => {
    const now = new Date().toISOString();
    // เรียกคืน: ล้างลายเซ็นและสถานะการอนุมัติทั้งหมด
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
    showToast("เรียกคืน Memo แล้ว — ลายเซ็นถูกล้างแล้ว");
  };

  // [3] Level-based approval ─────────────────────────────────────────────────
  const approveMemo = async (memo, comment, sigData=null) => {
    const now     = new Date().toISOString();
    const lvIdx   = memo.currentLevel||0;
    const levels  = (memo.workflowLevels||[]).map((lv,li)=>{
      if(li!==lvIdx) return lv;
      return {...lv, approvers:(lv.approvers||[]).map(ap=>{
        const matchUser  = ap.userId&&ap.userId===curUser.id;
        const matchEmail = ap.email&&ap.email===curUser.email;
        if((matchUser||matchEmail)&&ap.status==="pending")
          return {...ap, status:"approved", comment, actionAt:now, signature:sigData||curUser.signature||null};
        return ap;
      })};
    });
    const curLevel  = levels[lvIdx];
    const lvDone    = isLevelDone(curLevel);
    const nextLevel = lvIdx+1;
    const allDone   = lvDone && nextLevel>=levels.length;
    const newStatus = allDone?"approved":"pending";
    const newLvIdx  = lvDone&&!allDone ? nextLevel : lvIdx;
    const patch     = { workflowLevels:levels, currentLevel:newLvIdx, status:newStatus,
      history:[...(memo.history||[]),{action:"approved",by:curUser.id,at:now,comment}] };
    if(allDone&&!memo.docNo){ const docNo=await assignDocNo(memo,users,docCounters); patch.docNo=docNo; }
    await patchMemo(memo.id,patch);
    setModal(null); setSelId(memo.id);
    showToast(allDone?"✅ อนุมัติครบทุกลำดับ กำลังส่งแจ้งเตือน...":lvDone?"อนุมัติลำดับนี้แล้ว ส่งต่อลำดับถัดไป":"อนุมัติแล้ว รอผู้อนุมัติคนอื่นในลำดับเดียวกัน");
    if(allDone) await sendApprovedNotifications(notifyConfig,{...memo,...patch},users);
    // [6] email next level approvers
    else if(lvDone&&levels[newLvIdx]) await sendApproverEmail(notifyConfig,{...memo,...patch},levels[newLvIdx],users);
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

  // [2] Save signature zones
  const saveSigZones = async (zones) => {
    if(!editMemo?.id) return;
    await patchMemo(editMemo.id,{signatureZones:zones});
    setEditMemo(p=>({...p,signatureZones:zones}));
    showToast("บันทึกจุดลงนามแล้ว");
    setShowSigZones(false);
  };

  const NAV=[
    {k:"dashboard",l:"ภาพรวม",     i:"⊞",roles:["superadmin","admin","user"]},
    {k:"inbox",    l:"กล่องขาเข้า",i:"↓",badge:inbox.length||null,roles:["superadmin","admin","user"]},
    {k:"myMemos",  l:"Memo ของฉัน",i:"◉",roles:["superadmin","admin","user"]},
    {k:"all",      l:"ทั้งหมด",    i:"≡",roles:["superadmin","admin"]},
    {k:"search",   l:"ค้นหา",      i:"⌕",roles:["superadmin","admin","user"]},
    {k:"users",    l:"จัดการ User",i:"◎",roles:["superadmin"]},
    {k:"settings", l:"ตั้งค่าระบบ",i:"⚙",roles:["superadmin"]},
  ];

  return (
    <div style={{fontFamily:"'Noto Sans Thai','Sarabun',sans-serif",display:"flex",height:"100vh",overflow:"hidden"}}>
      <Toast t={toast}/>
      {syncing&&<div style={{position:"fixed",bottom:16,left:216,background:"#FFFBEB",color:"#B45309",border:"1px solid #FCD34D",borderRadius:6,padding:"4px 10px",fontSize:11,zIndex:100}}>⟳ กำลังบันทึก...</div>}
      {modal&&<ActionModal modal={modal} onClose={()=>setModal(null)} onApprove={(c,sig)=>approveMemo(modal.memo,c,sig)} onReject={c=>rejectMemo(modal.memo,c)} curUser={curUser}/>}
      {showProfile&&<ProfileModal curUser={curUser} onClose={()=>setShowProfile(false)} showToast={showToast}/>}
      {showTplManager&&can(curUser.role,"settings")&&<DocxTemplateManager templates={pdfTemplates} onSave={async tpls=>{await writePdfTemplates(tpls);showToast("บันทึก Template แล้ว");setShowTplManager(false);}} onClose={()=>setShowTplManager(false)}/>}
      {showSigZones&&editMemo&&<SignatureZonesModal memo={editMemo} users={users} curUser={curUser} onSave={saveSigZones} onClose={()=>setShowSigZones(false)}/>}

      {/* Sidebar */}
      <div style={{width:220,background:"#fff",borderRight:"1px solid #E5E7EB",display:"flex",flexDirection:"column",flexShrink:0,boxShadow:"2px 0 8px rgba(0,0,0,.04)"}}>
        <div style={{padding:"16px 16px 14px",borderBottom:"1px solid #F3F4F6",background:BRAND_NAVY}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <img src={LOGO_URL} alt="logo" onError={e=>{e.target.style.display="none";e.target.nextSibling.style.display="flex";}}
                style={{height:36,width:"auto",objectFit:"contain",flexShrink:0,maxWidth:36}}/>
              <div style={{width:28,height:28,background:BRAND_ACCENT,borderRadius:6,display:"none",alignItems:"center",justifyContent:"center",fontSize:14,color:"#111",fontWeight:700,flexShrink:0}}>E</div>
            <div><div style={{fontSize:12,fontWeight:600,color:"#fff",letterSpacing:.3}}>E-Memo System</div><div style={{fontSize:9,color:"rgba(255,255,255,.65)",lineHeight:1.3,marginTop:1}}>ไทยซอสเซส มาร์เก็ตติ้ง</div></div>
          </div>
        </div>
        <div style={{padding:"10px 10px 6px"}}><button onClick={startCreate} style={{width:"100%",padding:"9px",fontSize:12,borderRadius:6,background:CLR_PRIMARY,color:"#fff",border:"none",fontWeight:600,cursor:"pointer",fontFamily:"inherit",borderRadius:6}}>+ สร้าง Memo ใหม่</button></div>
        <nav style={{flex:1,padding:"4px 8px",overflowY:"auto"}}>
          {NAV.filter(n=>n.roles.includes(curUser.role)).map(n=>(
            <button key={n.k} onClick={()=>{ setView(n.k); pushHistory(n.k); }} style={{width:"100%",padding:"8px 10px",borderRadius:6,background:view===n.k?"#EFF6FF":"transparent",color:view===n.k?CLR_PRIMARY:"#6B7280",fontWeight:view===n.k?600:400,border:"none",fontSize:12,cursor:"pointer",display:"flex",alignItems:"center",gap:8,marginBottom:1,textAlign:"left"}}>
              <span style={{fontSize:13,width:16,textAlign:"center"}}>{n.i}</span>
              <span style={{flex:1}}>{n.l}</span>
              {n.badge?<span style={{background:"#DC2626",color:"#fff",borderRadius:10,fontSize:10,padding:"1px 5px",fontWeight:600}}>{n.badge}</span>:null}
            </button>
          ))}
        </nav>
        <div style={{borderTop:"1px solid #F3F4F6",padding:"10px 12px"}}>
          {/* [1] Profile button */}
          <button onClick={()=>setShowProfile(true)} style={{width:"100%",display:"flex",alignItems:"center",gap:8,marginBottom:8,background:"transparent",border:"none",cursor:"pointer",padding:"2px 0"}}>
            <Avatar userId={curUser.id} users={users.length?users:[curUser]} size={26}/>
            <div style={{minWidth:0,textAlign:"left"}}>
              <div style={{fontSize:11,fontWeight:500,color:"#374151",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{curUser.name}</div>
              <div style={{fontSize:10,color:GOLD}}>{curUser.signature?"✍ มีลายเซ็น":"คลิกตั้งลายเซ็น"}</div>
            </div>
          </button>
          <button onClick={()=>signOut(auth)} style={{width:"100%",padding:"7px",background:"#F9FAFB",color:"#6B7280",border:"1px solid #E5E7EB",borderRadius:6,fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>ออกจากระบบ</button>
        </div>
      </div>

      {/* Main */}
      <div style={{flex:1,overflowY:"auto",background:"#F9FAFB"}}>
        {view==="dashboard"&&<Dashboard memoList={visibleMemos} users={users} curUser={curUser} inboxCount={inbox.length} onOpen={openMemo}/>}
        {view==="inbox"    &&<MemoListView memoList={inbox}   users={users} title="กล่องขาเข้า" subtitle={`${inbox.length} รายการรอการอนุมัติ`} curUser={curUser} onOpen={openMemo} highlight/>}
        {view==="myMemos"  &&<MemoListView memoList={myMemos} users={users} title="Memo ของฉัน" curUser={curUser} onOpen={openMemo} onRecall={recallMemo} onEdit={startEdit}/>}
        {view==="all"      &&can(curUser.role,"viewAll")&&<MemoListView memoList={visibleMemos} users={users} title="Memo ทั้งหมด" curUser={curUser} onOpen={openMemo}/>}
        {view==="search"   &&<SearchView memoList={visibleMemos} users={users} curUser={curUser} onOpen={openMemo}/>}
        {view==="users"    &&can(curUser.role,"manageUsers")&&<UsersMgmt users={users} curUser={curUser} showToast={showToast}/>}
        {view==="upload"    &&<UploadMemoView curUser={curUser} users={users} showToast={showToast} pdfTemplates={pdfTemplates}/>}
        {view==="settings" &&(
          can(curUser.role,"settings")
            ? <ErrorBoundary><SettingsView notifyConfig={notifyConfig} showToast={showToast} onOpenPdfTemplate={()=>setShowTplManager(true)}/></ErrorBoundary>
            : <div style={{padding:32,textAlign:"center",color:"#9CA3AF",fontSize:13}}>
                <div style={{fontSize:24,marginBottom:8}}>🔒</div>
                <div>สิทธิ์ไม่เพียงพอ (role: {curUser.role||"ไม่ระบุ"})</div>
                <div style={{fontSize:11,marginTop:4}}>ต้องเป็น Super Admin เท่านั้น</div>
              </div>
        )}
        {view==="create"   &&editMemo&&<CreateView editMemo={editMemo} setEditMemo={setEditMemo} users={users} curUser={curUser} notifyConfig={notifyConfig} onSubmit={submitMemo} onCancel={()=>{setEditMemo(null);setView("myMemos");}} isRecall={!!editMemo.id&&editMemo.status==="recalled"} onOpenSigZones={()=>setShowSigZones(true)}/>}
        {view==="detail"   &&selMemo&&<DetailView memo={selMemo} users={users} curUser={curUser} notifyConfig={notifyConfig} pdfTemplates={pdfTemplates} onBack={()=>setView("myMemos")} onRecall={()=>recallMemo(selMemo)} onEdit={()=>startEdit(selMemo)} onAddFile={f=>addAtt(selMemo,f)} onRemoveFile={id=>remAtt(selMemo,id)} setModal={setModal}/>}
      </div>
    </div>
  );
}
