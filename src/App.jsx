import React, { useEffect, useState, useRef } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { ref, onValue, set } from "firebase/database";
import { auth, db } from "./firebase"; 
import Login from "./Login";

// ── Constants & Configuration ──────────────────────────────────────────────────
const COMPANY       = "บริษัท ไทยซอสเซส มาร์เก็ตติ้ง จำกัด";
const COMPANY_SHORT = "Thai Sauces Marketing";
const DATA_PATH     = "ememo_data";
const CATEGORIES    = ["ทั่วไป","งบประมาณ","จัดซื้อจัดจ้าง","รายงาน","นโยบาย","HR","IT","อื่นๆ"];
const STATUS_LABEL  = { draft:"ร่าง", pending:"รออนุมัติ", approved:"อนุมัติแล้ว", rejected:"ปฏิเสธ", recalled:"เรียกคืนแล้ว" };
const STATUS_COLOR  = {
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
const PALETTES = [{bg:"#e6f1fb",text:"#185fa5"},{bg:"#eaf3de",text:"#3b6d11"},{bg:"#faeeda",text:"#854f0b"},{bg:"#fbeaf0",text:"#993556"}];

// ── Empty Initial State ───────────────────────────────────────────────────────
const EMPTY_DATA = {
  users: [],
  memos: [],
  notifyConfig: {
    email:     { enabled:false, serviceId:"", templateId:"", publicKey:"" },
    teams:     { enabled:false, webhookUrl:"" },
    line:      { enabled:false, channelAccessToken:"", groupId:"" },
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtDate = (s) => !s ? "-" : new Date(s).toLocaleDateString("th-TH", {day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"});
const getInitials = (name = "") => name.trim().split(" ").length >= 2 ? name.trim().split(" ")[0][0] + name.trim().split(" ")[1][0] : name.slice(0, 2);

// ── UI Primitives ─────────────────────────────────────────────────────────────
function Avatar({ userId, users, size = 28 }) {
  const u = users?.find(x => x.id === userId) || { name: "?" };
  return <div style={{ width:size, height:size, borderRadius:"50%", background:"#e0e0e0", display:"flex", alignItems:"center", justifyContent:"center", fontSize:size*.36, fontWeight:500 }}>{getInitials(u.name)}</div>;
}
function StatusBadge({ status }) { 
  const c = STATUS_COLOR[status] || STATUS_COLOR.draft; 
  return <span style={{ background:c.bg, color:c.text, border:`1px solid ${c.border}`, borderRadius:4, padding:"2px 7px", fontSize:11 }}>{STATUS_LABEL[status] || status}</span>; 
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function EMemo() {
  const [authUser, setAuthUser] = useState(undefined);
  const [data, setData] = useState(null);
  const [view, setView] = useState("dashboard");
  const [selId, setSelId] = useState(null);
  const [editMemo, setEditMemo] = useState(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setAuthUser(u || null));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!authUser) return;
    const dbRef = ref(db, DATA_PATH);
    return onValue(dbRef, (snap) => setData(snap.val() || EMPTY_DATA));
  }, [authUser]);

  if (authUser === undefined) return <div style={{ padding: 20 }}>กำลังตรวจสอบสิทธิ์...</div>;
  if (!authUser) return <Login />;
  if (!data) return <div style={{ padding: 20 }}>กำลังโหลดข้อมูลจากฐานข้อมูล...</div>;

  const { users = [], memos = [] } = data;
  const curUserObj = users.find(u => u.email === authUser.email) || { name: authUser.email, role: "user" };

  return (
    <div style={{ display:"flex", height:"100vh", background:"#f5f4f0", fontFamily:"sans-serif" }}>
      
      {/* Sidebar */}
      <div style={{ width:240, background:"#fff", borderRight:"1px solid #ddd", display:"flex", flexDirection:"column" }}>
        <div style={{ padding:20, borderBottom:"1px solid #eee" }}>
          <div style={{ fontWeight:700, color:"#4f46e5" }}>E-MEMO SYSTEM</div>
          <div style={{ fontSize:11, color:"#888" }}>{COMPANY_SHORT}</div>
        </div>

        <div style={{ flex:1, padding:10 }}>
          <button onClick={() => setView("create")} style={{ width:"100%", padding:10, background:"#4f46e5", color:"#fff", border:"none", borderRadius:8, cursor:"pointer", marginBottom:15 }}>+ สร้าง Memo ใหม่</button>
          
          <nav>
            {["dashboard", "inbox", "myMemos", "all", "search"].map(m => (
              <button key={m} onClick={() => setView(m)} style={{ width:"100%", padding:"10px 15px", textAlign:"left", background: view === m ? "#f0f0ff" : "none", border:"none", borderRadius:6, cursor:"pointer", color: view === m ? "#4f46e5" : "#555", fontSize:14, marginBottom:2 }}>
                {m === "dashboard" && "⊞ ภาพรวม"}
                {m === "inbox" && "↓ กล่องขาเข้า"}
                {m === "myMemos" && "◉ Memo ของฉัน"}
                {m === "all" && "≡ รายการทั้งหมด"}
                {m === "search" && "⌕ ค้นหา"}
              </button>
            ))}
          </nav>
        </div>

        <div style={{ padding:15, borderTop:"1px solid #eee" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
            <Avatar userId={curUserObj.id} users={users} />
            <div style={{ fontSize:12, fontWeight:600 }}>{curUserObj.name}</div>
          </div>
          <button onClick={() => signOut(auth)} style={{ width:"100%", padding:7, fontSize:12, color:"#a32d2d", background:"#fff5f5", border:"1px solid #ffcfcf", borderRadius:5, cursor:"pointer" }}>ออกจากระบบ</button>
        </div>
      </div>

      {/* Main Content */}
      <div style={{ flex:1, overflowY:"auto", padding:25 }}>
        <header style={{ marginBottom:20 }}>
          <h2 style={{ margin:0, fontSize:20 }}>{view.toUpperCase()}</h2>
        </header>

        {memos.length === 0 ? (
          <div style={{ textAlign:"center", padding:50, color:"#999", border:"2px dashed #ddd", borderRadius:10 }}>
            <div style={{ fontSize:40, marginBottom:10 }}>📂</div>
            ยังไม่มีข้อมูลในส่วนนี้
          </div>
        ) : (
          <div style={{ display:"grid", gap:10 }}>
            {/* รายการ Memo จะแสดงตรงนี้ */}
            {memos.map(m => (
              <div key={m.id} style={{ background:"#fff", padding:15, borderRadius:8, border:"1px solid #eee", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div>
                  <div style={{ fontWeight:600, fontSize:14 }}>{m.title}</div>
                  <div style={{ fontSize:12, color:"#888" }}>{m.category} • {fmtDate(m.createdAt)}</div>
                </div>
                <StatusBadge status={m.status} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}