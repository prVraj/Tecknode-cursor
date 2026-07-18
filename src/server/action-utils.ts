import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { cache } from "react";
import type { z } from "zod";
import { auth } from "@/lib/auth";
import { UserFacingError } from "@/lib/errors";
import logger from "@/utils/logger";

export { UserFacingError };

type AuthSession = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;
type ScopedLogger = ReturnType<typeof logger.withContext>;

/**
 * The single ownership context every account-scoped action/handler receives.
 * `userId` is the only trusted ownership key in this product — it always comes
 * from a verified server session, never from client input.
 */
export type AccountContext = {
  userId: string;
  user: AuthSession["user"];
  session: AuthSession["session"];
  log: ScopedLogger;
};

/** Ownership key for persisted product data. */
export type AccountOwned = {
  userId: string;
};

function createScopedLogger(session: AuthSession): ScopedLogger {
  return logger.withContext({
    "user.id": session.user.id,
    "user.name": session.user.name,
    distinctId: session.user.id,
  });
}

/**
 * Turns a raw Better Auth session (or null) into a verified `AccountContext`.
 * Throws `UNAUTHENTICATED` when there is no session.
 * This is the pure, testable core of every authorization path.
 */
export async function resolveAccountContext(
  session: AuthSession | null,
): Promise<AccountContext> {
  if (!session) {
    throw new Error("UNAUTHENTICATED");
  }
  return {
    userId: session.user.id,
    user: session.user,
    session: session.session,
    log: createScopedLogger(session),
  };
}

/**
 * Fetches the current Better Auth session from request headers. Wrapped in
 * React's cache() so multiple actions in one request share a single fetch.
 */
export const getAuthedSession = cache(async (): Promise<AuthSession | null> => {
  return auth.api.getSession({ headers: await headers() });
});

/** Resolves a verified `AccountContext` from request headers. */
export const getAccountContext = cache(async (): Promise<AccountContext> => {
  const session = await getAuthedSession();
  return resolveAccountContext(session);
});

/**
 * For route handlers: returns the verified `AccountContext`, or a JSON error
 * response (401) for auth failures. Callers check
 * `instanceof NextResponse`.
 */
export async function getAccountContextOrJson(): Promise<
  AccountContext | NextResponse
> {
  try {
    return await getAccountContext();
  } catch {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }
}

/** Validate input against a Zod schema or throw a readable error. */
export function parseInput<T extends z.ZodType>(
  schema: T,
  raw: unknown,
): z.infer<T> {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new Error(result.error.issues.map((i) => i.message).join(", "));
  }
  return result.data;
}

const KNOWN_AUTH_ERRORS = [
  "UNAUTHENTICATED",
  "Unauthorized",
  "Forbidden",
  "Not found",
];

export function isKnownAuthErrorMessage(message: string): boolean {
  return KNOWN_AUTH_ERRORS.includes(message);
}

/**
 * Only `UserFacingError` messages and known auth errors reach the client.
 * Everything else (DB/ORM/SDK/HTTP errors) is masked so internal details never
 * leak to the browser.
 */
export function toClientError(e: unknown): string {
  if (!(e instanceof Error)) return "An unexpected error occurred";
  if (e instanceof UserFacingError) return e.message;
  if (isKnownAuthErrorMessage(e.message)) return e.message;
  return "An unexpected error occurred";
}

function logUnexpectedError(
  e: unknown,
  ctx: AccountContext | null,
  actionName?: string,
): void {
  const errMsg = e instanceof Error ? e.message : "Unknown error";
  if (isKnownAuthErrorMessage(errMsg)) return;
  const tag = actionName ? `[${actionName}]` : "[server-action]";
  (ctx?.log ?? logger).error(`${tag} ${errMsg}`, {
    action: actionName,
    "error.message": errMsg,
    "error.type": e instanceof Error ? e.name : undefined,
    "error.stack": e instanceof Error ? e.stack?.slice(0, 500) : undefined,
    "user.id": ctx?.userId,
  });
}

export type AccountActionError = { error: string };

/**
 * An account-scoped action callable. Invoke it directly (cookie/session path)
 * — it resolves the verified session from request headers and returns
 * `{ error }` on failure. Or call `runWithContext(ctx, raw)` from a non-cookie
 * entrypoint (e.g. a trusted cron) with an explicitly-built `AccountContext`;
 * that path THROWS on failure so the caller can format the error.
 */
export type AccountActionFn<TArg extends unknown[], TOutput> = ((
  ...args: TArg
) => Promise<TOutput | AccountActionError>) & {
  runWithContext: (ctx: AccountContext, ...args: TArg) => Promise<TOutput>;
};

type AccountActionOptions = { name?: string };

/**
 * Factory for account-scoped server actions. Requires a signed-in user and
 * injects `ctx.userId`. Actions must NEVER accept `userId` as input —
 * record IDs are inputs; ownership is always checked against `ctx.userId`.
 */
export function accountAction<TOutput>(
  handler: (ctx: AccountContext) => Promise<TOutput>,
  options?: AccountActionOptions,
): AccountActionFn<[], TOutput>;
export function accountAction<TInput, TOutput>(
  schema: z.ZodType<TInput>,
  handler: (ctx: AccountContext, input: TInput) => Promise<TOutput>,
  options?: AccountActionOptions,
): AccountActionFn<[raw: unknown], TOutput>;
export function accountAction<TInput, TOutput>(
  schemaOrHandler:
    | z.ZodType<TInput>
    | ((ctx: AccountContext) => Promise<TOutput>),
  maybeHandler?:
    | ((ctx: AccountContext, input: TInput) => Promise<TOutput>)
    | AccountActionOptions,
  maybeOptions?: AccountActionOptions,
) {
  function asWebAction<TArg extends unknown[]>(
    actionName: string | undefined,
    execute: (ctx: AccountContext, ...args: TArg) => Promise<TOutput>,
  ): AccountActionFn<TArg, TOutput> {
    const action = async (...args: TArg) => {
      let ctx: AccountContext | null = null;
      try {
        ctx = await getAccountContext();
        return await execute(ctx, ...args);
      } catch (e) {
        logUnexpectedError(e, ctx, actionName);
        return { error: toClientError(e) };
      }
    };
    return Object.assign(action, { runWithContext: execute });
  }

  if (typeof schemaOrHandler === "function") {
    const options = maybeHandler as AccountActionOptions | undefined;
    const execute = async (ctx: AccountContext) => schemaOrHandler(ctx);
    return asWebAction<[]>(options?.name, execute);
  }

  const handler = maybeHandler as (
    ctx: AccountContext,
    input: TInput,
  ) => Promise<TOutput>;
  const execute = async (ctx: AccountContext, raw: unknown) => {
    const input = parseInput(schemaOrHandler, raw);
    return handler(ctx, input);
  };
  return asWebAction<[raw: unknown]>(maybeOptions?.name, execute);
}
