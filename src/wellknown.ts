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

  return {
    resource: process.env.SURF_MCP_RESOURCE_URL ?? "https://mcp.asksurf.ai",
    authorization_servers: [authorizationServer],
    bearer_methods_supported: ["header"],
    resource_name: "Surf MCP",
    resource_documentation: "https://github.com/asksurf-ai/surf-mcp",
  };
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
