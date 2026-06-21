import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadSpec } from "./spec";
import { registerTools } from "./tools";

async function main() {
  const apiKey = (process.env.SURF_API_KEY ?? "").trim();
  if (!apiKey) {
    console.error(
      "[surf-mcp] SURF_API_KEY environment variable is required but is missing or empty." +
      " Set it to your Surf API key before starting the MCP server." +
      " See https://surf.surf/docs for how to obtain a key."
    );
    process.exit(1);
  }

  const spec = await loadSpec();
  console.error(`[surf-mcp] Loaded spec v${spec.info.version}`);

  const server = new McpServer({
    name: "surf-mcp",
    version: "0.1.0",
  });

  registerTools(server, spec);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[surf-mcp] Server running on stdio");
}

main().catch((err) => {
  console.error("[surf-mcp] Fatal:", err);
  process.exit(1);
});
