import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  countExactOccurrences,
  findDispatchedRun,
  handleRecoveryRequest,
  isAllowedRecoveryPath,
  publicRecoveryTools,
} from "../src/recovery/index.js";

const TOKEN = "test-recovery-token";

function env(overrides = {}) {
  return {
    RECOVERY_API_TOKEN: TOKEN,
    RECOVERY_DEPLOYMENT_SHA: "0123456789abcdef0123456789abcdef01234567",
    MAIN_HEALTH_URL: "https://main.example/api/public/status",
    GITHUB_OWNER: "opmgdeadman",
    GITHUB_REPO: "quant-lab-operator",
    GITHUB_BRANCH: "main",
    ...overrides,
  };
}

async function initialize(environment) {
  return handleRecoveryRequest(new Request("https://recovery.example/api/recovery/mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }),
  }), environment);
}

async function mcp(environment, sessionId, message) {
  const response = await handleRecoveryRequest(new Request("https://recovery.example/api/recovery/mcp", {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify(message),
  }), environment);
  return { response, body: response.status === 202 ? null : await response.json() };
}

test("recovery health fails closed until authentication is configured", async () => {
  const locked = await handleRecoveryRequest(new Request("https://recovery.example/health"), env({ RECOVERY_API_TOKEN: "" }));
  const lockedBody = await locked.json();
  assert.equal(lockedBody.status, "locked");
  assert.equal(lockedBody.authentication_configured, false);
  assert.equal(lockedBody.trading_or_account_data_bound, false);

  const ready = await handleRecoveryRequest(new Request("https://recovery.example/health"), env());
  const readyBody = await ready.json();
  assert.equal(readyBody.status, "ready");
  assert.equal(readyBody.github_mutation_configured, false);
});

test("recovery MCP requires bearer auth and a deployment-scoped session", async () => {
  const unauthorized = await handleRecoveryRequest(new Request("https://recovery.example/api/recovery/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
  }), env());
  assert.equal(unauthorized.status, 401);

  const initializeResponse = await initialize(env());
  const initializeBody = await initializeResponse.json();
  const sessionId = initializeResponse.headers.get("mcp-session-id");
  assert.equal(initializeBody.result.serverInfo.name, "quant-lab-recovery");
  assert.equal(initializeBody.result.serverInfo.version, "0.1.0");
  assert.ok(sessionId);

  const listed = await mcp(env(), sessionId, { jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.deepEqual(listed.body.result.tools.map((tool) => tool.name), publicRecoveryTools.map((tool) => tool.name));

  const stale = await mcp(env({ RECOVERY_DEPLOYMENT_SHA: "fedcba9876543210fedcba9876543210fedcba98" }), sessionId, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/list",
  });
  assert.equal(stale.body.error.message, "recovery_deployment_changed_reinitialize");
  assert.ok(stale.response.headers.get("mcp-session-id"));
});

test("every recovery tool uses a closed direct schema", () => {
  assert.equal(publicRecoveryTools.length, 7);
  for (const tool of publicRecoveryTools) {
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(tool.annotations.destructiveHint, false);
    assert.equal(tool.annotations.idempotentHint, true);
  }
  const mutation = publicRecoveryTools.find((tool) => tool.name === "apply_exact_recovery_patch");
  assert.equal(mutation.annotations.readOnlyHint, false);
  assert.ok(mutation.inputSchema.required.includes("expected_head_sha"));
  assert.ok(mutation.inputSchema.required.includes("recovery_authority_ack"));
});

test("recovery path and exact-match controls reject unsafe mutations", () => {
  assert.equal(isAllowedRecoveryPath("src/operator/executionKernel.js"), true);
  assert.equal(isAllowedRecoveryPath("docs/ENGINEERING_CONTINUATION_LEDGER.md"), true);
  assert.equal(isAllowedRecoveryPath("../.env"), false);
  assert.equal(isAllowedRecoveryPath("runtime/state.sqlite"), false);
  assert.equal(isAllowedRecoveryPath("private.key"), false);
  assert.equal(countExactOccurrences("one two one", "one"), 2);
  assert.equal(countExactOccurrences("one two", "missing"), 0);
});

test("recovery mutations fail closed without GitHub credentials", async () => {
  const environment = env();
  const initializeResponse = await initialize(environment);
  const sessionId = initializeResponse.headers.get("mcp-session-id");
  const startup = await mcp(environment, sessionId, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "get_quant_lab_recovery_startup_context", arguments: {} },
  });
  const ack = startup.body.result.structuredContent.required_recovery_authority_ack;
  const patched = await mcp(environment, sessionId, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "apply_exact_recovery_patch",
      arguments: {
        operation_id: "recovery-patch-test",
        recovery_authority_ack: ack,
        path: "README.md",
        find: "old",
        replace: "new",
        expected_head_sha: "0123456789abcdef0123456789abcdef01234567",
        commit_message: "Test recovery patch",
      },
    },
  });
  assert.equal(patched.body.result.structuredContent.error, "github_token_not_configured");
});

test("workflow dispatch reconciliation selects the newest exact-SHA run", () => {
  const after = Date.parse("2026-08-06T18:00:00.000Z");
  const run = findDispatchedRun([
    { id: 10, event: "workflow_dispatch", head_sha: "old", created_at: "2026-08-06T18:01:00.000Z" },
    { id: 12, event: "workflow_dispatch", head_sha: "target", created_at: "2026-08-06T18:03:00.000Z" },
    { id: 11, event: "workflow_dispatch", head_sha: "target", created_at: "2026-08-06T18:02:00.000Z" },
  ], "target", after);
  assert.equal(run.id, 12);
});

test("recovery source contains no D1 or trading-domain binding", () => {
  const source = readFileSync(new URL("../src/recovery/index.js", import.meta.url), "utf8");
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(packageJson.scripts.check, /check:main/);
  assert.match(packageJson.scripts.check, /check:recovery/);
  assert.match(packageJson.scripts["check:recovery"], /src\/recovery\/wrangler\.jsonc/);
  assert.doesNotMatch(source, /env\.DB|D1Database|paper_accounts|paper_positions|strategy_candidates|market_candles/);
  assert.match(source, /independent_break_glass_only/);
  assert.match(source, /force: false/);
});
