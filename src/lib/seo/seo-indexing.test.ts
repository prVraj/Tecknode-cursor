import { describe, expect, it } from "vitest";
import { parseCanonical, parseMetaRobots } from "./fetch-page-head";
import { indexNowHost, indexNowKeyLocation } from "./indexnow";
import { normalizeUrlForCompare } from "./url-compare";

describe("parseMetaRobots (accidental-noindex detection)", () => {
  it("detects noindex regardless of attribute order", () => {
    expect(
      parseMetaRobots('<meta name="robots" content="noindex,nofollow">'),
    ).toBe("noindex,nofollow");
    expect(parseMetaRobots('<meta content="noindex" name="robots">')).toBe(
      "noindex",
    );
  });

  it("matches case-insensitively and supports googlebot", () => {
    expect(parseMetaRobots('<META NAME="ROBOTS" CONTENT="NoIndex">')).toBe(
      "noindex",
    );
    expect(
      parseMetaRobots('<meta name="googlebot" content="noindex">'),
    ).toContain("noindex");
  });

  it("returns null when there is no robots meta", () => {
    expect(
      parseMetaRobots('<meta name="description" content="hello">'),
    ).toBeNull();
    expect(parseMetaRobots("<html><body>no head</body></html>")).toBeNull();
  });

  it("returns the directive for index,follow (not a noindex)", () => {
    const robots = parseMetaRobots(
      '<meta name="robots" content="index, follow">',
    );
    expect(robots).toBe("index, follow");
    expect(robots?.includes("noindex")).toBe(false);
  });
});

describe("parseCanonical", () => {
  it("extracts and absolutizes a relative canonical", () => {
    expect(
      parseCanonical(
        '<link rel="canonical" href="/pricing">',
        "https://acme.com/x",
      ),
    ).toBe("https://acme.com/pricing");
  });

  it("returns absolute canonicals unchanged", () => {
    expect(
      parseCanonical(
        '<link rel="canonical" href="https://acme.com/home">',
        "https://acme.com/home",
      ),
    ).toBe("https://acme.com/home");
  });

  it("returns null when no canonical link is present", () => {
    expect(
      parseCanonical(
        '<link rel="stylesheet" href="/a.css">',
        "https://acme.com",
      ),
    ).toBeNull();
  });
});

describe("normalizeUrlForCompare (canonical drift logic)", () => {
  it("treats protocol, www and trailing slash as the same page", () => {
    const a = normalizeUrlForCompare("https://www.acme.com/pricing/");
    const b = normalizeUrlForCompare("http://acme.com/pricing");
    expect(a).toBe(b);
  });

  it("treats different paths as different pages (drift)", () => {
    const page = normalizeUrlForCompare("https://acme.com/pricing");
    const canonical = normalizeUrlForCompare("https://acme.com/");
    expect(page).not.toBe(canonical);
  });

  it("treats a different host as drift", () => {
    expect(normalizeUrlForCompare("https://acme.com/x")).not.toBe(
      normalizeUrlForCompare("https://other.com/x"),
    );
  });
});

describe("indexNow helpers", () => {
  it("reduces any URL form to a bare host", () => {
    expect(indexNowHost("https://www.acme.com/pricing")).toBe("acme.com");
    expect(indexNowHost("acme.com:443")).toBe("acme.com");
  });

  it("builds the key file location", () => {
    expect(indexNowKeyLocation("acme.com", "abc123")).toBe(
      "https://acme.com/abc123.txt",
    );
  });
});
