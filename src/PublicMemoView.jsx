import { useEffect, useState } from "react";
import { getPublicMemoParams } from "./authActionParams";

const GOLD = "#D4AF37";
const API_BASE = typeof window !== "undefined"
  ? (window.location.origin.includes("localhost") ? "http://localhost:3000" : "")
  : "";

function fmtDate(iso) {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "-";
  }
}

function displayName(u) {
  if (!u) return "-";
  const name = String(u.name || "").replace(/^undefined/i, "").trim();
  const nick = String(u.nickname || "").trim();
  return nick ? `${name} (${nick})` : name || "-";
}

export default function PublicMemoView() {
  const { memoId, token } = getPublicMemoParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`${API_BASE}/api/public-memo?memoId=${encodeURIComponent(memoId)}&token=${encodeURIComponent(token)}`);
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          const msg = {
            NOT_FOUND: "ไม่พบเอกสารนี้",
            NOT_APPROVED: "เอกสารยังไม่ได้รับการอนุมัติครบ",
            INVALID_TOKEN: "ลิงก์ไม่ถูกต้องหรือหมดอายุ",
          }[json.error] || json.error || "ไม่สามารถเปิดเอกสารได้";
          throw new Error(msg);
        }
        if (alive) setData(json);
      } catch (err) {
        if (alive) setError(err.message || "ไม่สามารถเปิดเอกสารได้");
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    return () => { alive = false; };
  }, [memoId, token]);

  const memo = data?.memo;
  const creator = data?.creator;
  const users = data?.users || [];

  return (
    <div style={S.page}>
      <div style={S.card}>
        <img src="https://img1.pic.in.th/images/logo-tss-03.png" alt="TSS Logo" style={S.logo} onError={e => { e.target.style.display = "none"; }} />
        <div style={S.badge}>E-Memo — เอกสารที่ได้รับ CC</div>

        {loading && <div style={S.info}>กำลังโหลดเอกสาร...</div>}
        {error && <div style={S.error}>{error}</div>}

        {!loading && !error && memo && (
          <>
            <h1 style={S.title}>{memo.title}</h1>
            {memo.docNo && <div style={S.docNo}>เลขที่: {memo.docNo}</div>}

            <div style={S.metaGrid}>
              <div><span style={S.metaLabel}>หมวดหมู่</span><div>{memo.category || "-"}</div></div>
              <div><span style={S.metaLabel}>ผู้สร้าง</span><div>{displayName(creator)}</div></div>
              <div><span style={S.metaLabel}>วันที่สร้าง</span><div>{fmtDate(memo.createdAt)}</div></div>
              <div><span style={S.metaLabel}>สถานะ</span><div style={{ color: "#065F46", fontWeight: 600 }}>✅ อนุมัติครบแล้ว</div></div>
            </div>

            <div style={S.section}>
              <div style={S.sectionTitle}>เนื้อหา</div>
              <div style={S.content} dangerouslySetInnerHTML={{ __html: memo.content || "<span style='color:#9CA3AF'>—</span>" }} />
            </div>

            {(memo.workflowLevels || []).length > 0 && (
              <div style={S.section}>
                <div style={S.sectionTitle}>การอนุมัติ</div>
                {(memo.workflowLevels || []).map((lv, i) => (
                  <div key={i} style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", marginBottom: 4 }}>ลำดับที่ {lv.level || i + 1}</div>
                    {(lv.approvers || []).map((ap, j) => {
                      const u = users.find(x => x.id === ap.userId) || {};
                      const status = ap.status === "approved" ? "✅ อนุมัติ" : ap.status === "rejected" ? "❌ ไม่อนุมัติ" : "⏳ รอ";
                      return (
                        <div key={j} style={S.approverRow}>
                          <span>{ap.name || displayName(u) || ap.email || "-"}</span>
                          <span style={{ fontSize: 11, color: "#6B7280" }}>{status}{ap.actionAt ? ` · ${fmtDate(ap.actionAt)}` : ""}</span>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}

            {(memo.attachments || []).length > 0 && (
              <div style={S.section}>
                <div style={S.sectionTitle}>เอกสารแนบ</div>
                {(memo.attachments || []).map(a => (
                  <a
                    key={a.id}
                    href={a.data || "#"}
                    download={a.name}
                    style={S.attachment}
                  >
                    📎 {a.name}{a.size ? ` (${a.size})` : ""}
                  </a>
                ))}
              </div>
            )}

            <div style={S.footer}>{data.company || "E-Memo"}</div>
          </>
        )}

        <button style={S.loginBtn} onClick={() => window.location.assign("/")}>
          เข้าสู่ระบบ E-Memo
        </button>
      </div>
    </div>
  );
}

const S = {
  page: { minHeight: "100vh", background: "#000", padding: "24px 16px", fontFamily: "'Noto Sans Thai','Sarabun',sans-serif", boxSizing: "border-box" },
  card: { maxWidth: 760, margin: "0 auto", background: "#fff", borderRadius: 16, padding: "28px 28px 24px", boxShadow: "0 20px 60px rgba(0,0,0,.5)" },
  logo: { width: 100, display: "block", margin: "0 auto 8px", objectFit: "contain" },
  badge: { textAlign: "center", fontSize: 11, color: "#6B7280", marginBottom: 16 },
  title: { margin: "0 0 6px", fontSize: 20, fontWeight: 700, color: "#111", lineHeight: 1.4 },
  docNo: { fontSize: 12, color: "#1D4ED8", fontFamily: "monospace", marginBottom: 14 },
  metaGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10, marginBottom: 16, fontSize: 12, color: "#374151" },
  metaLabel: { display: "block", fontSize: 10, color: "#9CA3AF", fontWeight: 600, marginBottom: 2, textTransform: "uppercase" },
  section: { borderTop: "1px solid #F3F4F6", paddingTop: 14, marginTop: 14 },
  sectionTitle: { fontSize: 11, fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },
  content: { fontSize: 13, color: "#374151", lineHeight: 1.7, wordBreak: "break-word" },
  approverRow: { display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, padding: "6px 0", borderBottom: "1px solid #F9FAFB" },
  attachment: { display: "block", fontSize: 12, color: "#1E40AF", textDecoration: "none", padding: "6px 0" },
  footer: { marginTop: 20, fontSize: 10, color: "#D1D5DB", textAlign: "center" },
  info: { background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 8, padding: 12, fontSize: 13, color: "#374151", textAlign: "center" },
  error: { background: "#FFF1F1", border: "1px solid #FECACA", borderRadius: 8, padding: 12, fontSize: 13, color: "#991B1B", textAlign: "center" },
  loginBtn: { marginTop: 18, width: "100%", padding: 12, borderRadius: 8, border: "none", background: GOLD, color: "#000", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit" },
};
