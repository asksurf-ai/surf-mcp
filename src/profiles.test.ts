import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { profileForPath, PROFILES, type ProfileName } from "./profiles.js";
import { createSurfServer } from "./server.js";
import type { OpenAPISpec } from "./spec.js";

function op(tag: string, operationId: string) {
  return { get: { operationId, summary: operationId, tags: [tag] } };
}

// A slice of the live spec: every endpoint that carries third-party news or
// web content, next to ordinary data endpoints in the same tags.
const SPEC: OpenAPISpec = {
  info: { title: "Surf", version: "test" },
  tags: [
    { name: "Search", description: "Search projects, news articles, and web pages." },
    { name: "Market", description: "Prices and rankings." },
  ],
  paths: {
    "/gateway/v1/market/price": op("Market", "market-price"),
    "/gateway/v1/news/feed": op("News", "news-feed"),
    "/gateway/v1/news/detail": op("News", "news-detail"),
    "/gateway/v1/search/project": op("Search", "search-project"),
    "/gateway/v1/search/news": op("Search", "search-news"),
    "/gateway/v1/search/web": op("Search", "search-web"),
    "/gateway/v1/search/events": op("Search", "search-events"),
    "/gateway/v1/search/fundraising": op("Search", "search-fundraising"),
    "/gateway/v1/project/detail": op("Project", "project-detail"),
    "/gateway/v1/project/ai-news": op("Project", "project-ai-news"),
    "/gateway/v1/project/pulse": op("Project", "project-pulse"),
    "/gateway/v1/web/fetch": op("Web", "web-fetch"),
    "/gateway/v1/heatscore/detail": op("Signal", "signal-detail"),
    "/gateway/v1/x/tweets": op("X", "x-tweets"),
    "/gateway/v1/brand-new/thing": op("Brand New", "brand-new-thing"),
  },
};

async function connect(profile?: ProfileName) {
  const server = createSurfServer(SPEC, undefined, profile);
  const client = new Client({ name: "test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

async function listCommands(profile?: ProfileName): Promise<Record<string, string[]>> {
  const client = await connect(profile);
  const { tools } = await client.listTools();
  return Object.fromEntries(
    tools.map((tool) => {
      const command = tool.inputSchema.properties?.command as { enum?: string[] };
      return [tool.name, [...(command.enum ?? [])].sort()];
    })
  );
}

describe("default profile", () => {
  test("exposes every tool and command in the spec", async () => {
    expect(await listCommands()).toEqual({
      surf_market: ["price"],
      surf_news: ["detail", "feed"],
      surf_search: ["events", "fundraising", "news", "project", "web"],
      surf_project: ["ai-news", "detail", "pulse"],
      surf_web: ["fetch"],
      surf_signal: ["detail"],
      surf_x: ["tweets"],
      surf_brand_new: ["thing"],
    });
  });
});

describe("chatgpt profile", () => {
  async function toolNames(): Promise<string[]> {
    const { tools } = await (await connect("chatgpt")).listTools();
    return tools.map((t) => t.name).sort();
  }

  test("drops news, web, signal, and X content, keeps data endpoints", async () => {
    expect(await toolNames()).toEqual([
      "surf_market_price",
      "surf_project_detail",
      "surf_search_project",
    ]);
  });

  test("does not expose endpoints added to the spec later", async () => {
    const names = await toolNames();
    expect(names.some((n) => n.startsWith("surf_brand_new"))).toBe(false);
  });

  test("no tool name or description mentions news or web", async () => {
    const { tools } = await (await connect("chatgpt")).listTools();
    for (const tool of tools) {
      expect(tool.name).not.toMatch(/news|web/);
      expect(tool.description ?? "").not.toMatch(/\bnews\b|\bweb\b/i);
    }
  });

  test("server instructions do not mention news or web", async () => {
    const client = await connect("chatgpt");
    expect(client.getInstructions()).not.toMatch(/news|web/i);
  });

  test("a hidden operation cannot be called", async () => {
    const client = await connect("chatgpt");
    const result = await client.callTool({
      name: "surf_search_news",
      arguments: { q: "btc" },
    });
    expect(result.isError).toBe(true);
  });

  test("the allowlist never names a news or web command", () => {
    const allowed = PROFILES.chatgpt.allowedCommands!;
    expect(allowed.surf_news).toBeUndefined();
    expect(allowed.surf_web).toBeUndefined();
    expect(allowed.surf_signal).toBeUndefined();
    expect(allowed.surf_x).toBeUndefined();
    for (const commands of Object.values(allowed)) {
      for (const command of commands) {
        expect(command).not.toMatch(/news|web|pulse|^events$|^fundraising$/);
      }
    }
  });
});

describe("profileForPath", () => {
  test("maps hosted paths to profiles", () => {
    expect(profileForPath("/mcp")).toBe("default");
    expect(profileForPath("/api/mcp")).toBe("default");
    expect(profileForPath("/mcp/chatgpt")).toBe("chatgpt");
    expect(profileForPath("/api/mcp/chatgpt")).toBe("chatgpt");
    expect(profileForPath("/mcp/chatgpt/")).toBe("chatgpt");
    expect(profileForPath("/mcp/unknown")).toBeUndefined();
    expect(profileForPath("/other")).toBeUndefined();
  });
});
