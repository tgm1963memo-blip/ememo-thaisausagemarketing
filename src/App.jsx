import React, { useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { ref, onValue, update, push } from "firebase/database";
import { auth, db } from "./firebase"; 
import Login from "./Login";

// ── Configuration ──────────────────────────────────────────────────────────
const DATA_PATH = "ememo_data";
const STATUS_LABEL = { draft:"ร่าง", pending:"รออนุมัติ", approved:"อนุมัติแล้ว", rejected:"ปฏิเสธ", recalled:"เรียกคืนแล้ว" };
const STATUS_COLOR = {
  pending:  { bg:"#FFFBEB", text:"#B45309", border:"#FCD34D" },
  approved: { bg:"#ECFDF5", text:"#065F46", border:"#A7F3D0" },
  rejected: { bg:"#FFF1F1", text:"#991B1B", border:"#FECACA" },
  default:  { bg:"#F9FAFB", text:"#6B7280", border:"#E5E7EB" }
};

// ฟังก์ชันตรวจสอบสิทธิ์จากไฟล์เดิม
const can = (role, action) => {
  const perms = {
    superadmin: ["manageUsers", "settings", "viewAll", "create"],
    admin: ["viewAll", "create"],
    user: ["create"]
  };
  return perms[role]?.includes(action);
};

export default function EMemo() {
  const [authUser, setAuthUser] = useState(undefined);
  const [data, setData] = useState(null);
  const [view, setView] = useState("dashboard");
  const [editMemo, setEditMemo] = useState(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setAuthUser(u || null));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!authUser) return;
    return onValue(ref(db, DATA_PATH), (snap) => setData(snap.val() || { users:[], memos:[] }));
  }, [authUser]);

  if (authUser === undefined) return null;
  if (!authUser) return <Login />;
  if (!data) return <div style={{ padding: 20 }}>กำลังโหลด...</div>;

  const { users = [], memos = [] } = data;
  const curUser = users.find(u => u.email === authUser.email) || { id: "u-tmp", name: authUser.email, role: "user", dept: "TGM Staff" };

  // ฟังก์ชันสร้าง Memo ใหม่
  const startCreate = () => {
    setEditMemo({ title: "", category: "ทั่วไป", content: "", status: "draft" });
    setView("create");
  };

  return (
    <div style={{ display:"flex", height:"100vh", background:"#F3F4F6", fontFamily:"'Noto Sans Thai', sans-serif" }}>
      
      {/* Sidebar - TGM Theme */}
      <div style={{ width:260, background:"#000", color:"#fff", display:"flex", flexDirection:"column" }}>
        <div style={{ padding:"30px 20px", textAlign: 'center', borderBottom: '1px solid #222' }}>
          <img src="/TGM-01-scaled.jpg" alt="TGM" style={{ width: "100px", marginBottom: "10px" }} />
          <div style={{ color: "#D4AF37", fontWeight: 700, fontSize: '14px' }}>E-MEMO SYSTEM</div>
        </div>

        <nav style={{ flex:1, padding:"20px 10px" }}>
          {can(curUser.role, "create") && (
            <button onClick={startCreate} style={styles.createBtn}>+ สร้าง Memo ใหม่</button>
          )}
          
          <button onClick={() => setView("dashboard")} style={view === "dashboard" ? styles.navActive : styles.navBtn}>⊞ ภาพรวม</button>
          <button onClick={() => setView("inbox")} style={view === "inbox" ? styles.navActive : styles.navBtn}>↓ กล่องขาเข้า</button>
          <button onClick={() => setView("myMemos")} style={view === "myMemos" ? styles.navActive : styles.navBtn}>◉ Memo ของฉัน</button>
          
          {can(curUser.role, "manageUsers") && (
            <button onClick={() => setView("users")} style={view === "users" ? styles.navActive : styles.navBtn}>👥 จัดการผู้ใช้</button>
          )}
        </nav>

        <div style={{ padding:20, background:"#111", borderTop:"1px solid #222" }}>
          <div style={{ fontSize:13, fontWeight:600, color: "#D4AF37" }}>{curUser.name}</div>
          <div style={{ fontSize:11, color:"#777", marginBottom:10 }}>{curUser.dept} ({curUser.role})</div>
          <button onClick={() => signOut(auth)} style={styles.logoutBtn}>ออกจากระบบ</button>
        </div>
      </div>

      {/* Main Content Area */}
      <div style={{ flex:1, padding:"30px 40px", overflowY:"auto" }}>
        <h2 style={{ color:"#000", marginBottom:20, borderBottom: '2px solid #DDD', paddingBottom: 10 }}>
          {view === 'dashboard' ? 'ภาพรวมระบบ' : view.toUpperCase()}
        </h2>

        {/* ส่วนแสดงรายการ (ปรับปรุงตามไฟล์เดิม) */}
        {memos.length === 0 ? (
          <div style={styles.emptyState}>📂 ยังไม่มีรายการข้อมูลในระบบ</div>
        ) : (
          <div style={{ display:"grid", gap:10 }}>
            {memos.filter(m => curUser.role !== 'user' || m.createdBy === curUser.id).map(m => {
              const c = STATUS_COLOR[m.status] || STATUS_COLOR.default;
              return (
                <div key={m.id} style={styles.memoCard}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight:600, fontSize: "16px" }}>{m.title}</div>
                    <div style={{ fontSize:12, color:"#888" }}>{m.category} • สร้างเมื่อ {m.createdAt}</div>
                  </div>
                  <span style={{ ...styles.badge, background:c.bg, color:c.text, border:`1px solid ${c.border}` }}>
                    {STATUS_LABEL[m.status] || m.status}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  createBtn: { width:"100%", padding:12, background:"#D4AF37", color:"#000", border:"none", borderRadius:8, fontWeight:700, cursor:"pointer", marginBottom:20 },
  navBtn: { width:"100%", padding:"12px 15px", textAlign:"left", border:"none", background: "transparent", color: "#ccc", borderRadius:6, cursor:"pointer", fontSize:14, marginBottom:4 },
  navActive: { width:"100%", padding:"12px 15px", textAlign:"left", border:"none", background: "rgba(212, 175, 55, 0.15)", color: "#D4AF37", fontWeight: "600", borderRadius:6, cursor:"pointer", fontSize:14, marginBottom:4 },
  logoutBtn: { width:"100%", padding:8, fontSize:11, color:"#fff", background:"#333", border:"none", borderRadius:4, cursor:"pointer" },
  memoCard: { background:"#fff", padding:"18px", borderRadius:12, border:"1px solid #eee", display:"flex", justifyContent:"space-between", alignItems:"center", boxShadow: "0 2px 4px rgba(0,0,0,0.05)" },
  badge: { padding:"4px 12px", borderRadius:20, fontSize:11, fontWeight:600 },
  emptyState: { textAlign:"center", padding:80, color:"#999", border:"2px dashed #ccc", borderRadius:12, background:"#fff" }
};