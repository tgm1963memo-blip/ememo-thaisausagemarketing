import { useState } from "react";
import { auth } from "./firebase";
import { signInWithEmailAndPassword } from "firebase/auth";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) {
      alert("กรุณากรอก Email และ Password");
      return;
    }
    try {
      setLoading(true);
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      alert("Email หรือ Password ไม่ถูกต้อง");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      {/* แถบสีเยอรมันตกแต่งด้านบน */}
      <div style={styles.topBar}>
        <div style={{...styles.barSeg, background: '#FF0000'}}></div>
        <div style={{...styles.barSeg, background: '#000000'}}></div>
        <div style={{...styles.barSeg, background: '#D4AF37'}}></div>
      </div>
      
      <div style={styles.card}>
        {/* โลโก้ TGM จาก folder public */}
        <img 
          src="/TGM-01-scaled.jpg" 
          alt="TGM Logo" 
          style={styles.logo} 
          onError={(e) => { e.target.style.display = 'none'; }}
        />
        
        <h2 style={styles.title}>E-Memo Login</h2>

        <div style={styles.inputGroup}>
          <label style={styles.label}>Email</label>
          <input
            style={styles.input}
            type="email"
            placeholder="example@tgm.co.th"
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div style={styles.inputGroup}>
          <label style={styles.label}>Password</label>
          <input
            style={styles.input}
            type="password"
            placeholder="••••••••"
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <button style={styles.button} onClick={handleLogin} disabled={loading}>
          {loading ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
        </button>
        
        <div style={styles.footerText}>
          Thai-German Meat Product Since 1963
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    height: "100vh",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    background: "#000",
    fontFamily: "'Noto Sans Thai', sans-serif",
    position: 'relative'
  },
  topBar: { position: 'absolute', top: 0, left: 0, width: '100%', height: '6px', display: 'flex' },
  barSeg: { flex: 1 },
  card: {
    background: "#fff",
    padding: "40px 30px",
    borderRadius: "16px",
    width: "350px",
    boxShadow: "0 10px 40px rgba(212, 175, 55, 0.2)",
    display: "flex",
    flexDirection: "column",
    gap: "18px"
  },
  logo: { width: "140px", height: "auto", alignSelf: "center", marginBottom: "5px" },
  title: { textAlign: "center", margin: "0", fontSize: "20px", fontWeight: "700", color: "#000" },
  inputGroup: { display: "flex", flexDirection: "column", gap: "5px" },
  label: { fontSize: "13px", fontWeight: "600", color: "#666" },
  input: { padding: "12px", borderRadius: "8px", border: "1px solid #ddd", outline: "none" },
  button: {
    padding: "12px",
    borderRadius: "8px",
    border: "none",
    background: "#D4AF37",
    color: "#000",
    fontSize: "15px",
    fontWeight: "700",
    cursor: "pointer",
    marginTop: "10px"
  },
  footerText: { textAlign: "center", fontSize: "11px", color: "#999", marginTop: "5px" }
};