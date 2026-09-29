import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728).
 *
 * MCP clients discover the authorization server through this document. The
 * endpoint stays dark (404) until SURF_OAUTH_AUTHORIZATION_SERVER is set, so
 * the deployment never advertises an authorization server that is not live.
 */
export interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  bearer_methods_supported: string[];
  scopes_supported: string[];
  resource_name: string;
  resource_documentation: string;
}

/**
 * Scopes the Surf authorization server grants. data:read is the base scope
 * of every grant; openid and email turn on OpenID Connect ID tokens and the
 * userinfo endpoint, which hosts such as ChatGPT need to learn the signed-in
 * account's verified email (workspace domain restrictions).
 */
export const SURF_OAUTH_SCOPES = ["data:read", "openid", "email"] as const;

export function buildProtectedResourceMetadata(): ProtectedResourceMetadata | null {
  const authorizationServer = process.env.SURF_OAUTH_AUTHORIZATION_SERVER;
  if (!authorizationServer) return null;

  const resource = process.env.SURF_MCP_RESOURCE_URL ?? "https://mcp.asksurf.ai";
  return {
    resource,
    // Advertise the real issuer. OpenID Connect clients (ChatGPT) fetch
    // <authorization_server>/.well-known/openid-configuration and compare the
    // document's issuer to that URL by exact string match, so advertising
    // ourselves and relaying the document made the OIDC layer look invalid.
    // The issuer serves both documents at the path-append well-known URLs,
    // which is the candidate the MCP SDK reaches once the gateway 404s the
    // root-inserted forms. The relayed copies below stay for clients that only
    // look at the MCP origin.
    authorization_servers: [authorizationServer.replace(/\/+$/, "")],
    bearer_methods_supported: ["header"],
    scopes_supported: [...SURF_OAUTH_SCOPES],
    resource_name: "Surf MCP",
    resource_documentation: "https://github.com/asksurf-ai/surf-mcp",
  };
}

/** The authorization-server documents this origin relays. */
export type AuthorizationServerDocument =
  | "oauth-authorization-server"
  | "openid-configuration";

/**
 * Relays one of the authorization server's well-known documents from this
 * origin so discovery ("<origin>/.well-known/<document>") succeeds without
 * gateway ingress changes. Endpoint URLs inside the document remain the
 * authorization server's own absolute URLs.
 */
export async function relayAuthorizationServerDocument(
  document: AuthorizationServerDocument,
  res: ServerResponse
): Promise<void> {
  const authorizationServer = process.env.SURF_OAUTH_AUTHORIZATION_SERVER;
  if (!authorizationServer) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
    return;
  }

  const upstream = `${authorizationServer.replace(/\/+$/, "")}/.well-known/${document}`;
  try {
    const response = await fetch(upstream);
    if (!response.ok) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "authorization server metadata unavailable" }));
      return;
    }
    const body = await response.text();
    res.writeHead(200, {
      "content-type": "application/json",
      "cache-control": "public, max-age=300",
    });
    res.end(body);
  } catch {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "authorization server metadata unavailable" }));
  }
}

/** RFC 8414 authorization server metadata, relayed from the issuer. */
export async function handleAuthorizationServerMetadataProxy(
  _req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  await relayAuthorizationServerDocument("oauth-authorization-server", res);
}

/**
 * OpenID Connect Discovery document, relayed from the issuer. Hosts that
 * support workspace domain restrictions (ChatGPT) look here for the
 * userinfo endpoint and the openid/email scopes.
 */
export async function handleOpenIDConfigurationProxy(
  _req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  await relayAuthorizationServerDocument("openid-configuration", res);
}

export function handleProtectedResourceRequest(
  _req: IncomingMessage,
  res: ServerResponse
): void {
  const metadata = buildProtectedResourceMetadata();

  if (!metadata) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
    return;
  }

  res.writeHead(200, {
    "content-type": "application/json",
    "cache-control": "public, max-age=3600",
  });
  res.end(JSON.stringify(metadata));
}
