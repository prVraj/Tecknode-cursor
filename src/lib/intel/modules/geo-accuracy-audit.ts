import { buildAccuracyAuditResponse } from "@/lib/intel/accuracy-audit";
import type { ModuleRunner } from "../dispatcher";
import {
  asOutput,
  getBrand,
  getKnownFacts,
  getPrompts,
  requireEnv,
} from "./module-helpers";

export const runGeoAccuracyAudit: ModuleRunner = async ({ entity }) => {
  const apiKey = requireEnv("OPENROUTER_API_KEY", "geo_accuracy_audit");
  const output = await buildAccuracyAuditResponse({
    brand: getBrand(entity),
    knownFacts: getKnownFacts(entity),
    prompts: getPrompts(entity),
    apiKey,
  });

  return { output: asOutput(output), signals: [], costUnits: 2 };
};
