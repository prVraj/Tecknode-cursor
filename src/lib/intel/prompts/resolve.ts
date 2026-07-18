import {
  INTEL_PROMPTS,
  type IntelPromptKey,
} from "@/lib/intel/prompts/registry";

/**
 * Tecknode has no managed-prompt provider (Langfuse) wired up — this is a
 * simplified `resolve.ts` that always compiles the local registry text.
 * Interface-compatible with RunAgents' version so a managed-prompt provider
 * can be dropped in later without touching call sites.
 */

/** Minimal `{{var}}` substitution. */
function compileLocal(
  text: string,
  variables?: Record<string, string>,
): string {
  if (!variables) return text.trimEnd();
  let out = text;
  for (const [key, value] of Object.entries(variables)) {
    out = out.replaceAll(`{{${key}}}`, value);
  }
  return out.trimEnd();
}

export interface ResolvedPrompt {
  /** Compiled system text, ready to pass to the ai-sdk `system:`. */
  system: string;
  /** Human-readable prompt slug (e.g. "intel-chat"), stamped onto telemetry. */
  promptName: string;
  /** Undefined here — reserved for a future managed-prompt provider. */
  promptVersion?: number;
  /** Always "fallback" until a managed-prompt provider is wired up. */
  promptLabel: string;
}

/**
 * Build the runtime-context fragment that identifies which prompt produced a
 * generation, so traces/logs show WHICH system prompt ran.
 */
export function promptRuntimeContext(
  p: Pick<ResolvedPrompt, "promptName" | "promptVersion" | "promptLabel">,
): Record<string, unknown> {
  return {
    promptName: p.promptName,
    ...(p.promptVersion !== undefined
      ? { promptVersion: p.promptVersion }
      : {}),
    promptLabel: p.promptLabel,
  };
}

export const promptContextKeys = {
  promptName: true,
  promptVersion: true,
  promptLabel: true,
} as const;

/** Resolve a managed intel prompt from the local registry and compile its `{{variables}}`. */
export async function resolveIntelPrompt(
  key: IntelPromptKey,
  variables?: Record<string, string>,
): Promise<ResolvedPrompt> {
  const def = INTEL_PROMPTS[key];
  return {
    system: compileLocal(def.text, variables),
    promptName: def.name,
    promptLabel: "fallback",
  };
}
