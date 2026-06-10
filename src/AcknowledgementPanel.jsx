import { useState } from "react";
import {
  getAckSummary,
  getMemoAcknowledgements,
  isRecipientAcknowledged,
  canAcknowledgeMemo,
  normalizeEmail,
} from "./memoHelpers";

function fmtDate(iso) {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "-";
  }
}

export default function AcknowledgementPanel({ memo, users, curUser, onAcknowledge, compact = false }) {
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (memo?.status !== "approved") return null;

  const summary = getAckSummary(memo, users);
  if (!summary.total) return null;

  const acks = getMemoAcknowledgements(memo);
  const myEmail = normalizeEmail(curUser?.email);
  const canAck = curUser && onAcknowledge && canAcknowledgeMemo(memo, users, myEmail);
  const iAcked = curUser && isRecipientAcknowledged(memo, myEmail);
  const pct = summary.total ? Math.round((summary.ackCount / summary.total) * 100) : 0;

  const handleSubmit = async () => {
    if (!canAck || submitting) return;
    setSubmitting(true);
    try {
      await onAcknowledge({
        email: myEmail,
        name: curUser.name,
        via: "system",
        comment: comment.trim(),
      });
      setComment("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ fontSize: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: compact ? 6 : 10 }}>
        <div style={{ flex: 1, height: 6, background: "#F3F4F6", borderRadius: 99, overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: summary.allAcked ? "#22C55E" : "#D4AF37", borderRadius: 99, transition: "width .3s" }} />
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, color: summary.allAcked ? "#065F46" : "#92400E", whiteSpace: "nowrap" }}>
          {summary.ackCount}/{summary.total} รับทราบ
        </span>
      </div>

      {!compact && summary.recipients.map((r, i) => {
        const key = normalizeEmail(r.email);
        const ackData = acks[key];
        const acked = !!ackData;
        return (
          <div key={r.email || i} style={{ padding: "7px 0", borderBottom: i < summary.recipients.length - 1 ? "1px solid #F3F4F6" : "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 14 }}>{acked ? "✅" : "⏳"}</span>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#374151" }}>
                {r.name || r.email}
                {r.source === "creator" ? " (ผู้สร้าง)" : ""}
              </span>
              <span style={{
                fontSize: 10, fontWeight: 700, whiteSpace: "nowrap",
                color: acked ? "#065F46" : "#92400E",
                background: acked ? "#ECFDF5" : "#FFFBEB",
                border: `1px solid ${acked ? "#A7F3D0" : "#FDE68A"}`,
                borderRadius: 5, padding: "2px 6px",
              }}>
                {acked ? "รับทราบแล้ว" : "รอรับทราบ"}
              </span>
            </div>
            <div style={{ fontSize: 10, color: "#9CA3AF", marginTop: 2, paddingLeft: 22 }}>{r.email}</div>
            {ackData?.at && (
              <div style={{ fontSize: 10, color: "#6B7280", marginTop: 2, paddingLeft: 22 }}>
                {fmtDate(ackData.at)}{ackData.via === "link" ? " · จากลิงก์อีเมล" : ackData.via === "system" ? " · จากระบบ" : ""}
              </div>
            )}
            {ackData?.comment && (
              <div style={{ fontSize: 11, color: "#374151", marginTop: 4, marginLeft: 22, padding: "6px 10px", background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 6, lineHeight: 1.5 }}>
                💬 {ackData.comment}
              </div>
            )}
          </div>
        );
      })}

      {canAck && (
        <div style={{ marginTop: compact ? 6 : 10 }}>
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="ความคิดเห็น (ไม่บังคับ)..."
            rows={compact ? 2 : 3}
            style={{
              width: "100%", boxSizing: "border-box", padding: "8px 10px", marginBottom: 8,
              border: "1px solid #E5E7EB", borderRadius: 6, fontSize: 12, fontFamily: "inherit",
              resize: "vertical", minHeight: 56,
            }}
          />
          <button
            onClick={handleSubmit}
            disabled={submitting}
            style={{
              width: "100%", padding: compact ? "8px" : "10px",
              background: "#22C55E", color: "#fff", border: "none", borderRadius: 6,
              fontSize: compact ? 11 : 12, fontWeight: 700, cursor: submitting ? "not-allowed" : "pointer",
              fontFamily: "inherit", opacity: submitting ? 0.7 : 1,
            }}
          >
            {submitting ? "กำลังบันทึก..." : "✓ รับทราบเอกสารนี้"}
          </button>
        </div>
      )}
      {iAcked && !canAck && (
        <div style={{ marginTop: 8, fontSize: 11, color: "#065F46", background: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: 6, padding: "8px 10px", textAlign: "center" }}>
          ✓ คุณรับทราบเอกสารนี้แล้ว
          {acks[myEmail]?.comment && (
            <div style={{ marginTop: 6, textAlign: "left", color: "#374151", fontWeight: 400 }}>
              💬 {acks[myEmail].comment}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
