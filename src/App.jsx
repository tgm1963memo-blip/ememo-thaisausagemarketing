import React, { useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { ref, onValue, set, push, update } from "firebase/database";
import { auth, db } from "./firebase"; 
import Login from "./Login";

// ── Constants ────────────────────────────────────────────────────────────────
const DATA_PATH     = "ememo_data";
const CATEGORIES    = ["ทั่วไป","งบประมาณ","จัดซื้อจัดจ้าง","รายงาน","นโยบาย","HR","IT","อื่นๆ"];
const STATUS_LABEL  = { draft:"ร่าง", pending:\"รออนุมัติ\", approved:\"อนุมัติแล้ว\", rejected:\"ปฏิเสธ\", recalled:\"เรียกคืนแล้ว\" };
const STATUS_COLOR  = {
  pending:  { bg:"#FFFBEB", text:"#B45309", border:"#FCD34D" },
  approved: { bg:"#ECFDF5", text:"#065F46", border:"#A7F3D0" },
  rejected: { bg:"#FFF1F1", text:"#991B1B", border:"#FECACA" },
  default:  { bg:"#F9FAFB", text:"#6B7280", border:"#E5E7EB" }
};

// ฟังก์ชันตรวจสอบสิทธิ์ (จากไฟล์ App.jsx เดิม)
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
  const [editMemo, setEditMemo] = useState(null); // สำหรับสร้าง/แก้ไข
  const [selMemo, setSelMemo] = useState(null);   // สำหรับดูรายละเอียด

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setAuthUser(u || null));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!authUser) return;
    return onValue(ref(db, DATA_PATH), (snap) => {
      setData(snap.val() || { users:[], memos:[] });
    });
  }, [authUser]);

  if (authUser === undefined) return <div style={{ padding: 20 }}>กำลังโหลด...</div>;
  if (!authUser) return <Login />;
  if (!data) return <div style={{ padding: 20 }}>กำลังเชื่อมต่อฐานข้อมูล...</div>;

  const { users = [], memos = [] } = data;
  const curUser = users.find(u => u.email === authUser.email) || { id:"tmp", name: authUser.email, role: "user", dept: "TGM Staff" };

  // ฟังก์ชันเริ่มสร้าง Memo (จากไฟล์เดิม)
  const startCreate = () => {
    setEditMemo({ title: "", category: "ทั่วไป", content: "", status: "pending", createdBy: curUser.id, createdAt: new Date().toISOString() });
    setView("create");
  };

  // ฟังก์ชันเลือกดู Memo
  const openMemo = (m) => {
    setSelMemo(m);
    setView("detail");
  };

  return (
    <div style={{ display:"flex", height:"100vh", background:"#F3F4F6", fontFamily:"'Noto Sans Thai', sans-serif" }}>
      
      {/* Sidebar - TGM Black Theme */}
      <div style={{ width:260, background:"#000", color:"#fff", display:"flex", flexDirection:"column" }}>
        <div style={{ padding:"30px 20px", textAlign: 'center', borderBottom: '1px solid #222' }}>
          {/* ตรวจสอบว่าไฟล์ชื่อ TGM-01-scaled.jpg อยู่ในโฟลเดอร์ public */}
          <img 
            src="/TGM-01-scaled.jpg" 
            alt="TGM" 
            style={{ width: "100px", marginBottom: "10px" }} 
            onError={(e) => { e.target.src = "https://via.placeholder.com/100?text=TGM+LOGO"; }}
          />
          <div style={{ color: "#D4AF37", fontWeight: 700, fontSize: '14px', letterSpacing: '1px' }}>E-MEMO SYSTEM</div>
        </div>

        <nav style={{ flex:1, padding:"20px 10px" }}>
          {can(curUser.role, "create") && (
            <button onClick={startCreate} style={styles.createBtn}>+ สร้าง Memo ใหม่</button>
          )}
          
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
          
          {can(curUser.role, "manageUsers") && (
            <button onClick={() => setView("users")} style={view === "users" ? styles.navActive : styles.navBtn}>👥 จัดการผู้ใช้</button>
          )}
        </nav>

        <div style={{ padding:20, background:"#111", borderTop:"1px solid #222" }}>
          <div style={{ fontSize:13, fontWeight:600, color: "#D4AF37" }}>{curUser.name}</div>
          <div style={{ fontSize:11, color:"#777", marginBottom:10 }}>{curUser.dept}</div>
          <button onClick={() => signOut(auth)} style={styles.logoutBtn}>ออกจากระบบ</button>
        </div>
      </div>

      {/* Main Content */}
      <div style={{ flex:1, padding:"30px 40px", overflowY:"auto" }}>
        <header style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:25 }}>
           <h2 style={{ color:"#000", margin:0 }}>{view.toUpperCase()}</h2>
           {view === "detail" && <button onClick={() => setView("all")} style={styles.backBtn}>← กลับ</button>}
        </header>

        {/* Render Views ตามฟังก์ชันเดิม */}
        {view === "create" ? (
          <div style={styles.formCard}>
             <h3>แบบฟอร์มบันทึกข้อความ</h3>
             <input style={styles.input} placeholder="หัวข้อเรื่อง" onChange={e => setEditMemo({...editMemo, title: e.target.value})} />
             <select style={styles.input} onChange={e => setEditMemo({...editMemo, category: e.target.value})}>
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
             </select>
             <textarea style={{...styles.input, height:150}} placeholder="เนื้อหา..." onChange={e => setEditMemo({...editMemo, content: e.target.value})} />
             <button style={styles.createBtn} onClick={() => {
                const newRef = push(ref(db, `${DATA_PATH}/memos`));
                set(newRef, {...editMemo, id: newRef.key}).then(() => setView("all"));
             }}>ส่งบันทึก</button>
          </div>
        ) : view === "detail" && selMemo ? (
          <div style={styles.formCard}>
             <div style={{display:'flex', justifyContent:'space-between'}}>
                <StatusBadge status={selMemo.status} />
                <span style={{fontSize:12, color:'#999'}}>{selMemo.createdAt}</span>
             </div>
             <h2 style={{marginTop:10}}>{selMemo.title}</h2>
             <p style={{whiteSpace:'pre-wrap', color:'#444'}}>{selMemo.content}</p>
             <hr style={{border:'0.5px solid #eee', margin:'20px 0'}}/>
             {can(curUser.role, "approve") && selMemo.status === "pending" && (
                <div style={{display:'flex', gap:10}}>
                   <button style={{...styles.actionBtn, background:'#10b981'}} onClick={() => update(ref(db, `${DATA_PATH}/memos/${selMemo.id}`), {status:'approved'}).then(()=>setView("all"))}>อนุมัติ</button>
                   <button style={{...styles.actionBtn, background:'#ef4444'}} onClick={() => update(ref(db, `${DATA_PATH}/memos/${selMemo.id}`), {status:'rejected'}).then(()=>setView("all"))}>ปฏิเสธ</button>
                </div>
             )}
          </div>
        ) : (
          <div style={{ display:"grid", gap:10 }}>
            {memos.length === 0 ? (
              <div style={styles.emptyState}>📂 ยังไม่มีรายการข้อมูล</div>
            ) : (
              memos.map(m => {
                const c = STATUS_COLOR[m.status] || STATUS_COLOR.default;
                return (
                  <div key={m.id} onClick={() => openMemo(m)} style={styles.memoCard}>
                    <div>
                      <div style={{ fontWeight:600 }}>{m.title}</div>
                      <div style={{ fontSize:12, color:"#888" }}>{m.category} • โดย {users.find(u=>u.id===m.createdBy)?.name || 'Unknown'}</div>
                    </div>
                    <StatusBadge status={m.status} />
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Sub-Components
function StatusBadge({ status }) { 
  const c = STATUS_COLOR[status] || STATUS_COLOR.default; 
  return <span style={{ background:c.bg, color:c.text, border:`1px solid ${c.border}`, borderRadius:20, padding:"3px 12px", fontSize:11, fontWeight:600 }}>{STATUS_LABEL[status] || status}</span>; 
}

const styles = {
  createBtn: { width:"100%", padding:12, background:"#D4AF37", color:"#000", border:"none", borderRadius:8, fontWeight:700, cursor:"pointer", marginBottom:20 },
  navBtn: { width:"100%", padding:"12px 15px", textAlign:"left", border:"none", borderRadius:6, cursor:"pointer", fontSize:14, marginBottom:4 },
  navActive: { width:"100%", padding:"12px 15px", textAlign:"left", border:"none", borderRadius:6, cursor:"pointer", fontSize:14, marginBottom:4, background: "rgba(212, 175, 55, 0.15)", color: "#D4AF37" },
  logoutBtn: { width:"100%", padding:6, fontSize:11, color:"#fff", background:"#333", border:"none", borderRadius:4, cursor:"pointer" },
  memoCard: { background:"#fff", padding:20, borderRadius:12, border:"1px solid #eee", display:"flex", justifyContent:"space-between", alignItems:"center", cursor:'pointer', transition:'0.2s' },
  emptyState: { textAlign:"center", padding:60, color:"#999", border:"2px dashed #ccc", borderRadius:10, background:"#fff" },
  formCard: { background: "#fff", padding: 30, borderRadius: 12, boxShadow: "0 4px 15px rgba(0,0,0,0.05)" },
  input: { width: '100%', padding: 12, marginBottom: 15, borderRadius: 8, border: '1px solid #ddd', boxSizing: 'border-box' },
  backBtn: { padding: '8px 15px', borderRadius: 6, border: '1px solid #ddd', background: '#fff', cursor: 'pointer' },
  actionBtn: { padding: '10px 25px', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }
};