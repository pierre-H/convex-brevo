/// <reference types="vite/client" />
import { test } from "vitest";
import type { EmailEvent, RuntimeConfig, SmsEvent } from "./shared.js";
import { convexTest } from "convex-test";
import schema from "./schema.js";
import type { Doc } from "./_generated/dataModel.js";

export const modules = import.meta.glob("./**/*.*s");

export const setupTest = () => {
  const t = convexTest(schema, modules);
  return t;
};

export type Tester = ReturnType<typeof setupTest>;

test("setup", () => {});

export const createTestEventOfType = (
  event: EmailEvent["event"],
  overrides?: Partial<EmailEvent>,
): EmailEvent => ({
  event,
  email: "recipient@example.com",
  subject: "Test Email",
  date: "2024-01-01 00:00:00",
  ts: 1704067200,
  ts_event: 1704067200,
  ts_epoch: 1704067200000,
  tags: ["transactional-test"],
  reason:
    event === "hard_bounce"
      ? "The email bounced due to invalid recipient"
      : event === "error"
        ? "SMTP server rejected the email"
        : event === "soft_bounce"
          ? "Mailbox temporarily unavailable"
          : undefined,
  "message-id": "<test-message-id-123@smtp-relay.mailin.fr>",
  ...overrides,
});

export const createTestSmsEventOfType = (
  msg_status: SmsEvent["msg_status"],
  overrides?: Partial<SmsEvent>,
): SmsEvent => ({
  id: 26519,
  to: "33680065433",
  messageId: 1511882900100020,
  msg_status,
  status: "OK",
  description:
    msg_status === "hard_bounce"
      ? "Recipient unreachable"
      : msg_status === "soft_bounce"
        ? "Carrier delayed delivery"
        : msg_status,
  date: "2024-01-01 00:00:00",
  ts_event: 1704067200,
  tag: ["transactional-test"],
  type: "transactional",
  reference: { 1: "reference-id" },
  reply: msg_status === "replied" ? "Hi" : undefined,
  ...overrides,
});

export const createTestRuntimeConfig = (): RuntimeConfig => ({
  apiKey: "test-api-key",
  sandboxMode: true,
  initialBackoffMs: 1000,
  retryAttempts: 3,
});

export const setupTestLastOptions = (
  t: Tester,
  overrides?: Partial<Doc<"lastOptions">>,
) =>
  t.run(async (ctx) => {
    await ctx.db.insert("lastOptions", {
      options: {
        ...createTestRuntimeConfig(),
      },
      ...overrides,
    });
  });

export const insertTestEmail = (
  t: Tester,
  overrides: Omit<Doc<"emails">, "_id" | "_creationTime">,
) =>
  t.run(async (ctx) => {
    const id = await ctx.db.insert("emails", overrides);
    const email = await ctx.db.get(id);
    if (!email) throw new Error("Email not found");
    return email;
  });

export const insertTestSentEmail = (
  t: Tester,
  overrides?: Partial<Doc<"emails">>,
) =>
  insertTestEmail(t, {
    sender: { email: "sender@example.com", name: "Sender" },
    to: [{ email: "recipient@example.com", name: "Recipient" }],
    subject: "Test Email",
    replyTo: { email: "reply@example.com", name: "Reply" },
    status: "sent",
    bounced: false,
    complained: false,
    failed: false,
    deliveryDelayed: false,
    opened: false,
    clicked: false,
    messageId: "<test-message-id-123@smtp-relay.mailin.fr>",
    segment: 1,
    finalizedAt: Number.MAX_SAFE_INTEGER,
    ...overrides,
  });

export const insertTestSms = (
  t: Tester,
  overrides: Omit<Doc<"sms">, "_id" | "_creationTime">,
) =>
  t.run(async (ctx) => {
    const id = await ctx.db.insert("sms", overrides);
    const sms = await ctx.db.get(id);
    if (!sms) throw new Error("SMS not found");
    return sms;
  });

export const insertTestSentSms = (t: Tester, overrides?: Partial<Doc<"sms">>) =>
  insertTestSms(t, {
    sender: "MyShop",
    recipient: "33680065433",
    content: "Enter this code: CAAA08",
    tag: "transactional-test",
    unicodeEnabled: false,
    organisationPrefix: "MyCompany",
    status: "sent",
    accepted: false,
    delivered: false,
    replied: false,
    softBounced: false,
    hardBounced: false,
    rejected: false,
    blacklisted: false,
    unsubscribed: false,
    messageId: "1511882900100020",
    segment: 1,
    finalizedAt: Number.MAX_SAFE_INTEGER,
    ...overrides,
  });
