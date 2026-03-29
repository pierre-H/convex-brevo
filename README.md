# Brevo Convex Component

This component integrates Brevo transactional email with Convex.

## Features

- Durable queueing with Convex mutations and workpools
- Rate-limited Brevo delivery via `POST /v3/smtp/email`
- Brevo-native payloads: `sender`, `to`, `templateId`, `params`, `htmlContent`,
  `textContent`
- `sandboxMode` support via `X-Sib-Sandbox: drop`
- Webhook-driven status tracking using Brevo `message-id`
- Email status queries, cancellation, and manual-send fallback

## Configuration

Set these environment variables in Convex:

- `BREVO_API_KEY`
- `BREVO_WEBHOOK_SECRET`

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

export default http;
```

The handler accepts the secret in either:

- query param `?secret=...`
- header `x-webhook-secret`

Brevo IP whitelisting is still recommended.

## Status API

```ts
const emailId = await brevo.sendEmail(ctx, { ... });
const status = await brevo.status(ctx, emailId);
const fullEmail = await brevo.get(ctx, emailId);
await brevo.cancelEmail(ctx, emailId);
```

## Manual sends

Use `sendEmailManually` when you need a custom Brevo call while still storing
status in the component tables.

## Notes

- `sandboxMode` validates requests without sending real email.
- The current implementation keeps the Convex queueing architecture and uses
  durable single-message Brevo API calls.
- Emails are correlated through Brevo `message-id` values stored in the
  component tables.
