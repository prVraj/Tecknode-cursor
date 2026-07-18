import { describe, expect, it } from "vitest";
import {
  type BooleanQuery,
  isEmptyBoolean,
  renderBooleanQuery,
} from "./boolean-query";

const bq = (over: Partial<BooleanQuery>): BooleanQuery => ({
  all: [],
  any: [],
  none: [],
  ...over,
});

describe("isEmptyBoolean", () => {
  it("is true for undefined / empty", () => {
    expect(isEmptyBoolean(undefined)).toBe(true);
    expect(isEmptyBoolean(bq({}))).toBe(true);
  });
  it("is false when any list has a term", () => {
    expect(isEmptyBoolean(bq({ any: ["x"] }))).toBe(false);
  });
});

describe("renderBooleanQuery — full (operator-rich)", () => {
  it("ANDs all, ORs any in a group, negates none", () => {
    const out = renderBooleanQuery(
      bq({ all: ["video"], any: ["broken", "slow"], none: ["free"] }),
      "full",
    );
    expect(out).toBe("video (broken OR slow) -free");
  });

  it("quotes multi-word terms", () => {
    const out = renderBooleanQuery(bq({ all: ["video editor"] }), "full");
    expect(out).toBe('"video editor"');
  });

  it("single any term has no parens", () => {
    expect(renderBooleanQuery(bq({ any: ["broken"] }), "full")).toBe("broken");
  });
});

describe("renderBooleanQuery — simple (no operators)", () => {
  it("ORs all+any and drops NONE", () => {
    const out = renderBooleanQuery(
      bq({ all: ["video"], any: ["broken", "slow"], none: ["free"] }),
      "simple",
    );
    expect(out).toBe("video OR broken OR slow");
  });
});
