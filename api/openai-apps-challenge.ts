import type { IncomingMessage, ServerResponse } from "node:http";

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== "GET") {
    res.writeHead(405, {
      allow: "GET",
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    });
    res.end("Method Not Allowed");
    return;
  }

  const token = process.env.OPENAI_APPS_CHALLENGE?.trim();
  if (!token) {
    res.writeHead(404, {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    });
    res.end("Not Found");
    return;
  }

  res.writeHead(200, {
    "cache-control": "no-store",
    "content-type": "text/plain; charset=utf-8",
  });
  res.end(token);
}
