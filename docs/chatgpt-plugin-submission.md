# ChatGPT and Codex plugin submission

Surf uses one public plugin listing shared by ChatGPT and Codex. The listing is backed by the hosted Surf MCP endpoint's ChatGPT profile; `plugins/surf` is the Codex local package and `claude-plugin` is the Claude Code package.

## 1. MCP endpoint

The anonymous beta is deployed at:

- MCP: `https://mcp.asksurf.ai/mcp/chatgpt`
- Health: `https://mcp.asksurf.ai/healthz`

Register `/mcp/chatgpt`, not `/mcp`. OpenAI rejected Surf v1.0.0 because the plugin summarized or aggregated news from third-party publishers. The ChatGPT profile (`src/profiles.ts`) is an allowlist that leaves those tools out: `surf_news`, `surf_web`, and the `news`, `web`, `events`, and `fundraising` commands of `surf_search` and the `ai-news` and `pulse` commands of `surf_project`. It also leaves out `surf_signal` (AI-written signal summaries) and `surf_x` (X posts and long-form articles). Endpoints added to the spec later stay out of this profile until they are reviewed and listed there. `/mcp` keeps serving every tool to other clients.

The endpoint has been verified with MCP protocol initialization, a 15-tool scan, and a live anonymous BTC price call. For production capacity, store a dedicated, rate-limited `SURF_API_KEY` in the deployment secret manager or add MCP-compliant OAuth 2.1.

The remote endpoint supports anonymous Surf API access or an optional server-side Surf key and exposes data-retrieval tools. ChatGPT does not support forwarding a custom API key supplied by each user. Before offering account-linked quotas or private Surf data, add MCP-compliant OAuth 2.1 and verify tokens on every request.

## 2. Test in ChatGPT developer mode

1. In ChatGPT, open **Settings → Security and login** and enable **Developer mode**.
2. Open [ChatGPT Plugins](https://chatgpt.com/plugins), select **+**, and register the production `/mcp/chatgpt` URL.
3. Choose mixed authentication (public plus OAuth). Every `/mcp/chatgpt` tool advertises `securitySchemes` `noauth` + `oauth2` (top level and `_meta.securitySchemes`). When a call needs an account — an anonymous call to a credential-gated endpoint, the anonymous allowance or rate limit running out, or an expired sign-in — the tool error carries `_meta["mcp/www_authenticate"]`, which makes ChatGPT open its account-linking UI. Both halves only turn on while `SURF_OAUTH_AUTHORIZATION_SERVER` is set (`src/tools.ts`, `signInRemedy` in `src/errors.ts`). Do not paste a Surf API key into plugin metadata.
4. Scan tools and confirm every Surf tool reports `openWorldHint: false` and `destructiveHint: false`. All tools report `readOnlyHint: true` except `surf_onchain`, which conservatively reports `false` because its `sql-job-create` command enqueues an asynchronous query job.
5. Test in a new conversation on both ChatGPT and Codex.

If a private workspace plugin package is needed after registration, copy the connection's technical ID and add a root `.app.json` mapping. Public directory submission does not use `.app.json`; submit the production MCP URL directly in the OpenAI portal.

## 3. Prepare the public listing

Build the upload ZIP from `plugins/surf`:

```sh
./scripts/build-openai-plugin.sh   # → dist/openai/surf-<version>.zip
```

The package declares the `/mcp/chatgpt` server in `plugins/surf/.mcp.json` with mixed authentication (public plus OAuth via dynamic client registration, scopes `data:read openid email`), and carries the listing, the review test cases, and the release notes in `plugins/surf/.codex-plugin/plugin.json` under `extensions.com.openai`, so they are imported with the ZIP. Bump `version` before each upload.

Open the [OpenAI plugin submission portal](https://platform.openai.com/plugins), select **Upload new or existing plugin**, and upload the ZIP. Then open **MCPs**, connect the server, and complete domain verification and the tool scan. The demo video URL and the reviewer credentials are not in the package: enter them in **Review information → Review details**.

Required before submission:

- Verified Surf business identity in the OpenAI organization.
- Apps Management write permission (`api.apps.write`) for the submitter.
- Public website, support, privacy-policy, and terms URLs.
- Square production logo (the repo includes `plugins/surf/assets/surf.svg`).
- Stable production MCP URL and domain-verification access.
- A dedicated reviewer/demo setup with no MFA or private-network dependency.
- Five positive and three negative test cases.
- Global availability countries/regions and release notes.

When prompted for domain verification, serve the exact OpenAI token as plain text at:

```text
https://mcp.asksurf.ai/.well-known/openai-apps-challenge
```

The included Vercel function serves this route from the
`OPENAI_APPS_CHALLENGE` environment variable. Add the exact portal token to the
production environment and redeploy; do not wrap it in JSON or add other text.

## 4. Suggested listing copy

- **Name:** Surf
- **Short description:** Live crypto and on-chain intelligence
- **Category:** Productivity
- **Long description:** Research crypto markets with live prices, exchange data, wallet and token activity, DeFi metrics, on-chain SQL, and prediction markets through Surf's data tools.
- **Release notes:** Initial Surf plugin submission with read-only crypto market, exchange, wallet, token, project, on-chain, prediction-market, equity, and fund research tools. News, web, signal, and X content tools are not included.

Starter prompts:

1. Which tokens are leading the market today?
2. Analyze this wallet's positions and recent activity.
3. Compare BTC and ETH market, exchange, and on-chain data.

## 5. Review test cases

The cases live in `plugins/surf/.codex-plugin/plugin.json` (`extensions.com.openai.review.test_cases`) and are read-only in the dashboard; edit the package and upload it again to change them.

Positive cases (all run anonymously against `/mcp/chatgpt`): BTC price (`surf_market`), BTC vs ETH funding rates (`surf_exchange`), DeFi TVL ranking (`surf_project`), Bitcoin prediction markets on Polymarket and Kalshi (`surf_search`, `surf_prediction_market`), and the Hyperliquid leaderboard (`surf_hyperliquid`). Wallet lookups are left out because they need a signed-in account.

Negative cases: buying BTC, posting to X, and asking for a wallet's private key. Surf is read-only and never returns wallet secrets.

## Official references

- [Build an MCP server](https://developers.openai.com/plugins/build/mcp-server)
- [Package a plugin](https://developers.openai.com/plugins/build/plugins)
- [Connect and test in ChatGPT](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- [Submit plugins](https://developers.openai.com/plugins/deploy/submission)
