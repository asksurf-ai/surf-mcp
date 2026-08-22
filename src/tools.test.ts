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
