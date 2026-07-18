import { env } from "@/env/server";
import { peekCache, primeCache } from "../store/author-cache";
import type { NormalizedMention, PlatformClient } from "../types";

const PDS = "https://bsky.social";

type Post = {
  uri: string;
  cid: string;
  author?: {
    did?: string;
    handle?: string;
    displayName?: string;
  };
  record?: {
    text?: string;
    createdAt?: string;
  };
  likeCount?: number;
  replyCount?: number;
  repostCount?: number;
  indexedAt?: string;
};

function postUrl(uri: string, handle: string | null): string {
  // at://did:plc:xyz/app.bsky.feed.post/{rkey} → https://bsky.app/profile/{handle}/post/{rkey}
  const rkey = uri.split("/").pop();
  if (!(handle && rkey)) return uri;
  return `https://bsky.app/profile/${handle}/post/${rkey}`;
}

let cachedJwt: { value: string; expiresAt: number } | null = null;

async function getAccessJwt(): Promise<string> {
  if (cachedJwt && Date.now() < cachedJwt.expiresAt) {
    return cachedJwt.value;
  }
  if (!(env.BLUESKY_IDENTIFIER && env.BLUESKY_APP_PASSWORD)) {
    throw new Error("Bluesky creds missing");
  }
  const res = await fetch(`${PDS}/xrpc/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identifier: env.BLUESKY_IDENTIFIER,
      password: env.BLUESKY_APP_PASSWORD,
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Bluesky auth ${res.status}: ${body || res.statusText}`);
  }
  const body = (await res.json()) as { accessJwt: string };
  // Access JWTs are short-lived (~2h); cache 90 min to stay safely valid.
  cachedJwt = {
    value: body.accessJwt,
    expiresAt: Date.now() + 90 * 60 * 1000,
  };
  return cachedJwt.value;
}

/**
 * followersCount isn't in searchPosts — batch-fetch via getProfiles
 * (≤25 actors/call), cached per DID so re-seen authors cost nothing.
 */
async function fetchFollowers(
  dids: string[],
  jwt: string,
): Promise<Map<string, number | undefined>> {
  const out = new Map<string, number | undefined>();
  const misses: string[] = [];

  for (const did of dids) {
    const c = peekCache<number | undefined>(`bluesky:${did}`);
    if (c.hit) out.set(did, c.value);
    else misses.push(did);
  }

  for (let i = 0; i < misses.length; i += 25) {
    const chunk = misses.slice(i, i + 25);
    const u = new URL(`${PDS}/xrpc/app.bsky.actor.getProfiles`);
    for (const d of chunk) u.searchParams.append("actors", d);
    const r = await fetch(u, {
      headers: { Authorization: `Bearer ${jwt}` },
      cache: "no-store",
    });
    if (!r.ok) {
      for (const d of chunk) out.set(d, undefined);
      continue;
    }
    const data = (await r.json()) as {
      profiles?: Array<{ did: string; followersCount?: number }>;
    };
    for (const prof of data.profiles ?? []) {
      out.set(prof.did, prof.followersCount);
      primeCache(`bluesky:${prof.did}`, prof.followersCount);
    }
  }
  return out;
}

export const blueskyClient: PlatformClient = {
  platform: "bluesky",
  async search({ brandName, limit }) {
    if (!(env.BLUESKY_IDENTIFIER && env.BLUESKY_APP_PASSWORD)) return null;

    const jwt = await getAccessJwt();
    const url = new URL(`${PDS}/xrpc/app.bsky.feed.searchPosts`);
    url.searchParams.set("q", brandName);
    url.searchParams.set("limit", String(Math.min(limit, 100)));
    url.searchParams.set("sort", "latest");

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${jwt}` },
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Bluesky ${res.status}: ${body || res.statusText}`);
    }
    const body = (await res.json()) as { posts?: Post[] };
    const posts = body.posts ?? [];

    const dids = [
      ...new Set(
        posts.map((p) => p.author?.did).filter((d): d is string => !!d),
      ),
    ];
    const followers = await fetchFollowers(dids, jwt);

    return posts.map((p): NormalizedMention => {
      const handle = p.author?.handle ?? null;
      const did = p.author?.did;
      return {
        platform: "bluesky",
        // AT-URI is the unique, stable per-post id. `cid` is a content hash, so
        // two posts with identical content would collide and be deduped away.
        id: p.uri,
        text: p.record?.text ?? "",
        url: postUrl(p.uri, handle),
        author: {
          name: p.author?.displayName ?? handle,
          handle,
          followerCount: did ? followers.get(did) : undefined,
        },
        createdAt:
          p.record?.createdAt ?? p.indexedAt ?? new Date().toISOString(),
        engagement: {
          score: p.likeCount,
          comments: p.replyCount,
          shares: p.repostCount,
        },
      };
    });
  },
};
