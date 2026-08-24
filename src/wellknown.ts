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
  resource_name: string;
  resource_documentation: string;
}

export function buildProtectedResourceMetadata(): ProtectedResourceMetadata | null {
  const authorizationServer = process.env.SURF_OAUTH_AUTHORIZATION_SERVER;
  if (!authorizationServer) return null;

  const resource = process.env.SURF_MCP_RESOURCE_URL ?? "https://mcp.asksurf.ai";
  return {
    resource,
    // We advertise ourselves and relay the authorization-server document
    // (see handleAuthorizationServerMetadataProxy): the gateway ingress does
    // not forward root /.well-known/* to the authorization server, and the
    // MCP SDK's discovery candidates for a path-bearing issuer never include
    // the OAuth-named path-append variant the server actually exposes.
    authorization_servers: [resource],
    bearer_methods_supported: ["header"],
    resource_name: "Surf MCP",
    resource_documentation: "https://github.com/asksurf-ai/surf-mcp",
  };
}

/**
 * Relays the authorization server's RFC 8414 document from this origin so
 * SDK discovery ("<origin>/.well-known/oauth-authorization-server") succeeds
 * without gateway ingress changes. Endpoint URLs inside the document remain
 * the authorization server's own absolute URLs.
 */
export async function handleAuthorizationServerMetadataProxy(
  _req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const authorizationServer = process.env.SURF_OAUTH_AUTHORIZATION_SERVER;
  if (!authorizationServer) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
    return;
  }

  const upstream = `${authorizationServer.replace(/\/+$/, "")}/.well-known/oauth-authorization-server`;
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
