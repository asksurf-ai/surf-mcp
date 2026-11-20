import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildAuthChallenge, oauthDiscoverable } from "./auth.js";
import { PROFILES, type ProfileName } from "./profiles.js";
import { createSurfServer } from "./server.js";
import { loadSpec } from "./spec.js";

let specPromise: ReturnType<typeof loadSpec> | undefined;

function getSpec() {
  specPromise ??= loadSpec();
  return specPromise;
}

export async function handleMcpHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  profile: ProfileName = "default"
): Promise<void> {
  // Auth-required deployments challenge credential-less requests so MCP
  // clients launch the OAuth login on the user's device (see buildAuthChallenge).
  const profileRequiresAuth = Boolean(PROFILES[profile].oauthOnly) && oauthDiscoverable();
  const challenge = buildAuthChallenge(req.headers.authorization, profileRequiresAuth);
  if (challenge) {
    res.writeHead(401, {
      "content-type": "application/json",
      "www-authenticate": challenge,
    });
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: -32001,
          message:
            profileRequiresAuth
              ? "Authentication required: complete the OAuth flow advertised in WWW-Authenticate."
              : "Authentication required: complete the OAuth flow advertised in WWW-Authenticate, or supply a Surf API key as a Bearer token.",
        },
        id: null,
      })
    );
    return;
  }

  // This deployment is stateless: it registers no server-initiated messages, so
  // there is no stream a client could subscribe to. A GET here used to open a
  // silent text/event-stream that never emitted and never closed; MCP clients
  // (including the ChatGPT plugin scanner) wait on it until they time out and
  // abandon the scan. The spec's answer for "no stream at this endpoint" is 405,
  // which tells the client to talk to the endpoint with POST only.
  if (req.method !== "POST") {
    res.writeHead(405, {
      allow: "POST",
      "content-type": "application/json",
    });
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Method Not Allowed: this MCP endpoint accepts POST requests only.",
        },
        id: null,
      })
    );
    return;
  }

  const spec = await getSpec();
  // Forward the caller's own credentials so usage and billing attach to the
  // caller's Surf account; resolveAuthorization falls back to the service key.
  const server = createSurfServer(
    spec,
    { authorization: req.headers.authorization },
    profile
  );
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    // Vercel parses JSON request bodies before invoking the function. Passing
    // the parsed body keeps the MCP transport from waiting on an already
    // consumed request stream; local Node requests leave this undefined.
    const parsedBody = (req as IncomingMessage & { body?: unknown }).body;
    await transport.handleRequest(req, res, parsedBody);
  } catch (err) {
    console.error("[surf-mcp] HTTP request failed:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        })
      );
    }
  }
}
