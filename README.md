# Quant Lab

Single public repository for the Quant Lab paper-trading laboratory, deployed as a GitHub plus Cloudflare system.

## Boundary

This repository is public and contains the remote-first runnable system:

- deterministic `quant_core` package and judge;
- backtesting engine;
- Cloudflare Worker and authenticated Operator MCP;
- D1 migrations and binding config;
- custom public website;
- GitHub Actions tests and deployment workflows;
- operational recovery and validation logic.

Public code does not mean public secrets or state. Credentials stay in GitHub and Cloudflare secret storage. Strategy specifications, research state, paper positions, decisions, and operational records belong in D1 or other private runtime storage. Public website routes expose only deliberately selected data.

The operating model is not localhost or a required local runtime. Changes are pushed to GitHub, validated by GitHub Actions, deployed to Cloudflare, and verified against the live Worker, D1 binding, website, and authenticated MCP.

## Current Worker Surface

- `GET /`: minimal public website.
- `GET /.well-known/oauth-authorization-server`: OAuth metadata for the Operator MCP.
- `GET /api/operator/oauth/authorize`: OAuth authorization endpoint.
- `POST /api/operator/oauth/token`: OAuth token endpoint.
- `POST /api/operator/mcp`: authenticated JSON-RPC MCP endpoint.
- `GET /internal/status`: authenticated internal status JSON using `X-Internal-Token: <INTERNAL_API_TOKEN>` or `Authorization: Bearer <INTERNAL_API_TOKEN>`.

The legacy unauthenticated `/mcp`, `/status`, and `/openapi.json` proof surfaces have been removed. Tool discovery is protected.

## MCP Semantics

`POST /api/operator/mcp` supports:

- `initialize`: requires auth and returns `Mcp-Session-Id`.
- `tools/list`: requires auth and a valid session.
- `tools/call`: requires auth and a valid session.
- `ping`: requires auth and a valid session.
- `notifications/initialized`: accepted as a notification.

Only advertised direct typed tools with closed schemas may execute. Unknown or internal tool names are rejected.

Advertised tools:

- `get_quant_lab_startup_context`: mandatory read-first Startup Authority plus the M-BRAIN Work Unit routing contract.
- `get_quant_lab_status`: read-only authenticated infrastructure status.
- one direct typed tool for every capability declared in `src/operator/capabilityDirectory.js`.

The generic `execute_quant_lab_intent` envelope is retired. The stable public read/mutation gateways keep capability vocabulary server-side while preserving closed schemas, deterministic routing, durable idempotent receipts, operation leases, bounded output, and M-BRAIN-Work-Unit-bound action closure. Every execution call includes the exact Startup Authority acknowledgment and `mbrain_work_unit_id`; missing or mismatched authority fails closed.

There are no shell, arbitrary SQL, unrestricted GitHub, unrestricted Cloudflare, generic router, or arbitrary code-execution tools. GitHub and Cloudflare control remains source-defined and server-side. The model never receives raw tokens or deployment credentials.

Repository mutation is bounded. File paths must pass the source-controlled allowlist, patch sets use exact find/replace only, each `find` must match exactly once, and a live patch set commits through GitHub's Git data API without force-updating the branch. The operator can dry-run patches before committing.

## Remote Validation

Official validation is GitHub Actions on the public repository. One branch-wide Ubuntu job first scans the complete Git history for committed secrets and unsafe artifacts, then runs Worker tests, Python `quant_core` tests, and Main plus Recovery Wrangler dry-runs. Superseded push and manual validation runs cancel through one concurrency authority.

The authenticated operator can dispatch allowlisted workflows:

- `ci.yml`: validates the repository.
- `quant-lab-deploy.yml`: validates an exact commit SHA, applies D1 migrations, and optionally deploys the Cloudflare Worker.

Cloudflare is the runtime target. Local commands are only developer diagnostics for debugging CI or Worker behavior; they are not the operating path for Quant Lab.

Deploys must use `npm run deploy`, which injects the current Git commit SHA into Worker `DEPLOYMENT_SHA` and `REPOSITORY_SHA` metadata. `validate_production_sha` depends on that metadata and should not be evaluated from a raw `wrangler deploy` that leaves placeholder values in place.
