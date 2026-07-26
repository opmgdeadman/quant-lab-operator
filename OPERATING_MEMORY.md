# Quant Lab Operator Operating Memory

Last updated: 2026-07-26

## Live Infrastructure

- Worker URL: `https://quant-lab-operator.briangriffin355.workers.dev`
- Public status endpoint: `GET /status`
- MCP dev endpoint: `GET|POST /mcp`
- D1 binding: `DB`
- D1 database name: `quant_lab_operator`
- D1 database ID: `d9ac1f46-8251-4184-ad35-b87be4755917`

## ChatGPT Plugin

- Connector name: `Quant Lab`
- App ID: `asdk_app_6a6674d527588191b1c9456630ef33e9`
- Version ID: `asdk_app_v_6a6674d768688191895ae7a57f37a664`
- Review status: `development`
- Authorization used: `None`
- MCP tool: `get_quant_lab_status`
- Tool boundary: read-only public infrastructure status only. No trading actions, strategy state, private data, or execution controls.

## Validation

- `npm test` passed: 6 tests.
- `npm run check` passed with `wrangler deploy --dry-run`.
- Latest deployed Worker version ID observed after MCP metadata update: `d51335eb-61df-43c9-8831-4320c73a9e8f`

## Secrets

- Global GitHub and Cloudflare profile secrets were not modified.
- A Worker-specific `INTERNAL_API_TOKEN` exists for internal Worker endpoints, but the current ChatGPT dev connector uses no auth because it exposes only public read-only status.
- Local temporary secret file, if still present, is outside the repo at `C:\Users\brian\.codex\.tmp\quant-lab-connector-secret.tmp`.

## Next Action

Smallest vertical trading slice: ingest one closed `BTC-USD` hourly candle into D1 and display that stored candle on the website.
