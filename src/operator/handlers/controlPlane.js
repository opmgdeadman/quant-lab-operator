import { capabilityDirectory, supportedIntents } from "../capabilityDirectory.js";
import { allowedRepoDirectories, allowedRepoPaths, assertAllowedRepoPath, isAllowedRepoPath } from "../clientSafeRequests.js";
import { commitRepoChanges, isAllowedWorkflowId, isExactSha, githubConfig, githubRequest, readRepoContent, repoApiPath } from "../githubApi.js";
import { repoSnapshots } from "../repoSnapshots.js";
import { commissionPaperLedger, executePaperDecision, getPaperAccountSummary } from "../../paperLedger.js";
import { getBaselineBenchSummary, runProductionBaselineBench } from "../../baselineBench.js";
import { getHostileJudgeSummary, runProductionHostileJudge } from "../../hostileJudge.js";
import { getStrategyFactorySummary, runProductionStrategyFactory } from "../../strategyFactory.js";
import { getChampionSelectionSummary, runProductionChampionSelection } from "../../championSelection.js";
import { commissionForwardPaperOperation, getForwardOperationSummary, runProductionForwardPaperCycle } from "../../forwardPaper.js";
import { getLiveQualificationSummary, runProductionLiveQualification } from "../../liveQualification.js";
import { getRollingResearchSummary, runProductionRollingResearch } from "../../rollingResearch.js";

export const handlers = {
  get_engineering_access_state,
  operator_status,
  get_paper_account,
  execute_paper_decision,
  get_baseline_bench,
  run_baseline_bench,
  get_hostile_judge,
  run_hostile_judge,
  get_strategy_factory,
  run_strategy_factory,
  get_champion_selection,
  run_champion_selection,
  get_forward_operation,
  run_forward_operation,
  get_live_qualification,
  run_live_qualification,
  get_rolling_research,
  run_rolling_research,
  read_continuation,
  write_continuation,
  inspect_repository,
  list_repo_files,
  read_repo_file,
  apply_repo_patch_set,
  create_repo_file,
  delete_repo_file,
  run_validation: runValidation,
  list_github_actions_runs,
  trigger_github_workflow,
  monitor_github_workflow,
  deploy_cloudflare_worker,
  apply_d1_migrations,
  validate_production_sha,
};

async function get_engineering_access_state(inputs, context) {
  const config = githubConfig(context.env);
  return {
    ok: true,
    github: {
      owner: config.owner,
      repo: config.repo,
      branch: config.branch,
      token_configured: config.tokenConfigured,
      allowed_workflows: ["ci.yml", config.deployWorkflowId],
    },
    cloudflare: {
      deployment_workflow: config.deployWorkflowId,
      credentials_location: "github_actions_secrets",
      direct_cloudflare_api_passthrough: false,
    },
    repository_controls: {
      allowed_paths: allowedRepoPaths,
      allowed_directories: allowedRepoDirectories,
      exact_patch_required: true,
      arbitrary_shell_allowed: false,
      arbitrary_sql_allowed: false,
    },
  };
}

async function operator_status(inputs, context) {
  const dbProbe = await context.databaseProbe(context.env);
  return {
    ok: true,
    authenticated_mcp: true,
    deployment_sha: context.env.DEPLOYMENT_SHA || "unknown",
    database_connected: dbProbe.connected,
    exposed_tool_count: 3,
    supported_intents: supportedIntents,
    capability_count: capabilityDirectory.length,
  };
}

async function get_paper_account(inputs, context) {
  const account = await getPaperAccountSummary(context.env);
  return {
    ok: Boolean(account),
    paper_only: true,
    live_capital_enabled: false,
    account,
  };
}

async function execute_paper_decision(inputs, context) {
  try {
    return await executePaperDecision(context.env, inputs.decision);
  } catch (error) {
    return {
      ok: false,
      paper_only: true,
      live_capital_enabled: false,
      status: "paper_decision_failed",
      error: error instanceof Error ? error.message : "paper_decision_failed",
    };
  }
}

async function get_baseline_bench(inputs, context) {
  const bench = await getBaselineBenchSummary(context.env);
  return {
    ok: Boolean(bench),
    historical_paper_research: true,
    live_capital_enabled: false,
    bench,
  };
}

async function run_baseline_bench(inputs, context) {
  try {
    return await runProductionBaselineBench(context.env);
  } catch (error) {
    return {
      ok: false,
      historical_paper_research: true,
      live_capital_enabled: false,
      status: "baseline_bench_failed",
      error: error instanceof Error ? error.message : "baseline_bench_failed",
    };
  }
}

async function get_hostile_judge(inputs, context) {
  const judge = await getHostileJudgeSummary(context.env);
  return {
    ok: Boolean(judge),
    historical_paper_research: true,
    promotion_performed: false,
    live_capital_enabled: false,
    judge,
  };
}

async function run_hostile_judge(inputs, context) {
  try {
    return await runProductionHostileJudge(context.env);
  } catch (error) {
    return {
      ok: false,
      promotion_performed: false,
      live_capital_enabled: false,
      status: "hostile_judge_failed",
      error: error instanceof Error ? error.message : "hostile_judge_failed",
    };
  }
}

async function get_strategy_factory(inputs, context) {
  const factory = await getStrategyFactorySummary(context.env);
  return {
    ok: Boolean(factory),
    historical_paper_research: true,
    adaptive_tuning_allowed: false,
    promotion_performed: false,
    live_capital_enabled: false,
    factory,
  };
}

async function run_strategy_factory(inputs, context) {
  try {
    return await runProductionStrategyFactory(context.env);
  } catch (error) {
    return {
      ok: false,
      adaptive_tuning_allowed: false,
      promotion_performed: false,
      live_capital_enabled: false,
      status: "strategy_factory_failed",
      error: error instanceof Error ? error.message : "strategy_factory_failed",
    };
  }
}

async function get_champion_selection(inputs, context) {
  const selection = await getChampionSelectionSummary(context.env);
  return {
    ok: Boolean(selection),
    paper_execution_started: false,
    scheduling_started: false,
    live_capital_enabled: false,
    selection,
  };
}

async function run_champion_selection(inputs, context) {
  try {
    return await runProductionChampionSelection(context.env);
  } catch (error) {
    return {
      ok: false,
      paper_execution_started: false,
      scheduling_started: false,
      live_capital_enabled: false,
      status: "champion_selection_failed",
      error: error instanceof Error ? error.message : "champion_selection_failed",
    };
  }
}

async function get_forward_operation(inputs, context) {
  const forward = await getForwardOperationSummary(context.env);
  return {
    ok: Boolean(forward),
    paper_only: true,
    live_capital_enabled: false,
    forward,
  };
}

async function run_forward_operation(inputs, context) {
  try {
    return await runProductionForwardPaperCycle(context.env);
  } catch (error) {
    return {
      ok: false,
      paper_only: true,
      live_capital_enabled: false,
      status: "forward_operation_failed",
      error: error instanceof Error ? error.message : "forward_operation_failed",
    };
  }
}

async function get_live_qualification(inputs, context) {
  const qualification = await getLiveQualificationSummary(context.env);
  return {
    ok: Boolean(qualification),
    evidence_only: true,
    owner_approval_required: true,
    owner_approval_present: false,
    live_capital_enabled: false,
    live_authorized: false,
    qualification,
  };
}

async function run_live_qualification(inputs, context) {
  try {
    return await runProductionLiveQualification(context.env);
  } catch (error) {
    return {
      ok: false,
      evidence_only: true,
      owner_approval_required: true,
      owner_approval_present: false,
      live_capital_enabled: false,
      live_authorized: false,
      status: "live_qualification_failed",
      error: error instanceof Error ? error.message : "live_qualification_failed",
    };
  }
}

async function get_rolling_research(inputs, context) {
  const rolling = await getRollingResearchSummary(context.env);
  return {
    ok: true,
    paper_only: true,
    live_capital_enabled: false,
    rolling,
  };
}

async function run_rolling_research(inputs, context) {
  try {
    return await runProductionRollingResearch(context.env);
  } catch (error) {
    return {
      ok: false,
      paper_only: true,
      live_capital_enabled: false,
      status: "rolling_research_failed",
      error: error instanceof Error ? error.message : "rolling_research_failed",
    };
  }
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
  const ref = await githubRequest(context.env, repoApiPath(context.env, `/git/ref/heads/${encodeURIComponent(config.branch)}`));
  return {
    ok: true,
    owner: config.owner,
    repo: config.repo,
    branch: config.branch,
    latest_sha: context.env.REPOSITORY_SHA || "unknown",
    deployment_sha: context.env.DEPLOYMENT_SHA || "unknown",
    github_token_configured: config.tokenConfigured,
    github_remote_reachable: remote.ok,
    head_sha: ref.ok ? ref.body.object.sha : null,
    default_branch: remote.ok ? remote.body.default_branch : config.branch,
    visibility: remote.ok ? remote.body.visibility : "unknown",
    dirty_state_available: false,
  };
}

async function list_repo_files(inputs, context) {
  const path = inputs.path || "";
  if (path && !isAllowedRepoPath(path)) {
    return { ok: false, status: "forbidden_path" };
  }
  const remote = await readRepoContent(context.env, path, inputs.ref || githubConfig(context.env).branch);
  if (!remote.ok) {
    return { ok: false, status: remote.status || "github_contents_lookup_failed", status_code: remote.status_code, config: remote.config };
  }
  const entries = Array.isArray(remote.body) ? remote.body : [];
  return {
    ok: true,
    path,
    entries: entries
      .filter((entry) => isAllowedRepoPath(entry.path))
      .slice(0, 100)
      .map((entry) => ({
        path: entry.path,
        type: entry.type,
        size: entry.size,
        sha: entry.sha,
      })),
    truncated: entries.length > 100,
  };
}

async function read_repo_file(inputs, context) {
  assertAllowedRepoPath(inputs.path);
  const remote = await readRepoContent(context.env, inputs.path, inputs.ref || githubConfig(context.env).branch);
  const content = remote.ok && !Array.isArray(remote.body) ? remote.body.decoded_content : repoSnapshots[inputs.path] || "";
  const lines = content.split(/\r?\n/);
  const start = Math.max(1, Number(inputs.start_line || 1));
  const max = Math.min(120, Math.max(1, Number(inputs.max_lines || 80)));
  return {
    ok: true,
    path: inputs.path,
    allowed_path: allowedRepoPaths.includes(inputs.path),
    source: remote.ok ? "github" : "bundled_snapshot",
    sha: remote.ok && !Array.isArray(remote.body) ? remote.body.sha : null,
    start_line: start,
    returned_lines: lines.slice(start - 1, start - 1 + max),
    total_lines: lines.length,
    truncated: start - 1 + max < lines.length,
  };
}

async function apply_repo_patch_set(inputs, context) {
  const replacements = inputs.replacements || [];
  if (!Array.isArray(replacements) || replacements.length < 1 || replacements.length > 20) {
    return { ok: false, status: "invalid_replacement_count" };
  }
  const grouped = new Map();
  for (const replacement of replacements) {
    if (!isAllowedRepoPath(replacement.path)) {
      return { ok: false, status: "forbidden_path", path: replacement.path };
    }
    if (typeof replacement.find !== "string" || replacement.find.length < 1 || replacement.find.length > 12000
      || typeof replacement.replace !== "string" || replacement.replace.length > 12000) {
      return { ok: false, status: "invalid_replacement_shape", path: replacement.path };
    }
    grouped.set(replacement.path, [...(grouped.get(replacement.path) || []), replacement]);
  }
  if (grouped.size > 12) {
    return { ok: false, status: "too_many_files" };
  }

  const changes = [];
  const summaries = [];
  for (const [path, pathReplacements] of grouped.entries()) {
    const remote = await readRepoContent(context.env, path, githubConfig(context.env).branch);
    if (!remote.ok || Array.isArray(remote.body)) {
      return { ok: false, status: remote.status || "github_file_read_failed", status_code: remote.status_code, path, config: remote.config };
    }
    let content = remote.body.decoded_content;
    for (const replacement of pathReplacements) {
      const count = countOccurrences(content, replacement.find);
      if (count !== 1) {
        return { ok: false, status: "exact_match_count_not_one", path, count };
      }
      content = content.replace(replacement.find, replacement.replace);
    }
    changes.push({ type: "upsert", path, content });
    summaries.push({ path, replacements: pathReplacements.length });
  }

  if (inputs.dry_run === true) {
    return { ok: true, status: "dry_run_passed", changed_files: summaries };
  }

  const commit = await commitRepoChanges(context.env, {
    message: inputs.commit_message || "Apply bounded Quant Lab operator patch",
    changes,
    expectedHeadSha: inputs.expected_head_sha,
  });
  if (!commit.ok) {
    return commit;
  }
  return {
    ok: true,
    status: "patch_committed",
    commit_sha: commit.commit_sha,
    previous_head_sha: commit.previous_head_sha,
    changed_files: summaries,
  };
}

async function create_repo_file(inputs, context) {
  if (!isAllowedRepoPath(inputs.path)) {
    return { ok: false, status: "forbidden_path", path: inputs.path };
  }
  if (typeof inputs.content !== "string" || inputs.content.length > 50000) {
    return { ok: false, status: "invalid_content" };
  }
  const existing = await readRepoContent(context.env, inputs.path, githubConfig(context.env).branch);
  if (existing.ok) {
    return { ok: false, status: "file_already_exists", path: inputs.path };
  }
  const commit = await commitRepoChanges(context.env, {
    message: inputs.commit_message || `Create ${inputs.path}`,
    changes: [{ type: "upsert", path: inputs.path, content: inputs.content }],
    expectedHeadSha: inputs.expected_head_sha,
  });
  if (!commit.ok) {
    return commit;
  }
  return { ok: true, status: "file_created", path: inputs.path, commit_sha: commit.commit_sha };
}

async function delete_repo_file(inputs, context) {
  if (!isAllowedRepoPath(inputs.path)) {
    return { ok: false, status: "forbidden_path", path: inputs.path };
  }
  const existing = await readRepoContent(context.env, inputs.path, githubConfig(context.env).branch);
  if (!existing.ok || Array.isArray(existing.body)) {
    return { ok: false, status: existing.status || "file_not_found", path: inputs.path, status_code: existing.status_code };
  }
  const commit = await commitRepoChanges(context.env, {
    message: inputs.commit_message || `Delete ${inputs.path}`,
    changes: [{ type: "delete", path: inputs.path }],
    expectedHeadSha: inputs.expected_head_sha,
  });
  if (!commit.ok) {
    return commit;
  }
  return { ok: true, status: "file_deleted", path: inputs.path, commit_sha: commit.commit_sha };
}

export async function runValidation(inputs, context) {
  if (inputs.validation === "production rolling research commission") {
    try {
      const rolling = await runProductionRollingResearch(context.env);
      return {
        ok: rolling.ok,
        validation: inputs.validation,
        status: rolling.ok ? "passed" : "failed",
        rolling_research_commission: rolling,
      };
    } catch (error) {
      return {
        ok: false,
        validation: inputs.validation,
        status: "production_rolling_research_commission_failed",
        error: error instanceof Error ? error.message : "rolling_research_commission_failed",
      };
    }
  }
  if (inputs.validation === "production live qualification commission") {
    try {
      const qualification = await runProductionLiveQualification(context.env);
      return {
        ok: qualification.ok,
        validation: inputs.validation,
        status: qualification.ok ? "passed" : "failed",
        live_qualification_commission: qualification,
      };
    } catch (error) {
      return {
        ok: false,
        validation: inputs.validation,
        status: "production_live_qualification_commission_failed",
        error: error instanceof Error ? error.message : "live_qualification_commission_failed",
      };
    }
  }
  if (inputs.validation === "production forward paper commission") {
    try {
      const forward = await commissionForwardPaperOperation(context.env);
      return {
        ok: forward.ok,
        validation: inputs.validation,
        status: forward.ok ? "passed" : "failed",
        forward_paper_commission: forward,
      };
    } catch (error) {
      return {
        ok: false,
        validation: inputs.validation,
        status: "production_forward_paper_commission_failed",
        error: error instanceof Error ? error.message : "forward_paper_commission_failed",
      };
    }
  }
  if (inputs.validation === "production champion selection commission") {
    try {
      const selection = await runProductionChampionSelection(context.env);
      return {
        ok: selection.ok,
        validation: inputs.validation,
        status: selection.ok ? "passed" : "failed",
        champion_selection_commission: selection,
      };
    } catch (error) {
      return {
        ok: false,
        validation: inputs.validation,
        status: "production_champion_selection_commission_failed",
        error: error instanceof Error ? error.message : "champion_selection_commission_failed",
      };
    }
  }
  if (inputs.validation === "production strategy factory commission") {
    try {
      const factory = await runProductionStrategyFactory(context.env);
      return {
        ok: factory.ok,
        validation: inputs.validation,
        status: factory.ok ? "passed" : "failed",
        strategy_factory_commission: factory,
      };
    } catch (error) {
      return {
        ok: false,
        validation: inputs.validation,
        status: "production_strategy_factory_commission_failed",
        error: error instanceof Error ? error.message : "strategy_factory_commission_failed",
      };
    }
  }
  if (inputs.validation === "production hostile judge commission") {
    try {
      const judge = await runProductionHostileJudge(context.env);
      return {
        ok: judge.ok,
        validation: inputs.validation,
        status: judge.ok ? "passed" : "failed",
        hostile_judge_commission: judge,
      };
    } catch (error) {
      return {
        ok: false,
        validation: inputs.validation,
        status: "production_hostile_judge_commission_failed",
        error: error instanceof Error ? error.message : "hostile_judge_commission_failed",
      };
    }
  }
  if (inputs.validation === "production baseline bench commission") {
    try {
      const bench = await runProductionBaselineBench(context.env);
      return {
        ok: bench.ok,
        validation: inputs.validation,
        status: bench.ok ? "passed" : "failed",
        baseline_bench_commission: bench,
      };
    } catch (error) {
      return {
        ok: false,
        validation: inputs.validation,
        status: "production_baseline_bench_commission_failed",
        error: error instanceof Error ? error.message : "baseline_bench_commission_failed",
      };
    }
  }
  if (inputs.validation === "production paper ledger commission") {
    try {
      const commission = await commissionPaperLedger(context.env);
      return {
        ok: commission.ok,
        validation: inputs.validation,
        status: commission.ok ? "passed" : commission.status,
        paper_ledger_commission: commission,
      };
    } catch (error) {
      return {
        ok: false,
        validation: inputs.validation,
        status: "production_paper_ledger_commission_failed",
        error: error instanceof Error ? error.message : "paper_ledger_commission_failed",
      };
    }
  }
  if (inputs.validation === "production market data commission") {
    try {
      const ingestion = await context.marketDataIngestion(context.env);
      return {
        ok: ingestion.ok,
        validation: inputs.validation,
        status: ingestion.ok ? "passed" : "failed",
        production_ingestion: {
          run_id: ingestion.run_id,
          requested_start_closed_at: ingestion.requested_start_closed_at,
          requested_end_closed_at: ingestion.requested_end_closed_at,
          fetched_count: ingestion.fetched_count,
          inserted_count: ingestion.inserted_count,
          duplicate_count: ingestion.duplicate_count,
          health: ingestion.health,
        },
      };
    } catch (error) {
      return {
        ok: false,
        validation: inputs.validation,
        status: "production_ingestion_failed",
        error: error instanceof Error ? error.message : "market_data_ingestion_failed",
      };
    }
  }
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

async function apply_d1_migrations(inputs, context) {
  if (!isExactSha(inputs.deploy_sha)) {
    return { ok: false, status: "invalid_exact_sha" };
  }
  const config = githubConfig(context.env);
  const workflowId = config.deployWorkflowId;
  const remote = await githubRequest(
    context.env,
    repoApiPath(context.env, `/actions/workflows/${encodeURIComponent(workflowId)}/dispatches`),
    { method: "POST", body: { ref: config.branch, inputs: { deploy_sha: inputs.deploy_sha, mode: "migrations" } } },
  );
  if (!remote.ok) {
    return { ok: false, status: remote.status || "github_migration_dispatch_failed", status_code: remote.status_code, config: remote.config };
  }
  return {
    ok: true,
    status: "migration_workflow_dispatched",
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
    steps: (job.steps || []).map((step) => ({
      number: step.number,
      name: step.name,
      status: step.status,
      conclusion: step.conclusion,
    })),
  };
}

function countOccurrences(content, needle) {
  let count = 0;
  let index = 0;
  while (true) {
    const next = content.indexOf(needle, index);
    if (next === -1) {
      return count;
    }
    count += 1;
    index = next + needle.length;
  }
}
