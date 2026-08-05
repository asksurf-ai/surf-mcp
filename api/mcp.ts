import type { IncomingMessage, ServerResponse } from "node:http";
import { handleMcpHttpRequest } from "../src/http.js";

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  await handleMcpHttpRequest(req, res);
}
