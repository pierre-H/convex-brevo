import {
  createFunctionHandle,
  internalMutationGeneric,
  type FunctionReference,
  type FunctionVisibility,
  type GenericDataModel,
  type GenericMutationCtx,
} from "convex/server";
import { v, type VString } from "convex/values";
import {
  type EmailEvent,
  type Headers,
  type Params,
  type Recipient,
  type RunMutationCtx,
  type RunQueryCtx,
  type RuntimeConfig,
  type SmsEvent,
  type SmsStatus,
  type Status,
  vEmailEvent,
  vSmsEvent,
} from "../component/shared.js";
import { ComponentApi } from "../component/_generated/component.js";

export type BrevoComponent = ComponentApi;

export type EmailId = string & { __isEmailId: true };
export type SmsId = string & { __isSmsId: true };
export const vEmailId = v.string() as VString<EmailId>;
export const vSmsId = v.string() as VString<SmsId>;
export {
  vEmailEvent,
  vHeaders,
  vOptions,
  vParams,
  vRecipient,
  vSmsEvent,
  vSmsStatus,
  vStatus,
} from "../component/shared.js";
export type {
  EmailEvent,
  Headers,
  Params,
  Recipient,
  SmsEvent,
  SmsStatus,
  Status,
} from "../component/shared.js";

export const vOnEmailEventArgs = v.object({
  id: vEmailId,
  event: vEmailEvent,
});

export const vOnSmsEventArgs = v.object({
  id: vSmsId,
  event: vSmsEvent,
});

type Config = RuntimeConfig & {
  webhookSecret: string;
};

function getDefaultConfig(): Config {
  return {
    apiKey: process.env.BREVO_API_KEY ?? "",
    webhookSecret: process.env.BREVO_WEBHOOK_SECRET ?? "",
    initialBackoffMs: 30000,
    retryAttempts: 5,
    sandboxMode: true,
    smsWebhookBaseUrl: process.env.BREVO_SMS_WEBHOOK_BASE_URL,
    smsWebhookSecret:
      process.env.BREVO_SMS_WEBHOOK_SECRET ??
      process.env.BREVO_WEBHOOK_SECRET ??
      undefined,
  };
}

export type BrevoOptions = {
  apiKey?: string;
  webhookSecret?: string;
  initialBackoffMs?: number;
  retryAttempts?: number;
  sandboxMode?: boolean;
  smsWebhookBaseUrl?: string;
  smsWebhookSecret?: string;
  onEmailEvent?: FunctionReference<
    "mutation",
    FunctionVisibility,
    {
      id: EmailId;
      event: EmailEvent;
    }
  > | null;
  onSmsEvent?: FunctionReference<
    "mutation",
    FunctionVisibility,
    {
      id: SmsId;
      event: SmsEvent;
    }
  > | null;
};

async function configToRuntimeConfig(
  config: Config,
  handlers: {
    onEmailEvent?: FunctionReference<
      "mutation",
      FunctionVisibility,
      {
        id: EmailId;
        event: EmailEvent;
      }
    > | null;
    onSmsEvent?: FunctionReference<
      "mutation",
      FunctionVisibility,
      {
        id: SmsId;
        event: SmsEvent;
      }
    > | null;
  },
): Promise<RuntimeConfig> {
  return {
    apiKey: config.apiKey,
    initialBackoffMs: config.initialBackoffMs,
    retryAttempts: config.retryAttempts,
    sandboxMode: config.sandboxMode,
    smsWebhookBaseUrl: config.smsWebhookBaseUrl,
    smsWebhookSecret: config.smsWebhookSecret,
    onEmailEvent: handlers.onEmailEvent
      ? { fnHandle: await createFunctionHandle(handlers.onEmailEvent) }
      : undefined,
    onSmsEvent: handlers.onSmsEvent
      ? { fnHandle: await createFunctionHandle(handlers.onSmsEvent) }
      : undefined,
  };
}

export type EmailStatus = {
  status: Status;
  errorMessage: string | null;
  bounced: boolean;
  complained: boolean;
  failed: boolean;
  deliveryDelayed: boolean;
  opened: boolean;
  clicked: boolean;
};

export type SmsDeliveryStatus = {
  status: SmsStatus;
  errorMessage: string | null;
  accepted: boolean;
  delivered: boolean;
  replied: boolean;
  softBounced: boolean;
  hardBounced: boolean;
  rejected: boolean;
  blacklisted: boolean;
  unsubscribed: boolean;
  reply: string | null;
};

type BaseSendEmailOptions = {
  sender: Recipient;
  to: Recipient[];
  cc?: Recipient[];
  bcc?: Recipient[];
  replyTo?: Recipient;
  headers?: Headers;
  tags?: string[];
};

export type SendEmailOptions =
  | (BaseSendEmailOptions & {
      subject: string;
      htmlContent?: string;
      textContent?: string;
      templateId?: never;
      params?: Params;
    })
  | (BaseSendEmailOptions & {
      subject?: string;
      templateId: number;
      params?: Params;
      htmlContent?: never;
      textContent?: never;
    });

export type SendSmsOptions = {
  sender: string;
  recipient: string;
  content: string;
  tag?: string;
  unicodeEnabled?: boolean;
  organisationPrefix?: string;
};

export class Brevo {
  public config: Config;
  onEmailEvent?: FunctionReference<
    "mutation",
    FunctionVisibility,
    {
      id: EmailId;
      event: EmailEvent;
    }
  > | null;
  onSmsEvent?: FunctionReference<
    "mutation",
    FunctionVisibility,
    {
      id: SmsId;
      event: SmsEvent;
    }
  > | null;

  constructor(
    public component: ComponentApi,
    options?: BrevoOptions,
  ) {
    const defaultConfig = getDefaultConfig();
    this.config = {
      apiKey: options?.apiKey ?? defaultConfig.apiKey,
      webhookSecret: options?.webhookSecret ?? defaultConfig.webhookSecret,
      initialBackoffMs:
        options?.initialBackoffMs ?? defaultConfig.initialBackoffMs,
      retryAttempts: options?.retryAttempts ?? defaultConfig.retryAttempts,
      sandboxMode: options?.sandboxMode ?? defaultConfig.sandboxMode,
      smsWebhookBaseUrl:
        options?.smsWebhookBaseUrl ?? defaultConfig.smsWebhookBaseUrl,
      smsWebhookSecret:
        options?.smsWebhookSecret ??
        options?.webhookSecret ??
        defaultConfig.smsWebhookSecret ??
        defaultConfig.webhookSecret,
    };
    if (options?.onEmailEvent) {
      this.onEmailEvent = options.onEmailEvent;
    }
    if (options?.onSmsEvent) {
      this.onSmsEvent = options.onSmsEvent;
    }
  }

  async sendEmail(
    ctx: RunMutationCtx,
    options: SendEmailOptions,
  ): Promise<EmailId> {
    if (this.config.apiKey === "") throw new Error("API key is not set");

    const id = await ctx.runMutation(this.component.lib.sendEmail, {
      options: await configToRuntimeConfig(this.config, {
        onEmailEvent: this.onEmailEvent,
        onSmsEvent: this.onSmsEvent,
      }),
      ...options,
    });

    return id as EmailId;
  }

  async sendSms(ctx: RunMutationCtx, options: SendSmsOptions): Promise<SmsId> {
    if (this.config.apiKey === "") throw new Error("API key is not set");

    const id = await ctx.runMutation(this.component.lib.sendSms, {
      options: await configToRuntimeConfig(this.config, {
        onEmailEvent: this.onEmailEvent,
        onSmsEvent: this.onSmsEvent,
      }),
      ...options,
    });

    return id as SmsId;
  }

  async sendEmailManually(
    ctx: RunMutationCtx,
    options: {
      sender: Recipient;
      to: Recipient[];
      cc?: Recipient[];
      bcc?: Recipient[];
      subject: string;
      replyTo?: Recipient;
      headers?: Headers;
      tags?: string[];
    },
    sendCallback: (emailId: EmailId) => Promise<string>,
  ): Promise<EmailId> {
    const emailId = (await ctx.runMutation(
      this.component.lib.createManualEmail,
      options,
    )) as EmailId;
    try {
      const messageId = await sendCallback(emailId);
      await ctx.runMutation(this.component.lib.updateManualEmail, {
        emailId,
        status: "sent",
        messageId,
      });
    } catch (error) {
      await ctx.runMutation(this.component.lib.updateManualEmail, {
        emailId,
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
        messageId:
          typeof error === "object" && error !== null && "messageId" in error
            ? typeof error.messageId === "string"
              ? error.messageId
              : undefined
            : undefined,
      });
      throw error;
    }

    return emailId as EmailId;
  }

  async sendSmsManually(
    ctx: RunMutationCtx,
    options: SendSmsOptions,
    sendCallback: (smsId: SmsId) => Promise<string>,
  ): Promise<SmsId> {
    const smsId = (await ctx.runMutation(this.component.lib.createManualSms, {
      ...options,
    })) as SmsId;
    try {
      const messageId = await sendCallback(smsId);
      await ctx.runMutation(this.component.lib.updateManualSms, {
        smsId,
        status: "sent",
        messageId,
      });
    } catch (error) {
      await ctx.runMutation(this.component.lib.updateManualSms, {
        smsId,
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
        messageId:
          typeof error === "object" && error !== null && "messageId" in error
            ? String(error.messageId)
            : undefined,
      });
      throw error;
    }

    return smsId;
  }

  async cancelEmail(ctx: RunMutationCtx, emailId: EmailId) {
    await ctx.runMutation(this.component.lib.cancelEmail, {
      emailId,
    });
  }

  async cancelSms(ctx: RunMutationCtx, smsId: SmsId) {
    await ctx.runMutation(this.component.lib.cancelSms, {
      smsId,
    });
  }

  async status(
    ctx: RunQueryCtx,
    emailId: EmailId,
  ): Promise<EmailStatus | null> {
    return await ctx.runQuery(this.component.lib.getStatus, {
      emailId,
    });
  }

  async smsStatus(
    ctx: RunQueryCtx,
    smsId: SmsId,
  ): Promise<SmsDeliveryStatus | null> {
    return await ctx.runQuery(this.component.lib.getSmsStatus, {
      smsId,
    });
  }

  async get(
    ctx: RunQueryCtx,
    emailId: EmailId,
  ): Promise<{
    sender: Recipient;
    to: Recipient[];
    cc?: Recipient[];
    bcc?: Recipient[];
    subject?: string;
    replyTo?: Recipient;
    headers?: Headers;
    tags?: string[];
    status: Status;
    errorMessage?: string;
    bounced?: boolean;
    complained: boolean;
    failed?: boolean;
    deliveryDelayed?: boolean;
    opened?: boolean;
    clicked?: boolean;
    messageId?: string;
    finalizedAt: number;
    createdAt: number;
    htmlContent?: string;
    textContent?: string;
    templateId?: number;
    params?: Params;
  } | null> {
    return await ctx.runQuery(this.component.lib.get, {
      emailId,
    });
  }

  async getSms(
    ctx: RunQueryCtx,
    smsId: SmsId,
  ): Promise<{
    sender: string;
    recipient: string;
    content: string;
    tag?: string;
    unicodeEnabled?: boolean;
    organisationPrefix?: string;
    status: SmsStatus;
    errorMessage?: string;
    messageId?: string;
    reply?: string;
    accepted: boolean;
    delivered: boolean;
    replied: boolean;
    softBounced: boolean;
    hardBounced: boolean;
    rejected: boolean;
    blacklisted: boolean;
    unsubscribed: boolean;
    finalizedAt: number;
    createdAt: number;
  } | null> {
    return await ctx.runQuery(this.component.lib.getSms, {
      smsId,
    });
  }

  async handleBrevoEventWebhook(
    ctx: RunMutationCtx,
    req: Request,
  ): Promise<Response> {
    if (this.config.webhookSecret === "") {
      throw new Error("Webhook secret is not set");
    }

    const url = new URL(req.url);
    const querySecret = url.searchParams.get("secret");
    const headerSecret = req.headers.get("x-webhook-secret");
    if (
      querySecret !== this.config.webhookSecret &&
      headerSecret !== this.config.webhookSecret
    ) {
      return new Response("Invalid webhook secret", { status: 401 });
    }

    const event = (await req.json()) as EmailEvent;
    await ctx.runMutation(this.component.lib.handleEmailEvent, {
      event,
    });

    return new Response(null, {
      status: 201,
    });
  }

  async handleBrevoSmsWebhook(
    ctx: RunMutationCtx,
    req: Request,
  ): Promise<Response> {
    const secret = this.config.smsWebhookSecret ?? this.config.webhookSecret;
    if (!secret) {
      throw new Error("SMS webhook secret is not set");
    }

    const url = new URL(req.url);
    const querySecret = url.searchParams.get("secret");
    const headerSecret = req.headers.get("x-webhook-secret");
    if (querySecret !== secret && headerSecret !== secret) {
      return new Response("Invalid webhook secret", { status: 401 });
    }

    const event = (await req.json()) as SmsEvent;
    await ctx.runMutation(this.component.lib.handleSmsEvent, {
      event,
      smsId: url.searchParams.get("smsId") ?? undefined,
    });

    return new Response(null, {
      status: 201,
    });
  }

  defineOnEmailEvent<DataModel extends GenericDataModel>(
    handler: (
      ctx: GenericMutationCtx<DataModel>,
      args: { id: EmailId; event: EmailEvent },
    ) => Promise<void>,
  ) {
    return internalMutationGeneric({
      args: {
        id: vEmailId,
        event: vEmailEvent,
      },
      handler,
    });
  }

  defineOnSmsEvent<DataModel extends GenericDataModel>(
    handler: (
      ctx: GenericMutationCtx<DataModel>,
      args: { id: SmsId; event: SmsEvent },
    ) => Promise<void>,
  ) {
    return internalMutationGeneric({
      args: {
        id: vSmsId,
        event: vSmsEvent,
      },
      handler,
    });
  }
}
