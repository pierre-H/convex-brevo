import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  vEventType,
  vHeaders,
  vOptions,
  vParams,
  vRecipient,
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
});
