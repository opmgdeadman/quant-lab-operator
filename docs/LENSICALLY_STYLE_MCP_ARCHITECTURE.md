# Lensically-Style MCP Architecture For Quant Lab

> Historical design record. Superseded by `docs/MCP_OPERATOR_TOOL_SURFACE_HANDOFF.md`, the direct typed MCP `0.4.0` contract, and the mandatory capability lifecycle. Do not restore the generic intent envelope described below.

Last updated: 2026-07-26

Quant Lab should not grow as a pile of MCP tools. Build the operator MCP as a small professional control plane modeled after Lensically.

## Core Principle

The public MCP advertises a tiny authenticated surface. Internally, source-controlled architecture decides what can happen.

Public tools:

- `get_quant_lab_status`
- `execute_quant_lab_intent`

Everything else is an intent behind `execute_quant_lab_intent`, validated and dispatched by the execution kernel.

## Required Modules

- `src/operator/toolRegistry.js`
  Public MCP tool descriptors only.

- `src/operator/executionKernel.js`
  The only execution path for `execute_quant_lab_intent`.

- `src/operator/capabilityDirectory.js`
  Source of truth for intents, schemas, handlers, bounds, risk gates, and tests.

- `src/operator/clientSafeRequests.js`
  Forbidden public shapes, path allowlists, size limits, and redaction.

- `src/operator/capabilityLifecycle.json`
  Required lifecycle for any new intent.

- `src/operator/receipts.js`
  Operation IDs, fingerprints, idempotency replay, audit receipts, redacted serialization.

- `src/operator/handlers/*.js`
  Source-defined bounded handlers. No arbitrary shell, SQL, GitHub, Cloudflare, or URL passthrough.

## Required Persistence

Migration:

- `migrations/0002_operator_control_plane.sql`

Tables:

- `operator_operation_receipts`
- `operator_continuation_state`
- `operator_audit_log`
- `operator_incidents`

## Required Tests

- `test/operator-mcp.test.js`
  Auth, sessions, registry, `execute_quant_lab_intent`, idempotency, action closure.

- `test/operator-capability-directory.test.js`
  Directory/lifecycle/handler/schema consistency.

- `test/operator-client-safety.test.js`
  Forbidden keys, path traversal, allowlists, redaction, result bounds.

## Engineering-Control Intents

Current Quant-native control-plane intents:

- `get_engineering_access_state`
- `operator_status`
- `read_continuation`
- `write_continuation`
- `inspect_repository`
- `read_repo_file`
- `list_repo_files`
- `apply_repo_patch_set`
- `create_repo_file`
- `delete_repo_file`
- `run_validation`
- `list_github_actions_runs`
- `trigger_github_workflow`
- `monitor_github_workflow`
- `deploy_cloudflare_worker`
- `apply_d1_migrations`
- `validate_production_sha`

Do not add more trading functionality until ChatGPT can see and invoke `execute_quant_lab_intent`, perform a repo read, dry-run a bounded patch set, run validation through GitHub Actions, monitor the workflow, dispatch an exact-SHA deploy or migrations workflow, report production alignment, and return durable receipts.

## Completion Bar

Completion means live ChatGPT connector evidence, not local claims:

- ChatGPT action registry sees `execute_quant_lab_intent`.
- ChatGPT invokes `operator_status`.
- ChatGPT invokes `read_repo_file` for `README.md`.
- ChatGPT invokes `apply_repo_patch_set` in dry-run mode.
- ChatGPT invokes `trigger_github_workflow`.
- ChatGPT invokes `monitor_github_workflow`.
- ChatGPT invokes `deploy_cloudflare_worker` or `apply_d1_migrations` with an exact SHA, or reports a source-controlled reason deployment is blocked.
- ChatGPT invokes `validate_production_sha`.
- Each invocation returns a durable receipt.
- The final response includes commit SHA, deployed Worker version, receipt IDs, and exact next action.
