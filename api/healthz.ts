import type { IncomingMessage, ServerResponse } from "node:http";
import { SERVER_VERSION } from "../src/server.js";

export default function handler(_req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ status: "ok", service: "surf-mcp", version: SERVER_VERSION }));
}
