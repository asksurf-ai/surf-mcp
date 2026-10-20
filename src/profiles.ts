/**
 * Which tools a hosted endpoint exposes, chosen by URL path.
 *
 * `/mcp` serves every tool the OpenAPI spec defines. `/mcp/chatgpt` serves the
 * ChatGPT plugin, which OpenAI only approves without content summarized or
 * aggregated from third-party publishers: no news feeds, news search, AI news
 * digests, or web search/fetch.
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
}

export const PROFILES: Record<ProfileName, Profile> = {
  default: {
    instructions:
      "Use Surf for crypto market, exchange, wallet, token, social, project, on-chain, prediction-market, fund, news, and web data. Resolve token symbols to contract addresses before calling address-based token tools.",
  },
  chatgpt: {
    instructions:
      "Use Surf for crypto market, exchange, wallet, token, social, project, on-chain, prediction-market, equity, and fund data. Resolve token symbols to contract addresses before calling address-based token tools.",
    allowedCommands: {
      surf_market: [
        "price",
        "ranking",
        "listing",
        "etf",
        "futures",
        "options",
        "fear-greed",
        "liquidation-chart",
        "liquidation-order",
        "liquidation-exchange-list",
        "exchange-flow-exchanges",
        "onchain-indicator",
        "price-indicator",
        "public-sale",
        "tge",
      ],
      surf_exchange: [
        "price",
        "depth",
        "klines",
        "candles",
        "markets",
        "coverage",
        "perp",
        "funding-history",
        "long-short-ratio",
      ],
      surf_hyperliquid: [
        "leaderboard",
        "account",
        "positions",
        "orders",
        "fills",
        "trades",
        "trades-aggregate",
        "trade-context",
        "candles",
        "performance",
      ],
      surf_prediction_market: [
        "polymarket-markets",
        "polymarket-prices",
        "polymarket-trades",
        "polymarket-positions",
        "polymarket-orderbooks",
        "polymarket-leaderboard",
        "polymarket-smart-money",
        "polymarket-volumes",
        "polymarket-open-interest",
        "polymarket-events",
        "polymarket-price-ohlcv",
        "polymarket-volume-split",
        "kalshi-markets",
        "kalshi-prices",
        "kalshi-trades",
        "kalshi-orderbooks",
        "kalshi-volumes",
        "kalshi-open-interest",
        "kalshi-events",
        "analytics",
        "correlations",
        "matching-market-pairs",
        "matching-market-daily",
      ],
      surf_equity: [
        "overview",
        "meta",
        "company-profile",
        "candles",
        "financial-metrics",
        "income-statement",
        "balance-sheet",
        "cash-flow",
        "latest-financials",
        "filings",
        "latest-filings",
        "listings",
        "etf-holdings",
        "segments",
      ],
      surf_onchain: [
        "sql",
        "sql-preflight",
        "sql-job-create",
        "sql-job-get",
        "sql-job-results",
        "structured-query",
        "schema",
        "tx",
        "gas-price",
        "dex-activity",
        "bridge-ranking",
        "yield-ranking",
      ],
      surf_wallet: ["detail", "net-worth", "transfers", "history", "protocols", "labels-batch"],
      surf_token: [
        "holders",
        "dex-trades",
        "transfers",
        "transfer-stats",
        "transfer-counterparties",
        "tokenomics",
      ],
      // Not news or web; not events, which mixes in news-sourced items; not
      // fundraising, whose events are consolidated from news articles with
      // publisher names, source URLs, and summaries.
      surf_search: [
        "project",
        "token",
        "wallet",
        "fund",
        "airdrop",
        "airdrop-activities",
        "prediction-market",
      ],
      // Not ai-news or its deprecated alias pulse: AI digests of news articles.
      surf_project: ["detail", "defi-metrics", "defi-ranking"],
      surf_signal: ["detail", "projects", "token-of-the-day", "token-of-week"],
      surf_fund: ["detail", "portfolio", "ranking"],
      surf_dex: ["token-price"],
      surf_portfolio: ["wallets"],
      surf_x: ["tweets"],
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
