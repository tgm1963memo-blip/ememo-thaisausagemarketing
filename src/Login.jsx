import { useState } from "react";
import { auth } from "./firebase";
import { signInWithEmailAndPassword, sendPasswordResetEmail } from "firebase/auth";

const GOLD = "#D4AF37";

export default function Login() {
  const [email,        setEmail]        = useState("");
  const [password,     setPassword]     = useState("");
  const [loading,      setLoading]      = useState(false);
  const [resetMode,    setResetMode]    = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetSent,    setResetSent]    = useState(false);
  const [error,        setError]        = useState("");

  const handleLogin = async () => {
    if (!email || !password) { setError("กรุณากรอกข้อมูลให้ครบ"); return; }
    setError(""); setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      const msg = {
        "auth/invalid-credential": "Email หรือ Password ไม่ถูกต้อง",
        "auth/user-not-found":     "ไม่พบบัญชีนี้",
        "auth/wrong-password":     "Password ไม่ถูกต้อง",
        "auth/too-many-requests":  "ลองเข้าสู่ระบบมากเกินไป กรุณารอสักครู่",
        "auth/invalid-email":      "รูปแบบ Email ไม่ถูกต้อง",
      }[err.code] || "Email หรือ Password ไม่ถูกต้อง";
      setError(msg);
    } finally { setLoading(false); }
  };

  const handleReset = async () => {
    if (!email) { setError("กรุณากรอก Email ก่อน"); return; }
    setError(""); setResetLoading(true);
    try {
      await sendPasswordResetEmail(auth, email);
      setResetSent(true);
    } catch (err) {
      const msg = {
        "auth/user-not-found": "ไม่พบบัญชีนี้ กรุณาติดต่อ Admin",
        "auth/invalid-email":  "รูปแบบ Email ไม่ถูกต้อง",
      }[err.code] || "ส่งไม่สำเร็จ กรุณาลองใหม่";
      setError(msg);
    } finally { setResetLoading(false); }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") resetMode ? handleReset() : handleLogin();
  };

  return (
    <div style={S.container}>
      <div style={S.card}>

        {/* Logo — วางไฟล์ TGM-01-scaled.jpg ใน /public/ */}
        <img
          src="https://img1.pic.in.th/images/logo-tss-03.png"
          alt="TSS Logo"
          style={S.logo}
          onError={e => { e.target.style.display = "none"; e.target.nextSibling.style.display = "flex"; }}
        />
        {/* Fallback เมื่อโหลดรูปไม่ได้ */}
        <div style={{ ...S.logoFallback, display: "none" }}>
          <span style={{ fontSize: 28, color: GOLD, fontWeight: 700 }}>E</span>
        </div>

        <h2 style={S.title}>E-Memo {resetMode ? "รีเซ็ตรหัสผ่าน" : "Login"}</h2>

        {/* Error */}
        {error && (
          <div style={S.error}>{error}</div>
        )}

        {/* Reset sent */}
        {resetSent && (
          <div style={S.success}>
            ✅ ส่งลิงก์ไปที่ <strong>{email}</strong> แล้ว<br/>
            กรุณาตรวจสอบกล่องจดหมาย (รวมถึง Spam)
          </div>
        )}

        {/* Email */}
        <input
          style={S.input}
          placeholder="Email"
          type="email"
          value={email}
          onChange={e => { setEmail(e.target.value); setError(""); }}
          onKeyDown={handleKeyDown}
        />

        {/* Password (login mode only) */}
        {!resetMode && (
          <input
            style={S.input}
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => { setPassword(e.target.value); setError(""); }}
            onKeyDown={handleKeyDown}
          />
        )}

        {/* Primary button */}
        {!resetMode ? (
          <button style={S.button} onClick={handleLogin} disabled={loading}>
            {loading ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
          </button>
        ) : !resetSent ? (
          <button style={S.button} onClick={handleReset} disabled={resetLoading}>
            {resetLoading ? "กำลังส่ง..." : "📧 ส่งลิงก์ตั้งรหัสผ่าน"}
          </button>
        ) : (
          <button style={{ ...S.button, background: "#16a34a" }}
            onClick={() => { setResetMode(false); setResetSent(false); setError(""); }}>
            ✅ กลับหน้าเข้าสู่ระบบ
          </button>
        )}

        {/* Toggle reset / login */}
        <button
          style={S.link}
          onClick={() => { setResetMode(r => !r); setError(""); setResetSent(false); }}>
          {resetMode ? "← กลับหน้า Login" : "ลืมรหัสผ่าน / เข้าใช้ครั้งแรก?"}
        </button>

        {/* First-time hint */}
        {resetMode && !resetSent && (
          <p style={S.hint}>
            หากบัญชีถูกสร้างโดย Admin กรอก Email แล้วกดส่งลิงก์ — ระบบจะส่งลิงก์ตั้งรหัสผ่านมาให้ทางอีเมล์
          </p>
        )}
      </div>
    </div>
  );
}

// ── วิธีแก้ปัญหา Logo ไม่แสดง ──────────────────────────────────────────────
// 1. วางไฟล์ TGM-01-scaled.jpg ใน โฟลเดอร์ /public/ ของโปรเจกต์ Vite
//    (เดียวกับไฟล์ index.html)
// 2. ถ้าใช้ Create React App ให้วางใน /public/ เช่นกัน
// 3. path ที่ใช้ใน src="/TGM-01-scaled.jpg" จะอ้างอิงจาก public/ โดยอัตโนมัติ

const S = {
  container: {
    height: "100vh", display: "flex", justifyContent: "center",
    alignItems: "center", background: "#000",
    fontFamily: "'Noto Sans Thai', 'Sarabun', sans-serif",
  },
  card: {
    background: "#fff", padding: "40px", borderRadius: "16px",
    width: "340px", display: "flex", flexDirection: "column",
    gap: "14px", textAlign: "center",
    boxShadow: "0 20px 60px rgba(0,0,0,.5)",
  },
  logo: {
    width: "120px", margin: "0 auto 4px",
    objectFit: "contain",
  },
  logoFallback: {
    width: 56, height: 56, borderRadius: 12,
    background: "#111", margin: "0 auto 4px",
    alignItems: "center", justifyContent: "center",
  },
  title: {
    fontSize: "20px", fontWeight: "700",
    color: "#111", margin: 0,
  },
  input: {
    padding: "12px", borderRadius: "8px",
    border: "1px solid #ddd", fontSize: "14px",
    fontFamily: "inherit", outline: "none",
    transition: "border-color .15s",
  },
  button: {
    padding: "13px", borderRadius: "8px", border: "none",
    background: "#D4AF37", color: "#000",
    fontWeight: "700", fontSize: "14px",
    cursor: "pointer", fontFamily: "inherit",
    transition: "opacity .15s",
  },
  link: {
    background: "none", border: "none",
    color: "#6B7280", fontSize: "12px",
    cursor: "pointer", fontFamily: "inherit",
    textDecoration: "underline", padding: 0,
  },
  error: {
    background: "#FFF1F1", border: "1px solid #FECACA",
    borderRadius: "7px", padding: "10px 12px",
    fontSize: "12px", color: "#991B1B", textAlign: "left",
  },
  success: {
    background: "#ECFDF5", border: "1px solid #A7F3D0",
    borderRadius: "7px", padding: "10px 12px",
    fontSize: "12px", color: "#065F46", textAlign: "left",
    lineHeight: 1.6,
  },
  hint: {
    fontSize: "11px", color: "#9CA3AF",
    margin: 0, lineHeight: 1.6, textAlign: "left",
  },
};
