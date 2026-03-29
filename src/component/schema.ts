import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  vEventType,
  vHeaders,
  vOptions,
  vParams,
  vRecipient,
  vSmsEventType,
  vSmsStatus,
  vStatus,
} from "./shared.js";

export default defineSchema({
  content: defineTable({
    content: v.bytes(),
    mimeType: v.string(),
    filename: v.optional(v.string()),
    path: v.optional(v.string()),
  }),
  nextBatchRun: defineTable({
    runId: v.id("_scheduled_functions"),
  }),
  nextSmsBatchRun: defineTable({
    runId: v.id("_scheduled_functions"),
  }),
  lastOptions: defineTable({
    options: vOptions,
  }),
  deliveryEvents: defineTable({
    emailId: v.id("emails"),
    messageId: v.string(),
    eventType: vEventType,
    createdAt: v.string(),
    message: v.optional(v.string()),
  }).index("by_emailId_eventType", ["emailId", "eventType"]),
  smsDeliveryEvents: defineTable({
    smsId: v.id("sms"),
    messageId: v.string(),
    eventType: vSmsEventType,
    createdAt: v.string(),
    message: v.optional(v.string()),
  }).index("by_smsId_eventType", ["smsId", "eventType"]),
  emails: defineTable({
    sender: vRecipient,
    to: v.array(vRecipient),
    cc: v.optional(v.array(vRecipient)),
    bcc: v.optional(v.array(vRecipient)),
    subject: v.optional(v.string()),
    replyTo: v.optional(vRecipient),
    html: v.optional(v.id("content")),
    text: v.optional(v.id("content")),
    templateId: v.optional(v.number()),
    params: v.optional(vParams),
    headers: v.optional(vHeaders),
    tags: v.optional(v.array(v.string())),
    status: vStatus,
    complained: v.boolean(),
    errorMessage: v.optional(v.string()),
    opened: v.boolean(),
    bounced: v.optional(v.boolean()),
    failed: v.optional(v.boolean()),
    deliveryDelayed: v.optional(v.boolean()),
    clicked: v.optional(v.boolean()),
    messageId: v.optional(v.string()),
    segment: v.number(),
    finalizedAt: v.number(),
  })
    .index("by_status_segment", ["status", "segment"])
    .index("by_messageId", ["messageId"])
    .index("by_finalizedAt", ["finalizedAt"]),
  sms: defineTable({
    sender: v.string(),
    recipient: v.string(),
    content: v.string(),
    tag: v.optional(v.string()),
    unicodeEnabled: v.optional(v.boolean()),
    organisationPrefix: v.optional(v.string()),
    status: vSmsStatus,
    errorMessage: v.optional(v.string()),
    messageId: v.optional(v.string()),
    reply: v.optional(v.string()),
    accepted: v.boolean(),
    delivered: v.boolean(),
    replied: v.boolean(),
    softBounced: v.boolean(),
    hardBounced: v.boolean(),
    rejected: v.boolean(),
    blacklisted: v.boolean(),
    unsubscribed: v.boolean(),
    segment: v.number(),
    finalizedAt: v.number(),
  })
    .index("by_status_segment", ["status", "segment"])
    .index("by_messageId", ["messageId"])
    .index("by_finalizedAt", ["finalizedAt"]),
});
