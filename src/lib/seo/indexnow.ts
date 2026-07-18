import { randomBytes } from "node:crypto";
import { logExternalFailure } from "@/utils/log-external";

/**
 * IndexNow client — the remediation "fix" for indexing problems. IndexNow
 * instantly notifies Bing, Yandex, Seznam and Naver (NOT Google) that URLs have
 * changed. Verification requires a key file hosted at
 * `https://<host>/<key>.txt` containing the key; the platform generates the key
 * and verifies the file, but the user must host it on their own domain.
 *
 * Spec: https://www.indexnow.org/documentation
 */

const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
const FETCH_TIMEOUT_MS = 10_000;
// IndexNow accepts up to 10,000 URLs per request.
const MAX_URLS_PER_REQUEST = 10_000;

/** Generate a fresh IndexNow key (32 lowercase hex chars — within the 8–128 spec). */
export function generateIndexNowKey(): string {
  return randomBytes(16).toString("hex");
}

/** Bare hostname for IndexNow (no protocol, path, or `www.`). */
export function indexNowHost(domain: string): string {
  return domain
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split("/")[0]!
    .split(":")[0]!;
}

/** The URL where the user must host the key file. */
export function indexNowKeyLocation(domain: string, key: string): string {
  return `https://${indexNowHost(domain)}/${key}.txt`;
}

export interface VerifyResult {
  verified: boolean;
  reason: string | null;
}

/** Confirm the key file is reachable and contains exactly the key. */
export async function verifyIndexNowKeyHosted(
  domain: string,
  key: string,
): Promise<VerifyResult> {
  const location = indexNowKeyLocation(domain, key);
  try {
    const res = await fetch(location, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: "text/plain" },
    });
    if (!res.ok) {
      return {
        verified: false,
        reason: `Key file returned HTTP ${res.status}`,
      };
    }
    const body = (await res.text()).trim();
    if (body !== key) {
      return {
        verified: false,
        reason: "Key file content does not match the key",
      };
    }
    return { verified: true, reason: null };
  } catch (err) {
    logExternalFailure("fetch", "indexnow.verify", err, { domain });
    return {
      verified: false,
      reason: err instanceof Error ? err.message : "Key file not reachable",
    };
  }
}

export interface SubmitResult {
  ok: boolean;
  httpStatus: number | null;
  submittedCount: number;
  message: string;
}

/**
 * Submit URLs to IndexNow. Treats HTTP 200 and 202 as success (202 = accepted,
 * still validating the key). Never throws — failures return `{ ok: false }`.
 */
export async function submitToIndexNow({
  domain,
  key,
  urls,
}: {
  domain: string;
  key: string;
  urls: string[];
}): Promise<SubmitResult> {
  const host = indexNowHost(domain);
  const urlList = [...new Set(urls)].slice(0, MAX_URLS_PER_REQUEST);

  if (urlList.length === 0) {
    return {
      ok: false,
      httpStatus: null,
      submittedCount: 0,
      message: "No URLs to submit",
    };
  }

  try {
    const res = await fetch(INDEXNOW_ENDPOINT, {
      method: "POST",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host,
        key,
        keyLocation: indexNowKeyLocation(domain, key),
        urlList,
      }),
    });

    const ok = res.status === 200 || res.status === 202;
    let message = ok ? "Submitted" : `IndexNow returned HTTP ${res.status}`;
    if (!ok) {
      const body = await res.text().catch(() => "");
      if (body) message += `: ${body.slice(0, 200)}`;
    }

    return {
      ok,
      httpStatus: res.status,
      submittedCount: ok ? urlList.length : 0,
      message,
    };
  } catch (err) {
    logExternalFailure("fetch", "indexnow.submit", err, { domain });
    return {
      ok: false,
      httpStatus: null,
      submittedCount: 0,
      message: err instanceof Error ? err.message : "IndexNow request failed",
    };
  }
}
