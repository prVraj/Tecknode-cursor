import { Redis } from "@upstash/redis";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { captcha } from "better-auth/plugins";
import { emailHarmony } from "better-auth-harmony";
import { env as clientEnv } from "@/env/client";
import { env as serverEnv } from "@/env/server";
import { db } from "@/server/db";
import * as schema from "@/server/db/models/auth.model";

// Upstash Redis for Better Auth secondary storage (rate-limit counters).
// Optional in dev — falls back to per-instance memory when env vars are absent.
const redis =
  serverEnv.UPSTASH_REDIS_REST_URL && serverEnv.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: serverEnv.UPSTASH_REDIS_REST_URL,
        token: serverEnv.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

const googleEnabled = !!(
  serverEnv.GOOGLE_CLIENT_ID && serverEnv.GOOGLE_CLIENT_SECRET
);

export const auth = betterAuth({
  baseURL: clientEnv.NEXT_PUBLIC_SERVER_URL || "http://localhost:3000",
  secret: serverEnv.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  session: {
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  ...(redis && {
    secondaryStorage: {
      get: async (key) => {
        const value = await redis.get(key);
        return value == null ? null : JSON.stringify(value);
      },
      set: async (key, value, ttl) => {
        if (ttl) await redis.set(key, value, { ex: ttl });
        else await redis.set(key, value);
      },
      delete: async (key) => {
        await redis.del(key);
      },
    },
  }),
  rateLimit: {
    enabled: true,
    storage: redis ? "secondary-storage" : "memory",
    window: 60,
    max: 100,
    customRules: {
      "/sign-up/email": { window: 3600, max: 5 },
      "/sign-in/email": { window: 60, max: 10 },
    },
  },
  advanced: {
    ipAddress: {
      ipAddressHeaders: ["x-forwarded-for"],
      // Treat each /64 IPv6 prefix as one IP so attackers can't rotate through
      // free /128 addresses inside a single /64 block.
      ipv6Subnet: 64,
    },
  },
  trustedOrigins: [
    clientEnv.NEXT_PUBLIC_SERVER_URL,
    ...(process.env.VERCEL_URL ? [`https://${process.env.VERCEL_URL}`] : []),
  ],
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
  },
  ...(googleEnabled && {
    socialProviders: {
      google: {
        clientId: serverEnv.GOOGLE_CLIENT_ID as string,
        clientSecret: serverEnv.GOOGLE_CLIENT_SECRET as string,
        redirectURI: `${clientEnv.NEXT_PUBLIC_SERVER_URL}/api/auth/callback/google`,
      },
    },
  }),
  plugins: [
    // Email hygiene: normalizes email (gmail +alias/dot dedup) → unique
    // `normalizedEmail`. Registered in all envs so the generated schema is
    // deterministic.
    emailHarmony(),
    // Cloudflare Turnstile bot protection — only registered when a secret is
    // configured (skipped in local dev).
    ...(serverEnv.TURNSTILE_SECRET_KEY
      ? [
          captcha({
            provider: "cloudflare-turnstile",
            secretKey: serverEnv.TURNSTILE_SECRET_KEY,
          }),
        ]
      : []),
    // Must stay last: forwards Set-Cookie from auth.api.* calls in Server Actions.
    nextCookies(),
  ],
});
