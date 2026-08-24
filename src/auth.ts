/**
 * Per-request credential resolution for calls to the Surf data API.
 *
 * Hosted (Streamable HTTP) deployments forward the caller's own
 * `Authorization` header so usage and billing attach to the caller's Surf
 * account. When the caller sends no credentials, the process-level
 * SURF_API_KEY (the deployment's service key) applies, and without either
 * the request reaches the API anonymously under its per-IP allowance.
 */
export interface RequestAuth {
  /** Verbatim `Authorization` header from the incoming request, if any. */
  authorization?: string;
}

export function resolveAuthorization(incoming?: string): string | undefined {
  const trimmed = incoming?.trim();
  if (trimmed) return trimmed;

  const apiKey = process.env.SURF_API_KEY;
  return apiKey ? `Bearer ${apiKey}` : undefined;
}
