const RECOVERY_SERVER_VERSION = "0.1.0";
const RECOVERY_SESSION_TTL_SECONDS = 60 * 60;
const REQUIRED_RECOVERY_ACK = "Quant Lab Recovery Authority acknowledged. Break glass only; no trading or account data; repair Main, verify exact SHA, and return to Main.";
const DEFAULT_OWNER = "opmgdeadman";
const DEFAULT_REPO = "quant-lab-operator";
const DEFAULT_BRANCH = "main";
const ALLOWED_WORKFLOWS = new Set(["ci.yml", "quant-lab-deploy.yml", "quant-lab-recovery-deploy.yml"]);
const ALLOWED_ROOT_FILES = new Set(["README.md", "OPERATING_MEMORY.md", "package.json", "wrangler.jsonc"]);
const ALLOWED_PATH_PREFIXES = ["src/", "test/", "tests/", "docs/", "migrations/", "quant_core/", ".github/workflows/"];
const BLOCKED_PATH_PARTS = [".env", ".git", ".wrangler", "node_modules", "__pycache__", ".venv", "venv", "dist", "build", "coverage"];
const BLOCKED_EXTENSIONS = [".db", ".sqlite", ".sqlite3", ".log", ".pem", ".key", ".p12", ".pfx"];

export const publicRecoveryTools = [
  tool("get_quant_lab_recovery_startup_context", "Get Quant Lab Recovery Startup Context", {}, [], true),
  tool("get_main_control_plane_health", "Get Main Control Plane Health", commonProperties(), commonRequired(), true),
  tool("get_repository_status", "Get Repository Status", commonProperties(), commonRequired(), true),
  tool("list_failed_workflow_runs", "List Failed Workflow Runs", {
    ...commonProperties(),
    workflow_id: { type: "string", enum: [...ALLOWED_WORKFLOWS] },
    limit: { type: "integer", minimum: 1, maximum: 20 },
  }, commonRequired(), true),
  tool("get_workflow_run", "Get Workflow Run", {
    ...commonProperties(),
    run_id: { type: "string", pattern: "^[0-9]+$", maxLength: 30 },
  }, [...commonRequired(), "run_id"], true),
  tool("apply_exact_recovery_patch", "Apply Exact Recovery Patch", {
    ...commonProperties(),
    path: { type: "string", minLength: 1, maxLength: 300 },
    find: { type: "string", minLength: 1, maxLength: 20000 },
    replace: { type: "string", maxLength: 20000 },
    expected_head_sha: { type: "string", pattern: "^[0-9a-f]{40}$" },
    commit_message: { type: "string", minLength: 1, maxLength: 240 },
  }, [...commonRequired(), "path", "find", "replace", "expected_head_sha", "commit_message"], false),
  tool("dispatch_recovery_workflow", "Dispatch Recovery Workflow", {
    ...commonProperties(),
    workflow_id: { type: "string", enum: [...ALLOWED_WORKFLOWS] },
    ref: { type: "string", minLength: 1, maxLength: 120 },
    deploy_sha: { type: "string", pattern: "^[0-9a-f]{40}$" },
    mode: { type: "string", enum: ["deploy", "migrations"] },
  }, [...commonRequired(), "workflow_id", "ref"], false),
];

export default {
  async fetch(request, env) {
    return handleRecoveryRequest(request, env);
  },
};

export async function handleRecoveryRequest(request, env) {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    return json({
      status: env.RECOVERY_API_TOKEN ? "ready" : "locked",
      service: "quant-lab-recovery",
      version: RECOVERY_SERVER_VERSION,
      deployment_sha: env.RECOVERY_DEPLOYMENT_SHA || "unknown",
      authentication_configured: Boolean(env.RECOVERY_API_TOKEN),
      github_mutation_configured: Boolean(env.GITHUB_TOKEN),
      trading_or_account_data_bound: false,
    });
  }
  if (request.method !== "POST" || url.pathname !== "/api/recovery/mcp") {
    return new Response("Not found", { status: 404 });
  }
  if (!env.RECOVERY_API_TOKEN) {
    return json({ error: "recovery_api_token_not_configured" }, 503);
  }
  if (!isAuthorized(request, env)) {
    return json({ error: "unauthorized" }, 401);
  }

  let message;
  try {
    message = await request.json();
  } catch {
    return jsonRpcError(null, -32700, "Parse error", 400);
  }
  const id = message?.id ?? null;
  const method = typeof message?.method === "string" ? message.method : "";
  if (!method) return jsonRpcError(id, -32600, "Invalid Request");

  if (method === "initialize") {
    const sessionId = await createSession(env);
    return json({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: message.params?.protocolVersion || "2025-06-18",
        capabilities: { tools: { listChanged: true } },
        serverInfo: {
          name: "quant-lab-recovery",
          title: "Quant Lab Recovery",
          version: RECOVERY_SERVER_VERSION,
          deploymentSha: env.RECOVERY_DEPLOYMENT_SHA || "unknown",
        },
        instructions: `Break-glass only. Call get_quant_lab_recovery_startup_context first. Every later tool requires recovery_authority_ack exactly as: ${REQUIRED_RECOVERY_ACK}`,
      },
    }, 200, { "mcp-session-id": sessionId });
  }

  const session = await validateSession(request, env);
  if (!session.ok) {
    const replacement = session.stale ? await createSession(env) : null;
    return json({
      jsonrpc: "2.0",
      id,
      error: {
        code: -32001,
        message: session.stale ? "recovery_deployment_changed_reinitialize" : "valid_recovery_session_required",
      },
    }, 200, replacement ? { "mcp-session-id": replacement } : {});
  }

  if (method === "notifications/initialized") return new Response(null, { status: 202 });
  if (method === "ping") return json({ jsonrpc: "2.0", id, result: {} });
  if (method === "tools/list") return json({ jsonrpc: "2.0", id, result: { tools: publicRecoveryTools } });
  if (method !== "tools/call") return jsonRpcError(id, -32601, "Method not found");

  const name = typeof message.params?.name === "string" ? message.params.name : "";
  const args = record(message.params?.arguments);
  const definition = publicRecoveryTools.find((candidate) => candidate.name === name);
  if (!definition) return toolResponse(id, name, { ok: false, error: "public_direct_recovery_tool_required" }, true);
  const schemaError = validateObjectSchema(args, definition.inputSchema);
  if (schemaError) return toolResponse(id, name, { ok: false, error: schemaError }, true);
  if (name !== "get_quant_lab_recovery_startup_context" && args.recovery_authority_ack !== REQUIRED_RECOVERY_ACK) {
    return toolResponse(id, name, { ok: false, error: "recovery_authority_ack_required", execution_started: false }, true);
  }

  try {
    const result = await callRecoveryTool(name, args, env);
    return toolResponse(id, name, result, result.ok === false);
  } catch (error) {
    return toolResponse(id, name, {
      ok: false,
      error: "recovery_execution_failed",
      safe_message: String(error instanceof Error ? error.message : error).slice(0, 500),
    }, true);
  }
}

async function callRecoveryTool(name, args, env) {
  if (name === "get_quant_lab_recovery_startup_context") {
    return {
      ok: true,
      authority: "independent_break_glass_only",
      required_recovery_authority_ack: REQUIRED_RECOVERY_ACK,
      deployment_sha: env.RECOVERY_DEPLOYMENT_SHA || "unknown",
      public_tool_count: publicRecoveryTools.length,
      rules: [
        "No trading, paper-account, strategy, or private market state is available here.",
        "Use Recovery only when Main or its deployment plane cannot receive or complete the repair.",
        "Known repository mutations require an exact expected head and exactly one text match.",
        "After repair, validate and deploy the exact SHA, verify Main, and return normal work to Main.",
      ],
    };
  }
  if (name === "get_main_control_plane_health") return getMainHealth(env);
  if (name === "get_repository_status") return getRepositoryStatus(env);
  if (name === "list_failed_workflow_runs") return listFailedRuns(args, env);
  if (name === "get_workflow_run") return getWorkflowRun(args, env);
  if (name === "apply_exact_recovery_patch") return applyExactPatch(args, env);
  if (name === "dispatch_recovery_workflow") return dispatchWorkflow(args, env);
  return { ok: false, error: "public_direct_recovery_tool_required" };
}

async function getMainHealth(env) {
  if (!env.MAIN_HEALTH_URL) return { ok: false, error: "main_health_url_not_configured" };
  const response = await fetch(env.MAIN_HEALTH_URL, { headers: { Accept: "application/json" } });
  const body = await parseBody(response);
  return {
    ok: response.ok,
    status_code: response.status,
    health: compactObject(body, ["status", "deployment_sha", "commit_sha", "mcp_version", "environment", "current_phase"]),
  };
}

async function getRepositoryStatus(env) {
  const config = repoConfig(env);
  const [repo, ref] = await Promise.all([
    githubRequest(env, `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`),
    githubRequest(env, `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/git/ref/heads/${encodeURIComponent(config.branch)}`),
  ]);
  return {
    ok: repo.ok && ref.ok,
    owner: config.owner,
    repo: config.repo,
    branch: config.branch,
    visibility: repo.ok ? repo.body.visibility : null,
    default_branch: repo.ok ? repo.body.default_branch : null,
    head_sha: ref.ok ? ref.body.object?.sha || null : null,
    github_token_configured: Boolean(env.GITHUB_TOKEN),
  };
}

async function listFailedRuns(args, env) {
  const workflowId = args.workflow_id || "ci.yml";
  if (!ALLOWED_WORKFLOWS.has(workflowId)) return { ok: false, error: "unsupported_workflow_id" };
  const limit = Math.min(20, Math.max(1, Number(args.limit || 10)));
  const config = repoConfig(env);
  const response = await githubRequest(env, `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/actions/workflows/${encodeURIComponent(workflowId)}/runs?branch=${encodeURIComponent(config.branch)}&per_page=50`);
  if (!response.ok) return githubFailure(response, "workflow_runs_lookup_failed");
  const runs = (response.body.workflow_runs || [])
    .filter((run) => run.conclusion === "failure" || run.conclusion === "cancelled" || run.status === "queued" || run.status === "in_progress")
    .slice(0, limit)
    .map(compactRun);
  return { ok: true, workflow_id: workflowId, runs };
}

async function getWorkflowRun(args, env) {
  const config = repoConfig(env);
  const [run, jobs] = await Promise.all([
    githubRequest(env, `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/actions/runs/${encodeURIComponent(args.run_id)}`),
    githubRequest(env, `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/actions/runs/${encodeURIComponent(args.run_id)}/jobs?per_page=50`),
  ]);
  if (!run.ok) return githubFailure(run, "workflow_run_lookup_failed");
  return {
    ok: true,
    run: compactRun(run.body),
    jobs: jobs.ok ? (jobs.body.jobs || []).map((job) => ({
      id: job.id,
      name: job.name,
      status: job.status,
      conclusion: job.conclusion,
      started_at: job.started_at,
      completed_at: job.completed_at,
      steps: (job.steps || []).map((step) => ({ name: step.name, status: step.status, conclusion: step.conclusion })),
    })) : [],
  };
}

async function applyExactPatch(args, env) {
  if (!env.GITHUB_TOKEN) return { ok: false, error: "github_token_not_configured" };
  if (!isAllowedRecoveryPath(args.path)) return { ok: false, error: "forbidden_path" };
  const config = repoConfig(env);
  const base = `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`;
  const ref = await githubRequest(env, `${base}/git/ref/heads/${encodeURIComponent(config.branch)}`);
  if (!ref.ok) return githubFailure(ref, "github_ref_lookup_failed");
  const headSha = ref.body.object?.sha;
  if (headSha !== args.expected_head_sha) {
    return { ok: false, error: "head_sha_mismatch", expected_head_sha: args.expected_head_sha, actual_head_sha: headSha || null };
  }
  const commit = await githubRequest(env, `${base}/git/commits/${encodeURIComponent(headSha)}`);
  if (!commit.ok) return githubFailure(commit, "github_commit_lookup_failed");
  const baseTreeSha = commit.body.tree?.sha;
  const tree = await githubRequest(env, `${base}/git/trees/${encodeURIComponent(baseTreeSha)}?recursive=1`);
  if (!tree.ok) return githubFailure(tree, "github_tree_lookup_failed");
  const entry = (tree.body.tree || []).find((item) => item.path === args.path && item.type === "blob");
  if (!entry) return { ok: false, error: "repository_file_not_found", path: args.path };
  const blob = await githubRequest(env, `${base}/git/blobs/${encodeURIComponent(entry.sha)}`);
  if (!blob.ok) return githubFailure(blob, "github_blob_lookup_failed");
  const content = decodeBase64(blob.body.content || "");
  const count = countExactOccurrences(content, args.find);
  if (count !== 1) return { ok: false, error: "exact_match_count_not_one", path: args.path, count };
  const updated = content.replace(args.find, args.replace);
  const newBlob = await githubRequest(env, `${base}/git/blobs`, { method: "POST", body: { content: updated, encoding: "utf-8" } });
  if (!newBlob.ok) return githubFailure(newBlob, "github_blob_create_failed");
  const newTree = await githubRequest(env, `${base}/git/trees`, {
    method: "POST",
    body: {
      base_tree: baseTreeSha,
      tree: [{ path: args.path, mode: "100644", type: "blob", sha: newBlob.body.sha }],
    },
  });
  if (!newTree.ok) return githubFailure(newTree, "github_tree_create_failed");
  const newCommit = await githubRequest(env, `${base}/git/commits`, {
    method: "POST",
    body: { message: args.commit_message, tree: newTree.body.sha, parents: [headSha] },
  });
  if (!newCommit.ok) return githubFailure(newCommit, "github_commit_create_failed");
  const updatedRef = await githubRequest(env, `${base}/git/refs/heads/${encodeURIComponent(config.branch)}`, {
    method: "PATCH",
    body: { sha: newCommit.body.sha, force: false },
  });
  if (!updatedRef.ok) return githubFailure(updatedRef, "github_ref_update_failed");
  const verify = await githubRequest(env, `${base}/git/ref/heads/${encodeURIComponent(config.branch)}`);
  const verifiedSha = verify.ok ? verify.body.object?.sha || null : null;
  return {
    ok: verifiedSha === newCommit.body.sha,
    status: verifiedSha === newCommit.body.sha ? "patch_committed" : "post_commit_verification_failed",
    path: args.path,
    previous_head_sha: headSha,
    commit_sha: newCommit.body.sha,
    verified_head_sha: verifiedSha,
  };
}

async function dispatchWorkflow(args, env) {
  if (!env.GITHUB_TOKEN) return { ok: false, error: "github_token_not_configured" };
  if (!ALLOWED_WORKFLOWS.has(args.workflow_id)) return { ok: false, error: "unsupported_workflow_id" };
  if (args.deploy_sha && !/^[0-9a-f]{40}$/.test(args.deploy_sha)) return { ok: false, error: "invalid_exact_sha" };
  const config = repoConfig(env);
  const expectedHeadSha = args.deploy_sha || await resolveRefSha(env, args.ref);
  const startedAt = Date.now() - 5000;
  const inputs = {};
  if (args.deploy_sha) inputs.deploy_sha = args.deploy_sha;
  if (args.mode) inputs.mode = args.mode;
  const path = `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/actions/workflows/${encodeURIComponent(args.workflow_id)}/dispatches`;
  const dispatch = await githubRequest(env, path, { method: "POST", body: { ref: args.ref, inputs } });
  let run = null;
  for (let attempt = 0; attempt < 4 && !run; attempt += 1) {
    const runs = await githubRequest(env, `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/actions/workflows/${encodeURIComponent(args.workflow_id)}/runs?branch=${encodeURIComponent(args.ref)}&event=workflow_dispatch&per_page=20`);
    if (runs.ok) run = findDispatchedRun(runs.body.workflow_runs, expectedHeadSha, startedAt);
    if (!run && attempt < 3) await delay(750);
  }
  if (!dispatch.ok && !run) return githubFailure(dispatch, "github_dispatch_failed");
  return {
    ok: true,
    status: "dispatched",
    workflow_id: args.workflow_id,
    ref: args.ref,
    deploy_sha: args.deploy_sha || null,
    run_id: run?.id || null,
    dispatch_reconciled: !dispatch.ok && Boolean(run),
  };
}

export function countExactOccurrences(content, needle) {
  let count = 0;
  let index = 0;
  while (true) {
    const next = content.indexOf(needle, index);
    if (next < 0) return count;
    count += 1;
    index = next + needle.length;
  }
}

export function isAllowedRecoveryPath(path) {
  if (typeof path !== "string" || !path || path.startsWith("/") || path.includes("\\") || path.split("/").includes("..")) return false;
  const lower = path.toLowerCase();
  if (BLOCKED_PATH_PARTS.some((part) => lower.split("/").includes(part))) return false;
  if (BLOCKED_EXTENSIONS.some((extension) => lower.endsWith(extension))) return false;
  return ALLOWED_ROOT_FILES.has(path) || ALLOWED_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function findDispatchedRun(runs, expectedHeadSha, createdAfterMs) {
  return (Array.isArray(runs) ? runs : [])
    .filter((run) => run?.event === "workflow_dispatch")
    .filter((run) => !expectedHeadSha || run?.head_sha === expectedHeadSha)
    .filter((run) => Date.parse(run?.created_at || "") >= createdAfterMs)
    .sort((left, right) => Number(right.id || 0) - Number(left.id || 0))[0] || null;
}

async function resolveRefSha(env, ref) {
  if (/^[0-9a-f]{40}$/.test(ref)) return ref;
  const config = repoConfig(env);
  const response = await githubRequest(env, `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/commits/${encodeURIComponent(ref)}`);
  return response.ok && /^[0-9a-f]{40}$/.test(response.body.sha || "") ? response.body.sha : null;
}

async function githubRequest(env, path, options = {}) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "quant-lab-recovery",
    ...(env.GITHUB_TOKEN ? { Authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}),
    ...(options.body ? { "Content-Type": "application/json" } : {}),
  };
  const response = await fetch(`https://api.github.com${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const body = response.status === 204 ? null : await parseBody(response);
  return { ok: response.ok, status_code: response.status, body };
}

function githubFailure(response, fallback) {
  return {
    ok: false,
    error: fallback,
    status_code: response.status_code || null,
    safe_message: String(response.body?.message || "").slice(0, 300) || null,
  };
}

function repoConfig(env) {
  return {
    owner: env.GITHUB_OWNER || DEFAULT_OWNER,
    repo: env.GITHUB_REPO || DEFAULT_REPO,
    branch: env.GITHUB_BRANCH || DEFAULT_BRANCH,
  };
}

function compactRun(run) {
  return {
    id: run.id,
    name: run.name,
    status: run.status,
    conclusion: run.conclusion,
    event: run.event,
    head_sha: run.head_sha,
    head_branch: run.head_branch,
    created_at: run.created_at,
    updated_at: run.updated_at,
    html_url: run.html_url,
  };
}

function commonProperties() {
  return {
    operation_id: { type: "string", minLength: 1, maxLength: 120 },
    recovery_authority_ack: { type: "string", const: REQUIRED_RECOVERY_ACK },
  };
}

function commonRequired() {
  return ["operation_id", "recovery_authority_ack"];
}

function tool(name, title, properties, required, readOnly) {
  return {
    name,
    title,
    description: `${title}. Independent break-glass recovery only.`,
    annotations: { readOnlyHint: readOnly, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: { type: "object", properties, required, additionalProperties: false },
    outputSchema: { type: "object", additionalProperties: true },
  };
}

function validateObjectSchema(value, schema) {
  const allowed = new Set(Object.keys(schema.properties || {}));
  for (const key of Object.keys(value)) if (!allowed.has(key)) return `additional_property_forbidden:${key}`;
  for (const key of schema.required || []) if (!(key in value)) return `required_property_missing:${key}`;
  for (const [key, definition] of Object.entries(schema.properties || {})) {
    if (!(key in value)) continue;
    const item = value[key];
    if (definition.type === "string" && typeof item !== "string") return `invalid_type:${key}`;
    if (definition.type === "integer" && !Number.isInteger(item)) return `invalid_type:${key}`;
    if (definition.const !== undefined && item !== definition.const) return `invalid_const:${key}`;
    if (definition.enum && !definition.enum.includes(item)) return `invalid_enum:${key}`;
    if (typeof item === "string" && definition.minLength && item.length < definition.minLength) return `min_length:${key}`;
    if (typeof item === "string" && definition.maxLength && item.length > definition.maxLength) return `max_length:${key}`;
    if (typeof item === "string" && definition.pattern && !(new RegExp(definition.pattern)).test(item)) return `invalid_pattern:${key}`;
    if (typeof item === "number" && definition.minimum !== undefined && item < definition.minimum) return `minimum:${key}`;
    if (typeof item === "number" && definition.maximum !== undefined && item > definition.maximum) return `maximum:${key}`;
  }
  return null;
}

async function createSession(env) {
  return signPayload({
    type: "quant_lab_recovery_session",
    exp: Math.floor(Date.now() / 1000) + RECOVERY_SESSION_TTL_SECONDS,
    deploymentSha: env.RECOVERY_DEPLOYMENT_SHA || "unknown",
    version: RECOVERY_SERVER_VERSION,
  }, env.RECOVERY_API_TOKEN);
}

async function validateSession(request, env) {
  const token = request.headers.get("mcp-session-id") || "";
  const payload = await verifyPayload(token, env.RECOVERY_API_TOKEN);
  if (payload?.type !== "quant_lab_recovery_session") return { ok: false, stale: false };
  const stale = payload.deploymentSha !== (env.RECOVERY_DEPLOYMENT_SHA || "unknown") || payload.version !== RECOVERY_SERVER_VERSION;
  return { ok: !stale, stale };
}

function isAuthorized(request, env) {
  return request.headers.get("authorization") === `Bearer ${env.RECOVERY_API_TOKEN}`;
}

async function signPayload(payload, secret) {
  const encoded = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encoded));
  return `${encoded}.${base64UrlEncode(new Uint8Array(signature))}`;
}

async function verifyPayload(token, secret) {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  try {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("HMAC", key, base64UrlDecode(signature), new TextEncoder().encode(encoded));
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encoded)));
    return Number(payload.exp || 0) > Math.floor(Date.now() / 1000) ? payload : null;
  } catch {
    return null;
  }
}

function toolResponse(id, name, result, isError) {
  return json({
    jsonrpc: "2.0",
    id,
    result: {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
      isError,
      tool_name: name,
    },
  });
}

function jsonRpcError(id, code, message, status = 200) {
  return json({ jsonrpc: "2.0", id, error: { code, message } }, status);
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function compactObject(value, keys) {
  const source = record(value);
  return Object.fromEntries(keys.filter((key) => key in source).map((key) => [key, source[key]]));
}

async function parseBody(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : {}; } catch { return { message: text.slice(0, 500) }; }
}

function decodeBase64(value) {
  const binary = atob(String(value).replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlDecode(value) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
