import { timingSafeEqual } from "node:crypto";
import { env } from "@/env/server";

/**
 * Verifies a cron-protected request is authorized.
 *
 * Accepts either:
 * - `Authorization: Bearer <CRON_SECRET>` header (Vercel Cron default)
 * - `?token=<CRON_SECRET>` query param (manual / curl)
 *
 * If `CRON_SECRET` is not configured, the route is unauthorized — fail closed.
 */
export function isCronAuthorized(req: Request): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return false;

  const provided =
    extractBearer(req.headers.get("authorization")) ??
    new URL(req.url).searchParams.get("token");

  if (!provided) return false;
  return safeEqual(provided, secret);
}

function extractBearer(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1]! : null;
}

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}
