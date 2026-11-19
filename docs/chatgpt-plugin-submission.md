# ChatGPT and Codex plugin submission

Surf uses one public plugin listing shared by ChatGPT and Codex. The listing is backed by the hosted Surf MCP endpoint's ChatGPT profile; `plugins/surf` is the Codex local package and `claude-plugin` is the Claude Code package.

## 1. MCP endpoint

The hosted endpoint is deployed at:

- MCP: `https://mcp.asksurf.ai/mcp/chatgpt`
- Health: `https://mcp.asksurf.ai/healthz`

Register `/mcp/chatgpt`, not `/mcp`. OpenAI rejected Surf v1.0.0 because the plugin summarized or aggregated news from third-party publishers. The ChatGPT profile (`src/profiles.ts`) is an allowlist that leaves those tools out: `surf_news`, `surf_web`, and the `news`, `web`, `events`, and `fundraising` commands of `surf_search` and the `ai-news` and `pulse` commands of `surf_project`. It also leaves out `surf_signal` (AI-written signal summaries) and `surf_x` (X posts and long-form articles). Endpoints added to the spec later stay out of this profile until they are reviewed and listed there. `/mcp` keeps serving every tool to other clients.

The ChatGPT profile currently exposes 33 tools. Before every submission, deploy the current server, complete an OAuth link with the dedicated review account, rescan the live endpoint, and run a real tool call through ChatGPT; a successful tool scan alone does not prove the data path works.

The `/mcp/chatgpt` endpoint is OAuth-only and forwards the signed-in user's OAuth token to the Surf data API. It answers credential-less requests with `401` and an RFC 9728 `WWW-Authenticate` challenge; every tool advertises only the `oauth2` security scheme. `/mcp` remains available for anonymous or API-key clients and is not the endpoint submitted to OpenAI.

OpenAI's portal does not provide an API-key connection flow. A Surf API key supplied outside OAuth will not reach this MCP server, so the review account must link through Surf OAuth during connection and scan. Put the account address and exact sign-in instructions in the private **Review details** form. Never put credentials, a fixed OTP, an API key, or reviewer instructions in this repository or the ZIP.

OpenAI review requires a fully featured test account whose login works immediately without email or SMS codes, magic links, or additional MFA approval. Surf's current email-OTP flow, including the pre-shared reviewer OTP fallback in muninn, still asks the reviewer to enter a code and therefore does **not** meet that requirement by itself. Before submitting, provide a dedicated reviewer login with a directly entered password (no second step), or expect another rejection under the credential rule.

### Current hard blockers

Do not submit until all of these are resolved:

1. **Production deployment:** the hosted server must serve this repository's current ChatGPT profile, not the previous release. The OpenAI tool scan reads the live server, not the uploaded ZIP.
2. **Reviewer login:** the dedicated account must accept a direct password login with no email/SMS code, magic link, or MFA challenge, and the browser must follow the post-login redirect back to the ChatGPT callback with `code` and `state`. Run the `muninn` review-login browser check before submitting; a password POST that the server accepts is not enough.
3. **Demo recording:** `extensions.com.openai.review.demo_recording_url` must contain an accessible video URL showing OAuth connection plus the five positive and three negative cases. Do not submit a placeholder URL.
4. **Web and mobile evidence:** run every case in new conversations on both ChatGPT web and mobile and keep the actual tool output for each positive case.
5. **Portal authentication and scan:** confirm the saved MCP connection uses OAuth (not No authentication), complete domain verification, rescan, and clear all Issues.

### Hard pre-submission checks

Run these checks in order. Stop and fix the first failure; uploading a new ZIP does not fix the hosted MCP server or the review account.

1. Complete OAuth with `mcp-review@theaicompany.org` and confirm `oauth/userinfo` returns that exact verified email. Do not test with a personal Surf account.
2. Run the review-login browser check from the `muninn` repo with the review account password:
   `REVIEW_ACCOUNT_PASSWORD=... node scripts/review-oauth-browser-check.mjs`. It must print `PASS`; curl-only checks cannot see a CSP-blocked redirect after the password form. If it fails with `form-action`, fix the review page before submitting.
3. Call `surf_exchange_price` through the production `/mcp/chatgpt` endpoint with that OAuth token. A successful response is required. A tool result saying `This Surf account has no credits left` means the submission will fail its positive cases; top up the review account's Surf credits before submitting.
4. Open the portal **MCPs** tab and confirm Authentication is OAuth, not **No authentication** or Mixed. If it still shows the old mode after uploading the new `mcp.json`, remove and re-add the MCP connection or create a new draft; the portal can retain an old client registration.
5. Rescan the live endpoint and confirm 33 tools, typed input schemas, declared output schemas, and `readOnlyHint`, `openWorldHint`, and `destructiveHint` annotations. The production endpoint, not the ZIP, supplies these definitions, so deploy the server changes before rescanning.
6. Run all five positive and three negative cases in new conversations on ChatGPT web and mobile. Keep the actual tool result for each positive case as review evidence.

## 2. Test in ChatGPT developer mode

1. In ChatGPT, open **Settings → Security and login** and enable **Developer mode**.
2. Open [ChatGPT Plugins](https://chatgpt.com/plugins), select **+**, and register the production `/mcp/chatgpt` URL.
3. Choose OAuth. Every `/mcp/chatgpt` tool advertises only `securitySchemes` `oauth2` (top level and `_meta.securitySchemes`). During connection, authorize the dedicated Surf review account; do not paste a Surf API key into plugin metadata or Review details. When a call needs an account, the tool error carries `_meta["mcp/www_authenticate"]`, which opens ChatGPT's account-linking UI. `SURF_OAUTH_AUTHORIZATION_SERVER` must remain configured for this to work.
   If the saved connection still shows **No authentication** or **Mixed**, remove and re-add the MCP connection after uploading the new package, or create a new draft/version. The portal can keep an existing client registration from an older package and will not necessarily switch it to OAuth on its own.
4. Scan tools and confirm the profile exposes one tool per operation (33 tools, e.g. `surf_exchange_price`), each with a typed input schema, a declared output schema, and `readOnlyHint: true`, `openWorldHint: true`, `destructiveHint: false`. OpenAI review rejects dispatcher tools that take a `command` plus free-form `params` ("This tool appears to execute operations that are not individually exposed"), so the chatgpt profile sets `perOperationTools` and a curated allowlist in `src/profiles.ts`; `/mcp` keeps the grouped tools.
5. Test in a new conversation on both ChatGPT and Codex.

If a private workspace plugin package is needed after registration, copy the connection's technical ID and add a root `.app.json` mapping. Public directory submission does not use `.app.json`; submit the production MCP URL directly in the OpenAI portal.

## 3. Prepare the public listing

Build the upload ZIP from `plugins/surf`:

```sh
./scripts/build-openai-plugin.sh   # → dist/openai/surf-<version>.zip
```

The package declares the `/mcp/chatgpt` server in `plugins/surf/.mcp.json` with OAuth authentication (dynamic client registration, scopes `data:read openid email`), and carries the listing, the review test cases, and the release notes in `plugins/surf/.codex-plugin/plugin.json` under `extensions.com.openai`, so they are imported with the ZIP. Bump `version` before each upload.

The manifest `name` is not the display name. If the portal rejects an upload with `Change name from ... to ..., then upload the ZIP again`, use the exact ID it shows in that error and rebuild; do not hardcode an ID from an older submission, because a recreated app gets a new one. The user-facing name comes from `interface.displayName`.

Open the [OpenAI plugin submission portal](https://platform.openai.com/plugins), select **Upload new or existing plugin**, and upload the ZIP. Then open **MCPs**, connect the server, and complete domain verification and the tool scan. Reviewer credentials and private sign-in instructions go in **Review information → Review details**, not in the package. The dedicated Surf review account is `mcp-review@theaicompany.org`; use it when linking Surf OAuth during connection/scan.

The demo video URL belongs in `plugin.json`:

```json
{
  "extensions": {
    "com.openai": {
      "review": {
        "demo_recording_url": "https://..."
      }
    }
  }
}
```

Show the OAuth connection, all five positive cases, and all three negative cases. The recording must not expose a password, OTP, access token, API key, or real user data.

Required before submission:

- Verified Surf business identity in the OpenAI organization.
- Apps Management write permission (`api.apps.write`) for the submitter.
- Public website, support, privacy-policy, and terms URLs.
- Square production logo (the repo includes `plugins/surf/assets/surf.svg`).
- Stable production MCP URL and domain-verification access.
- A dedicated reviewer/demo setup with a direct password login and no email/SMS code, magic link, MFA, or private-network dependency.
- Five positive and three negative test cases.
- An accessible demo recording URL and release notes.
- Country availability confirmed in the portal or declared in `publication.countries`.

When prompted for domain verification, serve the exact OpenAI token as plain text at:

```text
https://mcp.asksurf.ai/.well-known/openai-apps-challenge
```

The included Vercel function serves this route from the
`OPENAI_APPS_CHALLENGE` environment variable. Keep the deployed value in sync
with the portal token; do not wrap it in JSON or add other text.

## 4. Suggested listing copy

- **Name:** Surf
- **Short description:** Live crypto and on-chain intelligence
- **Category:** Finance
- **Long description:** Research crypto markets with live prices, exchange data, wallet and token activity, DeFi metrics, on-chain SQL, and prediction markets through Surf's data tools.
- **Release notes:** Initial Surf plugin submission with read-only crypto market, exchange, wallet, token, project, on-chain, prediction-market, equity, and fund research tools. News, web, signal, and X content tools are not included.

Starter prompts:

1. Which tokens are leading the market today?
2. Analyze this wallet's positions and recent activity.
3. Compare BTC and ETH market, exchange, and on-chain data.

## 5. Review test cases

The cases live in `plugins/surf/.codex-plugin/plugin.json` (`extensions.com.openai.review.test_cases`) and are read-only in the dashboard; edit the package and upload it again to change them. The expected behavior must match the actual response schema: for example, Polymarket rows carry `outcome_label`, while Kalshi rows identify the outcome in `question` and do not return that field.

Positive cases run with the dedicated account linked through OAuth: current BTC/USDT ticker (`surf_exchange_price`), BTC vs ETH funding rates (`surf_exchange_funding_history`), DeFi TVL ranking (`surf_project_defi_ranking`), Bitcoin prediction markets on each platform (`surf_search_prediction_market`), and the Hyperliquid leaderboard (`surf_hyperliquid_leaderboard`). Each case states the tool arguments and an observable expected result; rerun all five on ChatGPT web and mobile before submitting.

Negative cases: buying BTC, posting to X, and asking for a wallet's private key. Each case must produce no Surf tool call and an explicit refusal or safe fallback. Surf is read-only and never returns wallet secrets.

## Official references

- [Build an MCP server](https://developers.openai.com/plugins/build/mcp-server)
- [Package a plugin](https://developers.openai.com/plugins/build/plugins)
- [Connect and test in ChatGPT](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- [Submit plugins](https://developers.openai.com/plugins/deploy/submission)
