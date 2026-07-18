import { describe, expect, it } from "vitest";
import { p0Keywords } from "./p0-queries";

describe("p0Keywords", () => {
  it("anchors every phrase on the brand name", () => {
    const ks = p0Keywords("Higgsfield");
    expect(ks.length).toBeGreaterThan(0);
    expect(ks.every((k) => k.includes("Higgsfield"))).toBe(true);
  });

  it("covers churn, comparison, and intent phrasings", () => {
    const ks = p0Keywords("Acme").join(" | ");
    expect(ks).toContain("Acme alternative"); // comparison
    expect(ks).toContain("switched from Acme"); // churn
    expect(ks.toLowerCase()).toContain("worth it"); // buying intent
  });

  it("returns nothing for an empty brand", () => {
    expect(p0Keywords("   ")).toEqual([]);
  });
});
