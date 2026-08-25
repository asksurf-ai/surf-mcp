/**
 * Turns Surf data API failures into instructions an agent can act on.
 *
 * The default rendering of an upstream error ("Surf API 402: insufficient
 * credit") tells the person nothing about what to do next, and quota and
 * credential problems are exactly the moments where they need a next step.
 * These messages name the fix and where to perform it.
 */

export const CONSOLE_URL = "https://agents.asksurf.ai";

const CONNECT_KEY_HINT =
  `create one at ${CONSOLE_URL} (API keys → New API key) and connect it as the ` +
  `\`Authorization: Bearer <key>\` header`;

export interface ApiErrorContext {
  status: number;
  /** Surf error code, e.g. PAID_BALANCE_ZERO. Absent on non-JSON responses. */
  code?: string;
  /** Message from the API, or the raw body when it was not JSON. */
  message: string;
  /** Whether the request carried any credential. */
  authenticated: boolean;
}

export function explainDataApiError(ctx: ApiErrorContext): string {
  const { status, code, message, authenticated } = ctx;

  // Anonymous callers get a small daily allowance per IP; running it out is
  // the most common first wall a new user hits.
  if (code === "FREE_QUOTA_EXHAUSTED") {
    return (
      "Surf's anonymous daily allowance for this IP is used up. " +
      `To keep going, ${CONNECT_KEY_HINT}, which draws on your own account's credits.`
    );
  }

  if (code === "PAID_BALANCE_ZERO" || code === "INSUFFICIENT_CREDIT") {
    return (
      "This Surf account has no credits left. " +
      `Add credits at ${CONSOLE_URL} (Billing), then retry.`
    );
  }

  if (status === 402) {
    return (
      `Surf declined the request for billing reasons: ${message}. ` +
      `Check the account balance at ${CONSOLE_URL} (Billing).`
    );
  }

  if (status === 401 || status === 403) {
    if (authenticated) {
      return (
        `Surf rejected the credential in use: ${message}. ` +
        `It may be revoked, expired, or lack access to this endpoint — ` +
        `review it at ${CONSOLE_URL} (API keys).`
      );
    }
    return (
      "This Surf endpoint needs a credential and the request was anonymous. " +
      `To call it, ${CONNECT_KEY_HINT}.`
    );
  }

  if (status === 429) {
    if (!authenticated) {
      return (
        "Surf is rate limiting this IP. Anonymous requests share a low limit — " +
        `${CONNECT_KEY_HINT} for a higher one, or retry in a moment.`
      );
    }
    return `Surf is rate limiting this account: ${message}. Retry in a moment.`;
  }

  return `Surf API ${status}: ${message}`;
}
