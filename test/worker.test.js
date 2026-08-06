import assert from "node:assert/strict";
import test from "node:test";

import { handleRequest } from "../src/index.js";
import { renderProfessionalConsole } from "../src/professionalConsole.js";
import { runValidation } from "../src/operator/handlers/controlPlane.js";
import { capabilityDirectory, supportedIntents } from "../src/operator/capabilityDirectory.js";

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

test("home renders the professional paper-only Quant Lab console", async () => {
  const env = createEnv();
  const response = await handleRequest(new Request("https://example.com/"), env);
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(body, /Autonomous Research Console/);
  assert.match(body, /PAPER ONLY/);
  assert.match(body, /TradingView/);
  assert.match(body, /Live shadow-paper competition/);
  assert.match(body, /Live orders disabled/);
  assert.match(body, /\/quant-lab-logo\.png/);
  assert.match(body, /\/site\.webmanifest/);
  assert.match(body, /property="og:image" content="https:\/\/example\.com\/og-image\.png"/);
  assert.match(body, /name="twitter:card" content="summary"/);
  assert.doesNotMatch(body, /guaranteed profit/i);
});

test("canonical Quant Lab brand assets and manifest are publicly served", async () => {
  const env = createEnv();
  const assets = [
    ["/favicon.ico", "image/x-icon"],
    ["/favicon-16x16.png", "image/png"],
    ["/favicon-32x32.png", "image/png"],
    ["/apple-touch-icon.png", "image/png"],
    ["/android-chrome-192x192.png", "image/png"],
    ["/android-chrome-512x512.png", "image/png"],
    ["/quant-lab-logo.png", "image/png"],
    ["/og-image.png", "image/png"],
  ];

  for (const [path, contentType] of assets) {
    const response = await handleRequest(new Request(`https://example.com${path}`), env);
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get("content-type"), contentType, path);
    assert.ok(bytes.byteLength > 100, path);
    assert.match(response.headers.get("cache-control"), /immutable/, path);
  }

  const manifestResponse = await handleRequest(new Request("https://example.com/site.webmanifest"), env);
  const manifest = await manifestResponse.json();
  assert.equal(manifestResponse.status, 200);
  assert.match(manifestResponse.headers.get("content-type"), /application\/manifest\+json/);
  assert.equal(manifest.name, "Quant Lab");
  assert.deepEqual(manifest.icons.map((entry) => entry.sizes), ["192x192", "512x512"]);
});

test("public live status is safe and does not require operator credentials", async () => {
  const env = createEnv();
  const response = await handleRequest(new Request("https://example.com/api/public/status"), env);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.system, "Quant Lab");
  assert.equal(body.boundaries, undefined);
  assert.equal(body.workerStatus, "online");
});

test("professional console escapes runtime identifiers by default", () => {
  const body = renderProfessionalConsole({
    forwardOperation: {
      latest_cycle: {
        state: "blocked_no_champion",
        cycle_id: "<img src=x onerror=alert(1)>",
        blocker_codes: ["no_qualified_champion"],
      },
    },
  });

  assert.doesNotMatch(body, /<img src=x/);
  assert.match(body, /&lt;img src=x onerror=alert\(1\)&gt;/);
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
  assert.equal(initializeBody.result.serverInfo.version, "0.4.0");
  assert.equal(initializeBody.result.serverInfo.executionKernelVersion, "quant-lab-execution-kernel-v1");
  assert.match(initializeBody.result.instructions, /deployment-scoped/);
  assert.match(initializeBody.result.instructions, /direct typed capability/);
  assert.match(initializeBody.result.instructions, /generic intent envelope is retired/);
  assert.match(initializeBody.result.instructions, /get_quant_lab_startup_context/);
  assert.match(initializeBody.result.instructions, /canonical Git ECL/);
  assert.match(initialize.headers.get("mcp-session-id"), /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
});

test("operator mcp session invalidates across deployments and requires reinitialization", async () => {
  const env = createEnv();
  const initialize = await initializeMcpSession(env);
  const sessionId = initialize.headers.get("mcp-session-id");

  env.DEPLOYMENT_SHA = "next-test-sha";
  const staleBody = await mcp(env, sessionId, { jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.equal(staleBody.error.message, "mcp_deployment_changed_reinitialize");

  const replacement = await initializeMcpSession(env);
  const replacementSessionId = replacement.headers.get("mcp-session-id");
  const toolsBody = await mcp(env, replacementSessionId, { jsonrpc: "2.0", id: 3, method: "tools/list" });
  assert.equal(toolsBody.error, undefined);
  assert.deepEqual(toolsBody.result.tools.map((tool) => tool.name), [
    "get_quant_lab_startup_context",
    "get_quant_lab_status",
    ...supportedIntents,
  ]);
});

test("operator mcp tools require valid session and expose every capability directly", async () => {
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
  const names = toolsBody.result.tools.map((tool) => tool.name);
  assert.deepEqual(names, ["get_quant_lab_startup_context", "get_quant_lab_status", ...supportedIntents]);
  assert.equal(names.includes("execute_quant_lab_intent"), false);
  for (const tool of toolsBody.result.tools) {
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.ok(tool.outputSchema);
  }
  for (const capability of capabilityDirectory) {
    const tool = toolsBody.result.tools.find((candidate) => candidate.name === capability.intent);
    assert.ok(tool, capability.intent);
    assert.equal(tool.annotations.readOnlyHint, capability.operation_class === "read");
    assert.equal(tool.annotations.destructiveHint, false);
    assert.equal(tool.annotations.idempotentHint, true);
    assert.equal(tool.inputSchema.properties.governing_authority_ack.const.includes("Startup Authority acknowledged"), true);
    assert.ok(tool.inputSchema.required.includes("operation_id"));
    assert.ok(tool.inputSchema.required.includes("canonical_continuation_sha"));
  }
});

test("operator mcp startup context loads authority and sole canonical Git ECL", async () => {
  const env = createEnv();
  const body = await callTool(env, "get_quant_lab_startup_context", {});
  const context = body.result.structuredContent;

  assert.equal(context.ok, true);
  assert.match(context.startup_authority.content, /Quant Lab Startup Authority/);
  assert.match(context.canonical_continuation.content, /Sole canonical engineering continuation ledger/);
  assert.match(context.canonical_continuation.content, /Current Action/);
  assert.ok(context.required_governing_authority_ack);
});

test("operator mcp status tool returns bounded status only", async () => {
  const env = createEnv();
  const body = await callTool(env, "get_quant_lab_status", {});

  assert.equal(body.result.structuredContent.system, "Quant Lab");
  assert.equal(body.result.structuredContent.databaseConnected, true);
  assert.equal(body.result.structuredContent.databaseProbe, undefined);
});

test("operator intents fail closed when startup authority is skipped or ECL SHA is stale", async () => {
  const env = createEnv();
  const initialize = await initializeMcpSession(env);
  const sessionId = initialize.headers.get("mcp-session-id");

  const skipped = await mcp(env, sessionId, {
    jsonrpc: "2.0",
    id: 21,
    method: "tools/call",
    params: {
      name: "operator_status",
      arguments: { operation_id: "op-skipped-startup" },
    },
  });
  assert.equal(skipped.error.message, "governing_authority_ack_required");

  const startup = await mcp(env, sessionId, {
    jsonrpc: "2.0",
    id: 22,
    method: "tools/call",
    params: { name: "get_quant_lab_startup_context", arguments: {} },
  });
  const context = startup.result.structuredContent;
  const stale = await mcp(env, sessionId, {
    jsonrpc: "2.0",
    id: 23,
    method: "tools/call",
    params: {
      name: "operator_status",
      arguments: {
        operation_id: "op-stale-ecl",
        governing_authority_ack: context.required_governing_authority_ack,
        canonical_continuation_sha: "stale-sha",
      },
    },
  });
  assert.equal(stale.error.message, "canonical_continuation_sha_stale_or_missing");
});

test("operator mcp rejects unadvertised tools", async () => {
  const env = createEnv();
  const body = await callTool(env, "internal_admin_shell", {});
  assert.equal(body.error.message, "public_direct_tool_required");
});

test("generic intent envelope is retired from the public MCP surface", async () => {
  const env = createEnv();
  const generic = await callTool(env, "execute_quant_lab_intent", {
    operation_id: "op-retired-generic",
    intent: "operator_status",
    inputs: {},
  });
  assert.equal(generic.error.message, "public_direct_tool_required");
});

test("direct operator_status succeeds with durable receipt", async () => {
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

test("read_continuation returns the sole canonical Git ledger and D1 writes are absent", async () => {
  const env = createEnv();
  const read = await executeIntent(env, "op-read-continuation", "read_continuation", {});
  const result = read.result.structuredContent.result;
  assert.equal(result.state, "active");
  assert.equal(result.authority, "sole_canonical_git_engineering_continuation_ledger");
  assert.equal(result.path, "docs/ENGINEERING_CONTINUATION_LEDGER.md");
  assert.ok(result.sha);
  assert.equal(result.active_job_id, "stage-13-directional-shadow-paper-research");
  assert.ok(result.current_action);
  assert.equal(result.d1_continuation_authoritative, false);
  assert.equal(result.mutation_intent, "apply_repo_patch_set");
  assert.equal(supportedIntents.includes("write_continuation"), false);
});

async function continuationDiagnosticResult(operationId) {
  const env = createEnv();
  const read = await executeIntent(env, operationId, "read_continuation", {});
  return read.result.structuredContent.result;
}

test("continuation diagnostic state", async () => {
  const result = await continuationDiagnosticResult("op-continuation-diagnostic-state");
  assert.equal(result.state, "active");
});

test("continuation diagnostic authority", async () => {
  const result = await continuationDiagnosticResult("op-continuation-diagnostic-authority");
  assert.equal(result.authority, "source_controlled_git_engineering_continuation_ledger");
});

test("continuation diagnostic identity", async () => {
  const result = await continuationDiagnosticResult("op-continuation-diagnostic-identity");
  assert.equal(result.path, "docs/ENGINEERING_CONTINUATION_LEDGER.md");
  assert.ok(result.sha);
});

test("continuation diagnostic active job", async () => {
  const result = await continuationDiagnosticResult("op-continuation-diagnostic-job");
  assert.equal(result.active_job_id, "stage-13-directional-shadow-paper-research");
});

test("continuation diagnostic current action", async () => {
  const result = await continuationDiagnosticResult("op-continuation-diagnostic-action");
  assert.ok(result.current_action);
});

test("continuation diagnostic mutation boundary", async () => {
  const result = await continuationDiagnosticResult("op-continuation-diagnostic-boundary");
  assert.equal(result.d1_continuation_authoritative, false);
  assert.equal(result.mutation_intent, "apply_repo_patch_set");
  assert.equal(supportedIntents.includes("write_continuation"), false);
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

test("production market data commissioning uses the bounded ingestion dependency", async () => {
  const expected = {
    ok: true,
    run_id: "market-data:test",
    requested_start_closed_at: "2026-08-01T17:00:00.000Z",
    requested_end_closed_at: "2026-08-01T17:00:00.000Z",
    fetched_count: 1,
    inserted_count: 1,
    duplicate_count: 0,
    health: { status: "healthy", missing_candles: 0, stale_hours: 0 },
  };
  const result = await runValidation(
    { validation: "production market data commission" },
    { env: { ENVIRONMENT: "test" }, marketDataIngestion: async () => expected },
  );

  assert.equal(result.ok, true);
  assert.equal(result.status, "passed");
  assert.deepEqual(result.production_ingestion, {
    run_id: expected.run_id,
    requested_start_closed_at: expected.requested_start_closed_at,
    requested_end_closed_at: expected.requested_end_closed_at,
    fetched_count: 1,
    inserted_count: 1,
    duplicate_count: 0,
    health: expected.health,
  });
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

test("engineering access state reports bounded controls without secrets", async () => {
  const env = { ...createEnv(), GITHUB_TOKEN: "server-side-test-token" };
  const body = await executeIntent(env, "op-engineering-access", "get_engineering_access_state", {});
  const result = body.result.structuredContent.result;

  assert.equal(result.github.token_configured, true);
  assert.equal(result.repository_controls.arbitrary_shell_allowed, false);
  assert.equal(result.repository_controls.arbitrary_sql_allowed, false);
  assert.equal(result.repository_controls.exact_patch_required, true);
  assert.doesNotMatch(JSON.stringify(body), /server-side-test-token/);
});

test("repo file list and read use bounded GitHub contents API paths", async () => {
  const env = { ...createEnv(), GITHUB_TOKEN: "server-side-test-token" };
  const restore = mockFetch(async (url) => {
    if (url.endsWith("/contents/docs?ref=main")) {
      return jsonResponse([
        { path: "docs/MCP_OPERATOR_CONTROL_PLANE_HANDOFF.md", type: "file", size: 100, sha: "doc-sha" },
        { path: ".env", type: "file", size: 10, sha: "secret-sha" },
      ]);
    }
    if (url.endsWith("/contents/README.md?ref=main")) {
      return jsonResponse({
        path: "README.md",
        sha: "readme-sha",
        content: btoa("Line 1\nQuant Lab remote read\nLine 3"),
      });
    }
    throw new Error(`unexpected fetch URL: ${url}`);
  });

  try {
    const listed = await executeIntent(env, "op-list-files", "list_repo_files", { path: "docs" });
    const read = await executeIntent(env, "op-read-remote-readme", "read_repo_file", { path: "README.md", max_lines: 2 });

    assert.deepEqual(listed.result.structuredContent.result.entries.map((entry) => entry.path), ["docs/MCP_OPERATOR_CONTROL_PLANE_HANDOFF.md"]);
    assert.equal(read.result.structuredContent.result.source, "github");
    assert.match(read.result.structuredContent.result.returned_lines.join("\n"), /Quant Lab remote read/);
  } finally {
    restore();
  }
});

test("apply_repo_patch_set dry-runs exact replacements and rejects non-unique matches", async () => {
  const env = { ...createEnv(), GITHUB_TOKEN: "server-side-test-token" };
  const restore = mockFetch(async (url) => {
    if (url.endsWith("/contents/README.md?ref=main")) {
      return jsonResponse({
        path: "README.md",
        sha: "readme-sha",
        content: btoa("alpha\nunique text\nomega\n"),
      });
    }
    if (url.endsWith("/contents/package.json?ref=main")) {
      return jsonResponse({
        path: "package.json",
        sha: "package-sha",
        content: btoa("dup dup"),
      });
    }
    throw new Error(`unexpected fetch URL: ${url}`);
  });

  try {
    const ok = await executeIntent(env, "op-patch-dry-run", "apply_repo_patch_set", {
      dry_run: true,
      replacements: [{ path: "README.md", find: "unique text", replace: "changed text" }],
    });
    const duplicate = await executeIntent(env, "op-patch-duplicate", "apply_repo_patch_set", {
      dry_run: true,
      replacements: [{ path: "package.json", find: "dup", replace: "changed" }],
    });
    const forbidden = await executeIntent(env, "op-patch-forbidden", "apply_repo_patch_set", {
      dry_run: true,
      replacements: [{ path: ".env", find: "A", replace: "B" }],
    });

    assert.equal(ok.result.structuredContent.result.status, "dry_run_passed");
    assert.equal(duplicate.result.structuredContent.ok, false);
    assert.equal(duplicate.result.structuredContent.result.status, "exact_match_count_not_one");
    assert.equal(forbidden.result.structuredContent.result.status, "forbidden_path");
  } finally {
    restore();
  }
});

test("create_repo_file and delete_repo_file use one bounded Git data commit", async () => {
  const env = { ...createEnv(), GITHUB_TOKEN: "server-side-test-token" };
  const calls = [];
  const restore = mockFetch(async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/contents/docs/test.md?ref=main")) {
      return jsonResponse({ message: "Not Found" }, 404);
    }
    if (url.endsWith("/contents/docs/remove.md?ref=main")) {
      return jsonResponse({ path: "docs/remove.md", sha: "remove-sha", content: btoa("remove me") });
    }
    if (url.endsWith("/git/ref/heads/main")) {
      assert.notEqual(options.method, "PATCH");
      return jsonResponse({ object: { sha: "head-sha" } });
    }
    if (url.endsWith("/git/refs/heads/main") && options.method === "PATCH") {
      return jsonResponse({ object: { sha: "new-commit-sha" } });
    }
    if (url.endsWith("/git/commits/head-sha")) {
      return jsonResponse({ tree: { sha: "base-tree-sha" } });
    }
    if (url.endsWith("/git/blobs")) {
      return jsonResponse({ sha: "blob-sha" }, 201);
    }
    if (url.endsWith("/git/trees")) {
      return jsonResponse({ sha: "tree-sha" }, 201);
    }
    if (url.endsWith("/git/commits")) {
      return jsonResponse({ sha: "commit-sha" }, 201);
    }
    throw new Error(`unexpected fetch URL: ${url}`);
  });

  try {
    const created = await executeIntent(env, "op-create-file", "create_repo_file", {
      path: "docs/test.md",
      content: "# Test\n",
      commit_message: "Create test doc",
    });
    const deleted = await executeIntent(env, "op-delete-file", "delete_repo_file", {
      path: "docs/remove.md",
      commit_message: "Delete test doc",
    });

    assert.equal(created.result.structuredContent.result.status, "file_created");
    assert.equal(deleted.result.structuredContent.result.status, "file_deleted");
    assert.equal(calls.some((call) => call.url.endsWith("/git/trees")), true);
    assert.equal(calls.some((call) => call.url.endsWith("/git/refs/heads/main") && call.options.method === "PATCH"), true);
  } finally {
    restore();
  }
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

test("deploy_cloudflare_worker and apply_d1_migrations dispatch fixed workflow with exact SHA only", async () => {
  const env = { ...createEnv(), GITHUB_TOKEN: "server-side-test-token" };
  const exactSha = "b".repeat(40);
  const restore = mockFetch(async (url, options) => {
    assert.match(url, /\/actions\/workflows\/quant-lab-deploy\.yml\/dispatches$/);
    const body = JSON.parse(options.body);
    assert.equal(body.ref, "main");
    assert.equal(body.inputs.deploy_sha, exactSha);
    return new Response(null, { status: 204 });
  });

  try {
    const invalid = await executeIntent(env, "op-deploy-invalid", "deploy_cloudflare_worker", {
      deploy_sha: "main",
    });
    const valid = await executeIntent(env, "op-deploy-valid", "deploy_cloudflare_worker", {
      deploy_sha: exactSha,
    });
    const migrations = await executeIntent(env, "op-migrations-valid", "apply_d1_migrations", {
      deploy_sha: exactSha,
    });

    assert.equal(invalid.result.structuredContent.ok, false);
    assert.equal(invalid.result.structuredContent.result.status, "invalid_exact_sha");
    assert.equal(valid.result.structuredContent.result.status, "deployment_workflow_dispatched");
    assert.equal(valid.result.structuredContent.result.workflow_id, "quant-lab-deploy.yml");
    assert.equal(migrations.result.structuredContent.result.status, "migration_workflow_dispatched");
  } finally {
    restore();
  }
});

test("oauth metadata and token endpoint support durable connector auth", async () => {
  const env = createEnv();
  const metadata = await handleRequest(new Request("https://example.com/.well-known/oauth-authorization-server"), env);
  const metadataBody = await metadata.json();

  assert.equal(metadata.status, 200);
  assert.equal(metadataBody.token_endpoint, "https://example.com/api/operator/oauth/token");
  assert.ok(metadataBody.grant_types_supported.includes("refresh_token"));

  const authorize = await handleRequest(
    new Request("https://example.com/api/operator/oauth/authorize?redirect_uri=https%3A%2F%2Fchatgpt.com%2Fcallback&state=test-state"),
    env,
  );
  const redirect = new URL(authorize.headers.get("location"));
  const code = redirect.searchParams.get("code");

  assert.equal(authorize.status, 302);
  assert.equal(redirect.searchParams.get("state"), "test-state");
  assert.ok(code);

  const token = await handleRequest(
    new Request("https://example.com/api/operator/oauth/token", {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: "test-client",
        client_secret: "test-client-secret",
        code,
      }),
    }),
    env,
  );
  const tokenBody = await token.json();

  assert.equal(token.status, 200);
  assert.equal(tokenBody.token_type, "Bearer");
  assert.equal(tokenBody.expires_in, 24 * 60 * 60);
  assert.match(tokenBody.access_token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.match(tokenBody.refresh_token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

  const refreshed = await handleRequest(
    new Request("https://example.com/api/operator/oauth/token", {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: "test-client",
        client_secret: "test-client-secret",
        refresh_token: tokenBody.refresh_token,
      }),
    }),
    env,
  );
  const refreshedBody = await refreshed.json();

  assert.equal(refreshed.status, 200);
  assert.match(refreshedBody.access_token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.match(refreshedBody.refresh_token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
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
  const sessionId = initialize.headers.get("mcp-session-id");
  let preparedArgs = args;
  if (supportedIntents.includes(name)) {
    const startup = await mcp(env, sessionId, {
      jsonrpc: "2.0",
      id: 19,
      method: "tools/call",
      params: { name: "get_quant_lab_startup_context", arguments: {} },
    });
    const context = startup.result.structuredContent;
    preparedArgs = {
      ...args,
      governing_authority_ack: context.required_governing_authority_ack,
      canonical_continuation_sha: context.canonical_continuation.sha,
    };
  }
  return mcp(env, sessionId, {
    jsonrpc: "2.0",
    id: 20,
    method: "tools/call",
    params: { name, arguments: preparedArgs },
  });
}

async function executeIntent(env, operationId, intent, inputs) {
  return callTool(env, intent, {
    operation_id: operationId,
    ...inputs,
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
    if (this.sql.includes("FROM market_candles") && this.sql.includes("COUNT(*)")) {
      return { count: 0 };
    }
    if (this.sql.includes("FROM market_candles")) {
      return null;
    }
    if (this.sql.trimStart().startsWith("SELECT")) {
      return null;
    }
    throw new Error(`unhandled first SQL: ${this.sql}`);
  }

  async all() {
    if (this.sql.trimStart().startsWith("SELECT")) {
      return { results: [] };
    }
    throw new Error(`unhandled all SQL: ${this.sql}`);
  }

  async run() {
    if (this.sql.includes("INSERT OR IGNORE INTO operator_operation_receipts")) {
      const [operation_id, tool_name, intent, request_fingerprint, created_at, updated_at] = this.values;
      if (this.db.receipts.has(operation_id)) {
        return { success: true, meta: { changes: 0 } };
      }
      this.db.receipts.set(operation_id, {
        operation_id,
        tool_name,
        intent,
        request_fingerprint,
        status: "started",
        result_json: "{}",
        created_at,
        updated_at,
      });
      return { success: true, meta: { changes: 1 } };
    }
    if (this.sql.includes("UPDATE operator_operation_receipts")) {
      const [created_at, updated_at, operation_id, expected_updated_at] = this.values;
      const existing = this.db.receipts.get(operation_id);
      if (!existing || existing.status !== "started" || existing.updated_at !== expected_updated_at) {
        return { success: true, meta: { changes: 0 } };
      }
      this.db.receipts.set(operation_id, {
        ...existing,
        status: "started",
        result_json: "{}",
        created_at,
        updated_at,
      });
      return { success: true, meta: { changes: 1 } };
    }
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
      return { success: true, meta: { changes: 1 } };
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
