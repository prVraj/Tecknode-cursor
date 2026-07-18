import {
  extractDataForSeoSerpData,
  fetchDataForSeoSerp,
} from "@/lib/dataforseo";
import type { ModuleRunner } from "../dispatcher";
import {
  asOutput,
  getCompetitorDomains,
  getDataForSeoCredentials,
  getLocationLabel,
  getPrompts,
} from "./module-helpers";

type SnippetType = "definition" | "list" | "table" | "steps" | "none";

function detectSnippetType(title: string): SnippetType {
  const t = title.toLowerCase();
  if (t.includes("what is") || t.includes("definition")) return "definition";
  if (t.includes("steps") || t.includes("how to")) return "steps";
  if (t.includes("list") || t.includes("top ") || t.includes("best "))
    return "list";
  if (t.includes("vs") || t.includes("compare")) return "table";
  return "definition";
}

function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function checkDomainInSnippet(
  domain: string,
  snippetDomain: string | null | undefined,
): boolean {
  if (!snippetDomain) return false;
  return snippetDomain.includes(domain) || domain.includes(snippetDomain);
}

function countCompetitorSnippets(
  competitors: string[],
  snippetOwner: string | null,
  counts: Record<string, number>,
): void {
  for (const comp of competitors) {
    if (checkDomainInSnippet(comp, snippetOwner)) {
      counts[comp] = (counts[comp] ?? 0) + 1;
    }
  }
}

export const runSeoAnswerBox: ModuleRunner = async ({ userId, entity }) => {
  const { login, password } = getDataForSeoCredentials("seo_answer_box");
  const location = getLocationLabel(entity);
  const prompts = getPrompts(entity).slice(0, 5);
  const competitors = await getCompetitorDomains({ userId, entity });
  const domain = entity.domain.replace(/^www\./, "");

  const serpResults = await Promise.allSettled(
    prompts.map((kw) =>
      fetchDataForSeoSerp({ keyword: kw, location, login, password }),
    ),
  );

  const featuredSnippets = [];
  const paaQuestions = [];
  let ownedCount = 0;

  const competitorSnippetCounts = Object.fromEntries(
    competitors.map((c) => [c, 0]),
  );

  for (let i = 0; i < serpResults.length; i++) {
    const result = serpResults[i];
    if (result.status === "rejected") continue;
    const serp = extractDataForSeoSerpData(result.value);
    const keyword = prompts[i] ?? "";
    const snippetOwner = serp.featuredSnippet?.domain ?? null;
    const isYours = checkDomainInSnippet(domain, snippetOwner);

    if (isYours) ownedCount++;
    countCompetitorSnippets(competitors, snippetOwner, competitorSnippetCounts);

    featuredSnippets.push({
      keyword,
      owner: snippetOwner,
      type: serp.featuredSnippet
        ? detectSnippetType(serp.featuredSnippet.title)
        : ("none" as SnippetType),
      isYours,
    });

    const paaOwned = serp.peopleAlsoAsk.some((paa) =>
      checkDomainInSnippet(domain, domainFromUrl(paa.link)),
    );
    paaQuestions.push({
      keyword,
      questions: serp.peopleAlsoAsk.map((p) => p.question),
      yourDomainInAnswers: paaOwned,
    });
  }

  const yourSnippetOwnershipRate =
    prompts.length > 0 ? Math.round((ownedCount / prompts.length) * 100) : 0;

  const output = {
    source: "dataforseo" as const,
    domain: entity.domain,
    keywords: prompts,
    dataIssues: [] as string[],
    yourSnippetOwnershipRate,
    featuredSnippets,
    paaQuestions,
    competitorComparison: competitors.map((comp) => ({
      domain: comp,
      snippetOwnershipRate:
        prompts.length > 0
          ? Math.round(
              ((competitorSnippetCounts[comp] ?? 0) / prompts.length) * 100,
            )
          : 0,
    })),
  };

  return { output: asOutput(output), signals: [], costUnits: prompts.length };
};
