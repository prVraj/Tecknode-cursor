import { env } from "@/env/server";
import type { NormalizedMention, PlatformClient } from "../types";

const QUERY = /* GraphQL */ `
  query Search($first: Int!) {
    posts(first: $first, order: NEWEST) {
      edges {
        node {
          id
          name
          tagline
          slug
          createdAt
          votesCount
          commentsCount
          url
          user { name username }
        }
      }
    }
  }
`;

type Edge = {
  node: {
    id: string;
    name: string | null;
    tagline: string | null;
    slug: string;
    createdAt: string;
    votesCount: number;
    commentsCount: number;
    url: string;
    user?: { name?: string; username?: string };
  };
};

export const productHuntClient: PlatformClient = {
  platform: "producthunt",
  // NOTE: the Product Hunt GraphQL API has no text-search argument, so this is
  // a "newest posts" monitor — it fetches the latest launches and filters by
  // brand client-side. A brand only surfaces if it's in the recent feed; this
  // is not a historical search.
  async search({ brandName, limit }) {
    if (!env.PRODUCTHUNT_TOKEN) return null;

    const res = await fetch("https://api.producthunt.com/v2/api/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.PRODUCTHUNT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: QUERY,
        variables: { first: Math.min(limit, 50) },
      }),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`ProductHunt ${res.status}: ${res.statusText}`);
    }
    const body = (await res.json()) as {
      data?: { posts?: { edges?: Edge[] } };
      errors?: Array<{ message: string }>;
    };
    if (body.errors?.length) {
      throw new Error(
        `ProductHunt: ${body.errors[0]?.message ?? "GraphQL error"}`,
      );
    }

    const lowerBrand = brandName.toLowerCase();
    return (body.data?.posts?.edges ?? [])
      .map((e) => e.node)
      .filter(
        (n) =>
          (n.name ?? "").toLowerCase().includes(lowerBrand) ||
          (n.tagline ?? "").toLowerCase().includes(lowerBrand),
      )
      .map(
        (n): NormalizedMention => ({
          platform: "producthunt",
          id: n.id,
          text: `${n.name ?? ""} — ${n.tagline ?? ""}`,
          url: n.url,
          author: {
            name: n.user?.name ?? null,
            handle: n.user?.username ?? null,
          },
          createdAt: n.createdAt,
          engagement: { score: n.votesCount, comments: n.commentsCount },
        }),
      );
  },
};
