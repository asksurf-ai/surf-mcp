import type { IncomingMessage, ServerResponse } from "node:http";
import { handleAuthorizationServerMetadataProxy } from "../src/wellknown.js";

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  await handleAuthorizationServerMetadataProxy(req, res);
}
