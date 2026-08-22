import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createSurfServer } from "./server.js";
import { loadSpec } from "./spec.js";

let specPromise: ReturnType<typeof loadSpec> | undefined;

function getSpec() {
  specPromise ??= loadSpec();
  return specPromise;
}

export async function handleMcpHttpRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const spec = await getSpec();
  // Forward the caller's own credentials so usage and billing attach to the
  // caller's Surf account; resolveAuthorization falls back to the service key.
  const server = createSurfServer(spec, {
    authorization: req.headers.authorization,
  });
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
