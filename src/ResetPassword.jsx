import { useEffect, useMemo, useState } from "react";
import { confirmPasswordReset, verifyPasswordResetCode } from "firebase/auth";
import { auth } from "./firebase";

const GOLD = "#D4AF37";

function getResetParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    mode: params.get("mode"),
    oobCode: params.get("oobCode"),
  };
}

export default function ResetPassword() {
  const { oobCode } = useMemo(getResetParams, []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [codeVerified, setCodeVerified] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;

    async function verifyCode() {
      if (!oobCode) {
        setError("ลิงก์ไม่ถูกต้องหรือไม่มีรหัสยืนยัน");
        setLoading(false);
        return;
      }

      try {
        const verifiedEmail = await verifyPasswordResetCode(auth, oobCode);
        if (alive) {
          setEmail(verifiedEmail);
          setCodeVerified(true);
        }
      } catch (err) {
        if (alive) setError(mapResetError(err));
      } finally {
        if (alive) setLoading(false);
      }
    }

    verifyCode();
    return () => { alive = false; };
  }, [oobCode]);

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
      await confirmPasswordReset(auth, oobCode, password);
      setDone(true);
      window.history.replaceState({}, "", window.location.pathname);
    } catch (err) {
      setError(mapResetError(err));
    } finally {
      setSaving(false);
    }
  };

  const onKey = (e) => {
    if (e.key === "Enter" && !loading && !saving && !done) handleSubmit();
  };

  return (
    <div style={S.container}>
      <div style={S.card}>
        <img
          src="https://img1.pic.in.th/images/logo-tss-03.png"
          alt="TSS Logo"
          style={S.logo}
          onError={e => { e.target.style.display = "none"; e.target.nextSibling.style.display = "flex"; }}
        />
        <div style={{ ...S.logoFallback, display: "none" }}>
          <span style={{ fontSize: 28, color: GOLD, fontWeight: 700 }}>E</span>
        </div>

        <h2 style={S.title}>ตั้งรหัสผ่านใหม่</h2>

        {loading && <div style={S.info}>กำลังตรวจสอบลิงก์...</div>}
        {error && <div style={S.error}>{error}</div>}

        {!loading && codeVerified && !done && !error && (
          <div style={S.info}>
            บัญชี: <strong>{email}</strong>
          </div>
        )}

        {!loading && codeVerified && !done && (
          <>
            <input
              style={S.input}
              type="password"
              placeholder="รหัสผ่านใหม่"
              value={password}
              onChange={e => { setPassword(e.target.value); setError(""); }}
              onKeyDown={onKey}
            />
            <input
              style={S.input}
              type="password"
              placeholder="ยืนยันรหัสผ่านใหม่"
              value={confirm}
              onChange={e => { setConfirm(e.target.value); setError(""); }}
              onKeyDown={onKey}
            />
            <button style={S.button} onClick={handleSubmit} disabled={saving || !oobCode}>
              {saving ? "กำลังบันทึก..." : "บันทึกรหัสผ่านใหม่"}
            </button>
          </>
        )}

        {done && (
          <>
            <div style={S.success}>ตั้งรหัสผ่านใหม่สำเร็จแล้ว</div>
            <button style={S.button} onClick={() => window.location.assign("/")}>
              กลับหน้า Login
            </button>
          </>
        )}

        {!done && (
          <button style={S.link} onClick={() => window.location.assign("/")}>
            กลับหน้า Login
          </button>
        )}
      </div>
    </div>
  );
}

function mapResetError(err) {
  const code = err?.code || err?.message;
  return {
    "auth/expired-action-code": "ลิงก์หมดอายุแล้ว กรุณาขอลิงก์ใหม่จากหน้า Login",
    "auth/invalid-action-code": "ลิงก์ไม่ถูกต้องหรือถูกใช้งานไปแล้ว",
    "auth/user-disabled": "บัญชีนี้ถูกปิดใช้งาน กรุณาติดต่อ Admin",
    "auth/user-not-found": "ไม่พบบัญชีนี้ในระบบ",
    "auth/weak-password": "รหัสผ่านไม่ปลอดภัยพอ กรุณาตั้งใหม่อย่างน้อย 6 ตัวอักษร",
  }[code] || "ไม่สามารถตั้งรหัสผ่านใหม่ได้ กรุณาขอลิงก์ใหม่อีกครั้ง";
}

const S = {
  container: { height: "100vh", display: "flex", justifyContent: "center", alignItems: "center", background: "#000", fontFamily: "'Noto Sans Thai','Sarabun',sans-serif" },
  card: { background: "#fff", padding: "40px", borderRadius: "16px", width: "360px", maxWidth: "calc(100vw - 32px)", display: "flex", flexDirection: "column", gap: "14px", textAlign: "center", boxShadow: "0 20px 60px rgba(0,0,0,.5)", boxSizing: "border-box" },
  logo: { width: "120px", margin: "0 auto 4px", objectFit: "contain" },
  logoFallback: { width: 56, height: 56, borderRadius: 12, background: "#111", margin: "0 auto 4px", alignItems: "center", justifyContent: "center" },
  title: { fontSize: "20px", fontWeight: "700", color: "#111", margin: 0 },
  input: { padding: "12px", borderRadius: "8px", border: "1px solid #ddd", fontSize: "14px", fontFamily: "inherit", outline: "none" },
  button: { padding: "13px", borderRadius: "8px", border: "none", background: GOLD, color: "#000", fontWeight: "700", fontSize: "14px", cursor: "pointer", fontFamily: "inherit" },
  link: { background: "none", border: "none", color: "#6B7280", fontSize: "12px", cursor: "pointer", fontFamily: "inherit", textDecoration: "underline", padding: 0 },
  error: { background: "#FFF1F1", border: "1px solid #FECACA", borderRadius: "7px", padding: "10px 12px", fontSize: "12px", color: "#991B1B", textAlign: "left", lineHeight: 1.6 },
  success: { background: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: "7px", padding: "10px 12px", fontSize: "12px", color: "#065F46", textAlign: "center", lineHeight: 1.7 },
  info: { background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: "7px", padding: "10px 12px", fontSize: "12px", color: "#374151", textAlign: "left", lineHeight: 1.6 },
};
