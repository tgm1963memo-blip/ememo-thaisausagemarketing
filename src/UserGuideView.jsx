import { useMemo, useState } from "react";

const GOLD = "#D4AF37";
const BLACK = "#111";

function MockFrame({ title, children, height = 220 }) {
  return (
    <div style={{ border: "1px solid #E5E7EB", borderRadius: 10, overflow: "hidden", marginBottom: 16, boxShadow: "0 4px 12px rgba(0,0,0,.06)" }}>
      <div style={{ background: "#1a1a1a", color: "#aaa", fontSize: 10, padding: "6px 12px", display: "flex", gap: 6, alignItems: "center" }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#EF4444" }} />
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#F59E0B" }} />
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22C55E" }} />
        <span style={{ marginLeft: 8, color: "#666" }}>{title}</span>
      </div>
      <div style={{ background: "#F9FAFB", padding: 12, minHeight: height }}>{children}</div>
    </div>
  );
}

function MockLogin() {
  return (
    <MockFrame title="E-Memo — Login">
      <div style={{ maxWidth: 280, margin: "0 auto", background: "#fff", borderRadius: 10, padding: 20, border: "1px solid #E5E7EB" }}>
        <div style={{ width: 40, height: 40, background: GOLD, borderRadius: 8, margin: "0 auto 10px", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: BLACK }}>E</div>
        <div style={{ textAlign: "center", fontSize: 13, fontWeight: 600, marginBottom: 12 }}>E-Memo System</div>
        <div style={{ height: 28, background: "#F3F4F6", borderRadius: 6, marginBottom: 8, fontSize: 10, display: "flex", alignItems: "center", padding: "0 10px", color: "#9CA3AF" }}>Username หรือ Email</div>
        <div style={{ height: 28, background: "#F3F4F6", borderRadius: 6, marginBottom: 12, fontSize: 10, display: "flex", alignItems: "center", padding: "0 10px", color: "#9CA3AF" }}>••••••••</div>
        <div style={{ height: 32, background: GOLD, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 }}>เข้าสู่ระบบ</div>
      </div>
    </MockFrame>
  );
}

function MockCreate() {
  return (
    <MockFrame title="สร้าง Memo ใหม่" height={260}>
      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ width: 140, background: "#1a1a1a", borderRadius: 8, padding: 8, flexShrink: 0 }}>
          {["ภาพรวม", "กล่องขาเข้า", "Memo ของฉัน", "CC ถึงฉัน", "ค้นหา"].map((l, i) => (
            <div key={l} style={{ fontSize: 9, color: i === 2 ? GOLD : "#666", padding: "4px 6px", marginBottom: 2 }}>{l}</div>
          ))}
        </div>
        <div style={{ flex: 1, background: "#fff", borderRadius: 8, padding: 10, border: "1px solid #E5E7EB" }}>
          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8 }}>สร้าง Memo</div>
          <div style={{ height: 22, background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 4, marginBottom: 6, fontSize: 9, padding: "0 8px", display: "flex", alignItems: "center", color: "#9CA3AF" }}>หัวข้อ Memo...</div>
          <div style={{ height: 60, background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 4, marginBottom: 8, fontSize: 9, padding: 8, color: "#9CA3AF" }}>เนื้อหา...</div>
          <div style={{ height: 24, background: GOLD, borderRadius: 4, fontSize: 9, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>ส่งเพื่ออนุมัติ</div>
        </div>
      </div>
    </MockFrame>
  );
}

function MockInbox() {
  return (
    <MockFrame title="กล่องขาเข้า">
      {[1, 2].map(i => (
        <div key={i} style={{ background: "#fff", border: "1px solid #F3F4F6", borderRadius: 6, padding: "8px 10px", marginBottom: 6, display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ width: 24, height: 24, borderRadius: "50%", background: "#E5E7EB" }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, fontWeight: 600 }}>ขออนุมัติงบประมาณ Q{i}</div>
            <div style={{ fontSize: 9, color: "#9CA3AF" }}>รออนุมัติ · การตลาด</div>
          </div>
          <span style={{ fontSize: 8, background: "#FEF3C7", color: "#92400E", padding: "2px 6px", borderRadius: 4 }}>รอ</span>
        </div>
      ))}
    </MockFrame>
  );
}

function MockAck() {
  return (
    <MockFrame title="รับทราบเอกสาร (หลังอนุมัติ)">
      <div style={{ background: "#fff", borderRadius: 8, padding: 12, border: "1px solid #E5E7EB" }}>
        <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8 }}>✅ Memo อนุมัติครบแล้ว</div>
        <div style={{ height: 6, background: "#F3F4F6", borderRadius: 99, marginBottom: 8, overflow: "hidden" }}>
          <div style={{ width: "66%", height: "100%", background: GOLD }} />
        </div>
        <div style={{ fontSize: 9, color: "#92400E", marginBottom: 10 }}>2/3 รับทราบ</div>
        <div style={{ height: 32, background: "#22C55E", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#fff" }}>✓ รับทราบเอกสารนี้</div>
      </div>
    </MockFrame>
  );
}

function MockSearch() {
  return (
    <MockFrame title="ค้นหา Memo">
      <div style={{ background: "#fff", borderRadius: 8, padding: 10, border: "1px solid #E5E7EB" }}>
        <div style={{ height: 26, background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 4, marginBottom: 6, fontSize: 9, padding: "0 8px", display: "flex", alignItems: "center", color: "#374151" }}>🔍 ค้นหาชื่อเรื่อง, เนื้อหา, ผู้อนุมัติ...</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <div style={{ height: 22, background: "#F3F4F6", borderRadius: 4, fontSize: 8, display: "flex", alignItems: "center", padding: "0 6px", color: "#6B7280" }}>ผู้อนุมัติ: ทั้งหมด</div>
          <div style={{ height: 22, background: "#F3F4F6", borderRadius: 4, fontSize: 8, display: "flex", alignItems: "center", padding: "0 6px", color: "#6B7280" }}>สถานะ: อนุมัติแล้ว</div>
        </div>
      </div>
    </MockFrame>
  );
}

function MockCc() {
  return (
    <MockFrame title="CC ถึงฉัน">
      <div style={{ background: "#fff", border: "1px solid #BFDBFE", borderRadius: 6, padding: "8px 10px" }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: "#1E40AF" }}>แจ้งผลการอนุมัติ — โครงการ XYZ</div>
        <div style={{ fontSize: 9, color: "#9CA3AF", marginTop: 4 }}>อนุมัติครบ · CC ถึงคุณ</div>
      </div>
    </MockFrame>
  );
}

const MOCK_COMPONENTS = {
  login: MockLogin,
  create: MockCreate,
  inbox: MockInbox,
  ack: MockAck,
  search: MockSearch,
  cc: MockCc,
};

export const GUIDE_SECTIONS = [
  {
    id: "intro",
    title: "E-Memo คืออะไร?",
    body: "E-Memo เป็นระบบส่งและอนุมัติ Memo ออนไลน์ของ ไทยซอสเซส มาร์เก็ตติ้ง ใช้แทนการส่ง Memo กระดาษหรืออีเมลทั่วไป มีขั้นตอนอนุมัติหลายระดับ ลายเซ็นดิจิทัล และการแจ้งเตือนผู้เกี่ยวข้อง",
    bullets: [
      "เข้าใช้งานที่ https://ememo-thaisausagemarketing.vercel.app",
      "Admin จะสร้างบัญชีและส่งอีเมลแจ้ง Username / Password",
      "ครั้งแรกต้องตั้งรหัสผ่านใหม่ก่อนใช้งาน",
    ],
    mock: "login",
  },
  {
    id: "login",
    title: "เข้าสู่ระบบ",
    body: "กรอก Username หรือ Email พร้อมรหัสผ่าน หากลืมรหัส กดลิงก์ 'ลืมรหัสผ่าน' ระบบจะส่งอีเมลตั้งรหัสใหม่",
    bullets: [
      "Username ตัวอย่าง: somchai (ไม่ต้องใส่ @domain)",
      "หลัง Login ครั้งแรก ระบบบังคับเปลี่ยนรหัสผ่าน",
      "มีทัวร์แนะนำเมนูอัตโนมัติหลังตั้งรหัสสำเร็จ",
    ],
    mock: "login",
  },
  {
    id: "create",
    title: "สร้างและส่ง Memo",
    body: "กดปุ่ม '+ สร้าง Memo ใหม่' กรอกหัวข้อ เนื้อหา เลือกหมวดหมู่ ตั้งขั้นตอนอนุมัติ (Route) และรายชื่อ CC อีเมล (ถ้ามี) จากนั้นกด 'ส่งเพื่ออนุมัติ'",
    bullets: [
      "บันทึกร่างได้ก่อนส่ง — แก้ไขได้จนกว่าจะส่ง",
      "แนบไฟล์ PDF/รูปภาพได้ในหน้าสร้าง Memo",
      "ใช้ Route อนุมัติที่บันทึกไว้เพื่อโหลด workflow ซ้ำได้เร็ว",
    ],
    mock: "create",
  },
  {
    id: "approve",
    title: "อนุมัติ Memo",
    body: "ผู้อนุมัติดู Memo ในเมนู 'กล่องขาเข้า' กดเปิดรายการ ตรวจสอบเนื้อหา แล้วกด 'อนุมัติ' หรือ 'ปฏิเสธ' พร้อมความเห็น (ถ้ามี) แนะนำตั้งลายเซ็นในโปรไฟล์ก่อนอนุมัติครั้งแรก",
    bullets: [
      "รับแจ้งเตือนทางอีเมลเมื่อถึงคิวอนุมัติ",
      "Super Admin สามารถอนุมัติแทนผู้อนุมัติได้",
      "ผู้อนุมัติสามารถเพิ่มลำดับอนุมัติต่อได้",
    ],
    mock: "inbox",
  },
  {
    id: "cc-ack",
    title: "CC และการรับทราบ",
    body: "เมื่อ Memo อนุมัติครบ ระบบส่งอีเมลแจ้งผู้สร้างและรายชื่อ CC ผู้รับสามารถเปิดลิงก์ในอีเมลเพื่อดูเอกสารและกด 'รับทราบ' ผู้สร้างจะเห็นสถานะว่าใครรับทราบแล้วบ้าง",
    bullets: [
      "ผู้ที่มีบัญชีดูได้ที่เมนู 'CC ถึงฉัน'",
      "กดปุ่ม 'รับทราบ' ในอีเมลหรือในระบบ",
      "ผู้สร้างเห็นความคืบหน้า X/Y รับทราบในรายละเอียด Memo",
      "เอกสารเก่าที่อนุมัติแล้วรองรับการรับทราบย้อนหลัง",
    ],
    mock: "ack",
  },
  {
    id: "search",
    title: "ค้นหา Memo",
    body: "ใช้เมนู 'ค้นหา' เพื่อหา Memo ตามคำค้น หัวข้อ เนื้อหา หรือชื่อผู้อนุมัติ สามารถกรองตามสถานะ หมวดหมู่ วันที่ และเลือกผู้อนุมัติจากรายการได้",
    bullets: [
      "พิมพ์ชื่อผู้อนุมัติในช่องค้นหาได้เลย",
      "ใช้ dropdown 'ผู้อนุมัติ' เพื่อกรองเฉพาะ Memo ที่คนนั้นเกี่ยวข้อง",
      "Admin ค้นหาได้ทั้ง Memo ในองค์กร",
    ],
    mock: "search",
  },
  {
    id: "cc-menu",
    title: "เมนู CC ถึงฉัน",
    body: "หากคุณถูกใส่ในรายชื่อ CC อีเมลของ Memo ที่อนุมัติครบแล้ว เอกสารจะปรากฏในเมนู 'CC ถึงฉัน' โดยอัตโนมัติ",
    bullets: [
      "เปิดอ่านเนื้อหาและไฟล์แนบได้ครบ",
      "กดรับทราบจากหน้ารายละเอียดได้",
    ],
    mock: "cc",
  },
  {
    id: "profile",
    title: "โปรไฟล์และลายเซ็น",
    body: "คลิกที่ชื่อ/รูปโปรไฟล์มุมล่างซ้าย (Desktop) หรือมุมขวาบน (Mobile) เพื่อตั้งลายเซ็น เปลี่ยนรหัสผ่าน และแก้ไขข้อมูลส่วนตัว",
    bullets: [
      "ลายเซ็นแสดงในเอกสาร PDF/DOCX ที่ Export",
      "วาดลายเซ็นใหม่หรืออัปโหลดรูปได้",
    ],
  },
  {
    id: "help",
    title: "ต้องการความช่วยเหลือ?",
    body: "หากพบปัญหาการใช้งาน ติดต่อ Admin หรือ Super Admin ขององค์กร สำหรับปัญหาการเข้าระบบ ตรวจสอบอีเมล Spam/Junk หรือขอส่งอีเมลตั้งรหัสใหม่",
    bullets: [
      "อีเมลระบบ: noreply.ememo@tgm.co.th",
      "Admin จัดการ User ได้ที่เมนู 'จัดการ User' (Super Admin)",
    ],
  },
];

export default function UserGuideView() {
  const [active, setActive] = useState(GUIDE_SECTIONS[0].id);
  const section = useMemo(() => GUIDE_SECTIONS.find(s => s.id === active) || GUIDE_SECTIONS[0], [active]);
  const Mock = section.mock ? MOCK_COMPONENTS[section.mock] : null;

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <style>{`
        @media(max-width:640px){
          .guide-layout{grid-template-columns:1fr!important;}
          .guide-nav{position:static!important;margin-bottom:12px;}
        }
      `}</style>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: "#111", marginBottom: 4 }}>📖 คู่มือการใช้งาน E-Memo</div>
        <div style={{ fontSize: 13, color: "#6B7280" }}>ไทยซอสเซส มาร์เก็ตติ้ง — คู่มือฉบับสมบูรณ์พร้อมภาพประกอบ</div>
      </div>

      <div className="guide-layout" style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 20, alignItems: "start" }}>
        <nav className="guide-nav" style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10, padding: 8, position: "sticky", top: 16 }}>
          {GUIDE_SECTIONS.map(s => (
            <button
              key={s.id}
              onClick={() => setActive(s.id)}
              style={{
                display: "block", width: "100%", textAlign: "left", padding: "8px 10px", marginBottom: 2,
                background: active === s.id ? "#FFFBEB" : "transparent",
                color: active === s.id ? "#92400E" : "#374151",
                border: "none", borderRadius: 6, fontSize: 12, cursor: "pointer", fontFamily: "inherit",
                fontWeight: active === s.id ? 600 : 400,
              }}
            >
              {s.title}
            </button>
          ))}
        </nav>

        <article style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10, padding: "24px 28px" }}>
          <h2 style={{ margin: "0 0 12px", fontSize: 18, fontWeight: 700, color: "#111" }}>{section.title}</h2>
          <p style={{ margin: "0 0 16px", fontSize: 14, lineHeight: 1.7, color: "#374151" }}>{section.body}</p>
          {section.bullets?.length > 0 && (
            <ul style={{ margin: "0 0 20px", paddingLeft: 20, fontSize: 13, lineHeight: 1.8, color: "#374151" }}>
              {section.bullets.map((b, i) => <li key={i}>{b}</li>)}
            </ul>
          )}
          {Mock && <Mock />}
        </article>
      </div>
    </div>
  );
}
