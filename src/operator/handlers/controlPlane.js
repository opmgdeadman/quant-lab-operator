import { capabilityDirectory, supportedIntents } from "../capabilityDirectory.js";
import { allowedRepoPaths, assertAllowedRepoPath } from "../clientSafeRequests.js";
import { repoSnapshots } from "../repoSnapshots.js";

export const handlers = {
  operator_status,
  read_continuation,
  write_continuation,
  inspect_repository,
  read_repo_file,
  run_validation,
  validate_production_sha,
};

async function operator_status(inputs, context) {
  const dbProbe = await context.databaseProbe(context.env);
  return {
    ok: true,
    authenticated_mcp: true,
    deployment_sha: context.env.DEPLOYMENT_SHA || "unknown",
    database_connected: dbProbe.connected,
    exposed_tool_count: 2,
    supported_intents: supportedIntents,
    capability_count: capabilityDirectory.length,
  };
}

async function read_continuation(inputs, context) {
  const row = await context.env.DB.prepare(
    "SELECT active_objective, current_phase, completed_evidence_json, next_action, updated_at FROM operator_continuation_state WHERE id = ?",
  ).bind("main").first();
  if (!row) {
    return {
      ok: true,
      state: "idle",
      active_objective: null,
      current_phase: null,
      completed_evidence: [],
      next_action: null,
      updated_at: null,
    };
  }
  return {
    ok: true,
    state: "active",
    active_objective: row.active_objective,
    current_phase: row.current_phase,
    completed_evidence: JSON.parse(row.completed_evidence_json || "[]"),
    next_action: row.next_action,
    updated_at: row.updated_at,
  };
}

async function write_continuation(inputs, context) {
  const now = new Date().toISOString();
  await context.env.DB.prepare(
    `INSERT INTO operator_continuation_state (
      id, active_objective, current_phase, completed_evidence_json, next_action, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      active_objective = excluded.active_objective,
      current_phase = excluded.current_phase,
      completed_evidence_json = excluded.completed_evidence_json,
      next_action = excluded.next_action,
      updated_at = excluded.updated_at`,
  ).bind(
    "main",
    inputs.active_objective,
    inputs.current_phase,
    JSON.stringify(inputs.completed_evidence),
    inputs.next_action,
    now,
  ).run();
  return {
    ok: true,
    state: "written",
    updated_at: now,
  };
}

async function inspect_repository(inputs, context) {
  return {
    ok: true,
    owner: context.env.GITHUB_OWNER || "opmgdeadman",
    repo: context.env.GITHUB_REPO || "quant-lab-operator",
    branch: context.env.GITHUB_BRANCH || "main",
    latest_sha: context.env.REPOSITORY_SHA || "unknown",
    deployment_sha: context.env.DEPLOYMENT_SHA || "unknown",
    dirty_state_available: false,
  };
}

async function read_repo_file(inputs) {
  assertAllowedRepoPath(inputs.path);
  const content = repoSnapshots[inputs.path] || "";
  const lines = content.split(/\r?\n/);
  const start = Math.max(1, Number(inputs.start_line || 1));
  const max = Math.min(120, Math.max(1, Number(inputs.max_lines || 80)));
  return {
    ok: true,
    path: inputs.path,
    allowed_path: allowedRepoPaths.includes(inputs.path),
    start_line: start,
    returned_lines: lines.slice(start - 1, start - 1 + max),
    total_lines: lines.length,
    truncated: start - 1 + max < lines.length,
  };
}

async function run_validation(inputs) {
  return {
    ok: false,
    validation: inputs.validation,
    status: "not_available_in_worker_runtime",
    supported_alternate_path: "GitHub Actions CI validates npm test, Python quant_core tests, and npm run check on push.",
  };
}

async function validate_production_sha(inputs, context) {
  const repositorySha = context.env.REPOSITORY_SHA || "unknown";
  const deploymentSha = context.env.DEPLOYMENT_SHA || "unknown";
  return {
    ok: true,
    repository_sha: repositorySha,
    deployment_sha: deploymentSha,
    aligned: repositorySha !== "unknown" && deploymentSha !== "unknown" && repositorySha === deploymentSha,
    latest_actions_result_available: false,
    current_phase: context.env.CURRENT_PHASE || "unknown",
  };
}

