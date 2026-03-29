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
      cleanupAbandonedEmails: FunctionReference<
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
          status:
            | "waiting"
            | "queued"
            | "cancelled"
            | "sent"
            | "delivered"
            | "delivery_delayed"
            | "bounced"
            | "failed";
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
          status:
            | "waiting"
            | "queued"
            | "cancelled"
            | "sent"
            | "delivered"
            | "delivery_delayed"
            | "bounced"
            | "failed";
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
          options: {
            apiKey: string;
            initialBackoffMs: number;
            onEmailEvent?: { fnHandle: string };
            retryAttempts: number;
            sandboxMode: boolean;
          };
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
          status:
            | "waiting"
            | "queued"
            | "cancelled"
            | "sent"
            | "delivered"
            | "delivery_delayed"
            | "bounced"
            | "failed";
        },
        null,
        Name
      >;
    };
  };
