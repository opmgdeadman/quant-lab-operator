# Quant Lab Operating Memory

Last updated: 2026-07-26

## Architecture Decision

Quant Lab is consolidated into one public GitHub repository: `opmgdeadman/quant-lab-operator`.

The earlier private-operator/public-runner split is obsolete. The former `opmgdeadman/quant-core-runner` GitHub repository was deleted after its deterministic core files were copied into this repository and CI passed here.

## Live Infrastructure

- Worker URL: `https://quant-lab-operator.briangriffin355.workers.dev`
- Public repo URL: `https://github.com/opmgdeadman/quant-lab-operator`
- Authenticated MCP endpoint: `POST /api/operator/mcp`
- OAuth metadata endpoint: `GET /.well-known/oauth-authorization-server`
- OAuth authorize endpoint: `GET /api/operator/oauth/authorize`
- OAuth token endpoint: `POST /api/operator/oauth/token`
- D1 binding: `DB`
- D1 database name: `quant_lab_operator`
- D1 database ID: `d9ac1f46-8251-4184-ad35-b87be4755917`

## Security Boundary

- Repository code may be public.
- Secrets remain only in GitHub and Cloudflare secret storage.
- Strategy specs, private research state, paper positions, decisions, and operational records remain in D1/private runtime state.
- MCP/control routes require authentication.
- Tool discovery is protected; unauthenticated `tools/list` must never work.
- The public website exposes only deliberately selected data.
- Model control must be bounded through direct typed MCP tools, closed schemas, idempotency, tests, and judge protections.

## Current MCP State

- Removed temporary unauthenticated `/mcp` proof route.
- Added Lensically-style authenticated route skeleton at `/api/operator/mcp`.
- `initialize` returns a deployment-scoped signed `Mcp-Session-Id`.
- `tools/list`, `tools/call`, and `ping` require auth plus valid session.
- Current advertised tool remains `get_quant_lab_status` for authenticated smoke testing only.
- Real control tools are not added yet.
- ChatGPT dev connector is installed and OAuth-connected.
- Connector App ID: `asdk_app_6a667ec3d25c8191920959f517984266`
- Connector Version ID: `asdk_app_v_6a667ec4c9608191b07d4cf48962f3ed`
- ChatGPT action refresh shows `get_quant_lab_status` as `READ` / `OPEN WORLD`.
- Full cloud/GitHub/Cloudflare/site/MCP creation runbook: `docs/WHITELISTED_CLOUD_GITHUB_MCP_RUNBOOK.md`.

## Remote Validation

- Official validation is GitHub Actions on the public repository, not a required local startup path.
- CI installs dependencies on a clean runner, runs Worker tests, runs Python `quant_core` tests, and performs a Wrangler dry-run.
- Cloudflare is the runtime target; localhost and local Python/Node are diagnostics only.
- Known passing CI after remote-first cleanup: run `30222233018`.
- Do not store a "latest commit" value here for docs-only commits; it becomes stale immediately after memory updates.
- Latest deployed Worker version ID after MCP secret alignment: `f847112c-8f94-444e-873f-3c5f32f39e32`.

## Secrets

- Global GitHub and Cloudflare profile secrets were not modified.
- `INTERNAL_API_TOKEN` is a Cloudflare Worker secret used for authenticated internal/MCP bearer checks.
- `MCP_CLIENT_SECRET` is stored as a Cloudflare Worker secret and in the ChatGPT dev connector OAuth configuration.
- A local temp copy exists at `C:\Users\brian\.codex\.tmp\quant-lab-mcp-client-secret.tmp`; remove it manually or with an approved cleanup command when no longer needed.
- Do not commit local secret files, generated DBs, logs, caches, or runtime artifacts.

## Next Action

Next functional implementation slice: add the first authenticated vertical trading tool to ingest one closed `BTC-USD` hourly candle into D1 and display that stored candle on the public website.
