import assert from "node:assert/strict";
import test from "node:test";

import { handleRequest } from "../src/index.js";

function createEnv() {
  return {
    ENVIRONMENT: "test",
    CURRENT_PHASE: "operator-control-plane",
    DEPLOYMENT_SHA: "test-sha",
    REPOSITORY_SHA: "test-sha",
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

test("legacy public proof routes are removed", async () => {
  const env = createEnv();
  const status = await handleRequest(new Request("https://example.com/status"), env);
  const openapi = await handleRequest(new Request("https://example.com/openapi.json"), env);
  const mcp = await handleRequest(new Request("https://example.com/mcp"), env);

  assert.equal(status.status, 404);
  assert.equal(openapi.status, 404);
  assert.equal(mcp.status, 404);
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
  const initialize = await initializeMcpSession(env);
  const initializeBody = await initialize.json();

  assert.equal(initialize.status, 200);
  assert.equal(initializeBody.result.serverInfo.name, "quant-lab");
  assert.match(initialize.headers.get("mcp-session-id"), /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
});

test("operator mcp tools require valid session and expose status plus execute intent", async () => {
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

  assert.equal(noSessionBody.error.message, "valid_mcp_session_required");

  const toolsBody = await mcp(env, sessionId, { jsonrpc: "2.0", id: 3, method: "tools/list" });
  assert.deepEqual(
    toolsBody.result.tools.map((tool) => tool.name),
    ["get_quant_lab_status", "execute_quant_lab_intent"],
  );
  for (const tool of toolsBody.result.tools) {
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.ok(tool.outputSchema);
  }
  const statusTool = toolsBody.result.tools.find((tool) => tool.name === "get_quant_lab_status");
  const executeTool = toolsBody.result.tools.find((tool) => tool.name === "execute_quant_lab_intent");
  assert.equal(statusTool.annotations.readOnlyHint, true);
  assert.equal(executeTool.annotations.readOnlyHint, false);
  assert.equal(executeTool.annotations.destructiveHint, false);
  assert.equal(executeTool.annotations.idempotentHint, true);
});

test("operator mcp status tool returns bounded status only", async () => {
  const env = createEnv();
  const body = await callTool(env, "get_quant_lab_status", {});

  assert.equal(body.result.structuredContent.system, "Quant Lab");
  assert.equal(body.result.structuredContent.databaseConnected, true);
  assert.equal(body.result.structuredContent.databaseProbe, undefined);
});

test("operator mcp rejects unadvertised tools", async () => {
  const env = createEnv();
  const body = await callTool(env, "internal_admin_shell", {});
  assert.equal(body.error.message, "public_direct_tool_required");
});

test("execute_quant_lab_intent rejects missing or unknown intent", async () => {
  const env = createEnv();
  const missing = await callTool(env, "execute_quant_lab_intent", { operation_id: "op-missing", inputs: {} });
  const unknown = await callTool(env, "execute_quant_lab_intent", {
    operation_id: "op-unknown",
    intent: "unknown_intent",
    inputs: {},
  });

  assert.equal(missing.error.message, "unknown_intent");
  assert.equal(unknown.error.message, "unknown_intent");
});

test("execute_quant_lab_intent operator_status succeeds with durable receipt", async () => {
  const env = createEnv();
  const body = await executeIntent(env, "op-status", "operator_status", {});
  const content = body.result.structuredContent;

  assert.equal(content.ok, true);
  assert.equal(content.intent, "operator_status");
  assert.equal(content.receipt.receipt_id, "operator_receipt_op-status");
  assert.equal(content.execution_kernel.arbitrary_shell_allowed, false);
  assert.equal(env.DB.receipts.has("op-status"), true);
  assert.equal(env.DB.audit.length, 1);
});

test("read_continuation returns idle and write_continuation persists bounded state", async () => {
  const env = createEnv();
  const idle = await executeIntent(env, "op-read-continuation", "read_continuation", {});
  assert.equal(idle.result.structuredContent.result.state, "idle");

  const written = await executeIntent(env, "op-write-continuation", "write_continuation", {
    active_objective: "Build operator control plane",
    current_phase: "mcp-control-plane",
    completed_evidence: ["registry", "kernel"],
    next_action: "live connector verification",
  });
  assert.equal(written.result.structuredContent.ok, true);

  const read = await executeIntent(env, "op-read-continuation-2", "read_continuation", {});
  assert.equal(read.result.structuredContent.result.state, "active");
  assert.equal(read.result.structuredContent.result.current_phase, "mcp-control-plane");
});

test("execute_quant_lab_intent replays same operation id and rejects changed payload", async () => {
  const env = createEnv();
  const first = await executeIntent(env, "op-replay", "operator_status", {});
  const second = await executeIntent(env, "op-replay", "operator_status", {});
  const conflict = await executeIntent(env, "op-replay", "read_continuation", {});

  assert.equal(first.result.structuredContent.receipt.replayed, false);
  assert.equal(second.result.structuredContent.receipt.replayed, true);
  assert.equal(conflict.error.message, "idempotency_key_payload_mismatch");
});

test("read_repo_file only reads allowed paths and rejects traversal", async () => {
  const env = createEnv();
  const readme = await executeIntent(env, "op-read-readme", "read_repo_file", {
    path: "README.md",
    max_lines: 20,
  });
  const forbidden = await executeIntent(env, "op-read-secret", "read_repo_file", {
    path: "../.env",
  });

  assert.equal(readme.result.structuredContent.result.path, "README.md");
  assert.match(readme.result.structuredContent.result.returned_lines.join("\n"), /Quant Lab/);
  assert.equal(forbidden.result.structuredContent.ok, false);
  assert.equal(forbidden.result.structuredContent.error, "forbidden_path");
});

test("forbidden public input keys reject before handler dispatch", async () => {
  const env = createEnv();
  const body = await executeIntent(env, "op-forbidden-key", "operator_status", {
    token: "not-a-real-token",
  });

  assert.equal(body.result.structuredContent.ok, false);
  assert.equal(body.result.structuredContent.error, "forbidden_public_input_key");
});

test("run_validation returns explicit worker runtime limitation", async () => {
  const env = createEnv();
  const body = await executeIntent(env, "op-validation", "run_validation", {
    validation: "npm test",
  });

  assert.equal(body.result.structuredContent.ok, false);
  assert.equal(body.result.structuredContent.result.status, "not_available_in_worker_runtime");
});

test("validate_production_sha returns compact alignment fields", async () => {
  const env = createEnv();
  const body = await executeIntent(env, "op-sha", "validate_production_sha", {});

  assert.equal(body.result.structuredContent.result.aligned, true);
  assert.equal(body.result.structuredContent.result.repository_sha, "test-sha");
  assert.equal(body.result.structuredContent.result.deployment_sha, "test-sha");
});

test("list_github_actions_runs reports missing server-side token without exposing secrets", async () => {
  const env = createEnv();
  const body = await executeIntent(env, "op-actions-no-token", "list_github_actions_runs", {
    workflow_id: "ci.yml",
    limit: 2,
  });

  assert.equal(body.result.structuredContent.ok, false);
  assert.equal(body.result.structuredContent.result.status, "github_token_not_configured");
  assert.equal(body.result.structuredContent.result.config.token_configured, false);
  assert.doesNotMatch(JSON.stringify(body), /test-client-secret|test-token/);
});

test("GitHub Actions intents call bounded GitHub API routes", async () => {
  const env = { ...createEnv(), GITHUB_TOKEN: "server-side-test-token" };
  const calls = [];
  const restore = mockFetch(async (url, options) => {
    calls.push({ url, options });
    if (url.includes("/actions/workflows/ci.yml/runs")) {
      return jsonResponse({
        workflow_runs: [{
          id: 101,
          name: "CI",
          workflow_id: 7,
          status: "completed",
          conclusion: "success",
          event: "push",
          head_branch: "main",
          head_sha: "a".repeat(40),
          created_at: "2026-07-26T00:00:00Z",
          updated_at: "2026-07-26T00:01:00Z",
          html_url: "https://github.com/opmgdeadman/quant-lab-operator/actions/runs/101",
        }],
      });
    }
    if (url.includes("/actions/workflows/ci.yml/dispatches")) {
      assert.equal(options.method, "POST");
      assert.deepEqual(JSON.parse(options.body), { ref: "main", inputs: {} });
      return new Response(null, { status: 204 });
    }
    if (url.includes("/actions/runs/101/jobs")) {
      return jsonResponse({ jobs: [{ id: 201, name: "validate", status: "completed", conclusion: "success" }] });
    }
    if (url.includes("/actions/runs/101")) {
      return jsonResponse({
        id: 101,
        name: "CI",
        workflow_id: 7,
        status: "completed",
        conclusion: "success",
        event: "push",
        head_branch: "main",
        head_sha: "a".repeat(40),
        created_at: "2026-07-26T00:00:00Z",
        updated_at: "2026-07-26T00:01:00Z",
        html_url: "https://github.com/opmgdeadman/quant-lab-operator/actions/runs/101",
      });
    }
    throw new Error(`unexpected fetch URL: ${url}`);
  });

  try {
    const runs = await executeIntent(env, "op-list-actions", "list_github_actions_runs", {
      workflow_id: "ci.yml",
      limit: 1,
    });
    const dispatch = await executeIntent(env, "op-dispatch-ci", "trigger_github_workflow", {
      workflow_id: "ci.yml",
    });
    const monitor = await executeIntent(env, "op-monitor-ci", "monitor_github_workflow", {
      run_id: "101",
    });

    assert.equal(runs.result.structuredContent.result.runs.length, 1);
    assert.equal(dispatch.result.structuredContent.result.status, "dispatched");
    assert.equal(monitor.result.structuredContent.result.jobs[0].name, "validate");
    assert.equal(calls.every((call) => call.options.headers.Authorization === "Bearer server-side-test-token"), true);
    assert.doesNotMatch(JSON.stringify(runs), /server-side-test-token/);
  } finally {
    restore();
  }
});

test("deploy_cloudflare_worker dispatches fixed deploy workflow with exact SHA only", async () => {
  const env = { ...createEnv(), GITHUB_TOKEN: "server-side-test-token" };
  const exactSha = "b".repeat(40);
  const restore = mockFetch(async (url, options) => {
    assert.match(url, /\/actions\/workflows\/quant-lab-deploy\.yml\/dispatches$/);
    assert.deepEqual(JSON.parse(options.body), { ref: "main", inputs: { deploy_sha: exactSha } });
    return new Response(null, { status: 204 });
  });

  try {
    const invalid = await executeIntent(env, "op-deploy-invalid", "deploy_cloudflare_worker", {
      deploy_sha: "main",
    });
    const valid = await executeIntent(env, "op-deploy-valid", "deploy_cloudflare_worker", {
      deploy_sha: exactSha,
    });

    assert.equal(invalid.result.structuredContent.ok, false);
    assert.equal(invalid.result.structuredContent.result.status, "invalid_exact_sha");
    assert.equal(valid.result.structuredContent.result.status, "deployment_workflow_dispatched");
    assert.equal(valid.result.structuredContent.result.workflow_id, "quant-lab-deploy.yml");
  } finally {
    restore();
  }
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

async function mcp(env, sessionId, payload) {
  const response = await handleRequest(
    new Request("https://example.com/api/operator/mcp", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "mcp-session-id": sessionId,
      },
      body: JSON.stringify(payload),
    }),
    env,
  );
  return response.json();
}

async function callTool(env, name, args) {
  const initialize = await initializeMcpSession(env);
  return mcp(env, initialize.headers.get("mcp-session-id"), {
    jsonrpc: "2.0",
    id: 20,
    method: "tools/call",
    params: { name, arguments: args },
  });
}

async function executeIntent(env, operationId, intent, inputs) {
  return callTool(env, "execute_quant_lab_intent", {
    operation_id: operationId,
    intent,
    inputs,
  });
}

function mockFetch(handler) {
  const previous = globalThis.fetch;
  globalThis.fetch = handler;
  return () => {
    globalThis.fetch = previous;
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

class MemoryD1 {
  constructor() {
    this.receipts = new Map();
    this.continuation = null;
    this.audit = [];
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
    if (this.sql.includes("FROM operator_continuation_state")) {
      return this.db.continuation;
    }
    if (this.sql.includes("FROM market_candles")) {
      return null;
    }
    throw new Error(`unhandled first SQL: ${this.sql}`);
  }

  async run() {
    if (this.sql.includes("INSERT INTO operator_operation_receipts")) {
      const [operation_id, tool_name, intent, request_fingerprint, status, result_json, created_at, updated_at] = this.values;
      this.db.receipts.set(operation_id, {
        operation_id,
        tool_name,
        intent,
        request_fingerprint,
        status,
        result_json,
        created_at,
        updated_at,
      });
      return { success: true };
    }
    if (this.sql.includes("INSERT INTO operator_audit_log")) {
      const [id, operation_id, intent, status, summary, created_at] = this.values;
      this.db.audit.push({ id, operation_id, intent, status, summary, created_at });
      return { success: true };
    }
    if (this.sql.includes("INSERT INTO operator_continuation_state")) {
      const [, active_objective, current_phase, completed_evidence_json, next_action, updated_at] = this.values;
      this.db.continuation = {
        active_objective,
        current_phase,
        completed_evidence_json,
        next_action,
        updated_at,
      };
      return { success: true };
    }
    throw new Error(`unhandled run SQL: ${this.sql}`);
  }
}
