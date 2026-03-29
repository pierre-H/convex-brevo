import { v } from "convex/values";
import {
  internalAction,
  mutation,
  type MutationCtx,
  query,
  internalQuery,
  type ActionCtx,
} from "./_generated/server.js";
import { Workpool } from "@convex-dev/workpool";
import { RateLimiter } from "@convex-dev/rate-limiter";
import { api, components, internal } from "./_generated/api.js";
import { internalMutation } from "./_generated/server.js";
import { type Id, type Doc } from "./_generated/dataModel.js";
import {
  type RuntimeConfig,
  vEmailEvent,
  vHeaders,
  vOptions,
  vParams,
  vRecipient,
  vSmsEvent,
  vSmsStatus,
  vStatus,
} from "./shared.js";
import type { FunctionHandle } from "convex/server";
import type {
  EmailEvent,
  RunMutationCtx,
  RunQueryCtx,
  SmsEvent,
} from "./shared.js";
import { isDeepEqual } from "remeda";
import schema from "./schema.js";
import { omit } from "convex-helpers";
import { parse } from "convex-helpers/validators";
import { assertExhaustive, attemptToParse } from "./utils.js";

const SEGMENT_MS = 125;
const BASE_BATCH_DELAY = 1000;
const BATCH_SIZE = 1;
const EMAIL_POOL_SIZE = 4;
const CALLBACK_POOL_SIZE = 4;
const BREVO_ONE_CALL_EVERY_MS = 600;
const FINALIZED_EMAIL_RETENTION_MS = 1000 * 60 * 60 * 24 * 7;
const FINALIZED_EPOCH = Number.MAX_SAFE_INTEGER;
const ABANDONED_EMAIL_RETENTION_MS = 1000 * 60 * 60 * 24 * 30;

const PERMANENT_ERROR_CODES = new Set([
  400, 401, 403, 404, 405, 406, 407, 408, 410, 411, 413, 414, 415, 416, 418,
  421, 422, 426, 427, 428, 431,
]);

function getSegment(now: number) {
  return Math.floor(now / SEGMENT_MS);
}

const emailPool = new Workpool(components.emailWorkpool, {
  maxParallelism: EMAIL_POOL_SIZE,
});

const callbackPool = new Workpool(components.callbackWorkpool, {
  maxParallelism: CALLBACK_POOL_SIZE,
});

const brevoApiRateLimiter = new RateLimiter(components.rateLimiter, {
  brevoApi: {
    kind: "fixed window",
    period: BREVO_ONE_CALL_EVERY_MS,
    rate: 1,
  },
});

export const cleanupOldEmails = mutation({
  args: { olderThan: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const olderThan = args.olderThan ?? FINALIZED_EMAIL_RETENTION_MS;
    const oldAndDone = await ctx.db
      .query("emails")
      .withIndex("by_finalizedAt", (q) =>
        q.lt("finalizedAt", Date.now() - olderThan),
      )
      .take(100);
    for (const email of oldAndDone) {
      await cleanupEmail(ctx, email);
    }
    if (oldAndDone.length > 0) {
      console.log(`Cleaned up ${oldAndDone.length} emails`);
    }
    if (oldAndDone.length === 100) {
      await ctx.scheduler.runAfter(0, api.lib.cleanupOldEmails, {
        olderThan,
      });
    }
  },
});

export const sendEmail = mutation({
  args: {
    options: vOptions,
    sender: vRecipient,
    to: v.array(vRecipient),
    cc: v.optional(v.array(vRecipient)),
    bcc: v.optional(v.array(vRecipient)),
    subject: v.optional(v.string()),
    htmlContent: v.optional(v.string()),
    textContent: v.optional(v.string()),
    templateId: v.optional(v.number()),
    params: v.optional(vParams),
    replyTo: v.optional(vRecipient),
    headers: v.optional(vHeaders),
    tags: v.optional(v.array(v.string())),
  },
  returns: v.id("emails"),
  handler: async (ctx, args) => {
    const bodyKinds = [
      args.htmlContent !== undefined,
      args.textContent !== undefined,
      args.templateId !== undefined,
    ].filter(Boolean).length;

    if (bodyKinds === 0) {
      throw new Error(
        "One of htmlContent, textContent, or templateId must be provided",
      );
    }
    if (bodyKinds > 1) {
      throw new Error(
        "Only one of htmlContent, textContent, or templateId may be provided",
      );
    }
    if (args.templateId === undefined && args.subject === undefined) {
      throw new Error("Subject is required when not using a templateId");
    }

    let htmlContentId: Id<"content"> | undefined;
    if (args.htmlContent !== undefined) {
      htmlContentId = await ctx.db.insert("content", {
        content: new TextEncoder().encode(args.htmlContent).buffer,
        mimeType: "text/html",
      });
    }

    let textContentId: Id<"content"> | undefined;
    if (args.textContent !== undefined) {
      textContentId = await ctx.db.insert("content", {
        content: new TextEncoder().encode(args.textContent).buffer,
        mimeType: "text/plain",
      });
    }

    const segment = getSegment(Date.now());
    const emailId = await ctx.db.insert("emails", {
      sender: args.sender,
      to: args.to,
      cc: args.cc,
      bcc: args.bcc,
      subject: args.subject,
      html: htmlContentId,
      text: textContentId,
      templateId: args.templateId,
      params: args.params,
      headers: args.headers,
      tags: args.tags,
      segment,
      status: "waiting",
      bounced: false,
      complained: false,
      failed: false,
      deliveryDelayed: false,
      opened: false,
      clicked: false,
      replyTo: args.replyTo,
      finalizedAt: FINALIZED_EPOCH,
    });

    await scheduleBatchRun(ctx, args.options);
    return emailId;
  },
});

export const createManualEmail = mutation({
  args: {
    sender: vRecipient,
    to: v.array(vRecipient),
    cc: v.optional(v.array(vRecipient)),
    bcc: v.optional(v.array(vRecipient)),
    subject: v.string(),
    replyTo: v.optional(vRecipient),
    headers: v.optional(vHeaders),
    tags: v.optional(v.array(v.string())),
  },
  returns: v.id("emails"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("emails", {
      sender: args.sender,
      to: args.to,
      cc: args.cc,
      bcc: args.bcc,
      subject: args.subject,
      headers: args.headers,
      tags: args.tags,
      segment: Infinity,
      status: "queued",
      bounced: false,
      complained: false,
      failed: false,
      deliveryDelayed: false,
      opened: false,
      clicked: false,
      replyTo: args.replyTo,
      finalizedAt: FINALIZED_EPOCH,
    });
  },
});

export const updateManualEmail = mutation({
  args: {
    emailId: v.id("emails"),
    status: vStatus,
    messageId: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const finalizedAt =
      args.status === "failed" || args.status === "cancelled"
        ? Date.now()
        : undefined;
    await ctx.db.patch(args.emailId, {
      status: args.status,
      messageId: args.messageId,
      errorMessage: args.errorMessage,
      ...(finalizedAt ? { finalizedAt } : {}),
    });
  },
});

export const cancelEmail = mutation({
  args: {
    emailId: v.id("emails"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const email = await ctx.db.get(args.emailId);
    if (!email) {
      throw new Error("Email not found");
    }
    if (email.status !== "waiting" && email.status !== "queued") {
      throw new Error("Email has already been sent");
    }
    await ctx.db.patch(args.emailId, {
      status: "cancelled",
      finalizedAt: Date.now(),
    });
  },
});

export const getStatus = query({
  args: {
    emailId: v.id("emails"),
  },
  returns: v.union(
    v.object({
      status: vStatus,
      errorMessage: v.union(v.string(), v.null()),
      bounced: v.boolean(),
      complained: v.boolean(),
      failed: v.boolean(),
      deliveryDelayed: v.boolean(),
      opened: v.boolean(),
      clicked: v.boolean(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const email = await ctx.db.get(args.emailId);
    if (!email) {
      return null;
    }
    return {
      status: email.status,
      errorMessage: email.errorMessage ?? null,
      bounced: email.bounced ?? false,
      complained: email.complained,
      failed: email.failed ?? false,
      deliveryDelayed: email.deliveryDelayed ?? false,
      opened: email.opened,
      clicked: email.clicked ?? false,
    };
  },
});

export const get = query({
  args: {
    emailId: v.id("emails"),
  },
  returns: v.union(
    v.object({
      ...omit(schema.tables.emails.validator.fields, ["html", "text"]),
      createdAt: v.number(),
      htmlContent: v.optional(v.string()),
      textContent: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const email = await ctx.db.get(args.emailId);
    if (!email) {
      return null;
    }
    const htmlContent = email.html
      ? new TextDecoder().decode((await ctx.db.get(email.html))?.content)
      : undefined;
    const textContent = email.text
      ? new TextDecoder().decode((await ctx.db.get(email.text))?.content)
      : undefined;
    return {
      ...omit(email, ["html", "text", "_id", "_creationTime"]),
      createdAt: email._creationTime,
      htmlContent,
      textContent,
    };
  },
});

export const sendSms = mutation({
  args: {
    options: vOptions,
    sender: v.string(),
    recipient: v.string(),
    content: v.string(),
    tag: v.optional(v.string()),
    unicodeEnabled: v.optional(v.boolean()),
    organisationPrefix: v.optional(v.string()),
  },
  returns: v.id("sms"),
  handler: async (ctx, args) => {
    const segment = getSegment(Date.now());
    const smsId = await ctx.db.insert("sms", {
      sender: args.sender,
      recipient: args.recipient,
      content: args.content,
      tag: args.tag,
      unicodeEnabled: args.unicodeEnabled,
      organisationPrefix: args.organisationPrefix,
      status: "waiting",
      accepted: false,
      delivered: false,
      replied: false,
      softBounced: false,
      hardBounced: false,
      rejected: false,
      blacklisted: false,
      unsubscribed: false,
      segment,
      finalizedAt: FINALIZED_EPOCH,
    });

    await scheduleSmsBatchRun(ctx, args.options);
    return smsId;
  },
});

export const createManualSms = mutation({
  args: {
    sender: v.string(),
    recipient: v.string(),
    content: v.string(),
    tag: v.optional(v.string()),
    unicodeEnabled: v.optional(v.boolean()),
    organisationPrefix: v.optional(v.string()),
  },
  returns: v.id("sms"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("sms", {
      sender: args.sender,
      recipient: args.recipient,
      content: args.content,
      tag: args.tag,
      unicodeEnabled: args.unicodeEnabled,
      organisationPrefix: args.organisationPrefix,
      status: "queued",
      accepted: false,
      delivered: false,
      replied: false,
      softBounced: false,
      hardBounced: false,
      rejected: false,
      blacklisted: false,
      unsubscribed: false,
      segment: Infinity,
      finalizedAt: FINALIZED_EPOCH,
    });
  },
});

export const updateManualSms = mutation({
  args: {
    smsId: v.id("sms"),
    status: vSmsStatus,
    messageId: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const finalizedAt =
      args.status === "failed" ||
      args.status === "cancelled" ||
      args.status === "delivered" ||
      args.status === "soft_bounced" ||
      args.status === "hard_bounced" ||
      args.status === "rejected"
        ? Date.now()
        : undefined;
    await ctx.db.patch(args.smsId, {
      status: args.status,
      messageId: args.messageId,
      errorMessage: args.errorMessage,
      ...(finalizedAt ? { finalizedAt } : {}),
    });
  },
});

export const cancelSms = mutation({
  args: {
    smsId: v.id("sms"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const sms = await ctx.db.get(args.smsId);
    if (!sms) {
      throw new Error("SMS not found");
    }
    if (sms.status !== "waiting" && sms.status !== "queued") {
      throw new Error("SMS has already been sent");
    }
    await ctx.db.patch(args.smsId, {
      status: "cancelled",
      finalizedAt: Date.now(),
    });
  },
});

export const getSmsStatus = query({
  args: {
    smsId: v.id("sms"),
  },
  returns: v.union(
    v.object({
      status: vSmsStatus,
      errorMessage: v.union(v.string(), v.null()),
      accepted: v.boolean(),
      delivered: v.boolean(),
      replied: v.boolean(),
      softBounced: v.boolean(),
      hardBounced: v.boolean(),
      rejected: v.boolean(),
      blacklisted: v.boolean(),
      unsubscribed: v.boolean(),
      reply: v.union(v.string(), v.null()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const sms = await ctx.db.get(args.smsId);
    if (!sms) {
      return null;
    }
    return {
      status: sms.status,
      errorMessage: sms.errorMessage ?? null,
      accepted: sms.accepted,
      delivered: sms.delivered,
      replied: sms.replied,
      softBounced: sms.softBounced,
      hardBounced: sms.hardBounced,
      rejected: sms.rejected,
      blacklisted: sms.blacklisted,
      unsubscribed: sms.unsubscribed,
      reply: sms.reply ?? null,
    };
  },
});

export const getSms = query({
  args: {
    smsId: v.id("sms"),
  },
  returns: v.union(
    v.object({
      ...schema.tables.sms.validator.fields,
      createdAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const sms = await ctx.db.get(args.smsId);
    if (!sms) {
      return null;
    }
    return {
      ...omit(sms, ["_id", "_creationTime"]),
      createdAt: sms._creationTime,
    };
  },
});

async function scheduleBatchRun(ctx: MutationCtx, options: RuntimeConfig) {
  const lastOptions = await ctx.db.query("lastOptions").unique();
  if (!lastOptions) {
    await ctx.db.insert("lastOptions", {
      options,
    });
  } else if (!isDeepEqual(lastOptions.options, options)) {
    await ctx.db.replace(lastOptions._id, {
      options,
    });
  }

  const existing = await ctx.db.query("nextBatchRun").unique();
  if (existing) {
    return;
  }

  const runId = await ctx.scheduler.runAfter(
    BASE_BATCH_DELAY,
    internal.lib.makeBatch,
    { reloop: false, segment: getSegment(Date.now() + BASE_BATCH_DELAY) },
  );

  await ctx.db.insert("nextBatchRun", {
    runId,
  });
}

async function scheduleSmsBatchRun(ctx: MutationCtx, options: RuntimeConfig) {
  const lastOptions = await ctx.db.query("lastOptions").unique();
  if (!lastOptions) {
    await ctx.db.insert("lastOptions", {
      options,
    });
  } else if (!isDeepEqual(lastOptions.options, options)) {
    await ctx.db.replace(lastOptions._id, {
      options,
    });
  }

  const existing = await ctx.db.query("nextSmsBatchRun").unique();
  if (existing) {
    return;
  }

  const runId = await ctx.scheduler.runAfter(
    BASE_BATCH_DELAY,
    internal.lib.makeSmsBatch,
    { reloop: false, segment: getSegment(Date.now() + BASE_BATCH_DELAY) },
  );

  await ctx.db.insert("nextSmsBatchRun", {
    runId,
  });
}

export const makeBatch = internalMutation({
  args: { reloop: v.boolean(), segment: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const lastOptions = await ctx.db.query("lastOptions").unique();
    if (!lastOptions) {
      throw new Error("No last options found -- invariant");
    }
    const options = lastOptions.options;

    const emails = await ctx.db
      .query("emails")
      .withIndex("by_status_segment", (q) =>
        q.eq("status", "waiting").lte("segment", args.segment - 2),
      )
      .take(BATCH_SIZE);

    if (emails.length === 0 || (args.reloop && emails.length < BATCH_SIZE)) {
      return reschedule(ctx, emails.length > 0);
    }

    console.log(`Making a batch of ${emails.length} emails`);

    for (const email of emails) {
      await ctx.db.patch(email._id, {
        status: "queued",
      });
    }

    const delay = await getDelay(ctx);
    await emailPool.enqueueAction(
      ctx,
      internal.lib.callBrevoAPIWithBatch,
      {
        apiKey: options.apiKey,
        sandboxMode: options.sandboxMode,
        emails: emails.map((e) => e._id),
      },
      {
        retry: {
          maxAttempts: options.retryAttempts,
          initialBackoffMs: options.initialBackoffMs,
          base: 2,
        },
        runAfter: delay,
        context: { emailIds: emails.map((e) => e._id) },
        onComplete: internal.lib.onEmailComplete,
      },
    );

    await ctx.scheduler.runAfter(0, internal.lib.makeBatch, {
      reloop: true,
      segment: args.segment,
    });
  },
});

export const makeSmsBatch = internalMutation({
  args: { reloop: v.boolean(), segment: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const lastOptions = await ctx.db.query("lastOptions").unique();
    if (!lastOptions) {
      throw new Error("No last options found -- invariant");
    }
    const options = lastOptions.options;

    const sms = await ctx.db
      .query("sms")
      .withIndex("by_status_segment", (q) =>
        q.eq("status", "waiting").lte("segment", args.segment - 2),
      )
      .take(BATCH_SIZE);

    if (sms.length === 0 || (args.reloop && sms.length < BATCH_SIZE)) {
      return rescheduleSms(ctx, sms.length > 0);
    }

    console.log(`Making an SMS batch of ${sms.length} messages`);

    for (const message of sms) {
      await ctx.db.patch(message._id, {
        status: "queued",
      });
    }

    const delay = await getDelay(ctx);
    await emailPool.enqueueAction(
      ctx,
      internal.lib.callBrevoSmsAPIWithBatch,
      {
        apiKey: options.apiKey,
        smsWebhookBaseUrl: options.smsWebhookBaseUrl,
        smsWebhookSecret: options.smsWebhookSecret,
        sms: sms.map((message) => message._id),
      },
      {
        retry: {
          maxAttempts: options.retryAttempts,
          initialBackoffMs: options.initialBackoffMs,
          base: 2,
        },
        runAfter: delay,
        context: { smsIds: sms.map((message) => message._id) },
        onComplete: internal.lib.onSmsComplete,
      },
    );

    await ctx.scheduler.runAfter(0, internal.lib.makeSmsBatch, {
      reloop: true,
      segment: args.segment,
    });
  },
});

async function reschedule(ctx: MutationCtx, emailsLeft: boolean) {
  emailsLeft =
    emailsLeft ||
    (await ctx.db
      .query("emails")
      .withIndex("by_status_segment", (q) => q.eq("status", "waiting"))
      .first()) !== null;

  if (!emailsLeft) {
    const batchRun = await ctx.db.query("nextBatchRun").unique();
    if (!batchRun) {
      throw new Error("No batch run found -- invariant");
    }
    await ctx.db.delete(batchRun._id);
  } else {
    const segment = getSegment(Date.now() + BASE_BATCH_DELAY);
    await ctx.scheduler.runAfter(BASE_BATCH_DELAY, internal.lib.makeBatch, {
      reloop: false,
      segment,
    });
  }
}

async function rescheduleSms(ctx: MutationCtx, smsLeft: boolean) {
  smsLeft =
    smsLeft ||
    (await ctx.db
      .query("sms")
      .withIndex("by_status_segment", (q) => q.eq("status", "waiting"))
      .first()) !== null;

  if (!smsLeft) {
    const batchRun = await ctx.db.query("nextSmsBatchRun").unique();
    if (!batchRun) {
      throw new Error("No SMS batch run found -- invariant");
    }
    await ctx.db.delete(batchRun._id);
  } else {
    const segment = getSegment(Date.now() + BASE_BATCH_DELAY);
    await ctx.scheduler.runAfter(BASE_BATCH_DELAY, internal.lib.makeSmsBatch, {
      reloop: false,
      segment,
    });
  }
}

async function getAllContent(
  ctx: ActionCtx,
  contentIds: Id<"content">[],
): Promise<Map<Id<"content">, string>> {
  const docs = await ctx.runQuery(internal.lib.getAllContentByIds, {
    contentIds,
  });
  return new Map(docs.map((doc) => [doc.id, doc.content]));
}

const vBatchReturns = v.union(
  v.null(),
  v.object({
    emailIds: v.array(v.id("emails")),
    messageIds: v.array(v.string()),
  }),
);

const vSmsBatchReturns = v.union(
  v.null(),
  v.object({
    smsIds: v.array(v.id("sms")),
    messageIds: v.array(v.string()),
  }),
);

export const callBrevoAPIWithBatch = internalAction({
  args: {
    apiKey: v.string(),
    sandboxMode: v.boolean(),
    emails: v.array(v.id("emails")),
  },
  returns: vBatchReturns,
  handler: async (ctx, args) => {
    const payload = await createBrevoPayload(
      ctx,
      args.emails,
      args.sandboxMode,
    );

    if (payload === null) {
      console.log("No emails to send in batch. All were cancelled or failed.");
      return null;
    }

    const [emailIds, body] = payload;
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        accept: "application/json",
        "api-key": args.apiKey,
        "content-type": "application/json",
      },
      body,
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (PERMANENT_ERROR_CODES.has(response.status)) {
        await ctx.runMutation(internal.lib.markEmailsFailed, {
          emailIds,
          errorMessage: `Brevo API error: ${response.status} ${response.statusText} ${errorText}`,
        });
        return null;
      }
      throw new Error(`Brevo API error: ${errorText}`);
    }

    const data = (await response.json()) as {
      messageId?: string;
      messageIds?: string[];
    };
    const messageIds =
      data.messageIds ?? (data.messageId !== undefined ? [data.messageId] : []);
    if (messageIds.length !== emailIds.length) {
      throw new Error("Brevo API error: unexpected number of message IDs");
    }

    return {
      emailIds,
      messageIds,
    };
  },
});

export const callBrevoSmsAPIWithBatch = internalAction({
  args: {
    apiKey: v.string(),
    smsWebhookBaseUrl: v.optional(v.string()),
    smsWebhookSecret: v.optional(v.string()),
    sms: v.array(v.id("sms")),
  },
  returns: vSmsBatchReturns,
  handler: async (ctx, args) => {
    const payload = await createBrevoSmsPayload(
      ctx,
      args.sms,
      args.smsWebhookBaseUrl,
      args.smsWebhookSecret,
    );

    if (payload === null) {
      console.log("No SMS to send in batch. All were cancelled or failed.");
      return null;
    }

    const [smsIds, body] = payload;
    const response = await fetch(
      "https://api.brevo.com/v3/transactionalSMS/send",
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "api-key": args.apiKey,
          "content-type": "application/json",
        },
        body,
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      if (PERMANENT_ERROR_CODES.has(response.status)) {
        await ctx.runMutation(internal.lib.markSmsFailed, {
          smsIds,
          errorMessage: `Brevo SMS API error: ${response.status} ${response.statusText} ${errorText}`,
        });
        return null;
      }
      throw new Error(`Brevo SMS API error: ${errorText}`);
    }

    const data = (await response.json()) as {
      messageId?: number | string;
    };
    if (data.messageId === undefined) {
      throw new Error("Brevo SMS API error: missing messageId");
    }

    return {
      smsIds,
      messageIds: [String(data.messageId)],
    };
  },
});

export const markEmailsFailed = internalMutation({
  args: {
    emailIds: v.array(v.id("emails")),
    errorMessage: v.string(),
  },
  returns: v.null(),
  handler: markEmailsFailedHandler,
});

export const markSmsFailed = internalMutation({
  args: {
    smsIds: v.array(v.id("sms")),
    errorMessage: v.string(),
  },
  returns: v.null(),
  handler: markSmsFailedHandler,
});

async function markEmailsFailedHandler(
  ctx: MutationCtx,
  args: {
    emailIds: Id<"emails">[];
    errorMessage: string;
  },
) {
  await Promise.all(
    args.emailIds.map(async (emailId) => {
      const email = await ctx.db.get(emailId);
      if (!email || email.status !== "queued") {
        return;
      }
      await ctx.db.patch(emailId, {
        status: "failed",
        failed: true,
        errorMessage: args.errorMessage,
        finalizedAt: Date.now(),
      });
    }),
  );
}

async function markSmsFailedHandler(
  ctx: MutationCtx,
  args: {
    smsIds: Id<"sms">[];
    errorMessage: string;
  },
) {
  await Promise.all(
    args.smsIds.map(async (smsId) => {
      const sms = await ctx.db.get(smsId);
      if (!sms || sms.status !== "queued") {
        return;
      }
      await ctx.db.patch(smsId, {
        status: "failed",
        errorMessage: args.errorMessage,
        finalizedAt: Date.now(),
      });
    }),
  );
}

export const onEmailComplete = emailPool.defineOnComplete({
  context: v.object({
    emailIds: v.array(v.id("emails")),
  }),
  handler: async (ctx, args) => {
    if (args.result.kind === "success") {
      const result = parse(vBatchReturns, args.result.returnValue);
      if (result === null) {
        return;
      }
      const { emailIds, messageIds } = result;
      await Promise.all(
        emailIds.map((emailId, i) =>
          ctx.db.patch(emailId, {
            status: "sent",
            messageId: messageIds[i],
          }),
        ),
      );
    } else if (args.result.kind === "failed") {
      await markEmailsFailedHandler(ctx, {
        emailIds: args.context.emailIds,
        errorMessage: args.result.error,
      });
    } else if (args.result.kind === "canceled") {
      await Promise.all(
        args.context.emailIds.map(async (emailId) => {
          const email = await ctx.db.get(emailId);
          if (!email || email.status !== "queued") {
            return;
          }
          await ctx.db.patch(emailId, {
            status: "cancelled",
            errorMessage: "Brevo API job was cancelled",
            finalizedAt: Date.now(),
          });
        }),
      );
    }
  },
});

export const onSmsComplete = emailPool.defineOnComplete({
  context: v.object({
    smsIds: v.array(v.id("sms")),
  }),
  handler: async (ctx, args) => {
    if (args.result.kind === "success") {
      const result = parse(vSmsBatchReturns, args.result.returnValue);
      if (result === null) {
        return;
      }
      const { smsIds, messageIds } = result;
      await Promise.all(
        smsIds.map((smsId, i) =>
          ctx.db.patch(smsId, {
            status: "sent",
            messageId: messageIds[i],
          }),
        ),
      );
    } else if (args.result.kind === "failed") {
      await markSmsFailedHandler(ctx, {
        smsIds: args.context.smsIds,
        errorMessage: args.result.error,
      });
    } else if (args.result.kind === "canceled") {
      await Promise.all(
        args.context.smsIds.map(async (smsId) => {
          const sms = await ctx.db.get(smsId);
          if (!sms || sms.status !== "queued") {
            return;
          }
          await ctx.db.patch(smsId, {
            status: "cancelled",
            errorMessage: "Brevo SMS API job was cancelled",
            finalizedAt: Date.now(),
          });
        }),
      );
    }
  },
});

async function createBrevoPayload(
  ctx: ActionCtx,
  emailIds: Id<"emails">[],
  sandboxMode: boolean,
): Promise<[Id<"emails">[], string] | null> {
  const allEmails = await ctx.runQuery(internal.lib.getEmailsByIds, {
    emailIds,
  });
  const emails = allEmails.filter((e) => e.status === "queued");
  if (emails.length === 0) {
    return null;
  }

  const email = emails[0];
  const contentMap = await getAllContent(
    ctx,
    [email.html, email.text].filter(
      (id): id is Id<"content"> => id !== undefined,
    ),
  );

  const headers = {
    ...(email.headers ?? {}),
    idempotencyKey: email._id,
    ...(sandboxMode ? { "X-Sib-Sandbox": "drop" } : {}),
  };

  const payload: Record<string, unknown> = {
    sender: email.sender,
    to: email.to,
    cc: email.cc,
    bcc: email.bcc,
    replyTo: email.replyTo,
    subject: email.subject,
    headers,
    tags: email.tags,
    params: email.params,
  };

  if (email.templateId !== undefined) {
    payload.templateId = email.templateId;
  } else if (email.html) {
    payload.htmlContent = contentMap.get(email.html);
  } else if (email.text) {
    payload.textContent = contentMap.get(email.text);
  }

  return [[email._id], JSON.stringify(payload)];
}

async function createBrevoSmsPayload(
  ctx: ActionCtx,
  smsIds: Id<"sms">[],
  smsWebhookBaseUrl?: string,
  smsWebhookSecret?: string,
): Promise<[Id<"sms">[], string] | null> {
  const allSms = await ctx.runQuery(internal.lib.getSmsByIds, {
    smsIds,
  });
  const sms = allSms.filter((message) => message.status === "queued");
  if (sms.length === 0) {
    return null;
  }

  const message = sms[0];
  const payload: Record<string, unknown> = {
    sender: message.sender,
    recipient: message.recipient,
    content: message.content,
    type: "transactional",
    tag: message.tag,
    unicodeEnabled: message.unicodeEnabled,
    organisationPrefix: message.organisationPrefix,
  };

  if (smsWebhookBaseUrl && smsWebhookSecret) {
    const webUrl = new URL(smsWebhookBaseUrl);
    webUrl.searchParams.set("secret", smsWebhookSecret);
    webUrl.searchParams.set("smsId", message._id);
    payload.webUrl = webUrl.toString();
  }

  return [[message._id], JSON.stringify(payload)];
}

const FIXED_WINDOW_DELAY = 100;
async function getDelay(ctx: RunMutationCtx & RunQueryCtx): Promise<number> {
  const limit = await brevoApiRateLimiter.limit(ctx, "brevoApi", {
    reserve: true,
  });
  const jitter = Math.random() * FIXED_WINDOW_DELAY;
  return limit.retryAfter ? limit.retryAfter + jitter : 0;
}

export const getAllContentByIds = internalQuery({
  args: { contentIds: v.array(v.id("content")) },
  returns: v.array(v.object({ id: v.id("content"), content: v.string() })),
  handler: async (ctx, args) => {
    const contentMap = [];
    const docs = await Promise.all(
      args.contentIds.map((contentId) => ctx.db.get(contentId)),
    );
    for (const doc of docs) {
      if (!doc) throw new Error("Content not found -- invariant");
      contentMap.push({
        id: doc._id,
        content: new TextDecoder().decode(doc.content),
      });
    }
    return contentMap;
  },
});

export const getEmailsByIds = internalQuery({
  args: { emailIds: v.array(v.id("emails")) },
  handler: async (ctx, args) => {
    const emails = await Promise.all(args.emailIds.map((id) => ctx.db.get(id)));
    return emails.filter((e): e is Doc<"emails"> => e !== null);
  },
});

export const getSmsByIds = internalQuery({
  args: { smsIds: v.array(v.id("sms")) },
  handler: async (ctx, args) => {
    const sms = await Promise.all(args.smsIds.map((id) => ctx.db.get(id)));
    return sms.filter((message): message is Doc<"sms"> => message !== null);
  },
});

export const getEmailByMessageId = internalQuery({
  args: { messageId: v.string() },
  handler: async (ctx, args) => {
    const email = await ctx.db
      .query("emails")
      .withIndex("by_messageId", (q) => q.eq("messageId", args.messageId))
      .unique();
    if (!email) throw new Error("Email not found for messageId");
    return email;
  },
});

export const getSmsByMessageId = internalQuery({
  args: { messageId: v.string() },
  handler: async (ctx, args) => {
    const sms = await ctx.db
      .query("sms")
      .withIndex("by_messageId", (q) => q.eq("messageId", args.messageId))
      .unique();
    if (!sms) throw new Error("SMS not found for messageId");
    return sms;
  },
});

function normalizeBrevoEventType(event: EmailEvent): EmailEvent["event"] {
  switch (event.event) {
    case "softBounce":
      return "soft_bounce";
    case "hardBounce":
      return "hard_bounce";
    case "invalidEmail":
      return "invalid_email";
    case "complained":
      return "complaint";
    default:
      return event.event;
  }
}

function eventMessage(event: EmailEvent) {
  return event.reason ?? event.message;
}

function eventCreatedAt(event: EmailEvent) {
  if (event.date) return event.date;
  if (event.ts_epoch) return new Date(event.ts_epoch).toISOString();
  if (event.ts) return new Date(event.ts * 1000).toISOString();
  return new Date().toISOString();
}

function smsEventMessage(event: SmsEvent) {
  return event.description;
}

function smsEventCreatedAt(event: SmsEvent) {
  if (event.date) return event.date;
  if (typeof event.ts_event === "number") {
    return new Date(event.ts_event * 1000).toISOString();
  }
  if (typeof event.ts_event === "string") {
    const parsed = Number(event.ts_event);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed * 1000).toISOString();
    }
  }
  return new Date().toISOString();
}

function computeEmailUpdateFromEvent(
  email: Doc<"emails">,
  rawEvent: EmailEvent,
): Doc<"emails"> | null {
  const event = normalizeBrevoEventType(rawEvent);
  const statusRank: Record<Doc<"emails">["status"], number> = {
    waiting: 0,
    queued: 1,
    sent: 2,
    delivery_delayed: 3,
    delivered: 4,
    bounced: 5,
    failed: 5,
    cancelled: 100,
  };

  const currentRank = statusRank[email.status];
  const canUpgradeTo = (next: Doc<"emails">["status"]) => {
    if (email.status === "cancelled") return false;
    return statusRank[next] > currentRank;
  };

  if (event === "sent") return null;

  if (event === "clicked") {
    if (email.clicked) return null;
    return { ...email, clicked: true };
  }

  if (event === "opened") {
    if (email.opened) return null;
    return { ...email, opened: true };
  }

  if (event === "complaint") {
    if (email.complained) return null;
    return {
      ...email,
      complained: true,
      finalizedAt:
        email.finalizedAt === FINALIZED_EPOCH ? Date.now() : email.finalizedAt,
    };
  }

  if (event === "deferred" || event === "soft_bounce") {
    const statusWillChange = canUpgradeTo("delivery_delayed");
    if (!statusWillChange && email.deliveryDelayed) {
      return null;
    }
    const updated: Doc<"emails"> = {
      ...email,
      deliveryDelayed: true,
    };
    if (event === "soft_bounce") {
      updated.bounced = true;
      updated.errorMessage = eventMessage(rawEvent);
    }
    if (statusWillChange) {
      updated.status = "delivery_delayed";
    }
    return updated;
  }

  if (event === "delivered") {
    if (!canUpgradeTo("delivered")) return null;
    return {
      ...email,
      status: "delivered",
      finalizedAt: Date.now(),
    };
  }

  if (event === "hard_bounce") {
    const statusWillChange = canUpgradeTo("bounced");
    if (!statusWillChange && email.bounced) {
      return null;
    }
    const updated: Doc<"emails"> = {
      ...email,
      bounced: true,
      errorMessage: eventMessage(rawEvent),
    };
    if (statusWillChange) {
      updated.status = "bounced";
      updated.finalizedAt = Date.now();
    }
    return updated;
  }

  if (event === "invalid_email" || event === "blocked" || event === "error") {
    const statusWillChange = canUpgradeTo("failed");
    if (!statusWillChange && email.failed) {
      return null;
    }
    const updated: Doc<"emails"> = {
      ...email,
      failed: true,
      errorMessage: eventMessage(rawEvent),
    };
    if (statusWillChange) {
      updated.status = "failed";
      updated.finalizedAt = Date.now();
    }
    return updated;
  }

  if (event === "unsubscribed") {
    return null;
  }

  return null;
}

function computeSmsUpdateFromEvent(
  sms: Doc<"sms">,
  event: SmsEvent,
): Doc<"sms"> | null {
  const statusRank: Record<Doc<"sms">["status"], number> = {
    waiting: 0,
    queued: 1,
    sent: 2,
    accepted: 3,
    delivered: 4,
    soft_bounced: 5,
    hard_bounced: 6,
    rejected: 6,
    failed: 6,
    cancelled: 100,
  };

  const currentRank = statusRank[sms.status];
  const canUpgradeTo = (next: Doc<"sms">["status"]) => {
    if (sms.status === "cancelled") return false;
    return statusRank[next] > currentRank;
  };

  if (event.msg_status === "sent") {
    if (!canUpgradeTo("sent")) return null;
    return { ...sms, status: "sent" };
  }

  if (event.msg_status === "accepted") {
    const updated: Doc<"sms"> = { ...sms, accepted: true };
    if (canUpgradeTo("accepted")) {
      updated.status = "accepted";
    }
    return updated;
  }

  if (event.msg_status === "delivered") {
    const updated: Doc<"sms"> = { ...sms, delivered: true };
    if (canUpgradeTo("delivered")) {
      updated.status = "delivered";
      updated.finalizedAt = Date.now();
    }
    return updated;
  }

  if (event.msg_status === "replied") {
    return {
      ...sms,
      replied: true,
      reply: event.reply,
    };
  }

  if (event.msg_status === "soft_bounce") {
    const updated: Doc<"sms"> = {
      ...sms,
      softBounced: true,
      errorMessage: smsEventMessage(event),
    };
    if (canUpgradeTo("soft_bounced")) {
      updated.status = "soft_bounced";
      updated.finalizedAt = Date.now();
    }
    return updated;
  }

  if (event.msg_status === "hard_bounce") {
    const updated: Doc<"sms"> = {
      ...sms,
      hardBounced: true,
      errorMessage: smsEventMessage(event),
    };
    if (canUpgradeTo("hard_bounced")) {
      updated.status = "hard_bounced";
      updated.finalizedAt = Date.now();
    }
    return updated;
  }

  if (event.msg_status === "rejected") {
    const updated: Doc<"sms"> = {
      ...sms,
      rejected: true,
      errorMessage: smsEventMessage(event),
    };
    if (canUpgradeTo("rejected")) {
      updated.status = "rejected";
      updated.finalizedAt = Date.now();
    }
    return updated;
  }

  if (event.msg_status === "blacklisted" || event.msg_status === "skip") {
    const updated: Doc<"sms"> = {
      ...sms,
      blacklisted: event.msg_status === "blacklisted" ? true : sms.blacklisted,
      errorMessage: smsEventMessage(event),
    };
    if (canUpgradeTo("failed")) {
      updated.status = "failed";
      updated.finalizedAt = Date.now();
    }
    return updated;
  }

  if (event.msg_status === "unsubscribe") {
    return { ...sms, unsubscribed: true };
  }

  if (event.msg_status === "subscribe") {
    return null;
  }

  return null;
}

export const handleEmailEvent = mutation({
  args: {
    event: v.any(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const result = attemptToParse(vEmailEvent, args.event);
    if (result.kind === "error") {
      console.warn(`Invalid email event received from Brevo. ${result.error}.`);
      return;
    }

    const event = result.data;
    const messageId = event["message-id"];
    const normalizedEventType = normalizeBrevoEventType(event);

    const email = await ctx.db
      .query("emails")
      .withIndex("by_messageId", (q) => q.eq("messageId", messageId))
      .unique();

    if (!email) {
      console.info(`Email not found for messageId: ${messageId}, ignoring...`);
      return;
    }

    await ctx.db.insert("deliveryEvents", {
      emailId: email._id,
      messageId,
      eventType: normalizedEventType,
      createdAt: eventCreatedAt(event),
      message: eventMessage(event),
    });

    const updated = computeEmailUpdateFromEvent(email, event);
    if (updated) {
      await ctx.db.replace(email._id, updated);
    }

    await enqueueCallbackIfExists(ctx, email, {
      ...event,
      event: normalizedEventType,
    });
  },
});

export const handleSmsEvent = mutation({
  args: {
    event: v.any(),
    smsId: v.optional(v.id("sms")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const result = attemptToParse(vSmsEvent, args.event);
    if (result.kind === "error") {
      console.warn(`Invalid SMS event received from Brevo. ${result.error}.`);
      return;
    }

    const event = result.data;
    const messageId = String(event.messageId);
    const sms = args.smsId
      ? await ctx.db.get(args.smsId)
      : await ctx.db
          .query("sms")
          .withIndex("by_messageId", (q) => q.eq("messageId", messageId))
          .unique();

    if (!sms) {
      console.info(`SMS not found for messageId: ${messageId}, ignoring...`);
      return;
    }

    await ctx.db.insert("smsDeliveryEvents", {
      smsId: sms._id,
      messageId,
      eventType: event.msg_status,
      createdAt: smsEventCreatedAt(event),
      message: smsEventMessage(event),
    });

    const updated = computeSmsUpdateFromEvent(sms, event);
    if (updated) {
      await ctx.db.replace(sms._id, updated);
    }

    await enqueueSmsCallbackIfExists(ctx, sms, event);
  },
});

async function enqueueCallbackIfExists(
  ctx: MutationCtx,
  email: Doc<"emails">,
  event: EmailEvent,
) {
  const lastOptions = await ctx.db.query("lastOptions").unique();
  if (!lastOptions) {
    return;
  }
  if (lastOptions.options.onEmailEvent) {
    const handle = lastOptions.options.onEmailEvent.fnHandle as FunctionHandle<
      "mutation",
      {
        id: Id<"emails">;
        event: EmailEvent;
      },
      void
    >;
    await callbackPool.enqueueMutation(ctx, handle, {
      id: email._id,
      event,
    });
  }
}

async function enqueueSmsCallbackIfExists(
  ctx: MutationCtx,
  sms: Doc<"sms">,
  event: SmsEvent,
) {
  const lastOptions = await ctx.db.query("lastOptions").unique();
  if (!lastOptions) {
    return;
  }
  if (lastOptions.options.onSmsEvent) {
    const handle = lastOptions.options.onSmsEvent.fnHandle as FunctionHandle<
      "mutation",
      {
        id: Id<"sms">;
        event: SmsEvent;
      },
      void
    >;
    await callbackPool.enqueueMutation(ctx, handle, {
      id: sms._id,
      event,
    });
  }
}

async function cleanupEmail(ctx: MutationCtx, email: Doc<"emails">) {
  await ctx.db.delete(email._id);
  if (email.text) {
    await ctx.db.delete(email.text);
  }
  if (email.html) {
    await ctx.db.delete(email.html);
  }
  const events = await ctx.db
    .query("deliveryEvents")
    .withIndex("by_emailId_eventType", (q) => q.eq("emailId", email._id))
    .collect();
  for (const event of events) {
    await ctx.db.delete(event._id);
  }
}

async function cleanupSms(ctx: MutationCtx, sms: Doc<"sms">) {
  await ctx.db.delete(sms._id);
  const events = await ctx.db
    .query("smsDeliveryEvents")
    .withIndex("by_smsId_eventType", (q) => q.eq("smsId", sms._id))
    .collect();
  for (const event of events) {
    await ctx.db.delete(event._id);
  }
}

export const cleanupAbandonedEmails = mutation({
  args: { olderThan: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const olderThan = args.olderThan ?? ABANDONED_EMAIL_RETENTION_MS;
    const oldAndAbandoned = await ctx.db
      .query("emails")
      .withIndex("by_creation_time", (q) =>
        q.lt("_creationTime", Date.now() - olderThan),
      )
      .take(500);

    for (const email of oldAndAbandoned) {
      await cleanupEmail(ctx, email);
    }
    if (oldAndAbandoned.length > 0) {
      console.log(`Cleaned up ${oldAndAbandoned.length} emails`);
    }
    if (oldAndAbandoned.length === 500) {
      await ctx.scheduler.runAfter(0, api.lib.cleanupAbandonedEmails, {
        olderThan,
      });
    }
  },
});

export const cleanupOldSms = mutation({
  args: { olderThan: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const olderThan = args.olderThan ?? FINALIZED_EMAIL_RETENTION_MS;
    const oldAndDone = await ctx.db
      .query("sms")
      .withIndex("by_finalizedAt", (q) =>
        q.lt("finalizedAt", Date.now() - olderThan),
      )
      .take(100);
    for (const sms of oldAndDone) {
      await cleanupSms(ctx, sms);
    }
    if (oldAndDone.length > 0) {
      console.log(`Cleaned up ${oldAndDone.length} SMS`);
    }
    if (oldAndDone.length === 100) {
      await ctx.scheduler.runAfter(0, api.lib.cleanupOldSms, {
        olderThan,
      });
    }
  },
});

export const cleanupAbandonedSms = mutation({
  args: { olderThan: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const olderThan = args.olderThan ?? ABANDONED_EMAIL_RETENTION_MS;
    const oldAndAbandoned = await ctx.db
      .query("sms")
      .withIndex("by_creation_time", (q) =>
        q.lt("_creationTime", Date.now() - olderThan),
      )
      .take(500);

    for (const sms of oldAndAbandoned) {
      await cleanupSms(ctx, sms);
    }
    if (oldAndAbandoned.length > 0) {
      console.log(`Cleaned up ${oldAndAbandoned.length} SMS`);
    }
    if (oldAndAbandoned.length === 500) {
      await ctx.scheduler.runAfter(0, api.lib.cleanupAbandonedSms, {
        olderThan,
      });
    }
  },
});
