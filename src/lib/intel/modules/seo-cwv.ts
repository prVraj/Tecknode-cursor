import { env } from "@/env/server";
import {
  buildCwvResponse,
  fetchCruxFieldData,
  fetchPageSpeedInsights,
} from "@/lib/google-psi";
import type { ModuleRunner } from "../dispatcher";
import { asOutput, getEntityUrl } from "./module-helpers";

export const runSeoCwv: ModuleRunner = async ({ entity }) => {
  const apiKey = env.GOOGLE_PSI_API_KEY?.trim();
  const url = getEntityUrl(entity);
  const dataIssues: string[] = [];

  if (!apiKey) {
    dataIssues.push(
      "GOOGLE_PSI_API_KEY is not configured — Core Web Vitals unavailable",
    );
    return {
      output: asOutput(
        buildCwvResponse({
          urls: [url],
          strategy: "mobile",
          psiResults: [{ status: "rejected", reason: "No API key" }],
          cruxResults: [{ status: "rejected", reason: "No API key" }],
          dataIssues,
        }),
      ),
      signals: [],
      costUnits: 0,
    };
  }

  const [psiResults, cruxResults] = await Promise.all([
    Promise.allSettled([
      fetchPageSpeedInsights({ url, strategy: "mobile", apiKey }),
    ]),
    Promise.allSettled([
      fetchCruxFieldData({ url, strategy: "mobile", apiKey }),
    ]),
  ]);

  return {
    output: asOutput(
      buildCwvResponse({
        urls: [url],
        strategy: "mobile",
        psiResults,
        cruxResults,
        dataIssues,
      }),
    ),
    signals: [],
    costUnits: 1,
  };
};
