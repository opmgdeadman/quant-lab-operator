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

## Remote Validation

Official validation is GitHub Actions on the public repository. CI installs dependencies from a clean runner, runs Worker tests, runs Python `quant_core` tests, and performs a Wrangler dry-run.

Cloudflare is the runtime target. Local commands are only developer diagnostics for debugging CI or Worker behavior; they are not the operating path for Quant Lab.
