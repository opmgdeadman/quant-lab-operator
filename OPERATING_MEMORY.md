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
- Current advertised tools are `get_quant_lab_status` and `execute_quant_lab_intent`.
- `execute_quant_lab_intent` is the Lensically-style control-plane entrypoint. It dispatches only source-defined intents through the execution kernel, capability directory, client-safety registry, lifecycle manifest, and durable receipts/audit logging.
- Initial supported intents are `operator_status`, `read_continuation`, `write_continuation`, `inspect_repository`, `read_repo_file`, `run_validation`, and `validate_production_sha`.
- No shell, arbitrary SQL, arbitrary GitHub, arbitrary Cloudflare, generic router, or arbitrary code execution tools are present.
- D1 migration `0002_market_candles_and_operator_receipts.sql` has been applied remotely.
- Pending deploy for operator-control-plane migration `0003_operator_control_plane.sql`.
- Previous deployed Worker version after the first candle MCP slice: `a745b82c-383b-4e5f-99a2-704360a3c33d`.
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
- First candle MCP slice CI passed: run `30223013815` on commit `b3032a9041109395ea4bf65898a286880af2f10a`.
- Operator control-plane local diagnostics passed: `npm test` 25 tests; `npm run check` Wrangler dry-run.
- Do not store a "latest commit" value here for docs-only commits; it becomes stale immediately after memory updates.
- Latest deployed Worker version ID after MCP secret alignment: `f847112c-8f94-444e-873f-3c5f32f39e32`.
- Failed: PowerShell `Invoke-WebRequest` hit `Object reference not set to an instance of an object` while reading live MCP response headers. Use: a short Node `fetch` script to call OAuth token, `initialize`, read `mcp-session-id`, then call `tools/list` or `tools/call`. Applies when: verifying live MCP headers from this Windows shell.

## Secrets

- Global GitHub and Cloudflare profile secrets were not modified.
- `INTERNAL_API_TOKEN` is a Cloudflare Worker secret used for authenticated internal/MCP bearer checks.
- `MCP_CLIENT_SECRET` is stored as a Cloudflare Worker secret and in the ChatGPT dev connector OAuth configuration.
- A local temp copy exists at `C:\Users\brian\.codex\.tmp\quant-lab-mcp-client-secret.tmp`; remove it manually or with an approved cleanup command when no longer needed.
- Do not commit local secret files, generated DBs, logs, caches, or runtime artifacts.

## Next Action

Current GPT-requested milestone: diagnose why ChatGPT still sees only `get_quant_lab_status` after the live MCP reportedly lists candle tools, then implement the authenticated Lensically-style operator control plane before adding more trading functionality. Read `docs/LENSICALLY_STYLE_MCP_ARCHITECTURE.md` and `docs/MCP_OPERATOR_CONTROL_PLANE_HANDOFF.md`; build the execution kernel, capability directory, client-safety registry, lifecycle manifest, receipt/audit persistence, and `execute_quant_lab_intent`. Verify ChatGPT can see/invoke it, perform a harmless repo read, run validation, report production alignment, and return durable operation receipts. Candle ingestion is a later vertical slice, not the current milestone.
