export const normalizeEmail = email => String(email || "").trim().toLowerCase();

export function emailToKey(email) {
  return normalizeEmail(email).replace(/\./g, ",");
}

export function normalizeAcknowledgements(raw) {
  if (!raw || typeof raw !== "object") return {};
  const result = {};
  for (const [key, val] of Object.entries(raw)) {
    const email = normalizeEmail(val?.email || String(key).replace(/,/g, "."));
    if (email) result[email] = { ...val, email };
  }
  return result;
}

export function buildMemoShareLink(memo, appUrl = "", recipientEmail = "") {
  const base = appUrl || (typeof window !== "undefined" ? window.location.origin : "");
  if (!memo?.id || !memo?.shareToken) return base;
  const url = new URL(base);
  url.searchParams.set("viewMemo", memo.id);
  url.searchParams.set("token", memo.shareToken);
  const recipient = normalizeEmail(recipientEmail);
  if (recipient) url.searchParams.set("recipient", recipient);
  return url.toString();
}

export function buildApprovedEmailRecipients(memo, users) {
  const recipients = new Map();
  const addRecipient = ({ email, name, userId, source }) => {
    const normalized = normalizeEmail(email);
    if (!normalized) return;
    const existing = recipients.get(normalized);
    if (existing) {
      recipients.set(normalized, {
        ...existing,
        source: existing.source === "creator" || source === "creator" ? "creator" : existing.source,
      });
      return;
    }
    recipients.set(normalized, { email: String(email).trim(), name: name || "", userId: userId || null, source });
  };

  const creator = (users || []).find(u => u.id === memo.createdBy) || {};
  addRecipient({ email: creator.email, name: creator.name, userId: creator.id, source: "creator" });

  for (const email of memo.notify?.emailList || []) {
    const u = (users || []).find(user => normalizeEmail(user.email) === normalizeEmail(email)) || {};
    addRecipient({ email, name: u.name || email, userId: u.id, source: "notifyList" });
  }

  return [...recipients.values()];
}

export function getMemoAcknowledgements(memo) {
  return normalizeAcknowledgements(memo?.acknowledgements);
}

export function isRecipientAcknowledged(memo, email) {
  const key = normalizeEmail(email);
  return !!getMemoAcknowledgements(memo)[key];
}

export function getAckSummary(memo, users) {
  const recipients = buildApprovedEmailRecipients(memo, users);
  const acks = getMemoAcknowledgements(memo);
  const acknowledged = recipients.filter(r => acks[normalizeEmail(r.email)]);
  return {
    recipients,
    acknowledged,
    total: recipients.length,
    ackCount: acknowledged.length,
    pendingCount: recipients.length - acknowledged.length,
    allAcked: recipients.length > 0 && acknowledged.length === recipients.length,
  };
}

export function canAcknowledgeMemo(memo, users, email) {
  if (memo?.status !== "approved") return false;
  const key = normalizeEmail(email);
  if (!key || isRecipientAcknowledged(memo, key)) return false;
  return isValidAckRecipient(memo, users, key);
}

export function isValidAckRecipient(memo, users, email) {
  const key = normalizeEmail(email);
  if (!key) return false;
  return buildApprovedEmailRecipients(memo, users).some(r => normalizeEmail(r.email) === key);
}

export function getMemoCreatorSearchText(memo, users = []) {
  const u = users.find(x => x.id === memo.createdBy) || {};
  return [u.name, u.nickname, u.email, u.loginId, u.dept].filter(Boolean).join(" ").toLowerCase();
}

export function collectUniqueCreators(memoList, users) {
  const map = new Map();
  for (const memo of memoList || []) {
    const id = memo.createdBy;
    if (!id || map.has(id)) continue;
    const u = users.find(x => x.id === id) || {};
    map.set(id, { id, name: u.name || id, email: normalizeEmail(u.email) });
  }
  return [...map.values()].sort((a, b) => (a.name || "").localeCompare(b.name || "", "th"));
}

export function getMemoApproverSearchText(memo, users = []) {
  const parts = [];
  for (const lv of memo.workflowLevels || []) {
    for (const ap of lv.approvers || []) {
      const u = users.find(x => x.id === ap.userId) || {};
      parts.push(ap.name, ap.email, u.name, u.nickname, u.loginId, u.dept);
    }
  }
  return parts.filter(Boolean).join(" ").toLowerCase();
}

export function collectUniqueApprovers(memoList, users) {
  const map = new Map();
  for (const memo of memoList || []) {
    for (const lv of memo.workflowLevels || []) {
      for (const ap of lv.approvers || []) {
        const u = users.find(x => x.id === ap.userId) || {};
        const email = normalizeEmail(ap.email || u.email);
        const key = ap.userId || email;
        if (!key) continue;
        if (!map.has(key)) {
          map.set(key, {
            id: ap.userId || key,
            name: ap.name || u.name || ap.email || key,
            email,
          });
        }
      }
    }
  }
  return [...map.values()].sort((a, b) => (a.name || "").localeCompare(b.name || "", "th"));
}

export function isMemoCcRecipient(memo, userEmail) {
  if (memo?.status !== "approved") return false;
  const email = normalizeEmail(userEmail);
  if (!email) return false;
  return (memo.notify?.emailList || []).some(e => normalizeEmail(e) === email);
}

export function canUserSeeMemo(memo, curUser, users = []) {
  if (!memo || !curUser || memo.deletedAt) return false;
  if (curUser.role === "superadmin") return true;
  if (curUser.viewScope === "all" || curUser.role === "admin") return true;
  if (memo.createdBy === curUser.id) return true;
  const isApprover = (memo.workflowLevels || []).flatMap(lv => lv.approvers || [])
    .some(ap => (ap.userId && ap.userId === curUser.id) || (normalizeEmail(ap.email) === normalizeEmail(curUser.email)));
  if (isApprover) return true;
  if (isMemoCcRecipient(memo, curUser.email)) return true;
  const scope = curUser.viewScope || "dept";
  if (scope === "dept" && curUser.dept) {
    const creator = users.find(u => u.id === memo.createdBy);
    const memoDept = memo.dept || creator?.dept;
    if (memoDept && memoDept === curUser.dept) return true;
  }
  return false;
}

export function isMemoDeleted(memo) {
  return !!memo?.deletedAt;
}

export function filterActiveMemos(memoList) {
  return (memoList || []).filter(m => !isMemoDeleted(m));
}

export function filterTrashMemos(memoList) {
  return (memoList || []).filter(m => isMemoDeleted(m));
}
