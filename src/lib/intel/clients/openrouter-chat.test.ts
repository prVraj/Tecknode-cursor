import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/env/server", () => ({ env: {}, serverEnv: {} }));

const recordApiUsage = vi.fn();
vi.mock("@/lib/observability/api-usage", () => ({
  recordApiUsage: (...args: unknown[]) => recordApiUsage(...args),
  dollarsToMicroUsd: (d: number) =>
    !Number.isFinite(d) || d <= 0 ? BigInt(0) : BigInt(Math.round(d * 1e6)),
}));

const { openrouterFetch } = await import("./openrouter-chat");

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const REPLY = {
  choices: [{ message: { content: "hi" } }],
  usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
};

const init = () => ({
  method: "POST",
  body: JSON.stringify({ model: "openai/gpt-4o-mini", messages: [] }),
});

describe("openrouterFetch", () => {
  beforeEach(() => {
    recordApiUsage.mockReset();
    fetchMock.mockReset();
  });

  it("records tokens and the provider-reported cost", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ ...REPLY, usage: { ...REPLY.usage, cost: 0.0025 } }),
        {
          status: 200,
        },
      ),
    );

    await openrouterFetch("geo.citations", init());

    const [event] = recordApiUsage.mock.calls[0];
    expect(event.provider).toBe("openrouter");
    expect(event.operation).toBe("geo.citations");
    expect(event.unitType).toBe("token");
    expect(event.units).toBe(150);
    expect(event.status).toBe("success");
    // $0.0025 → 2500 micro-USD, taken from the response, not a price table.
    expect(event.costMicroUsd).toBe(BigInt(2500));
    expect(event.costSource).toBe("body");
  });

  it("asks OpenRouter to include cost in the response", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(REPLY)));
    await openrouterFetch("op", init());
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sent.usage).toEqual({ include: true });
    expect(sent.model).toBe("openai/gpt-4o-mini"); // original body preserved
  });

  it("still returns a usable Response — body is not consumed", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(REPLY), { status: 200 }),
    );

    const res = await openrouterFetch("op", init());

    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    // Callers do `await res.json()` — this must still work after we read the
    // body internally to extract usage.
    await expect(res.json()).resolves.toMatchObject({
      choices: [{ message: { content: "hi" } }],
    });
  });

  it("records tokens on an HTTP error — a 4xx can still bill for output", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ error: "bad", usage: { total_tokens: 12 } }),
        {
          status: 429,
        },
      ),
    );

    const res = await openrouterFetch("op", init());

    expect(res.status).toBe(429);
    const [event] = recordApiUsage.mock.calls[0];
    expect(event.status).toBe("error");
    expect(event.httpStatus).toBe(429);
    expect(event.units).toBe(12);
  });

  it("records the attempt and rethrows when the network fails", async () => {
    fetchMock.mockRejectedValue(new TypeError("network down"));

    await expect(openrouterFetch("op", init())).rejects.toThrow("network down");

    const [event] = recordApiUsage.mock.calls[0];
    expect(event.status).toBe("error");
    expect(event.units).toBe(0);
    expect(event.costSource).toBe("unknown");
  });

  it("falls back to unknown cost when the provider omits it", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(REPLY)));
    await openrouterFetch("op", init());
    const [event] = recordApiUsage.mock.calls[0];
    expect(event.units).toBe(150); // tokens still captured
    expect(event.costMicroUsd).toBe(BigInt(0));
    expect(event.costSource).toBe("unknown");
  });

  it("survives a non-JSON body without throwing", async () => {
    fetchMock.mockResolvedValue(
      new Response("upstream 502 html", { status: 502 }),
    );
    const res = await openrouterFetch("op", init());
    expect(res.status).toBe(502);
    expect(recordApiUsage.mock.calls[0][0].units).toBe(0);
  });

  it("does not throw on a null-body status from an upstream proxy (204)", async () => {
    // `new Response(body, { status: 204 })` throws — a 204 from a gateway must
    // be rebuilt with a null body, not the decoded text.
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const res = await openrouterFetch("op", init());
    expect(res.status).toBe(204);
  });

  it("preserves a caller's existing usage options when adding include", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(REPLY)));
    await openrouterFetch("op", {
      method: "POST",
      body: JSON.stringify({ model: "m", usage: { keep: true } }),
    });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sent.usage).toEqual({ keep: true, include: true });
  });

  it("records bigint cost on the network-failure path", async () => {
    fetchMock.mockRejectedValue(new Error("boom"));
    await expect(openrouterFetch("op", init())).rejects.toThrow();
    expect(typeof recordApiUsage.mock.calls[0][0].costMicroUsd).toBe("bigint");
  });
});
