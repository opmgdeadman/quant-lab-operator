# Quant Lab

Single public repository for the Quant Lab paper-trading laboratory.

## Boundary

This repository is designed to become public and contain the full runnable system:

- deterministic `quant_core` package and judge;
- backtesting engine;
- Cloudflare Worker and authenticated Operator MCP;
- D1 migrations and binding config;
- custom public website;
- GitHub Actions tests and deployment workflows;
- operational recovery and validation logic.

Public code does not mean public secrets or state. Credentials stay in GitHub and Cloudflare secret storage. Strategy specifications, research state, paper positions, decisions, and operational records belong in D1 or other private runtime storage. Public website routes expose only deliberately selected data.

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

## Validation

```powershell
npm install
npm test
C:\Users\brian\AppData\Local\Programs\Python\Python313\python.exe -m pip install -r requirements.txt
C:\Users\brian\AppData\Local\Programs\Python\Python313\python.exe -m pytest
npm run check
```

CI runs Node Worker tests, Python `quant_core` tests, and a Wrangler dry-run.
