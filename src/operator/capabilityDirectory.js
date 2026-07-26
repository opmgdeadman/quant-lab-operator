import lifecycle from "./capabilityLifecycle.json" with { type: "json" };
import { allowedRepoPaths } from "./clientSafeRequests.js";
import { allowedWorkflowIds } from "./githubApi.js";
import { objectSchema } from "./schemas.js";

export const supportedIntents = [
  "operator_status",
  "read_continuation",
  "write_continuation",
  "inspect_repository",
  "read_repo_file",
  "run_validation",
  "list_github_actions_runs",
  "trigger_github_workflow",
  "monitor_github_workflow",
  "deploy_cloudflare_worker",
  "validate_production_sha",
];

export const capabilityDirectory = [
  capability({
    id: "operating.operator_status",
    intent: "operator_status",
    title: "Operator Status",
    operation_class: "read",
    handler_id: "operator_status",
    input_schema: objectSchema({}),
    output_schema: objectSchema({ ok: { type: "boolean" } }, ["ok"]),
    external_systems: ["d1"],
    risk_gates: ["auth_required", "session_required", "bounded_output"],
    tests: ["operator_status succeeds", "no response contains secret-looking values"],
  }),
  capability({
    id: "operating.continuation_read",
    intent: "read_continuation",
    title: "Read Continuation",
    operation_class: "read",
    handler_id: "read_continuation",
    input_schema: objectSchema({}),
    output_schema: objectSchema({ ok: { type: "boolean" } }, ["ok"]),
    external_systems: ["d1"],
    risk_gates: ["auth_required", "session_required"],
    tests: ["read_continuation returns idle when empty"],
  }),
  capability({
    id: "operating.continuation_write",
    intent: "write_continuation",
    title: "Write Continuation",
    operation_class: "mutation",
    handler_id: "write_continuation",
    input_schema: objectSchema({
      active_objective: { type: "string", maxLength: 500 },
      current_phase: { type: "string", maxLength: 120 },
      completed_evidence: { type: "array", maxItems: 20, items: { type: "string", maxLength: 200 } },
      next_action: { type: "string", maxLength: 300 },
    }, ["active_objective", "current_phase", "completed_evidence", "next_action"]),
    output_schema: objectSchema({ ok: { type: "boolean" } }, ["ok"]),
    external_systems: ["d1"],
    risk_gates: ["auth_required", "session_required", "idempotency_required", "bounded_output"],
    tests: ["write_continuation persists bounded state", "repeating same operation_id replays receipt"],
  }),
  capability({
    id: "engineering.repository_inspection",
    intent: "inspect_repository",
    title: "Inspect Repository",
    operation_class: "read",
    handler_id: "inspect_repository",
    input_schema: objectSchema({}),
    output_schema: objectSchema({ ok: { type: "boolean" } }, ["ok"]),
    external_systems: ["github_metadata_config"],
    risk_gates: ["auth_required", "session_required", "bounded_output"],
    tests: ["inspect_repository returns compact repo state"],
  }),
  capability({
    id: "engineering.repo_file_read",
    intent: "read_repo_file",
    title: "Read Repository File",
    operation_class: "read",
    handler_id: "read_repo_file",
    input_schema: objectSchema({
      path: { type: "string", enum: allowedRepoPaths },
      start_line: { type: "number", minimum: 1 },
      max_lines: { type: "number", minimum: 1, maximum: 120 },
    }, ["path"]),
    output_schema: objectSchema({ ok: { type: "boolean" } }, ["ok"]),
    allowed_paths: allowedRepoPaths,
    external_systems: ["bundled_repo_snapshot"],
    risk_gates: ["auth_required", "session_required", "path_allowlist", "bounded_output"],
    tests: ["read_repo_file only reads allowed paths", "forbidden path traversal rejects"],
  }),
  capability({
    id: "engineering.validation",
    intent: "run_validation",
    title: "Run Validation",
    operation_class: "mutation",
    handler_id: "run_validation",
    input_schema: objectSchema({
      validation: { type: "string", enum: ["npm test", "npm run check"] },
    }, ["validation"]),
    output_schema: objectSchema({ ok: { type: "boolean" } }, ["ok"]),
    allowed_actions: ["npm test", "npm run check"],
    external_systems: ["github_actions"],
    risk_gates: ["auth_required", "session_required", "idempotency_required", "no_arbitrary_shell"],
    tests: ["run_validation returns explicit not_available_in_worker_runtime", "repeating same operation_id replays receipt"],
  }),
  capability({
    id: "engineering.github_actions_runs_list",
    intent: "list_github_actions_runs",
    title: "List GitHub Actions Runs",
    operation_class: "read",
    handler_id: "list_github_actions_runs",
    input_schema: objectSchema({
      workflow_id: { type: "string", enum: allowedWorkflowIds },
      limit: { type: "number", minimum: 1, maximum: 20 },
    }, []),
    output_schema: objectSchema({ ok: { type: "boolean" } }, ["ok"]),
    allowed_actions: allowedWorkflowIds,
    external_systems: ["github_actions"],
    risk_gates: ["auth_required", "session_required", "github_token_server_side", "bounded_output"],
    tests: ["list_github_actions_runs returns compact run metadata", "missing GitHub token is reported without exposing secrets"],
  }),
  capability({
    id: "engineering.github_workflow_dispatch",
    intent: "trigger_github_workflow",
    title: "Trigger GitHub Workflow",
    operation_class: "mutation",
    handler_id: "trigger_github_workflow",
    input_schema: objectSchema({
      workflow_id: { type: "string", enum: allowedWorkflowIds },
      ref: { type: "string", maxLength: 80 },
      deploy_sha: { type: "string", maxLength: 40 },
    }, ["workflow_id"]),
    output_schema: objectSchema({ ok: { type: "boolean" } }, ["ok"]),
    allowed_actions: allowedWorkflowIds,
    external_systems: ["github_actions"],
    risk_gates: ["auth_required", "session_required", "idempotency_required", "workflow_allowlist", "no_arbitrary_shell"],
    tests: ["trigger_github_workflow dispatches only allowlisted workflows", "repeating same operation_id replays receipt"],
  }),
  capability({
    id: "engineering.github_workflow_monitor",
    intent: "monitor_github_workflow",
    title: "Monitor GitHub Workflow",
    operation_class: "read",
    handler_id: "monitor_github_workflow",
    input_schema: objectSchema({
      run_id: { type: "string", maxLength: 30 },
    }, ["run_id"]),
    output_schema: objectSchema({ ok: { type: "boolean" } }, ["ok"]),
    external_systems: ["github_actions"],
    risk_gates: ["auth_required", "session_required", "bounded_output"],
    tests: ["monitor_github_workflow returns compact run and job state"],
  }),
  capability({
    id: "deployment.cloudflare_worker_dispatch",
    intent: "deploy_cloudflare_worker",
    title: "Deploy Cloudflare Worker",
    operation_class: "mutation",
    handler_id: "deploy_cloudflare_worker",
    input_schema: objectSchema({
      deploy_sha: { type: "string", maxLength: 40 },
    }, ["deploy_sha"]),
    output_schema: objectSchema({ ok: { type: "boolean" } }, ["ok"]),
    allowed_actions: ["quant-lab-deploy.yml"],
    external_systems: ["github_actions", "cloudflare"],
    risk_gates: ["auth_required", "session_required", "idempotency_required", "exact_sha_required", "cloudflare_secret_stays_in_github_actions"],
    tests: ["deploy_cloudflare_worker dispatches the fixed deploy workflow with an exact SHA", "repeating same operation_id replays receipt"],
  }),
  capability({
    id: "deployment.production_alignment",
    intent: "validate_production_sha",
    title: "Validate Production SHA",
    operation_class: "read",
    handler_id: "validate_production_sha",
    input_schema: objectSchema({}),
    output_schema: objectSchema({ ok: { type: "boolean" } }, ["ok"]),
    external_systems: ["worker_env", "github_metadata_config"],
    risk_gates: ["auth_required", "session_required", "bounded_output"],
    tests: ["validate_production_sha returns compact alignment fields"],
  }),
];

export const lifecycleDeclarations = lifecycle.declarations;
export const lifecycleMandatorySequence = lifecycle.mandatory_sequence;

export function resolveCapability(intent) {
  return capabilityDirectory.find((entry) => entry.intent === intent) || null;
}

function capability(entry) {
  return {
    max_response_bytes: 12000,
    lifecycle_declaration_id: `${entry.id}.lifecycle`,
    ...entry,
  };
}
