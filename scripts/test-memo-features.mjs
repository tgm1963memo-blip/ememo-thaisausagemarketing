import assert from "node:assert/strict";
import {
  normalizeEmail,
  emailToKey,
  normalizeAcknowledgements,
  buildApprovedEmailRecipients,
  buildMemoShareLink,
  getAckSummary,
  isValidAckRecipient,
  canAcknowledgeMemo,
  getMemoApproverSearchText,
  collectUniqueApprovers,
} from "../src/memoHelpers.js";

const users = [
  { id: "u1", name: "สมชาย", email: "somchai@tgm.co.th" },
  { id: "u2", name: "สมหญิง", email: "somying@tgm.co.th" },
  { id: "u3", name: "ผู้อนุมัติ", email: "approver@tgm.co.th", nickname: "Boss" },
];

const memo = {
  id: "m1",
  title: "ขออนุมัติงบ",
  content: "รายละเอียด",
  status: "approved",
  createdBy: "u1",
  shareToken: "abc123",
  notify: { emailList: ["cc@external.com", "somying@tgm.co.th"] },
  workflowLevels: [
    {
      level: 1,
      approvers: [{ userId: "u3", name: "ผู้อนุมัติ", email: "approver@tgm.co.th", status: "approved" }],
    },
  ],
  acknowledgements: {
    "somchai@tgm,co,th": { email: "somchai@tgm.co.th", name: "สมชาย", at: "2026-06-01T10:00:00.000Z", via: "link" },
  },
};

// normalizeEmail
assert.equal(normalizeEmail("  Test@Example.COM "), "test@example.com");

// emailToKey
assert.equal(emailToKey("somchai@tgm.co.th"), "somchai@tgm,co,th");

// normalizeAcknowledgements
const acks = normalizeAcknowledgements(memo.acknowledgements);
assert.equal(acks["somchai@tgm.co.th"]?.via, "link");

// buildApprovedEmailRecipients
const recipients = buildApprovedEmailRecipients(memo, users);
assert.equal(recipients.length, 3);
assert.ok(recipients.some(r => r.email === "somchai@tgm.co.th" && r.source === "creator"));
assert.ok(recipients.some(r => r.email === "cc@external.com"));

// buildMemoShareLink with recipient
const link = buildMemoShareLink(memo, "https://example.com", "cc@external.com");
assert.ok(link.includes("viewMemo=m1"));
assert.ok(link.includes("recipient=cc%40external.com"));

// getAckSummary
const summary = getAckSummary(memo, users);
assert.equal(summary.total, 3);
assert.equal(summary.ackCount, 1);
assert.equal(summary.pendingCount, 2);

// isValidAckRecipient / canAcknowledgeMemo
assert.equal(isValidAckRecipient(memo, users, "cc@external.com"), true);
assert.equal(isValidAckRecipient(memo, users, "random@test.com"), false);
assert.equal(canAcknowledgeMemo(memo, users, "somying@tgm.co.th"), true);
assert.equal(canAcknowledgeMemo(memo, users, "somchai@tgm.co.th"), false);

// getMemoApproverSearchText
const searchText = getMemoApproverSearchText(memo, users);
assert.ok(searchText.includes("ผู้อนุมัติ"));
assert.ok(searchText.includes("approver@tgm.co.th"));
assert.ok(searchText.includes("boss"));

// collectUniqueApprovers
const approvers = collectUniqueApprovers([memo], users);
assert.equal(approvers.length, 1);
assert.equal(approvers[0].name, "ผู้อนุมัติ");

console.log("✓ memoHelpers tests passed (12 assertions)");
