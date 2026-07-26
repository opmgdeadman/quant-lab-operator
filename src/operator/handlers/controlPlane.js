import { capabilityDirectory, supportedIntents } from "../capabilityDirectory.js";
import { allowedRepoPaths, assertAllowedRepoPath } from "../clientSafeRequests.js";
import { isAllowedWorkflowId, isExactSha, githubConfig, githubRequest, repoApiPath } from "../githubApi.js";
import { repoSnapshots } from "../repoSnapshots.js";

export const handlers = {
  operator_status,
  read_continuation,
  write_continuation,
  inspect_repository,
  read_repo_file,
  run_validation,
  list_github_actions_runs,
  trigger_github_workflow,
  monitor_github_workflow,
  deploy_cloudflare_worker,
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
  const config = githubConfig(context.env);
  const remote = await githubRequest(context.env, repoApiPath(context.env, ""));
  return {
    ok: true,
    owner: config.owner,
    repo: config.repo,
    branch: config.branch,
    latest_sha: context.env.REPOSITORY_SHA || "unknown",
    deployment_sha: context.env.DEPLOYMENT_SHA || "unknown",
    github_token_configured: config.tokenConfigured,
    github_remote_reachable: remote.ok,
    default_branch: remote.ok ? remote.body.default_branch : config.branch,
    visibility: remote.ok ? remote.body.visibility : "unknown",
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
    supported_alternate_path: "Use trigger_github_workflow with ci.yml, then monitor_github_workflow for the run status.",
  };
}

async function list_github_actions_runs(inputs, context) {
  const workflowId = inputs.workflow_id || "";
  if (workflowId && !isAllowedWorkflowId(workflowId)) {
    return { ok: false, status: "unsupported_workflow_id" };
  }
  const limit = normalizeLimit(inputs.limit, 10);
  const config = githubConfig(context.env);
  const suffix = workflowId
    ? `/actions/workflows/${encodeURIComponent(workflowId)}/runs?branch=${encodeURIComponent(config.branch)}&per_page=${limit}`
    : `/actions/runs?branch=${encodeURIComponent(config.branch)}&per_page=${limit}`;
  const remote = await githubRequest(context.env, repoApiPath(context.env, suffix));
  if (!remote.ok) {
    return { ok: false, status: remote.status || "github_request_failed", status_code: remote.status_code, config: remote.config };
  }
  return {
    ok: true,
    workflow_id: workflowId || null,
    branch: config.branch,
    runs: (remote.body.workflow_runs || []).slice(0, limit).map(compactRun),
  };
}

async function trigger_github_workflow(inputs, context) {
  if (!isAllowedWorkflowId(inputs.workflow_id)) {
    return { ok: false, status: "unsupported_workflow_id" };
  }
  const config = githubConfig(context.env);
  const ref = inputs.ref || config.branch;
  const workflowInputs = {};
  if (inputs.deploy_sha) {
    if (!isExactSha(inputs.deploy_sha)) {
      return { ok: false, status: "invalid_exact_sha" };
    }
    workflowInputs.deploy_sha = inputs.deploy_sha;
  }
  const remote = await githubRequest(
    context.env,
    repoApiPath(context.env, `/actions/workflows/${encodeURIComponent(inputs.workflow_id)}/dispatches`),
    { method: "POST", body: { ref, inputs: workflowInputs } },
  );
  if (!remote.ok) {
    return { ok: false, status: remote.status || "github_dispatch_failed", status_code: remote.status_code, config: remote.config };
  }
  return {
    ok: true,
    status: "dispatched",
    workflow_id: inputs.workflow_id,
    ref,
    inputs: Object.keys(workflowInputs),
  };
}

async function monitor_github_workflow(inputs, context) {
  const runId = String(inputs.run_id || "");
  if (!/^[0-9]{1,30}$/.test(runId)) {
    throw new Error("invalid_run_id");
  }
  const run = await githubRequest(context.env, repoApiPath(context.env, `/actions/runs/${runId}`));
  if (!run.ok) {
    return { ok: false, status: run.status || "github_run_lookup_failed", status_code: run.status_code, config: run.config };
  }
  const jobs = await githubRequest(context.env, repoApiPath(context.env, `/actions/runs/${runId}/jobs?per_page=20`));
  return {
    ok: true,
    run: compactRun(run.body),
    jobs_available: jobs.ok,
    jobs: jobs.ok ? (jobs.body.jobs || []).map(compactJob) : [],
  };
}

async function deploy_cloudflare_worker(inputs, context) {
  if (!isExactSha(inputs.deploy_sha)) {
    return { ok: false, status: "invalid_exact_sha" };
  }
  const config = githubConfig(context.env);
  const workflowId = config.deployWorkflowId;
  if (!isAllowedWorkflowId(workflowId)) {
    return { ok: false, status: "unsupported_workflow_id" };
  }
  const remote = await githubRequest(
    context.env,
    repoApiPath(context.env, `/actions/workflows/${encodeURIComponent(workflowId)}/dispatches`),
    { method: "POST", body: { ref: config.branch, inputs: { deploy_sha: inputs.deploy_sha } } },
  );
  if (!remote.ok) {
    return { ok: false, status: remote.status || "github_deploy_dispatch_failed", status_code: remote.status_code, config: remote.config };
  }
  return {
    ok: true,
    status: "deployment_workflow_dispatched",
    workflow_id: workflowId,
    ref: config.branch,
    deploy_sha: inputs.deploy_sha,
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

function normalizeLimit(value, fallback) {
  const numeric = Number(value || fallback);
  return Math.min(20, Math.max(1, Number.isFinite(numeric) ? Math.floor(numeric) : fallback));
}

function compactRun(run) {
  return {
    id: run.id,
    name: run.name,
    workflow_id: run.workflow_id,
    status: run.status,
    conclusion: run.conclusion,
    event: run.event,
    head_branch: run.head_branch,
    head_sha: run.head_sha,
    created_at: run.created_at,
    updated_at: run.updated_at,
    html_url: run.html_url,
  };
}

function compactJob(job) {
  return {
    id: job.id,
    name: job.name,
    status: job.status,
    conclusion: job.conclusion,
    started_at: job.started_at,
    completed_at: job.completed_at,
  };
}
