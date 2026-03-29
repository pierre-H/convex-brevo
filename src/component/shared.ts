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

export type RunQueryCtx = {
  runQuery: GenericQueryCtx<GenericDataModel>["runQuery"];
};
export type RunMutationCtx = {
  runMutation: GenericMutationCtx<GenericDataModel>["runMutation"];
};
