import React, { useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { ref, onValue } from "firebase/database";
import { auth, db } from "./firebase"; 
import Login from "./Login";

const DATA_PATH = "ememo_data";
const STATUS_LABEL = { draft:"ร่าง", pending:"รออนุมัติ", approved:"อนุมัติแล้ว", rejected:"ปฏิเสธ", recalled:"เรียกคืนแล้ว" };
const STATUS_COLOR = {
  pending:  { bg:"#FFFBEB", text:"#B45309", border:"#FCD34D" },
  approved: { bg:"#ECFDF5", text:"#065F46", border:"#A7F3D0" },
  rejected: { bg:"#FFF1F1", text:"#991B1B", border:"#FECACA" },
  default:  { bg:"#F9FAFB", text:"#6B7280", border:"#E5E7EB" }
};

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

  if (authUser === undefined) return null;
  if (!authUser) return <Login />;
  if (!data) return <div style={{ padding: 20 }}>กำลังโหลด...</div>;

  const { users = [], memos = [] } = data;
  const curUser = users.find(u => u.email === authUser.email) || { name: authUser.email, role: "user", dept: "TGM Staff" };

  return (
    <div style={{ display:"flex", height:"100vh", background:"#F3F4F6", fontFamily:"'Noto Sans Thai', sans-serif" }}>
      
      {/* Sidebar - TGM Black Theme */}
      <div style={{ width:260, background:"#000", color:"#fff", display:"flex", flexDirection:"column" }}>
        <div style={{ padding:"30px 20px", textAlign: 'center', borderBottom: '1px solid #222' }}>
          <img src="/TGM-01-scaled.jpg" alt="TGM" style={{ width: "100px", marginBottom: "10px" }} />
          <div style={{ color: "#D4AF37", fontWeight: 700, fontSize: '14px', letterSpacing: '1px' }}>E-MEMO SYSTEM</div>
        </div>

        <nav style={{ flex:1, padding:"20px 10px" }}>
          <button onClick={() => setView("create")} style={styles.createBtn}>+ สร้าง Memo ใหม่</button>
          {['dashboard', 'inbox', 'myMemos', 'all'].map(m => (
            <button key={m} onClick={() => setView(m)} style={{
              ...styles.navBtn,
              background: view === m ? "rgba(212, 175, 55, 0.15)" : "transparent",
              color: view === m ? "#D4AF37" : "#ccc"
            }}>
              {m === 'dashboard' && '⊞ ภาพรวม'}
              {m === 'inbox' && '↓ กล่องขาเข้า'}
              {m === 'myMemos' && '◉ Memo ของฉัน'}
              {m === 'all' && '≡ รายการทั้งหมด'}
            </button>
          ))}
        </nav>

        <div style={{ padding:20, background:"#111", borderTop:"1px solid #222" }}>
          <div style={{ fontSize:13, fontWeight:600, color: "#D4AF37" }}>{curUser.name}</div>
          <div style={{ fontSize:11, color:"#777", marginBottom:10 }}>{curUser.dept}</div>
          <button onClick={() => signOut(auth)} style={styles.logoutBtn}>ออกจากระบบ</button>
        </div>
      </div>

      {/* Main Content */}
      <div style={{ flex:1, padding:"30px 40px", overflowY:"auto" }}>
        <h2 style={{ color:"#000", marginBottom:20, borderBottom: '2px solid #DDD', paddingBottom: 10 }}>
          {view === 'dashboard' ? 'ภาพรวมระบบ' : view.toUpperCase()}
        </h2>

        {memos.length === 0 ? (
          <div style={styles.emptyState}>📂 ยังไม่มีรายการข้อมูล</div>
        ) : (
          <div style={{ display:"grid", gap:10 }}>
            {memos.map(m => {
              const c = STATUS_COLOR[m.status] || STATUS_COLOR.default;
              return (
                <div key={m.id} style={styles.memoCard}>
                  <div>
                    <div style={{ fontWeight:600 }}>{m.title}</div>
                    <div style={{ fontSize:12, color:"#888" }}>{m.category} • {m.createdAt}</div>
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
  navBtn: { width:"100%", padding:"12px 15px", textAlign:"left", border:"none", borderRadius:6, cursor:"pointer", fontSize:14, marginBottom:4, transition: '0.2s' },
  logoutBtn: { width:"100%", padding:6, fontSize:11, color:"#fff", background:"#333", border:"none", borderRadius:4, cursor:"pointer" },
  memoCard: { background:"#fff", padding:15, borderRadius:10, border:"1px solid #eee", display:"flex", justifyContent:"space-between", alignItems:"center" },
  badge: { padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:600 },
  emptyState: { textAlign:"center", padding:60, color:"#999", border:"2px dashed #ccc", borderRadius:10, background:"#fff" }
};