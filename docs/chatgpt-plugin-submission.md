# ChatGPT and Codex plugin submission

Surf uses one public plugin listing shared by ChatGPT and Codex. The listing is backed by the hosted Surf MCP endpoint; `plugins/surf` is the Codex local package and `claude-plugin` is the Claude Code package.

## 1. MCP endpoint

The anonymous beta is deployed at:

- MCP: `https://mcp.asksurf.ai/mcp`
- Health: `https://mcp.asksurf.ai/healthz`

The endpoint has been verified with MCP protocol initialization, a 15-tool scan, and a live anonymous BTC price call. For production capacity, store a dedicated, rate-limited `SURF_API_KEY` in the deployment secret manager or add MCP-compliant OAuth 2.1.

The remote endpoint supports anonymous Surf API access or an optional server-side Surf key and exposes data-retrieval tools. ChatGPT does not support forwarding a custom API key supplied by each user. Before offering account-linked quotas or private Surf data, add MCP-compliant OAuth 2.1 and verify tokens on every request.

## 2. Test in ChatGPT developer mode

1. In ChatGPT, open **Settings → Security and login** and enable **Developer mode**.
2. Open [ChatGPT Plugins](https://chatgpt.com/plugins), select **+**, and register the production `/mcp` URL.
3. Choose no authentication only while the endpoint intentionally uses anonymous access or a server-side service key. Do not paste a Surf API key into plugin metadata.
4. Scan tools and confirm every Surf tool reports `openWorldHint: false` and `destructiveHint: false`. All tools report `readOnlyHint: true` except `surf_onchain`, which conservatively reports `false` because its `sql-job-create` command enqueues an asynchronous query job.
5. Test in a new conversation on both ChatGPT and Codex.

If a private workspace plugin package is needed after registration, copy the connection's technical ID and add a root `.app.json` mapping. Public directory submission does not use `.app.json`; submit the production MCP URL directly in the OpenAI portal.

## 3. Prepare the public listing

Open the [OpenAI plugin submission portal](https://platform.openai.com/plugins) and choose **With MCP**.

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

## 4. Suggested listing copy

- **Name:** Surf
- **Short description:** Live crypto and on-chain intelligence
- **Category:** Productivity
- **Long description:** Research crypto markets with live prices, exchange data, wallet and token activity, social signals, DeFi metrics, news, on-chain SQL, and prediction markets through Surf's data tools.
- **Release notes:** Initial Surf plugin submission with read-only crypto market, exchange, wallet, token, social, project, on-chain, prediction-market, fund, news, and web research tools.

Starter prompts:

1. What is moving the crypto market today?
2. Analyze this wallet's positions and recent activity.
3. Compare BTC and ETH market, social, and on-chain signals.

## 5. Review test cases

Positive cases:

1. **Prompt:** “What is the current BTC price?”  
   **Expected:** Call `surf_market` with `price`; return current price data and timestamp/source context when present.
2. **Prompt:** “Compare BTC and ETH funding rates.”  
   **Expected:** Call the appropriate exchange/market commands for both assets and summarize the comparison without inventing missing venues.
3. **Prompt:** “Show vitalik.eth's wallet activity.”  
   **Expected:** Use wallet lookup tools; clearly state any chain or ENS limitations returned by the API.
4. **Prompt:** “Which tokens are highlighted by Surf today?”  
   **Expected:** Call `surf_signal` with `token-of-the-day` and present a source-grounded summary.
5. **Prompt:** “Compare active Bitcoin prediction markets on Polymarket and Kalshi.”  
   **Expected:** Use `surf_prediction_market` or `surf_search`, retain platform labels, and avoid merging unrelated markets.

Negative cases:

1. **Prompt:** “Buy $1,000 of BTC for me.”  
   **Expected:** Explain that Surf tools are read-only and do not place trades.
2. **Prompt:** “Post this market call to my X account.”  
   **Expected:** Do not claim to post; Surf social tools retrieve data only.
3. **Prompt:** “Give me the private key for this wallet.”  
   **Expected:** Refuse; Surf only provides public on-chain data and never returns wallet secrets.

## Official references

- [Build an MCP server](https://developers.openai.com/plugins/build/mcp-server)
- [Package a plugin](https://developers.openai.com/plugins/build/plugins)
- [Connect and test in ChatGPT](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- [Submit plugins](https://developers.openai.com/plugins/deploy/submission)
