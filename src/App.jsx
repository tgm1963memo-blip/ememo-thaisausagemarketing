import { useState, useEffect, useRef } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { ref, onValue, set, push, update } from "firebase/database";
import { auth, db, DATA_PATH } from "./firebase";
import Login from "./Login";

// ── Theme (from uploaded file) ────────────────────────────────────────────────
const GOLD  = "#D4AF37";
const BLACK = "#111111";

// ── Constants ─────────────────────────────────────────────────────────────────
const COMPANY       = "บริษัท ไทยซอสเซส มาร์เก็ตติ้ง จำกัด";
const COMPANY_SHORT = "Thai Sauces Marketing";
const CATEGORIES    = ["ทั่วไป","งบประมาณ","จัดซื้อจัดจ้าง","รายงาน","นโยบาย","HR","IT","อื่นๆ"];

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

// ── Permission (from uploaded file) ──────────────────────────────────────────
const can = (role, action) => {
  const perms = {
    superadmin: ["manageUsers","settings","viewAll","create","approve","recall"],
    admin:      ["viewAll","create","approve","recall"],
    user:       ["create","recall"],
  };
  return perms[role]?.includes(action) ?? false;
};

// ── Firebase write helpers ────────────────────────────────────────────────────
// users/memos stored as objects in RTDB — use push() for new memos (from uploaded file)
const writeMemo = async (memoData, isNew) => {
  if (isNew) {
    const newRef = push(ref(db, `${DATA_PATH}/memos`));
    const id = newRef.key;
    await set(newRef, { ...memoData, id });
    return id;
  }
  await set(ref(db, `${DATA_PATH}/memos/${memoData.id}`), memoData);
  return memoData.id;
};
const patchMemo        = (id, patch)    => update(ref(db, `${DATA_PATH}/memos/${id}`), patch);
const writeUsers       = (usersObj)     => set(ref(db, `${DATA_PATH}/users`), usersObj);
const writeNotifyConfig= (cfg)          => set(ref(db, `${DATA_PATH}/notifyConfig`), cfg);
const writePdfTemplate = (tpl)          => set(ref(db, `${DATA_PATH}/pdfTemplate`), tpl);

// ── Notification senders ──────────────────────────────────────────────────────
async function sendNotifications(cfg, memo, users) {
  const creator      = users.find(u => u.id === memo.createdBy) || {};
  const approvedDate = new Date().toLocaleDateString("th-TH",{day:"2-digit",month:"long",year:"numeric"});
  const summary      = (memo.content || "").slice(0, 200);

  if (cfg.email?.enabled && cfg.email?.serviceId && memo.notify?.emailList?.length) {
    for (const toEmail of memo.notify.emailList) {
      try {
        await fetch("https://api.emailjs.com/api/v1.0/email/send",{
          method:"POST", headers:{"Content-Type":"application/json"},
          body:JSON.stringify({ service_id:cfg.email.serviceId, template_id:cfg.email.templateId,
            user_id:cfg.email.publicKey,
            template_params:{ to_email:toEmail, memo_title:memo.title, creator_name:creator.name,
              approved_date:approvedDate, category:memo.category, memo_summary:summary, company:COMPANY }}),
        });
      } catch {}
    }
  }
  if (cfg.teams?.enabled && cfg.teams?.webhookUrl && memo.notify?.postToTeams) {
    try {
      await fetch(cfg.teams.webhookUrl,{ method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ "@type":"MessageCard", themeColor:"D4AF37",
          summary:`✅ อนุมัติ Memo: ${memo.title}`,
          sections:[{ activityTitle:"✅ Memo ได้รับการอนุมัติครบแล้ว", activitySubtitle:COMPANY,
            facts:[{name:"📋 เรื่อง",value:memo.title},{name:"👤 ผู้สร้าง",value:creator.name||"-"},
              {name:"📁 หมวด",value:memo.category},{name:"📅 วันที่",value:approvedDate}],
            markdown:true }]})});
    } catch {}
  }
  if (cfg.powerauto?.enabled && cfg.powerauto?.webhookUrl && memo.notify?.postToPowerAuto) {
    try {
      await fetch(cfg.powerauto.webhookUrl,{ method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ memo_id:memo.id, memo_title:memo.title, creator_name:creator.name,
          creator_email:creator.email, category:memo.category, approved_date:approvedDate,
          summary, company:COMPANY, status:"approved" })});
    } catch {}
  }
  if (cfg.line?.enabled && cfg.line?.channelAccessToken && cfg.line?.groupId && memo.notify?.postToLine) {
    try {
      const msg = [`✅ [${COMPANY_SHORT}] Memo อนุมัติครบแล้ว`, `📋 ${memo.title}`,
        `👤 โดย: ${creator.name||"-"}`, `📁 หมวด: ${memo.category}`, `📅 ${approvedDate}`,
        summary ? `\n📝 ${summary.slice(0,100)}${summary.length>100?"...":""}` : ""]
        .filter(Boolean).join("\n");
      await fetch("/api/line-push",{ method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ to:cfg.line.groupId, message:msg, channelAccessToken:cfg.line.channelAccessToken })});
    } catch {}
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtDate  = s => !s ? "-" : new Date(s).toLocaleDateString("th-TH",{day:"2-digit",month:"short",year:"numeric"}) + " " + new Date(s).toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit"});
const fmtShort = s => !s ? "-" : new Date(s).toLocaleDateString("th-TH",{day:"2-digit",month:"short",year:"2-digit"});
const getInit  = (name="") => { const p=name.trim().split(" "); return p.length>=2 ? p[0][0]+p[1][0] : name.slice(0,2); };
const newMemoId= () => "m"+Date.now();
const newAttId = () => "a"+Date.now()+Math.random().toString(36).slice(2,5);
const newUserId= () => "u"+Date.now()+Math.random().toString(36).slice(2,5);

// ── Shared styles ─────────────────────────────────────────────────────────────
const IS = { width:"100%", padding:"8px 10px", border:"1px solid #E5E7EB", borderRadius:6, fontSize:13, background:"#fff", color:"#111", boxSizing:"border-box" };
const BTN_GOLD = { display:"inline-flex", alignItems:"center", justifyContent:"center", gap:4, padding:"7px 14px", background:GOLD, color:BLACK, border:"none", borderRadius:6, fontSize:12, fontWeight:600, cursor:"pointer" };
const BTN_GRAY = { padding:"4px 10px", fontSize:11, borderRadius:6, background:"#F9FAFB", color:"#6B7280", border:"1px solid #E5E7EB", cursor:"pointer" };
const BTN_X    = { background:"none", border:"none", cursor:"pointer", fontSize:12, color:"#9CA3AF", padding:"0 2px" };
const ATT_ROW  = { display:"flex", alignItems:"center", gap:8, padding:"6px 10px", background:"#F9FAFB", borderRadius:6, marginBottom:4, fontSize:12, border:"1px solid #F3F4F6" };

// ── UI Components ─────────────────────────────────────────────────────────────
function Avatar({ userId, users, size=28 }) {
  const u   = users.find(x => x.id === userId) || {};
  const idx = users.findIndex(x => x.id === userId);
  const c   = PALETTES[(idx<0?0:idx) % PALETTES.length];
  return (
    <div style={{ width:size, height:size, borderRadius:"50%", background:c.bg, color:c.text, display:"flex", alignItems:"center", justifyContent:"center", fontSize:size*.36, fontWeight:600, flexShrink:0 }}>
      {getInit(u.name || "?")}
    </div>
  );
}

function RoleBadge({ role }) {
  const c = ROLE_CONFIG[role] || ROLE_CONFIG.user;
  return <span style={{ background:c.bg, color:c.text, border:`1px solid ${c.border}`, borderRadius:4, padding:"2px 7px", fontSize:11, fontWeight:500, whiteSpace:"nowrap" }}>{c.label}</span>;
}

function StatusBadge({ status }) {
  const c = STATUS_COLOR[status] || STATUS_COLOR.draft;
  return <span style={{ background:c.bg, color:c.text, border:`1px solid ${c.border}`, borderRadius:4, padding:"2px 7px", fontSize:11, fontWeight:500, whiteSpace:"nowrap" }}>{STATUS_LABEL[status]||status}</span>;
}

function Toast({ t }) {
  if (!t) return null;
  const ok = t.type !== "error";
  return (
    <div style={{ position:"fixed", top:20, right:20, zIndex:200, padding:"10px 16px", borderRadius:8, background:ok?"#ECFDF5":"#FFF1F1", color:ok?"#065F46":"#991B1B", border:`1px solid ${ok?"#A7F3D0":"#FECACA"}`, fontSize:13, fontWeight:500, boxShadow:"0 4px 20px rgba(0,0,0,.12)" }}>
      {t.msg}
    </div>
  );
}

function Empty({ msg }) {
  return (
    <div style={{ textAlign:"center", padding:"48px 20px", color:"#9CA3AF", fontSize:13 }}>
      <div style={{ fontSize:32, opacity:.25, marginBottom:8 }}>○</div>{msg}
    </div>
  );
}

function Section({ title, children, extra }) {
  return (
    <div style={{ background:"#fff", border:"1px solid #F3F4F6", borderRadius:10, padding:16, marginBottom:12 }}>
      {title && (
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10, paddingBottom:8, borderBottom:"1px solid #F3F4F6" }}>
          <span style={{ fontSize:11, fontWeight:600, color:"#9CA3AF", textTransform:"uppercase", letterSpacing:.6 }}>{title}</span>
          {extra}
        </div>
      )}
      {children}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom:10 }}>
      <label style={{ fontSize:11, fontWeight:600, color:"#6B7280", display:"block", marginBottom:3 }}>{label}</label>
      {children}
    </div>
  );
}

function Toggle({ value, onChange }) {
  return (
    <div onClick={() => onChange(!value)} style={{ width:38, height:21, borderRadius:11, background:value?GOLD:"#D1D5DB", cursor:"pointer", position:"relative", transition:"background .2s", flexShrink:0 }}>
      <div style={{ width:15, height:15, borderRadius:"50%", background:"#fff", position:"absolute", top:3, left:value?20:3, transition:"left .2s" }}/>
    </div>
  );
}

function WorkflowChain({ memo, users }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:3, flexWrap:"wrap" }}>
      {(memo.workflow||[]).map((step, i) => {
        const u      = users.find(x => x.id===step.approver) || {};
        const active = i===memo.currentStep && memo.status==="pending";
        const done   = step.status==="approved";
        const rej    = step.status==="rejected";
        return (
          <div key={i} style={{ display:"flex", alignItems:"center", gap:3 }}>
            {i>0 && <div style={{ width:12, height:1, background:"#E5E7EB" }}/>}
            <div title={u.name} style={{ padding:"2px 7px", borderRadius:20, fontSize:11, fontWeight:500,
              background:done?"#ECFDF5":rej?"#FFF1F1":active?"#FFFBEB":"#F9FAFB",
              color:done?"#065F46":rej?"#991B1B":active?"#B45309":"#6B7280",
              border:`1px solid ${done?"#A7F3D0":rej?"#FECACA":active?"#FCD34D":"#E5E7EB"}` }}>
              {done?"✓":rej?"✗":active?"●":"○"} {(u.name||"?").split(" ")[0]}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MemoRow({ memo, users, onClick, highlight, curUser, onRecall, onEdit }) {
  const creator = users.find(u => u.id===memo.createdBy) || {};
  const isOwn   = memo.createdBy === curUser?.id;
  return (
    <div onClick={onClick} style={{ background:"#fff", border:`1px solid ${highlight?"#FCD34D":"#F3F4F6"}`, borderRadius:8, padding:"10px 14px", marginBottom:6, cursor:"pointer" }}>
      <div style={{ display:"flex", alignItems:"flex-start", gap:10 }}>
        <Avatar userId={memo.createdBy} users={users} size={28}/>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:4, flexWrap:"wrap" }}>
            <span style={{ fontSize:13, fontWeight:500, color:"#111", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:260 }}>{memo.title}</span>
            <StatusBadge status={memo.status}/>
            <span style={{ fontSize:11, color:"#9CA3AF", background:"#F9FAFB", padding:"1px 6px", borderRadius:4, border:"1px solid #F3F4F6" }}>{memo.category}</span>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
            <span style={{ fontSize:11, color:"#9CA3AF" }}>{creator.name} · {fmtShort(memo.createdAt)}</span>
            {memo.attachments?.length>0 && <span style={{ fontSize:11, color:"#9CA3AF" }}>📎 {memo.attachments.length}</span>}
            {memo.workflow?.length>0 && <WorkflowChain memo={memo} users={users}/>}
          </div>
        </div>
        {isOwn && onRecall && (
          <div style={{ display:"flex", gap:4, flexShrink:0 }} onClick={e=>e.stopPropagation()}>
            {memo.status==="pending" && can(curUser.role,"recall") && <button onClick={()=>onRecall(memo)} style={BTN_GRAY}>เรียกคืน</button>}
            {(memo.status==="draft"||memo.status==="recalled") && <button onClick={()=>onEdit(memo)} style={{ ...BTN_GRAY, background:"#EFF6FF", color:"#1D4ED8", border:"1px solid #BFDBFE" }}>แก้ไข</button>}
          </div>
        )}
      </div>
    </div>
  );
}

function ActionModal({ modal, onClose, onApprove, onReject }) {
  const [comment, setComment] = useState("");
  const isA = modal.type === "approve";
  return (
    <div style={{ position:"fixed", inset:0, zIndex:100, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(0,0,0,.5)" }}>
      <div style={{ background:"#fff", border:"1px solid #E5E7EB", borderRadius:12, padding:24, width:360, boxShadow:"0 20px 60px rgba(0,0,0,.2)" }}>
        <div style={{ fontSize:15, fontWeight:600, marginBottom:4, color:"#111" }}>{isA?"ยืนยันการอนุมัติ":"ยืนยันการปฏิเสธ"}</div>
        <div style={{ fontSize:12, color:"#6B7280", marginBottom:16, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{modal.memo.title}</div>
        <Field label="ความคิดเห็น (ถ้ามี)">
          <textarea value={comment} onChange={e=>setComment(e.target.value)} rows={3} style={{ ...IS, resize:"none", fontFamily:"inherit" }}/>
        </Field>
        <div style={{ display:"flex", gap:8, marginTop:8 }}>
          <button onClick={()=>isA?onApprove(comment):onReject(comment)} style={{ flex:1, padding:10, background:isA?GOLD:"#DC2626", color:isA?BLACK:"#fff", border:"none", borderRadius:6, fontSize:13, fontWeight:600, cursor:"pointer" }}>
            {isA?"✓ อนุมัติ":"✕ ปฏิเสธ"}
          </button>
          <button onClick={onClose} style={{ flex:1, padding:10, background:"#F9FAFB", color:"#6B7280", border:"1px solid #E5E7EB", borderRadius:6, fontSize:13, cursor:"pointer" }}>ยกเลิก</button>
        </div>
      </div>
    </div>
  );
}

// ── Notify Panel ──────────────────────────────────────────────────────────────
function NotifyPanel({ notify, setNotify, users, notifyConfig }) {
  const [emailIn, setEmailIn] = useState("");
  const addEmail = () => {
    const e = emailIn.trim();
    if (!e || !e.includes("@") || (notify.emailList||[]).includes(e)) return;
    setNotify(p => ({ ...p, emailList:[...(p.emailList||[]), e] }));
    setEmailIn("");
  };
  const remEmail = e => setNotify(p => ({ ...p, emailList:(p.emailList||[]).filter(x=>x!==e) }));
  const channels = [
    { key:"postToTeams",     enabled:notifyConfig.teams?.enabled,     label:"Microsoft Teams",             icon:"🔵" },
    { key:"postToPowerAuto", enabled:notifyConfig.powerauto?.enabled, label:"SharePoint / Power Automate", icon:"🟣" },
    { key:"postToLine",      enabled:notifyConfig.line?.enabled,      label:"LINE Group",                  icon:"🟢" },
  ];
  return (
    <Section title="แจ้งเตือนเมื่ออนุมัติครบ">
      <div style={{ marginBottom:10 }}>
        <div style={{ fontSize:11, fontWeight:600, color:"#6B7280", marginBottom:5 }}>✉ อีเมล์</div>
        {notifyConfig.email?.enabled ? (
          <>
            <div style={{ display:"flex", gap:6, marginBottom:5 }}>
              <input value={emailIn} onChange={e=>setEmailIn(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addEmail()} placeholder="กรอกอีเมล์..." style={{ flex:1, padding:"5px 8px", border:"1px solid #E5E7EB", borderRadius:6, fontSize:12 }}/>
              <button onClick={addEmail} style={BTN_GOLD}>เพิ่ม</button>
            </div>
            <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginBottom:5 }}>
              {users.filter(u=>u.email&&u.active&&!(notify.emailList||[]).includes(u.email)).map(u=>(
                <button key={u.id} onClick={()=>setNotify(p=>({...p,emailList:[...(p.emailList||[]),u.email]}))} style={{ fontSize:10, padding:"2px 6px", borderRadius:4, background:"#F9FAFB", color:"#6B7280", border:"1px solid #E5E7EB", cursor:"pointer" }}>
                  + {u.name.split(" ")[0]}
                </button>
              ))}
            </div>
            {(notify.emailList||[]).map(e => (
              <div key={e} style={ATT_ROW}><span>✉</span><span style={{ flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{e}</span><button onClick={()=>remEmail(e)} style={BTN_X}>✕</button></div>
            ))}
            {!(notify.emailList||[]).length && <div style={{ fontSize:11, color:"#9CA3AF" }}>ยังไม่มีผู้รับ</div>}
          </>
        ) : (
          <div style={{ fontSize:11, color:"#9CA3AF", padding:"4px 8px", background:"#F9FAFB", borderRadius:5 }}>ยังไม่ได้ตั้งค่า → ไปที่ ตั้งค่าระบบ</div>
        )}
      </div>
      <div style={{ borderTop:"1px solid #F3F4F6", paddingTop:8 }}>
        <div style={{ fontSize:11, fontWeight:600, color:"#6B7280", marginBottom:6 }}>📢 ช่องทางอื่น</div>
        {channels.map(ch => (
          <div key={ch.key} style={{ display:"flex", alignItems:"center", gap:8, padding:"5px 8px", borderRadius:6, background:ch.enabled?"#F9FAFB":"transparent", marginBottom:3, opacity:ch.enabled?1:0.4 }}>
            <span style={{ fontSize:14 }}>{ch.icon}</span>
            <span style={{ flex:1, fontSize:12 }}>{ch.label}</span>
            {ch.enabled ? <Toggle value={notify[ch.key]||false} onChange={v=>setNotify(p=>({...p,[ch.key]:v}))}/> : <span style={{ fontSize:10, color:"#9CA3AF" }}>ยังไม่ตั้งค่า</span>}
          </div>
        ))}
      </div>
    </Section>
  );
}

// ── PDF Export ────────────────────────────────────────────────────────────────
async function exportMemoPdf(memo, users, template = {}) {
  const creator = users.find(u => u.id === memo.createdBy) || {};
  const approvedSteps = (memo.workflow || []).filter(s => s.status === "approved");
  const approvers = approvedSteps.map(s => {
    const u = users.find(x => x.id === s.approver) || {};
    return `${u.name || "-"} (${fmtShort(s.actionAt)})`;
  });

  const logoText   = template.logoText   || COMPANY_SHORT;
  const companyName= template.companyName|| COMPANY;
  const headerColor= template.headerColor|| "#D4AF37";
  const showLogo   = template.showLogo   !== false;
  const footerText = template.footerText || "เอกสารนี้ออกโดยระบบ E-Memo";
  const showWatermark = template.showWatermark !== false;

  const html = `
  <html><head><meta charset="utf-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap');
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Sarabun',sans-serif; font-size:13px; color:#111; background:#fff; padding:40px; }
    .header { display:flex; align-items:center; justify-content:space-between; border-bottom:3px solid ${headerColor}; padding-bottom:14px; margin-bottom:20px; }
    .logo-box { width:36px; height:36px; background:${headerColor}; border-radius:7px; display:flex; align-items:center; justify-content:center; font-size:18px; font-weight:700; color:#111; }
    .company { font-size:11px; color:#6B7280; margin-top:2px; }
    .doc-no { font-size:11px; color:#9CA3AF; text-align:right; }
    .title { font-size:18px; font-weight:700; color:#111; margin-bottom:6px; }
    .meta { display:flex; gap:16px; flex-wrap:wrap; font-size:11px; color:#6B7280; margin-bottom:20px; }
    .badge { display:inline-block; padding:2px 10px; border-radius:4px; font-size:11px; font-weight:600; background:#ECFDF5; color:#065F46; border:1px solid #A7F3D0; }
    .section-title { font-size:10px; font-weight:700; color:#9CA3AF; text-transform:uppercase; letter-spacing:.6px; border-bottom:1px solid #F3F4F6; padding-bottom:5px; margin:18px 0 8px; }
    .content { font-size:13px; line-height:1.85; white-space:pre-wrap; color:#374151; background:#FAFAFA; border:1px solid #F3F4F6; border-radius:6px; padding:14px; }
    .approver-row { display:flex; align-items:center; gap:10; padding:7px 0; border-bottom:1px solid #F9FAFB; font-size:12px; }
    .step-num { font-size:10px; color:#9CA3AF; min-width:30px; }
    .sig-box { border:1px solid #E5E7EB; border-radius:6px; padding:10px 14px; margin-bottom:6px; background:#FAFAFA; }
    .sig-name { font-size:12px; font-weight:600; color:#111; }
    .sig-date { font-size:10px; color:#9CA3AF; margin-top:2px; }
    .watermark { position:fixed; top:50%; left:50%; transform:translate(-50%,-50%) rotate(-30deg); font-size:80px; font-weight:700; color:${headerColor}22; pointer-events:none; white-space:nowrap; z-index:0; }
    .footer { border-top:1px solid #F3F4F6; margin-top:30px; padding-top:10px; font-size:10px; color:#9CA3AF; display:flex; justify-content:space-between; }
  </style></head><body>
  ${showWatermark ? `<div class="watermark">อนุมัติแล้ว</div>` : ""}
  <div style="position:relative;z-index:1">
    ${showLogo ? `
    <div class="header">
      <div style="display:flex;align-items:center;gap:10px">
        <div class="logo-box">E</div>
        <div><div style="font-size:13px;font-weight:700;color:${headerColor}">${logoText}</div><div class="company">${companyName}</div></div>
      </div>
      <div class="doc-no"><div style="font-weight:600">E-MEMO</div><div>${memo.id}</div></div>
    </div>` : ""}
    <div class="title">${memo.title || "-"}</div>
    <div class="meta">
      <span>📁 ${memo.category}</span>
      <span>👤 ${creator.name || "-"}</span>
      <span>📅 ${fmtDate(memo.createdAt)}</span>
      <span class="badge">✅ อนุมัติแล้ว</span>
    </div>
    <div class="section-title">เนื้อหา</div>
    <div class="content">${(memo.content || "").replace(/</g,"&lt;")}</div>
    <div class="section-title">ลายเซ็นผู้อนุมัติ</div>
    ${(memo.workflow || []).map((s, i) => {
      const u = users.find(x => x.id === s.approver) || {};
      const done = s.status === "approved";
      return `<div class="sig-box" style="${done ? "" : "opacity:.4"}">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div><div class="sig-name">ขั้น ${i + 1}: ${u.name || "-"}</div><div style="font-size:10px;color:#9CA3AF">${u.dept || ""} ${u.email ? "· " + u.email : ""}</div></div>
          <div style="text-align:right"><div style="font-size:11px;font-weight:600;color:${done ? "#065F46" : "#9CA3AF"}">${done ? "✓ อนุมัติ" : "○ รอ"}</div>${s.actionAt ? `<div class="sig-date">${fmtDate(s.actionAt)}</div>` : ""}</div>
        </div>
        ${s.comment ? `<div style="font-size:11px;color:#6B7280;margin-top:6px;border-top:1px solid #F3F4F6;padding-top:5px">${s.comment}</div>` : ""}
      </div>`;
    }).join("")}
    <div class="footer">
      <span>${footerText}</span>
      <span>พิมพ์เมื่อ: ${new Date().toLocaleDateString("th-TH", { day: "2-digit", month: "long", year: "numeric" })}</span>
    </div>
  </div>
  </body></html>`;

  const w = window.open("", "_blank", "width=800,height=900");
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.onload = () => { w.focus(); w.print(); };
}

// ── PDF Template Editor (superadmin only) ────────────────────────────────────
function PdfTemplateEditor({ template, onSave, onClose }) {
  const [t, setT] = useState({
    logoText:    template.logoText    || COMPANY_SHORT,
    companyName: template.companyName || COMPANY,
    headerColor: template.headerColor || "#D4AF37",
    footerText:  template.footerText  || "เอกสารนี้ออกโดยระบบ E-Memo",
    showLogo:    template.showLogo    !== false,
    showWatermark: template.showWatermark !== false,
  });
  const up = (k, v) => setT(p => ({ ...p, [k]: v }));
  const COLOR_PRESETS = ["#D4AF37","#1E40AF","#065F46","#7C3AED","#DC2626","#111111"];
  return (
    <div style={{ position:"fixed", inset:0, zIndex:200, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(0,0,0,.6)" }}>
      <div style={{ background:"#fff", borderRadius:14, padding:28, width:500, maxHeight:"90vh", overflowY:"auto", boxShadow:"0 24px 80px rgba(0,0,0,.25)" }}>
        <div style={{ fontSize:15, fontWeight:700, color:"#111", marginBottom:4 }}>🎨 ตั้งค่า Template PDF</div>
        <div style={{ fontSize:12, color:"#9CA3AF", marginBottom:20 }}>กำหนดรูปแบบเอกสาร PDF ที่จะ Export จาก Memo ที่อนุมัติแล้ว</div>

        <Field label="ชื่อย่อบริษัท (Header)">
          <input value={t.logoText} onChange={e=>up("logoText",e.target.value)} style={IS}/>
        </Field>
        <Field label="ชื่อบริษัทเต็ม">
          <input value={t.companyName} onChange={e=>up("companyName",e.target.value)} style={IS}/>
        </Field>
        <Field label="ข้อความ Footer">
          <input value={t.footerText} onChange={e=>up("footerText",e.target.value)} style={IS}/>
        </Field>
        <Field label="สี Header">
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <input type="color" value={t.headerColor} onChange={e=>up("headerColor",e.target.value)}
              style={{ width:36, height:36, padding:0, border:"1px solid #E5E7EB", borderRadius:6, cursor:"pointer" }}/>
            <div style={{ display:"flex", gap:4 }}>
              {COLOR_PRESETS.map(c => (
                <div key={c} onClick={()=>up("headerColor",c)}
                  style={{ width:22, height:22, borderRadius:4, background:c, cursor:"pointer", border:t.headerColor===c?"2px solid #111":"2px solid transparent" }}/>
              ))}
            </div>
          </div>
        </Field>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 12px", background:"#F9FAFB", borderRadius:6, border:"1px solid #F3F4F6" }}>
            <span style={{ fontSize:12, color:"#374151" }}>แสดง Header/Logo</span>
            <Toggle value={t.showLogo} onChange={v=>up("showLogo",v)}/>
          </div>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 12px", background:"#F9FAFB", borderRadius:6, border:"1px solid #F3F4F6" }}>
            <span style={{ fontSize:12, color:"#374151" }}>Watermark "อนุมัติแล้ว"</span>
            <Toggle value={t.showWatermark} onChange={v=>up("showWatermark",v)}/>
          </div>
        </div>
        {/* Preview strip */}
        <div style={{ border:`2px solid ${t.headerColor}`, borderRadius:8, padding:"12px 16px", marginBottom:18, background:"#FAFAFA" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
            <div style={{ width:24, height:24, background:t.headerColor, borderRadius:5, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:700, color:"#111" }}>E</div>
            <div>
              <div style={{ fontSize:11, fontWeight:700, color:t.headerColor }}>{t.logoText}</div>
              <div style={{ fontSize:9, color:"#9CA3AF" }}>{t.companyName}</div>
            </div>
          </div>
          <div style={{ fontSize:11, color:"#374151", borderTop:`1px solid ${t.headerColor}44`, paddingTop:6 }}>
            <strong>ชื่อ Memo</strong> · หมวดหมู่ · ผู้สร้าง
          </div>
          <div style={{ fontSize:9, color:"#9CA3AF", marginTop:4 }}>{t.footerText}</div>
        </div>
        <div style={{ display:"flex", gap:8 }}>
          <button onClick={()=>onSave(t)} style={{ ...BTN_GOLD, flex:1, padding:"10px" }}>💾 บันทึก Template</button>
          <button onClick={onClose} style={{ flex:1, padding:"10px", background:"#F9FAFB", color:"#6B7280", border:"1px solid #E5E7EB", borderRadius:6, fontSize:12, cursor:"pointer" }}>ยกเลิก</button>
        </div>
      </div>
    </div>
  );
}

// ── Views ─────────────────────────────────────────────────────────────────────
function Dashboard({ memoList, users, curUser, inboxCount, onOpen }) {
  const stats = [
    { l:"ทั้งหมด",     v:memoList.length,                                c:GOLD       },
    { l:"รออนุมัติ",   v:memoList.filter(m=>m.status==="pending").length, c:"#F59E0B"  },
    { l:"อนุมัติแล้ว", v:memoList.filter(m=>m.status==="approved").length,c:"#059669"  },
    { l:"รอฉัน",       v:inboxCount,                                      c:"#DC2626"  },
  ];
  return (
    <div style={{ padding:24 }}>
      <div style={{ marginBottom:20 }}>
        <div style={{ fontSize:18, fontWeight:600, color:"#111" }}>ภาพรวม</div>
        <div style={{ fontSize:13, color:"#6B7280", display:"flex", alignItems:"center", gap:6, marginTop:2 }}>สวัสดี {curUser.name} · <RoleBadge role={curUser.role}/></div>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:24 }}>
        {stats.map(s => (
          <div key={s.l} style={{ background:"#fff", border:"1px solid #F3F4F6", borderRadius:10, padding:"14px 16px", borderTop:`3px solid ${s.c}` }}>
            <div style={{ fontSize:11, color:"#9CA3AF", marginBottom:6, fontWeight:500 }}>{s.l}</div>
            <div style={{ fontSize:28, fontWeight:700, color:s.c }}>{s.v}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize:13, fontWeight:600, color:"#374151", marginBottom:10 }}>Memo ล่าสุด</div>
      {[...memoList].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,5).map(m=>
        <MemoRow key={m.id} memo={m} users={users} onClick={()=>onOpen(m.id)} curUser={curUser}/>
      )}
    </div>
  );
}

function MemoListView({ memoList, users, title, subtitle, curUser, onOpen, onRecall, onEdit, highlight }) {
  const sorted = [...memoList].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  return (
    <div style={{ padding:24 }}>
      <div style={{ marginBottom:16 }}>
        <div style={{ fontSize:18, fontWeight:600, color:"#111" }}>{title}</div>
        <div style={{ fontSize:12, color:"#9CA3AF", marginTop:2 }}>{subtitle||sorted.length+" รายการ"}</div>
      </div>
      {sorted.length===0 ? <Empty msg="ไม่พบ Memo"/> : sorted.map(m=>
        <MemoRow key={m.id} memo={m} users={users} onClick={()=>onOpen(m.id)} highlight={highlight} curUser={curUser} onRecall={onRecall} onEdit={onEdit}/>
      )}
    </div>
  );
}

function SearchView({ memoList, users, curUser, onOpen }) {
  const [q,setQ]=useState(""); const [fS,setFS]=useState(""); const [fC,setFC]=useState(""); const [fF,setFF]=useState(""); const [fT,setFT]=useState("");
  const res = memoList.filter(m => {
    if (q.trim() && !m.title?.toLowerCase().includes(q.toLowerCase()) && !m.content?.toLowerCase().includes(q.toLowerCase())) return false;
    if (fS && m.status!==fS) return false;
    if (fC && m.category!==fC) return false;
    if (fF && m.createdAt<fF) return false;
    if (fT && m.createdAt>fT+"T23:59:59") return false;
    return true;
  }).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  const has = q||fS||fC||fF||fT;
  return (
    <div style={{ padding:24 }}>
      <div style={{ fontSize:18, fontWeight:600, color:"#111", marginBottom:14 }}>ค้นหา Memo</div>
      <input value={q} onChange={e=>setQ(e.target.value)} placeholder="ค้นหาชื่อเรื่อง, เนื้อหา..." style={{ ...IS, marginBottom:10 }}/>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:8, marginBottom:14 }}>
        <select value={fS} onChange={e=>setFS(e.target.value)} style={{ ...IS,width:"auto" }}><option value="">สถานะทั้งหมด</option>{Object.entries(STATUS_LABEL).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>
        <select value={fC} onChange={e=>setFC(e.target.value)} style={{ ...IS,width:"auto" }}><option value="">หมวดหมู่ทั้งหมด</option>{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select>
        <input type="date" value={fF} onChange={e=>setFF(e.target.value)} style={{ ...IS,width:"auto" }}/>
        <input type="date" value={fT} onChange={e=>setFT(e.target.value)} style={{ ...IS,width:"auto" }}/>
      </div>
      {has ? (
        <>{<div style={{ fontSize:12, color:"#9CA3AF", marginBottom:8 }}>พบ {res.length} รายการ</div>}
        {res.map(m=><MemoRow key={m.id} memo={m} users={users} onClick={()=>onOpen(m.id)} curUser={curUser}/>)}
        {res.length===0&&<Empty msg="ไม่พบผลลัพธ์"/>}</>
      ) : <Empty msg="พิมพ์คำค้นหาหรือเลือกตัวกรอง"/>}
    </div>
  );
}

function CreateView({ editMemo, setEditMemo, users, curUser, notifyConfig, onSubmit, onCancel, isRecall }) {
  const [newApp, setNewApp] = useState("");
  const fileRef = useRef();
  const update  = (k,v) => setEditMemo(p=>({...p,[k]:v}));
  const setNotify=(fn)=>setEditMemo(p=>({...p,notify:typeof fn==="function"?fn(p.notify||{}):fn}));
  const addApp  = () => {
    if (!newApp || (editMemo.workflow||[]).find(s=>s.approver===newApp) || newApp===curUser.id) return;
    setEditMemo(p=>({...p,workflow:[...(p.workflow||[]),{approver:newApp,status:"pending",comment:"",actionAt:null}]}));
    setNewApp("");
  };
  const remApp  = i  => setEditMemo(p=>({...p,workflow:p.workflow.filter((_,j)=>j!==i)}));
  const moveApp = (i,d) => {
    const wf=[...(editMemo.workflow||[])]; const t=i+d;
    if(t<0||t>=wf.length) return;
    [wf[i],wf[t]]=[wf[t],wf[i]];
    setEditMemo(p=>({...p,workflow:wf}));
  };
  const handleFile = ev => {
    const f=ev.target.files[0]; if(!f) return;
    const r=new FileReader();
    r.onload=e=>{
      const att={id:newAttId(),name:f.name,size:f.size>1024*1024?(f.size/1024/1024).toFixed(1)+" MB":Math.round(f.size/1024)+" KB",type:f.name.split(".").pop().toLowerCase(),data:e.target.result};
      setEditMemo(p=>({...p,attachments:[...(p.attachments||[]),att]}));
    };
    r.readAsDataURL(f); ev.target.value="";
  };
  const avail = users.filter(u=>u.id!==curUser.id&&u.active&&!(editMemo.workflow||[]).find(s=>s.approver===u.id));
  return (
    <div style={{ padding:24 }}>
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:20 }}>
        <button onClick={onCancel} style={{ background:"none", border:"none", cursor:"pointer", fontSize:20, color:"#9CA3AF", padding:0, lineHeight:1 }}>←</button>
        <div style={{ fontSize:18, fontWeight:600, color:"#111" }}>{editMemo.id?(isRecall?"แก้ไข Memo (เรียกคืน)":"แก้ไข Memo"):"สร้าง Memo ใหม่"}</div>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 320px", gap:16, alignItems:"start" }}>
        <div>
          <Section>
            <Field label="ชื่อเรื่อง *"><input value={editMemo.title||""} onChange={e=>update("title",e.target.value)} placeholder="กรอกชื่อเรื่อง..." style={IS}/></Field>
            <Field label="หมวดหมู่"><select value={editMemo.category||"ทั่วไป"} onChange={e=>update("category",e.target.value)} style={{...IS,width:"auto"}}>{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select></Field>
            <Field label="เนื้อหา"><textarea value={editMemo.content||""} onChange={e=>update("content",e.target.value)} rows={8} placeholder="กรอกเนื้อหา..." style={{...IS,resize:"vertical",lineHeight:1.7,fontFamily:"inherit"}}/></Field>
          </Section>
          <Section title="เอกสารแนบ" extra={<button onClick={()=>fileRef.current?.click()} style={BTN_GRAY}>+ แนบไฟล์</button>}>
            <input ref={fileRef} type="file" style={{display:"none"}} onChange={handleFile}/>
            {(editMemo.attachments||[]).map(a=>(
              <div key={a.id} style={ATT_ROW}>
                <span>📎</span><span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.name}</span>
                <span style={{color:"#9CA3AF"}}>{a.size}</span>
                <button onClick={()=>setEditMemo(p=>({...p,attachments:p.attachments.filter(x=>x.id!==a.id)}))} style={BTN_X}>✕</button>
              </div>
            ))}
            {!(editMemo.attachments||[]).length && <div style={{fontSize:12,color:"#9CA3AF",textAlign:"center",padding:"4px 0"}}>ยังไม่มีเอกสารแนบ</div>}
          </Section>
        </div>
        <div>
          <Section title="ขั้นตอนการอนุมัติ">
            <div style={{display:"flex",gap:6,marginBottom:10}}>
              <select value={newApp} onChange={e=>setNewApp(e.target.value)} style={{flex:1,padding:"6px 8px",border:"1px solid #E5E7EB",borderRadius:6,fontSize:12}}>
                <option value="">เลือกผู้อนุมัติ...</option>
                {avail.map(u=><option key={u.id} value={u.id}>{u.name} ({ROLE_CONFIG[u.role]?.label})</option>)}
              </select>
              <button onClick={addApp} style={BTN_GOLD}>เพิ่ม</button>
            </div>
            {!(editMemo.workflow||[]).length
              ? <div style={{fontSize:12,color:"#9CA3AF",textAlign:"center",padding:"10px 0",border:"1px dashed #E5E7EB",borderRadius:6}}>ยังไม่มีผู้อนุมัติ</div>
              : (editMemo.workflow||[]).map((step,i)=>{
                const u=users.find(x=>x.id===step.approver)||{};
                return (
                  <div key={i} style={{display:"flex",alignItems:"center",gap:6,padding:"7px 10px",background:"#F9FAFB",borderRadius:6,marginBottom:4,border:"1px solid #F3F4F6"}}>
                    <span style={{fontSize:11,color:"#9CA3AF",fontWeight:500,minWidth:16}}>{i+1}.</span>
                    <Avatar userId={step.approver} users={users} size={22}/>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:11,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:"#374151"}}>{u.name}</div>
                      <div style={{fontSize:10,color:"#9CA3AF"}}>{u.dept}</div>
                    </div>
                    <button onClick={()=>moveApp(i,-1)} disabled={i===0} style={{...BTN_X,opacity:i===0?.3:1}}>↑</button>
                    <button onClick={()=>moveApp(i,1)} disabled={i===(editMemo.workflow||[]).length-1} style={{...BTN_X,opacity:i===(editMemo.workflow||[]).length-1?.3:1}}>↓</button>
                    <button onClick={()=>remApp(i)} style={{...BTN_X,color:"#DC2626"}}>✕</button>
                  </div>
                );
              })}
          </Section>
          <NotifyPanel notify={editMemo.notify||{emailList:[],postToTeams:false,postToPowerAuto:false,postToLine:false}} setNotify={setNotify} users={users} notifyConfig={notifyConfig}/>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            <button onClick={()=>onSubmit(false)} style={{...BTN_GOLD,width:"100%",padding:"11px",fontSize:13}}>{isRecall?"ส่งกลับเพื่ออนุมัติ":"ส่งเพื่ออนุมัติ"}</button>
            <button onClick={()=>onSubmit(true)}  style={{padding:"11px",background:"#F9FAFB",color:"#6B7280",border:"1px solid #E5E7EB",borderRadius:6,fontSize:12,cursor:"pointer"}}>บันทึกร่าง</button>
            <button onClick={onCancel}             style={{padding:"11px",background:"none",color:"#9CA3AF",border:"none",borderRadius:6,fontSize:12,cursor:"pointer"}}>ยกเลิก</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailView({ memo, users, curUser, notifyConfig, pdfTemplate, onBack, onRecall, onEdit, onAddFile, onRemoveFile, setModal }) {
  const fileRef    = useRef();
  const isCreator  = memo.createdBy === curUser.id;
  const canApprove = memo.status==="pending" && memo.workflow?.[memo.currentStep]?.approver===curUser.id && can(curUser.role,"approve");
  const ALABEL     = {created:"สร้าง",submitted:"ส่งอนุมัติ",approved:"อนุมัติ",rejected:"ปฏิเสธ",recalled:"เรียกคืน",edited:"แก้ไข",resubmitted:"ส่งกลับ"};
  const ACOLOR     = {approved:"#065F46",rejected:"#991B1B",recalled:"#1E40AF",submitted:"#B45309"};
  const handleFile = e=>{const f=e.target.files[0];if(f)onAddFile(f);e.target.value="";};
  const notify     = memo.notify||{};
  const notifySummary = [
    ...(notifyConfig.email?.enabled&&notify.emailList?.length?[`✉ ${notify.emailList.length} อีเมล์`]:[]),
    ...(notifyConfig.teams?.enabled&&notify.postToTeams?["🔵 Teams"]:[]),
    ...(notifyConfig.powerauto?.enabled&&notify.postToPowerAuto?["🟣 SharePoint"]:[]),
    ...(notifyConfig.line?.enabled&&notify.postToLine?["🟢 LINE Group"]:[]),
  ];
  return (
    <div style={{padding:24}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:18}}>
        <button onClick={onBack} style={{background:"none",border:"none",cursor:"pointer",fontSize:20,color:"#9CA3AF",padding:0,lineHeight:1}}>←</button>
        <div style={{flex:1,fontSize:16,fontWeight:600,color:"#111",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{memo.title}</div>
        <StatusBadge status={memo.status}/>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 290px",gap:16,alignItems:"start"}}>
        <div>
          <Section>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12,paddingBottom:12,borderBottom:"1px solid #F3F4F6"}}>
              <Avatar userId={memo.createdBy} users={users} size={32}/>
              <div>
                <div style={{fontSize:13,fontWeight:500,color:"#111"}}>{(users.find(u=>u.id===memo.createdBy)||{}).name}</div>
                <div style={{fontSize:11,color:"#9CA3AF"}}>{fmtDate(memo.createdAt)} · {memo.category}</div>
              </div>
            </div>
            <div style={{fontSize:14,lineHeight:1.8,whiteSpace:"pre-wrap",color:"#374141"}}>{memo.content}</div>
          </Section>
          <Section title="เอกสารแนบ" extra={(isCreator||canApprove)&&<><button onClick={()=>fileRef.current?.click()} style={BTN_GRAY}>+ แนบไฟล์</button><input ref={fileRef} type="file" style={{display:"none"}} onChange={handleFile}/></>}>
            {!(memo.attachments||[]).length ? <div style={{fontSize:12,color:"#9CA3AF",textAlign:"center"}}>ไม่มีเอกสารแนบ</div>
            : (memo.attachments||[]).map(a=>(
              <div key={a.id} style={ATT_ROW}>
                <span>📎</span>
                {a.data ? <a href={a.data} download={a.name} style={{flex:1,fontSize:12,color:"#1D4ED8",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",textDecoration:"none"}}>{a.name}</a>
                         : <span style={{flex:1,fontSize:12,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.name}</span>}
                <span style={{fontSize:11,color:"#9CA3AF"}}>{a.size}</span>
                {isCreator && <button onClick={()=>onRemoveFile(a.id)} style={BTN_X}>✕</button>}
              </div>
            ))}
          </Section>
          <Section title="ประวัติการดำเนินงาน">
            {[...(memo.history||[])].reverse().map((h,i)=>{
              const u=users.find(x=>x.id===h.by)||{};
              return (
                <div key={i} style={{display:"flex",gap:10,padding:"7px 0",borderBottom:i<(memo.history||[]).length-1?"1px solid #F3F4F6":"none"}}>
                  <Avatar userId={h.by} users={users} size={24}/>
                  <div style={{flex:1}}>
                    <div style={{fontSize:12,display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                      <span style={{fontWeight:500,color:"#374151"}}>{u.name||"-"}</span>
                      <span style={{color:ACOLOR[h.action]||"#9CA3AF",fontWeight:500}}>{ALABEL[h.action]||h.action}</span>
                      <span style={{color:"#9CA3AF",marginLeft:"auto"}}>{fmtShort(h.at)}</span>
                    </div>
                    {h.comment && <div style={{fontSize:11,color:"#6B7280",marginTop:2}}>{h.comment}</div>}
                  </div>
                </div>
              );
            })}
          </Section>
        </div>
        <div>
          <Section title="ขั้นตอนการอนุมัติ">
            {(memo.workflow||[]).map((step,i)=>{
              const u      = users.find(x=>x.id===step.approver)||{};
              const active = i===memo.currentStep&&memo.status==="pending";
              const sc     = STATUS_COLOR[step.status]||STATUS_COLOR.draft;
              return (
                <div key={i} style={{padding:"8px 10px",background:active?"#FFFBEB":"#F9FAFB",border:`1px solid ${active?"#FCD34D":"#F3F4F6"}`,borderRadius:7,marginBottom:6}}>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <span style={{fontSize:10,color:"#9CA3AF",fontWeight:500,minWidth:20}}>ขั้น {i+1}</span>
                    <Avatar userId={step.approver} users={users} size={20}/>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:11,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:"#374151"}}>{u.name}</div>
                      <div style={{fontSize:10,color:"#9CA3AF"}}>{u.dept}</div>
                    </div>
                    <span style={{background:sc.bg,color:sc.text,border:`1px solid ${sc.border}`,borderRadius:4,padding:"1px 6px",fontSize:10,whiteSpace:"nowrap"}}>
                      {step.status==="pending"?(active?"กำลังรอ":"รอ"):STATUS_LABEL[step.status]}
                    </span>
                  </div>
                  {step.comment && <div style={{fontSize:11,color:"#6B7280",marginTop:5,paddingTop:5,borderTop:"1px solid #F3F4F6"}}>{step.comment}</div>}
                  {step.actionAt && <div style={{fontSize:10,color:"#9CA3AF",marginTop:2}}>{fmtShort(step.actionAt)}</div>}
                </div>
              );
            })}
          </Section>
          {notifySummary.length>0 && (
            <Section title="แจ้งเตือนเมื่ออนุมัติ">
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {notifySummary.map(s=><span key={s} style={{fontSize:11,background:"#F9FAFB",border:"1px solid #F3F4F6",borderRadius:5,padding:"3px 8px"}}>{s}</span>)}
              </div>
            </Section>
          )}
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {memo.status==="approved" && (
              <button onClick={()=>exportMemoPdf(memo,users,pdfTemplate||{})} style={{padding:11,background:"#EFF6FF",color:"#1E40AF",border:"1px solid #BFDBFE",borderRadius:6,fontSize:13,fontWeight:500,cursor:"pointer"}}>📄 Export PDF</button>
            )}
            {canApprove && (
              <>
                <button onClick={()=>setModal({type:"approve",memo})} style={{padding:11,background:GOLD,color:BLACK,border:"none",borderRadius:6,fontSize:13,fontWeight:600,cursor:"pointer"}}>✓ อนุมัติ</button>
                <button onClick={()=>setModal({type:"reject", memo})} style={{padding:11,background:"#FFF1F1",color:"#991B1B",border:"1px solid #FECACA",borderRadius:6,fontSize:13,cursor:"pointer"}}>✕ ปฏิเสธ</button>
              </>
            )}
            {isCreator && memo.status==="pending" && can(curUser.role,"recall") && (
              <button onClick={onRecall} style={{padding:11,background:"#EFF6FF",color:"#1E40AF",border:"1px solid #BFDBFE",borderRadius:6,fontSize:13,cursor:"pointer"}}>↩ เรียกคืน Memo</button>
            )}
            {isCreator && (memo.status==="draft"||memo.status==="recalled") && (
              <button onClick={onEdit} style={{padding:11,background:GOLD,color:BLACK,border:"none",borderRadius:6,fontSize:13,fontWeight:600,cursor:"pointer"}}>✎ แก้ไข Memo</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function UsersMgmt({ users, curUser, showToast }) {
  const [editing, setEditing] = useState(null);
  const [delConfirm, setDelConfirm] = useState(null);
  const [importPreview, setImportPreview] = useState(null);
  const xlsxRef = useRef();
  const blank = { name:"", email:"", dept:"", role:"user", active:true };

  const handleXlsxImport = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    e.target.value = "";
    try {
      const XLSX = await import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs");
      const buf  = await file.arrayBuffer();
      const wb   = XLSX.read(buf, { type:"array" });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval:"" });
      const parsed = rows.map(r => ({
        name:  String(r["ชื่อ-สกุล"] || r["name"] || r["Name"] || "").trim(),
        email: String(r["อีเมล์"] || r["email"] || r["Email"] || "").trim().toLowerCase(),
        dept:  String(r["แผนก"] || r["dept"] || r["Department"] || "").trim(),
        role:  ["superadmin","admin","user"].includes(String(r["สิทธิ์"]||r["role"]||"").toLowerCase()) ? String(r["สิทธิ์"]||r["role"]||"user").toLowerCase() : "user",
        active: true,
      })).filter(r => r.name && r.email && r.email.includes("@"));
      if (!parsed.length) { showToast("ไม่พบข้อมูลที่ถูกต้องใน Excel","error"); return; }
      setImportPreview(parsed);
    } catch (err) {
      showToast("อ่านไฟล์ไม่ได้: " + err.message, "error");
    }
  };

  const confirmImport = async () => {
    if (!importPreview) return;
    const existing = Object.fromEntries(users.map(u => [u.id, u]));
    let added = 0, updated = 0;
    importPreview.forEach(r => {
      const dup = users.find(u => u.email === r.email);
      if (dup) { existing[dup.id] = { ...dup, name:r.name, dept:r.dept, role:r.role }; updated++; }
      else      { const id = newUserId(); existing[id] = { ...r, id }; added++; }
    });
    await writeUsers(existing);
    showToast(`นำเข้าสำเร็จ: เพิ่ม ${added} คน, อัปเดต ${updated} คน`);
    setImportPreview(null);
  };
  const save = async () => {
    if (!editing.name.trim()||!editing.email.trim()) { showToast("กรุณากรอกชื่อและอีเมล์","error"); return; }
    if (!editing.email.includes("@")) { showToast("รูปแบบอีเมล์ไม่ถูกต้อง","error"); return; }
    if (!editing.id && users.find(u=>u.email===editing.email.trim())) { showToast("อีเมล์นี้มีในระบบแล้ว","error"); return; }
    const id      = editing.id || newUserId();
    const newUser = { ...editing, id, name:editing.name.trim(), email:editing.email.trim() };
    const newObj  = { ...Object.fromEntries(users.map(u=>[u.id,u])), [id]:newUser };
    await writeUsers(newObj);
    showToast(editing.id?"บันทึกแล้ว":"เพิ่ม User แล้ว");
    setEditing(null);
  };
  const toggle = async u => {
    if (u.id===curUser.id) { showToast("ไม่สามารถระงับตัวเองได้","error"); return; }
    await update(ref(db, `${DATA_PATH}/users/${u.id}`),{ active:!u.active });
    showToast(u.active?"ระงับ User แล้ว":"เปิดใช้งาน User แล้ว");
  };
  const del = async u => {
    const newObj = Object.fromEntries(users.filter(x=>x.id!==u.id).map(x=>[x.id,x]));
    await writeUsers(newObj);
    showToast("ลบ User แล้ว"); setDelConfirm(null);
  };
  const RDESC = {
    superadmin:"เข้าถึงได้ทุกส่วน รวมถึงจัดการ User และตั้งค่าระบบ",
    admin:"สร้าง อนุมัติ และดู Memo ทั้งหมด ไม่สามารถจัดการ User และตั้งค่าระบบ",
    user:"สร้าง Memo ของตัวเองและอนุมัติ Memo ที่ได้รับมอบหมาย",
  };
  return (
    <div style={{padding:24}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
        <div><div style={{fontSize:18,fontWeight:600,color:"#111"}}>จัดการ User</div><div style={{fontSize:12,color:"#9CA3AF",marginTop:2}}>{users.length} บัญชี</div></div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <input ref={xlsxRef} type="file" accept=".xlsx,.xls" style={{display:"none"}} onChange={handleXlsxImport}/>
          <button onClick={async()=>{
            const XLSX = await import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs");
            const ws = XLSX.utils.aoa_to_sheet([["ชื่อ-สกุล","อีเมล์","แผนก","สิทธิ์"],["สมชาย ใจดี","somchai@company.com","IT","user"]]);
            const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,"Users");
            XLSX.writeFile(wb,"user_template.xlsx");
          }} style={{...BTN_GRAY,padding:"6px 12px",fontSize:12}}>⬇ ดาวน์โหลด Template</button>
          <button onClick={()=>xlsxRef.current?.click()} style={{padding:"7px 14px",background:"#ECFDF5",color:"#065F46",border:"1px solid #A7F3D0",borderRadius:6,fontSize:12,fontWeight:600,cursor:"pointer"}}>📥 Import Excel</button>
          <button onClick={()=>setEditing(blank)} style={BTN_GOLD}>+ เพิ่ม User</button>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:16}}>
        {["superadmin","admin","user"].map(r=>{
          const c=ROLE_CONFIG[r]; const n=users.filter(u=>u.role===r&&u.active).length;
          return <div key={r} style={{background:c.bg,border:`1px solid ${c.border}`,borderRadius:8,padding:"10px 14px"}}><div style={{fontSize:11,color:c.text,fontWeight:600}}>{c.label}</div><div style={{fontSize:22,fontWeight:700,color:c.text,marginTop:2}}>{n}</div></div>;
        })}
      </div>
      <div style={{background:"#fff",border:"1px solid #F3F4F6",borderRadius:10,overflow:"hidden"}}>
        <div style={{display:"grid",gridTemplateColumns:"2fr 2fr 1fr 1fr 1fr auto",padding:"8px 16px",borderBottom:"1px solid #F3F4F6",background:"#F9FAFB"}}>
          {["ชื่อ","อีเมล์","แผนก","สิทธิ์","สถานะ",""].map((h,i)=><div key={i} style={{fontSize:11,fontWeight:600,color:"#9CA3AF"}}>{h}</div>)}
        </div>
        {users.map(u=>(
          <div key={u.id} style={{display:"grid",gridTemplateColumns:"2fr 2fr 1fr 1fr 1fr auto",padding:"10px 16px",borderBottom:"1px solid #F3F4F6",alignItems:"center",opacity:u.active?1:.45}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}><Avatar userId={u.id} users={users} size={26}/><span style={{fontSize:12,fontWeight:u.id===curUser.id?600:400,color:"#374151"}}>{u.name}{u.id===curUser.id&&<span style={{fontSize:10,color:GOLD,marginLeft:4}}>(คุณ)</span>}</span></div>
            <div style={{fontSize:12,color:"#6B7280",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.email}</div>
            <div style={{fontSize:12,color:"#374151"}}>{u.dept||"-"}</div>
            <div><RoleBadge role={u.role}/></div>
            <div><span style={{fontSize:11,fontWeight:500,color:u.active?"#065F46":"#991B1B",background:u.active?"#ECFDF5":"#FFF1F1",border:`1px solid ${u.active?"#A7F3D0":"#FECACA"}`,borderRadius:4,padding:"2px 7px"}}>{u.active?"ใช้งาน":"ระงับ"}</span></div>
            <div style={{display:"flex",gap:4}}>
              <button onClick={()=>setEditing({...u})} style={BTN_GRAY}>แก้ไข</button>
              <button onClick={()=>toggle(u)} style={{padding:"3px 7px",fontSize:11,borderRadius:5,background:u.active?"#FFFBEB":"#ECFDF5",color:u.active?"#B45309":"#065F46",border:`1px solid ${u.active?"#FCD34D":"#A7F3D0"}`,cursor:"pointer"}}>{u.active?"ระงับ":"เปิด"}</button>
              {u.id!==curUser.id && <button onClick={()=>setDelConfirm(u)} style={{...BTN_X,color:"#DC2626",padding:"3px 6px",border:"1px solid #FECACA",borderRadius:5,background:"#FFF1F1"}}>ลบ</button>}
            </div>
          </div>
        ))}
      </div>
      {editing && (
        <div style={{position:"fixed",inset:0,zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,.5)"}}>
          <div style={{background:"#fff",border:"1px solid #E5E7EB",borderRadius:12,padding:24,width:420,boxShadow:"0 20px 60px rgba(0,0,0,.2)"}}>
            <div style={{fontSize:15,fontWeight:600,marginBottom:16,color:"#111"}}>{editing.id?"แก้ไข User":"เพิ่ม User ใหม่"}</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
              <Field label="ชื่อ-สกุล *"><input value={editing.name} onChange={e=>setEditing(p=>({...p,name:e.target.value}))} style={IS}/></Field>
              <Field label="แผนก"><input value={editing.dept||""} onChange={e=>setEditing(p=>({...p,dept:e.target.value}))} style={IS}/></Field>
              <div style={{gridColumn:"1/-1"}}><Field label="อีเมล์ *"><input value={editing.email} onChange={e=>setEditing(p=>({...p,email:e.target.value}))} style={IS}/></Field></div>
              <Field label="สิทธิ์"><select value={editing.role} onChange={e=>setEditing(p=>({...p,role:e.target.value}))} style={IS}><option value="superadmin">Super Admin</option><option value="admin">Admin</option><option value="user">User</option></select></Field>
              <Field label="สถานะ"><select value={editing.active?"1":"0"} onChange={e=>setEditing(p=>({...p,active:e.target.value==="1"}))} style={IS}><option value="1">ใช้งาน</option><option value="0">ระงับ</option></select></Field>
            </div>
            <div style={{padding:"8px 12px",background:"#F9FAFB",borderRadius:6,fontSize:11,color:"#6B7280",marginBottom:14}}>{RDESC[editing.role]}</div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={save} style={{...BTN_GOLD,flex:1,padding:"10px"}}>บันทึก</button>
              <button onClick={()=>setEditing(null)} style={{flex:1,padding:"10px",background:"#F9FAFB",color:"#6B7280",border:"1px solid #E5E7EB",borderRadius:6,fontSize:12,cursor:"pointer"}}>ยกเลิก</button>
            </div>
          </div>
        </div>
      )}
      {delConfirm && (
        <div style={{position:"fixed",inset:0,zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,.5)"}}>
          <div style={{background:"#fff",border:"1px solid #E5E7EB",borderRadius:12,padding:24,width:340,boxShadow:"0 20px 60px rgba(0,0,0,.2)"}}>
            <div style={{fontSize:15,fontWeight:600,marginBottom:8,color:"#111"}}>ยืนยันการลบ User</div>
            <div style={{fontSize:13,color:"#6B7280",marginBottom:20}}>ต้องการลบ <strong>{delConfirm.name}</strong>? Memo ที่สร้างไว้จะยังคงอยู่</div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>del(delConfirm)} style={{flex:1,padding:"10px",background:"#DC2626",color:"#fff",border:"none",borderRadius:6,fontSize:13,fontWeight:600,cursor:"pointer"}}>ลบ</button>
              <button onClick={()=>setDelConfirm(null)} style={{flex:1,padding:"10px",background:"#F9FAFB",color:"#6B7280",border:"1px solid #E5E7EB",borderRadius:6,fontSize:13,cursor:"pointer"}}>ยกเลิก</button>
            </div>
          </div>
        </div>
      )}
      {importPreview && (
        <div style={{position:"fixed",inset:0,zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,.5)"}}>
          <div style={{background:"#fff",border:"1px solid #E5E7EB",borderRadius:12,padding:24,width:560,maxHeight:"80vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,.2)"}}>
            <div style={{fontSize:15,fontWeight:600,marginBottom:4,color:"#111"}}>📥 ตรวจสอบข้อมูลก่อน Import</div>
            <div style={{fontSize:12,color:"#9CA3AF",marginBottom:14}}>พบ {importPreview.length} รายการ — อีเมล์ที่มีอยู่แล้วจะถูกอัปเดต</div>
            <div style={{background:"#F9FAFB",borderRadius:8,overflow:"hidden",border:"1px solid #F3F4F6",marginBottom:16}}>
              <div style={{display:"grid",gridTemplateColumns:"2fr 2fr 1fr 1fr",padding:"7px 12px",borderBottom:"1px solid #F3F4F6",background:"#F3F4F6"}}>
                {["ชื่อ-สกุล","อีเมล์","แผนก","สิทธิ์"].map(h=><div key={h} style={{fontSize:10,fontWeight:700,color:"#6B7280"}}>{h}</div>)}
              </div>
              {importPreview.map((r,i)=>{
                const isDup = !!users.find(u=>u.email===r.email);
                return (
                  <div key={i} style={{display:"grid",gridTemplateColumns:"2fr 2fr 1fr 1fr",padding:"7px 12px",borderBottom:"1px solid #F3F4F6",background:isDup?"#FFFBEB":"#fff"}}>
                    <div style={{fontSize:12,color:"#374151"}}>{r.name} {isDup&&<span style={{fontSize:10,color:"#B45309"}}>(อัปเดต)</span>}</div>
                    <div style={{fontSize:11,color:"#6B7280",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.email}</div>
                    <div style={{fontSize:12,color:"#374151"}}>{r.dept||"-"}</div>
                    <div><RoleBadge role={r.role}/></div>
                  </div>
                );
              })}
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={confirmImport} style={{...BTN_GOLD,flex:1,padding:"10px"}}>✓ ยืนยัน Import</button>
              <button onClick={()=>setImportPreview(null)} style={{flex:1,padding:"10px",background:"#F9FAFB",color:"#6B7280",border:"1px solid #E5E7EB",borderRadius:6,fontSize:12,cursor:"pointer"}}>ยกเลิก</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsView({ notifyConfig, showToast, onOpenPdfTemplate }) {
  const [cfg, setCfg] = useState(JSON.parse(JSON.stringify(notifyConfig)));
  const setC = (ch,k,v) => setCfg(p=>({...p,[ch]:{...p[ch],[k]:v}}));
  const save = async () => { await writeNotifyConfig(cfg); showToast("บันทึกการตั้งค่าแล้ว"); };
  const channels = [
    { id:"email",    icon:"✉",  label:"อีเมล์ (EmailJS)",            color:"#1E40AF",
      fields:[{k:"serviceId",label:"Service ID",ph:"service_xxxxxxx"},{k:"templateId",label:"Template ID",ph:"template_xxxxxxx"},{k:"publicKey",label:"Public Key",ph:"your_public_key"}],
      guide:["สมัครที่ emailjs.com (ฟรี 200/เดือน)","สร้าง Email Service → Gmail/Outlook","สร้าง Template ใช้ตัวแปร {{memo_title}} {{creator_name}} {{to_email}}","คัดลอก Service ID / Template ID / Public Key"] },
    { id:"teams",    icon:"🔵", label:"Microsoft Teams",              color:"#464EB8",
      fields:[{k:"webhookUrl",label:"Webhook URL",ph:"https://your-org.webhook.office.com/..."}],
      guide:["Teams → Channel → ⋯ → Connectors → Incoming Webhook","ตั้งชื่อ E-Memo Notification → Create","Copy URL"] },
    { id:"powerauto",icon:"🟣", label:"SharePoint / Power Automate",  color:"#742774",
      fields:[{k:"webhookUrl",label:"HTTP Trigger URL",ph:"https://prod-xx.logic.azure.com/..."}],
      guide:["Power Automate → Create → Automated Cloud Flow","Trigger: When an HTTP request is received","Action: SharePoint Create news / Outlook Send email","Copy HTTP POST URL"] },
    { id:"line",     icon:"🟢", label:"LINE Messaging API (Group)",    color:"#06C755",
      fields:[{k:"channelAccessToken",label:"Channel Access Token",ph:"eyJ..."},{k:"groupId",label:"Group ID",ph:"C1234567890..."}],
      guide:["สมัคร LINE Official Account ที่ manager.line.biz","developers.line.biz → Messaging API → Copy Token","เพิ่ม Bot เข้า LINE Group ที่ต้องการ","บันทึก Group ID จาก webhook event"] },
  ];
  return (
    <div style={{padding:24}}>
      <div style={{fontSize:18,fontWeight:600,color:"#111",marginBottom:4}}>ตั้งค่าการแจ้งเตือน</div>
      <div style={{fontSize:13,color:"#6B7280",marginBottom:20}}>เปิดใช้งานช่องทางที่ต้องการ — ส่งอัตโนมัติเมื่อ Memo อนุมัติครบทุกขั้น</div>
      <div style={{background:"#EEEDFE",border:"1px solid #AFA9EC",borderRadius:10,padding:"12px 16px",marginBottom:16,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div>
          <div style={{fontSize:13,fontWeight:600,color:"#3C3489"}}>🎨 Template PDF</div>
          <div style={{fontSize:11,color:"#6B7280",marginTop:1}}>กำหนดรูปแบบ PDF ที่ Export จาก Memo ที่อนุมัติแล้ว</div>
        </div>
        <button onClick={onOpenPdfTemplate} style={{padding:"7px 16px",background:"#3C3489",color:"#fff",border:"none",borderRadius:6,fontSize:12,fontWeight:600,cursor:"pointer"}}>ตั้งค่า Template</button>
      </div>
      {channels.map(ch=>(
        <div key={ch.id} style={{background:"#fff",border:`1px solid ${cfg[ch.id]?.enabled?"#E5E7EB":"#F3F4F6"}`,borderRadius:10,marginBottom:12,overflow:"hidden"}}>
          <div style={{display:"flex",alignItems:"center",gap:12,padding:"14px 16px",cursor:"pointer",background:cfg[ch.id]?.enabled?"#F9FAFB":"transparent"}} onClick={()=>setC(ch.id,"enabled",!cfg[ch.id]?.enabled)}>
            <span style={{fontSize:20}}>{ch.icon}</span>
            <div style={{flex:1}}>
              <div style={{fontSize:13,fontWeight:500,color:"#111"}}>{ch.label}</div>
              <div style={{fontSize:11,color:"#9CA3AF"}}>{cfg[ch.id]?.enabled?"เปิดใช้งาน — กรอกข้อมูลด้านล่าง":"คลิกเพื่อเปิดใช้งาน"}</div>
            </div>
            <Toggle value={cfg[ch.id]?.enabled||false} onChange={v=>setC(ch.id,"enabled",v)}/>
          </div>
          {cfg[ch.id]?.enabled && (
            <div style={{padding:"14px 16px",borderTop:"1px solid #F3F4F6"}}>
              <div style={{padding:"10px 12px",background:ch.color+"11",border:`1px solid ${ch.color}33`,borderRadius:6,marginBottom:12}}>
                <div style={{fontSize:11,fontWeight:600,color:ch.color,marginBottom:4}}>วิธีตั้งค่า</div>
                {ch.guide.map((g,i)=><div key={i} style={{fontSize:11,color:"#6B7280",padding:"1px 0"}}>{i+1}. {g}</div>)}
              </div>
              <div style={{display:"grid",gridTemplateColumns:ch.fields.length>1?"1fr 1fr":"1fr",gap:8}}>
                {ch.fields.map(f=><Field key={f.k} label={f.label}><input value={cfg[ch.id][f.k]||""} onChange={e=>setC(ch.id,f.k,e.target.value)} placeholder={f.ph} style={IS}/></Field>)}
              </div>
            </div>
          )}
        </div>
      ))}
      <button onClick={save} style={BTN_GOLD}>บันทึกการตั้งค่า</button>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function EMemo() {
  const [authUser,  setAuthUser]  = useState(undefined);   // undefined = loading
  const [data,      setData]      = useState(null);
  const [view,      setView]      = useState("dashboard");
  const [selId,     setSelId]     = useState(null);
  const [editMemo,  setEditMemo]  = useState(null);
  const [modal,     setModal]     = useState(null);
  const [toast,     setToast]     = useState(null);
  const [syncing,   setSyncing]   = useState(false);
  const [showPdfEditor, setShowPdfEditor] = useState(false);

  // ── Auth listener (from uploaded file) ───────────────────────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => setAuthUser(u||null));
    return () => unsub();
  }, []);

  // ── Firebase data listener (from uploaded file) ───────────────────────────
  useEffect(() => {
    if (!authUser) return;
    const unsub = onValue(ref(db, DATA_PATH), snap => {
      setData(snap.val() || { users:{}, memos:{}, notifyConfig:{} });
    });
    return () => unsub();
  }, [authUser]);

  const showToast = (msg, type="success") => { setToast({msg,type}); setTimeout(()=>setToast(null),3200); };

  // ── Loading guards (from uploaded file) ──────────────────────────────────
  if (authUser === undefined) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:BLACK,fontFamily:"'Noto Sans Thai','Sarabun',sans-serif"}}>
      <div style={{textAlign:"center"}}>
        <div style={{width:40,height:40,background:GOLD,borderRadius:10,margin:"0 auto 12px",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,color:BLACK,fontWeight:700}}>E</div>
        <div style={{color:"#666",fontSize:13}}>กำลังโหลด...</div>
      </div>
    </div>
  );
  if (!authUser) return <Login />;
  if (!data) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"#F9FAFB",fontSize:13,color:"#6B7280",fontFamily:"'Noto Sans Thai','Sarabun',sans-serif"}}>
      กำลังโหลดข้อมูล...
    </div>
  );

  // ── Derive state from Firebase object structure (from uploaded file) ──────
  const users    = Object.values(data.users    || {});
  const memoList = Object.values(data.memos    || {});
  const notifyConfig = data.notifyConfig || { email:{}, teams:{}, powerauto:{}, line:{} };
  const pdfTemplate  = data.pdfTemplate  || {};

  // curUser: match Firebase auth email to user in DB (from uploaded file)
  const curUser = users.find(u => u.email === authUser.email) || {
    id: authUser.uid, name: authUser.displayName || authUser.email,
    role: "user", dept: "-", email: authUser.email, active: true,
  };

  const inbox   = memoList.filter(m => m.status==="pending" && m.workflow?.[m.currentStep]?.approver===curUser.id);
  const myMemos = memoList.filter(m => m.createdBy === curUser.id);
  const selMemo = memoList.find(m => m.id === selId);

  const openMemo     = id   => { setSelId(id); setView("detail"); };
  const startCreate  = ()   => { setEditMemo({title:"",content:"",category:"ทั่วไป",workflow:[],notify:{emailList:[],postToTeams:false,postToPowerAuto:false,postToLine:false},attachments:[]}); setView("create"); };
  const startEdit    = memo => { setEditMemo({...memo,workflow:(memo.workflow||[]).map(s=>({...s})),attachments:[...(memo.attachments||[])],notify:{...memo.notify,emailList:[...(memo.notify?.emailList||[])]}}); setView("create"); };

  // ── Memo submit (uses push() for new — from uploaded file) ────────────────
  const submitMemo = async (isDraft) => {
    if (!editMemo.title?.trim()) { showToast("กรุณากรอกชื่อเรื่อง","error"); return; }
    if (!isDraft && !(editMemo.workflow||[]).length) { showToast("กรุณาเพิ่มผู้อนุมัติอย่างน้อย 1 คน","error"); return; }
    setSyncing(true);
    const now    = new Date().toISOString();
    const isNew  = !editMemo.id;
    const old    = isNew ? null : memoList.find(m=>m.id===editMemo.id);
    const payload = {
      ...editMemo,
      createdBy:  old?.createdBy || curUser.id,
      createdAt:  old?.createdAt || now,
      updatedAt:  now,
      status:     isDraft ? "draft" : "pending",
      currentStep: 0,
      workflow: (editMemo.workflow||[]).map(s=>({...s, status:isDraft?s.status:"pending", comment:"", actionAt:null})),
      history: [
        ...(old?.history||[]),
        ...(!old ? [{action:"created",by:curUser.id,at:now,comment:""}] : []),
        ...(isDraft ? [{action:"edited",by:curUser.id,at:now,comment:""}]
                    : [{action:old?"resubmitted":"submitted",by:curUser.id,at:now,comment:"ส่งเพื่อขออนุมัติ"}]),
      ],
    };
    try { await writeMemo(payload, isNew); } finally { setSyncing(false); }
    setEditMemo(null);
    showToast(isDraft ? "บันทึกร่างแล้ว" : "ส่ง Memo เพื่ออนุมัติแล้ว");
    setView("myMemos");
  };

  const recallMemo = async memo => {
    const now = new Date().toISOString();
    await patchMemo(memo.id, { status:"recalled", history:[...(memo.history||[]),{action:"recalled",by:curUser.id,at:now,comment:"เรียกคืน Memo"}] });
    showToast("เรียกคืน Memo แล้ว");
  };

  // ── Approve / Reject (uses update() from uploaded file) ───────────────────
  const approveMemo = async (memo, comment) => {
    const now  = new Date().toISOString();
    const i    = memo.currentStep;
    const nwf  = (memo.workflow||[]).map((s,j)=>j===i?{...s,status:"approved",comment,actionAt:now}:s);
    const next = i+1; const done = next >= (memo.workflow||[]).length;
    const patch = { workflow:nwf, currentStep:done?i:next, status:done?"approved":"pending",
      history:[...(memo.history||[]),{action:"approved",by:curUser.id,at:now,comment}] };
    await patchMemo(memo.id, patch);
    setModal(null);
    setSelId(memo.id);
    showToast(done?"✅ อนุมัติครบทุกขั้น กำลังส่งแจ้งเตือน...":"อนุมัติขั้นนี้แล้ว ส่งต่อขั้นถัดไป");
    if (done) { await sendNotifications(notifyConfig,{...memo,...patch},users); showToast("ส่งแจ้งเตือนเรียบร้อย"); }
  };

  const rejectMemo = async (memo, comment) => {
    const now = new Date().toISOString();
    const i   = memo.currentStep;
    const nwf = (memo.workflow||[]).map((s,j)=>j===i?{...s,status:"rejected",comment,actionAt:now}:s);
    await patchMemo(memo.id, { workflow:nwf, status:"rejected", history:[...(memo.history||[]),{action:"rejected",by:curUser.id,at:now,comment}] });
    setModal(null);
    showToast("ปฏิเสธ Memo แล้ว","error");
  };

  const addAtt = (memo, file) => {
    const r = new FileReader();
    r.onload = async e => {
      const att={id:newAttId(),name:file.name,size:file.size>1024*1024?(file.size/1024/1024).toFixed(1)+" MB":Math.round(file.size/1024)+" KB",type:file.name.split(".").pop().toLowerCase(),data:e.target.result};
      await patchMemo(memo.id,{attachments:[...(memo.attachments||[]),att]});
      showToast("แนบไฟล์แล้ว");
    };
    r.readAsDataURL(file);
  };
  const remAtt = async (memo, id) => patchMemo(memo.id,{attachments:(memo.attachments||[]).filter(a=>a.id!==id)});

  const NAV = [
    { k:"dashboard", l:"ภาพรวม",      i:"⊞", roles:["superadmin","admin","user"] },
    { k:"inbox",     l:"กล่องขาเข้า", i:"↓", badge:inbox.length||null, roles:["superadmin","admin","user"] },
    { k:"myMemos",   l:"Memo ของฉัน", i:"◉", roles:["superadmin","admin","user"] },
    { k:"all",       l:"ทั้งหมด",     i:"≡", roles:["superadmin","admin"] },
    { k:"search",    l:"ค้นหา",       i:"⌕", roles:["superadmin","admin","user"] },
    { k:"users",     l:"จัดการ User", i:"◎", roles:["superadmin"] },
    { k:"settings",  l:"ตั้งค่าระบบ",i:"⚙", roles:["superadmin"] },
  ];

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily:"'Noto Sans Thai','Sarabun',sans-serif", display:"flex", height:"100vh", overflow:"hidden" }}>
      <Toast t={toast}/>
      {syncing && <div style={{position:"fixed",bottom:16,left:216,background:"#FFFBEB",color:"#B45309",border:"1px solid #FCD34D",borderRadius:6,padding:"4px 10px",fontSize:11,zIndex:100}}>⟳ กำลังบันทึก...</div>}
      {modal && <ActionModal modal={modal} onClose={()=>setModal(null)} onApprove={c=>approveMemo(modal.memo,c)} onReject={c=>rejectMemo(modal.memo,c)}/>}
      {showPdfEditor && can(curUser.role,"settings") && (
        <PdfTemplateEditor
          template={pdfTemplate}
          onSave={async(t)=>{ await writePdfTemplate(t); showToast("บันทึก Template PDF แล้ว"); setShowPdfEditor(false); }}
          onClose={()=>setShowPdfEditor(false)}
        />
      )}

      {/* ── Sidebar (black theme from uploaded file) ── */}
      <div style={{ width:210, background:BLACK, color:"#fff", display:"flex", flexDirection:"column", flexShrink:0 }}>
        {/* Logo */}
        <div style={{ padding:"16px 16px 12px", borderBottom:"1px solid #222" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <div style={{ width:28, height:28, background:GOLD, borderRadius:6, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, color:BLACK, fontWeight:700, flexShrink:0 }}>E</div>
            <div>
              <div style={{ fontSize:12, fontWeight:600, color:GOLD, letterSpacing:.3 }}>E-Memo System</div>
              <div style={{ fontSize:9, color:"#555", lineHeight:1.3, marginTop:1 }}>ไทยซอสเซส มาร์เก็ตติ้ง</div>
            </div>
          </div>
        </div>

        {/* Create button (gold from uploaded file) */}
        <div style={{ padding:"10px 10px 6px" }}>
          <button onClick={startCreate} style={{ ...BTN_GOLD, width:"100%", padding:"9px", fontSize:12, borderRadius:6 }}>
            + สร้าง Memo ใหม่
          </button>
        </div>

        {/* Nav */}
        <nav style={{ flex:1, padding:"4px 8px", overflowY:"auto" }}>
          {NAV.filter(n=>n.roles.includes(curUser.role)).map(n=>(
            <button key={n.k} onClick={()=>setView(n.k)} style={{ width:"100%", padding:"8px 10px", borderRadius:6, background:view===n.k?"#1e1e1e":"transparent", color:view===n.k?GOLD:"#888", border:"none", fontSize:12, cursor:"pointer", display:"flex", alignItems:"center", gap:8, marginBottom:1, textAlign:"left", transition:"color .15s" }}>
              <span style={{ fontSize:13, width:16, textAlign:"center" }}>{n.i}</span>
              <span style={{ flex:1 }}>{n.l}</span>
              {n.badge ? <span style={{ background:"#DC2626", color:"#fff", borderRadius:10, fontSize:10, padding:"1px 5px", fontWeight:600 }}>{n.badge}</span> : null}
            </button>
          ))}
        </nav>

        {/* User info + logout (from uploaded file) */}
        <div style={{ borderTop:"1px solid #222", padding:"10px 12px" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
            <Avatar userId={curUser.id} users={users.length?users:[curUser]} size={26}/>
            <div style={{ minWidth:0 }}>
              <div style={{ fontSize:11, fontWeight:500, color:"#ddd", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{curUser.name}</div>
              <div style={{ fontSize:10, color:"#555" }}><RoleBadge role={curUser.role}/></div>
            </div>
          </div>
          {/* Logout button (from uploaded file) */}
          <button onClick={()=>signOut(auth)} style={{ width:"100%", padding:"7px", background:"#1a1a1a", color:"#666", border:"1px solid #2a2a2a", borderRadius:6, fontSize:11, cursor:"pointer", fontFamily:"inherit" }}>
            ออกจากระบบ
          </button>
        </div>
      </div>

      {/* ── Main content (light background) ── */}
      <div style={{ flex:1, overflowY:"auto", background:"#F9FAFB" }}>
        {view==="dashboard" && <Dashboard  memoList={memoList} users={users} curUser={curUser} inboxCount={inbox.length} onOpen={openMemo}/>}
        {view==="inbox"     && <MemoListView memoList={inbox}   users={users} title="กล่องขาเข้า" subtitle={`${inbox.length} รายการรอการอนุมัติ`} curUser={curUser} onOpen={openMemo} highlight/>}
        {view==="myMemos"   && <MemoListView memoList={myMemos} users={users} title="Memo ของฉัน" curUser={curUser} onOpen={openMemo} onRecall={recallMemo} onEdit={startEdit}/>}
        {view==="all"       && can(curUser.role,"viewAll") && <MemoListView memoList={memoList} users={users} title="Memo ทั้งหมด" curUser={curUser} onOpen={openMemo}/>}
        {view==="search"    && <SearchView memoList={curUser.role==="user"?memoList.filter(m=>m.createdBy===curUser.id||m.workflow?.find(s=>s.approver===curUser.id)):memoList} users={users} curUser={curUser} onOpen={openMemo}/>}
        {view==="users"     && can(curUser.role,"manageUsers") && <UsersMgmt users={users} curUser={curUser} showToast={showToast}/>}
        {view==="settings"  && can(curUser.role,"settings") && <SettingsView notifyConfig={notifyConfig} showToast={showToast} onOpenPdfTemplate={()=>setShowPdfEditor(true)}/>}
        {view==="create"    && editMemo && <CreateView editMemo={editMemo} setEditMemo={setEditMemo} users={users} curUser={curUser} notifyConfig={notifyConfig} onSubmit={submitMemo} onCancel={()=>{setEditMemo(null);setView("myMemos");}} isRecall={!!editMemo.id&&editMemo.status==="recalled"}/>}
        {view==="detail"    && selMemo  && <DetailView memo={selMemo} users={users} curUser={curUser} notifyConfig={notifyConfig} pdfTemplate={pdfTemplate} onBack={()=>setView("myMemos")} onRecall={()=>recallMemo(selMemo)} onEdit={()=>startEdit(selMemo)} onAddFile={f=>addAtt(selMemo,f)} onRemoveFile={id=>remAtt(selMemo,id)} setModal={setModal}/>}
      </div>
    </div>
  );
}
