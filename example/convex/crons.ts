import { cronJobs } from "convex/server";
import { components, internal } from "./_generated/api.js";
import { internalMutation } from "./_generated/server.js";

const crons = cronJobs();

crons.interval(
  "Remove old emails and sms from the brevo component",
  { hours: 1 },
  internal.crons.cleanupBrevo,
);

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const cleanupBrevo = internalMutation({
  args: {},
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(0, components.brevo.lib.cleanupOldEmails, {
      olderThan: ONE_WEEK_MS,
    });
    await ctx.scheduler.runAfter(0, components.brevo.lib.cleanupOldSms, {
      olderThan: ONE_WEEK_MS,
    });
    await ctx.scheduler.runAfter(
      0,
      components.brevo.lib.cleanupAbandonedEmails,
      { olderThan: ONE_WEEK_MS },
    );
    await ctx.scheduler.runAfter(0, components.brevo.lib.cleanupAbandonedSms, {
      olderThan: ONE_WEEK_MS,
    });
  },
});

export default crons;
