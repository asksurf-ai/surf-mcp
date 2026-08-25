import { describe, expect, test } from "bun:test";
import { CONSOLE_URL, explainDataApiError } from "./errors.js";

describe("explainDataApiError", () => {
  test("anonymous quota exhaustion points at connecting a key", () => {
    const msg = explainDataApiError({
      status: 402,
      code: "FREE_QUOTA_EXHAUSTED",
      message: "insufficient credit",
      authenticated: false,
    });
    expect(msg).toContain("anonymous daily allowance");
    expect(msg).toContain(CONSOLE_URL);
    expect(msg).toContain("Authorization: Bearer");
  });

  test("empty balance points at Billing, not at a key", () => {
    const msg = explainDataApiError({
      status: 402,
      code: "PAID_BALANCE_ZERO",
      message: "insufficient credit",
      authenticated: true,
    });
    expect(msg).toContain("no credits left");
    expect(msg).toContain("Billing");
    expect(msg).not.toContain("New API key");
  });

  test("legacy insufficient-credit code is handled like an empty balance", () => {
    const msg = explainDataApiError({
      status: 402,
      code: "INSUFFICIENT_CREDIT",
      message: "insufficient credit",
      authenticated: true,
    });
    expect(msg).toContain("Billing");
  });

  test("401 while anonymous explains how to authenticate", () => {
    const msg = explainDataApiError({
      status: 401,
      code: "UNAUTHORIZED",
      message: "missing authorization header",
      authenticated: false,
    });
    expect(msg).toContain("needs a credential");
    expect(msg).toContain(CONSOLE_URL);
  });

  test("401 with a credential says the credential itself was rejected", () => {
    const msg = explainDataApiError({
      status: 401,
      code: "UNAUTHORIZED",
      message: "invalid token",
      authenticated: true,
    });
    expect(msg).toContain("rejected the credential");
    expect(msg).toContain("revoked");
  });

  test("anonymous rate limiting suggests a key, authenticated does not", () => {
    const anon = explainDataApiError({
      status: 429,
      code: "RATE_LIMITED",
      message: "rate limit exceeded",
      authenticated: false,
    });
    expect(anon).toContain("share a low limit");
    expect(anon).toContain(CONSOLE_URL);

    const authed = explainDataApiError({
      status: 429,
      code: "RATE_LIMITED",
      message: "rate limit exceeded",
      authenticated: true,
    });
    expect(authed).toContain("Retry in a moment");
    expect(authed).not.toContain(CONSOLE_URL);
  });

  test("unrecognized failures keep the original status and message", () => {
    const msg = explainDataApiError({
      status: 502,
      code: "UPSTREAM_ERROR",
      message: "upstream request failed",
      authenticated: true,
    });
    expect(msg).toBe("Surf API 502: upstream request failed");
  });

  test("non-JSON bodies still produce a usable message", () => {
    const msg = explainDataApiError({
      status: 500,
      message: "<html>500</html>",
      authenticated: false,
    });
    expect(msg).toBe("Surf API 500: <html>500</html>");
  });
});
