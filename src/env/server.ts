import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.url(),
    // Session signing secret.
    BETTER_AUTH_SECRET: z.string().min(32),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    ENABLE_SIGNUPS: z.enum(["true", "false"]).default("true"),
    // Secret encryption for stored integration/delivery credentials.
    // Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
    SECRET_ENCRYPTION_KEY: z
      .string()
      .regex(/^[A-Za-z0-9_-]{43,44}$/, {
        message:
          "Must be a 32-byte base64url string. Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64url'))\"",
      })
      .optional(),
    // Cloudflare Turnstile — optional at schema level so local/dev can boot.
    TURNSTILE_SECRET_KEY: z.string().min(1).optional(),
    // Upstash Redis — secondary storage for Better Auth rate limiting.
    UPSTASH_REDIS_REST_URL: z.url().optional(),
    UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
    // Cron auth — protects scheduled routes. Min 32 chars.
    CRON_SECRET: z.string().min(32).optional(),
    // Intelligence providers (used by later tasks; optional at boot).
    OPENROUTER_API_KEY: z.string().min(1).optional(),
    DATAFORSEO_LOGIN: z.string().min(1).optional(),
    DATAFORSEO_PASSWORD: z.string().min(1).optional(),
    FIRECRAWL_API_KEY: z.string().min(1).optional(),
    GOOGLE_PSI_API_KEY: z.string().min(1).optional(),
    COMPOSIO_API_KEY: z.string().min(1).optional(),
    // Mentions/brand-protection scan sources — each is optional; the
    // corresponding client degrades to "no results" when its key is absent.
    BLUESKY_IDENTIFIER: z.string().min(1).optional(),
    BLUESKY_APP_PASSWORD: z.string().min(1).optional(),
    PRODUCTHUNT_TOKEN: z.string().min(1).optional(),
    REDDIT_CLIENT_ID: z.string().min(1).optional(),
    REDDIT_SECRET: z.string().min(1).optional(),
    X_BEARER_TOKEN: z.string().min(1).optional(),
    YOUTUBE_API_KEY: z.string().min(1).optional(),
    // Bypasses the intel fetch cache (in-flight dedup + Redis) entirely —
    // useful for local module development where you want every call live.
    INTEL_FETCH_CACHE_DISABLED: z.enum(["true", "false"]).default("false"),
  },
  experimental__runtimeEnv: process.env,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
