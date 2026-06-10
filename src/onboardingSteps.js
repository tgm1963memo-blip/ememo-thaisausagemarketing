/** ขั้นตอนทัวร์แนะนำระบบ — กรองตาม role ของผู้ใช้ */
export function getOnboardingSteps(role) {
  const steps = [
    {
      id: "welcome",
      target: null,
      title: "ยินดีต้อนรับสู่ E-Memo",
      body: "ระบบส่งและอนุมัติ Memo ออนไลน์ของ ไทยซอสเซส มาร์เก็ตติ้ง คู่มือสั้นๆ นี้จะพาคุณรู้จักเมนูหลักก่อนเริ่มใช้งานจริง",
    },
    {
      id: "create",
      target: "create-memo",
      title: "สร้าง Memo ใหม่",
      body: "กดปุ่มนี้เมื่อต้องการร่าง Memo ใหม่ กรอกหัวข้อ เนื้อหา ตั้งขั้นตอนอนุมัติ แล้วส่งเพื่อให้ผู้อนุมัติพิจารณา",
    },
    {
      id: "dashboard",
      target: "nav-dashboard",
      view: "dashboard",
      title: "ภาพรวม",
      body: "หน้าแรกหลัง Login — ดูสรุป Memo และงานที่เกี่ยวข้องกับคุณได้ที่นี่",
    },
    {
      id: "inbox",
      target: "nav-inbox",
      view: "inbox",
      title: "กล่องขาเข้า",
      body: "Memo ที่รอคุณอนุมัติจะอยู่ที่นี่ ตัวเลขสีแดงคือจำนวนรายการที่ยังไม่ได้ดำเนินการ",
    },
    {
      id: "myMemos",
      target: "nav-myMemos",
      view: "myMemos",
      title: "Memo ของฉัน",
      body: "ดู Memo ที่คุณเป็นผู้สร้าง แก้ไขร่าง เรียกคืน หรือติดตามสถานะการอนุมัติ",
    },
    {
      id: "all",
      target: "nav-all",
      view: "all",
      roles: ["superadmin", "admin"],
      desktopOnly: true,
      title: "Memo ทั้งหมด",
      body: "Admin สามารถดู Memo ทุกฉบับในองค์กรได้จากเมนูนี้ (แสดงบนหน้าจอคอมพิวเตอร์)",
    },
    {
      id: "search",
      target: "nav-search",
      view: "search",
      title: "ค้นหา",
      body: "ค้นหา Memo ตามคำค้น หัวข้อ เนื้อหา ชื่อผู้ส่ง หรือชื่อผู้อนุมัติ — กรองตามสถานะ หมวดหมู่ และวันที่ได้",
    },
    {
      id: "guide",
      target: "nav-guide",
      view: "guide",
      title: "คู่มือการใช้งาน",
      body: "เปิดคู่มือฉบับสมบูรณ์พร้อมภาพประกอบได้จากเมนูนี้ — ครอบคลุมทุกขั้นตอนตั้งแต่ Login จนถึงการรับทราบเอกสาร",
    },
    {
      id: "routes",
      target: "nav-routes",
      view: "routes",
      roles: ["superadmin", "admin", "user"],
      desktopOnly: true,
      title: "Route อนุมัติ",
      body: "บันทึก workflow อนุมัติที่ใช้บ่อย แล้วโหลดเข้า Memo ใหม่ได้ในคลิกเดียว ประหยัดเวลาตอนสร้าง Memo",
    },
    {
      id: "ccMemos",
      target: "nav-ccMemos",
      view: "ccMemos",
      title: "CC ถึงฉัน",
      body: "Memo ที่คุณได้รับ CC หลังอนุมัติครบจะอยู่ที่นี่ — เปิดอ่านได้จากระบบโดยตรง",
    },
    {
      id: "profile",
      target: "profile",
      title: "โปรไฟล์และลายเซ็น",
      body: "คลิกที่ชื่อหรือรูปโปรไฟล์เพื่อตั้งลายเซ็น — แนะนำให้ตั้งก่อนอนุมัติ Memo ครั้งแรก ลายเซ็นจะแสดงในเอกสารอนุมัติ",
    },
    {
      id: "users",
      target: "nav-users",
      view: "users",
      roles: ["superadmin"],
      desktopOnly: true,
      title: "จัดการ User",
      body: "Super Admin สร้างและจัดการบัญชีผู้ใช้ นำเข้าจาก Excel และส่งอีเมลแจ้งข้อมูลเข้าใช้งาน",
    },
    {
      id: "settings",
      target: "nav-settings",
      view: "settings",
      roles: ["superadmin"],
      title: "ตั้งค่าระบบ",
      body: "ตั้งค่าการแจ้งเตือน (Email, Teams, Line) และแก้ไข Template อีเมลของระบบ",
    },
    {
      id: "done",
      target: null,
      title: "พร้อมใช้งานแล้ว!",
      body: "คุณสามารถเริ่มสร้าง Memo หรือตรวจสอบกล่องขาเข้าได้เลย หากต้องการดูคู่มืออีกครั้ง ติดต่อ Admin ได้ตลอด",
    },
  ];

  return steps.filter(s => !s.roles || s.roles.includes(role));
}

export function getEffectiveTarget(step) {
  if (!step?.target) return null;
  if (step.desktopOnly && typeof window !== "undefined" && window.innerWidth <= 640) return null;
  return step.target;
}
