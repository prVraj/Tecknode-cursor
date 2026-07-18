import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-connector-run ambient context. Set once in `executeConnectorRun`
 * (`runner.ts`) and read by signal-agnostic helpers deep in the call tree —
 * notably the fetch cache — so they can attribute a fetch to the capability
 * that triggered it WITHOUT threading the capability key through every client
 * and module signature.
 *
 * `AsyncLocalStorage` propagates across `await`s within the same async chain,
 * so any code awaited (transitively) inside `intelRunContext.run(...)` sees the
 * store. Code outside a run (e.g. a standalone script) gets `undefined` —
 * callers must handle that.
 */
export interface IntelRunContext {
  capabilityKey: string;
  userId: string;
  entityId: string;
  runId: string;
}

export const intelRunContext = new AsyncLocalStorage<IntelRunContext>();

/** Returns the current run context, or `undefined` when called outside a run. */
export function getIntelRunContext(): IntelRunContext | undefined {
  return intelRunContext.getStore();
}
