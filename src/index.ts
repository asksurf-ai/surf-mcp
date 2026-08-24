import { createServer as createHttpServer } from "node:http";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { handleMcpHttpRequest } from "./http.js";
import { createSurfServer, SERVER_VERSION } from "./server.js";
import { loadSpec } from "./spec.js";
import {
  handleAuthorizationServerMetadataProxy,
  handleProtectedResourceRequest,
} from "./wellknown.js";

async function startStdio(): Promise<void> {
  const spec = await loadSpec();
  console.error(`[surf-mcp] Loaded spec v${spec.info.version}`);

  const server = createSurfServer(spec);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[surf-mcp] Server running on stdio");
}

async function startHttp(): Promise<void> {
  const host = process.env.HOST ?? "0.0.0.0";
  const port = Number.parseInt(process.env.PORT ?? "3000", 10);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${process.env.PORT}`);
  }

  const httpServer = createHttpServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && url.pathname === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", service: "surf-mcp", version: SERVER_VERSION }));
      return;
    }

    if (
      req.method === "GET" &&
      url.pathname === "/.well-known/oauth-protected-resource"
    ) {
      handleProtectedResourceRequest(req, res);
      return;
    }

    if (
      req.method === "GET" &&
      url.pathname === "/.well-known/oauth-authorization-server"
    ) {
      await handleAuthorizationServerMetadataProxy(req, res);
      return;
    }

    if (url.pathname !== "/mcp") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not_found" }));
      return;
    }

    await handleMcpHttpRequest(req, res);
  });

  httpServer.listen(port, host, () => {
    console.error(`[surf-mcp] Streamable HTTP server listening on http://${host}:${port}/mcp`);
  });
}

const useHttp =
  process.argv.includes("--http") || process.env.SURF_MCP_TRANSPORT === "http";

(useHttp ? startHttp() : startStdio()).catch((err) => {
  console.error("[surf-mcp] Fatal:", err);
  process.exit(1);
});
