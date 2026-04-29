import { useState } from "react";
import { auth } from "./firebase";
import { signInWithEmailAndPassword, sendPasswordResetEmail } from "firebase/auth";

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
      const msgs = {
        "auth/invalid-credential": "Email หรือ Password ไม่ถูกต้อง",
        "auth/user-not-found":     "ไม่พบบัญชีนี้ในระบบ",
        "auth/wrong-password":     "Password ไม่ถูกต้อง",
        "auth/too-many-requests":  "ลองผิดหลายครั้ง กรุณารอสักครู่",
        "auth/invalid-email":      "รูปแบบ Email ไม่ถูกต้อง",
      };
      setError(msgs[err.code] || "เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่");
    } finally { setLoading(false); }
  };

  const handleReset = async () => {
    if (!email) { setError("กรุณากรอก Email ก่อน"); return; }
    setError(""); setResetLoading(true);
    try {
      await sendPasswordResetEmail(auth, email);
      setResetSent(true);
    } catch (err) {
      const msgs = {
        "auth/user-not-found": "ไม่พบบัญชีนี้ กรุณาติดต่อ Admin",
        "auth/invalid-email":  "รูปแบบ Email ไม่ถูกต้อง",
      };
      setError(msgs[err.code] || "ส่งไม่สำเร็จ กรุณาลองใหม่");
    } finally { setResetLoading(false); }
  };

  const onKey = e => { if (e.key === "Enter") resetMode ? handleReset() : handleLogin(); };

  return (
    <div style={{
      minHeight:"100vh", display:"flex",
      fontFamily:"'Noto Sans Thai','Sarabun',sans-serif",
    }}>
      {/* Left panel — branding */}
      <div style={{
        flex:1, background:"#1E3A5F",
        display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
        padding:48,
      }}>
        <img src="/logo-tss-03.png" alt="Thai Sausage"
          style={{ width:160, height:160, objectFit:"contain",
            borderRadius:"50%", background:"#fff", padding:12,
            boxShadow:"0 8px 32px rgba(0,0,0,.3)", marginBottom:24 }}
          onError={e=>e.target.style.display="none"}
        />
        <div style={{fontSize:22,fontWeight:700,color:"#fff",textAlign:"center",lineHeight:1.4}}>
          บริษัท ไทยซอสเซส<br/>มาร์เก็ตติ้ง จำกัด
        </div>
        <div style={{fontSize:13,color:"rgba(255,255,255,.55)",marginTop:8}}>
          THAI SAUSAGE MARKETING CO., LTD.
        </div>
        <div style={{fontSize:12,color:"rgba(255,255,255,.35)",marginTop:4}}>
          EST. 1963
        </div>
        {/* Decorative line */}
        <div style={{width:40,height:2,background:"#C0392B",borderRadius:2,marginTop:24}}/>
      </div>

      {/* Right panel — form */}
      <div style={{
        width:420, background:"#fff",
        display:"flex", flexDirection:"column", justifyContent:"center",
        padding:"48px 40px", boxShadow:"-4px 0 20px rgba(0,0,0,.06)",
      }}>
        <div style={{fontSize:24,fontWeight:700,color:"#111827",marginBottom:4}}>
          {resetMode ? "รีเซ็ตรหัสผ่าน" : "เข้าสู่ระบบ"}
        </div>
        <div style={{fontSize:13,color:"#9CA3AF",marginBottom:28}}>
          {resetMode ? "กรอกอีเมล์เพื่อรับลิงก์ตั้งรหัสผ่าน" : "E-Memo System"}
        </div>

        {/* Error */}
        {error && (
          <div style={{background:"#FEF2F2",border:"1px solid #FECACA",borderRadius:8,
            padding:"10px 14px",marginBottom:16,fontSize:13,color:"#991B1B"}}>
            {error}
          </div>
        )}
        {resetSent && (
          <div style={{background:"#ECFDF5",border:"1px solid #A7F3D0",borderRadius:8,
            padding:"12px 14px",marginBottom:16,fontSize:13,color:"#065F46",lineHeight:1.6}}>
            ✅ ส่งลิงก์ไปที่ <strong>{email}</strong> แล้ว<br/>
            ตรวจสอบกล่องจดหมาย (รวมถึง Spam)
          </div>
        )}

        {!resetMode ? (<>
          <label style={{display:"block",fontSize:12,fontWeight:600,color:"#374151",marginBottom:5}}>อีเมล์</label>
          <input type="email" value={email}
            onChange={e=>{setEmail(e.target.value);setError("");}}
            onKeyDown={onKey} placeholder="your@thaisauces.co.th"
            style={{width:"100%",padding:"11px 14px",marginBottom:14,border:"1.5px solid #E5E7EB",
              borderRadius:8,fontSize:14,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}
            onFocus={e=>e.target.style.borderColor="#2563EB"}
            onBlur={e=>e.target.style.borderColor="#E5E7EB"}/>

          <label style={{display:"block",fontSize:12,fontWeight:600,color:"#374151",marginBottom:5}}>รหัสผ่าน</label>
          <input type="password" value={password}
            onChange={e=>{setPassword(e.target.value);setError("");}}
            onKeyDown={onKey} placeholder="••••••••"
            style={{width:"100%",padding:"11px 14px",marginBottom:20,border:"1.5px solid #E5E7EB",
              borderRadius:8,fontSize:14,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}
            onFocus={e=>e.target.style.borderColor="#2563EB"}
            onBlur={e=>e.target.style.borderColor="#E5E7EB"}/>

          <button onClick={handleLogin} disabled={loading} style={{
            width:"100%",padding:"12px",background:loading?"#93C5FD":"#2563EB",
            color:"#fff",border:"none",borderRadius:8,fontSize:14,fontWeight:700,
            cursor:loading?"not-allowed":"pointer",fontFamily:"inherit",transition:"background .15s",
          }}>
            {loading ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
          </button>

          <button onClick={()=>{setResetMode(true);setError("");}}
            style={{width:"100%",marginTop:12,background:"none",border:"none",
              color:"#6B7280",fontSize:12,cursor:"pointer",fontFamily:"inherit",
              textDecoration:"underline",padding:0}}>
            ลืมรหัสผ่าน / เข้าใช้งานครั้งแรก?
          </button>
        </>) : (<>
          <div style={{background:"#EFF6FF",border:"1px solid #BFDBFE",borderRadius:8,
            padding:"11px 14px",marginBottom:16,fontSize:12,color:"#1E40AF",lineHeight:1.7}}>
            <strong>📌 เข้าใช้งานครั้งแรก?</strong><br/>
            กรอกอีเมล์แล้วกด "ส่งลิงก์" — ระบบส่งลิงก์ตั้งรหัสผ่านมาให้ทางอีเมล์
          </div>

          <label style={{display:"block",fontSize:12,fontWeight:600,color:"#374151",marginBottom:5}}>อีเมล์</label>
          <input type="email" value={email}
            onChange={e=>{setEmail(e.target.value);setError("");}}
            onKeyDown={onKey} placeholder="your@thaisauces.co.th"
            style={{width:"100%",padding:"11px 14px",marginBottom:20,border:"1.5px solid #E5E7EB",
              borderRadius:8,fontSize:14,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}
            onFocus={e=>e.target.style.borderColor="#2563EB"}
            onBlur={e=>e.target.style.borderColor="#E5E7EB"}/>

          {!resetSent ? (
            <button onClick={handleReset} disabled={resetLoading} style={{
              width:"100%",padding:"12px",background:resetLoading?"#93C5FD":"#2563EB",
              color:"#fff",border:"none",borderRadius:8,fontSize:14,fontWeight:700,
              cursor:resetLoading?"not-allowed":"pointer",fontFamily:"inherit",
            }}>
              {resetLoading ? "กำลังส่ง..." : "📧 ส่งลิงก์ตั้ง/รีเซ็ตรหัสผ่าน"}
            </button>
          ) : (
            <button onClick={()=>{setResetMode(false);setResetSent(false);setError("");}}
              style={{width:"100%",padding:"12px",background:"#059669",color:"#fff",
                border:"none",borderRadius:8,fontSize:13,fontWeight:700,
                cursor:"pointer",fontFamily:"inherit"}}>
              ✅ ส่งแล้ว — กลับหน้าเข้าสู่ระบบ
            </button>
          )}

          <button onClick={()=>{setResetMode(false);setError("");}}
            style={{width:"100%",marginTop:10,background:"none",border:"none",
              color:"#6B7280",fontSize:12,cursor:"pointer",fontFamily:"inherit",
              textDecoration:"underline",padding:0}}>
            ← กลับหน้า Login
          </button>
        </>)}

        <div style={{marginTop:32,paddingTop:16,borderTop:"1px solid #F3F4F6",
          fontSize:11,color:"#D1D5DB",textAlign:"center"}}>
          ติดต่อ Super Admin เพื่อขอบัญชีผู้ใช้งาน
        </div>
      </div>
    </div>
  );
}
