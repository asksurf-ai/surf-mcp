/**
 * Which tools a hosted endpoint exposes, chosen by URL path.
 *
 * `/mcp` serves every tool the OpenAPI spec defines. `/mcp/chatgpt` serves the
 * ChatGPT plugin, which OpenAI only approves without content summarized or
 * aggregated from third-party publishers: no news feeds, news search, AI news
 * digests, or web search/fetch. Signal cards (AI summaries) and X posts are
 * left out as well.
 *
 * The ChatGPT profile is an allowlist, not a denylist: an endpoint added to
 * the spec later stays out of ChatGPT until it is reviewed and listed here,
 * so a new news-like endpoint cannot slip into the approved plugin.
 */
export type ProfileName = "default" | "chatgpt";

export interface Profile {
  /** Tool name → commands the profile exposes. Omitted: expose everything. */
  allowedCommands?: Readonly<Record<string, readonly string[]>>;
  instructions: string;
  /**
   * ChatGPT's mixed auth: tools run anonymously, and a call that needs a
   * signed-in account asks the host to link one (see signInRemedy). Only
   * takes effect while the deployment advertises OAuth.
   */
  mixedAuth?: boolean;
  /**
   * Register each allowed operation as its own tool (surf_market_price)
   * instead of one tool per tag with a command enum. OpenAI plugin review
   * rejects tools that dispatch to operations not individually exposed.
   */
  perOperationTools?: boolean;
}

export const PROFILES: Record<ProfileName, Profile> = {
  default: {
    instructions:
      "Use Surf for crypto market, exchange, wallet, token, social, project, on-chain, prediction-market, fund, news, and web data. Resolve token symbols to contract addresses before calling address-based token tools.",
  },
  chatgpt: {
    instructions:
      "Use Surf for crypto market, exchange, wallet, token, project, on-chain, prediction-market, equity, and fund data. Resolve token symbols to contract addresses before calling address-based token tools.",
    mixedAuth: true,
    perOperationTools: true,
    // A curated core set: each command becomes its own tool, and every tool
    // is listed, annotated, and justified in the OpenAI review. Read-only
    // throughout (no sql-job-create, which enqueues server-side work).
    allowedCommands: {
      surf_market: ["price", "ranking", "fear-greed", "futures", "etf"],
      surf_exchange: ["price", "klines", "funding-history", "long-short-ratio"],
      surf_hyperliquid: ["leaderboard", "positions"],
      surf_prediction_market: [
        "polymarket-markets",
        "polymarket-prices",
        "kalshi-markets",
        "kalshi-prices",
      ],
      surf_equity: ["overview", "candles"],
      surf_onchain: ["sql", "schema", "tx", "gas-price"],
      surf_wallet: ["detail", "net-worth", "transfers"],
      surf_token: ["holders", "tokenomics"],
      // Not news, web, events, or fundraising: third-party news content.
      surf_search: ["project", "token", "prediction-market"],
      // Not ai-news or its deprecated alias pulse: AI digests of news articles.
      surf_project: ["detail", "defi-ranking"],
      surf_fund: ["detail"],
      surf_dex: ["token-price"],
    },
  },
};

const PATH_PROFILES: Record<string, ProfileName> = {
  "/mcp": "default",
  "/api/mcp": "default",
  "/mcp/chatgpt": "chatgpt",
  "/api/mcp/chatgpt": "chatgpt",
};

/** The profile a hosted MCP path serves, or undefined if it is not an MCP path. */
export function profileForPath(pathname: string): ProfileName | undefined {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return PATH_PROFILES[normalized];
}
