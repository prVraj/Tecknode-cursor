import { AsyncLocalStorage } from "node:async_hooks";
import { db } from "@/server/db";
import {
  type ApiUsageCostSource,
  type ApiUsageProvider,
  type ApiUsageStatus,
  type ApiUsageUnitType,
  apiUsageEvents,
} from "@/server/db/schema";
import logger from "@/utils/logger";

const log = logger.withContext({ module: "api-usage" });

/**
 * Request-scoped context passed through via AsyncLocalStorage so client code
 * (DataForSEO, Firecrawl, etc.) doesn't have to thread `runId`/`userId` down
 * through every fetch helper. Set at the runner's per-run boundary in
 * `src/lib/intel/runner.ts`.
 */
interface ApiUsageContext {
  userId?: string | null;
  entityId?: string | null;
  runId?: string | null;
  capabilityKey?: string | null;
}

const apiUsageStorage = new AsyncLocalStorage<ApiUsageContext>();

/** Wrap a fn so any API usage recorded inside it inherits the given context. */
export function withApiUsageContext<T>(
  ctx: ApiUsageContext,
  fn: () => Promise<T>,
): Promise<T> {
  return apiUsageStorage.run(ctx, fn);
}

interface RecordApiUsageInput {
  provider: ApiUsageProvider;
  operation: string;
  unitType: ApiUsageUnitType;
  units: number;
  costMicroUsd: bigint | number;
  costSource: ApiUsageCostSource;
  status: ApiUsageStatus;
  httpStatus?: number;
  errorCode?: string;
  durationMs: number;
  attempt?: number;
}

/**
 * Write to `api_usage_events`. Never throws — observability writes must not
 * break the caller. Logs a warning on failure so we notice if the table is
 * broken / drifted.
 *
 * Callers should `await` this. On serverless platforms, unawaited promises
 * after a response is sent can be cut off mid-INSERT, losing the event.
 * Awaiting adds a single round-trip per API call — cheap relative to the API
 * call itself.
 */
export async function recordApiUsage(
  input: RecordApiUsageInput,
): Promise<void> {
  const ctx = apiUsageStorage.getStore() ?? {};
  try {
    await db.insert(apiUsageEvents).values({
      userId: ctx.userId ?? null,
      entityId: ctx.entityId ?? null,
      runId: ctx.runId ?? null,
      capabilityKey: ctx.capabilityKey ?? null,
      provider: input.provider,
      operation: input.operation,
      units: Math.max(0, Math.round(input.units)),
      unitType: input.unitType,
      costMicroUsd: BigInt(input.costMicroUsd),
      costSource: input.costSource,
      durationMs: input.durationMs,
      status: input.status,
      errorCode: input.errorCode ?? null,
      httpStatus: input.httpStatus ?? null,
      attempt: input.attempt ?? 0,
    });
  } catch (err) {
    log.warn("api_usage_events write failed", {
      err,
      provider: input.provider,
      operation: input.operation,
    });
  }
}

/** Convert dollars (possibly fractional) to micro-USD bigint. */
export function dollarsToMicroUsd(dollars: number): bigint {
  if (!Number.isFinite(dollars) || dollars <= 0) return BigInt(0);
  return BigInt(Math.round(dollars * 1_000_000));
}
