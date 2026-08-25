import { afterEach, describe, expect, test } from "bun:test";
import { callDataApi } from "./tools.js";

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  globalThis.fetch = ORIGINAL_FETCH;
});

function captureFetch(): { headers: () => Record<string, string> } {
  let captured: Record<string, string> = {};
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    captured = { ...(init?.headers as Record<string, string>) };
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { headers: () => captured };
}

describe("callDataApi auth propagation", () => {
  test("sends the caller's Authorization header upstream", async () => {
    process.env.SURF_API_KEY = "service-key";
    const upstream = captureFetch();

    await callDataApi("GET", "market/price", { symbol: "BTC" }, {
      authorization: "Bearer sk-surf-caller",
    });

    expect(upstream.headers().authorization).toBe("Bearer sk-surf-caller");
  });

  test("uses the service key when the caller sends none", async () => {
    process.env.SURF_API_KEY = "service-key";
    const upstream = captureFetch();

    await callDataApi("GET", "market/price", { symbol: "BTC" });

    expect(upstream.headers().authorization).toBe("Bearer service-key");
  });

  test("stays anonymous without caller header or service key", async () => {
    delete process.env.SURF_API_KEY;
    const upstream = captureFetch();

    await callDataApi("GET", "market/price", { symbol: "BTC" });

    expect(upstream.headers().authorization).toBeUndefined();
  });
});

describe("callDataApi error surfacing", () => {
  function failWith(status: number, body: unknown) {
    globalThis.fetch = (async (_url: unknown, _init?: RequestInit) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
  }

  test("anonymous quota exhaustion reaches the caller as guidance", async () => {
    delete process.env.SURF_API_KEY;
    failWith(402, {
      error: { code: "FREE_QUOTA_EXHAUSTED", message: "insufficient credit" },
    });

    await expect(
      callDataApi("GET", "market/price", { symbol: "BTC" })
    ).rejects.toThrow(/anonymous daily allowance[\s\S]*agents\.asksurf\.ai/);
  });

  test("zero balance on an authenticated call points at Billing", async () => {
    process.env.SURF_API_KEY = "service-key";
    failWith(402, {
      error: { code: "PAID_BALANCE_ZERO", message: "insufficient credit" },
    });

    await expect(
      callDataApi("GET", "market/price", { symbol: "BTC" })
    ).rejects.toThrow(/no credits left[\s\S]*Billing/);
  });
});
