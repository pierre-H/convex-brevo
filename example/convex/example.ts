import {
  internalMutation,
  internalAction,
  internalQuery,
} from "./_generated/server";
import { components, internal } from "./_generated/api";
import { Brevo, type EmailId, vOnEmailEventArgs } from "convex-brevo";
import { v } from "convex/values";

export const brevo: Brevo = new Brevo(components.brevo, {
  onEmailEvent: internal.example.handleEmailEvent,
  sandboxMode: true,
});

function recipient(email: string, name?: string) {
  return { email, ...(name ? { name } : {}) };
}

export const sendOne = internalAction({
  args: { to: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const email = await brevo.sendEmail(ctx, {
      sender: recipient("sender@example.com", "Sender"),
      to: [recipient(args.to ?? "recipient@example.com", "Recipient")],
      subject: "Test Email",
      htmlContent: "<p>This is a Brevo test email</p>",
      tags: ["example"],
    });
    console.log("Email queued", email);
    let status = await brevo.status(ctx, email);
    while (
      status &&
      (status.status === "queued" || status.status === "waiting")
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      status = await brevo.status(ctx, email);
    }
    console.log("Email status", status);
    return email;
  },
});

export const sendWithTemplate = internalAction({
  args: {
    to: v.optional(v.string()),
    templateId: v.number(),
    subject: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const email = await brevo.sendEmail(ctx, {
      sender: recipient("sender@example.com", "Sender"),
      to: [recipient(args.to ?? "recipient@example.com", "Recipient")],
      subject: args.subject,
      templateId: args.templateId,
      params: {
        PRODUCT: "Vintage Macintosh",
        PRICE: 499,
      },
    });
    return email;
  },
});

export const insertExpectation = internalMutation({
  args: {
    email: v.string(),
    expectation: v.union(
      v.literal("delivered"),
      v.literal("bounced"),
      v.literal("complained"),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("testEmails", {
      email: args.email,
      expectation: args.expectation,
    });
  },
});

export const isEmpty = internalQuery({
  returns: v.boolean(),
  handler: async (ctx) => {
    return (await ctx.db.query("testEmails").first()) === null;
  },
});

export const handleEmailEvent = internalMutation({
  args: vOnEmailEventArgs,
  handler: async (ctx, args) => {
    console.log("Got called back!", args.id, args.event);
    const testEmail = await ctx.db
      .query("testEmails")
      .withIndex("by_email", (q) => q.eq("email", args.id))
      .unique();
    if (!testEmail) {
      return;
    }
    if (args.event.event === "delivered") {
      if (testEmail.expectation === "bounced") {
        throw new Error("Email was delivered but expected to be bounced");
      }
      if (testEmail.expectation === "complained") {
        return;
      }
      await ctx.db.delete(testEmail._id);
    }
    if (args.event.event === "hard_bounce") {
      if (testEmail.expectation !== "bounced") {
        throw new Error(
          `Email was bounced but expected to be ${testEmail.expectation}`,
        );
      }
      await ctx.db.delete(testEmail._id);
    }
    if (args.event.event === "complaint") {
      if (testEmail.expectation !== "complained") {
        throw new Error(
          `Email was complained but expected to be ${testEmail.expectation}`,
        );
      }
      await ctx.db.delete(testEmail._id);
    }
  },
});

export const sendManualEmail = internalAction({
  args: {
    to: v.optional(v.string()),
    subject: v.optional(v.string()),
    htmlContent: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const sender = recipient("sender@example.com", "Sender");
    const to = [recipient(args.to ?? "recipient@example.com", "Recipient")];
    const subject = args.subject ?? "Test Email";
    const htmlContent = args.htmlContent ?? "<p>Manual Brevo email</p>";

    return await brevo.sendEmailManually(
      ctx,
      { sender, to, subject },
      async (emailId: EmailId) => {
        const response = await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: {
            accept: "application/json",
            "api-key": process.env.BREVO_API_KEY!,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            sender,
            to,
            subject,
            htmlContent,
            headers: {
              idempotencyKey: emailId,
              "X-Sib-Sandbox": "drop",
            },
          }),
        });
        if (!response.ok) {
          throw new Error(await response.text());
        }
        const data = (await response.json()) as { messageId?: string };
        if (!data.messageId) {
          throw new Error("No messageId returned from Brevo");
        }
        return data.messageId;
      },
    );
  },
});
