export const normalizeEmail = email => String(email || "").trim().toLowerCase();

export function emailToKey(email) {
  return normalizeEmail(email).replace(/\./g, ",");
}

export function buildApprovedEmailRecipients(memo, users) {
  const recipients = new Map();
  const add = ({ email, name, userId, source }) => {
    const key = normalizeEmail(email);
    if (!key) return;
    const existing = recipients.get(key);
    if (existing) {
      recipients.set(key, {
        ...existing,
        source: existing.source === "creator" || source === "creator" ? "creator" : existing.source,
      });
      return;
    }
    recipients.set(key, { email: String(email).trim(), name: name || "", userId: userId || null, source });
  };
  const creator = (users || []).find(u => u.id === memo.createdBy) || {};
  add({ email: creator.email, name: creator.name, userId: creator.id, source: "creator" });
  for (const email of memo.notify?.emailList || []) {
    const u = (users || []).find(user => normalizeEmail(user.email) === normalizeEmail(email)) || {};
    add({ email, name: u.name || email, userId: u.id, source: "notifyList" });
  }
  return recipients;
}
