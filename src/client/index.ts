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
  type Status,
  vEmailEvent,
} from "../component/shared.js";
import { ComponentApi } from "../component/_generated/component.js";

export type BrevoComponent = ComponentApi;

export type EmailId = string & { __isEmailId: true };
export const vEmailId = v.string() as VString<EmailId>;
export {
  vEmailEvent,
  vHeaders,
  vOptions,
  vParams,
  vRecipient,
  vStatus,
} from "../component/shared.js";
export type {
  EmailEvent,
  Headers,
  Params,
  Recipient,
  Status,
} from "../component/shared.js";

export const vOnEmailEventArgs = v.object({
  id: vEmailId,
  event: vEmailEvent,
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
  };
}

export type BrevoOptions = {
  apiKey?: string;
  webhookSecret?: string;
  initialBackoffMs?: number;
  retryAttempts?: number;
  sandboxMode?: boolean;
  onEmailEvent?: FunctionReference<
    "mutation",
    FunctionVisibility,
    {
      id: EmailId;
      event: EmailEvent;
    }
  > | null;
};

async function configToRuntimeConfig(
  config: Config,
  onEmailEvent?: FunctionReference<
    "mutation",
    FunctionVisibility,
    {
      id: EmailId;
      event: EmailEvent;
    }
  > | null,
): Promise<RuntimeConfig> {
  return {
    apiKey: config.apiKey,
    initialBackoffMs: config.initialBackoffMs,
    retryAttempts: config.retryAttempts,
    sandboxMode: config.sandboxMode,
    onEmailEvent: onEmailEvent
      ? { fnHandle: await createFunctionHandle(onEmailEvent) }
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
    };
    if (options?.onEmailEvent) {
      this.onEmailEvent = options.onEmailEvent;
    }
  }

  async sendEmail(
    ctx: RunMutationCtx,
    options: SendEmailOptions,
  ): Promise<EmailId> {
    if (this.config.apiKey === "") throw new Error("API key is not set");

    const id = await ctx.runMutation(this.component.lib.sendEmail, {
      options: await configToRuntimeConfig(this.config, this.onEmailEvent),
      ...options,
    });

    return id as EmailId;
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

  async cancelEmail(ctx: RunMutationCtx, emailId: EmailId) {
    await ctx.runMutation(this.component.lib.cancelEmail, {
      emailId,
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
}
