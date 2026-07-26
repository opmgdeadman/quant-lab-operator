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

## Validation

- Worker tests: `npm test` passed, 10 tests.
- Quant core tests: `C:\Users\brian\AppData\Local\Programs\Python\Python313\python.exe -m pytest` passed, 22 tests.
- Wrangler dry-run: `npm run check` passed.
- GitHub Actions CI passed for commit `415a6d6017e22db4e76ba1929b5818bb138e04ae`, run `30221363658`.
- Latest deployed Worker version ID after authenticated MCP cleanup: `c0ddbf85-c22c-4a64-a746-813202a9154e`.

## Secrets

- Global GitHub and Cloudflare profile secrets were not modified.
- `INTERNAL_API_TOKEN` is a Cloudflare Worker secret used for authenticated internal/MCP bearer checks.
- `MCP_CLIENT_SECRET` is stored as a Cloudflare Worker secret and in the ChatGPT dev connector OAuth configuration.
- A local temp copy exists at `C:\Users\brian\.codex\.tmp\quant-lab-mcp-client-secret.tmp`; remove it manually or with an approved cleanup command when no longer needed.
- Do not commit local secret files, generated DBs, logs, caches, or runtime artifacts.

## Next Action

Next functional implementation slice: add the first authenticated vertical trading tool to ingest one closed `BTC-USD` hourly candle into D1 and display that stored candle on the public website.
