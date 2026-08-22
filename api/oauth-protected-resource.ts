import type { IncomingMessage, ServerResponse } from "node:http";
import { handleProtectedResourceRequest } from "../src/wellknown.js";

export default function handler(
  req: IncomingMessage,
  res: ServerResponse
): void {
  handleProtectedResourceRequest(req, res);
}
