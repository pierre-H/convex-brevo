import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { brevo } from "./example";

const http = httpRouter();

http.route({
  path: "/brevo-webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    return await brevo.handleBrevoEventWebhook(ctx, req);
  }),
});

export default http;
