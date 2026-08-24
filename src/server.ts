import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestAuth } from "./auth.js";
import type { OpenAPISpec } from "./spec.js";
import { registerTools } from "./tools.js";

export const SERVER_VERSION = "0.2.0";

export function createSurfServer(spec: OpenAPISpec, auth?: RequestAuth): McpServer {
  const server = new McpServer(
    {
      name: "surf-mcp",
      version: SERVER_VERSION,
    },
    {
      instructions:
        "Use Surf for crypto market, exchange, wallet, token, social, project, on-chain, prediction-market, fund, news, and web data. Resolve token symbols to contract addresses before calling address-based token tools.",
    }
  );

  registerTools(server, spec, auth);
  return server;
}
