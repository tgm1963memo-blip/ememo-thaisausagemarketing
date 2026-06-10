import { useState } from "react";
import { normalizeEmail } from "./memoHelpers";

function groupUsersByDept(userList) {
  const map = new Map();
  for (const u of userList) {
    const dept = u.dept || "อื่นๆ";
    if (!map.has(dept)) map.set(dept, []);
    map.get(dept).push(u);
  }
  return [...map.entries()]
    .map(([dept, deptUsers]) => ({ dept, users: deptUsers }))
    .sort((a, b) => a.dept.localeCompare(b.dept, "th"));
}

function formatUserLabel(u) {
  return [u.name, u.nickname && `(${u.nickname})`].filter(Boolean).join(" ");
}

export default function PostApprovalCcPanel({ memo, users, notifyConfig, onAddEmails }) {
  const [emailIn, setEmailIn] = useState("");
  const [pending, setPending] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  if (!notifyConfig?.email?.enabled) {
    return (
      <div style={{ fontSize: 11, color: "#9CA3AF", padding: "4px 0" }}>
        ระบบอีเมลยังไม่ได้เปิดใช้งาน — ติดต่อ Admin
      </div>
    );
  }

  const existing = new Set((memo.notify?.emailList || []).map(normalizeEmail));
  const pendingSet = new Set(pending.map(normalizeEmail));

  const isTaken = email => existing.has(normalizeEmail(email)) || pendingSet.has(normalizeEmail(email));

  const addEmail = raw => {
    const e = String(raw || "").trim();
    if (!e || !e.includes("@") || isTaken(e)) return;
    setPending(p => [...p, e]);
    setEmailIn("");
  };

  const pickable = users.filter(u => u.email && u.active && !isTaken(u.email));
  const grouped = groupUsersByDept(pickable);
  const currentList = memo.notify?.emailList || [];

  const handleSubmit = async () => {
    if (!pending.length || submitting || !onAddEmails) return;
    setSubmitting(true);
    try {
      await onAddEmails(pending);
      setPending([]);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div style={{ fontSize: 11, color: "#6B7280", lineHeight: 1.6, marginBottom: 8 }}>
        เพิ่มอีเมลผู้รับแจ้งเตือนหลังอนุมัติ — ระบบจะส่งอีเมลพร้อมลิงก์ดูเอกสารให้ผู้รับใหม่ทันที
      </div>

      {currentList.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#9CA3AF", marginBottom: 4 }}>ผู้รับ CC ปัจจุบัน ({currentList.length})</div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {currentList.map(e => (
              <span key={e} style={{ fontSize: 10, background: "#F3F4F6", color: "#374151", borderRadius: 4, padding: "2px 7px" }}>{e}</span>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <input
          value={emailIn}
          onChange={e => setEmailIn(e.target.value)}
          onKeyDown={e => e.key === "Enter" && addEmail(emailIn)}
          placeholder="กรอกอีเมล์..."
          style={{ flex: 1, fontSize: 12, padding: "6px 8px", border: "1px solid #E5E7EB", borderRadius: 5 }}
        />
        <button
          type="button"
          onClick={() => addEmail(emailIn)}
          style={{ padding: "6px 10px", fontSize: 11, fontWeight: 600, background: "#D4AF37", color: "#111", border: "none", borderRadius: 5, cursor: "pointer" }}
        >
          เพิ่ม
        </button>
      </div>

      <div style={{ maxHeight: 160, overflowY: "auto", marginBottom: 6, paddingRight: 2 }}>
        {grouped.map(({ dept, users: deptUsers }) => (
          <div key={dept} style={{ marginBottom: 6 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#9CA3AF", marginBottom: 3 }}>{dept}</div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {deptUsers.map(u => (
                <button
                  key={u.id}
                  type="button"
                  title={u.email}
                  onClick={() => addEmail(u.email)}
                  style={{
                    fontSize: 10, padding: "3px 8px", borderRadius: 4, background: "#F9FAFB", color: "#374151",
                    border: "1px solid #E5E7EB", cursor: "pointer", maxWidth: "100%", overflow: "hidden",
                    textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}
                >
                  + {formatUserLabel(u)}
                </button>
              ))}
            </div>
          </div>
        ))}
        {!grouped.length && <div style={{ fontSize: 11, color: "#9CA3AF" }}>ไม่มี User ให้เลือกเพิ่ม</div>}
      </div>

      {pending.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#1E40AF", marginBottom: 4 }}>รอส่ง ({pending.length})</div>
          {pending.map(e => (
            <div key={e} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 0", borderBottom: "1px solid #F3F4F6" }}>
              <span style={{ flex: 1, fontSize: 12, color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e}</span>
              <button
                type="button"
                onClick={() => setPending(p => p.filter(x => x !== e))}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#9CA3AF", fontSize: 12, padding: 0 }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!pending.length || submitting}
        style={{
          width: "100%", padding: "8px 12px", fontSize: 12, fontWeight: 600, borderRadius: 6, border: "none", cursor: pending.length && !submitting ? "pointer" : "not-allowed",
          background: pending.length && !submitting ? "#1E40AF" : "#E5E7EB",
          color: pending.length && !submitting ? "#fff" : "#9CA3AF",
          opacity: submitting ? 0.7 : 1,
        }}
      >
        {submitting ? "⏳ กำลังส่ง..." : "✉ เพิ่มและส่งอีเมล"}
      </button>
    </div>
  );
}
