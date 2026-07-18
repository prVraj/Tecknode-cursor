export type VisibilityScoreBreakdownItem = {
  weight: number;
  inputValue: number | null;
  contribution: number;
};

export type VisibilityScoreResponse = {
  source: "computed";
  domain: string;
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  breakdown: {
    citationRate: VisibilityScoreBreakdownItem;
    mentionRate: VisibilityScoreBreakdownItem;
    sentimentScore: VisibilityScoreBreakdownItem;
    positionScore: VisibilityScoreBreakdownItem;
    recommendationRate: VisibilityScoreBreakdownItem;
  };
  delta: number | null;
  dataIssues: string[];
};

const SENTIMENT_MAP: Record<string, number> = {
  positive: 100,
  neutral: 50,
  negative: 0,
  not_found: 25,
};

const POSITION_MAP: Record<string, number> = {
  early: 100,
  middle: 60,
  late: 30,
  not_found: 0,
};

function computeGrade(score: number): "A" | "B" | "C" | "D" | "F" {
  if (score >= 80) return "A";
  if (score >= 60) return "B";
  if (score >= 40) return "C";
  if (score >= 20) return "D";
  return "F";
}

function makeBreakdownItem(
  weight: number,
  inputValue: number | null,
): VisibilityScoreBreakdownItem {
  const contribution = inputValue !== null ? weight * inputValue : 0;
  return { weight, inputValue, contribution };
}

export function buildVisibilityScore(input: {
  domain: string;
  previousScore?: number;
  citationFrequency?: number;
  mentionRate?: number;
  dominantSentiment?: "positive" | "neutral" | "negative" | "not_found";
  avgPosition?: "early" | "middle" | "late" | "not_found";
  recommendationRate?: number;
}): VisibilityScoreResponse {
  const dataIssues: string[] = [];

  const citationValue = input.citationFrequency ?? null;
  const mentionValue = input.mentionRate ?? null;
  const sentimentValue =
    input.dominantSentiment != null
      ? (SENTIMENT_MAP[input.dominantSentiment] ?? null)
      : null;
  const positionValue =
    input.avgPosition != null
      ? (POSITION_MAP[input.avgPosition] ?? null)
      : null;
  const recommendationValue = input.recommendationRate ?? null;

  if (citationValue === null)
    dataIssues.push("citationFrequency not provided — contributing 0");
  if (mentionValue === null)
    dataIssues.push("mentionRate not provided — contributing 0");
  if (sentimentValue === null)
    dataIssues.push("dominantSentiment not provided — contributing 0");
  if (positionValue === null)
    dataIssues.push("avgPosition not provided — contributing 0");
  if (recommendationValue === null)
    dataIssues.push("recommendationRate not provided — contributing 0");

  const citationItem = makeBreakdownItem(0.3, citationValue);
  const mentionItem = makeBreakdownItem(0.25, mentionValue);
  const sentimentItem = makeBreakdownItem(0.2, sentimentValue);
  const positionItem = makeBreakdownItem(0.15, positionValue);
  const recommendationItem = makeBreakdownItem(0.1, recommendationValue);

  const rawScore =
    citationItem.contribution +
    mentionItem.contribution +
    sentimentItem.contribution +
    positionItem.contribution +
    recommendationItem.contribution;

  const score = Math.round(Math.min(100, Math.max(0, rawScore)));
  const delta =
    input.previousScore != null
      ? Math.round(score - input.previousScore)
      : null;

  return {
    source: "computed",
    domain: input.domain,
    score,
    grade: computeGrade(score),
    breakdown: {
      citationRate: citationItem,
      mentionRate: mentionItem,
      sentimentScore: sentimentItem,
      positionScore: positionItem,
      recommendationRate: recommendationItem,
    },
    delta,
    dataIssues,
  };
}
