import { literals } from "convex-helpers/validators";
import {
  type GenericDataModel,
  type GenericMutationCtx,
  type GenericQueryCtx,
} from "convex/server";
import { type Infer, v } from "convex/values";

export const onEmailEvent = v.object({
  fnHandle: v.string(),
});

export const onSmsEvent = v.object({
  fnHandle: v.string(),
});

export const vStatus = v.union(
  v.literal("waiting"),
  v.literal("queued"),
  v.literal("cancelled"),
  v.literal("sent"),
  v.literal("delivered"),
  v.literal("delivery_delayed"),
  v.literal("bounced"),
  v.literal("failed"),
);
export type Status = Infer<typeof vStatus>;

export const vSmsStatus = v.union(
  v.literal("waiting"),
  v.literal("queued"),
  v.literal("cancelled"),
  v.literal("sent"),
  v.literal("accepted"),
  v.literal("delivered"),
  v.literal("soft_bounced"),
  v.literal("hard_bounced"),
  v.literal("rejected"),
  v.literal("failed"),
);
export type SmsStatus = Infer<typeof vSmsStatus>;

export const vRecipient = v.object({
  email: v.string(),
  name: v.optional(v.string()),
});
export type Recipient = Infer<typeof vRecipient>;

export const vParams = v.record(
  v.string(),
  v.union(v.string(), v.number(), v.boolean()),
);
export type Params = Infer<typeof vParams>;

export const vHeaders = v.record(v.string(), v.string());
export type Headers = Infer<typeof vHeaders>;

export const vOptions = v.object({
  initialBackoffMs: v.number(),
  retryAttempts: v.number(),
  apiKey: v.string(),
  sandboxMode: v.boolean(),
  onEmailEvent: v.optional(onEmailEvent),
  onSmsEvent: v.optional(onSmsEvent),
  smsWebhookBaseUrl: v.optional(v.string()),
  smsWebhookSecret: v.optional(v.string()),
});

export type RuntimeConfig = Infer<typeof vOptions>;

export const vStoredTemplate = v.object({
  templateId: v.number(),
  params: v.optional(vParams),
});
export type StoredTemplate = Infer<typeof vStoredTemplate>;

export const BREVO_EVENT_TYPES = [
  "sent",
  "delivered",
  "deferred",
  "opened",
  "clicked",
  "soft_bounce",
  "softBounce",
  "hard_bounce",
  "hardBounce",
  "invalid_email",
  "invalidEmail",
  "complaint",
  "complained",
  "unsubscribed",
  "blocked",
  "error",
] as const;

export const vEventType = v.union(literals(...BREVO_EVENT_TYPES));

export const vEmailEvent = v.object({
  event: vEventType,
  email: v.optional(v.string()),
  id: v.optional(v.union(v.number(), v.string())),
  date: v.optional(v.string()),
  ts: v.optional(v.number()),
  ts_event: v.optional(v.number()),
  ts_epoch: v.optional(v.number()),
  subject: v.optional(v.string()),
  reason: v.optional(v.string()),
  message: v.optional(v.string()),
  tag: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
  url: v.optional(v.string()),
  link: v.optional(v.string()),
  sending_ip: v.optional(v.string()),
  "message-id": v.string(),
});

export type EmailEvent = Infer<typeof vEmailEvent>;
export type EventType = EmailEvent["event"];

export const BREVO_SMS_EVENT_TYPES = [
  "sent",
  "accepted",
  "delivered",
  "replied",
  "soft_bounce",
  "hard_bounce",
  "subscribe",
  "unsubscribe",
  "skip",
  "rejected",
  "blacklisted",
] as const;

export const vSmsEventType = v.union(literals(...BREVO_SMS_EVENT_TYPES));

export const vSmsEvent = v.object({
  id: v.optional(v.number()),
  to: v.optional(v.string()),
  sms_count: v.optional(v.number()),
  credits_used: v.optional(v.number()),
  remaining_credit: v.optional(v.number()),
  messageId: v.union(v.number(), v.string()),
  msg_status: vSmsEventType,
  date: v.optional(v.string()),
  type: v.optional(v.string()),
  reference: v.optional(v.any()),
  status: v.optional(v.string()),
  description: v.optional(v.string()),
  tag: v.optional(v.union(v.array(v.string()), v.string())),
  ts_event: v.optional(v.union(v.number(), v.string())),
  error_code: v.optional(v.number()),
  bounce_type: v.optional(v.string()),
  reply: v.optional(v.string()),
});

export type SmsEvent = Infer<typeof vSmsEvent>;
export type SmsEventType = SmsEvent["msg_status"];

export type RunQueryCtx = {
  runQuery: GenericQueryCtx<GenericDataModel>["runQuery"];
};
export type RunMutationCtx = {
  runMutation: GenericMutationCtx<GenericDataModel>["runMutation"];
};
