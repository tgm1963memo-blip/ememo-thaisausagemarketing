import { useState, useEffect, useRef } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { ref, onValue, set, push, update } from "firebase/database";
import { auth, db, DATA_PATH } from "./firebase";
import Login from "./Login";

// ── Theme & Constants ────────────────────────────────────────────────────────
const GOLD  = "#D4AF37";
const BLACK = "#111111";
const CATEGORIES = ["ทั่วไป","งบประมาณ","จัดซื้อจัดจ้าง","รายงาน","นโยบาย","HR","IT","อื่นๆ"];

const STATUS_LABEL = {
  draft:"ร่าง", pending:"รออนุมัติ", approved:"อนุมัติแล้ว",
  rejected:"ปฏิเสธ", recalled:"เรียกคืนแล้ว"
};
const STATUS_COLOR = {
  pending:  { bg:"#FFFBEB", text:"#B45309", border:"#FCD34D" },
  approved: { bg:"#ECFDF5", text:"#065F46", border:"#A7F3D0" },
  rejected: { bg:"#FFF1F1", text:"#991B1B", border:"#FECACA" },
  default:  { bg:"#F9FAFB", text:"#6B7280", border:"#E5E7EB" }
};

// ── Permissions Logic ────────────────────────────────────────────────────────
const can = (role, action) => {
  const perms = {
    superadmin: ["manageUsers", "settings", "viewAll", "create", "approve"],
    admin:      ["viewAll", "create", "approve"],
    user:       ["create"]
  };
  return perms[role]?.includes(action);
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
    return onValue(ref(db, DATA_PATH), (snap) => {
      setData(snap.val() || { users: {}, memos: {} });
    });
  }, [authUser]);

  if (authUser === undefined) return null;
  if (!authUser) return <Login />;
  if (!data) return <div style={{ padding: 20 }}>กำลังเชื่อมต่อฐานข้อมูล...</div>;

  // ── แก้ไขจุดดึงข้อมูลผู้ใช้ (Fix for Object Structure) ──────────────────────
  const usersObj = data.users || {};
  const userList = Object.values(usersObj);
  const curUser = userList.find(u => u.email === authUser.email) || { 
    name: authUser.email, 
    role: "user", 
    dept: "TGM Staff" 
  };
  // ────────────────────────────────────────────────────────────────────────────

  const memoList = Object.values(data.memos || {});

  return (
    <div style={{ display:"flex", height:"100vh", background:"#F3F4F6", fontFamily:"'Noto Sans Thai', sans-serif" }}>
      
      {/* Sidebar */}
      <div style={{ width:260, background:"#000", color:"#fff", display:"flex", flexDirection:"column" }}>
        <div style={{ padding:"30px 20px", textAlign: 'center', borderBottom: '1px solid #222' }}>
          <img 
            src="/TGM-01-scaled.jpg" 
            alt="TGM" 
            style={{ width: "100px", marginBottom: "10px" }} 
            onError={(e) => { e.target.src = "https://via.placeholder.com/100?text=TGM"; }}
          />
          <div style={{ color: GOLD, fontWeight: 700, fontSize: '14px' }}>E-MEMO SYSTEM</div>
        </div>

        <nav style={{ flex:1, padding:"20px 10px" }}>
          {can(curUser.role, "create") && (
            <button style={styles.createBtn}>+ สร้าง Memo ใหม่</button>
          )}
          
          {['dashboard', 'inbox', 'myMemos', 'all'].map(m => (
            <button key={m} onClick={() => setView(m)} style={{
              ...styles.navBtn,
              background: view === m ? "rgba(212, 175, 55, 0.15)" : "transparent",
              color: view === m ? GOLD : "#ccc"
            }}>
              {m === 'dashboard' ? '⊞ ภาพรวม' : m === 'inbox' ? '↓ กล่องขาเข้า' : m === 'myMemos' ? '◉ Memo ของฉัน' : '≡ รายการทั้งหมด'}
            </button>
          ))}

          {can(curUser.role, "manageUsers") && (
            <button onClick={() => setView("users")} style={view === "users" ? styles.navActive : styles.navBtn}>👥 จัดการผู้ใช้</button>
          )}
        </nav>

        <div style={{ padding:20, background:"#111", borderTop:"1px solid #222" }}>
          <div style={{ fontSize:13, fontWeight:600, color: GOLD }}>{curUser.name}</div>
          <div style={{ fontSize:11, color:"#777", marginBottom:10 }}>{curUser.dept} ({curUser.role})</div>
          <button onClick={() => signOut(auth)} style={styles.logoutBtn}>ออกจากระบบ</button>
        </div>
      </div>

      {/* Main Content */}
      <div style={{ flex:1, padding:"30px 40px", overflowY:"auto" }}>
        <h2 style={{ color:"#000", marginBottom:25, borderBottom: '2px solid #DDD', paddingBottom: 15 }}>
          {view.toUpperCase()}
        </h2>

        <div style={{ display:"grid", gap:12 }}>
          {memoList.length === 0 ? (
            <div style={styles.emptyState}>📂 ยังไม่มีรายการข้อมูล</div>
          ) : (
            memoList.map(m => {
              const c = STATUS_COLOR[m.status] || STATUS_COLOR.default;
              return (
                <div key={m.id} style={styles.memoCard}>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:600, fontSize: 16 }}>{m.title}</div>
                    <div style={{ fontSize:12, color:"#888" }}>{m.category} • {m.createdAt}</div>
                  </div>
                  <span style={{ 
                    background: c.bg, 
                    color: c.text, 
                    border: `1px solid ${c.border}`,
                    padding: "4px 12px",
                    borderRadius: 20,
                    fontSize: 11,
                    fontWeight: 600
                  }}>
                    {STATUS_LABEL[m.status] || m.status}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  createBtn: { width:"100%", padding:12, background:GOLD, color:"#000", border:"none", borderRadius:8, fontWeight:700, cursor:"pointer", marginBottom:20 },
  navBtn: { width:"100%", padding:"12px 15px", textAlign:"left", border:"none", borderRadius:6, cursor:"pointer", fontSize:14, marginBottom:4 },
  navActive: { width:"100%", padding:"12px 15px", textAlign:"left", border:"none", borderRadius:6, cursor:"pointer", fontSize:14, marginBottom:4, background: "rgba(212, 175, 55, 0.15)", color: GOLD, fontWeight: 600 },
  logoutBtn: { width:"100%", padding:8, fontSize:11, color:"#fff", background:"#333", border:"none", borderRadius:4, cursor:"pointer" },
  memoCard: { background:"#fff", padding:20, borderRadius:12, border:"1px solid #eee", display:"flex", justifyContent:"space-between", alignItems:"center", boxShadow: "0 2px 4px rgba(0,0,0,0.02)" },
  emptyState: { textAlign:"center", padding:80, color:"#999", border:"2px dashed #ccc", borderRadius:12, background:"#fff" }
};