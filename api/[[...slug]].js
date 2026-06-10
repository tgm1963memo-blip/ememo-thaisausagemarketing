/**
 * Single Vercel Serverless Function router — Hobby plan allows max 12 functions.
 * All /api/* routes are dispatched here; handlers live in server/handlers/.
 */
import handleAiAssist from "../server/handlers/ai-assist.js";
import handleApprovalNotify from "../server/handlers/approval-notify.js";
import handlePublicMemo from "../server/handlers/public-memo.js";
import handleAcknowledgeMemo from "../server/handlers/acknowledge-memo.js";
import handleBackfillShareTokens from "../server/handlers/backfill-share-tokens.js";
import handleSendResetEmail from "../server/handlers/send-reset-email.js";
import handleSendEmail from "../server/handlers/send-email.js";
import handleUpdateAuthPassword from "../server/handlers/update-auth-password.js";
import handleLineWebhook from "../server/handlers/line-webhook.js";
import handleLinePush from "../server/handlers/line-push.js";

const ROUTES = {
  "ai-assist": handleAiAssist,
  "approval-notify": handleApprovalNotify,
  "public-memo": handlePublicMemo,
  "acknowledge-memo": handleAcknowledgeMemo,
  "backfill-share-tokens": handleBackfillShareTokens,
  "send-reset-email": handleSendResetEmail,
  "send-email": handleSendEmail,
  "update-auth-password": handleUpdateAuthPassword,
  "line-webhook": handleLineWebhook,
  "line-push": handleLinePush,
};

function resolveRoute(req) {
  const slug = req.query?.slug;
  if (Array.isArray(slug) && slug.length) return slug.join("/");
  if (typeof slug === "string" && slug) return slug;

  try {
    const pathname = new URL(req.url || "", "http://localhost").pathname;
    const match = pathname.match(/^\/api\/(.+)$/);
    return match ? match[1] : "";
  } catch {
    return "";
  }
}

export default async function handler(req, res) {
  const route = resolveRoute(req);
  const fn = ROUTES[route];

  if (!fn) {
    return res.status(404).json({
      error: "NOT_FOUND",
      message: `Unknown API route: /api/${route || "(empty)"}`,
      available: Object.keys(ROUTES),
    });
  }

  return fn(req, res);
}
