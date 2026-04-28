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
      {/* แถบสีด้านบนสุด */}
      <div style={styles.topBar}>
        <div style={{...styles.barSeg, background: '#FF0000'}}></div>
        <div style={{...styles.barSeg, background: '#000000'}}></div>
        <div style={{...styles.barSeg, background: '#D4AF37'}}></div>
      </div>
      
      <div style={styles.card}>
        {/* แสดงโลโก้ TGM */}
        <img 
          src="/path/to/logo_tgm.png"  // ** กรุณาแก้ Path ให้ถูกต้อง **
          alt="TGM Logo" 
          style={styles.logo} 
        />
        
        <h2 style={styles.title}>E-Memo Login</h2>

        <div style={styles.inputGroup}>
          <label style={styles.label}>Email</label>
          <input
            style={styles.input}
            type="email"
            placeholder="your.email@thaisauces.co.th"
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
          {loading ? "กำลังตรวจสอบ..." : "เข้าสู่ระบบ"}
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
    background: "#000000", // พื้นหลังดำตามโลโก้
    fontFamily: "'Noto Sans Thai', sans-serif",
    position: 'relative'
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '8px',
    display: 'flex',
  },
  barSeg: {
    flex: 1,
  },
  card: {
    background: "#fff",
    padding: "40px 30px",
    borderRadius: "16px",
    width: "360px",
    boxShadow: "0 15px 35px rgba(212, 175, 55, 0.15)", // Shadow สีทองจางๆ
    display: "flex",
    flexDirection: "column",
    gap: "20px",
    border: "1px solid #eee"
  },
  logo: {
    width: "120px",
    height: "auto",
    alignSelf: "center",
    marginBottom: "10px"
  },
  title: {
    textAlign: "center",
    margin: "0 0 15px 0",
    fontSize: "22px",
    fontWeight: "700",
    color: "#000"
  },
  inputGroup: {
    display: "flex",
    flexDirection: "column",
    gap: "5px"
  },
  label: {
    fontSize: "13px",
    fontWeight: "600",
    color: "#555",
    marginLeft: "2px"
  },
  input: {
    padding: "12px 15px",
    borderRadius: "8px",
    border: "1px solid #ddd",
    fontSize: "14px",
    transition: "border-color 0.2s",
    outline: "none",
    // เมื่อโฟกัสให้เป็นสีทอง
    ':focus': {
        borderColor: '#D4AF37'
    }
  },
  button: {
    padding: "12px",
    borderRadius: "8px",
    border: "none",
    background: "#D4AF37", // ปุ่มสีทอง
    color: "#000", // ตัวอักษรดำบนปุ่มทอง
    fontSize: "15px",
    fontWeight: "700",
    cursor: "pointer",
    transition: "background 0.2s, transform 0.1s",
    marginTop: "10px",
    ':hover': {
        background: '#C49F27'
    },
    ':active': {
        transform: 'scale(0.98)'
    }
  },
  footerText: {
    textAlign: "center",
    fontSize: "11px",
    color: "#999",
    marginTop: "10px",
    letterSpacing: "0.5px"
  }
};