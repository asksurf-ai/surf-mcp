import { afterEach, describe, expect, test } from "bun:test";
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleMcpHttpRequest } from "./http.js";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

type Captured = { status?: number; headers?: Record<string, unknown>; body?: string };

function fakeExchange(method: string, headers: Record<string, string> = {}) {
  const captured: Captured = {};
  const req = { method, headers } as unknown as IncomingMessage;
  const res = {
    writeHead(status: number, hdrs: Record<string, unknown>) {
      captured.status = status;
      captured.headers = hdrs;
      return res;
    },
    end(body?: string) {
      captured.body = body;
      return res;
    },
  } as unknown as ServerResponse;
  return { req, res, captured };
}

describe("handleMcpHttpRequest", () => {
  test("answers an authenticated GET with 405 instead of an empty SSE stream", async () => {
    process.env.SURF_MCP_REQUIRE_AUTH = "1";
    process.env.SURF_OAUTH_AUTHORIZATION_SERVER = "https://api.asksurf.ai/muninn/v2/oauth";
    const { req, res, captured } = fakeExchange("GET", {
      authorization: "Bearer token",
      accept: "text/event-stream",
    });

    await handleMcpHttpRequest(req, res, "chatgpt");

    expect(captured.status).toBe(405);
    expect(captured.headers?.allow).toBe("POST");
    expect(JSON.parse(captured.body ?? "{}").error.code).toBe(-32000);
  });

  test("still challenges a credential-less GET so OAuth discovery works", async () => {
    process.env.SURF_MCP_REQUIRE_AUTH = "1";
    process.env.SURF_OAUTH_AUTHORIZATION_SERVER = "https://api.asksurf.ai/muninn/v2/oauth";
    const { req, res, captured } = fakeExchange("GET");

    await handleMcpHttpRequest(req, res, "chatgpt");

    expect(captured.status).toBe(401);
    expect(String(captured.headers?.["www-authenticate"])).toContain("resource_metadata=");
  });
});
