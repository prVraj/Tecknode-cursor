import { Redis } from "@upstash/redis";
import { env } from "@/env/server";

/**
 * Shared Upstash Redis client (REST). Optional — `null` when the env vars are
 * absent (e.g. local dev), so every caller MUST handle the null case and
 * degrade gracefully rather than assuming a client exists.
 *
 * Better Auth constructs its own client in `src/lib/auth.ts` for secondary
 * storage; this export is the general-purpose one (intel fetch cache, etc.).
 * Two stateless REST clients are harmless — they only hold url + token.
 */
export const redis =
  env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: env.UPSTASH_REDIS_REST_URL,
        token: env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;
