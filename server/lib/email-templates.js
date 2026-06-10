export const COMPANY = "บริษัท ไทยซอสเซส มาร์เก็ตติ้ง จำกัด";
export const DATA_PATH = "ememo/data";

export const TEMPLATE_KEY_BY_TYPE = {
  forgot: "forgotPassword",
  new: "newAccount",
  update: "accountUpdated",
};

const WRAPPER = (body) => `
<div style="font-family:'Noto Sans Thai',Sarabun,Arial,sans-serif;max-width:560px;margin:0 auto;background:#fff;">
  <div style="background:#1E3A5F;padding:20px 28px;border-radius:8px 8px 0 0;">
    <div style="font-size:16px;font-weight:700;color:#fff;">{{company}}</div>
    <div style="font-size:11px;color:rgba(255,255,255,.7);margin-top:2px;">E-Memo System</div>
  </div>
  <div style="border:1px solid #E5E7EB;border-top:3px solid #D4AF37;padding:28px;border-radius:0 0 8px 8px;">
    ${body}
    <div style="border-top:1px solid #F3F4F6;margin-top:24px;padding-top:14px;font-size:10px;color:#D1D5DB;text-align:center;">
      {{company}} - E-Memo System
    </div>
  </div>
</div>`;

const CREDENTIALS_BLOCK = `
{{credentialsBlock}}
`;

const RESET_BLOCK = `
<div style="text-align:center;margin:24px 0;">
  <a href="{{resetLink}}" style="background:#D4AF37;color:#111;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px;display:inline-block;">
    {{actionText}}
  </a>
</div>
<p style="margin:0 0 12px;font-size:12px;color:#6B7280;line-height:1.7;">
  หากปุ่มไม่ทำงาน ให้คัดลอกลิงก์นี้ไปเปิดในเบราว์เซอร์:<br/>
  <a href="{{resetLink}}" style="color:#1E3A5F;color:#1E3A5F;word-break:break-all;">{{resetLink}}</a>
</p>
<p style="margin:0 0 4px;font-size:11px;color:#9CA3AF;">ลิงก์มีอายุ 1 ชั่วโมง</p>
<p style="margin:0;font-size:11px;color:#9CA3AF;">หลังตั้งรหัสผ่านแล้วให้กลับเข้าใช้งานที่ <a href="{{appUrl}}" style="color:#1E3A5F;">{{appUrl}}</a></p>`;

export function buildCredentialsBlockHtml(loginId, password) {
  if (!loginId && !password) return "";
  return `
<div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:16px;margin:16px 0;">
  <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:10px;">ข้อมูลเข้าใช้งาน</div>
  ${loginId ? `<div style="font-size:13px;color:#111;margin-bottom:6px;"><span style="color:#6B7280;">Username:</span> <strong>${escapeHtml(loginId)}</strong></div>` : ""}
  ${password ? `<div style="font-size:13px;color:#111;margin-bottom:6px;"><span style="color:#6B7280;">Password:</span> <strong>${escapeHtml(password)}</strong></div>` : ""}
  <div style="font-size:11px;color:#B45309;margin-top:8px;line-height:1.6;">กรุณาเปลี่ยนรหัสผ่านหลังเข้าใช้งานครั้งแรก หรือใช้ลิงก์ด้านล่างเพื่อตั้งรหัสผ่านใหม่ทันที</div>
</div>`;
}

export function buildCredentialsBlockText(loginId, password) {
  if (!loginId && !password) return "";
  const lines = ["ข้อมูลเข้าใช้งาน:"];
  if (loginId) lines.push(`Username: ${loginId}`);
  if (password) lines.push(`Password: ${password}`);
  lines.push("กรุณาเปลี่ยนรหัสผ่านหลังเข้าใช้งานครั้งแรก");
  return lines.join("\n");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderTemplate(template, vars) {
  const merged = { company: COMPANY, ...vars };
  const replace = (str) =>
    String(str || "").replace(/\{\{(\w+)\}\}/g, (_, key) => {
      const val = merged[key];
      return val != null ? String(val) : "";
    });

  return {
    subject: replace(template.subject),
    html: replace(template.html),
    text: replace(template.text),
  };
}

export const DEFAULT_TEMPLATES = {
  forgotPassword: {
    subject: "[E-Memo] รีเซ็ตรหัสผ่าน E-Memo",
    html: WRAPPER(`
<p style="margin:0 0 14px;font-size:14px;line-height:1.7;color:#111;">
  เรียน {{greeting}}<br/>
  เราได้รับคำขอรีเซ็ตรหัสผ่านสำหรับบัญชี <strong>{{email}}</strong>
</p>
${RESET_BLOCK.replace(/\{\{actionText\}\}/g, "รีเซ็ตรหัสผ่าน")}`),
    text: `เรียน {{greeting}}\n\nเราได้รับคำขอรีเซ็ตรหัสผ่านสำหรับบัญชี {{email}}\n\nรีเซ็ตรหัสผ่าน: {{resetLink}}\n\nหลังตั้งรหัสผ่านแล้วให้กลับเข้าใช้งานที่ {{appUrl}}\nลิงก์มีอายุ 1 ชั่วโมง`,
  },
  newAccount: {
    subject: "[E-Memo] ตั้งรหัสผ่านสำหรับบัญชีของคุณ",
    html: WRAPPER(`
<p style="margin:0 0 14px;font-size:14px;line-height:1.7;color:#111;">
  เรียน {{greeting}}<br/>
  บัญชี E-Memo ของคุณถูกสร้างแล้ว กรุณาใช้ข้อมูลด้านล่างเพื่อเข้าใช้งาน
</p>
${CREDENTIALS_BLOCK}
${RESET_BLOCK.replace(/\{\{actionText\}\}/g, "ตั้งรหัสผ่าน")}`),
    text: `เรียน {{greeting}}\n\nบัญชี E-Memo ของคุณถูกสร้างแล้ว\n\n{{credentialsText}}\n\nตั้งรหัสผ่าน: {{resetLink}}\n\nหลังตั้งรหัสผ่านแล้วให้กลับเข้าใช้งานที่ {{appUrl}}\nลิงก์มีอายุ 1 ชั่วโมง`,
  },
  accountUpdated: {
    subject: "[E-Memo] ข้อมูลบัญชีของคุณได้รับการอัปเดต",
    html: WRAPPER(`
<p style="margin:0 0 14px;font-size:14px;line-height:1.7;color:#111;">
  เรียน {{greeting}}<br/>
  ข้อมูลบัญชี E-Memo ของคุณได้รับการอัปเดตจากผู้ดูแลระบบ
</p>
${CREDENTIALS_BLOCK}
${RESET_BLOCK.replace(/\{\{actionText\}\}/g, "ตั้งรหัสผ่านใหม่")}`),
    text: `เรียน {{greeting}}\n\nข้อมูลบัญชี E-Memo ของคุณได้รับการอัปเดต\n\n{{credentialsText}}\n\nตั้งรหัสผ่านใหม่: {{resetLink}}\n\nหลังตั้งรหัสผ่านแล้วให้กลับเข้าใช้งานที่ {{appUrl}}\nลิงก์มีอายุ 1 ชั่วโมง`,
  },
};

export function resolveTemplateType(body) {
  if (body.templateType === "forgot" || body.templateType === "new" || body.templateType === "update") {
    return body.templateType;
  }
  if (body.isNew === true) return "new";
  return "forgot";
}

export function getTemplateForType(storedTemplates, templateType) {
  const key = TEMPLATE_KEY_BY_TYPE[templateType] || "forgotPassword";
  const stored = storedTemplates?.[key];
  const defaults = DEFAULT_TEMPLATES[key];
  if (!stored) return defaults;
  return {
    subject: stored.subject || defaults.subject,
    html: stored.html || defaults.html,
    text: stored.text || defaults.text,
  };
}

export function buildEmailVars({ name, email, loginId, password, resetLink, appUrl, templateType }) {
  const greeting = name ? `คุณ${name}` : email;
  const credentialsBlock = buildCredentialsBlockHtml(loginId, password);
  const credentialsText = buildCredentialsBlockText(loginId, password);
  const actionText =
    templateType === "new" ? "ตั้งรหัสผ่าน" :
    templateType === "update" ? "ตั้งรหัสผ่านใหม่" :
    "รีเซ็ตรหัสผ่าน";

  return {
    name: name || "",
    greeting,
    username: loginId || "",
    email: email || "",
    password: password || "",
    resetLink: resetLink || "",
    appUrl: appUrl || "",
    company: COMPANY,
    credentialsBlock,
    credentialsText,
    actionText,
  };
}
