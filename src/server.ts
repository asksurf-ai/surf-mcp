import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestAuth } from "./auth.js";
import { PROFILES, type ProfileName } from "./profiles.js";
import type { OpenAPISpec } from "./spec.js";
import { registerTools } from "./tools.js";

export const SERVER_VERSION = "0.2.0";

export function createSurfServer(
  spec: OpenAPISpec,
  auth?: RequestAuth,
  profileName: ProfileName = "default"
): McpServer {
  const profile = PROFILES[profileName];
  const server = new McpServer(
    {
      name: "surf-mcp",
      version: SERVER_VERSION,
    },
    { instructions: profile.instructions }
  );

  registerTools(server, spec, auth, profile);
  return server;
}
