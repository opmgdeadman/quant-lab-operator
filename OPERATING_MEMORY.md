# Quant Lab Operating Memory

Last updated: 2026-07-26

## Architecture Decision

Quant Lab is consolidating into one public GitHub repository: `opmgdeadman/quant-lab-operator`.

The earlier private-operator/public-runner split is obsolete. `quant-core-runner` is retained only as a temporary source/backup until this repository is verified public, CI passes, and no unique files remain there.

## Live Infrastructure

- Worker URL: `https://quant-lab-operator.briangriffin355.workers.dev`
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

## Validation

- Worker tests: `npm test` passed, 11 tests.
- Quant core tests: `C:\Users\brian\AppData\Local\Programs\Python\Python313\python.exe -m pytest` passed, 22 tests.
- Wrangler dry-run: `npm run check` passed.

## Secrets

- Global GitHub and Cloudflare profile secrets were not modified.
- `INTERNAL_API_TOKEN` is a Cloudflare Worker secret used for authenticated internal/MCP bearer checks.
- `MCP_CLIENT_SECRET` should be stored as a Cloudflare Worker secret before connecting the ChatGPT dev MCP through OAuth.
- Do not commit local secret files, generated DBs, logs, caches, or runtime artifacts.

## Next Action

Update the ChatGPT dev connector to `https://quant-lab-operator.briangriffin355.workers.dev/api/operator/mcp`, verify authenticated connection, then make `opmgdeadman/quant-lab-operator` public after final working-tree and Git-history checks.
