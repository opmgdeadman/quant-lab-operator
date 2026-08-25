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
import { getDirectionalShadowSummary, runProductionDirectionalShadowCycle } from "../../directionalShadow.js";
import { getDirectionalInstitutionalResearchSummary, runProductionDirectionalInstitutionalResearch } from "../../directionalInstitutionalResearch.js";
import { getInstitutionalResearchPortfolioSummary, registerInstitutionalHypothesis, advanceInstitutionalHypothesis } from "../../institutionalResearchPortfolio.js";
import { getInstitutionalEvaluationSummary, runInstitutionalExecutionPolicyComparison, runInstitutionalHypothesisEvaluation, runInstitutionalIndependentJudge } from "../../institutionalResearchEvaluation.js";
import { getLiveQualificationSummary, runProductionLiveQualification } from "../../liveQualification.js";
import { getRollingResearchSummary, runProductionRollingResearch } from "../../rollingResearch.js";
import { getHistoricalBootstrapSummary, runProductionHistoricalBootstrap } from "../../historicalBootstrap.js";
import { getMarketVolumeAudit } from "../../marketData.js";
import { buildRevenueEngineStatus } from "../../autonomousRevenueEngine.js";
import { renderProfessionalConsole } from "../../professionalConsole.js";
import { syncQuantResumeCheckpoint } from "../fleetResume.js";
import { runQuantFailureIntelligenceCertification } from "../fleetFailureIntelligence.js";
import { runQuantTimingTelemetryCertification } from "../fleetTelemetry.js";

export const handlers = {
  get_engineering_access_state,
  operator_status,
  get_market_data_volume_audit,
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
  get_directional_shadow,
  run_directional_shadow,
  get_directional_institutional_research,
  run_directional_institutional_research,
  get_institutional_research_portfolio,
  register_institutional_hypothesis,
  advance_institutional_hypothesis,
  get_institutional_research_evaluation,
  compare_institutional_execution_policies,
  run_institutional_hypothesis_evaluation,
  run_institutional_independent_judge,
  get_live_qualification,
  run_live_qualification,
  get_rolling_research,
  run_rolling_research,
  get_historical_bootstrap,
  run_historical_bootstrap,
  get_hardening_status,
  advance_hardening_incident,
  run_failure_intelligence_certification,
  run_timing_telemetry_certification,
  checkpoint_quant_lab_resume,
  read_continuation,
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
  const [dbProbe, researchPortfolio, liveQualification] = await Promise.all([
    context.databaseProbe(context.env),
    getInstitutionalResearchPortfolioSummary(context.env),
    getLiveQualificationSummary(context.env),
  ]);
  return {
    ok: true,
    authenticated_mcp: true,
    deployment_sha: context.env.DEPLOYMENT_SHA || "unknown",
    database_connected: dbProbe.connected,
    exposed_tool_count: capabilityDirectory.length + 2,
    supported_intents: supportedIntents,
    capability_count: capabilityDirectory.length,
    revenue_engine: buildRevenueEngineStatus({ researchPortfolio, liveQualification }),
  };
}

async function get_market_data_volume_audit(inputs, context) {
  const audit = await getMarketVolumeAudit(context.env, 4320);
  return {
    ...audit,
    paper_only: true,
    live_capital_enabled: false,
  };
}

async function get_paper_account(inputs, context) {
  const forward = await getForwardOperationSummary(context.env);
  const account = forward?.paper_main || null;
  return {
    ok: Boolean(account),
    paper_only: true,
    live_capital_enabled: false,
    authority_source: forward?.authority?.source || "directional_institutional_research",
    legacy_selection_authority: false,
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
  const [forward, directionalShadow] = await Promise.all([
    getForwardOperationSummary(context.env),
    getDirectionalShadowSummary(context.env),
  ]);
  return {
    ok: Boolean(forward) && Boolean(directionalShadow),
    paper_only: true,
    live_capital_enabled: false,
    max_gross_exposure_multiple: 1,
    forward,
    directional_shadow: directionalShadow,
  };
}

async function run_forward_operation(inputs, context) {
  try {
    const [forward, directionalShadow] = await Promise.all([
      runProductionForwardPaperCycle(context.env),
      runProductionDirectionalShadowCycle(context.env),
    ]);
    return {
      ok: Boolean(forward?.ok) && Boolean(directionalShadow?.ok),
      paper_only: true,
      live_capital_enabled: false,
      max_gross_exposure_multiple: 1,
      forward,
      directional_shadow: directionalShadow,
    };
  } catch (error) {
    return {
      ok: false,
      paper_only: true,
      live_capital_enabled: false,
      max_gross_exposure_multiple: 1,
      status: "forward_operation_failed",
      error: error instanceof Error ? error.message : "forward_operation_failed",
    };
  }
}

async function get_directional_shadow(inputs, context) {
  const shadow = await getDirectionalShadowSummary(context.env);
  return {
    ok: Boolean(shadow),
    paper_only: true,
    live_capital_enabled: false,
    max_entry_gross_exposure_multiple: 1,
    shadow,
  };
}

async function run_directional_shadow(inputs, context) {
  try {
    return await runProductionDirectionalShadowCycle(context.env);
  } catch (error) {
    return {
      ok: false,
      paper_only: true,
      live_capital_enabled: false,
      max_entry_gross_exposure_multiple: 1,
      status: "directional_shadow_failed",
      error: error instanceof Error ? error.message : "directional_shadow_failed",
    };
  }
}

async function get_directional_institutional_research(inputs, context) {
  const research = await getDirectionalInstitutionalResearchSummary(context.env);
  return {
    ok: Boolean(research),
    paper_only: true,
    live_capital_enabled: false,
    research,
  };
}

async function run_directional_institutional_research(inputs, context) {
  try {
    return await runProductionDirectionalInstitutionalResearch(context.env);
  } catch (error) {
    return {
      ok: false,
      paper_only: true,
      live_capital_enabled: false,
      status: "directional_institutional_research_failed",
      error: error instanceof Error ? error.message : "directional_institutional_research_failed",
    };
  }
}

async function get_institutional_research_portfolio(inputs, context) {
  return await getInstitutionalResearchPortfolioSummary(context.env);
}

async function register_institutional_hypothesis(inputs, context) {
  try {
    return await registerInstitutionalHypothesis(context.env, inputs.hypothesis);
  } catch (error) {
    return {
      ok: false,
      paper_only: true,
      live_capital_enabled: false,
      stage13_promotion_authority_unchanged: true,
      status: "institutional_hypothesis_registration_failed",
      error: error instanceof Error ? error.message : "institutional_hypothesis_registration_failed",
    };
  }
}

async function advance_institutional_hypothesis(inputs, context) {
  try {
    return await advanceInstitutionalHypothesis(context.env, inputs);
  } catch (error) {
    return {
      ok: false,
      paper_only: true,
      live_capital_enabled: false,
      stage13_promotion_authority_unchanged: true,
      status: "institutional_hypothesis_lifecycle_failed",
      error: error instanceof Error ? error.message : "institutional_hypothesis_lifecycle_failed",
    };
  }
}

async function get_institutional_research_evaluation(inputs, context) {
  return await getInstitutionalEvaluationSummary(context.env, inputs.hypothesis_id || null);
}

async function compare_institutional_execution_policies(inputs, context) {
  return await runInstitutionalExecutionPolicyComparison(context.env);
}

async function run_institutional_hypothesis_evaluation(inputs, context) {
  try {
    return await runInstitutionalHypothesisEvaluation(context.env, { hypothesisId: inputs.hypothesis_id });
  } catch (error) {
    return {
      ok: false,
      paper_only: true,
      live_capital_enabled: false,
      stage13_promotion_authority_changed: false,
      status: "institutional_hypothesis_evaluation_failed",
      error: error instanceof Error ? error.message : "institutional_hypothesis_evaluation_failed",
    };
  }
}

async function run_institutional_independent_judge(inputs, context) {
  try {
    return await runInstitutionalIndependentJudge(context.env, { hypothesisId: inputs.hypothesis_id });
  } catch (error) {
    return {
      ok: false,
      paper_only: true,
      live_capital_enabled: false,
      stage13_promotion_authority_changed: false,
      status: "institutional_independent_judge_failed",
      error: error instanceof Error ? error.message : "institutional_independent_judge_failed",
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

async function get_historical_bootstrap(inputs, context) {
  const bootstrap = await getHistoricalBootstrapSummary(context.env);
  return {
    ok: true,
    paper_only: true,
    live_capital_enabled: false,
    bootstrap,
  };
}

async function run_historical_bootstrap(inputs, context) {
  try {
    return await runProductionHistoricalBootstrap(context.env);
  } catch (error) {
    return {
      ok: false,
      paper_only: true,
      live_capital_enabled: false,
      research_artifacts_created: false,
      status: "historical_bootstrap_failed",
      error: error instanceof Error ? error.message : "historical_bootstrap_failed",
    };
  }
}

const HARDENING_STATES = ["open", "diagnosed", "fixed", "validated", "deployed", "verified", "closed"];

export function validateHardeningTransition(row, inputs) {
  const currentIndex = HARDENING_STATES.indexOf(row?.state);
  const targetIndex = HARDENING_STATES.indexOf(inputs?.target_state);
  if (currentIndex < 0 || targetIndex !== currentIndex + 1) {
    return { ok: false, error: "hardening_transition_out_of_order" };
  }
  const target = inputs.target_state;
  if (target === "diagnosed" && (!inputs.root_cause || !inputs.generalized_cause)) {
    return { ok: false, error: "hardening_diagnosis_evidence_required" };
  }
  if (target === "fixed" && !inputs.prevention_rule_id) {
    return { ok: false, error: "hardening_prevention_rule_required" };
  }
  if (target === "validated" && (!isExactSha(inputs.tested_sha) || !Array.isArray(inputs.regression_test_ids) || inputs.regression_test_ids.length < 1)) {
    return { ok: false, error: "hardening_validation_evidence_required" };
  }
  if (target === "deployed" && !inputs.deployment_id) {
    return { ok: false, error: "hardening_deployment_evidence_required" };
  }
  if (target === "verified" && !inputs.live_verification_summary) {
    return { ok: false, error: "hardening_live_verification_required" };
  }
  if (target === "closed" && !inputs.resume_result_summary) {
    return { ok: false, error: "hardening_resume_result_required" };
  }
  return { ok: true, error: null };
}

async function get_hardening_status(inputs, context) {
  const limit = Math.min(50, Math.max(1, Number(inputs.limit || 20)));
  const incidentId = inputs.incident_id || null;
  const rows = incidentId
    ? await context.env.DB.prepare("SELECT * FROM operator_hardening_incidents WHERE id = ? LIMIT 1").bind(incidentId).all()
    : await context.env.DB.prepare("SELECT * FROM operator_hardening_incidents ORDER BY CASE WHEN state = 'closed' THEN 1 ELSE 0 END, updated_at DESC LIMIT ?").bind(limit).all();
  const incidents = (rows.results || []).map(serializeHardeningIncident);
  const events = incidentId
    ? await context.env.DB.prepare("SELECT id, incident_id, from_state, to_state, evidence_json, created_at FROM operator_hardening_incident_events WHERE incident_id = ? ORDER BY created_at ASC").bind(incidentId).all()
    : { results: [] };
  return {
    ok: true,
    incidents,
    events: (events.results || []).map((event) => ({
      ...event,
      evidence: JSON.parse(event.evidence_json || "{}"),
      evidence_json: undefined,
    })),
    open_count: incidents.filter((incident) => incident.state !== "closed").length,
  };
}

async function advance_hardening_incident(inputs, context) {
  const row = await context.env.DB.prepare("SELECT * FROM operator_hardening_incidents WHERE id = ? LIMIT 1").bind(inputs.incident_id).first();
  if (!row) return { ok: false, error: "hardening_incident_not_found" };
  const validation = validateHardeningTransition(row, inputs);
  if (!validation.ok) return validation;
  const now = new Date().toISOString();
  const evidence = {
    root_cause: inputs.root_cause || null,
    generalized_cause: inputs.generalized_cause || null,
    prevention_rule_id: inputs.prevention_rule_id || null,
    regression_test_ids: inputs.regression_test_ids || [],
    tested_sha: inputs.tested_sha || null,
    deployment_id: inputs.deployment_id || null,
    live_verification_summary: inputs.live_verification_summary || null,
    resume_result_summary: inputs.resume_result_summary || null,
  };
  const transition = await context.env.DB.prepare(
    `UPDATE operator_hardening_incidents SET
      state = ?,
      root_cause = COALESCE(?, root_cause),
      generalized_cause = COALESCE(?, generalized_cause),
      prevention_rule_id = COALESCE(?, prevention_rule_id),
      regression_test_ids_json = CASE WHEN ? IS NULL THEN regression_test_ids_json ELSE ? END,
      tested_sha = COALESCE(?, tested_sha),
      deployment_id = COALESCE(?, deployment_id),
      live_verification_json = CASE WHEN ? IS NULL THEN live_verification_json ELSE ? END,
      resume_result_json = CASE WHEN ? IS NULL THEN resume_result_json ELSE ? END,
      updated_at = ?,
      closed_at = CASE WHEN ? = 'closed' THEN ? ELSE closed_at END
     WHERE id = ? AND state = ?`,
  ).bind(
    inputs.target_state,
    inputs.root_cause || null,
    inputs.generalized_cause || null,
    inputs.prevention_rule_id || null,
    inputs.regression_test_ids ? JSON.stringify(inputs.regression_test_ids) : null,
    JSON.stringify(inputs.regression_test_ids || []),
    inputs.tested_sha || null,
    inputs.deployment_id || null,
    inputs.live_verification_summary || null,
    JSON.stringify(inputs.live_verification_summary ? { summary: inputs.live_verification_summary } : {}),
    inputs.resume_result_summary || null,
    JSON.stringify(inputs.resume_result_summary ? { summary: inputs.resume_result_summary } : {}),
    now,
    inputs.target_state,
    now,
    inputs.incident_id,
    row.state,
  ).run();
  if (Number(transition.meta?.changes || 0) !== 1) {
    return { ok: false, error: "hardening_transition_race" };
  }
  await context.env.DB.prepare(
    `INSERT INTO operator_hardening_incident_events (
      id, incident_id, from_state, to_state, evidence_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(
    `operator_hardening_event_${crypto.randomUUID()}`,
    inputs.incident_id,
    row.state,
    inputs.target_state,
    JSON.stringify(evidence),
    now,
  ).run();
  const updated = await context.env.DB.prepare("SELECT * FROM operator_hardening_incidents WHERE id = ? LIMIT 1").bind(inputs.incident_id).first();
  return { ok: true, incident: serializeHardeningIncident(updated) };
}

function serializeHardeningIncident(row) {
  return {
    id: row.id,
    signature: row.signature,
    operation_id: row.operation_id,
    intent: row.intent,
    severity: row.severity,
    state: row.state,
    summary: row.summary,
    observed: JSON.parse(row.observed_json || "{}"),
    root_cause: row.root_cause || null,
    generalized_cause: row.generalized_cause || null,
    prevention_rule_id: row.prevention_rule_id || null,
    regression_test_ids: JSON.parse(row.regression_test_ids_json || "[]"),
    tested_sha: row.tested_sha || null,
    deployment_id: row.deployment_id || null,
    live_verification: JSON.parse(row.live_verification_json || "{}"),
    resume_capsule: JSON.parse(row.resume_capsule_json || "{}"),
    resume_result: JSON.parse(row.resume_result_json || "{}"),
    created_at: row.created_at,
    updated_at: row.updated_at,
    closed_at: row.closed_at || null,
  };
}

async function run_failure_intelligence_certification(inputs, context) {
  const certification = await runQuantFailureIntelligenceCertification(context.env, inputs.run_id);
  return {
    ...certification,
    paper_only: true,
    live_capital_enabled: false,
    mbrain_operational_authority_unchanged: true,
  };
}

async function run_timing_telemetry_certification(inputs, context) {
  const certification = await runQuantTimingTelemetryCertification(context.env, inputs.run_id);
  return {
    ...certification,
    paper_only: true,
    live_capital_enabled: false,
    mbrain_operational_authority_unchanged: true,
  };
}

async function checkpoint_quant_lab_resume(inputs, context) {
  const checkpoint = await syncQuantResumeCheckpoint(context.env, inputs);
  return {
    ok: checkpoint?.ok === true,
    ...checkpoint,
    paper_only: true,
    live_capital_enabled: false,
  };
}

async function read_continuation(inputs, context) {
  return {
    ok: true,
    state: "external_authority",
    authority: "m_brain_owner_approved_work_unit",
    required_router: "M-BRAIN_Gateway.routeTurn",
    work_unit_binding_required: true,
    live_continuation_local: false,
    git_continuation_authoritative: false,
    d1_continuation_authoritative: false,
  };
  const continuation = context.startupContext?.canonical_continuation || null;
  if (!continuation?.ok || !continuation.sha || !continuation.content) {
    return {
      ok: false,
      state: "unavailable",
      error: "canonical_git_continuation_unavailable",
      authority: "sole_canonical_git_engineering_continuation_ledger",
    };
  }
  const lines = continuation.content.split(/\r?\n/);
  const jobLine = lines.find((line) => line.trim().startsWith("Job ID:")) || "";
  const rawJobId = jobLine.slice(jobLine.indexOf(":") + 1).trim();
  const activeJobId = rawJobId.replace(/^`|`$/g, "") || null;
  const currentActionHeading = lines.findIndex((line) => line.trim() === "## Current Action");
  const currentAction = currentActionHeading >= 0
    ? lines.slice(currentActionHeading + 1).map((line) => line.trim()).find(Boolean) || null
    : null;
  return {
    ok: true,
    state: activeJobId ? "active" : "completed",
    authority: "sole_canonical_git_engineering_continuation_ledger",
    path: continuation.path,
    sha: continuation.sha,
    active_job_id: activeJobId,
    current_action: currentAction,
    d1_continuation_authoritative: false,
    mutation_intent: "apply_repo_patch_set",
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
  if (inputs.validation === "production professional console contract") {
    try {
      const candleRows = await context.env.DB.prepare(
        `SELECT closed_at, open, high, low, close, volume, source
         FROM market_candles
         WHERE pair = ? AND interval = ?
         ORDER BY closed_at DESC
         LIMIT 96`,
      ).bind("BTC-USD", "1h").all();
      const candles = (candleRows.results || []).reverse().map((row) => ({
        closed_at: row.closed_at,
        open: Number(row.open),
        high: Number(row.high),
        low: Number(row.low),
        close: Number(row.close),
        volume: Number(row.volume),
        source: row.source,
      }));
      const latest = candles.at(-1) || null;
      const [paperAccount, baselineBench, hostileJudge, strategyFactory, championSelection, forwardOperation, liveQualification, rollingResearch, historicalBootstrap, institutionalResearchPortfolio] = await Promise.all([
        getPaperAccountSummary(context.env),
        getBaselineBenchSummary(context.env),
        getHostileJudgeSummary(context.env),
        getStrategyFactorySummary(context.env),
        getChampionSelectionSummary(context.env),
        getForwardOperationSummary(context.env),
        getLiveQualificationSummary(context.env),
        getRollingResearchSummary(context.env),
        getHistoricalBootstrapSummary(context.env),
        getInstitutionalResearchPortfolioSummary(context.env),
      ]);
      const html = renderProfessionalConsole({
        environment: context.env.ENVIRONMENT || "unknown",
        currentPhase: context.env.CURRENT_PHASE || "unknown",
        deploymentSha: context.env.DEPLOYMENT_SHA || "unknown",
        latest,
        candles,
        health: await context.env.DB.prepare(
          `SELECT provider, status, latest_closed_at, expected_latest_closed_at, stale_hours,
                  missing_candles, last_success_at, last_error
           FROM market_data_health WHERE id = ?`,
        ).bind("BTC-USD:1h").first(),
        paperAccount,
        baselineBench,
        hostileJudge,
        strategyFactory,
        championSelection,
        forwardOperation,
        liveQualification,
        rollingResearch,
        historicalBootstrap,
        institutionalResearchPortfolio,
      });
      const checks = {
        professional_title: html.includes("Autonomous Research Console"),
        tradingview_chart: html.includes("embed-widget-advanced-chart.js"),
        first_party_fallback: html.includes("Stored BTC-USD hourly candlestick chart"),
        responsive_breakpoints: html.includes("@media(max-width:620px)"),
        strategy_table: html.includes("Controlled strategy factory") && html.includes("<table>"),
        expandable_evidence: html.includes("<details>"),
        paper_only_boundary: html.includes("PAPER ONLY") && html.includes("Live orders disabled"),
        legacy_definition_grid_removed: !html.includes("<dl>") && !html.includes("max-width: 760px"),
        runtime_data_escaped: !html.includes("<img src=x onerror="),
        stage14_research_portfolio: html.includes("Institutional research portfolio") && html.includes("No Stage 14 hypotheses are registered yet"),
        stage14_qualification_boundary: html.includes("Qualification remains disabled until independent judge integration") && html.includes("Stage 13 remains the sole production promotion authority"),
      };
      const passed = Object.values(checks).every(Boolean);
      return {
        ok: passed,
        validation: inputs.validation,
        status: passed ? "passed" : "failed",
        checks,
        rendered_bytes: new TextEncoder().encode(html).length,
        candle_count: candles.length,
        candidate_count: strategyFactory?.candidate_count || 0,
        deployment_sha: context.env.DEPLOYMENT_SHA || "unknown",
        live_capital_enabled: false,
      };
    } catch (error) {
      return {
        ok: false,
        validation: inputs.validation,
        status: "production_professional_console_contract_failed",
        error: error instanceof Error ? error.message : "professional_console_contract_failed",
      };
    }
  }
  if (inputs.validation === "production directional institutional research commission") {
    try {
      const research = await runProductionDirectionalInstitutionalResearch(context.env);
      return {
        ok: research.ok,
        validation: inputs.validation,
        status: research.ok ? "passed" : "failed",
        directional_institutional_research_commission: research,
      };
    } catch (error) {
      return {
        ok: false,
        validation: inputs.validation,
        status: "production_directional_institutional_research_commission_failed",
        error: error instanceof Error ? error.message : "directional_institutional_research_commission_failed",
      };
    }
  }
  if (inputs.validation === "production historical bootstrap commission") {
    try {
      const bootstrap = await runProductionHistoricalBootstrap(context.env);
      return {
        ok: bootstrap.ok,
        validation: inputs.validation,
        status: bootstrap.ok ? "passed" : "failed",
        historical_bootstrap_commission: bootstrap,
      };
    } catch (error) {
      return {
        ok: false,
        validation: inputs.validation,
        status: "production_historical_bootstrap_commission_failed",
        error: error instanceof Error ? error.message : "historical_bootstrap_commission_failed",
      };
    }
  }
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
  if (isExactSha(ref)) {
    return { ok: false, status: "workflow_dispatch_ref_must_be_branch_or_tag" };
  }
  const workflowInputs = {};
  let expectedHeadSha;
  if (inputs.deploy_sha) {
    if (!isExactSha(inputs.deploy_sha)) {
      return { ok: false, status: "invalid_exact_sha" };
    }
    if (inputs.workflow_id === "ci.yml") {
      const refHeadSha = await resolveGitRefSha(context.env, ref);
      if (refHeadSha !== inputs.deploy_sha) {
        return { ok: false, status: "workflow_dispatch_ref_sha_mismatch", ref, expected_sha: inputs.deploy_sha, ref_sha: refHeadSha };
      }
      expectedHeadSha = inputs.deploy_sha;
    } else {
      workflowInputs.deploy_sha = inputs.deploy_sha;
      expectedHeadSha = inputs.deploy_sha;
    }
  } else {
    expectedHeadSha = await resolveGitRefSha(context.env, ref);
  }
  return reconcileWorkflowDispatch(context.env, {
    workflowId: inputs.workflow_id,
    ref,
    workflowInputs,
    expectedHeadSha,
    successStatus: "dispatched",
    failureStatus: "github_dispatch_failed",
  });
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
  return reconcileWorkflowDispatch(context.env, {
    workflowId,
    ref: config.branch,
    workflowInputs: { deploy_sha: inputs.deploy_sha },
    expectedHeadSha: inputs.deploy_sha,
    successStatus: "deployment_workflow_dispatched",
    failureStatus: "github_deploy_dispatch_failed",
  });
}

async function apply_d1_migrations(inputs, context) {
  if (!isExactSha(inputs.deploy_sha)) {
    return { ok: false, status: "invalid_exact_sha" };
  }
  const config = githubConfig(context.env);
  const workflowId = config.deployWorkflowId;
  return reconcileWorkflowDispatch(context.env, {
    workflowId,
    ref: config.branch,
    workflowInputs: { deploy_sha: inputs.deploy_sha, mode: "migrations" },
    expectedHeadSha: inputs.deploy_sha,
    successStatus: "migration_workflow_dispatched",
    failureStatus: "github_migration_dispatch_failed",
  });
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

async function resolveGitRefSha(env, ref) {
  if (isExactSha(ref)) return ref;
  const remote = await githubRequest(env, repoApiPath(env, `/commits/${encodeURIComponent(ref)}`));
  return remote.ok && isExactSha(remote.body?.sha) ? remote.body.sha : null;
}

export function findDispatchedRun(runs, expectedHeadSha, createdAfterMs) {
  return (Array.isArray(runs) ? runs : [])
    .filter((run) => run?.event === "workflow_dispatch")
    .filter((run) => !expectedHeadSha || run?.head_sha === expectedHeadSha)
    .filter((run) => Date.parse(run?.created_at || "") >= createdAfterMs)
    .sort((left, right) => Number(right.id || 0) - Number(left.id || 0))[0] || null;
}

async function reconcileWorkflowDispatch(env, input) {
  const startedAtMs = Date.now() - 5000;
  const remote = await githubRequest(
    env,
    repoApiPath(env, `/actions/workflows/${encodeURIComponent(input.workflowId)}/dispatches`),
    { method: "POST", body: { ref: input.ref, inputs: input.workflowInputs } },
  );
  let reconciledRun = null;
  for (let attempt = 0; attempt < 4 && !reconciledRun; attempt += 1) {
    const runs = await githubRequest(
      env,
      repoApiPath(env, `/actions/workflows/${encodeURIComponent(input.workflowId)}/runs?branch=${encodeURIComponent(input.ref)}&event=workflow_dispatch&per_page=20`),
    );
    if (runs.ok) reconciledRun = findDispatchedRun(runs.body?.workflow_runs, input.expectedHeadSha, startedAtMs);
    if (!reconciledRun && attempt < 3) await new Promise((resolve) => setTimeout(resolve, 750));
  }
  if (!remote.ok && !reconciledRun) {
    return { ok: false, status: remote.status || input.failureStatus, status_code: remote.status_code, config: remote.config };
  }
  return {
    ok: true,
    status: input.successStatus,
    workflow_id: input.workflowId,
    ref: input.ref,
    deploy_sha: input.workflowInputs.deploy_sha || null,
    inputs: Object.keys(input.workflowInputs),
    run_id: reconciledRun?.id || null,
    dispatch_reconciled: !remote.ok && Boolean(reconciledRun),
    dispatch_status_code: remote.status_code || 204,
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
