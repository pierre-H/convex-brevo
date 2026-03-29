import { expect, describe, it, beforeEach } from "vitest";
import { api } from "./_generated/api.js";
import type { EmailEvent } from "./shared.js";
import {
  createTestEventOfType,
  insertTestSentEmail,
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
