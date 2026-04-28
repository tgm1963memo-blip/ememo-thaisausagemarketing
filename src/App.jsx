import { useState, useEffect, useRef } from "react";
import { ref, onValue, set } from "firebase/database";
import { db, DATA_PATH } from "./firebase.js";

// ── Constants ─────────────────────────────────────────────────────────────────
const COMPANY      = "บริษัท ไทยซอสเซส มาร์เก็ตติ้ง จำกัด";
const COMPANY_SHORT= "Thai Sauces Marketing";
const CATEGORIES   = ["ทั่วไป","งบประมาณ","จัดซื้อจัดจ้าง","รายงาน","นโยบาย","HR","IT","อื่นๆ"];
const STATUS_LABEL = { draft:"ร่าง", pending:"รออนุมัติ", approved:"อนุมัติแล้ว", rejected:"ปฏิเสธ", recalled:"เรียกคืนแล้ว" };
const STATUS_COLOR = {
  draft:    { bg:"#f1efe8", text:"#5f5e5a", border:"#d3d1c7" },
  pending:  { bg:"#faeeda", text:"#854f0b", border:"#fac775" },
  approved: { bg:"#eaf3de", text:"#3b6d11", border:"#c0dd97" },
  rejected: { bg:"#fcebeb", text:"#a32d2d", border:"#f7c1c1" },
  recalled: { bg:"#e6f1fb", text:"#185fa5", border:"#b5d4f4" },
};
const ROLE_CONFIG = {
  superadmin: { label:"Super Admin", bg:"#EEEDFE", text:"#3C3489", border:"#AFA9EC" },
  admin:      { label:"Admin",       bg:"#faeeda", text:"#854f0b", border:"#fac775" },
  user:       { label:"User",        bg:"#f1efe8", text:"#5f5e5a", border:"#d3d1c7" },
};
const PALETTES = [
  {bg:"#e6f1fb",text:"#185fa5"},{bg:"#eaf3de",text:"#3b6d11"},{bg:"#faeeda",text:"#854f0b"},
  {bg:"#fbeaf0",text:"#993556"},{bg:"#e1f5ee",text:"#0f6e56"},{bg:"#EEEDFE",text:"#3C3489"},
  {bg:"#FAECE7",text:"#993C1D"},{bg:"#EAF3DE",text:"#27500A"},
];

// ── Seed data ─────────────────────────────────────────────────────────────────
const SEED = {
  currentUser: "u1",
  notifyConfig: {
    email:     { enabled:false, serviceId:"", templateId:"", publicKey:"" },
    teams:     { enabled:false, webhookUrl:"" },
    powerauto: { enabled:false, webhookUrl:"" },
    line:      { enabled:false, channelAccessToken:"", groupId:"" },
  },
  users: [
    { id:"u1", name:"บูม สมใจ",        email:"boom@thaisauces.co.th",    role:"superadmin", dept:"Consulting", active:true },
    { id:"u2", name:"สมชาย วงศ์ใหญ่",  email:"somchai@thaisauces.co.th", role:"admin",      dept:"Management", active:true },
    { id:"u3", name:"สุมาลี รักดี",    email:"sumalee@thaisauces.co.th", role:"admin",      dept:"Finance",    active:true },
    { id:"u4", name:"วิชัย แสงทอง",    email:"vichai@thaisauces.co.th",  role:"user",       dept:"Operations", active:true },
    { id:"u5", name:"อภิชาติ พงศ์ไพร", email:"ceo@thaisauces.co.th",     role:"superadmin", dept:"Executive",  active:true },
  ],
  memos: [
    { id:"m001", title:"ขออนุมัติงบประมาณจัดซื้อครุภัณฑ์สำนักงาน Q2/2026",
      content:"เรียน ผู้บริหาร\n\nขอเสนอขออนุมัติงบประมาณจัดซื้อครุภัณฑ์สำนักงาน ประจำไตรมาส Q2/2026 รวม 285,000 บาท\n1. คอมพิวเตอร์โน้ตบุ๊ก 5 เครื่อง 150,000 บาท\n2. เครื่องพิมพ์ 2 เครื่อง 85,000 บาท\n3. อุปกรณ์อื่นๆ 50,000 บาท",
      category:"งบประมาณ", createdBy:"u1", createdAt:"2026-04-20T09:00:00", status:"pending", currentStep:0,
      workflow:[{approver:"u3",status:"pending",comment:"",actionAt:null},{approver:"u2",status:"pending",comment:"",actionAt:null}],
      notify:{ emailList:["boom@thaisauces.co.th"], postToTeams:false, postToPowerAuto:false, postToLine:true },
      attachments:[{ id:"a1",name:"รายละเอียดการจัดซื้อ.pdf",size:"245 KB",type:"pdf",data:null }],
      history:[{action:"created",by:"u1",at:"2026-04-20T09:00:00",comment:""},{action:"submitted",by:"u1",at:"2026-04-20T09:05:00",comment:"ส่งเพื่อขออนุมัติ"}] },
  ],
};

// ── Firebase data layer ───────────────────────────────────────────────────────
// saveData: เขียน state ทั้งก้อนลง Firebase Realtime Database
const saveData = (data) => {
  // Firebase ไม่รับ undefined — แปลง nullish ก่อน
  const clean = JSON.parse(JSON.stringify(data));
  return set(ref(db, DATA_PATH), clean);
};

// ── Notification senders ──────────────────────────────────────────────────────
async function sendNotifications(cfg, memo, users) {
  const creator     = users.find(u => u.id === memo.createdBy) || {};
  const approvedDate= new Date().toLocaleDateString("th-TH", { day:"2-digit", month:"long", year:"numeric" });
  const summary     = memo.content.slice(0, 200);

  // 1) EmailJS
  if (cfg.email.enabled && cfg.email.serviceId && memo.notify?.emailList?.length) {
    for (const toEmail of memo.notify.emailList) {
      try {
        await fetch("https://api.emailjs.com/api/v1.0/email/send", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ service_id:cfg.email.serviceId, template_id:cfg.email.templateId,
            user_id:cfg.email.publicKey,
            template_params:{ to_email:toEmail, memo_title:memo.title, creator_name:creator.name,
              approved_date:approvedDate, category:memo.category, memo_summary:summary, company:COMPANY } }),
        });
      } catch {}
    }
  }

  // 2) Microsoft Teams
  if (cfg.teams.enabled && cfg.teams.webhookUrl && memo.notify?.postToTeams) {
    try {
      await fetch(cfg.teams.webhookUrl, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          "@type": "MessageCard", themeColor: "3b6d11",
          summary: `✅ อนุมัติ Memo: ${memo.title}`,
          sections: [{ activityTitle:`✅ Memo ได้รับการอนุมัติครบแล้ว`, activitySubtitle:COMPANY,
            facts:[
              { name:"📋 เรื่อง",  value:memo.title },
              { name:"👤 ผู้สร้าง",value:creator.name || "-" },
              { name:"📁 หมวด",   value:memo.category },
              { name:"📅 วันที่", value:approvedDate },
            ], markdown:true }],
        }),
      });
    } catch {}
  }

  // 3) Power Automate (→ SharePoint / Outlook)
  if (cfg.powerauto.enabled && cfg.powerauto.webhookUrl && memo.notify?.postToPowerAuto) {
    try {
      await fetch(cfg.powerauto.webhookUrl, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memo_id:memo.id, memo_title:memo.title, creator_name:creator.name,
          creator_email:creator.email, category:memo.category, approved_date:approvedDate,
          summary, company:COMPANY, status:"approved" }),
      });
    } catch {}
  }

  // 4) LINE Messaging API — ผ่าน Vercel serverless /api/line-push (แก้ CORS)
  if (cfg.line.enabled && cfg.line.channelAccessToken && cfg.line.groupId && memo.notify?.postToLine) {
    try {
      const msg = [
        `✅ [${COMPANY_SHORT}] Memo อนุมัติครบแล้ว`,
        `📋 ${memo.title}`,
        `👤 โดย: ${creator.name || "-"}`,
        `📁 หมวด: ${memo.category}`,
        `📅 ${approvedDate}`,
        summary ? `\n📝 ${summary.slice(0, 100)}${summary.length > 100 ? "..." : ""}` : "",
      ].filter(Boolean).join("\n");

      await fetch("/api/line-push", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: cfg.line.groupId,
          message: msg,
          channelAccessToken: cfg.line.channelAccessToken,
        }),
      });
    } catch {}
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const uid  = () => "u" + Date.now() + Math.random().toString(36).slice(2, 5);
const mid  = () => "m" + Date.now();
const aid  = () => "a" + Date.now() + Math.random().toString(36).slice(2, 5);
const fmtDate  = (s) => !s ? "-" : new Date(s).toLocaleDateString("th-TH", {day:"2-digit",month:"short",year:"numeric"}) + " " + new Date(s).toLocaleTimeString("th-TH", {hour:"2-digit",minute:"2-digit"});
const fmtShort = (s) => !s ? "-" : new Date(s).toLocaleDateString("th-TH", {day:"2-digit",month:"short",year:"2-digit"});
const getInitials = (name = "") => { const p = name.trim().split(" "); return p.length >= 2 ? p[0][0] + p[1][0] : name.slice(0, 2); };
const can = (role, action) => {
  if (role === "superadmin") return true;
  if (role === "admin") return !["manageUsers","settings"].includes(action);
  return ["createMemo","viewOwn"].includes(action);
};

// ── UI primitives ─────────────────────────────────────────────────────────────
function Avatar({ userId, users, size = 28 }) {
  const u   = users.find(x => x.id === userId) || {};
  const idx = users.findIndex(x => x.id === userId);
  const c   = PALETTES[(idx < 0 ? 0 : idx) % PALETTES.length];
  return <div style={{ width:size, height:size, borderRadius:"50%", background:c.bg, color:c.text, display:"flex", alignItems:"center", justifyContent:"center", fontSize:size*.36, fontWeight:500, flexShrink:0 }}>{getInitials(u.name || "?")}</div>;
}
function RoleBadge({ role }) { const c = ROLE_CONFIG[role] || ROLE_CONFIG.user; return <span style={{ background:c.bg, color:c.text, border:`1px solid ${c.border}`, borderRadius:4, padding:"2px 7px", fontSize:11, fontWeight:500, whiteSpace:"nowrap" }}>{c.label}</span>; }
function StatusBadge({ status }) { const c = STATUS_COLOR[status] || STATUS_COLOR.draft; return <span style={{ background:c.bg, color:c.text, border:`1px solid ${c.border}`, borderRadius:4, padding:"2px 7px", fontSize:11, fontWeight:500, whiteSpace:"nowrap" }}>{STATUS_LABEL[status] || status}</span>; }
function Toast({ t }) { if (!t) return null; const ok = t.type !== "error"; return <div style={{ position:"fixed", top:20, right:20, zIndex:200, padding:"10px 16px", borderRadius:8, background:ok?"#eaf3de":"#fcebeb", color:ok?"#3b6d11":"#a32d2d", border:`1px solid ${ok?"#c0dd97":"#f7c1c1"}`, fontSize:13, fontWeight:500, boxShadow:"0 2px 12px rgba(0,0,0,.12)" }}>{t.msg}</div>; }
function Empty({ msg }) { return <div style={{ textAlign:"center", padding:"40px 0", color:"var(--color-text-secondary)", fontSize:13 }}><div style={{ fontSize:28, opacity:.3, marginBottom:6 }}>○</div>{msg}</div>; }
function Section({ title, children, extra }) { return <div style={{ background:"var(--color-background-primary)", border:"0.5px solid var(--color-border-tertiary)", borderRadius:10, padding:14, marginBottom:12 }}>{title && <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:9, paddingBottom:7, borderBottom:"0.5px solid var(--color-border-tertiary)" }}><span style={{ fontSize:11, fontWeight:500, color:"var(--color-text-secondary)", textTransform:"uppercase", letterSpacing:.5 }}>{title}</span>{extra}</div>}{children}</div>; }
function Field({ label, children }) { return <div style={{ marginBottom:8 }}><label style={{ fontSize:11, fontWeight:500, color:"var(--color-text-secondary)", display:"block", marginBottom:3 }}>{label}</label>{children}</div>; }
function Toggle({ value, onChange }) { return <div onClick={() => onChange(!value)} style={{ width:38, height:21, borderRadius:11, background:value?"#4f46e5":"var(--color-border-secondary)", cursor:"pointer", position:"relative", transition:"background .2s", flexShrink:0 }}><div style={{ width:15, height:15, borderRadius:"50%", background:"#fff", position:"absolute", top:3, left:value?20:3, transition:"left .2s" }}/></div>; }

const IS = { width:"100%", padding:"7px 9px", border:"0.5px solid var(--color-border-secondary)", borderRadius:6, fontSize:12, background:"var(--color-background-primary)", color:"var(--color-text-primary)", boxSizing:"border-box" };
const BP = { display:"inline-flex", alignItems:"center", gap:4, padding:"6px 12px", background:"#4f46e5", color:"#fff", border:"none", borderRadius:6, fontSize:12, fontWeight:500, cursor:"pointer" };
const BS = { padding:"4px 10px", fontSize:11, borderRadius:6, background:"var(--color-background-secondary)", color:"var(--color-text-secondary)", border:"0.5px solid var(--color-border-secondary)", cursor:"pointer" };
const BX = { background:"none", border:"none", cursor:"pointer", fontSize:12, color:"var(--color-text-secondary)", padding:"0 2px" };
const AR = { display:"flex", alignItems:"center", gap:7, padding:"5px 8px", background:"var(--color-background-secondary)", borderRadius:6, marginBottom:4, fontSize:12 };

function WorkflowChain({ memo, users }) {
  return <div style={{ display:"flex", alignItems:"center", gap:3, flexWrap:"wrap" }}>
    {memo.workflow.map((step, i) => {
      const u      = users.find(x => x.id === step.approver) || {};
      const active = i === memo.currentStep && memo.status === "pending";
      const done   = step.status === "approved";
      const rej    = step.status === "rejected";
      return <div key={i} style={{ display:"flex", alignItems:"center", gap:3 }}>
        {i > 0 && <div style={{ width:12, height:1, background:"var(--color-border-tertiary)" }}/>}
        <div title={u.name} style={{ padding:"2px 7px", borderRadius:20, fontSize:11, fontWeight:500,
          background:done?"#eaf3de":rej?"#fcebeb":active?"#faeeda":"var(--color-background-secondary)",
          color:done?"#3b6d11":rej?"#a32d2d":active?"#854f0b":"var(--color-text-secondary)",
          border:`1px solid ${done?"#c0dd97":rej?"#f7c1c1":active?"#fac775":"var(--color-border-tertiary)"}` }}>
          {done?"✓":rej?"✗":active?"●":"○"} {(u.name || "?").split(" ")[0]}
        </div>
      </div>;
    })}
  </div>;
}

function MemoRow({ memo, users, onClick, highlight, currentUser, onRecall, onEdit }) {
  const creator = users.find(u => u.id === memo.createdBy) || {};
  const isOwn   = memo.createdBy === currentUser;
  return <div onClick={onClick} style={{ background:"var(--color-background-primary)", border:`0.5px solid ${highlight?"#fac775":"var(--color-border-tertiary)"}`, borderRadius:8, padding:"10px 12px", marginBottom:5, cursor:"pointer" }}>
    <div style={{ display:"flex", alignItems:"flex-start", gap:8 }}>
      <Avatar userId={memo.createdBy} users={users} size={26}/>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:3, flexWrap:"wrap" }}>
          <span style={{ fontSize:13, fontWeight:500, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:260 }}>{memo.title}</span>
          <StatusBadge status={memo.status}/>
          <span style={{ fontSize:11, color:"var(--color-text-secondary)", background:"var(--color-background-secondary)", padding:"1px 5px", borderRadius:4 }}>{memo.category}</span>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
          <span style={{ fontSize:11, color:"var(--color-text-secondary)" }}>{creator.name} · {fmtShort(memo.createdAt)}</span>
          {memo.attachments?.length > 0 && <span style={{ fontSize:11, color:"var(--color-text-secondary)" }}>📎 {memo.attachments.length}</span>}
          <WorkflowChain memo={memo} users={users}/>
        </div>
      </div>
      {isOwn && onRecall && <div style={{ display:"flex", gap:4, flexShrink:0 }} onClick={e => e.stopPropagation()}>
        {memo.status === "pending" && <button onClick={() => onRecall(memo)} style={BS}>เรียกคืน</button>}
        {(memo.status === "draft" || memo.status === "recalled") && <button onClick={() => onEdit(memo)} style={{ ...BS, background:"#e6f1fb", color:"#185fa5", border:"0.5px solid #b5d4f4" }}>แก้ไข</button>}
      </div>}
    </div>
  </div>;
}

function ActionModal({ modal, onClose, onApprove, onReject }) {
  const [comment, setComment] = useState("");
  const isA = modal.type === "approve";
  return <div style={{ position:"fixed", inset:0, zIndex:100, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(0,0,0,.4)" }}>
    <div style={{ background:"var(--color-background-primary)", border:"0.5px solid var(--color-border-secondary)", borderRadius:12, padding:20, width:340, boxShadow:"0 8px 32px rgba(0,0,0,.18)" }}>
      <div style={{ fontSize:14, fontWeight:500, marginBottom:4 }}>{isA ? "ยืนยันการอนุมัติ" : "ยืนยันการปฏิเสธ"}</div>
      <div style={{ fontSize:12, color:"var(--color-text-secondary)", marginBottom:12, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{modal.memo.title}</div>
      <Field label="ความคิดเห็น (ถ้ามี)"><textarea value={comment} onChange={e => setComment(e.target.value)} rows={3} style={{ ...IS, resize:"none", fontFamily:"inherit" }}/></Field>
      <div style={{ display:"flex", gap:8, marginTop:8 }}>
        <button onClick={() => isA ? onApprove(comment) : onReject(comment)} style={{ flex:1, padding:8, background:isA?"#3b6d11":"#a32d2d", color:"#fff", border:"none", borderRadius:6, fontSize:12, fontWeight:500, cursor:"pointer" }}>{isA ? "✓ อนุมัติ" : "✕ ปฏิเสธ"}</button>
        <button onClick={onClose} style={{ flex:1, padding:8, background:"var(--color-background-secondary)", color:"var(--color-text-secondary)", border:"0.5px solid var(--color-border-secondary)", borderRadius:6, fontSize:12, cursor:"pointer" }}>ยกเลิก</button>
      </div>
    </div>
  </div>;
}

// ── Notify panel (used in Create & detail) ────────────────────────────────────
function NotifyPanel({ notify, setNotify, users, notifyConfig }) {
  const [emailIn, setEmailIn] = useState("");
  const addEmail = () => {
    const e = emailIn.trim();
    if (!e || !e.includes("@") || (notify.emailList || []).includes(e)) return;
    setNotify(p => ({ ...p, emailList:[...(p.emailList||[]), e] }));
    setEmailIn("");
  };
  const remEmail = (e) => setNotify(p => ({ ...p, emailList:(p.emailList||[]).filter(x => x !== e) }));
  const channels = [
    { key:"postToTeams",    enabled:notifyConfig.teams.enabled,     label:"Microsoft Teams",             icon:"🔵" },
    { key:"postToPowerAuto",enabled:notifyConfig.powerauto.enabled, label:"SharePoint / Power Automate", icon:"🟣" },
    { key:"postToLine",     enabled:notifyConfig.line.enabled,      label:"LINE Group",                  icon:"🟢" },
  ];
  return <Section title="แจ้งเตือนเมื่ออนุมัติครบ">
    <div style={{ marginBottom:8 }}>
      <div style={{ fontSize:11, fontWeight:500, color:"var(--color-text-secondary)", marginBottom:4 }}>✉ อีเมล์</div>
      {notifyConfig.email.enabled ? <>
        <div style={{ display:"flex", gap:6, marginBottom:5 }}>
          <input value={emailIn} onChange={e => setEmailIn(e.target.value)} onKeyDown={e => e.key==="Enter"&&addEmail()} placeholder="กรอกอีเมล์..." style={{ flex:1, padding:"5px 8px", border:"0.5px solid var(--color-border-secondary)", borderRadius:6, fontSize:12, background:"var(--color-background-primary)", color:"var(--color-text-primary)" }}/>
          <button onClick={addEmail} style={BP}>เพิ่ม</button>
        </div>
        <div style={{ display:"flex", gap:3, flexWrap:"wrap", marginBottom:5 }}>
          {users.filter(u => u.email && u.active && !(notify.emailList||[]).includes(u.email)).map(u =>
            <button key={u.id} onClick={() => setNotify(p => ({ ...p, emailList:[...(p.emailList||[]),u.email] }))} style={{ fontSize:10, padding:"2px 6px", borderRadius:4, background:"var(--color-background-secondary)", color:"var(--color-text-secondary)", border:"0.5px solid var(--color-border-tertiary)", cursor:"pointer" }}>+ {u.name.split(" ")[0]}</button>)}
        </div>
        {(notify.emailList||[]).map(e => <div key={e} style={AR}><span>✉</span><span style={{ flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{e}</span><button onClick={() => remEmail(e)} style={BX}>✕</button></div>)}
        {!(notify.emailList||[]).length && <div style={{ fontSize:11, color:"var(--color-text-secondary)" }}>ยังไม่มีผู้รับอีเมล์</div>}
      </> : <div style={{ fontSize:11, color:"var(--color-text-secondary)", padding:"4px 8px", background:"var(--color-background-secondary)", borderRadius:5 }}>ยังไม่ได้ตั้งค่า → ไปที่ ตั้งค่าระบบ</div>}
    </div>
    <div style={{ borderTop:"0.5px solid var(--color-border-tertiary)", paddingTop:8 }}>
      <div style={{ fontSize:11, fontWeight:500, color:"var(--color-text-secondary)", marginBottom:5 }}>📢 ช่องทางอื่น</div>
      {channels.map(ch => <div key={ch.key} style={{ display:"flex", alignItems:"center", gap:8, padding:"5px 8px", borderRadius:6, background:ch.enabled?"var(--color-background-secondary)":"transparent", marginBottom:3, opacity:ch.enabled?1:0.45 }}>
        <span>{ch.icon}</span>
        <span style={{ flex:1, fontSize:11 }}>{ch.label}</span>
        {ch.enabled ? <Toggle value={notify[ch.key]||false} onChange={v => setNotify(p => ({ ...p, [ch.key]:v }))}/> : <span style={{ fontSize:10, color:"var(--color-text-secondary)" }}>ยังไม่ได้ตั้งค่า</span>}
      </div>)}
    </div>
  </Section>;
}

// ── Views ─────────────────────────────────────────────────────────────────────
function Dashboard({ memos, users, currentUser, inboxCount, onOpen }) {
  const u = users.find(x => x.id === currentUser) || {};
  const stats = [
    { l:"ทั้งหมด",     v:memos.length,                                c:"#4f46e5" },
    { l:"รออนุมัติ",   v:memos.filter(m=>m.status==="pending").length, c:"#f59e0b" },
    { l:"อนุมัติแล้ว", v:memos.filter(m=>m.status==="approved").length,c:"#10b981" },
    { l:"รอฉัน",       v:inboxCount,                                   c:"#ef4444" },
  ];
  return <div style={{ padding:20 }}>
    <div style={{ marginBottom:16 }}>
      <div style={{ fontSize:16, fontWeight:500 }}>ภาพรวม</div>
      <div style={{ fontSize:12, color:"var(--color-text-secondary)", display:"flex", alignItems:"center", gap:6 }}>สวัสดี {u.name} · <RoleBadge role={u.role}/></div>
    </div>
    <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginBottom:20 }}>
      {stats.map(s => <div key={s.l} style={{ background:"var(--color-background-primary)", border:"0.5px solid var(--color-border-tertiary)", borderRadius:8, padding:"12px 14px", borderTop:`2px solid ${s.c}` }}><div style={{ fontSize:11, color:"var(--color-text-secondary)", marginBottom:4 }}>{s.l}</div><div style={{ fontSize:26, fontWeight:500, color:s.c }}>{s.v}</div></div>)}
    </div>
    <div style={{ fontSize:12, fontWeight:500, marginBottom:8 }}>Memo ล่าสุด</div>
    {[...memos].sort((a,b) => new Date(b.createdAt)-new Date(a.createdAt)).slice(0,5).map(m => <MemoRow key={m.id} memo={m} users={users} onClick={() => onOpen(m.id)}/>)}
  </div>;
}

function MemoList({ memos, users, title, subtitle, currentUser, onOpen, onRecall, onEdit, highlight }) {
  const sorted = [...memos].sort((a,b) => new Date(b.createdAt)-new Date(a.createdAt));
  return <div style={{ padding:20 }}>
    <div style={{ marginBottom:14 }}><div style={{ fontSize:16, fontWeight:500 }}>{title}</div><div style={{ fontSize:12, color:"var(--color-text-secondary)" }}>{subtitle || sorted.length+" รายการ"}</div></div>
    {sorted.length === 0 ? <Empty msg="ไม่พบ Memo"/> : sorted.map(m => <MemoRow key={m.id} memo={m} users={users} onClick={() => onOpen(m.id)} highlight={highlight} currentUser={currentUser} onRecall={onRecall} onEdit={onEdit}/>)}
  </div>;
}

function Search({ memos, users, onOpen }) {
  const [q,setQ]=useState(""); const [fS,setFS]=useState(""); const [fC,setFC]=useState(""); const [fF,setFF]=useState(""); const [fT,setFT]=useState("");
  const res = memos.filter(m => {
    if (q.trim() && !m.title.toLowerCase().includes(q.toLowerCase()) && !m.content.toLowerCase().includes(q.toLowerCase())) return false;
    if (fS && m.status !== fS) return false;
    if (fC && m.category !== fC) return false;
    if (fF && m.createdAt < fF) return false;
    if (fT && m.createdAt > fT+"T23:59:59") return false;
    return true;
  }).sort((a,b) => new Date(b.createdAt)-new Date(a.createdAt));
  const has = q||fS||fC||fF||fT;
  return <div style={{ padding:20 }}>
    <div style={{ fontSize:16, fontWeight:500, marginBottom:12 }}>ค้นหา Memo</div>
    <input value={q} onChange={e=>setQ(e.target.value)} placeholder="ค้นหาชื่อเรื่อง, เนื้อหา..." style={{ ...IS, marginBottom:8 }}/>
    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:7, marginBottom:12 }}>
      <select value={fS} onChange={e=>setFS(e.target.value)} style={{ ...IS, width:"auto" }}><option value="">สถานะทั้งหมด</option>{Object.entries(STATUS_LABEL).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select>
      <select value={fC} onChange={e=>setFC(e.target.value)} style={{ ...IS, width:"auto" }}><option value="">หมวดหมู่ทั้งหมด</option>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select>
      <input type="date" value={fF} onChange={e=>setFF(e.target.value)} style={{ ...IS, width:"auto" }}/>
      <input type="date" value={fT} onChange={e=>setFT(e.target.value)} style={{ ...IS, width:"auto" }}/>
    </div>
    {has ? <><div style={{ fontSize:12, color:"var(--color-text-secondary)", marginBottom:8 }}>พบ {res.length} รายการ</div>{res.map(m => <MemoRow key={m.id} memo={m} users={users} onClick={() => onOpen(m.id)}/>)}{res.length===0&&<Empty msg="ไม่พบผลลัพธ์"/>}</> : <Empty msg="พิมพ์คำค้นหาหรือเลือกตัวกรอง"/>}
  </div>;
}

function CreateView({ editMemo, setEditMemo, users, currentUser, notifyConfig, onSubmit, onCancel, isRecall }) {
  const [newApp, setNewApp] = useState("");
  const fileRef = useRef();
  const update = (k, v) => setEditMemo(p => ({ ...p, [k]:v }));
  const setNotify = (fn) => setEditMemo(p => ({ ...p, notify:typeof fn==="function"?fn(p.notify):fn }));
  const addApp = () => {
    if (!newApp || editMemo.workflow.find(s => s.approver===newApp) || newApp===currentUser) return;
    setEditMemo(p => ({ ...p, workflow:[...p.workflow, { approver:newApp, status:"pending", comment:"", actionAt:null }] }));
    setNewApp("");
  };
  const remApp  = (i) => setEditMemo(p => ({ ...p, workflow:p.workflow.filter((_,j) => j!==i) }));
  const moveApp = (i, d) => { const wf=[...editMemo.workflow]; const t=i+d; if(t<0||t>=wf.length)return; [wf[i],wf[t]]=[wf[t],wf[i]]; setEditMemo(p=>({...p,workflow:wf})); };
  const handleFile = (ev) => {
    const f = ev.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = (e) => {
      const att = { id:aid(), name:f.name, size:f.size>1024*1024?(f.size/1024/1024).toFixed(1)+" MB":Math.round(f.size/1024)+" KB", type:f.name.split(".").pop().toLowerCase(), data:e.target.result };
      setEditMemo(p => ({ ...p, attachments:[...p.attachments, att] }));
    };
    r.readAsDataURL(f); ev.target.value = "";
  };
  const avail = users.filter(u => u.id!==currentUser && u.active && !editMemo.workflow.find(s => s.approver===u.id));
  return <div style={{ padding:20 }}>
    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:16 }}>
      <button onClick={onCancel} style={{ background:"none", border:"none", cursor:"pointer", fontSize:16, color:"var(--color-text-secondary)", padding:0 }}>←</button>
      <div style={{ fontSize:16, fontWeight:500 }}>{editMemo.id?(isRecall?"แก้ไข Memo (เรียกคืน)":"แก้ไข Memo"):"สร้าง Memo ใหม่"}</div>
    </div>
    <div style={{ display:"grid", gridTemplateColumns:"1fr 320px", gap:14, alignItems:"start" }}>
      <div>
        <Section>
          <Field label="ชื่อเรื่อง *"><input value={editMemo.title} onChange={e=>update("title",e.target.value)} placeholder="กรอกชื่อเรื่อง..." style={IS}/></Field>
          <Field label="หมวดหมู่"><select value={editMemo.category} onChange={e=>update("category",e.target.value)} style={{ ...IS, width:"auto" }}>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></Field>
          <Field label="เนื้อหา"><textarea value={editMemo.content} onChange={e=>update("content",e.target.value)} rows={8} placeholder="กรอกเนื้อหา..." style={{ ...IS, resize:"vertical", lineHeight:1.6, fontFamily:"inherit" }}/></Field>
        </Section>
        <Section title="เอกสารแนบ" extra={<button onClick={() => fileRef.current?.click()} style={BS}>+ แนบไฟล์</button>}>
          <input ref={fileRef} type="file" style={{ display:"none" }} onChange={handleFile}/>
          {editMemo.attachments.map(a => <div key={a.id} style={AR}><span>📎</span><span style={{ flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{a.name}</span><span style={{ color:"var(--color-text-secondary)" }}>{a.size}</span><button onClick={() => setEditMemo(p => ({ ...p, attachments:p.attachments.filter(x => x.id!==a.id) }))} style={BX}>✕</button></div>)}
          {editMemo.attachments.length===0 && <div style={{ fontSize:12, color:"var(--color-text-secondary)", textAlign:"center" }}>ยังไม่มีเอกสารแนบ</div>}
        </Section>
      </div>
      <div>
        <Section title="ขั้นตอนการอนุมัติ">
          <div style={{ display:"flex", gap:6, marginBottom:8 }}>
            <select value={newApp} onChange={e => setNewApp(e.target.value)} style={{ flex:1, padding:"6px 8px", border:"0.5px solid var(--color-border-secondary)", borderRadius:6, fontSize:12, background:"var(--color-background-primary)", color:"var(--color-text-primary)" }}>
              <option value="">เลือกผู้อนุมัติ...</option>
              {avail.map(u => <option key={u.id} value={u.id}>{u.name} ({ROLE_CONFIG[u.role]?.label})</option>)}
            </select>
            <button onClick={addApp} style={BP}>เพิ่ม</button>
          </div>
          {editMemo.workflow.length===0 ? <div style={{ fontSize:12, color:"var(--color-text-secondary)", textAlign:"center", padding:"10px 0", border:"0.5px dashed var(--color-border-tertiary)", borderRadius:6 }}>ยังไม่มีผู้อนุมัติ</div>
          : editMemo.workflow.map((step, i) => { const u=users.find(x=>x.id===step.approver)||{}; return <div key={i} style={{ display:"flex", alignItems:"center", gap:6, padding:"6px 8px", background:"var(--color-background-secondary)", borderRadius:6, marginBottom:4 }}>
            <span style={{ fontSize:11, color:"var(--color-text-secondary)", fontWeight:500, minWidth:16 }}>{i+1}.</span>
            <Avatar userId={step.approver} users={users} size={22}/>
            <div style={{ flex:1, minWidth:0 }}><div style={{ fontSize:11, fontWeight:500, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{u.name}</div><div style={{ fontSize:10, color:"var(--color-text-secondary)" }}>{u.dept}</div></div>
            <button onClick={() => moveApp(i,-1)} disabled={i===0} style={{ ...BX, opacity:i===0?.3:1 }}>↑</button>
            <button onClick={() => moveApp(i,1)} disabled={i===editMemo.workflow.length-1} style={{ ...BX, opacity:i===editMemo.workflow.length-1?.3:1 }}>↓</button>
            <button onClick={() => remApp(i)} style={{ ...BX, color:"#a32d2d" }}>✕</button>
          </div>; })}
        </Section>
        <NotifyPanel notify={editMemo.notify} setNotify={setNotify} users={users} notifyConfig={notifyConfig}/>
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          <button onClick={() => onSubmit(false)} style={{ ...BP, width:"100%", justifyContent:"center", padding:"9px", fontSize:13 }}>{isRecall?"ส่งกลับเพื่ออนุมัติ":"ส่งเพื่ออนุมัติ"}</button>
          <button onClick={() => onSubmit(true)} style={{ padding:"9px", background:"var(--color-background-secondary)", color:"var(--color-text-secondary)", border:"0.5px solid var(--color-border-secondary)", borderRadius:6, fontSize:12, cursor:"pointer" }}>บันทึกร่าง</button>
          <button onClick={onCancel} style={{ padding:"9px", background:"none", color:"var(--color-text-secondary)", border:"none", borderRadius:6, fontSize:12, cursor:"pointer" }}>ยกเลิก</button>
        </div>
      </div>
    </div>
  </div>;
}

function Detail({ memo, users, currentUser, notifyConfig, onBack, onRecall, onEdit, onAddFile, onRemoveFile, setModal }) {
  const fileRef   = useRef();
  const isCreator = memo.createdBy === currentUser;
  const canApprove= memo.status==="pending" && memo.workflow[memo.currentStep]?.approver===currentUser;
  const ALABEL = { created:"สร้าง", submitted:"ส่งอนุมัติ", approved:"อนุมัติ", rejected:"ปฏิเสธ", recalled:"เรียกคืน", edited:"แก้ไข", resubmitted:"ส่งกลับ" };
  const ACOLOR = { approved:"#3b6d11", rejected:"#a32d2d", recalled:"#185fa5", submitted:"#854f0b" };
  const handleFile = (e) => { const f=e.target.files[0]; if(f) onAddFile(f); e.target.value=""; };
  const n = memo.notify || {};
  const notifySummary = [
    ...(notifyConfig.email.enabled && n.emailList?.length ? [`✉ ${n.emailList.length} อีเมล์`] : []),
    ...(notifyConfig.teams.enabled && n.postToTeams ? ["🔵 Teams"] : []),
    ...(notifyConfig.powerauto.enabled && n.postToPowerAuto ? ["🟣 SharePoint"] : []),
    ...(notifyConfig.line.enabled && n.postToLine ? ["🟢 LINE Group"] : []),
  ];
  return <div style={{ padding:20 }}>
    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14 }}>
      <button onClick={onBack} style={{ background:"none", border:"none", cursor:"pointer", fontSize:16, color:"var(--color-text-secondary)", padding:0 }}>←</button>
      <div style={{ flex:1, fontSize:15, fontWeight:500, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{memo.title}</div>
      <StatusBadge status={memo.status}/>
    </div>
    <div style={{ display:"grid", gridTemplateColumns:"1fr 290px", gap:14, alignItems:"start" }}>
      <div>
        <Section>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10, paddingBottom:10, borderBottom:"0.5px solid var(--color-border-tertiary)" }}>
            <Avatar userId={memo.createdBy} users={users} size={28}/>
            <div><div style={{ fontSize:12, fontWeight:500 }}>{(users.find(u=>u.id===memo.createdBy)||{}).name}</div><div style={{ fontSize:11, color:"var(--color-text-secondary)" }}>{fmtDate(memo.createdAt)} · {memo.category}</div></div>
          </div>
          <div style={{ fontSize:13, lineHeight:1.7, whiteSpace:"pre-wrap" }}>{memo.content}</div>
        </Section>
        <Section title="เอกสารแนบ" extra={(isCreator||canApprove)&&<><button onClick={() => fileRef.current?.click()} style={BS}>+ แนบไฟล์</button><input ref={fileRef} type="file" style={{ display:"none" }} onChange={handleFile}/></>}>
          {memo.attachments.length===0 ? <div style={{ fontSize:12, color:"var(--color-text-secondary)", textAlign:"center" }}>ไม่มีเอกสารแนบ</div>
          : memo.attachments.map(a => <div key={a.id} style={AR}><span>📎</span>{a.data?<a href={a.data} download={a.name} style={{ flex:1, fontSize:12, color:"#185fa5", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", textDecoration:"none" }}>{a.name}</a>:<span style={{ flex:1, fontSize:12, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{a.name}</span>}<span style={{ fontSize:11, color:"var(--color-text-secondary)" }}>{a.size}</span>{isCreator&&<button onClick={() => onRemoveFile(a.id)} style={BX}>✕</button>}</div>)}
        </Section>
        <Section title="ประวัติการดำเนินงาน">
          {[...memo.history].reverse().map((h, i) => { const u=users.find(x=>x.id===h.by)||{}; return <div key={i} style={{ display:"flex", gap:8, padding:"6px 0", borderBottom:i<memo.history.length-1?"0.5px solid var(--color-border-tertiary)":"none" }}><Avatar userId={h.by} users={users} size={22}/><div style={{ flex:1 }}><div style={{ fontSize:11, display:"flex", gap:6, alignItems:"center", flexWrap:"wrap" }}><span style={{ fontWeight:500 }}>{u.name||"-"}</span><span style={{ color:ACOLOR[h.action]||"var(--color-text-secondary)", fontWeight:500 }}>{ALABEL[h.action]||h.action}</span><span style={{ color:"var(--color-text-secondary)", marginLeft:"auto" }}>{fmtShort(h.at)}</span></div>{h.comment&&<div style={{ fontSize:11, color:"var(--color-text-secondary)", marginTop:2 }}>{h.comment}</div>}</div></div>; })}
        </Section>
      </div>
      <div>
        <Section title="ขั้นตอนการอนุมัติ">
          {memo.workflow.map((step, i) => { const u=users.find(x=>x.id===step.approver)||{}; const active=i===memo.currentStep&&memo.status==="pending"; const sc=STATUS_COLOR[step.status]||STATUS_COLOR.draft; return <div key={i} style={{ padding:"8px 10px", background:active?"#faeeda":"var(--color-background-secondary)", border:`0.5px solid ${active?"#fac775":"var(--color-border-tertiary)"}`, borderRadius:7, marginBottom:5 }}><div style={{ display:"flex", alignItems:"center", gap:6 }}><span style={{ fontSize:10, color:"var(--color-text-secondary)", fontWeight:500, minWidth:18 }}>ขั้น {i+1}</span><Avatar userId={step.approver} users={users} size={20}/><div style={{ flex:1, minWidth:0 }}><div style={{ fontSize:11, fontWeight:500, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{u.name}</div><div style={{ fontSize:10, color:"var(--color-text-secondary)" }}>{u.dept}</div></div><span style={{ background:sc.bg, color:sc.text, border:`1px solid ${sc.border}`, borderRadius:4, padding:"1px 5px", fontSize:10, whiteSpace:"nowrap" }}>{step.status==="pending"?(active?"กำลังรอ":"รอ"):STATUS_LABEL[step.status]}</span></div>{step.comment&&<div style={{ fontSize:11, color:"var(--color-text-secondary)", marginTop:4, paddingTop:4, borderTop:"0.5px solid var(--color-border-tertiary)" }}>{step.comment}</div>}{step.actionAt&&<div style={{ fontSize:10, color:"var(--color-text-secondary)", marginTop:2 }}>{fmtShort(step.actionAt)}</div>}</div>; })}
        </Section>
        {notifySummary.length>0 && <Section title="แจ้งเตือนเมื่ออนุมัติ"><div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>{notifySummary.map(s => <span key={s} style={{ fontSize:11, background:"var(--color-background-secondary)", border:"0.5px solid var(--color-border-tertiary)", borderRadius:5, padding:"3px 8px" }}>{s}</span>)}</div></Section>}
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          {canApprove && <><button onClick={() => setModal({type:"approve",memo})} style={{ padding:9, background:"#3b6d11", color:"#fff", border:"none", borderRadius:6, fontSize:13, fontWeight:500, cursor:"pointer" }}>✓ อนุมัติ</button><button onClick={() => setModal({type:"reject",memo})} style={{ padding:9, background:"#fcebeb", color:"#a32d2d", border:"0.5px solid #f7c1c1", borderRadius:6, fontSize:13, cursor:"pointer" }}>✕ ปฏิเสธ</button></>}
          {isCreator && memo.status==="pending" && <button onClick={onRecall} style={{ padding:9, background:"#e6f1fb", color:"#185fa5", border:"0.5px solid #b5d4f4", borderRadius:6, fontSize:13, cursor:"pointer" }}>↩ เรียกคืน Memo</button>}
          {isCreator && (memo.status==="draft"||memo.status==="recalled") && <button onClick={onEdit} style={{ padding:9, background:"#4f46e5", color:"#fff", border:"none", borderRadius:6, fontSize:13, fontWeight:500, cursor:"pointer" }}>✎ แก้ไข Memo</button>}
        </div>
      </div>
    </div>
  </div>;
}

function UsersMgmt({ users, currentUser, onSave, showToast }) {
  const [editing, setEditing] = useState(null);
  const [delConfirm, setDelConfirm] = useState(null);
  const blank = { name:"", email:"", dept:"", role:"user", active:true };
  const save = () => {
    if (!editing.name.trim()||!editing.email.trim()) { showToast("กรุณากรอกชื่อและอีเมล์","error"); return; }
    if (!editing.email.includes("@")) { showToast("รูปแบบอีเมล์ไม่ถูกต้อง","error"); return; }
    if (!editing.id && users.find(u => u.email===editing.email.trim())) { showToast("อีเมล์นี้มีในระบบแล้ว","error"); return; }
    if (!editing.id) { onSave([...users, { ...editing, id:uid(), name:editing.name.trim(), email:editing.email.trim() }]); showToast("เพิ่ม User แล้ว"); }
    else { onSave(users.map(u => u.id===editing.id?{...editing}:u)); showToast("บันทึกแล้ว"); }
    setEditing(null);
  };
  const toggle = (u) => { if(u.id===currentUser){showToast("ไม่สามารถระงับตัวเองได้","error");return;} onSave(users.map(x=>x.id===u.id?{...x,active:!x.active}:x)); };
  const del    = (u) => { onSave(users.filter(x=>x.id!==u.id)); showToast("ลบ User แล้ว"); setDelConfirm(null); };
  const RDESC  = { superadmin:"เข้าถึงได้ทุกส่วน รวมถึงจัดการ User และตั้งค่าระบบ", admin:"สร้าง อนุมัติ และดู Memo ทั้งหมดได้", user:"สร้าง Memo ของตัวเองและอนุมัติ Memo ที่ได้รับมอบหมาย" };
  return <div style={{ padding:20 }}>
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
      <div><div style={{ fontSize:16, fontWeight:500 }}>จัดการ User</div><div style={{ fontSize:12, color:"var(--color-text-secondary)" }}>{users.length} บัญชี</div></div>
      <button onClick={() => setEditing(blank)} style={BP}>+ เพิ่ม User</button>
    </div>
    <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, marginBottom:14 }}>
      {["superadmin","admin","user"].map(r => { const c=ROLE_CONFIG[r]; const n=users.filter(u=>u.role===r&&u.active).length; return <div key={r} style={{ background:c.bg, border:`0.5px solid ${c.border}`, borderRadius:8, padding:"10px 12px" }}><div style={{ fontSize:11, color:c.text, fontWeight:500 }}>{c.label}</div><div style={{ fontSize:20, fontWeight:500, color:c.text }}>{n}</div></div>; })}
    </div>
    <div style={{ background:"var(--color-background-primary)", border:"0.5px solid var(--color-border-tertiary)", borderRadius:10, overflow:"hidden" }}>
      <div style={{ display:"grid", gridTemplateColumns:"2fr 2fr 1.2fr 1fr 1fr auto", padding:"8px 14px", borderBottom:"0.5px solid var(--color-border-tertiary)", background:"var(--color-background-secondary)" }}>
        {["ชื่อ","อีเมล์","แผนก","สิทธิ์","สถานะ",""].map((h,i) => <div key={i} style={{ fontSize:11, fontWeight:500, color:"var(--color-text-secondary)" }}>{h}</div>)}
      </div>
      {users.map(u => <div key={u.id} style={{ display:"grid", gridTemplateColumns:"2fr 2fr 1.2fr 1fr 1fr auto", padding:"9px 14px", borderBottom:"0.5px solid var(--color-border-tertiary)", alignItems:"center", opacity:u.active?1:.5 }}>
        <div style={{ display:"flex", alignItems:"center", gap:7 }}><Avatar userId={u.id} users={users} size={24}/><span style={{ fontSize:12, fontWeight:u.id===currentUser?500:400 }}>{u.name}{u.id===currentUser&&<span style={{ fontSize:10, color:"#4f46e5", marginLeft:4 }}>(คุณ)</span>}</span></div>
        <div style={{ fontSize:12, color:"var(--color-text-secondary)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{u.email}</div>
        <div style={{ fontSize:12 }}>{u.dept||"-"}</div>
        <div><RoleBadge role={u.role}/></div>
        <div><span style={{ fontSize:11, fontWeight:500, color:u.active?"#3b6d11":"#a32d2d", background:u.active?"#eaf3de":"#fcebeb", border:`1px solid ${u.active?"#c0dd97":"#f7c1c1"}`, borderRadius:4, padding:"2px 6px" }}>{u.active?"ใช้งาน":"ระงับ"}</span></div>
        <div style={{ display:"flex", gap:4 }}>
          <button onClick={() => setEditing({...u})} style={BS}>แก้ไข</button>
          <button onClick={() => toggle(u)} style={{ padding:"2px 7px", fontSize:11, borderRadius:5, background:u.active?"#faeeda":"#eaf3de", color:u.active?"#854f0b":"#3b6d11", border:`0.5px solid ${u.active?"#fac775":"#c0dd97"}`, cursor:"pointer" }}>{u.active?"ระงับ":"เปิด"}</button>
          {u.id!==currentUser && <button onClick={() => setDelConfirm(u)} style={{ ...BX, color:"#a32d2d", padding:"2px 6px", border:"0.5px solid #f7c1c1", borderRadius:5, background:"#fcebeb" }}>ลบ</button>}
        </div>
      </div>)}
    </div>
    {editing && <div style={{ position:"fixed", inset:0, zIndex:100, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(0,0,0,.4)" }}>
      <div style={{ background:"var(--color-background-primary)", border:"0.5px solid var(--color-border-secondary)", borderRadius:12, padding:20, width:400, boxShadow:"0 8px 32px rgba(0,0,0,.18)" }}>
        <div style={{ fontSize:14, fontWeight:500, marginBottom:14 }}>{editing.id?"แก้ไข User":"เพิ่ม User ใหม่"}</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
          <Field label="ชื่อ-สกุล *"><input value={editing.name} onChange={e => setEditing(p=>({...p,name:e.target.value}))} style={IS}/></Field>
          <Field label="แผนก"><input value={editing.dept||""} onChange={e => setEditing(p=>({...p,dept:e.target.value}))} style={IS}/></Field>
          <div style={{ gridColumn:"1/-1" }}><Field label="อีเมล์ *"><input value={editing.email} onChange={e => setEditing(p=>({...p,email:e.target.value}))} style={IS}/></Field></div>
          <Field label="สิทธิ์"><select value={editing.role} onChange={e => setEditing(p=>({...p,role:e.target.value}))} style={IS}><option value="superadmin">Super Admin</option><option value="admin">Admin</option><option value="user">User</option></select></Field>
          <Field label="สถานะ"><select value={editing.active?"1":"0"} onChange={e => setEditing(p=>({...p,active:e.target.value==="1"}))} style={IS}><option value="1">ใช้งาน</option><option value="0">ระงับ</option></select></Field>
        </div>
        <div style={{ padding:"7px 10px", background:"var(--color-background-secondary)", borderRadius:6, fontSize:11, color:"var(--color-text-secondary)", marginBottom:12 }}>{RDESC[editing.role]}</div>
        <div style={{ display:"flex", gap:8 }}><button onClick={save} style={{ flex:1, padding:8, background:"#4f46e5", color:"#fff", border:"none", borderRadius:6, fontSize:12, fontWeight:500, cursor:"pointer" }}>บันทึก</button><button onClick={() => setEditing(null)} style={{ flex:1, padding:8, background:"var(--color-background-secondary)", color:"var(--color-text-secondary)", border:"0.5px solid var(--color-border-secondary)", borderRadius:6, fontSize:12, cursor:"pointer" }}>ยกเลิก</button></div>
      </div>
    </div>}
    {delConfirm && <div style={{ position:"fixed", inset:0, zIndex:100, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(0,0,0,.4)" }}>
      <div style={{ background:"var(--color-background-primary)", border:"0.5px solid var(--color-border-secondary)", borderRadius:12, padding:20, width:320 }}>
        <div style={{ fontSize:14, fontWeight:500, marginBottom:8 }}>ยืนยันการลบ User</div>
        <div style={{ fontSize:12, color:"var(--color-text-secondary)", marginBottom:14 }}>ต้องการลบ <strong>{delConfirm.name}</strong>?</div>
        <div style={{ display:"flex", gap:8 }}><button onClick={() => del(delConfirm)} style={{ flex:1, padding:8, background:"#a32d2d", color:"#fff", border:"none", borderRadius:6, fontSize:12, fontWeight:500, cursor:"pointer" }}>ลบ</button><button onClick={() => setDelConfirm(null)} style={{ flex:1, padding:8, background:"var(--color-background-secondary)", color:"var(--color-text-secondary)", border:"0.5px solid var(--color-border-secondary)", borderRadius:6, fontSize:12, cursor:"pointer" }}>ยกเลิก</button></div>
      </div>
    </div>}
  </div>;
}

function Settings({ notifyConfig, onSave, showToast }) {
  const [cfg, setCfg] = useState(JSON.parse(JSON.stringify(notifyConfig)));
  const set = (ch, k, v) => setCfg(p => ({ ...p, [ch]:{ ...p[ch], [k]:v } }));
  const channels = [
    { id:"email", icon:"✉", label:"อีเมล์ (EmailJS)", color:"#185fa5", fields:[{k:"serviceId",label:"Service ID",ph:"service_xxxxxxx"},{k:"templateId",label:"Template ID",ph:"template_xxxxxxx"},{k:"publicKey",label:"Public Key",ph:"your_public_key"}],
      guide:["สมัครที่ emailjs.com (ฟรี 200/เดือน)","สร้าง Email Service → Gmail / Outlook","สร้าง Template ใช้ตัวแปร {{memo_title}} {{creator_name}} {{to_email}}","คัดลอก Service ID / Template ID / Public Key"] },
    { id:"teams", icon:"🔵", label:"Microsoft Teams Webhook", color:"#464EB8", fields:[{k:"webhookUrl",label:"Webhook URL",ph:"https://your-org.webhook.office.com/..."}],
      guide:["Teams → Channel → ⋯ → Connectors → Incoming Webhook","ตั้งชื่อ E-Memo Notification → Create","Copy URL มาวาง"] },
    { id:"powerauto", icon:"🟣", label:"SharePoint / Power Automate", color:"#742774", fields:[{k:"webhookUrl",label:"HTTP Trigger URL",ph:"https://prod-xx.logic.azure.com/..."}],
      guide:["Power Automate → Create → Automated Cloud Flow","Trigger: When an HTTP request is received","Action: SharePoint → Create news / Outlook → Send email","Copy HTTP POST URL"] },
    { id:"line", icon:"🟢", label:"LINE Messaging API (Group)", color:"#06C755",
      fields:[{k:"channelAccessToken",label:"Channel Access Token",ph:"eyJ..."},{k:"groupId",label:"Group ID",ph:"C1234567890..."}],
      guide:["สมัคร LINE Official Account ที่ manager.line.biz","developers.line.biz → Channel → Messaging API → Copy Token","เพิ่ม Bot เข้า LINE Group ที่ต้องการ","เปิด webhook → บันทึก Group ID จาก event ที่ส่งมา"] },
  ];
  return <div style={{ padding:20 }}>
    <div style={{ fontSize:16, fontWeight:500, marginBottom:4 }}>ตั้งค่าการแจ้งเตือน</div>
    <div style={{ fontSize:12, color:"var(--color-text-secondary)", marginBottom:16 }}>เปิดใช้งานช่องทางที่ต้องการ — ระบบจะส่งเมื่อ Memo อนุมัติครบทุกขั้น</div>
    {channels.map(ch => <div key={ch.id} style={{ background:"var(--color-background-primary)", border:`0.5px solid ${cfg[ch.id].enabled?"var(--color-border-secondary)":"var(--color-border-tertiary)"}`, borderRadius:10, marginBottom:12, overflow:"hidden" }}>
      <div style={{ display:"flex", alignItems:"center", gap:10, padding:"12px 14px", cursor:"pointer", background:cfg[ch.id].enabled?"var(--color-background-secondary)":"transparent" }} onClick={() => set(ch.id,"enabled",!cfg[ch.id].enabled)}>
        <span style={{ fontSize:18 }}>{ch.icon}</span>
        <div style={{ flex:1 }}><div style={{ fontSize:13, fontWeight:500 }}>{ch.label}</div><div style={{ fontSize:11, color:"var(--color-text-secondary)" }}>{cfg[ch.id].enabled?"เปิดใช้งาน":"คลิกเพื่อเปิด"}</div></div>
        <Toggle value={cfg[ch.id].enabled} onChange={v => set(ch.id,"enabled",v)}/>
      </div>
      {cfg[ch.id].enabled && <div style={{ padding:"12px 14px", borderTop:"0.5px solid var(--color-border-tertiary)" }}>
        <div style={{ padding:"8px 10px", background:ch.color+"11", border:`0.5px solid ${ch.color}33`, borderRadius:6, marginBottom:10 }}>
          <div style={{ fontSize:11, fontWeight:500, color:ch.color, marginBottom:4 }}>วิธีตั้งค่า</div>
          {ch.guide.map((g,i) => <div key={i} style={{ fontSize:11, color:"var(--color-text-secondary)", padding:"1px 0" }}>{i+1}. {g}</div>)}
        </div>
        <div style={{ display:"grid", gridTemplateColumns:ch.fields.length>1?"1fr 1fr":"1fr", gap:8 }}>
          {ch.fields.map(f => <Field key={f.k} label={f.label}><input value={cfg[ch.id][f.k]||""} onChange={e => set(ch.id,f.k,e.target.value)} placeholder={f.ph} style={IS}/></Field>)}
        </div>
      </div>}
    </div>)}
    <button onClick={() => { onSave(cfg); showToast("บันทึกการตั้งค่าแล้ว"); }} style={BP}>บันทึกการตั้งค่า</button>
  </div>;
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function EMemo() {
  const [data,      setData]      = useState(null);
  const [view,      setView]      = useState("dashboard");
  const [selId,     setSelId]     = useState(null);
  const [editMemo,  setEditMemo]  = useState(null);
  const [modal,     setModal]     = useState(null);
  const [toast,     setToast]     = useState(null);
  const [syncing,   setSyncing]   = useState(false);

  // ── Firebase real-time listener ───────────────────────────────────────────
  useEffect(() => {
    const dbRef = ref(db, DATA_PATH);
    const unsubscribe = onValue(dbRef, (snapshot) => {
      const val = snapshot.val();
      setData(val || SEED);
    });
    return () => unsubscribe();
  }, []);

  const showToast = (msg, type="success") => { setToast({ msg, type }); setTimeout(() => setToast(null), 3200); };

  if (!data) return <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", fontSize:13, color:"var(--color-text-secondary)" }}>กำลังโหลด Firebase...</div>;

  const { users, memos, currentUser, notifyConfig } = data;
  const curRole = (users.find(u => u.id === currentUser) || {}).role || "user";

  // mutate: อัปเดต state ทันที + sync ไป Firebase
  const mutate = async (patch) => {
    const nd = { ...data, ...patch };
    setData(nd);
    setSyncing(true);
    try { await saveData(nd); } finally { setSyncing(false); }
  };

  const inbox   = memos.filter(m => m.status==="pending" && m.workflow[m.currentStep]?.approver===currentUser);
  const myMemos = memos.filter(m => m.createdBy === currentUser);

  const openMemo    = (id) => { setSelId(id); setView("detail"); };
  const startCreate = () => { setEditMemo({ id:null, title:"", content:"", category:"ทั่วไป", workflow:[], notify:{ emailList:[], postToTeams:false, postToPowerAuto:false, postToLine:false }, attachments:[] }); setView("create"); };
  const startEdit   = (memo) => { setEditMemo({ ...memo, workflow:memo.workflow.map(s=>({...s})), attachments:[...memo.attachments], notify:{ ...memo.notify, emailList:[...(memo.notify?.emailList||[])] } }); setView("create"); };

  const submitMemo = async (isDraft) => {
    if (!editMemo.title.trim()) { showToast("กรุณากรอกชื่อเรื่อง","error"); return; }
    if (!isDraft && editMemo.workflow.length===0) { showToast("กรุณาเพิ่มผู้อนุมัติอย่างน้อย 1 คน","error"); return; }
    const now    = new Date().toISOString();
    const isEdit = !!editMemo.id;
    const old    = isEdit ? memos.find(m => m.id===editMemo.id) : null;
    const nm = { ...editMemo, id:editMemo.id||mid(), createdBy:old?.createdBy||currentUser, createdAt:old?.createdAt||now, updatedAt:now,
      status:isDraft?"draft":"pending", currentStep:0,
      workflow:editMemo.workflow.map(s => ({ ...s, status:isDraft?s.status:"pending", comment:"", actionAt:null })),
      history:[ ...(old?.history||[]), ...(!old?[{action:"created",by:currentUser,at:now,comment:""}]:[]),
        ...(isDraft?[{action:"edited",by:currentUser,at:now,comment:""}]:[{action:old?"resubmitted":"submitted",by:currentUser,at:now,comment:"ส่งเพื่อขออนุมัติ"}]) ] };
    const nm2 = isEdit ? memos.map(m => m.id===editMemo.id?nm:m) : [nm,...memos];
    await mutate({ memos:nm2 });
    setEditMemo(null);
    showToast(isDraft?"บันทึกร่างแล้ว":"ส่ง Memo เพื่ออนุมัติแล้ว");
    setView("myMemos");
  };

  const recallMemo = async (memo) => {
    const now = new Date().toISOString();
    await mutate({ memos:memos.map(m => m.id===memo.id ? { ...m, status:"recalled", history:[...m.history,{action:"recalled",by:currentUser,at:now,comment:"เรียกคืน Memo"}] } : m) });
    showToast("เรียกคืน Memo แล้ว");
  };

  const approveMemo = async (memo, comment) => {
    const now  = new Date().toISOString();
    const i    = memo.currentStep;
    const nwf  = memo.workflow.map((s,j) => j===i ? { ...s, status:"approved", comment, actionAt:now } : s);
    const next = i+1;
    const done = next >= memo.workflow.length;
    const updated = { ...memo, workflow:nwf, currentStep:done?i:next, status:done?"approved":"pending", history:[...memo.history,{action:"approved",by:currentUser,at:now,comment}] };
    await mutate({ memos:memos.map(m => m.id===memo.id?updated:m) });
    setModal(null);
    setSelId(updated.id);
    showToast(done ? "✅ อนุมัติครบทุกขั้น กำลังส่งแจ้งเตือน..." : "อนุมัติขั้นนี้แล้ว ส่งต่อขั้นถัดไป");
    if (done) { await sendNotifications(notifyConfig, updated, users); showToast("ส่งแจ้งเตือนเรียบร้อย"); }
  };

  const rejectMemo = async (memo, comment) => {
    const now = new Date().toISOString();
    const i   = memo.currentStep;
    const nwf = memo.workflow.map((s,j) => j===i ? { ...s, status:"rejected", comment, actionAt:now } : s);
    await mutate({ memos:memos.map(m => m.id===memo.id ? { ...m, workflow:nwf, status:"rejected", history:[...m.history,{action:"rejected",by:currentUser,at:now,comment}] } : m) });
    setModal(null);
    showToast("ปฏิเสธ Memo แล้ว","error");
  };

  const addAtt = (memo, file) => {
    const r = new FileReader();
    r.onload = async (e) => {
      const att = { id:aid(), name:file.name, size:file.size>1024*1024?(file.size/1024/1024).toFixed(1)+" MB":Math.round(file.size/1024)+" KB", type:file.name.split(".").pop().toLowerCase(), data:e.target.result };
      await mutate({ memos:memos.map(m => m.id===memo.id ? { ...m, attachments:[...m.attachments,att] } : m) });
      showToast("แนบไฟล์แล้ว");
    };
    r.readAsDataURL(file);
  };
  const remAtt = async (memo, id) => { await mutate({ memos:memos.map(m => m.id===memo.id ? { ...m, attachments:m.attachments.filter(a=>a.id!==id) } : m) }); };
  const selMemo = memos.find(m => m.id === selId);

  const NAV = [
    { k:"dashboard", l:"ภาพรวม",      i:"⊞", roles:["superadmin","admin","user"] },
    { k:"inbox",     l:"กล่องขาเข้า", i:"↓", badge:inbox.length||null, roles:["superadmin","admin","user"] },
    { k:"myMemos",   l:"Memo ของฉัน", i:"◉", roles:["superadmin","admin","user"] },
    { k:"all",       l:"ทั้งหมด",     i:"≡", roles:["superadmin","admin"] },
    { k:"search",    l:"ค้นหา",       i:"⌕", roles:["superadmin","admin","user"] },
    { k:"users",     l:"จัดการ User", i:"◎", roles:["superadmin"] },
    { k:"settings",  l:"ตั้งค่าระบบ",i:"⚙", roles:["superadmin"] },
  ];

  return <div style={{ fontFamily:"'Noto Sans Thai','Sarabun',sans-serif", display:"flex", height:"100vh", background:"var(--color-background-tertiary,#f5f4f0)", overflow:"hidden" }}>
    <Toast t={toast}/>
    {syncing && <div style={{ position:"fixed", bottom:16, left:220, background:"#e6f1fb", color:"#185fa5", border:"0.5px solid #b5d4f4", borderRadius:6, padding:"4px 10px", fontSize:11, zIndex:100 }}>⟳ กำลังบันทึก...</div>}
    {modal && <ActionModal modal={modal} onClose={() => setModal(null)} onApprove={(c) => approveMemo(modal.memo,c)} onReject={(c) => rejectMemo(modal.memo,c)}/>}

    {/* Sidebar */}
    <div style={{ width:200, background:"var(--color-background-primary,#fff)", borderRight:"0.5px solid var(--color-border-tertiary,#e5e4e0)", display:"flex", flexDirection:"column", flexShrink:0 }}>
      <div style={{ padding:"12px 14px 10px", borderBottom:"0.5px solid var(--color-border-tertiary,#e5e4e0)" }}>
        <div style={{ fontSize:12, fontWeight:600, color:"#4f46e5" }}>E-Memo System</div>
        <div style={{ fontSize:10, color:"var(--color-text-secondary,#888)", lineHeight:1.4, marginTop:1 }}>บ. ไทยซอสเซส มาร์เก็ตติ้ง จก.</div>
      </div>
      <div style={{ padding:"8px 8px 4px" }}><button onClick={startCreate} style={{ ...BP, width:"100%", justifyContent:"center", padding:"7px", fontSize:12 }}>+ สร้าง Memo ใหม่</button></div>
      <nav style={{ flex:1, padding:"4px 8px", overflowY:"auto" }}>
        {NAV.filter(n => n.roles.includes(curRole)).map(n => <button key={n.k} onClick={() => setView(n.k)} style={{ width:"100%", padding:"7px 10px", borderRadius:7, background:view===n.k?"var(--color-background-secondary,#f0efe9)":"transparent", color:view===n.k?"var(--color-text-primary,#1a1a1a)":"var(--color-text-secondary,#888)", border:"none", fontSize:12, cursor:"pointer", display:"flex", alignItems:"center", gap:7, marginBottom:1, textAlign:"left" }}>
          <span style={{ fontSize:13, width:15, textAlign:"center" }}>{n.i}</span>
          <span style={{ flex:1 }}>{n.l}</span>
          {n.badge ? <span style={{ background:"#ef4444", color:"#fff", borderRadius:10, fontSize:10, padding:"1px 5px", fontWeight:500 }}>{n.badge}</span> : null}
        </button>)}
      </nav>
      <div style={{ borderTop:"0.5px solid var(--color-border-tertiary,#e5e4e0)", padding:"7px 8px 10px" }}>
        <div style={{ fontSize:10, color:"var(--color-text-secondary,#888)", padding:"2px 6px 5px", fontWeight:500, letterSpacing:.3 }}>เข้าสู่ระบบเป็น</div>
        {users.filter(u => u.active).map(u => <button key={u.id} onClick={() => mutate({ currentUser:u.id })} style={{ width:"100%", padding:"4px 7px", borderRadius:6, background:currentUser===u.id?"var(--color-background-secondary,#f0efe9)":"transparent", color:currentUser===u.id?"var(--color-text-primary,#1a1a1a)":"var(--color-text-secondary,#888)", border:currentUser===u.id?"0.5px solid var(--color-border-secondary,#ccc)":"none", fontSize:11, cursor:"pointer", display:"flex", alignItems:"center", gap:5, marginBottom:1 }}>
          <Avatar userId={u.id} users={users} size={18}/>
          <span style={{ flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{u.name.split(" ")[0]}</span>
          <RoleBadge role={u.role}/>
        </button>)}
      </div>
    </div>

    {/* Main */}
    <div style={{ flex:1, overflowY:"auto" }}>
      {view==="dashboard" && <Dashboard memos={memos} users={users} currentUser={currentUser} inboxCount={inbox.length} onOpen={openMemo}/>}
      {view==="inbox"     && <MemoList memos={inbox}   users={users} title="กล่องขาเข้า" subtitle={`${inbox.length} รายการรอการอนุมัติ`} currentUser={currentUser} onOpen={openMemo} highlight/>}
      {view==="myMemos"   && <MemoList memos={myMemos} users={users} title="Memo ของฉัน" currentUser={currentUser} onOpen={openMemo} onRecall={recallMemo} onEdit={startEdit}/>}
      {view==="all"       && can(curRole,"viewAll") && <MemoList memos={memos} users={users} title="Memo ทั้งหมด" currentUser={currentUser} onOpen={openMemo}/>}
      {view==="search"    && <Search memos={curRole==="user"?memos.filter(m=>m.createdBy===currentUser||m.workflow.find(s=>s.approver===currentUser)):memos} users={users} onOpen={openMemo}/>}
      {view==="users"     && can(curRole,"manageUsers") && <UsersMgmt users={users} currentUser={currentUser} onSave={(u) => mutate({users:u})} showToast={showToast}/>}
      {view==="settings"  && can(curRole,"settings") && <Settings notifyConfig={notifyConfig} onSave={(cfg) => mutate({notifyConfig:cfg})} showToast={showToast}/>}
      {view==="create"    && editMemo && <CreateView editMemo={editMemo} setEditMemo={setEditMemo} users={users} currentUser={currentUser} notifyConfig={notifyConfig} onSubmit={submitMemo} onCancel={() => { setEditMemo(null); setView("myMemos"); }} isRecall={!!editMemo.id&&editMemo.status==="recalled"}/>}
      {view==="detail"    && selMemo && <Detail memo={selMemo} users={users} currentUser={currentUser} notifyConfig={notifyConfig} onBack={() => setView("myMemos")} onRecall={() => recallMemo(selMemo)} onEdit={() => startEdit(selMemo)} onAddFile={(f) => addAtt(selMemo,f)} onRemoveFile={(id) => remAtt(selMemo,id)} setModal={setModal}/>}
    </div>
  </div>;
}
