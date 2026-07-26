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

- `get_quant_lab_status`: read-only authenticated infrastructure status.
- `execute_quant_lab_intent`: idempotent execution kernel entrypoint for source-defined bounded operator intents.

There are no shell, arbitrary SQL, arbitrary GitHub, arbitrary Cloudflare, generic router, or arbitrary code execution tools.

Supported intents are `get_engineering_access_state`, `operator_status`, `read_continuation`, `write_continuation`, `inspect_repository`, `read_repo_file`, `list_repo_files`, `apply_repo_patch_set`, `create_repo_file`, `delete_repo_file`, `run_validation`, `list_github_actions_runs`, `trigger_github_workflow`, `monitor_github_workflow`, `deploy_cloudflare_worker`, `apply_d1_migrations`, and `validate_production_sha`.

GitHub and Cloudflare control uses the Lensically pattern: GPT calls `execute_quant_lab_intent`; the Worker validates the source-defined intent, writes durable receipts, and then calls GitHub REST or dispatches GitHub Actions using server-side secrets. GPT never receives raw tokens, shell, arbitrary SQL, arbitrary GitHub APIs, or direct Cloudflare credentials.

Repository mutation is bounded. File paths must pass the source-controlled allowlist, patch sets use exact find/replace only, each `find` must match exactly once, and a live patch set commits through GitHub's Git data API without force-updating the branch. The operator can dry-run patches before committing.

## Remote Validation

Official validation is GitHub Actions on the public repository. CI installs dependencies from a clean runner, runs Worker tests, runs Python `quant_core` tests, and performs a Wrangler dry-run.

The authenticated operator can dispatch allowlisted workflows:

- `ci.yml`: validates the repository.
- `quant-lab-deploy.yml`: validates an exact commit SHA, applies D1 migrations, and optionally deploys the Cloudflare Worker.

Cloudflare is the runtime target. Local commands are only developer diagnostics for debugging CI or Worker behavior; they are not the operating path for Quant Lab.

Deploys must use `npm run deploy`, which injects the current Git commit SHA into Worker `DEPLOYMENT_SHA` and `REPOSITORY_SHA` metadata. `validate_production_sha` depends on that metadata and should not be evaluated from a raw `wrangler deploy` that leaves placeholder values in place.
