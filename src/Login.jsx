import { useState } from "react";
import { auth } from "./firebase";
import { signInWithEmailAndPassword, sendPasswordResetEmail } from "firebase/auth";

const NAVY     = "#1A2F6B";
const RED      = "#CC2229";
const LOGO_URL = "/logo-tss-03.png";

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

  const IS = {
    width:"100%", padding:"11px 14px", marginBottom:12,
    background:"#fff", color:"#111",
    border:"1.5px solid #E5E7EB", borderRadius:8,
    fontSize:14, fontFamily:"inherit",
    outline:"none", boxSizing:"border-box", transition:"border-color .15s",
  };

  return (
    <div style={{
      minHeight:"100vh",
      background:`linear-gradient(150deg, ${NAVY} 0%, #0d1e55 60%, #1a0a2e 100%)`,
      display:"flex", alignItems:"center", justifyContent:"center",
      fontFamily:"'Noto Sans Thai','Sarabun',sans-serif", padding:16, position:"relative",
    }}>
      {/* Decorative circles */}
      <div style={{position:"fixed",top:-120,right:-120,width:400,height:400,borderRadius:"50%",border:`2px solid rgba(204,34,41,.15)`,pointerEvents:"none"}}/>
      <div style={{position:"fixed",top:-80,right:-80,width:300,height:300,borderRadius:"50%",border:`2px solid rgba(204,34,41,.1)`,pointerEvents:"none"}}/>
      <div style={{position:"fixed",bottom:-100,left:-100,width:350,height:350,borderRadius:"50%",border:`1px solid rgba(255,255,255,.06)`,pointerEvents:"none"}}/>

      <div style={{
        width:400, background:"#fff", borderRadius:20,
        overflow:"hidden", boxShadow:"0 32px 80px rgba(0,0,0,.45)",
        position:"relative", zIndex:1,
      }}>

        {/* Header banner */}
        <div style={{
          background:`linear-gradient(135deg, ${NAVY} 0%, #243d8a 100%)`,
          padding:"32px 32px 28px", textAlign:"center",
          borderBottom:`4px solid ${RED}`,
        }}>
          <img src={LOGO_URL} alt="Thai Sausage"
            style={{
              width:100, height:100, objectFit:"contain",
              borderRadius:"50%", background:"#fff", padding:6,
              boxShadow:"0 4px 20px rgba(0,0,0,.3)", marginBottom:14,
            }}
            onError={e=>{e.target.style.display="none";}}
          />
          <div style={{fontSize:15,fontWeight:700,color:"#fff",letterSpacing:.3}}>
            บริษัท ไทยซอสเซส มาร์เก็ตติ้ง จำกัด
          </div>
          <div style={{fontSize:12,color:"rgba(255,255,255,.65)",marginTop:3}}>
            E-Memo System · EST. 1963
          </div>
        </div>

        {/* Tabs */}
        <div style={{display:"flex",borderBottom:"1px solid #F3F4F6"}}>
          {[["login","เข้าสู่ระบบ"],["reset","รีเซ็ตรหัสผ่าน"]].map(([k,l])=>{
            const active = (k==="reset")===resetMode;
            return (
              <button key={k}
                onClick={()=>{setResetMode(k==="reset");setError("");setResetSent(false);}}
                style={{flex:1,padding:"12px 0",background:"none",border:"none",
                  cursor:"pointer",fontSize:13,fontWeight:active?600:400,
                  fontFamily:"inherit",color:active?RED:"#9CA3AF",
                  borderBottom:`2px solid ${active?RED:"transparent"}`,
                  transition:"all .15s"}}>
                {l}
              </button>
            );
          })}
        </div>

        <div style={{padding:"24px 28px 28px"}}>
          {error&&(
            <div style={{background:"#FEF2F2",border:"1px solid #FECACA",borderRadius:8,
              padding:"10px 14px",marginBottom:14,fontSize:12,color:"#991B1B"}}>
              ⚠ {error}
            </div>
          )}
          {resetSent&&(
            <div style={{background:"#ECFDF5",border:"1px solid #A7F3D0",borderRadius:8,
              padding:"12px 14px",marginBottom:14,fontSize:12,color:"#065F46",lineHeight:1.7}}>
              ✅ ส่งลิงก์ไปที่ <strong>{email}</strong> แล้ว<br/>
              กรุณาตรวจสอบกล่องจดหมาย (รวมถึง Spam / Junk)
            </div>
          )}

          {!resetMode ? (
            <>
              <label style={{display:"block",color:"#374151",fontSize:11,marginBottom:4,fontWeight:600}}>อีเมล์</label>
              <input type="email" value={email}
                onChange={e=>{setEmail(e.target.value);setError("");}}
                onKeyDown={onKey} placeholder="your@thaisauces.co.th" style={IS}
                onFocus={e=>e.target.style.borderColor=NAVY}
                onBlur={e=>e.target.style.borderColor="#E5E7EB"}/>

              <label style={{display:"block",color:"#374151",fontSize:11,marginBottom:4,fontWeight:600}}>รหัสผ่าน</label>
              <input type="password" value={password}
                onChange={e=>{setPassword(e.target.value);setError("");}}
                onKeyDown={onKey} placeholder="••••••••" style={IS}
                onFocus={e=>e.target.style.borderColor=NAVY}
                onBlur={e=>e.target.style.borderColor="#E5E7EB"}/>

              <button onClick={handleLogin} disabled={loading} style={{
                width:"100%",padding:"13px",marginTop:4,
                background:loading?"#6B7280":NAVY,color:"#fff",
                border:"none",borderRadius:8,fontSize:14,fontWeight:700,
                cursor:loading?"not-allowed":"pointer",fontFamily:"inherit",
                transition:"background .15s",
              }}>
                {loading?"กำลังเข้าสู่ระบบ...":"เข้าสู่ระบบ"}
              </button>

              <button onClick={()=>{setResetMode(true);setError("");}}
                style={{width:"100%",marginTop:12,background:"none",border:"none",
                  color:"#9CA3AF",fontSize:12,cursor:"pointer",
                  fontFamily:"inherit",textDecoration:"underline"}}>
                ลืมรหัสผ่าน / เข้าใช้งานครั้งแรก?
              </button>
            </>
          ) : (
            <>
              <div style={{background:"#EFF6FF",border:"1px solid #BFDBFE",borderRadius:8,
                padding:"10px 14px",marginBottom:14,fontSize:12,color:"#1E40AF",lineHeight:1.7}}>
                <strong>📌 เข้าใช้งานครั้งแรก?</strong><br/>
                กรอกอีเมล์แล้วกด "ส่งลิงก์" — ระบบจะส่งลิงก์ตั้งรหัสผ่านมาให้ทางอีเมล์
              </div>

              <label style={{display:"block",color:"#374151",fontSize:11,marginBottom:4,fontWeight:600}}>อีเมล์</label>
              <input type="email" value={email}
                onChange={e=>{setEmail(e.target.value);setError("");}}
                onKeyDown={onKey} placeholder="your@thaisauces.co.th" style={IS}
                onFocus={e=>e.target.style.borderColor=NAVY}
                onBlur={e=>e.target.style.borderColor="#E5E7EB"}/>

              {!resetSent ? (
                <button onClick={handleReset} disabled={resetLoading} style={{
                  width:"100%",padding:"13px",
                  background:resetLoading?"#6B7280":RED,color:"#fff",
                  border:"none",borderRadius:8,fontSize:14,fontWeight:700,
                  cursor:resetLoading?"not-allowed":"pointer",fontFamily:"inherit",
                }}>
                  {resetLoading?"กำลังส่ง...":"📧 ส่งลิงก์ตั้ง/รีเซ็ตรหัสผ่าน"}
                </button>
              ) : (
                <button onClick={()=>{setResetMode(false);setResetSent(false);setError("");}}
                  style={{width:"100%",padding:"13px",background:"#059669",color:"#fff",
                    border:"none",borderRadius:8,fontSize:13,fontWeight:700,
                    cursor:"pointer",fontFamily:"inherit"}}>
                  ✅ ส่งแล้ว — กลับหน้าเข้าสู่ระบบ
                </button>
              )}

              <button onClick={()=>{setResetMode(false);setError("");}}
                style={{width:"100%",marginTop:10,background:"none",border:"none",
                  color:"#9CA3AF",fontSize:12,cursor:"pointer",
                  fontFamily:"inherit",textDecoration:"underline"}}>
                ← กลับหน้า Login
              </button>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{background:"#F9FAFB",borderTop:"1px solid #F3F4F6",
          padding:"10px 28px 14px",textAlign:"center"}}>
          <div style={{fontSize:11,color:"#9CA3AF"}}>
            Thai Sausage Marketing Co., Ltd. · EST. 1963
          </div>
          <div style={{fontSize:10,color:"#D1D5DB",marginTop:2}}>
            ติดต่อ Super Admin เพื่อขอบัญชีผู้ใช้งาน
          </div>
        </div>
      </div>
    </div>
  );
}
