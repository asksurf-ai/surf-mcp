/**
 * Per-request credential resolution for calls to the Surf data API.
 *
 * Hosted (Streamable HTTP) deployments forward the caller's own
 * `Authorization` header so usage and billing attach to the caller's Surf
 * account. When the caller sends no credentials, the process-level
 * SURF_API_KEY (the deployment's service key) applies, and without either
 * the request reaches the API anonymously under its per-IP allowance.
 */
export interface RequestAuth {
  /** Verbatim `Authorization` header from the incoming request, if any. */
  authorization?: string;
}

export function resolveAuthorization(incoming?: string): string | undefined {
  const trimmed = incoming?.trim();
  if (trimmed) return trimmed;

  const apiKey = process.env.SURF_API_KEY;
  return apiKey ? `Bearer ${apiKey}` : undefined;
}

function authRequired(): boolean {
  const v = process.env.SURF_MCP_REQUIRE_AUTH?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * The login trigger for MCP clients: when the deployment requires auth and a
 * request arrives without credentials, /mcp answers 401 with this
 * WWW-Authenticate value. Compliant clients follow the referenced resource
 * metadata to the authorization server and open the OAuth login in the
 * user's browser, so subsequent calls bill the signed-in account.
 *
 * Returns the header value to challenge with, or null when the request may
 * proceed (auth not required, or credentials present — the data API is the
 * actual validator).
 *
 * Deployment modes:
 * - neither env set (default): anonymous allowance + API key passthrough
 * - SURF_OAUTH_AUTHORIZATION_SERVER only: OAuth discoverable, not enforced
 * - both set: credential-less requests are challenged into the OAuth flow
 */
export function buildAuthChallenge(incoming?: string): string | null {
  if (!authRequired()) return null;
  if (incoming?.trim()) return null;
  return `Bearer resource_metadata="${resourceMetadataUrl()}"`;
}

function resourceMetadataUrl(): string {
  const resource = process.env.SURF_MCP_RESOURCE_URL ?? "https://mcp.asksurf.ai";
  return `${resource}/.well-known/oauth-protected-resource`;
}

/**
 * Whether this deployment advertises an OAuth authorization server, i.e.
 * whether /.well-known/oauth-protected-resource is live (see wellknown.ts).
 */
export function oauthDiscoverable(): boolean {
  return Boolean(process.env.SURF_OAUTH_AUTHORIZATION_SERVER?.trim());
}

export type SignInError = "insufficient_scope" | "invalid_token";

/**
 * The WWW-Authenticate value a tool result carries in
 * _meta["mcp/www_authenticate"] to make ChatGPT open its account-linking UI
 * for that tool. ChatGPT requires both `error` and `error_description`.
 */
export function buildSignInChallenge(error: SignInError, description: string): string {
  return (
    `Bearer resource_metadata="${resourceMetadataUrl()}", ` +
    `error="${error}", error_description="${description}"`
  );
}
