/** Production URL — reset links in email must use this, never Vercel preview deployments. */
export const PRODUCTION_APP_URL = "https://ememo-thaisausagemarketing.vercel.app";

/** Preview deployments require Vercel team login and block external users. */
const PREVIEW_HOST_PATTERN = /(?:-[a-z0-9-]+-projects|-git-[a-z0-9-]+-[a-z0-9]+)\.vercel\.app$/i;

export function isPreviewDeploymentHost(hostname) {
  return PREVIEW_HOST_PATTERN.test(String(hostname || ""));
}

export function resolveAppUrl(configuredUrl) {
  const trimmed = String(configuredUrl || "").trim().replace(/\/+$/, "");
  if (!trimmed) return PRODUCTION_APP_URL;

  try {
    const host = new URL(trimmed).hostname;
    if (isPreviewDeploymentHost(host)) {
      console.warn(`[app-url] Ignoring preview APP_URL (${host}) — using production URL for email links`);
      return PRODUCTION_APP_URL;
    }
    return trimmed;
  } catch {
    console.warn("[app-url] Invalid APP_URL — using production URL");
    return PRODUCTION_APP_URL;
  }
}

export function getAppUrl() {
  return resolveAppUrl(process.env.APP_URL);
}
