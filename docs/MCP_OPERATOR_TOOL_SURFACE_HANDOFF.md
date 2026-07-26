# MCP Operator Tool Surface Handoff

Last updated: 2026-07-26

## Why This Exists

The ChatGPT Quant Lab connector is authenticated and connected. The current public MCP tool surface exposes:

- `get_quant_lab_status`
- `execute_quant_lab_intent`

GPT operates Quant Lab through bounded source-defined intents behind `execute_quant_lab_intent`, not through Codex, ad hoc shell access, arbitrary SQL, or raw GitHub/Cloudflare tools.

## Current Baseline

Read these first:

- `OPERATING_MEMORY.md`
- `README.md`
- `docs/WHITELISTED_CLOUD_GITHUB_MCP_RUNBOOK.md`
- `src/index.js`
- `test/worker.test.js`

Current MCP behavior in `src/index.js`:

- `POST /api/operator/mcp` requires auth before JSON parsing.
- `initialize` returns a signed `Mcp-Session-Id`.
- `tools/list`, `tools/call`, and `ping` require auth plus a valid session.
- Unknown or internal tools reject with `public_direct_tool_required`.
- Public proof routes `/mcp`, `/status`, and `/openapi.json` are removed.

Keep that boundary. Do not reintroduce unauthenticated tool discovery.

## Design Target

Follow the Lensically current pattern at the appropriate smaller scale:

- Public MCP surface is direct typed tools, not a generic free-text router.
- Every advertised tool has:
  - closed `inputSchema` with `additionalProperties: false`
  - explicit `outputSchema`
  - `annotations`
  - bounded response payloads
  - deterministic server-side handler
- No shell, arbitrary SQL, arbitrary Cloudflare, arbitrary GitHub, or arbitrary code execution tools.
- Private state stays in D1/runtime storage, not Git.
- Secrets stay in Cloudflare/GitHub secret storage and are never returned.

Lensically reference files:

- `C:\Auto-Threads\lensically\CURRENT_STATE.md`
- `C:\Auto-Threads\lensically\lensically-worker\src\index.ts`
- `C:\Auto-Threads\lensically\lensically-worker\test\operatorMode.spec.ts`
- `C:\Auto-Threads\lensically\lensically-worker\src\systemDirectory\clientSafeRequests.ts`

## First Tool Surface To Add

Add the first vertical slice only. Do not build a broad control plane yet.

### 1. `ingest_btc_usd_hourly_candle`

Purpose:

- Insert or idempotently reconcile one closed `BTC-USD` hourly candle into D1.
- This is the first real mutation tool.

Input schema:

- `operation_id`: string, required, max 120
- `closed_at`: ISO datetime string, required
- `open`: number, required
- `high`: number, required
- `low`: number, required
- `close`: number, required
- `volume`: number, required
- `source`: string, required, max 80

Rules:

- Pair is fixed server-side as `BTC-USD`; do not accept arbitrary symbols yet.
- Hour must be closed. Reject current/future incomplete hours.
- Validate OHLC consistency:
  - `high >= open`
  - `high >= close`
  - `low <= open`
  - `low <= close`
  - `high >= low`
  - all prices and volume finite and nonnegative where appropriate
- Idempotency:
  - same `operation_id` and same payload returns the existing result
  - same `operation_id` with different payload rejects
  - same `closed_at` for `BTC-USD` should upsert only if values are identical or explicitly reconcile under the same operation; prefer reject-on-conflict for now
- Return compact row metadata only.

Suggested output:

- `ok`
- `tool`
- `pair`
- `closed_at`
- `inserted`
- `replayed`
- `candle_id`
- `database_connected`

### 2. `get_latest_btc_usd_hourly_candle`

Purpose:

- Read the latest stored `BTC-USD` hourly candle.
- Used by GPT and the public site to verify the vertical slice.

Input schema:

- no inputs
- `additionalProperties: false`

Output:

- `ok`
- `pair`
- `candle` or `null`
- `database_connected`

## D1 Schema

Add a migration for candles and operation receipts.

Minimum tables:

```sql
CREATE TABLE IF NOT EXISTS market_candles (
  id TEXT PRIMARY KEY,
  pair TEXT NOT NULL,
  interval TEXT NOT NULL,
  closed_at TEXT NOT NULL,
  open REAL NOT NULL,
  high REAL NOT NULL,
  low REAL NOT NULL,
  close REAL NOT NULL,
  volume REAL NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(pair, interval, closed_at)
);

CREATE TABLE IF NOT EXISTS operator_operation_receipts (
  operation_id TEXT PRIMARY KEY,
  tool_name TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Use D1 prepared statements only. Do not accept arbitrary SQL through MCP.

## Public Website Update

Update `GET /` so it displays the latest stored `BTC-USD` hourly candle when one exists.

Keep the public site modest:

- no performance claims
- no fake metrics
- no private strategy state
- no operational secrets

## Tests To Add

Extend `test/worker.test.js`:

- unauthenticated `tools/list` still fails
- `tools/list` includes:
  - `get_quant_lab_status`
  - `ingest_btc_usd_hourly_candle`
  - `get_latest_btc_usd_hourly_candle`
- every listed tool has `inputSchema.additionalProperties === false`
- status/latest read tools have `readOnlyHint: true`
- ingest tool has `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: true`
- ingest rejects invalid OHLC
- ingest rejects future/incomplete candle
- ingest inserts one valid closed candle
- ingest replay with same `operation_id` returns replayed existing result
- ingest same `operation_id` with different payload rejects
- latest candle returns the inserted candle
- public homepage includes the stored latest candle after insertion
- unadvertised tool still rejects with `public_direct_tool_required`

## Implementation Shape

Keep `src/index.js` simple but stop hardcoding the single tool inside `tools/list`.

Recommended structure:

- `publicTools()` returns an array of tool descriptors.
- `callPublicTool(name, args, request, env)` dispatches by exact name.
- Each handler is a small function:
  - `handleGetQuantLabStatus(env)`
  - `handleIngestBtcUsdHourlyCandle(args, env)`
  - `handleGetLatestBtcUsdHourlyCandle(env)`
- Shared helpers:
  - `validateClosedBtcHourlyCandle(args, now)`
  - `fingerprintJson(value)`
  - `readOperationReceipt(env, operationId)`
  - `writeOperationReceipt(env, receipt)`
  - `latestBtcUsdHourlyCandle(env)`

Do not add a generic router, prompt interpreter, shell runner, arbitrary repository mutation tool, direct Cloudflare API tool, or D1 SQL tool in this slice.

## Validation

Remote validation is GitHub Actions. Local commands below are diagnostics only when debugging a failing CI or Worker change:

```powershell
npm test
npm run check
```

Official validation remains GitHub Actions after push.

## Success Signal

After deployment and connector action refresh, GPT should report that Quant Lab exposes a real bounded surface, not only status:

- `get_quant_lab_status`
- `ingest_btc_usd_hourly_candle`
- `get_latest_btc_usd_hourly_candle`

Then GPT can ask Codex for one closed candle or use a future data-ingestion source to write and verify the first D1-backed market data row.
