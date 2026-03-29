/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

type EmailStatus =
  | "waiting"
  | "queued"
  | "cancelled"
  | "sent"
  | "delivered"
  | "delivery_delayed"
  | "bounced"
  | "failed";

type SmsStatus =
  | "waiting"
  | "queued"
  | "cancelled"
  | "sent"
  | "accepted"
  | "delivered"
  | "soft_bounced"
  | "hard_bounced"
  | "rejected"
  | "failed";

type RuntimeOptions = {
  apiKey: string;
  initialBackoffMs: number;
  onEmailEvent?: { fnHandle: string };
  onSmsEvent?: { fnHandle: string };
  retryAttempts: number;
  sandboxMode: boolean;
  smsWebhookBaseUrl?: string;
  smsWebhookSecret?: string;
};

export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    lib: {
      cancelEmail: FunctionReference<
        "mutation",
        "internal",
        { emailId: string },
        null,
        Name
      >;
      cancelSms: FunctionReference<
        "mutation",
        "internal",
        { smsId: string },
        null,
        Name
      >;
      cleanupAbandonedEmails: FunctionReference<
        "mutation",
        "internal",
        { olderThan?: number },
        null,
        Name
      >;
      cleanupAbandonedSms: FunctionReference<
        "mutation",
        "internal",
        { olderThan?: number },
        null,
        Name
      >;
      cleanupOldEmails: FunctionReference<
        "mutation",
        "internal",
        { olderThan?: number },
        null,
        Name
      >;
      cleanupOldSms: FunctionReference<
        "mutation",
        "internal",
        { olderThan?: number },
        null,
        Name
      >;
      createManualEmail: FunctionReference<
        "mutation",
        "internal",
        {
          sender: { email: string; name?: string };
          to: Array<{ email: string; name?: string }>;
          cc?: Array<{ email: string; name?: string }>;
          bcc?: Array<{ email: string; name?: string }>;
          subject: string;
          replyTo?: { email: string; name?: string };
          headers?: Record<string, string>;
          tags?: string[];
        },
        string,
        Name
      >;
      createManualSms: FunctionReference<
        "mutation",
        "internal",
        {
          sender: string;
          recipient: string;
          content: string;
          tag?: string;
          unicodeEnabled?: boolean;
          organisationPrefix?: string;
        },
        string,
        Name
      >;
      get: FunctionReference<
        "query",
        "internal",
        { emailId: string },
        {
          bounced?: boolean;
          clicked?: boolean;
          complained: boolean;
          createdAt: number;
          deliveryDelayed?: boolean;
          errorMessage?: string;
          failed?: boolean;
          finalizedAt: number;
          headers?: Record<string, string>;
          htmlContent?: string;
          messageId?: string;
          opened: boolean;
          params?: Record<string, string | number | boolean>;
          replyTo?: { email: string; name?: string };
          segment: number;
          sender: { email: string; name?: string };
          status: EmailStatus;
          subject?: string;
          tags?: string[];
          templateId?: number;
          textContent?: string;
          to: Array<{ email: string; name?: string }>;
          cc?: Array<{ email: string; name?: string }>;
          bcc?: Array<{ email: string; name?: string }>;
        } | null,
        Name
      >;
      getSms: FunctionReference<
        "query",
        "internal",
        { smsId: string },
        {
          accepted: boolean;
          blacklisted: boolean;
          content: string;
          createdAt: number;
          delivered: boolean;
          errorMessage?: string;
          finalizedAt: number;
          hardBounced: boolean;
          messageId?: string;
          organisationPrefix?: string;
          recipient: string;
          rejected: boolean;
          replied: boolean;
          reply?: string;
          segment: number;
          sender: string;
          softBounced: boolean;
          status: SmsStatus;
          tag?: string;
          unicodeEnabled?: boolean;
          unsubscribed: boolean;
        } | null,
        Name
      >;
      getStatus: FunctionReference<
        "query",
        "internal",
        { emailId: string },
        {
          bounced: boolean;
          clicked: boolean;
          complained: boolean;
          deliveryDelayed: boolean;
          errorMessage: string | null;
          failed: boolean;
          opened: boolean;
          status: EmailStatus;
        } | null,
        Name
      >;
      getSmsStatus: FunctionReference<
        "query",
        "internal",
        { smsId: string },
        {
          accepted: boolean;
          blacklisted: boolean;
          delivered: boolean;
          errorMessage: string | null;
          hardBounced: boolean;
          rejected: boolean;
          replied: boolean;
          reply: string | null;
          softBounced: boolean;
          status: SmsStatus;
          unsubscribed: boolean;
        } | null,
        Name
      >;
      handleEmailEvent: FunctionReference<
        "mutation",
        "internal",
        { event: any },
        null,
        Name
      >;
      handleSmsEvent: FunctionReference<
        "mutation",
        "internal",
        { event: any; smsId?: string },
        null,
        Name
      >;
      sendEmail: FunctionReference<
        "mutation",
        "internal",
        {
          sender: { email: string; name?: string };
          to: Array<{ email: string; name?: string }>;
          cc?: Array<{ email: string; name?: string }>;
          bcc?: Array<{ email: string; name?: string }>;
          subject?: string;
          htmlContent?: string;
          textContent?: string;
          templateId?: number;
          params?: Record<string, string | number | boolean>;
          replyTo?: { email: string; name?: string };
          headers?: Record<string, string>;
          tags?: string[];
          options: RuntimeOptions;
        },
        string,
        Name
      >;
      sendSms: FunctionReference<
        "mutation",
        "internal",
        {
          sender: string;
          recipient: string;
          content: string;
          tag?: string;
          unicodeEnabled?: boolean;
          organisationPrefix?: string;
          options: RuntimeOptions;
        },
        string,
        Name
      >;
      updateManualEmail: FunctionReference<
        "mutation",
        "internal",
        {
          emailId: string;
          errorMessage?: string;
          messageId?: string;
          status: EmailStatus;
        },
        null,
        Name
      >;
      updateManualSms: FunctionReference<
        "mutation",
        "internal",
        {
          smsId: string;
          errorMessage?: string;
          messageId?: string;
          status: SmsStatus;
        },
        null,
        Name
      >;
    };
  };
