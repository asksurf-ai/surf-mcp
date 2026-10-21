import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import type { RequestAuth } from "./auth.js";
import type { ProfileName } from "./profiles.js";
import { createSurfServer } from "./server.js";
import type { OpenAPISpec } from "./spec.js";

// ChatGPT's mixed (public + OAuth) auth: tools advertise both noauth and
// oauth2 security schemes, and a call that needs a signed-in account returns
// an error carrying _meta["mcp/www_authenticate"], which is what makes
// ChatGPT show its account-linking UI.

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = globalThis.fetch;

const SPEC: OpenAPISpec = {
  info: { title: "Surf", version: "test" },
  paths: {
    "/gateway/v1/market/price": {
      get: { operationId: "market-price", summary: "price", tags: ["Market"] },
    },
  },
};

const SCHEMES = [
  { type: "noauth" },
  { type: "oauth2", scopes: ["data:read", "openid", "email"] },
];

beforeEach(() => {
  process.env.SURF_OAUTH_AUTHORIZATION_SERVER = "https://api.example.com/oauth";
  process.env.SURF_MCP_RESOURCE_URL = "https://mcp.example.com";
  delete process.env.SURF_API_KEY;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  globalThis.fetch = ORIGINAL_FETCH;
});

function upstream(status: number, body: unknown) {
  globalThis.fetch = (async (_url: unknown, _init?: RequestInit) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
}

async function connect(profile: ProfileName, auth?: RequestAuth) {
  const server = createSurfServer(SPEC, auth, profile);
  const client = new Client({ name: "test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

async function callPrice(profile: ProfileName, auth?: RequestAuth) {
  const client = await connect(profile, auth);
  return client.callTool({
    name: profile === "chatgpt" ? "surf_market_price" : "surf_market",
    arguments:
      profile === "chatgpt"
        ? { symbol: "BTC" }
        : { command: "price", params: { symbol: "BTC" } },
  });
}

// The raw tools/list result, as ChatGPT receives it: Client.listTools()
// validates against the SDK's Tool schema, which strips unknown fields.
async function rawTools(profile: ProfileName): Promise<Record<string, any>[]> {
  const client = await connect(profile);
  const result = await client.request(
    { method: "tools/list" },
    z.looseObject({ tools: z.array(z.looseObject({})) })
  );
  return result.tools as Record<string, any>[];
}

function challenges(result: Awaited<ReturnType<typeof callPrice>>): string[] | undefined {
  return (result._meta as Record<string, string[]> | undefined)?.["mcp/www_authenticate"];
}

function text(result: Awaited<ReturnType<typeof callPrice>>): string {
  return (result.content as { text: string }[])[0]!.text;
}

describe("chatgpt profile tool descriptors", () => {
  test("advertise noauth and oauth2 security schemes", async () => {
    const tool = (await rawTools("chatgpt")).find((t) => t.name === "surf_market_price")!;
    expect(tool.securitySchemes).toEqual(SCHEMES);
    expect(tool._meta?.securitySchemes).toEqual(SCHEMES);
  });

  test("advertise nothing while OAuth is not configured", async () => {
    delete process.env.SURF_OAUTH_AUTHORIZATION_SERVER;
    const tool = (await rawTools("chatgpt")).find((t) => t.name === "surf_market_price")!;
    expect(tool.securitySchemes).toBeUndefined();
    expect(tool._meta?.securitySchemes).toBeUndefined();
  });
});

describe("chatgpt profile sign-in challenges", () => {
  test("anonymous call to a credential-gated endpoint asks the user to sign in", async () => {
    upstream(401, { error: { code: "UNAUTHORIZED", message: "credential required" } });

    const result = await callPrice("chatgpt");

    expect(result.isError).toBe(true);
    expect(challenges(result)).toEqual([
      'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource", ' +
        'error="insufficient_scope", error_description="Sign in to Surf to use this tool."',
    ]);
    expect(text(result)).toMatch(/sign in/i);
    expect(text(result)).not.toMatch(/API key|Authorization: Bearer/);
  });

  test("anonymous allowance running out asks the user to sign in", async () => {
    upstream(402, { error: { code: "FREE_QUOTA_EXHAUSTED", message: "insufficient credit" } });

    const result = await callPrice("chatgpt");

    expect(challenges(result)?.[0]).toContain('error="insufficient_scope"');
  });

  test("anonymous rate limit asks the user to sign in", async () => {
    upstream(429, { error: { code: "RATE_LIMITED", message: "slow down" } });

    const result = await callPrice("chatgpt");

    expect(challenges(result)?.[0]).toContain('error="insufficient_scope"');
  });

  test("a rejected sign-in token asks the user to sign in again", async () => {
    upstream(401, { error: { code: "UNAUTHORIZED", message: "token expired" } });

    const result = await callPrice("chatgpt", { authorization: "Bearer expired" });

    expect(challenges(result)?.[0]).toContain('error="invalid_token"');
  });

  test("an empty balance on a signed-in account is not a sign-in problem", async () => {
    upstream(402, { error: { code: "PAID_BALANCE_ZERO", message: "insufficient credit" } });

    const result = await callPrice("chatgpt", { authorization: "Bearer user" });

    expect(result.isError).toBe(true);
    expect(challenges(result)).toBeUndefined();
    expect(text(result)).toContain("Billing");
  });

  test("a failing deployment service key does not challenge the user", async () => {
    process.env.SURF_API_KEY = "service-key";
    upstream(401, { error: { code: "UNAUTHORIZED", message: "revoked" } });

    const result = await callPrice("chatgpt");

    expect(challenges(result)).toBeUndefined();
  });

  test("no challenge while OAuth is not configured", async () => {
    delete process.env.SURF_OAUTH_AUTHORIZATION_SERVER;
    upstream(401, { error: { code: "UNAUTHORIZED", message: "credential required" } });

    const result = await callPrice("chatgpt");

    expect(result.isError).toBe(true);
    expect(challenges(result)).toBeUndefined();
  });
});

describe("default profile", () => {
  test("keeps API-key guidance and no ChatGPT auth metadata", async () => {
    upstream(401, { error: { code: "UNAUTHORIZED", message: "credential required" } });

    const result = await callPrice("default");
    const tools = await rawTools("default");

    expect(challenges(result)).toBeUndefined();
    expect(text(result)).toContain("Authorization: Bearer");
    expect(tools[0]!.securitySchemes).toBeUndefined();
    expect(tools[0]!._meta?.securitySchemes).toBeUndefined();
  });
});
