import {
  DEFAULT_TEMPLATES,
  buildEmailVars,
  renderTemplate,
  getTemplateForType,
  resolveTemplateType,
} from "../api/email-templates.js";
import { getAppUrl, isPreviewDeploymentHost, PRODUCTION_APP_URL, resolveAppUrl } from "../api/app-url.js";

const previewUrl = "https://ememo-thaisausagemarketing-tgm1963memo-blips-projects.vercel.app";
console.assert(resolveAppUrl(previewUrl) === PRODUCTION_APP_URL, "preview URL must resolve to production");
console.assert(resolveAppUrl("https://ememo-thaisausagemarketing.vercel.app") === "https://ememo-thaisausagemarketing.vercel.app");
console.assert(isPreviewDeploymentHost("ememo-thaisausagemarketing-tgm1963memo-blips-projects.vercel.app"));
console.assert(!isPreviewDeploymentHost("ememo-thaisausagemarketing.vercel.app"));
console.log("✓ app-url");

const vars = buildEmailVars({
  name: "สมชาย",
  email: "somchai@tgm.co.th",
  loginId: "somchai",
  password: "Test123!",
  resetLink: "https://example.com/?mode=resetPassword&oobCode=abc",
  appUrl: "https://example.com",
  templateType: "new",
});

for (const type of ["forgot", "new", "update"]) {
  const tpl = getTemplateForType(null, type);
  const rendered = renderTemplate(tpl, { ...vars, templateType: type });
  if (!rendered.subject || !rendered.html.includes("https://example.com")) {
    throw new Error(`Template ${type} failed validation`);
  }
  console.log(`✓ ${type}: ${rendered.subject}`);
}

console.assert(resolveTemplateType({ isNew: true }) === "new");
console.assert(resolveTemplateType({ templateType: "forgot" }) === "forgot");
console.log("✓ resolveTemplateType");
console.log("All email template tests passed");
