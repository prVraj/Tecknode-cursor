import type {
  ErrorClassification,
  Provider,
} from "@/lib/alerts/classify-error";
import { classifyError } from "@/lib/alerts/classify-error";
import type { ConnectorRun } from "@/server/db/schema";
import type { DataIssueCode } from "./connector-output";

export type ConnectorFailureReason =
  | "provider_unavailable"
  | "provider_auth"
  | "provider_quota"
  | "entity_config"
  | "internal";

export type ConnectorUserError = {
  code: string;
  reason: ConnectorFailureReason;
  userMessage: string;
  retryable: boolean;
  provider?: Provider;
};

export type PublicConnectorRunError = {
  code: string;
  message: string;
  retryable: boolean;
};

export type PublicConnectorRun = Pick<
  ConnectorRun,
  | "id"
  | "status"
  | "capabilityKey"
  | "entityId"
  | "idempotencyKey"
  | "startedAt"
  | "finishedAt"
> & {
  error?: PublicConnectorRunError;
  output?: ConnectorRun["output"];
};

const USER_MESSAGES: Record<ConnectorFailureReason, string> = {
  provider_quota:
    "We couldn't refresh this signal — our data provider is temporarily out of credits. We'll retry automatically.",
  provider_auth:
    "We couldn't reach a data provider due to a configuration issue on our side. Our team has been notified.",
  provider_unavailable:
    "The data provider returned an error. We'll retry on the next scheduled run.",
  entity_config:
    "This signal needs additional setup (e.g. competitors or keywords). Check entity settings.",
  internal:
    "Something went wrong while collecting this signal. Try again or contact support.",
};

const REASON_TO_CODE: Record<ConnectorFailureReason, string> = {
  provider_quota: "CONNECTOR_PROVIDER_QUOTA",
  provider_auth: "CONNECTOR_PROVIDER_AUTH",
  provider_unavailable: "CONNECTOR_PROVIDER_UNAVAILABLE",
  entity_config: "CONNECTOR_ENTITY_CONFIG",
  internal: "CONNECTOR_INTERNAL",
};

/** Semantic codes persisted on `connector_runs.error_code`. */
export const CONNECTOR_ERROR_CODES = {
  CONNECTOR_PROVIDER_QUOTA: {
    reason: "provider_quota" as const,
    retryable: false,
  },
  CONNECTOR_PROVIDER_AUTH: {
    reason: "provider_auth" as const,
    retryable: false,
  },
  CONNECTOR_PROVIDER_RATE_LIMITED: {
    reason: "provider_unavailable" as const,
    retryable: true,
  },
  CONNECTOR_PROVIDER_UNAVAILABLE: {
    reason: "provider_unavailable" as const,
    retryable: true,
  },
  CONNECTOR_TIMEOUT: {
    reason: "provider_unavailable" as const,
    retryable: true,
  },
  CONNECTOR_UNKNOWN: {
    reason: "provider_unavailable" as const,
    retryable: true,
  },
  CONNECTOR_ENTITY_CONFIG: {
    reason: "entity_config" as const,
    retryable: false,
  },
  CONNECTOR_INTERNAL: {
    reason: "internal" as const,
    retryable: false,
  },
} as const;

const LEGACY_CODE_MAP: Record<string, ConnectorFailureReason> = {
  ENTITY_MISSING: "entity_config",
  RUNNER_ERROR: "internal",
};

const RATE_LIMIT_MESSAGE =
  "This provider is rate-limiting requests. Try again in a few minutes.";
const TIMEOUT_MESSAGE = "The request timed out. Try Run Now again.";

function buildUserError(
  code: string,
  reason: ConnectorFailureReason,
  opts: { retryable: boolean; userMessage?: string; provider?: Provider },
): ConnectorUserError {
  return {
    code,
    reason,
    userMessage: opts.userMessage ?? USER_MESSAGES[reason],
    retryable: opts.retryable,
    ...(opts.provider ? { provider: opts.provider } : {}),
  };
}

function errorFromReason(
  reason: ConnectorFailureReason,
  opts?: { retryable?: boolean; provider?: Provider; userMessage?: string },
): ConnectorUserError {
  const code = REASON_TO_CODE[reason];
  const registry =
    CONNECTOR_ERROR_CODES[code as keyof typeof CONNECTOR_ERROR_CODES];
  let userMessage = opts?.userMessage;
  if (!userMessage && code === "CONNECTOR_PROVIDER_RATE_LIMITED") {
    userMessage = RATE_LIMIT_MESSAGE;
  } else if (!userMessage && code === "CONNECTOR_TIMEOUT") {
    userMessage = TIMEOUT_MESSAGE;
  }
  return buildUserError(code, reason, {
    retryable: opts?.retryable ?? registry?.retryable ?? false,
    userMessage,
    provider: opts?.provider,
  });
}

function isPlatformConfigError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    /required for capability/.test(message) ||
    /is not configured/.test(lower) ||
    /credentials are not configured/.test(lower) ||
    /_token required/.test(lower) ||
    /_api_key required/.test(lower) ||
    /_login and _password are required/.test(lower)
  );
}

function isEntityMissingError(message: string): boolean {
  return /tracked entity .+ not found/i.test(message);
}

type ModuleFailureLike = Error & {
  isModuleFailure: true;
  issueCode?: DataIssueCode;
};

function isModuleFailure(err: unknown): err is ModuleFailureLike {
  return (
    err instanceof Error &&
    "isModuleFailure" in err &&
    (err as { isModuleFailure?: unknown }).isModuleFailure === true
  );
}

/** Match provider names embedded in untagged error messages (e.g. ModuleFailure). */
const PROVIDER_MESSAGE_PATTERNS: readonly {
  pattern: RegExp;
  provider: Provider;
}[] = [
  { pattern: /\bdataforseo\b/i, provider: "dataforseo" },
  { pattern: /\bfirecrawl\b/i, provider: "firecrawl" },
  { pattern: /\bopenrouter\b/i, provider: "openrouter" },
  { pattern: /\bapify\b/i, provider: "apify" },
  { pattern: /\bgithub\b/i, provider: "github" },
  { pattern: /\byoutube\b/i, provider: "youtube" },
  { pattern: /\btwitter\b/i, provider: "twitter" },
  { pattern: /\bgdelt\b/i, provider: "gdelt" },
  { pattern: /\bmxtoolbox\b/i, provider: "mxtoolbox" },
  { pattern: /\bcomposio\b/i, provider: "composio" },
  { pattern: /\bresend\b/i, provider: "resend" },
  { pattern: /\btelegram\b/i, provider: "telegram" },
  { pattern: /\bslack\b/i, provider: "slack" },
  { pattern: /\bdiscord\b/i, provider: "discord" },
];

function inferProviderFromMessage(message: string): Provider | null {
  for (const { pattern, provider } of PROVIDER_MESSAGE_PATTERNS) {
    if (pattern.test(message)) {
      return provider;
    }
  }
  return null;
}

function enrichErrorWithProvider(
  err: Error,
  provider: Provider,
): Error & { provider: Provider } {
  const enriched = Object.create(Object.getPrototypeOf(err)) as Error & {
    provider: Provider;
  };
  Object.assign(enriched, err, { provider });
  return enriched;
}

function mapModuleFailureIssueCode(
  issueCode: DataIssueCode,
): ConnectorUserError | null {
  switch (issueCode) {
    case "ENTITY_CONFIG":
      return errorFromReason("entity_config");
    case "PROVIDER_UNAVAILABLE":
      return null;
    default:
      return null;
  }
}

function mapClassification(
  classification: ErrorClassification,
): ConnectorUserError {
  const { reason, provider } = classification;

  switch (reason) {
    case "insufficient_credits":
      return buildUserError("CONNECTOR_PROVIDER_QUOTA", "provider_quota", {
        retryable: false,
        provider,
      });
    case "auth_invalid":
      return buildUserError("CONNECTOR_PROVIDER_AUTH", "provider_auth", {
        retryable: false,
        provider,
      });
    case "rate_limited":
      return buildUserError(
        "CONNECTOR_PROVIDER_RATE_LIMITED",
        "provider_unavailable",
        { retryable: true, userMessage: RATE_LIMIT_MESSAGE, provider },
      );
    case "upstream_error":
      return buildUserError(
        "CONNECTOR_PROVIDER_UNAVAILABLE",
        "provider_unavailable",
        { retryable: true, provider },
      );
    case "timeout":
      return buildUserError("CONNECTOR_TIMEOUT", "provider_unavailable", {
        retryable: true,
        userMessage: TIMEOUT_MESSAGE,
        provider,
      });
    case "unknown_error":
      return buildUserError("CONNECTOR_UNKNOWN", "provider_unavailable", {
        retryable: true,
        provider,
      });
    default:
      return errorFromReason("internal");
  }
}

/**
 * Map a thrown error to a user-safe connector failure descriptor.
 * Never interpolates raw upstream text into `userMessage`.
 */
export function mapConnectorError(err: unknown): ConnectorUserError {
  const message = err instanceof Error ? err.message : String(err);

  if (isEntityMissingError(message)) {
    return errorFromReason("entity_config");
  }
  if (isPlatformConfigError(message)) {
    return errorFromReason("internal");
  }

  if (isModuleFailure(err) && err.issueCode) {
    const fromIssue = mapModuleFailureIssueCode(err.issueCode);
    if (fromIssue) {
      return fromIssue;
    }
  }

  let classification = classifyError(err);
  if (!classification && err instanceof Error) {
    const inferred = inferProviderFromMessage(message);
    if (inferred) {
      classification = classifyError(enrichErrorWithProvider(err, inferred));
    }
  }

  if (classification) {
    return mapClassification(classification);
  }

  return errorFromReason("internal");
}

/** Resolve stored `error_code` to user-safe copy (derive-at-read). */
export function userErrorFromCode(
  code: string | null | undefined,
): ConnectorUserError {
  if (!code) {
    return errorFromReason("internal");
  }

  const registry =
    CONNECTOR_ERROR_CODES[code as keyof typeof CONNECTOR_ERROR_CODES];
  if (registry) {
    let userMessage: string | undefined;
    if (code === "CONNECTOR_PROVIDER_RATE_LIMITED") {
      userMessage = RATE_LIMIT_MESSAGE;
    } else if (code === "CONNECTOR_TIMEOUT") {
      userMessage = TIMEOUT_MESSAGE;
    }
    return buildUserError(code, registry.reason, {
      retryable: registry.retryable,
      userMessage,
    });
  }

  const legacyReason = LEGACY_CODE_MAP[code];
  if (legacyReason) {
    return errorFromReason(legacyReason);
  }

  return errorFromReason("internal");
}

/** UI helper — friendly message for a persisted connector error code. */
export function describeConnectorError(code: string): string {
  return userErrorFromCode(code).userMessage;
}

/** Strip internal fields from succeeded connector output before API exposure. */
export function toPublicConnectorOutput(
  output: Record<string, unknown>,
): Record<string, unknown> {
  const { partialSources: _partialSources, dataIssues, ...rest } = output;
  const publicOutput: Record<string, unknown> = { ...rest };

  if (Array.isArray(dataIssues)) {
    publicOutput.dataIssues = dataIssues.map((issue) => {
      if (typeof issue === "string") {
        return issue;
      }
      if (
        typeof issue === "object" &&
        issue !== null &&
        "code" in issue &&
        typeof issue.code === "string"
      ) {
        return { code: issue.code };
      }
      return issue;
    });
  } else if (dataIssues !== undefined) {
    publicOutput.dataIssues = dataIssues;
  }

  return publicOutput;
}

/** Strip raw `errorMessage` before returning connector runs to clients. */
export function toPublicConnectorRun(run: ConnectorRun): PublicConnectorRun {
  const base: PublicConnectorRun = {
    id: run.id,
    status: run.status,
    capabilityKey: run.capabilityKey,
    entityId: run.entityId,
    idempotencyKey: run.idempotencyKey,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  };

  if (run.status === "failed") {
    const mapped = userErrorFromCode(run.errorCode);
    return {
      ...base,
      error: {
        code: mapped.code,
        message: mapped.userMessage,
        retryable: mapped.retryable,
      },
    };
  }

  if (run.status === "succeeded" && run.output != null) {
    return {
      ...base,
      output: toPublicConnectorOutput(run.output as Record<string, unknown>),
    };
  }

  return base;
}

const DATA_ISSUE_LEAK_PATTERN =
  /dataforseo|apify|firecrawl|openrouter|github_token|youtube_api|402\d|401|403|429|api_key|_token|fetch failed|unauthorized|insufficient/i;

/** Sanitise module `dataIssues` strings before showing in user UI. */
export function sanitizeDataIssueForUser(issue: string): string {
  if (DATA_ISSUE_LEAK_PATTERN.test(issue)) {
    return "An external data source returned incomplete results.";
  }
  if (/run .+ first/i.test(issue)) {
    return issue;
  }
  if (/could not fetch page html/i.test(issue.toLowerCase())) {
    return "We couldn't fetch the page content.";
  }
  if (issue.length > 160 || /\bhttp \d{3}\b/i.test(issue)) {
    return "Part of the data collection step failed.";
  }
  return issue;
}
