import { afterEach, describe, expect, test } from "bun:test";
import { resolveAuthorization } from "./auth.js";
import { buildProtectedResourceMetadata } from "./wellknown.js";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("resolveAuthorization", () => {
  test("forwards the incoming Authorization header verbatim", () => {
    process.env.SURF_API_KEY = "service-key";
    expect(resolveAuthorization("Bearer sk-surf-user")).toBe(
      "Bearer sk-surf-user"
    );
  });

  test("falls back to SURF_API_KEY when no header is sent", () => {
    process.env.SURF_API_KEY = "service-key";
    expect(resolveAuthorization(undefined)).toBe("Bearer service-key");
  });

  test("treats a blank header as absent", () => {
    process.env.SURF_API_KEY = "service-key";
    expect(resolveAuthorization("   ")).toBe("Bearer service-key");
  });

  test("returns undefined (anonymous) without header or env key", () => {
    delete process.env.SURF_API_KEY;
    expect(resolveAuthorization(undefined)).toBeUndefined();
  });
});

describe("buildProtectedResourceMetadata", () => {
  test("returns null until an authorization server is configured", () => {
    delete process.env.SURF_OAUTH_AUTHORIZATION_SERVER;
    expect(buildProtectedResourceMetadata()).toBeNull();
  });

  test("builds RFC 9728 metadata from environment", () => {
    process.env.SURF_OAUTH_AUTHORIZATION_SERVER = "https://api.ask.surf";
    process.env.SURF_MCP_RESOURCE_URL = "https://mcp.example.com";

    expect(buildProtectedResourceMetadata()).toEqual({
      resource: "https://mcp.example.com",
      authorization_servers: ["https://api.ask.surf"],
      bearer_methods_supported: ["header"],
      resource_name: "Surf MCP",
      resource_documentation: "https://github.com/asksurf-ai/surf-mcp",
    });
  });

  test("defaults the resource URL to the hosted endpoint", () => {
    process.env.SURF_OAUTH_AUTHORIZATION_SERVER = "https://api.ask.surf";
    delete process.env.SURF_MCP_RESOURCE_URL;

    expect(buildProtectedResourceMetadata()?.resource).toBe(
      "https://mcp.asksurf.ai"
    );
  });
});
