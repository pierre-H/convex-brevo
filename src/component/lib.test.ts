import { expect, describe, it, beforeEach } from "vitest";
import { api } from "./_generated/api.js";
import type { EmailEvent, SmsEvent } from "./shared.js";
import {
  createTestEventOfType,
  createTestSmsEventOfType,
  insertTestSentEmail,
  insertTestSentSms,
  setupTest,
  setupTestLastOptions,
  type Tester,
} from "./setup.test.js";
import { type Doc, type Id } from "./_generated/dataModel.js";

describe("handleEmailEvent", () => {
  let t: Tester;
  let event: EmailEvent;
  let email: Doc<"emails">;

  beforeEach(async () => {
    t = setupTest();
    event = createTestEventOfType("delivered");
    await setupTestLastOptions(t);
    email = await insertTestSentEmail(t);
  });

  const exec = async (_event: EmailEvent | unknown = event) => {
    await t.mutation(api.lib.handleEmailEvent, { event: _event });
  };

  const getEmail = () =>
    t.run(async (ctx) => {
      const _email = await ctx.db.get(email._id);
      if (!_email) throw new Error("Email not found");
      return _email;
    });

  it("updates email for delivered event", async () => {
    await exec();

    const updatedEmail = await getEmail();
    expect(updatedEmail.status).toBe("delivered");
    expect(updatedEmail.finalizedAt).toBeLessThan(Number.MAX_SAFE_INTEGER);
    const events = await t.run(async (ctx) =>
      ctx.db
        .query("deliveryEvents")
        .withIndex("by_emailId_eventType", (q) =>
          q.eq("emailId", email._id).eq("eventType", "delivered"),
        )
        .collect(),
    );
    expect(events.length).toBe(1);
    expect(events[0].messageId).toBe(
      "<test-message-id-123@smtp-relay.mailin.fr>",
    );
  });

  it("updates email for complaint event", async () => {
    event = createTestEventOfType("complaint");

    await exec();

    const updatedEmail = await getEmail();
    expect(updatedEmail.status).toBe("sent");
    expect(updatedEmail.complained).toBe(true);
  });

  it("updates email for hard bounce event", async () => {
    event = createTestEventOfType("hard_bounce");

    await exec();

    const updatedEmail = await getEmail();
    expect(updatedEmail.status).toBe("bounced");
    expect(updatedEmail.errorMessage).toBe(
      "The email bounced due to invalid recipient",
    );
  });

  it("updates email for deferred event", async () => {
    event = createTestEventOfType("deferred");

    await exec();

    const updatedEmail = await getEmail();
    expect(updatedEmail.status).toBe("delivery_delayed");
    expect(updatedEmail.finalizedAt).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("updates email for opened event", async () => {
    event = createTestEventOfType("opened");

    await exec();

    const updatedEmail = await getEmail();
    expect(updatedEmail.opened).toBe(true);
  });

  it("does not update email for sent event", async () => {
    event = createTestEventOfType("sent");

    await exec();

    const updatedEmail = await getEmail();
    expect(updatedEmail.status).toBe("sent");
    expect(updatedEmail.finalizedAt).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("updates email for clicked event", async () => {
    event = createTestEventOfType("clicked");

    await exec();

    const updatedEmail = await getEmail();
    expect(updatedEmail.clicked).toBe(true);
  });

  it("updates email for error event and changes status", async () => {
    event = createTestEventOfType("error");

    await exec();

    const updatedEmail = await getEmail();
    expect(updatedEmail.status).toBe("failed");
    expect(updatedEmail.failed).toBe(true);
    expect(updatedEmail.finalizedAt).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });

  it("gracefully handles invalid event structure", async () => {
    await exec({ event: "delivered" });

    const updatedEmail = await getEmail();
    expect(updatedEmail.status).toBe("sent");
    expect(updatedEmail.finalizedAt).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("handleSmsEvent", () => {
  let t: Tester;
  let event: SmsEvent;
  let sms: Doc<"sms">;

  beforeEach(async () => {
    t = setupTest();
    event = createTestSmsEventOfType("delivered");
    await setupTestLastOptions(t);
    sms = await insertTestSentSms(t);
  });

  const exec = async (
    _event: SmsEvent | unknown = event,
    smsId?: Id<"sms">,
  ) => {
    await t.mutation(api.lib.handleSmsEvent, { event: _event, smsId });
  };

  const getSms = () =>
    t.run(async (ctx) => {
      const _sms = await ctx.db.get(sms._id);
      if (!_sms) throw new Error("SMS not found");
      return _sms;
    });

  it("updates sms for delivered event", async () => {
    await exec();

    const updatedSms = await getSms();
    expect(updatedSms.status).toBe("delivered");
    expect(updatedSms.delivered).toBe(true);
    const events = await t.run(async (ctx) =>
      ctx.db
        .query("smsDeliveryEvents")
        .withIndex("by_smsId_eventType", (q) =>
          q.eq("smsId", sms._id).eq("eventType", "delivered"),
        )
        .collect(),
    );
    expect(events.length).toBe(1);
    expect(events[0].messageId).toBe("1511882900100020");
  });

  it("updates sms for accepted event", async () => {
    event = createTestSmsEventOfType("accepted");

    await exec();

    const updatedSms = await getSms();
    expect(updatedSms.status).toBe("accepted");
    expect(updatedSms.accepted).toBe(true);
  });

  it("updates sms for replied event", async () => {
    event = createTestSmsEventOfType("replied", { reply: "Hi there" });

    await exec();

    const updatedSms = await getSms();
    expect(updatedSms.replied).toBe(true);
    expect(updatedSms.reply).toBe("Hi there");
  });

  it("updates sms for soft bounce event", async () => {
    event = createTestSmsEventOfType("soft_bounce");

    await exec();

    const updatedSms = await getSms();
    expect(updatedSms.status).toBe("soft_bounced");
    expect(updatedSms.softBounced).toBe(true);
  });

  it("updates sms for hard bounce event", async () => {
    event = createTestSmsEventOfType("hard_bounce");

    await exec();

    const updatedSms = await getSms();
    expect(updatedSms.status).toBe("hard_bounced");
    expect(updatedSms.hardBounced).toBe(true);
  });

  it("updates sms for rejected event", async () => {
    event = createTestSmsEventOfType("rejected");

    await exec();

    const updatedSms = await getSms();
    expect(updatedSms.status).toBe("rejected");
    expect(updatedSms.rejected).toBe(true);
  });

  it("uses explicit smsId from webhook url when provided", async () => {
    await exec(createTestSmsEventOfType("accepted"), sms._id);

    const updatedSms = await getSms();
    expect(updatedSms.accepted).toBe(true);
  });

  it("gracefully handles invalid sms event structure", async () => {
    await exec({ msg_status: "delivered" });

    const updatedSms = await getSms();
    expect(updatedSms.status).toBe("sent");
    expect(updatedSms.finalizedAt).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("sendEmail", () => {
  let t: Tester;

  beforeEach(async () => {
    t = setupTest();
    await setupTestLastOptions(t);
  });

  it("accepts template-based email", async () => {
    const emailId: Id<"emails"> = await t.mutation(api.lib.sendEmail, {
      options: {
        apiKey: "test-key",
        initialBackoffMs: 1000,
        retryAttempts: 3,
        sandboxMode: true,
      },
      sender: { email: "sender@example.com", name: "Sender" },
      to: [{ email: "recipient@example.com", name: "Recipient" }],
      templateId: 42,
      params: {
        PRODUCT: "Vintage Macintosh",
        PRICE: 499,
      },
    });

    const email = await t.run(async (ctx) => {
      const _email = await ctx.db.get(emailId);
      if (!_email) throw new Error("Email not found");
      return _email;
    });

    expect(email.templateId).toBe(42);
    expect(email.params).toEqual({
      PRODUCT: "Vintage Macintosh",
      PRICE: 499,
    });
    expect(email.status).toBe("waiting");
  });

  it("rejects email with both templateId and htmlContent", async () => {
    await expect(
      t.mutation(api.lib.sendEmail, {
        options: {
          apiKey: "test-key",
          initialBackoffMs: 1000,
          retryAttempts: 3,
          sandboxMode: true,
        },
        sender: { email: "sender@example.com" },
        to: [{ email: "recipient@example.com" }],
        subject: "Test",
        htmlContent: "<p>Test</p>",
        templateId: 42,
      }),
    ).rejects.toThrow(
      "Only one of htmlContent, textContent, or templateId may be provided",
    );
  });

  it("accepts template email with optional subject", async () => {
    const emailId: Id<"emails"> = await t.mutation(api.lib.sendEmail, {
      options: {
        apiKey: "test-key",
        initialBackoffMs: 1000,
        retryAttempts: 3,
        sandboxMode: true,
      },
      sender: { email: "sender@example.com" },
      to: [{ email: "recipient@example.com" }],
      subject: "Custom Subject Override",
      templateId: 42,
      params: { PRODUCT: "Test" },
    });

    const email = await t.run(async (ctx) => {
      const _email = await ctx.db.get(emailId);
      if (!_email) throw new Error("Email not found");
      return _email;
    });

    expect(email.templateId).toBe(42);
    expect(email.subject).toBe("Custom Subject Override");
  });

  it("rejects email without content or template", async () => {
    await expect(
      t.mutation(api.lib.sendEmail, {
        options: {
          apiKey: "test-key",
          initialBackoffMs: 1000,
          retryAttempts: 3,
          sandboxMode: true,
        },
        sender: { email: "sender@example.com" },
        to: [{ email: "recipient@example.com" }],
      }),
    ).rejects.toThrow(
      "One of htmlContent, textContent, or templateId must be provided",
    );
  });

  it("rejects traditional email without subject", async () => {
    await expect(
      t.mutation(api.lib.sendEmail, {
        options: {
          apiKey: "test-key",
          initialBackoffMs: 1000,
          retryAttempts: 3,
          sandboxMode: true,
        },
        sender: { email: "sender@example.com" },
        to: [{ email: "recipient@example.com" }],
        htmlContent: "<p>Test</p>",
      }),
    ).rejects.toThrow("Subject is required when not using a templateId");
  });
});

describe("sendSms", () => {
  let t: Tester;

  beforeEach(async () => {
    t = setupTest();
    await setupTestLastOptions(t);
  });

  it("accepts transactional sms", async () => {
    const smsId: Id<"sms"> = await t.mutation(api.lib.sendSms, {
      options: {
        apiKey: "test-key",
        initialBackoffMs: 1000,
        retryAttempts: 3,
        sandboxMode: true,
      },
      sender: "MyShop",
      recipient: "33680065433",
      content: "Enter this code: CAAA08",
      tag: "accountValidation",
      unicodeEnabled: true,
    });

    const sms = await t.run(async (ctx) => {
      const _sms = await ctx.db.get(smsId);
      if (!_sms) throw new Error("SMS not found");
      return _sms;
    });

    expect(sms.sender).toBe("MyShop");
    expect(sms.recipient).toBe("33680065433");
    expect(sms.status).toBe("waiting");
  });

  it("stores optional sms fields", async () => {
    const smsId: Id<"sms"> = await t.mutation(api.lib.sendSms, {
      options: {
        apiKey: "test-key",
        initialBackoffMs: 1000,
        retryAttempts: 3,
        sandboxMode: true,
        smsWebhookBaseUrl: "https://example.com/brevo-sms-webhook",
        smsWebhookSecret: "secret",
      },
      sender: "MyShop",
      recipient: "33680065433",
      content: "Hello",
      tag: "tagged",
      unicodeEnabled: false,
      organisationPrefix: "MyCompany",
    });

    const sms = await t.run(async (ctx) => {
      const _sms = await ctx.db.get(smsId);
      if (!_sms) throw new Error("SMS not found");
      return _sms;
    });

    expect(sms.tag).toBe("tagged");
    expect(sms.organisationPrefix).toBe("MyCompany");
  });
});
