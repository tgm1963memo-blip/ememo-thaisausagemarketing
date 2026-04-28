import React, { useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { ref, onValue, set, push, update } from "firebase/database";
import { auth, db } from "./firebase";
import Login from "./Login";

// ── Config ─────────────────────────────────
const DATA_PATH = "ememo_data";
const CATEGORIES = ["ทั่วไป","งบประมาณ","จัดซื้อจัดจ้าง","รายงาน","นโยบาย","HR","IT","อื่นๆ"];

const STATUS_LABEL = {
  draft: "ร่าง",
  pending: "รออนุมัติ",
  approved: "อนุมัติแล้ว",
  rejected: "ปฏิเสธ",
  recalled: "เรียกคืนแล้ว"
};

const STATUS_COLOR = {
  pending:  { bg:"#FFFBEB", text:"#B45309", border:"#FCD34D" },
  approved: { bg:"#ECFDF5", text:"#065F46", border:"#A7F3D0" },
  rejected: { bg:"#FFF1F1", text:"#991B1B", border:"#FECACA" },
  default:  { bg:"#F9FAFB", text:"#6B7280", border:"#E5E7EB" }
};

// ── Permission ─────────────────────────────
const can = (role, action) => {
  const perms = {
    superadmin: ["manageUsers","settings","viewAll","create","approve"],
    admin: ["viewAll","create","approve"],
    user: ["create"]
  };
  return perms[role]?.includes(action);
};

export default function EMemo() {
  const [authUser, setAuthUser] = useState(undefined);
  const [data, setData] = useState(null);
  const [view, setView] = useState("dashboard");
  const [editMemo, setEditMemo] = useState(null);
  const [selMemo, setSelMemo] = useState(null);

  // ── Auth ─────────────────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setAuthUser(u || null);
    });
    return () => unsub();
  }, []);

  // ── Load Data ────────────────────────
  useEffect(() => {
    if (!authUser) return;

    const dbRef = ref(db, DATA_PATH);
    const unsub = onValue(dbRef, (snap) => {
      setData(snap.val() || { users: {}, memos: {} });
    });

    return () => unsub();
  }, [authUser]);

  // ── Loading Guards ───────────────────
  if (authUser === undefined) return <div style={{ padding: 20 }}>Loading Auth...</div>;
  if (!authUser) return <Login />;
  if (!data) return <div style={{ padding: 20 }}>Loading Data...</div>;

  const users = data.users || {};
  const memos = data.memos || {};

  const memoList = Object.values(memos);
  const userList = Object.values(users);

  const curUser =
    userList.find(u => u.email === authUser.email) || {
      id: authUser.uid,
      name: authUser.email,
      role: "user",
      dept: "TGM"
    };

  // ── Actions ──────────────────────────
  const handleSaveMemo = () => {
    if (!editMemo || !editMemo.title) {
      return alert("กรุณาระบุหัวข้อ");
    }

    const newRef = editMemo.id
      ? ref(db, `${DATA_PATH}/memos/${editMemo.id}`)
      : push(ref(db, `${DATA_PATH}/memos`));

    const payload = {
      ...editMemo,
      id: editMemo.id || newRef.key,
      createdBy: curUser.id,
      createdAt: editMemo.createdAt || new Date().toLocaleString("th-TH"),
      status: editMemo.status || "pending"
    };

    set(newRef, payload).then(() => {
      setView("all");
      setEditMemo(null);
    });
  };

  const handleUpdateStatus = (id, status) => {
    update(ref(db, `${DATA_PATH}/memos/${id}`), { status }).then(() => {
      setSelMemo(null);
      setView("all");
    });
  };

  // ── Render ───────────────────────────
  const renderContent = () => {
    // CREATE / EDIT
    if (view === "create" || view === "edit") {
      return (
        <div style={styles.formCard}>
          <h3>{view === "create" ? "สร้าง Memo" : "แก้ไข Memo"}</h3>

          <input
            style={styles.input}
            value={editMemo?.title || ""}
            placeholder="หัวข้อ"
            onChange={e => setEditMemo({ ...editMemo, title: e.target.value })}
          />

          <select
            style={styles.input}
            value={editMemo?.category || "ทั่วไป"}
            onChange={e => setEditMemo({ ...editMemo, category: e.target.value })}
          >
            {CATEGORIES.map(c => <option key={c}>{c}</option>)}
          </select>

          <textarea
            style={{ ...styles.input, height: 200 }}
            value={editMemo?.content || ""}
            placeholder="เนื้อหา"
            onChange={e => setEditMemo({ ...editMemo, content: e.target.value })}
          />

          <button style={styles.createBtn} onClick={handleSaveMemo}>
            บันทึก
          </button>
        </div>
      );
    }

    // DETAIL
    if (view === "detail" && selMemo) {
      return (
        <div style={styles.formCard}>
          <h2>{selMemo.title}</h2>
          <p>{selMemo.content}</p>

          {can(curUser.role, "approve") && (
            <>
              <button onClick={() => handleUpdateStatus(selMemo.id, "approved")}>อนุมัติ</button>
              <button onClick={() => handleUpdateStatus(selMemo.id, "rejected")}>ปฏิเสธ</button>
            </>
          )}
        </div>
      );
    }

    // LIST
    return (
      <div>
        {memoList.map(m => (
          <div key={m.id} onClick={() => { setSelMemo(m); setView("detail"); }}>
            {m.title}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      {/* Sidebar */}
      <div style={{ width: 250, background: "#000", color: "#fff", padding: 20 }}>
        <button onClick={() => setView("create")}>+ Memo</button>
        <button onClick={() => setView("all")}>ทั้งหมด</button>
        <button onClick={() => signOut(auth)}>Logout</button>
      </div>

      {/* Main */}
      <div style={{ flex: 1, padding: 20 }}>
        {renderContent()}
      </div>
    </div>
  );
}

// ── UI ────────────────────────────────
const styles = {
  createBtn: { padding: 10, background: "#D4AF37", border: "none" },
  formCard: { background: "#fff", padding: 20 },
  input: { width: "100%", marginBottom: 10 }
};