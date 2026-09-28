import { afterEach, describe, expect, test } from "bun:test";
import type { ServerResponse } from "node:http";
import {
  handleAuthorizationServerMetadataProxy,
  handleOpenIDConfigurationProxy,
} from "./wellknown.js";

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  globalThis.fetch = ORIGINAL_FETCH;
});

interface RecordedResponse {
  status?: number;
  headers?: Record<string, string>;
  body: string;
}

/** Minimal ServerResponse stand-in capturing what the relay writes. */
function recordingResponse(): { res: ServerResponse; out: RecordedResponse } {
  const out: RecordedResponse = { body: "" };
  const res = {
    writeHead(status: number, headers: Record<string, string>) {
      out.status = status;
      out.headers = headers;
      return this;
    },
    end(chunk?: string) {
      out.body = chunk ?? "";
    },
  } as unknown as ServerResponse;
  return { res, out };
}

function stubFetch(handler: (url: string) => Response | Promise<Response>): string[] {
  const calls: string[] = [];
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    return Promise.resolve(handler(url));
  }) as unknown as typeof fetch;
  return calls;
}

describe("authorization server document relay", () => {
  test("stays dark until an authorization server is configured", async () => {
    delete process.env.SURF_OAUTH_AUTHORIZATION_SERVER;
    const calls = stubFetch(() => new Response("{}"));
    const { res, out } = recordingResponse();

    await handleOpenIDConfigurationProxy({} as never, res);

    expect(out.status).toBe(404);
    expect(calls).toEqual([]);
  });

  test("relays the RFC 8414 document from the issuer", async () => {
    process.env.SURF_OAUTH_AUTHORIZATION_SERVER = "https://api.ask.surf/muninn/v2/oauth/";
    const upstreamBody = JSON.stringify({ issuer: "https://api.ask.surf/muninn/v2/oauth" });
    const calls = stubFetch(() => new Response(upstreamBody, { status: 200 }));
    const { res, out } = recordingResponse();

    await handleAuthorizationServerMetadataProxy({} as never, res);

    expect(calls).toEqual([
      "https://api.ask.surf/muninn/v2/oauth/.well-known/oauth-authorization-server",
    ]);
    expect(out.status).toBe(200);
    expect(out.headers?.["content-type"]).toBe("application/json");
    expect(out.body).toBe(upstreamBody);
  });

  test("relays the OpenID Connect discovery document from the issuer", async () => {
    process.env.SURF_OAUTH_AUTHORIZATION_SERVER = "https://api.ask.surf/muninn/v2/oauth";
    const upstreamBody = JSON.stringify({
      issuer: "https://api.ask.surf/muninn/v2/oauth",
      userinfo_endpoint: "https://api.ask.surf/muninn/v2/oauth/userinfo",
      scopes_supported: ["data:read", "openid", "email"],
    });
    const calls = stubFetch(() => new Response(upstreamBody, { status: 200 }));
    const { res, out } = recordingResponse();

    await handleOpenIDConfigurationProxy({} as never, res);

    expect(calls).toEqual([
      "https://api.ask.surf/muninn/v2/oauth/.well-known/openid-configuration",
    ]);
    expect(out.status).toBe(200);
    expect(JSON.parse(out.body).userinfo_endpoint).toBe(
      "https://api.ask.surf/muninn/v2/oauth/userinfo"
    );
  });

  test("answers 502 when the issuer does not serve the document", async () => {
    process.env.SURF_OAUTH_AUTHORIZATION_SERVER = "https://api.ask.surf/muninn/v2/oauth";
    stubFetch(() => new Response("not found", { status: 404 }));
    const { res, out } = recordingResponse();

    await handleOpenIDConfigurationProxy({} as never, res);

    expect(out.status).toBe(502);
  });

  test("answers 502 when the issuer is unreachable", async () => {
    process.env.SURF_OAUTH_AUTHORIZATION_SERVER = "https://api.ask.surf/muninn/v2/oauth";
    globalThis.fetch = (() =>
      Promise.reject(new Error("connect ECONNREFUSED"))) as unknown as typeof fetch;
    const { res, out } = recordingResponse();

    await handleOpenIDConfigurationProxy({} as never, res);

    expect(out.status).toBe(502);
  });
});
