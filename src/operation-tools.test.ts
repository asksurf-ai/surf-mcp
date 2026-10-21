import { afterEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { ProfileName } from "./profiles.js";
import { createSurfServer } from "./server.js";
import type { OpenAPISpec } from "./spec.js";

// OpenAI plugin review rejects dispatcher tools ("This tool appears to
// execute operations that are not individually exposed"): the chatgpt
// profile exposes each allowed operation as its own tool, with its own
// description, typed input schema, and annotations.

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

const SPEC: OpenAPISpec = {
  info: { title: "Surf", version: "test" },
  tags: [{ name: "Market", description: "Prices and rankings." }],
  paths: {
    "/gateway/v1/market/price": {
      get: {
        operationId: "market-price",
        summary: "Token Price History",
        description: "Returns historical price data points for a token.",
        tags: ["Market"],
        parameters: [
          {
            name: "symbol",
            in: "query",
            required: true,
            description: "Token ticker like `BTC`",
            schema: { type: "string" },
          },
          {
            name: "time_range",
            in: "query",
            description: "Window of data",
            schema: { type: "string", enum: ["1d", "7d", "30d"], default: "30d" },
          },
          {
            name: "limit",
            in: "query",
            description: "Rows to return",
            schema: { type: "integer", minimum: 1, maximum: 100 },
          },
          { name: "Authorization", in: "header", schema: { type: "string" } },
        ],
      },
    },
    // Not in the chatgpt allowlist: must not become a tool.
    "/gateway/v1/market/secret": {
      get: { operationId: "market-secret", summary: "Hidden", tags: ["Market"] },
    },
    "/gateway/v1/fund/{id}": {
      get: {
        operationId: "fund-detail",
        summary: "Fund Detail",
        description: "**Lookup:** by fund UUID (`id`).",
        tags: ["Fund"],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
      },
    },
    "/gateway/v1/onchain/sql": {
      post: {
        operationId: "onchain-sql",
        summary: "Run SQL",
        tags: ["Onchain"],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                properties: {
                  $schema: { type: "string", readOnly: true },
                  sql: { type: "string", description: "ClickHouse SQL" },
                  max_rows: { type: "integer", default: 1000 },
                },
                required: ["sql"],
              },
            },
          },
        },
      },
    },
  },
};

type Captured = { url: string; method: string; body?: string };

function captureFetch(): Captured[] {
  const calls: Captured[] = [];
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      body: init?.body as string | undefined,
    });
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return calls;
}

async function connect(profile: ProfileName) {
  const server = createSurfServer(SPEC, undefined, profile);
  const client = new Client({ name: "test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("chatgpt profile: one tool per operation", () => {
  test("names each allowed operation as its own tool", async () => {
    const { tools } = await (await connect("chatgpt")).listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "surf_fund_detail",
      "surf_market_price",
      "surf_onchain_sql",
    ]);
  });

  test("a tool has a typed input schema instead of command + params", async () => {
    const { tools } = await (await connect("chatgpt")).listTools();
    const price = tools.find((t) => t.name === "surf_market_price")!;
    const props = price.inputSchema.properties as Record<string, any>;

    expect(Object.keys(props).sort()).toEqual(["limit", "symbol", "time_range"]);
    expect(price.inputSchema.required).toEqual(["symbol"]);
    expect(props.symbol.type).toBe("string");
    expect(props.symbol.description).toContain("Token ticker");
    expect(props.time_range.enum).toEqual(["1d", "7d", "30d"]);
    expect(props.limit.type).toBe("integer");
    expect(props.limit.minimum).toBe(1);
    expect(props.limit.maximum).toBe(100);
  });

  test("a tool describes its own operation", async () => {
    const { tools } = await (await connect("chatgpt")).listTools();
    const price = tools.find((t) => t.name === "surf_market_price")!;
    expect(price.title).toBe("Token Price History");
    expect(price.description).toContain("Returns historical price data points");
    const fund = tools.find((t) => t.name === "surf_fund_detail")!;
    expect(fund.description).toContain("by fund UUID");
  });

  test("every tool is annotated read-only and closed-world", async () => {
    const { tools } = await (await connect("chatgpt")).listTools();
    for (const tool of tools) {
      expect(tool.annotations).toEqual({
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
      });
    }
  });

  test("calling a tool sends its arguments as the query string", async () => {
    const calls = captureFetch();
    const client = await connect("chatgpt");

    const result = await client.callTool({
      name: "surf_market_price",
      arguments: { symbol: "BTC", limit: 5 },
    });

    expect(result.isError).toBeFalsy();
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toEndWith("/market/price");
    expect(url.searchParams.get("symbol")).toBe("BTC");
    expect(url.searchParams.get("limit")).toBe("5");
  });

  test("path parameters fill the URL template", async () => {
    const calls = captureFetch();
    const client = await connect("chatgpt");

    await client.callTool({ name: "surf_fund_detail", arguments: { id: "abc" } });

    expect(new URL(calls[0]!.url).pathname).toEndWith("/fund/abc");
  });

  test("POST operations send arguments as the JSON body", async () => {
    const calls = captureFetch();
    const client = await connect("chatgpt");

    await client.callTool({ name: "surf_onchain_sql", arguments: { sql: "SELECT 1" } });

    expect(calls[0]!.method).toBe("POST");
    expect(JSON.parse(calls[0]!.body!)).toEqual({ sql: "SELECT 1" });
  });

  test("a missing required argument is rejected before any API call", async () => {
    const calls = captureFetch();
    const client = await connect("chatgpt");

    const result = await client.callTool({ name: "surf_market_price", arguments: {} });

    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe("default profile", () => {
  test("keeps one grouped tool per tag with a command enum", async () => {
    const { tools } = await (await connect("default")).listTools();
    const market = tools.find((t) => t.name === "surf_market")!;
    const command = market.inputSchema.properties?.command as { enum?: string[] };
    expect([...(command.enum ?? [])].sort()).toEqual(["price", "secret"]);
  });
});
