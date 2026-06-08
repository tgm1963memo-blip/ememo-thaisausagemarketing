import { useState } from "react";
import { updatePassword } from "firebase/auth";
import { ref, update } from "firebase/database";
import { auth, db, DATA_PATH } from "./firebase";

const GOLD = "#D4AF37";

export default function ChangePasswordModal({ user, showToast }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (password.length < 6) {
      setError("รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร");
      return;
    }
    if (password !== confirm) {
      setError("รหัสผ่านทั้งสองช่องไม่ตรงกัน");
      return;
    }

    setError("");
    setSaving(true);
    try {
      await updatePassword(auth.currentUser, password);
      if (user?.id) {
        await update(ref(db, `${DATA_PATH}/users/${user.id}`), { mustChangePassword: false });
      }
      showToast?.("เปลี่ยนรหัสผ่านสำเร็จ — ยินดีต้อนรับสู่ E-Memo");
    } catch (err) {
      const msg = {
        "auth/requires-recent-login": "กรุณาออกจากระบบแล้วเข้าใหม่ หรือใช้ลิงก์ตั้งรหัสผ่านจากอีเมล",
        "auth/weak-password": "รหัสผ่านไม่ปลอดภัยพอ กรุณาตั้งใหม่อย่างน้อย 6 ตัวอักษร",
      }[err.code] || "ไม่สามารถเปลี่ยนรหัสผ่านได้ — กรุณาลองใหม่";
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const onKey = (e) => {
    if (e.key === "Enter" && !saving) handleSubmit();
  };

  return (
    <div style={S.overlay}>
      <div style={S.card}>
        <img
          src="https://img1.pic.in.th/images/logo-tss-03.png"
          alt="TSS Logo"
          style={S.logo}
          onError={e => { e.target.style.display = "none"; }}
        />
        <h2 style={S.title}>ตั้งรหัสผ่านใหม่</h2>
        <p style={S.subtitle}>
          สวัสดี {user?.name || user?.email} — กรุณาเปลี่ยนรหัสผ่านก่อนเข้าใช้งานครั้งแรก
        </p>

        {error && <div style={S.error}>{error}</div>}

        <input
          style={S.input}
          type="password"
          placeholder="รหัสผ่านใหม่"
          value={password}
          onChange={e => { setPassword(e.target.value); setError(""); }}
          onKeyDown={onKey}
          autoComplete="new-password"
        />
        <input
          style={S.input}
          type="password"
          placeholder="ยืนยันรหัสผ่านใหม่"
          value={confirm}
          onChange={e => { setConfirm(e.target.value); setError(""); }}
          onKeyDown={onKey}
          autoComplete="new-password"
        />
        <button style={S.button} onClick={handleSubmit} disabled={saving}>
          {saving ? "กำลังบันทึก..." : "บันทึกและเข้าใช้งาน"}
        </button>
      </div>
    </div>
  );
}

const S = {
  overlay: {
    position: "fixed", inset: 0, zIndex: 200,
    display: "flex", alignItems: "center", justifyContent: "center",
    background: "#000", fontFamily: "'Noto Sans Thai','Sarabun',sans-serif",
  },
  card: {
    background: "#fff", padding: "40px", borderRadius: "16px",
    width: "360px", maxWidth: "calc(100vw - 32px)",
    display: "flex", flexDirection: "column", gap: "14px",
    textAlign: "center", boxShadow: "0 20px 60px rgba(0,0,0,.5)", boxSizing: "border-box",
  },
  logo: { width: "120px", margin: "0 auto 4px", objectFit: "contain" },
  title: { fontSize: "20px", fontWeight: "700", color: "#111", margin: 0 },
  subtitle: { fontSize: "12px", color: "#6B7280", margin: 0, lineHeight: 1.6 },
  input: {
    padding: "12px", borderRadius: "8px", border: "1px solid #ddd",
    fontSize: "14px", fontFamily: "inherit", outline: "none",
  },
  button: {
    padding: "13px", borderRadius: "8px", border: "none",
    background: GOLD, color: "#000", fontWeight: "700",
    fontSize: "14px", cursor: "pointer", fontFamily: "inherit",
  },
  error: {
    background: "#FFF1F1", border: "1px solid #FECACA", borderRadius: "7px",
    padding: "10px 12px", fontSize: "12px", color: "#991B1B", textAlign: "left",
  },
};
