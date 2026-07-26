import assert from "node:assert/strict";
import test from "node:test";

import { handleRequest } from "../src/index.js";

function createEnv() {
  return {
    ENVIRONMENT: "test",
    CURRENT_PHASE: "infrastructure-shell",
    DEPLOYMENT_SHA: "test-sha",
    INTERNAL_API_TOKEN: "test-token",
    MCP_CLIENT_ID: "test-client",
    MCP_CLIENT_SECRET: "test-client-secret",
    DB: new MemoryD1(),
  };
}

test("internal status requires bearer token", async () => {
  const env = createEnv();
  const denied = await handleRequest(new Request("https://example.com/internal/status"), env);
  assert.equal(denied.status, 401);

  const allowed = await handleRequest(
    new Request("https://example.com/internal/status", {
      headers: { "x-internal-token": "test-token" },
    }),
    env,
  );
  const body = await allowed.json();

  assert.equal(allowed.status, 200);
  assert.equal(body.databaseProbe.connected, true);
});

test("home renders no trading claims or fake metrics", async () => {
  const env = createEnv();
  const response = await handleRequest(new Request("https://example.com/"), env);
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(body, /Paper-trading laboratory/);
  assert.doesNotMatch(body, /return/i);
  assert.doesNotMatch(body, /profit/i);
});

test("public status and openapi proof routes are removed", async () => {
  const env = createEnv();
  const status = await handleRequest(new Request("https://example.com/status"), env);
  const statusBody = await status.json();
  const openapi = await handleRequest(new Request("https://example.com/openapi.json"), env);

  assert.equal(status.status, 404);
  assert.equal(statusBody.error, "not_found");
  assert.equal(openapi.status, 404);
});

test("legacy public mcp route is removed", async () => {
  const env = createEnv();
  const response = await handleRequest(new Request("https://example.com/mcp"), env);
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.equal(body.error, "not_found");
});

test("operator mcp rejects unauthenticated requests before parsing", async () => {
  const env = createEnv();
  const response = await handleRequest(
    new Request("https://example.com/api/operator/mcp", {
      method: "POST",
      body: "{not-json",
    }),
    env,
  );
  const body = await response.json();

  assert.equal(response.status, 401);
  assert.equal(body.error, "unauthorized");
});

test("operator mcp initialize requires auth and returns a session id", async () => {
  const env = createEnv();
  const initialize = await handleRequest(
    new Request("https://example.com/api/operator/mcp", {
      method: "POST",
      headers: { authorization: "Bearer test-token" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    }),
    env,
  );
  const initializeBody = await initialize.json();

  assert.equal(initialize.status, 200);
  assert.equal(initializeBody.result.serverInfo.name, "quant-lab");
  assert.match(initialize.headers.get("mcp-session-id"), /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
});

test("operator mcp tools require valid session and expose typed direct tools", async () => {
  const env = createEnv();
  const initialize = await initializeMcpSession(env);
  const sessionId = initialize.headers.get("mcp-session-id");

  const noSession = await handleRequest(
    new Request("https://example.com/api/operator/mcp", {
      method: "POST",
      headers: { authorization: "Bearer test-token" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    }),
    env,
  );
  const noSessionBody = await noSession.json();

  assert.equal(noSession.status, 200);
  assert.equal(noSessionBody.error.message, "valid_mcp_session_required");

  const tools = await handleRequest(
    new Request("https://example.com/api/operator/mcp", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "mcp-session-id": sessionId,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list" }),
    }),
    env,
  );
  const toolsBody = await tools.json();

  assert.deepEqual(
    toolsBody.result.tools.map((tool) => tool.name),
    ["get_quant_lab_status", "ingest_btc_usd_hourly_candle", "get_latest_btc_usd_hourly_candle"],
  );
  for (const tool of toolsBody.result.tools) {
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.ok(tool.outputSchema);
  }
  const statusTool = toolsBody.result.tools.find((tool) => tool.name === "get_quant_lab_status");
  const latestTool = toolsBody.result.tools.find((tool) => tool.name === "get_latest_btc_usd_hourly_candle");
  const ingestTool = toolsBody.result.tools.find((tool) => tool.name === "ingest_btc_usd_hourly_candle");
  assert.equal(statusTool.annotations.readOnlyHint, true);
  assert.equal(latestTool.annotations.readOnlyHint, true);
  assert.equal(ingestTool.annotations.readOnlyHint, false);
  assert.equal(ingestTool.annotations.destructiveHint, false);
  assert.equal(ingestTool.annotations.idempotentHint, true);
});

test("operator mcp status tool returns bounded status only", async () => {
  const env = createEnv();
  const initialize = await initializeMcpSession(env);
  const sessionId = initialize.headers.get("mcp-session-id");

  const response = await handleRequest(
    new Request("https://example.com/api/operator/mcp", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "mcp-session-id": sessionId,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "get_quant_lab_status", arguments: {} },
      }),
    }),
    env,
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.result.structuredContent.system, "Quant Lab");
  assert.equal(body.result.structuredContent.databaseConnected, true);
  assert.equal(body.result.structuredContent.databaseProbe, undefined);
});

test("operator mcp rejects unadvertised tools", async () => {
  const env = createEnv();
  const initialize = await initializeMcpSession(env);
  const sessionId = initialize.headers.get("mcp-session-id");

  const response = await handleRequest(
    new Request("https://example.com/api/operator/mcp", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "mcp-session-id": sessionId,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "internal_admin_shell", arguments: {} },
      }),
    }),
    env,
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.error.message, "public_direct_tool_required");
});

test("oauth metadata and token endpoint support connector auth", async () => {
  const env = createEnv();
  const metadata = await handleRequest(new Request("https://example.com/.well-known/oauth-authorization-server"), env);
  const metadataBody = await metadata.json();

  assert.equal(metadata.status, 200);
  assert.equal(metadataBody.token_endpoint, "https://example.com/api/operator/oauth/token");

  const token = await handleRequest(
    new Request("https://example.com/api/operator/oauth/token", {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: "test-client",
        client_secret: "test-client-secret",
      }),
    }),
    env,
  );
  const tokenBody = await token.json();

  assert.equal(token.status, 200);
  assert.equal(tokenBody.token_type, "Bearer");
  assert.match(tokenBody.access_token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
});

test("ingest rejects invalid OHLC", async () => {
  const env = createEnv();
  const body = await callTool(env, "ingest_btc_usd_hourly_candle", {
    ...validCandleArgs(),
    high: 99,
  });

  assert.equal(body.error.message, "invalid_ohlc");
});

test("ingest rejects future or incomplete candle", async () => {
  const env = createEnv();
  const future = new Date(Date.now() + 3_600_000);
  future.setUTCMinutes(0, 0, 0);
  const body = await callTool(env, "ingest_btc_usd_hourly_candle", {
    ...validCandleArgs(),
    closed_at: future.toISOString(),
  });

  assert.equal(body.error.message, "closed_candle_required");
});

test("ingest inserts one valid closed candle and latest returns it", async () => {
  const env = createEnv();
  const inserted = await callTool(env, "ingest_btc_usd_hourly_candle", validCandleArgs());

  assert.equal(inserted.result.structuredContent.ok, true);
  assert.equal(inserted.result.structuredContent.inserted, true);
  assert.equal(inserted.result.structuredContent.replayed, false);
  assert.equal(inserted.result.structuredContent.pair, "BTC-USD");

  const latest = await callTool(env, "get_latest_btc_usd_hourly_candle", {});
  assert.equal(latest.result.structuredContent.candle.closed_at, validCandleArgs().closed_at);
  assert.equal(latest.result.structuredContent.candle.close, 101);
});

test("ingest replay with same operation id returns existing result", async () => {
  const env = createEnv();
  await callTool(env, "ingest_btc_usd_hourly_candle", validCandleArgs());
  const replayed = await callTool(env, "ingest_btc_usd_hourly_candle", validCandleArgs());

  assert.equal(replayed.result.structuredContent.inserted, false);
  assert.equal(replayed.result.structuredContent.replayed, true);
  assert.equal(env.DB.candles.size, 1);
});

test("ingest same operation id with different payload rejects", async () => {
  const env = createEnv();
  await callTool(env, "ingest_btc_usd_hourly_candle", validCandleArgs());
  const conflict = await callTool(env, "ingest_btc_usd_hourly_candle", {
    ...validCandleArgs(),
    close: 102,
  });

  assert.equal(conflict.error.message, "operation_id_conflict");
});

test("ingest rejects same candle timestamp with different values", async () => {
  const env = createEnv();
  await callTool(env, "ingest_btc_usd_hourly_candle", validCandleArgs());
  const conflict = await callTool(env, "ingest_btc_usd_hourly_candle", {
    ...validCandleArgs(),
    operation_id: "different-operation",
    close: 102,
  });

  assert.equal(conflict.error.message, "candle_conflict");
});

test("public homepage includes stored latest candle after insertion", async () => {
  const env = createEnv();
  await callTool(env, "ingest_btc_usd_hourly_candle", validCandleArgs());

  const response = await handleRequest(new Request("https://example.com/"), env);
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(body, /Latest Stored BTC-USD 1h Candle/);
  assert.match(body, /2026-07-25T12:00:00.000Z/);
  assert.match(body, /101/);
});

async function initializeMcpSession(env) {
  return handleRequest(
    new Request("https://example.com/api/operator/mcp", {
      method: "POST",
      headers: { authorization: "Bearer test-token" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    }),
    env,
  );
}

async function callTool(env, name, args) {
  const initialize = await initializeMcpSession(env);
  const response = await handleRequest(
    new Request("https://example.com/api/operator/mcp", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "mcp-session-id": initialize.headers.get("mcp-session-id"),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 20,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    }),
    env,
  );
  return response.json();
}

function validCandleArgs() {
  return {
    operation_id: "op-2026-07-25T12",
    closed_at: "2026-07-25T12:00:00.000Z",
    open: 100,
    high: 105,
    low: 95,
    close: 101,
    volume: 12.5,
    source: "test",
  };
}

class MemoryD1 {
  constructor() {
    this.candles = new Map();
    this.receipts = new Map();
  }

  prepare(sql) {
    return new MemoryStatement(this, sql);
  }
}

class MemoryStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async first() {
    if (this.sql.includes("FROM infra_status")) {
      return { value: "true", updated_at: "2026-07-26T00:00:00Z" };
    }
    if (this.sql.includes("FROM operator_operation_receipts")) {
      return this.db.receipts.get(this.values[0]) || null;
    }
    if (this.sql.includes("FROM market_candles") && this.sql.includes("closed_at = ?")) {
      return [...this.db.candles.values()].find((row) => (
        row.pair === this.values[0] && row.interval === this.values[1] && row.closed_at === this.values[2]
      )) || null;
    }
    if (this.sql.includes("FROM market_candles") && this.sql.includes("ORDER BY closed_at DESC")) {
      return [...this.db.candles.values()].sort((left, right) => right.closed_at.localeCompare(left.closed_at))[0] || null;
    }
    throw new Error(`unhandled first SQL: ${this.sql}`);
  }

  async run() {
    if (this.sql.includes("INSERT INTO market_candles")) {
      const [
        id,
        pair,
        interval,
        closed_at,
        open,
        high,
        low,
        close,
        volume,
        source,
        created_at,
        updated_at,
      ] = this.values;
      this.db.candles.set(id, {
        id,
        pair,
        interval,
        closed_at,
        open,
        high,
        low,
        close,
        volume,
        source,
        created_at,
        updated_at,
      });
      return { success: true };
    }
    if (this.sql.includes("INSERT INTO operator_operation_receipts")) {
      const [operation_id, tool_name, request_fingerprint, result_json, created_at, updated_at] = this.values;
      const existing = this.db.receipts.get(operation_id);
      this.db.receipts.set(operation_id, {
        operation_id,
        tool_name,
        request_fingerprint,
        result_json,
        created_at: existing?.created_at || created_at,
        updated_at,
      });
      return { success: true };
    }
    throw new Error(`unhandled run SQL: ${this.sql}`);
  }
}
