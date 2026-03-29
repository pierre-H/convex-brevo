# Brevo Convex Component

This component integrates Brevo transactional email and SMS with Convex.

## Features

- Durable queueing with Convex mutations and workpools
- Rate-limited Brevo delivery via `POST /v3/smtp/email`
- Rate-limited Brevo delivery via `POST /v3/transactionalSMS/send`
- Brevo-native payloads: `sender`, `to`, `templateId`, `params`, `htmlContent`,
  `textContent`
- Transactional SMS payloads: `sender`, `recipient`, `content`, `tag`
- `sandboxMode` support via `X-Sib-Sandbox: drop`
- Webhook-driven status tracking using Brevo `message-id`
- Email status queries, cancellation, and manual-send fallback
- SMS status queries, cancellation, and manual-send fallback

## Configuration

Set these environment variables in Convex:

- `BREVO_API_KEY`
- `BREVO_WEBHOOK_SECRET`
- `BREVO_SMS_WEBHOOK_BASE_URL` (optional)
- `BREVO_SMS_WEBHOOK_SECRET` (optional, defaults to `BREVO_WEBHOOK_SECRET`)

Register the component in `convex/convex.config.ts`:

```ts
import { defineApp } from "convex/server";
import brevo from "convex-brevo/convex.config.js";

const app = defineApp();
app.use(brevo);

export default app;
```

## Usage

```ts
import { components } from "./_generated/api";
import { Brevo } from "convex-brevo";

export const brevo = new Brevo(components.brevo, {
  sandboxMode: true,
  smsWebhookBaseUrl: process.env.BREVO_SMS_WEBHOOK_BASE_URL,
});

await brevo.sendEmail(ctx, {
  sender: { email: "sender@example.com", name: "Sender" },
  to: [{ email: "recipient@example.com", name: "Recipient" }],
  subject: "Hello from Brevo",
  htmlContent: "<p>It works.</p>",
  tags: ["welcome"],
});
```

Template example:

```ts
await brevo.sendEmail(ctx, {
  sender: { email: "sender@example.com", name: "Sender" },
  to: [{ email: "recipient@example.com" }],
  templateId: 42,
  params: {
    FIRST_NAME: "Ada",
    ORDER_ID: 1234,
  },
});
```

SMS example:

```ts
await brevo.sendSms(ctx, {
  sender: "MyShop",
  recipient: "33680065433",
  content: "Enter this code: CAAA08",
  tag: "accountValidation",
});
```

## Webhooks

Mount an HTTP endpoint and protect it with the shared secret.

```ts
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { brevo } from "./mail";

const http = httpRouter();

http.route({
  path: "/brevo-webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    return await brevo.handleBrevoEventWebhook(ctx, req);
  }),
});

http.route({
  path: "/brevo-sms-webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    return await brevo.handleBrevoSmsWebhook(ctx, req);
  }),
});

export default http;
```

The handler accepts the secret in either:

- query param `?secret=...`
- header `x-webhook-secret`

Brevo IP whitelisting is still recommended.

For SMS tracking, set `smsWebhookBaseUrl` so the component can attach a
per-message `webUrl` to Brevo SMS sends.

## Status API

```ts
const emailId = await brevo.sendEmail(ctx, { ... });
const status = await brevo.status(ctx, emailId);
const fullEmail = await brevo.get(ctx, emailId);
await brevo.cancelEmail(ctx, emailId);

const smsId = await brevo.sendSms(ctx, { ... });
const smsStatus = await brevo.smsStatus(ctx, smsId);
const fullSms = await brevo.getSms(ctx, smsId);
await brevo.cancelSms(ctx, smsId);
```

## Manual sends

Use `sendEmailManually` or `sendSmsManually` when you need a custom Brevo call
while still storing status in the component tables.

## Notes

- `sandboxMode` validates requests without sending real email.
- The current implementation keeps the Convex queueing architecture and uses
  durable single-message Brevo API calls.
- Emails are correlated through Brevo `message-id` values stored in the
  component tables.
- SMS events are correlated either through the generated `smsId` in the webhook
  URL or by Brevo `messageId` fallback when no `smsWebhookBaseUrl` is used.
