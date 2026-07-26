# Quant Lab Operator

Private operator repository for the paper-trading laboratory infrastructure shell.

## Boundary

This repository is private and owns:

- Cloudflare Worker source.
- D1 migrations and binding config.
- Deployment config.
- Future MCP code.
- Future private strategy state.

This repository must not be made public without a complete Git-history audit.

The public runner repository contains only generic deterministic `quant_core` code and tests. Proprietary strategy specifications, MCP credentials, Cloudflare config, and private state remain here.

## Current Shell

The Worker exposes:

- `GET /`: minimal public website.
- `GET /status`: public read-only status JSON.
- `GET /internal/status`: authenticated internal status JSON using `X-Internal-Token: <INTERNAL_API_TOKEN>` or `Authorization: Bearer <INTERNAL_API_TOKEN>`.

No trading cycle, scheduled task, backtesting dispatch, full schema, MCP contract, or market ingestion exists yet.

## Validation

```powershell
npm install
npm test
npm run check
```

Deploy with Wrangler using the default Cloudflare profile.
