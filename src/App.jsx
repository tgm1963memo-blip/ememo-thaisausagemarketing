import React, { useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { ref, onValue } from "firebase/database";
import { auth, db } from "./firebase"; 
import Login from "./Login";

// ── Constants & Configuration ──────────────────────────────────────────────────
const COMPANY       = "บริษัท ไทย-เยอรมัน มีท โปรดักท์ จำกัด (TGM)";
const COMPANY_SHORT = "TGM Meat Product";
const DATA_PATH     = "ememo_data";
const CATEGORIES    = ["ทั่วไป","งบประมาณ","จัดซื้อจัดจ้าง","รายงาน","นโยบาย","HR","IT","อื่นๆ"];
const STATUS_LABEL  = { draft:"ร่าง", pending:"รออนุมัติ", approved:"อนุมัติแล้ว", rejected:"ปฏิเสธ", recalled:"เรียกคืนแล้ว" };

// ปรับ Status Color ให้เข้ากับโทนสีดำ/ทอง
const STATUS_COLOR  = {
  draft:    { bg:"#f5f5f5", text:"#666", border:"#ddd" },
  pending:  { bg:"#FFFBEB", text:"#B45309", border:"#FCD34D" }, // โทนเหลืองทอง
  approved: { bg:"#ECFDF5", text:"#065F46", border:"#A7F3D0" },
  rejected: { bg:"#FFF1F1", text:"#991B1B", border:"#FECACA" },
  recalled: { bg:"#EFF6FF", text:"#1E40AF", border:"#BFDBFE" },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtDate = (s) => !s ? "-" : new Date(s).toLocaleDateString("th-TH", {day:"2-digit",month:"short",year:"numeric"});
const getInitials = (name = "") => name.trim().split(" ").length >= 2 ? name.trim().split(" ")[0][0] + name.trim().split(" ")[1][0] : name.slice(0, 2);

// ── UI Primitives ─────────────────────────────────────────────────────────────
function Avatar({ userId, users, size = 32 }) {
  const u = users?.find(x => x.id === userId) || { name: "?" };
  return <div style={{ width:size, height:size, borderRadius:"50%", background:"#000", color: "#D4AF37", display:"flex", alignItems:"center", justifyContent:"center", fontSize:size*.4, fontWeight:700, border: '2px solid #D4AF37' }}>{getInitials(u.name)}</div>;
}
function StatusBadge({ status }) { 
  const c = STATUS_COLOR[status] || STATUS_COLOR.draft; 
  return <span style={{ background:c.bg, color:c.text, border:`1px solid ${c.border}`, borderRadius:20, padding:"3px 10px", fontSize:11, fontWeight: 600 }}>{STATUS_LABEL[status] || status}</span>; 
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function EMemo() {
  const [authUser, setAuthUser] = useState(undefined);
  const [data, setData] = useState(null);
  const [view, setView] = useState("dashboard");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setAuthUser(u || null));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!authUser) return;
    const dbRef = ref(db, DATA_PATH);
    return onValue(dbRef, (snap) => setData(snap.val() || { users:[], memos:[] }));
  }, [authUser]);

  if (authUser === undefined) return <div style={{ padding: 20, textAlign: 'center', fontFamily: 'sans-serif' }}>กำลังตรวจสอบสิทธิ์...</div>;
  if (!authUser) return <Login />;
  if (!data) return <div style={{ padding: 20, textAlign: 'center', fontFamily: 'sans-serif' }}>กำลังโหลดข้อมูล TGM E-Memo...</div>;

  const { users = [], memos = [] } = data;
  // จำลอง User ปัจจุบัน (ในระบบจริงควรดึงข้อมูล User จาก DB)
  const curUserObj = users.find(u => u.email === authUser.email) || { id: 'u0', name: authUser.email, role: "user", dept: "TGM Staff" };

  const NAV_ITEMS = [
    { k:"dashboard", l:"ภาพรวมระบบ", i:"⊞" },
    { k:"inbox",     l:"กล่องขาเข้า", i:"↓" },
    { k:"myMemos",   l:"Memo ของฉัน", i:"◉" },
    { k:"all",       l:"รายการทั้งหมด", i:"≡" },
    { k:"search",    l:"ค้นหาขั้นสูง", i:"⌕" },
  ];

  return (
    <div style={{ display:"flex", height:"100vh", background:"#F9F9F9", fontFamily:"'Noto Sans Thai', sans-serif" }}>
      
      {/* Sidebar - ใช้โทนสีดำตามแบรนด์ TGM */}
      <div style={{ width:260, background:"#000000", borderRight:"1px solid #333", display:"flex", flexDirection:"column", color: '#fff' }}>
        <div style={{ padding:"25px 20px", borderBottom:"1px solid #333", textAlign: 'center' }}>
          {/* แสดงโลโก้ TGM ใน Sidebar */}
          <img 
            src="/path/to/logo_tgm.png" // ** กรุณาแก้ Path ให้ถูกต้อง **
            alt="TGM Logo" 
            style={{ width: "90px", marginBottom: "10px" }} 
          />
          <div style={{ fontWeight:700, fontSize: '16px', color:"#D4AF37", letterSpacing: '1px' }}>E-MEMO SYSTEM</div>
          <div style={{ fontSize:11, color:"#AAA", marginTop: '2px' }}>Since 1963</div>
        </div>

        <div style={{ flex:1, padding:"15px 10px" }}>
          <button onClick={() => setView("create")} style={{ width:"100%", padding:"12px", background:"#D4AF37", color:"#000", border:"none", borderRadius:8, cursor:"pointer", marginBottom:20, fontSize: '14px', fontWeight: 700, transition: 'background 0.2s', ':hover': {background: '#C49F27'} }}>
            + สร้าง Memo ใหม่
          </button>
          
          <nav>
            {NAV_ITEMS.map(m => (
              <button key={m.k} onClick={() => setView(m.k)} style={{ 
                width:"100%", padding:"12px 15px", textAlign:"left", 
                background: view === m.k ? "rgba(212, 175, 55, 0.15)" : "none", // ไฮไลท์สีทองจางๆ
                border:"none", borderRadius:6, cursor:"pointer", 
                color: view === m.k ? "#D4AF37" : "#CCC", // ตัวอักษรสีทองเมื่อเลือก
                fontSize:14, fontWeight: view === m.k ? 600 : 400, marginBottom:4, display: 'flex', alignItems: 'center', gap: '12px', transition: 'color 0.2s, background 0.2s' 
              }}>
                <span style={{ fontSize: '18px', width: '20px', textAlign: 'center' }}>{m.i}</span>
                <span>{m.l}</span>
              </button>
            ))}
          </nav>
        </div>

        {/* ส่วนท้าย Sidebar - ข้อมูลผู้ใช้และปุ่ม Log out */}
        <div style={{ padding:15, borderTop:"1px solid #333", background: '#111' }}>
          <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:12 }}>
            <Avatar userId={curUserObj.id} users={users} size={36} />
            <div style={{ overflow: 'hidden' }}>
              <div style={{ fontSize:13, fontWeight:600, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{curUserObj.name}</div>
              <div style={{ fontSize:11, color:"#AAA" }}>{curUserObj.dept}</div>
            </div>
          </div>
          <button onClick={() => signOut(auth)} style={{ width:"100%", padding:"8px", fontSize:12, color:"#FFF", background:"#333", border:"1px solid #444", borderRadius:6, cursor:"pointer", transition: 'background 0.2s', ':hover': {background: '#444'} }}>
            ออกจากระบบ
          </button>
        </div>
      </div>

      {/* Main Content พื้นที่แสดงผลหลัก */}
      <div style={{ flex:1, overflowY:"auto", padding:"30px 40px" }}>
        <header style={{ marginBottom:25, borderBottom: '2px solid #EEE', paddingBottom: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin:0, fontSize:24, fontWeight: 700, color: '#000' }}>
            {NAV_ITEMS.find(n => n.k === view)?.l || view.toUpperCase()}
          </h2>
          <div style={{fontSize: '13px', color: '#888'}}>
            Thai-German Meat Product Co., Ltd.
          </div>
        </header>

        {memos.length === 0 ? (
          // แสดงผลเมื่อไม่มีข้อมูล
          <div style={{ textAlign:"center", padding:"80px 50px", color:"#999", border:"2px dashed #DDD", borderRadius:12, background: '#FFF' }}>
            <div style={{ fontSize:50, marginBottom:15 }}>📂</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#666' }}>ยังไม่มีรายการ Memo ในส่วนนี้</div>
            <div style={{ fontSize: 13, marginTop: '5px' }}>คลิกปุ่ม "สร้าง Memo ใหม่" เพื่อเริ่มต้น</div>
          </div>
        ) : (
          // แสดงรายการ Memo (จำลองโครงสร้าง)
          <div style={{ display:"grid", gap:12 }}>
            {memos.map(m => (
              <div key={m.id} style={{ background:"#FFF", padding:"18px 20px", borderRadius:10, border:"1px solid #EEE", display:"flex", justifyContent:"space-between", alignItems:"center", boxShadow: '0 2px 5px rgba(0,0,0,0.02)', transition: 'transform 0.2s', ':hover': {transform: 'translateY(-2px)', boxShadow: '0 5px 15px rgba(0,0,0,0.05)'} }}>
                <div>
                  <div style={{ fontWeight:600, fontSize:15, color: '#000', marginBottom: '3px' }}>{m.title}</div>
                  <div style={{ fontSize:12, color:"#777" }}>
                    <span style={{color: '#D4AF37', fontWeight: 600}}>{m.category}</span> • โดย {users.find(u=>u.id===m.createdBy)?.name || 'Unknown'} • {fmtDate(m.createdAt)}
                  </div>
                </div>
                <StatusBadge status={m.status} />
              </div>
            ))}
          </div>
        )}
        
        {/* Footer ของหน้าหลัก */}
        <footer style={{marginTop: '40px', textAlign: 'center', fontSize: '12px', color: '#BBB', borderTop: '1px solid #EEE', paddingTop: '15px'}}>
            © 2023 TGM Meat Product. All rights reserved.
        </footer>
      </div>
    </div>
  );
}