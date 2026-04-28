// MemoPDFPreview.jsx
// Document preview with draggable signature zones + PDF export via browser print
import { useState, useRef, useCallback, useEffect } from "react";

const GOLD = "#D4AF37";
const COMPANY = "บริษัท ไทยซอสเซส มาร์เก็ตติ้ง จำกัด";

// Inject print CSS once
const PRINT_CSS_ID = "ememo-print-css";
function injectPrintCss() {
  if (document.getElementById(PRINT_CSS_ID)) return;
  const s = document.createElement("style");
  s.id = PRINT_CSS_ID;
  s.textContent = `
    @media print {
      body > * { display: none !important; }
      #ememo-print-root { display: block !important; }
      #ememo-print-root .no-print { display: none !important; }
    }
    #ememo-print-root {
      display: none;
      font-family: 'Noto Sans Thai', 'Sarabun', sans-serif;
    }
  `;
  document.head.appendChild(s);
}

function fmtDate(s) {
  if (!s) return "-";
  return new Date(s).toLocaleDateString("th-TH", { day: "2-digit", month: "long", year: "numeric" });
}

// ── Draggable Signature Zone on preview canvas ──────────────────────────────
function DraggableZone({ zone, idx, containerRef, onMove, onRemove, onLabel }) {
  const zoneRef = useRef();
  const dragging = useRef(false);
  const startPos = useRef({});

  const onMouseDown = (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "BUTTON") return;
    dragging.current = true;
    const rect = containerRef.current.getBoundingClientRect();
    startPos.current = {
      mx: e.clientX,
      my: e.clientY,
      ox: zone.x || 0,
      oy: zone.y || 0,
      cw: rect.width,
      ch: rect.height,
    };
    e.preventDefault();
  };

  useEffect(() => {
    const onMove_ = (e) => {
      if (!dragging.current) return;
      const { mx, my, ox, oy, cw, ch } = startPos.current;
      const dx = ((e.clientX - mx) / cw) * 100;
      const dy = ((e.clientY - my) / ch) * 100;
      const nx = Math.max(0, Math.min(ox + dx, 85));
      const ny = Math.max(0, Math.min(oy + dy, 90));
      onMove(idx, nx, ny);
    };
    const onUp = () => { dragging.current = false; };
    window.addEventListener("mousemove", onMove_);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove_); window.removeEventListener("mouseup", onUp); };
  }, [idx, onMove]);

  return (
    <div ref={zoneRef} onMouseDown={onMouseDown}
      style={{
        position: "absolute", left: `${zone.x || 10}%`, top: `${zone.y || 70}%`,
        width: 140, border: `2px dashed ${GOLD}`, borderRadius: 4,
        background: "rgba(212,175,55,.08)", padding: "4px 6px",
        cursor: "move", userSelect: "none", zIndex: 10,
      }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 3 }}>
        <span style={{ fontSize: 10, color: GOLD, fontWeight: 600 }}>✍ จุด {idx + 1}</span>
        <button onClick={() => onRemove(idx)}
          style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "#aaa", padding: 0, lineHeight: 1 }}>✕</button>
      </div>
      <input value={zone.label || ""} onChange={e => onLabel(idx, e.target.value)}
        placeholder="ชื่อตำแหน่ง..."
        style={{ width: "100%", fontSize: 10, background: "transparent", border: "none", borderBottom: "1px solid rgba(212,175,55,.4)", color: "#111", outline: "none", fontFamily: "inherit", padding: "1px 2px", boxSizing: "border-box" }}/>
      {zone.signerName && (
        <div style={{ fontSize: 9, color: "#6B7280", marginTop: 2 }}>@ {zone.signerName}</div>
      )}
    </div>
  );
}

// ── Main Preview + PDF Component ───────────────────────────────────────────────
export default function MemoPDFPreview({ memo, users, onSaveZones, onClose }) {
  const [zones, setZones] = useState(
    (memo.signatureZones || []).map((z, i) => ({
      ...z,
      x: z.x ?? (10 + i * 35),
      y: z.y ?? 72,
    }))
  );
  const [printing, setPrinting] = useState(false);
  const previewRef = useRef();
  const printRootRef = useRef();

  useEffect(() => { injectPrintCss(); }, []);

  const creator  = users.find(u => u.id === memo.createdBy) || {};
  const allUsers = users.filter(u => u.active);

  const addZone = () => {
    setZones(p => [...p, {
      id: "sz" + Date.now(),
      label: `จุดลงนาม ${p.length + 1}`,
      x: 10 + (p.length % 3) * 30,
      y: 70 + Math.floor(p.length / 3) * 15,
      assignedTo: "",
      signerName: "",
    }]);
  };
  const moveZone  = useCallback((i, x, y) => setZones(p => p.map((z, j) => j === i ? { ...z, x, y } : z)), []);
  const removeZone= (i) => setZones(p => p.filter((_, j) => j !== i));
  const labelZone = (i, v) => setZones(p => p.map((z, j) => j === i ? { ...z, label: v } : z));
  const assignZone= (i, userId) => {
    const u = users.find(x => x.id === userId) || {};
    setZones(p => p.map((z, j) => j === i ? { ...z, assignedTo: userId, signerName: u.name || "" } : z));
  };

  // PDF via browser print — creates a hidden printable div
  const handlePrint = () => {
    setPrinting(true);
    const root = document.getElementById("ememo-print-root") || document.createElement("div");
    root.id = "ememo-print-root";
    if (!document.getElementById("ememo-print-root")) document.body.appendChild(root);

    const approvals = (memo.workflowLevels || []).flatMap(lv => lv.approvers || []);

    root.innerHTML = `
      <div style="width:210mm;min-height:297mm;margin:0 auto;padding:20mm 22mm;box-sizing:border-box;font-family:'Noto Sans Thai','Sarabun',sans-serif;font-size:13px;color:#111;position:relative;">
        <!-- Header -->
        <div style="text-align:center;border-bottom:2px solid #D4AF37;padding-bottom:12px;margin-bottom:20px;">
          <div style="font-size:15px;font-weight:700;color:#111;">${COMPANY}</div>
          <div style="font-size:18px;font-weight:700;margin-top:6px;">บันทึกข้อความ (Memo)</div>
          ${memo.docNo ? `<div style="font-size:11px;color:#6B7280;margin-top:3px;">เลขที่ ${memo.docNo}</div>` : ""}
        </div>

        <!-- Meta table -->
        <table style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:12px;">
          <tr>
            <td style="width:120px;color:#6B7280;padding:3px 0;vertical-align:top;">เรื่อง:</td>
            <td style="font-weight:600;padding:3px 0;">${memo.title || ""}</td>
            <td style="width:120px;color:#6B7280;padding:3px 0;text-align:right;">หมวดหมู่:</td>
            <td style="padding:3px 0;text-align:right;">${memo.category || ""}</td>
          </tr>
          <tr>
            <td style="color:#6B7280;padding:3px 0;">ผู้สร้าง:</td>
            <td style="padding:3px 0;">${creator.name || ""} (${creator.dept || ""})</td>
            <td style="color:#6B7280;padding:3px 0;text-align:right;">วันที่:</td>
            <td style="padding:3px 0;text-align:right;">${fmtDate(memo.createdAt)}</td>
          </tr>
        </table>

        <!-- Divider -->
        <div style="border-top:1px solid #E5E7EB;margin-bottom:20px;"></div>

        <!-- Content -->
        <div style="font-size:13px;line-height:1.9;white-space:pre-wrap;margin-bottom:28px;min-height:120px;">${memo.content || ""}</div>

        <!-- Signature zones -->
        ${zones.length > 0 ? `
          <div style="margin-top:32px;border-top:1px solid #E5E7EB;padding-top:20px;">
            <div style="font-size:11px;color:#6B7280;margin-bottom:16px;font-weight:600;">ลงนาม</div>
            <div style="display:flex;gap:24px;flex-wrap:wrap;">
              ${zones.map(z => `
                <div style="flex:1;min-width:140px;text-align:center;">
                  <div style="height:52px;border-bottom:1px solid #111;margin-bottom:6px;position:relative;">
                    ${z.signerName ? `<div style="font-size:9px;color:#9CA3AF;position:absolute;bottom:4px;left:0;right:0;">(ลายเซ็น)</div>` : ""}
                  </div>
                  <div style="font-size:11px;font-weight:600;">${z.label || `จุดลงนาม`}</div>
                  ${z.signerName ? `<div style="font-size:10px;color:#6B7280;">${z.signerName}</div>` : ""}
                </div>
              `).join("")}
            </div>
          </div>
        ` : ""}

        <!-- Approval status -->
        ${approvals.length > 0 ? `
          <div style="margin-top:24px;border-top:1px solid #E5E7EB;padding-top:16px;">
            <div style="font-size:11px;color:#6B7280;margin-bottom:10px;font-weight:600;">ขั้นตอนการอนุมัติ</div>
            <table style="width:100%;border-collapse:collapse;font-size:11px;">
              <tr style="background:#F9FAFB;">
                <th style="text-align:left;padding:5px 8px;border:1px solid #E5E7EB;">ผู้อนุมัติ</th>
                <th style="text-align:center;padding:5px 8px;border:1px solid #E5E7EB;width:80px;">สถานะ</th>
                <th style="text-align:center;padding:5px 8px;border:1px solid #E5E7EB;width:100px;">วันที่</th>
                <th style="text-align:left;padding:5px 8px;border:1px solid #E5E7EB;">ความคิดเห็น</th>
              </tr>
              ${approvals.map((ap, i) => {
                const u = users.find(x => x.id === ap.userId) || {};
                const statusLabel = ap.status === "approved" ? "✓ อนุมัติ" : ap.status === "rejected" ? "✗ ปฏิเสธ" : "○ รอ";
                return `<tr>
                  <td style="padding:5px 8px;border:1px solid #E5E7EB;">${ap.name || u.name || ap.email || "-"}</td>
                  <td style="padding:5px 8px;border:1px solid #E5E7EB;text-align:center;">${statusLabel}</td>
                  <td style="padding:5px 8px;border:1px solid #E5E7EB;text-align:center;">${ap.actionAt ? fmtDate(ap.actionAt) : "-"}</td>
                  <td style="padding:5px 8px;border:1px solid #E5E7EB;">${ap.comment || ""}</td>
                </tr>`;
              }).join("")}
            </table>
          </div>
        ` : ""}

        <!-- Footer -->
        <div style="position:absolute;bottom:16mm;left:22mm;right:22mm;display:flex;justify-content:space-between;font-size:10px;color:#9CA3AF;border-top:1px solid #F3F4F6;padding-top:8px;">
          <span>${COMPANY}</span>
          <span>พิมพ์เมื่อ ${fmtDate(new Date().toISOString())}</span>
        </div>
      </div>
    `;

    setTimeout(() => {
      window.print();
      setTimeout(() => { root.innerHTML = ""; setPrinting(false); }, 500);
    }, 200);
  };

  const handleSave = () => {
    onSaveZones(zones.map(z => ({
      id: z.id, label: z.label, x: z.x, y: z.y,
      assignedTo: z.assignedTo, signerName: z.signerName,
    })));
  };

  const approvals = (memo.workflowLevels || []).flatMap(lv => lv.approvers || []);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, display: "flex", background: "rgba(0,0,0,.7)", fontFamily: "'Noto Sans Thai','Sarabun',sans-serif" }}>

      {/* Left panel: controls */}
      <div style={{ width: 260, background: "#111", color: "#fff", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: "16px 16px 12px", borderBottom: "1px solid #222" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: GOLD }}>ตัวอย่างเอกสาร</div>
          <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>กำหนดจุดลงนาม + โหลด PDF</div>
        </div>

        {/* Signature zones manager */}
        <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#aaa", marginBottom: 10, textTransform: "uppercase", letterSpacing: .5 }}>จุดลงนาม</div>
          {zones.map((z, i) => (
            <div key={z.id || i} style={{ background: "#1a1a1a", border: "1px solid #333", borderRadius: 7, padding: 10, marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 7 }}>
                <span style={{ fontSize: 11, color: GOLD, fontWeight: 600 }}>✍ จุด {i + 1}</span>
                <button onClick={() => removeZone(i)} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#666", padding: 0 }}>✕</button>
              </div>
              <div style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 10, color: "#666", marginBottom: 3 }}>ชื่อตำแหน่ง</div>
                <input value={z.label || ""} onChange={e => labelZone(i, e.target.value)}
                  style={{ width: "100%", background: "#222", border: "1px solid #333", borderRadius: 5, color: "#fff", fontSize: 11, padding: "5px 8px", fontFamily: "inherit", boxSizing: "border-box" }}/>
              </div>
              <div>
                <div style={{ fontSize: 10, color: "#666", marginBottom: 3 }}>มอบหมายให้</div>
                <select value={z.assignedTo || ""} onChange={e => assignZone(i, e.target.value)}
                  style={{ width: "100%", background: "#222", border: "1px solid #333", borderRadius: 5, color: "#fff", fontSize: 11, padding: "5px 8px", fontFamily: "inherit" }}>
                  <option value="">-- เลือกผู้ลงนาม --</option>
                  {allUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              <div style={{ fontSize: 10, color: "#555", marginTop: 5 }}>
                ลากบนตัวอย่างเพื่อเลื่อนตำแหน่ง
              </div>
            </div>
          ))}
          <button onClick={addZone}
            style={{ width: "100%", padding: "8px", background: "transparent", border: `1px dashed ${GOLD}`, borderRadius: 6, color: GOLD, fontSize: 12, cursor: "pointer", fontFamily: "inherit", fontWeight: 500 }}>
            + เพิ่มจุดลงนาม
          </button>
        </div>

        {/* Actions */}
        <div style={{ padding: 14, borderTop: "1px solid #222", display: "flex", flexDirection: "column", gap: 8 }}>
          <button onClick={handlePrint} disabled={printing}
            style={{ width: "100%", padding: "10px", background: GOLD, color: BLACK, border: "none", borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: printing ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: printing ? .7 : 1 }}>
            {printing ? "กำลังเตรียม..." : "🖨️ โหลด / พิมพ์ PDF"}
          </button>
          <button onClick={handleSave}
            style={{ width: "100%", padding: "10px", background: "#1D4ED8", color: "#fff", border: "none", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
            💾 บันทึกจุดลงนาม
          </button>
          <button onClick={onClose}
            style={{ width: "100%", padding: "9px", background: "transparent", color: "#666", border: "1px solid #333", borderRadius: 6, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
            ปิด
          </button>
        </div>
      </div>

      {/* Right panel: A4 preview */}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px 32px", display: "flex", justifyContent: "center" }}>
        <div style={{ width: "100%", maxWidth: 720 }}>
          <div style={{ fontSize: 12, color: "#777", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
            <span>ตัวอย่างเอกสาร A4</span>
            <span style={{ flex: 1, borderTop: "1px solid #333" }}/>
            <span style={{ fontSize: 11, color: "#555" }}>ลาก ✍ บนเอกสารเพื่อเลื่อนจุดลงนาม</span>
          </div>

          {/* A4 paper */}
          <div ref={previewRef} style={{
            background: "#fff", borderRadius: 4,
            boxShadow: "0 4px 40px rgba(0,0,0,.5)",
            padding: "32px 36px", position: "relative",
            minHeight: 900, userSelect: "none",
          }}>
            {/* Draggable zones overlay */}
            {zones.map((z, i) => (
              <DraggableZone key={z.id || i} zone={z} idx={i} containerRef={previewRef} onMove={moveZone} onRemove={removeZone} onLabel={labelZone}/>
            ))}

            {/* Header */}
            <div style={{ textAlign: "center", borderBottom: `2px solid ${GOLD}`, paddingBottom: 12, marginBottom: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#111" }}>{COMPANY}</div>
              <div style={{ fontSize: 20, fontWeight: 700, marginTop: 6, color: "#111" }}>บันทึกข้อความ (Memo)</div>
              {memo.docNo && <div style={{ fontSize: 11, color: "#6B7280", marginTop: 3 }}>เลขที่ {memo.docNo}</div>}
            </div>

            {/* Meta */}
            <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16, fontSize: 12 }}>
              <tbody>
                <tr>
                  <td style={{ width: 100, color: "#6B7280", paddingBottom: 5, verticalAlign: "top" }}>เรื่อง:</td>
                  <td style={{ fontWeight: 600, paddingBottom: 5 }}>{memo.title || <span style={{ color: "#ccc" }}>ยังไม่ได้กรอกชื่อเรื่อง</span>}</td>
                  <td style={{ width: 100, color: "#6B7280", paddingBottom: 5, textAlign: "right" }}>หมวดหมู่:</td>
                  <td style={{ paddingBottom: 5, textAlign: "right" }}>{memo.category || "-"}</td>
                </tr>
                <tr>
                  <td style={{ color: "#6B7280", paddingBottom: 5 }}>ผู้สร้าง:</td>
                  <td style={{ paddingBottom: 5 }}>{creator.name || "-"} {creator.dept ? `(${creator.dept})` : ""}</td>
                  <td style={{ color: "#6B7280", paddingBottom: 5, textAlign: "right" }}>วันที่:</td>
                  <td style={{ paddingBottom: 5, textAlign: "right" }}>{fmtDate(memo.createdAt || new Date().toISOString())}</td>
                </tr>
              </tbody>
            </table>

            <div style={{ borderTop: "1px solid #E5E7EB", marginBottom: 20 }}/>

            {/* Content */}
            <div style={{ fontSize: 13, lineHeight: 1.9, whiteSpace: "pre-wrap", color: "#374151", minHeight: 120, marginBottom: 28 }}>
              {memo.content || <span style={{ color: "#ccc", fontStyle: "italic" }}>เนื้อหา Memo จะแสดงที่นี่...</span>}
            </div>

            {/* Signature zone placeholders (static visual when no zones placed) */}
            {zones.length === 0 && (
              <div style={{ marginTop: 40, padding: "16px", background: "#F9FAFB", border: "1px dashed #E5E7EB", borderRadius: 6, textAlign: "center", color: "#9CA3AF", fontSize: 12 }}>
                กด "+ เพิ่มจุดลงนาม" ในแผงซ้ายเพื่อเพิ่มจุดลงนาม แล้วลากไปวางตำแหน่งที่ต้องการ
              </div>
            )}

            {/* Approval table */}
            {approvals.length > 0 && (
              <div style={{ marginTop: 32, borderTop: "1px solid #E5E7EB", paddingTop: 16 }}>
                <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: .5 }}>ขั้นตอนการอนุมัติ</div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead>
                    <tr style={{ background: "#F9FAFB" }}>
                      <th style={{ textAlign: "left", padding: "6px 10px", border: "1px solid #E5E7EB", fontWeight: 600, color: "#6B7280" }}>ผู้อนุมัติ</th>
                      <th style={{ textAlign: "center", padding: "6px 10px", border: "1px solid #E5E7EB", width: 80, fontWeight: 600, color: "#6B7280" }}>สถานะ</th>
                      <th style={{ textAlign: "center", padding: "6px 10px", border: "1px solid #E5E7EB", width: 110, fontWeight: 600, color: "#6B7280" }}>วันที่</th>
                      <th style={{ textAlign: "left", padding: "6px 10px", border: "1px solid #E5E7EB", fontWeight: 600, color: "#6B7280" }}>ความคิดเห็น</th>
                    </tr>
                  </thead>
                  <tbody>
                    {approvals.map((ap, i) => {
                      const u = users.find(x => x.id === ap.userId) || {};
                      const sc = ap.status === "approved"
                        ? { color: "#065F46", label: "✓ อนุมัติ" }
                        : ap.status === "rejected"
                        ? { color: "#991B1B", label: "✗ ปฏิเสธ" }
                        : { color: "#B45309", label: "○ รอ" };
                      return (
                        <tr key={i}>
                          <td style={{ padding: "6px 10px", border: "1px solid #E5E7EB" }}>
                            {ap.name || u.name || ap.email || "-"}
                            {ap.signature && <img src={ap.signature} alt="sig" style={{ height: 22, marginLeft: 8, verticalAlign: "middle", border: "1px solid #E5E7EB", borderRadius: 3 }}/>}
                          </td>
                          <td style={{ padding: "6px 10px", border: "1px solid #E5E7EB", textAlign: "center", color: sc.color, fontWeight: 500 }}>{sc.label}</td>
                          <td style={{ padding: "6px 10px", border: "1px solid #E5E7EB", textAlign: "center", color: "#6B7280" }}>{ap.actionAt ? fmtDate(ap.actionAt) : "-"}</td>
                          <td style={{ padding: "6px 10px", border: "1px solid #E5E7EB", color: "#6B7280" }}>{ap.comment || ""}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Footer */}
            <div style={{ marginTop: 48, borderTop: "1px solid #F3F4F6", paddingTop: 8, display: "flex", justifyContent: "space-between", fontSize: 10, color: "#9CA3AF" }}>
              <span>{COMPANY}</span>
              <span>พิมพ์เมื่อ {fmtDate(new Date().toISOString())}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
