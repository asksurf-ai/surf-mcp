import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadSpec } from "./spec";
import { registerTools } from "./tools";
import packageJson from "../package.json";

const PACKAGE_VERSION = packageJson.version;

function printHelp() {
  console.log(`surf-mcp ${PACKAGE_VERSION}

MCP server for Surf crypto data API.

Usage:
  surf-mcp [options]

Options:
  -h, --help       Show this help message
  -v, --version    Show package version`);
}

function handleCliMetadataFlags(args: string[]) {
  if (args.includes("--version") || args.includes("-v")) {
    console.log(PACKAGE_VERSION);
    return true;
  }

  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return true;
  }

  return false;
}

async function main() {
  if (handleCliMetadataFlags(process.argv.slice(2))) {
    return;
  }

  if (!process.env.SURF_API_KEY) {
    console.error("[surf-mcp] SURF_API_KEY environment variable is required");
    process.exit(1);
  }

  const spec = await loadSpec();
  console.error(`[surf-mcp] Loaded spec v${spec.info.version}`);

  const server = new McpServer({
    name: "surf-mcp",
    version: PACKAGE_VERSION,
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
