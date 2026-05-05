import { useState } from "react";
import { auth } from "./firebase";
import { signInWithEmailAndPassword } from "firebase/auth";

const GOLD = "#D4AF37";

// ── ส่ง reset email ผ่าน SMTP บริษัท (noreply.ememo@tgm.co.th) ──────────────
async function sendResetEmail(email) {
  try {
    const r = await fetch("/api/send-reset-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, isNew: false }),
    });
    const d = await r.json();
    if (r.ok && d.success) return d;
    throw new Error(d.error || "ส่งไม่สำเร็จ");
  } catch (smtpErr) {
    // Fallback: Firebase REST API
    const apiKey = auth.app.options.apiKey;
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${apiKey}`,
      { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestType: "PASSWORD_RESET", email }) }
    );
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data;
  }
}

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
      await sendResetEmail(email.trim());
      setResetSent(true);
    } catch (err) {
      const errMsg = err.message || "";
      const msg = {
        "auth/user-not-found":         "ไม่พบบัญชีนี้ในระบบ — กรุณาติดต่อ Admin เพื่อสร้างบัญชี",
        "auth/invalid-email":          "รูปแบบ Email ไม่ถูกต้อง",
        "auth/too-many-requests":      "ส่งบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่",
        "USER_NOT_FOUND":              "ไม่พบบัญชีนี้ในระบบ — กรุณาติดต่อ Admin เพื่อสร้างบัญชี",
      }[errMsg] || `ส่งไม่สำเร็จ (${errMsg}) — กรุณาติดต่อ Admin`;
      setError(msg);
    } finally { setResetLoading(false); }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") resetMode ? handleReset() : handleLogin();
  };

  return (
    <div style={S.container}>
      <div style={S.card}>
        <img src="https://img1.pic.in.th/images/logo-tss-03.png" alt="TSS Logo" style={S.logo}
          onError={e => { e.target.style.display = "none"; e.target.nextSibling.style.display = "flex"; }}/>
        <div style={{ ...S.logoFallback, display: "none" }}>
          <span style={{ fontSize: 28, color: GOLD, fontWeight: 700 }}>E</span>
        </div>

        <h2 style={S.title}>E-Memo {resetMode ? "รีเซ็ตรหัสผ่าน" : "Login"}</h2>

        {error && <div style={S.error}>{error}</div>}

        {resetSent && (
          <div style={S.success}>
            ✅ ส่งลิงก์ไปที่ <strong>{email}</strong> แล้ว<br/>
            <span style={{fontSize:12}}>ส่งจาก <strong>noreply.ememo@tgm.co.th</strong></span><br/>
            กรุณาตรวจสอบกล่องจดหมาย (รวมถึง Spam / Junk)<br/>
            <span style={{fontSize:11,color:"#047857",marginTop:4,display:"block"}}>ลิงก์มีอายุ 1 ชั่วโมง</span>
          </div>
        )}

        <input style={S.input} placeholder="Email" type="email" value={email}
          onChange={e => { setEmail(e.target.value); setError(""); }} onKeyDown={handleKeyDown}/>

        {!resetMode && (
          <input style={S.input} type="password" placeholder="Password" value={password}
            onChange={e => { setPassword(e.target.value); setError(""); }} onKeyDown={handleKeyDown}/>
        )}

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

        <button style={S.link} onClick={() => { setResetMode(r => !r); setError(""); setResetSent(false); }}>
          {resetMode ? "← กลับหน้า Login" : "ลืมรหัสผ่าน / เข้าใช้ครั้งแรก?"}
        </button>

        {resetMode && !resetSent && (
          <p style={S.hint}>
            กรอก Email แล้วกด "ส่งลิงก์" — ระบบส่งจาก <strong>noreply.ememo@tgm.co.th</strong> มาให้ทางอีเมล์
          </p>
        )}
      </div>
    </div>
  );
}

const S = {
  container: { height:"100vh",display:"flex",justifyContent:"center",alignItems:"center",background:"#000",fontFamily:"'Noto Sans Thai','Sarabun',sans-serif" },
  card:      { background:"#fff",padding:"40px",borderRadius:"16px",width:"340px",display:"flex",flexDirection:"column",gap:"14px",textAlign:"center",boxShadow:"0 20px 60px rgba(0,0,0,.5)" },
  logo:        { width:"120px",margin:"0 auto 4px",objectFit:"contain" },
  logoFallback:{ width:56,height:56,borderRadius:12,background:"#111",margin:"0 auto 4px",alignItems:"center",justifyContent:"center" },
  title:       { fontSize:"20px",fontWeight:"700",color:"#111",margin:0 },
  input:  { padding:"12px",borderRadius:"8px",border:"1px solid #ddd",fontSize:"14px",fontFamily:"inherit",outline:"none",transition:"border-color .15s" },
  button: { padding:"13px",borderRadius:"8px",border:"none",background:"#D4AF37",color:"#000",fontWeight:"700",fontSize:"14px",cursor:"pointer",fontFamily:"inherit",transition:"opacity .15s" },
  link:   { background:"none",border:"none",color:"#6B7280",fontSize:"12px",cursor:"pointer",fontFamily:"inherit",textDecoration:"underline",padding:0 },
  error:  { background:"#FFF1F1",border:"1px solid #FECACA",borderRadius:"7px",padding:"10px 12px",fontSize:"12px",color:"#991B1B",textAlign:"left" },
  success:{ background:"#ECFDF5",border:"1px solid #A7F3D0",borderRadius:"7px",padding:"10px 12px",fontSize:"12px",color:"#065F46",textAlign:"left",lineHeight:1.7 },
  hint:   { fontSize:"11px",color:"#9CA3AF",margin:0,lineHeight:1.6,textAlign:"left" },
};
