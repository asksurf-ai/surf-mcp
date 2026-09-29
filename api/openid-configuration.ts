import type { IncomingMessage, ServerResponse } from "node:http";
import { handleOpenIDConfigurationProxy } from "../src/wellknown.js";

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  await handleOpenIDConfigurationProxy(req, res);
}
