# surf-mcp

MCP server for the [Surf](https://ask.surf) crypto data API. Dynamically generates tools from the OpenAPI spec across market data, wallets, social, on-chain queries, and more. It supports stdio for local clients and Streamable HTTP for hosted ChatGPT/Codex integrations.

## Quick start

Add to your MCP client config — no clone or install needed:

```json
{
  "mcpServers": {
    "surf": {
      "type": "http",
      "url": "https://mcp.asksurf.ai/mcp"
    }
  }
}
```

To run the stdio package locally instead:

```json
{
  "mcpServers": {
    "surf": {
      "command": "npx",
      "args": ["-y", "@surf-ai/surf-mcp"],
      "env": {
        "SURF_API_KEY": "your-api-key"
      }
    }
  }
}
```

### Prerequisites

- Node.js 20+ or [Bun](https://bun.sh)
- Optional: a Surf API key ([get one here](https://ask.surf)) for account credits and higher limits. Without a key, Surf's anonymous per-IP allowance applies.

### Config file locations

- **Claude Code**: `.mcp.json` in project root or `~/.claude.json`
- **Claude Desktop**: `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
- **Cursor**: MCP settings in the IDE

## Claude Code plugin

This repository is also a Claude Code marketplace. Install the Surf plugin with:

```bash
claude plugin marketplace add asksurf-ai/surf-mcp
claude plugin install surf@surf
```

The plugin connects to the hosted anonymous beta. Usage is limited by Surf's anonymous allowance; production deployments should use a dedicated, rate-limited service key or OAuth 2.1.

## ChatGPT and Codex plugin

The repository contains a Codex/ChatGPT plugin package under [`plugins/surf`](plugins/surf), a Claude package under [`claude-plugin`](claude-plugin), and repo marketplaces for both hosts. The two thin package directories are separate because the current hosts validate different `.mcp.json` root shapes; both connect to the hosted MCP endpoint. Codex can add its marketplace directly:

```bash
codex plugin marketplace add asksurf-ai/surf-mcp
```

Register `https://mcp.asksurf.ai/mcp` in [ChatGPT Plugins](https://chatgpt.com/plugins). See [`docs/chatgpt-plugin-submission.md`](docs/chatgpt-plugin-submission.md) for the submission checklist.

## Streamable HTTP deployment

Run the hosted transport locally:

```bash
bun run start:http
```

The server exposes:

- `POST /mcp` — stateless MCP Streamable HTTP endpoint
- `GET /healthz` — deployment health check
- `GET /.well-known/oauth-protected-resource` — OAuth resource metadata (RFC 9728); returns 404 until `SURF_OAUTH_AUTHORIZATION_SERVER` is configured

### Authentication

Each HTTP request's `Authorization` header is forwarded verbatim to the Surf data API, so callers presenting their own Surf API key (or a Surf-issued OAuth token, once available) are billed and rate-limited on their own account. Resolution order per request:

1. The incoming `Authorization` header, forwarded as-is
2. The deployment's `SURF_API_KEY` service key (`Bearer` scheme)
3. Anonymous — the Surf API's per-IP allowance applies

Environment variables for the OAuth discovery endpoint:

| Variable | Purpose |
|----------|---------|
| `SURF_OAUTH_AUTHORIZATION_SERVER` | Base URL of the Surf OAuth authorization server. Unset (default) keeps the metadata endpoint dark. |
| `SURF_MCP_RESOURCE_URL` | Public URL of this MCP deployment (default `https://mcp.asksurf.ai`). |

Build and run the included container:

```bash
docker build -t surf-mcp .
docker run --rm -p 3000:3000 -e SURF_API_KEY=your-service-api-key surf-mcp
```

The limited beta is live at `https://mcp.asksurf.ai/mcp`. For higher capacity, keep a dedicated, rate-limited `SURF_API_KEY` in the host's secret manager; never put it in plugin manifests or client-visible responses.

The included Vercel Functions adapter exposes the same endpoints from `api/mcp.ts` and `api/healthz.ts`. Deploy it to a Vercel project when a serverless beta is preferable to the container image.

## Tools

The server currently exposes 15 tools, one per API domain. Each tool accepts a `command` and optional `params`; the exact commands update automatically with the Surf OpenAPI specification:

| Tool | Commands | Description |
|------|----------|-------------|
| `surf_dex` | `token-price` | DEX-pool-weighted token OHLCV data |
| `surf_market` | `price`, `ranking`, `etf`, `futures`, `options`, `fear-greed`, `liquidation-*`, `onchain-indicator`, `price-indicator` | Market overview, rankings, indicators, ETF flows |
| `surf_exchange` | `depth`, `klines`, `funding-history`, `perp`, `price`, `markets`, `long-short-ratio` | Live exchange data from Binance, OKX, Bybit, etc. |
| `surf_hyperliquid` | `leaderboard`, `positions`, `orders`, `fills`, `trades`, `performance` | Hyperliquid trader, position, order, fill, and P&L data |
| `surf_wallet` | `detail`, `transfers`, `history`, `net-worth`, `protocols`, `labels-batch` | Wallet balances, transfers, DeFi positions |
| `surf_token` | `holders`, `dex-trades`, `transfers`, `tokenomics` | Token holder analysis, DEX trades, unlocks |
| `surf_x` | `tweets` | X post and author details by post ID |
| `surf_project` | `detail`, `defi-metrics`, `defi-ranking` | Project profiles, DeFi TVL/fees/revenue |
| `surf_signal` | `detail`, `projects`, `token-of-the-day`, `token-of-week` | Project signal scores and ranked highlights |
| `surf_onchain` | `sql`, `tx`, `gas-price`, `schema`, `bridge-ranking`, `yield-ranking`, `structured-query` | On-chain SQL queries, tx lookup, gas prices |
| `surf_search` | `project`, `wallet`, `news`, `web`, `fund`, `polymarket`, `kalshi`, `airdrop`, `events`, `social-people`, `social-posts` | Unified search across all data types |
| `surf_prediction_market` | `kalshi-*`, `polymarket-*`, `matching-*`, `category-metrics` | Polymarket and Kalshi prediction markets |
| `surf_fund` | `detail`, `portfolio`, `ranking` | Crypto VC fund profiles and portfolios |
| `surf_news` | `feed`, `detail` | Crypto news from major outlets |
| `surf_web` | `fetch` | Fetch any URL as clean markdown |

## Usage examples

Once configured, your AI assistant can use the tools directly:

```
"What's the BTC price?"        → surf_market({ command: "price", params: { symbol: "BTC" } })
"Check vitalik's wallet"       → surf_wallet({ command: "detail", params: { address: "vitalik.eth" } })
"Search for DeFi projects"     → surf_search({ command: "project", params: { q: "defi lending" } })
"Run an on-chain SQL query"    → surf_onchain({ command: "sql", params: { sql: "SELECT ..." } })
"Surf's token of the day"      → surf_signal({ command: "token-of-the-day" })
```

## How it works

On startup, the server:

1. Fetches the OpenAPI spec from `https://api.asksurf.ai/gateway/openapi.json` (cached for 24h)
2. Groups all operations by their API tag
3. Registers one MCP tool per tag with auto-generated descriptions and command enums
4. Routes tool calls to the Surf API with native HTTP fetch and optional bearer authentication

The server automatically picks up new API endpoints when the spec is updated — just restart.

## Example: AI agent

The repo includes a simple agent that connects Claude to surf-mcp tools in an agentic loop. See [`examples/agent.ts`](examples/agent.ts).

```bash
ANTHROPIC_API_KEY=your-key SURF_API_KEY=your-key bun run examples/agent.ts "What's the BTC price and fear & greed index?"
```

## Development

```bash
git clone https://github.com/asksurf-ai/surf-mcp.git
cd surf-mcp
bun install
bun run start                # Run the server
bun run start:http           # Run Streamable HTTP on :3000
bun run typecheck            # Type check
```

## License

MIT
