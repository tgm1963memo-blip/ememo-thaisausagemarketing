import { useState } from "react";
import { auth } from "./firebase";
import { signInWithEmailAndPassword } from "firebase/auth";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) return alert("กรุณากรอกข้อมูลให้ครบ");
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
      <div style={styles.card}>
        <img src="/TGM-01-scaled.jpg" alt="TGM Logo" style={styles.logo} />
        <h2 style={styles.title}>E-Memo Login</h2>
        <input
          style={styles.input}
          placeholder="Email"
          type="email"
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          style={styles.input}
          type="password"
          placeholder="Password"
          onChange={(e) => setPassword(e.target.value)}
        />
        <button style={styles.button} onClick={handleLogin} disabled={loading}>
          {loading ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
        </button>
      </div>
    </div>
  );
}

const styles = {
  container: { height: "100vh", display: "flex", justifyContent: "center", alignItems: "center", background: "#000" },
  card: { background: "#fff", padding: "40px", borderRadius: "16px", width: "340px", display: "flex", flexDirection: "column", gap: "15px", textAlign: "center" },
  logo: { width: "120px", margin: "0 auto 10px" },
  title: { fontSize: "22px", fontWeight: "700", marginBottom: "10px" },
  input: { padding: "12px", borderRadius: "8px", border: "1px solid #ddd", fontSize: "14px" },
  button: { padding: "12px", borderRadius: "8px", border: "none", background: "#D4AF37", color: "#000", fontWeight: "700", cursor: "pointer" }
};