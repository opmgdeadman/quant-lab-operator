# MCP Operator Control Plane Handoff

Last updated: 2026-07-26

## Current Blocker

ChatGPT refreshed the Quant Lab connector action registry and still sees only:

- `get_quant_lab_status`

That means the currently deployed Worker and/or ChatGPT action registry does not expose any new operator tools. Do not claim a tool exists until the live ChatGPT connector sees and invokes it.

The previous candle-ingestion slice is valid future functionality, but it is not the current milestone.

## Why ChatGPT Still Sees One Tool

At the time of this handoff, `src/index.js` still hardcodes one public MCP tool in `tools/list`:

- `get_quant_lab_status`

If a local branch or documentation says candle tools exist but ChatGPT sees only status, the likely causes are:

1. the tools were documented but not implemented in `src/index.js`;
2. the tools were implemented locally but not committed and pushed;
3. CI/deploy did not publish the new Worker;
4. ChatGPT connector actions were not refreshed after deployment;
5. the live Worker is still returning the older one-tool registry.

First fix the live registry discrepancy. Verify against the deployed endpoint and the ChatGPT connector path.

## Required Milestone

Implement the authenticated operator control plane first.

Primary public MCP tool:

- `execute_quant_lab_intent`

This tool must be authenticated, bounded, typed, audited, idempotent, and fail closed.

It is the single control-plane entrypoint for GPT to operate Quant Lab. Do not add more trading functionality until GPT can see and invoke this tool and it successfully completes harmless control-plane operations.

This must be built as source-controlled operator architecture, not as a large switch statement bolted onto `src/index.js`.

## Professional Architecture Target

Quant Lab should copy the professional shape of Lensically at smaller scale:

- One public authenticated MCP entrypoint.
- One execution kernel that owns request validation, capability resolution, authorization, idempotency, audit receipts, redaction, execution, hardening, and action closure.
- One source-controlled capability directory.
- One source-controlled client-safety registry.
- One source-controlled capability lifecycle manifest.
- One test suite that proves the public tool registry, every intent schema, every capability declaration, idempotency, redaction, and fail-closed behavior.
- One migration-owned database authority for operator receipts, continuation, audit, and later operational tables.

Do not invent a second framework after this. These files are the professional foundation.

## Required File Layout

Create or refactor toward these files:

- `src/index.js`
  - HTTP routing only.
  - OAuth handlers.
  - MCP method handling.
  - Delegates tool registry and `execute_quant_lab_intent` calls to operator modules.

- `src/operator/toolRegistry.js`
  - Exports public MCP tool descriptors.
  - Includes `get_quant_lab_status` and `execute_quant_lab_intent`.
  - Enforces closed schemas and output schemas.

- `src/operator/executionKernel.js`
  - The only path that executes `execute_quant_lab_intent`.
  - Validates public envelope.
  - Resolves capability from the directory.
  - Validates intent-specific inputs.
  - Enforces auth/session assumptions.
  - Applies idempotency.
  - Calls one source-defined handler.
  - Redacts result.
  - Writes audit/receipt.
  - Adds action closure.
  - Fails closed.

- `src/operator/capabilityDirectory.js`
  - Source of truth for every supported intent.
  - Each entry declares id, intent, title, operation class, handler id, input schema, output schema, allowed paths/actions, mutability, external systems, validation scope, and risk gates.

- `src/operator/clientSafeRequests.js`
  - Source-controlled public payload safety rules.
  - Forbidden input keys and blocked shapes.
  - Redaction rules.
  - Allowed path prefixes and exact path allowlists.

- `src/operator/capabilityLifecycle.json`
  - Required lifecycle for adding any new operator intent:
    - declaration
    - directory entry
    - strict schema
    - canonical handler
    - tests
    - migration when needed
    - validation command
    - deploy/live verification contract

- `src/operator/receipts.js`
  - Operation fingerprinting.
  - Receipt read/write/replay.
  - Audit log write.
  - Redacted JSON serialization.

- `src/operator/handlers/*.js`
  - One small handler per intent or coherent family.
  - No handler accepts arbitrary shell, arbitrary SQL, or arbitrary remote API passthrough.

- `migrations/0002_operator_control_plane.sql`
  - Receipt, continuation, audit, and incident tables.

- `test/operator-mcp.test.js`
  - Public MCP/auth/session/tool registry tests.
  - `execute_quant_lab_intent` happy-path and fail-closed tests.

- `test/operator-capability-directory.test.js`
  - Directory consistency tests.
  - Every public intent has schema, handler, lifecycle declaration, and tests.

Keep `test/worker.test.js` for HTTP surface smoke tests if useful, but move professional MCP assertions into dedicated operator tests.

## Execution Kernel Contract

`execute_quant_lab_intent` must return a compact structured result with this shape:

```json
{
  "ok": true,
  "intent": "read_repo_file",
  "operation_id": "example-op",
  "receipt": {
    "receipt_id": "operator_receipt_...",
    "replayed": false,
    "request_fingerprint": "sha256:...",
    "created_at": "..."
  },
  "execution_kernel": {
    "name": "Quant Lab Execution Kernel",
    "version": "quant-lab-execution-kernel-v1",
    "capability_id": "engineering.read_repo_file",
    "handler_id": "read_repo_file",
    "model_tool_choice_allowed": false,
    "arbitrary_shell_allowed": false,
    "arbitrary_sql_allowed": false
  },
  "operator_action_closure": {
    "status": "completed",
    "evidence": ["..."],
    "next_action": "..."
  },
  "result": {}
}
```

Failures must still return a receipt when execution begins:

```json
{
  "ok": false,
  "error": "forbidden_path",
  "intent": "read_repo_file",
  "receipt": {},
  "operator_action_closure": {
    "status": "blocked",
    "next_action": "repair_or_adjust_inputs"
  }
}
```

Never return stack traces, secrets, full logs, large files, arbitrary DB rows, or raw provider payloads.

## Non-Negotiable Boundary

Keep these existing protections:

- `POST /api/operator/mcp` only.
- Auth before JSON parsing.
- `initialize` returns signed `Mcp-Session-Id`.
- `tools/list`, `tools/call`, and `ping` require auth plus valid session.
- Legacy public `/mcp`, `/status`, and `/openapi.json` remain removed.
- No unauthenticated `tools/list`.
- No arbitrary public shell.
- No arbitrary public SQL.
- No arbitrary public GitHub or Cloudflare proxy.
- No secret values in responses, logs, docs, commits, or memory.
- Immutable trading judge cannot be bypassed through operator intents.

## Public Tool Registry

`tools/list` should expose:

- `get_quant_lab_status`
- `execute_quant_lab_intent`

Keep `get_quant_lab_status` as a read-only smoke/status tool.

Add `execute_quant_lab_intent` with:

- `annotations.readOnlyHint: false`
- `annotations.destructiveHint: false`
- `annotations.idempotentHint: true`
- `annotations.openWorldHint: true`
- closed `inputSchema` with `additionalProperties: false`
- explicit `outputSchema`

## `execute_quant_lab_intent` Schema

Suggested input schema:

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "operation_id": {
      "type": "string",
      "minLength": 1,
      "maxLength": 120
    },
    "intent": {
      "type": "string",
      "enum": [
        "operator_status",
        "read_continuation",
        "write_continuation",
        "inspect_repository",
        "read_repo_file",
        "list_repo_files",
        "apply_repo_patch",
        "delete_repo_file",
        "run_validation",
        "commit_and_push",
        "list_github_actions_runs",
        "trigger_github_workflow",
        "monitor_github_workflow",
        "deploy_cloudflare_worker",
        "inspect_cloudflare_worker",
        "apply_d1_migrations",
        "inspect_d1_state",
        "read_runtime_incidents",
        "repair_failed_operation",
        "validate_production_sha"
      ]
    },
    "inputs": {
      "type": "object",
      "additionalProperties": true
    }
  },
  "required": ["operation_id", "intent", "inputs"]
}
```

Handler-level validation must narrow `inputs` per intent. The public schema is only the outer envelope; each intent must have its own strict internal schema and reject unsupported keys.

## First Intent Set To Implement

Implement the smallest useful control-plane subset first, but structure it so the full list can be added without changing the public tool name.

Required immediately:

### 1. `operator_status`

Read-only.

Returns:

- authenticated MCP status
- deployment SHA
- D1 connection status
- exposed tool count
- supported intent list

### 2. `read_continuation`

Read-only.

Reads durable continuation state from D1. If none exists, returns an explicit idle state.

### 3. `write_continuation`

Mutation.

Writes bounded continuation state to D1:

- active objective
- current phase
- completed evidence
- next action
- updated timestamp

### 4. `inspect_repository`

Read-only.

Returns compact configured GitHub repo state:

- owner
- repo
- branch
- latest SHA
- dirty/deployment alignment if available

No broad source dumps.

### 5. `read_repo_file`

Read-only.

Allowed paths only:

- `README.md`
- `OPERATING_MEMORY.md`
- `docs/WHITELISTED_CLOUD_GITHUB_MCP_RUNBOOK.md`
- `docs/MCP_OPERATOR_CONTROL_PLANE_HANDOFF.md`
- `src/index.js`
- `test/worker.test.js`
- `wrangler.jsonc`
- `package.json`

Inputs:

- `path`
- optional `start_line`
- optional `max_lines`, capped

### 6. `run_validation`

Mutation/external operation, but bounded.

Allowed validation only:

- `npm test`
- `npm run check`

Preferred implementation:

- trigger a GitHub Actions workflow or use a source-defined validation path.
- If local Worker runtime cannot execute commands, return `not_available_in_worker_runtime` with the exact supported alternate path.

Do not add arbitrary command execution.

### 7. `validate_production_sha`

Read-only.

Compares:

- repository head SHA
- configured/deployed Worker SHA or `DEPLOYMENT_SHA`
- latest relevant GitHub Actions result if available

Return compact alignment status.

## Capability Directory Minimum Entries

The initial `capabilityDirectory.js` must include at least:

- `operating.operator_status`
- `operating.continuation_read`
- `operating.continuation_write`
- `engineering.repository_inspection`
- `engineering.repo_file_read`
- `engineering.validation`
- `deployment.production_alignment`

Each entry must include:

- `id`
- `intent`
- `title`
- `operation_class`: `read` or `mutation`
- `handler_id`
- `input_schema`
- `output_schema`
- `max_response_bytes`
- `allowed_paths` or `allowed_actions` when applicable
- `external_systems`
- `risk_gates`
- `tests`
- `lifecycle_declaration_id`

The tests must fail if:

- an intent is exposed but not in the directory
- a directory entry lacks a lifecycle declaration
- a handler exists without a directory entry
- a schema allows arbitrary extra top-level keys
- a mutation lacks idempotency coverage
- a path-reading intent lacks an allowlist

## Client Safety Registry Minimum Rules

`clientSafeRequests.js` must define:

- forbidden public input keys:
  - `command`
  - `sql`
  - `script`
  - `shell`
  - `token`
  - `secret`
  - `private_key`
  - `password`
  - `raw_patch`
  - `arbitrary_url`
- allowed repository paths for first read intent.
- maximum response bytes per intent.
- redaction patterns for bearer tokens, GitHub tokens, Cloudflare tokens, OAuth codes, API keys, and long random-looking secrets.
- a helper that verifies public inputs before dispatch.

Any client-safety rejection must be tested and return a compact fail-closed error.

## Full Intent Capability Targets

After the first set works live, add bounded implementations for:

- edit/create/delete approved repository files
- commit and push changes
- inspect GitHub Actions runs
- trigger and monitor workflows
- deploy and inspect Cloudflare Worker
- apply versioned D1 migrations
- inspect bounded D1 operational state
- read deployment/runtime logs and incidents
- repair failed implementations or deployments

Each intent must have:

- internal strict schema
- bounded allowed paths/actions
- operation ID idempotency
- audit receipt
- secret redaction
- fail-closed errors
- tests

## D1 Tables

Add migrations for operator receipts and continuation.

Minimum:

```sql
CREATE TABLE IF NOT EXISTS operator_operation_receipts (
  operation_id TEXT PRIMARY KEY,
  intent TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS operator_continuation_state (
  id TEXT PRIMARY KEY,
  active_objective TEXT,
  current_phase TEXT,
  completed_evidence_json TEXT NOT NULL DEFAULT '[]',
  next_action TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS operator_audit_log (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL,
  intent TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS operator_incidents (
  id TEXT PRIMARY KEY,
  operation_id TEXT,
  severity TEXT NOT NULL CHECK (severity IN ('P0', 'P1', 'P2', 'P3')),
  status TEXT NOT NULL CHECK (status IN ('open', 'contained', 'repaired', 'validated', 'closed')),
  summary TEXT NOT NULL,
  root_cause TEXT,
  next_action TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Do not store secrets in these tables.

## Idempotency Contract

For every `execute_quant_lab_intent` call:

1. Compute a stable fingerprint from `{ intent, inputs }`.
2. If `operation_id` exists with the same fingerprint, replay the stored receipt.
3. If `operation_id` exists with a different fingerprint, reject with `idempotency_key_payload_mismatch`.
4. Store success or failure receipts with compact redacted results.

## Tests Required Before Claiming Completion

Extend `test/worker.test.js`:

- unauthenticated MCP still rejects before parsing
- `tools/list` requires valid session
- `tools/list` includes `execute_quant_lab_intent`
- every listed tool has closed input schema
- unadvertised tools still reject
- `execute_quant_lab_intent` rejects missing/unknown intent
- unsupported input keys reject per intent
- `operator_status` succeeds
- `read_continuation` returns idle when empty
- `write_continuation` persists bounded state
- repeating same `operation_id` replays receipt
- same `operation_id` with changed payload rejects
- `read_repo_file` only reads allowed paths
- forbidden path traversal rejects
- `run_validation` either invokes the bounded validation path or returns explicit `not_available_in_worker_runtime`
- `validate_production_sha` returns compact alignment fields
- no response contains secret-looking values

Add `test/operator-capability-directory.test.js`:

- every supported intent exists in `capabilityDirectory.js`
- every directory entry has a lifecycle declaration
- every directory entry has a handler
- every handler has a directory entry
- every input schema is closed at its validated boundary
- every mutation has idempotency tests listed
- every file or external-system capability has allowlists/risk gates
- `capabilityLifecycle.json` contains the mandatory sequence

Add `test/operator-client-safety.test.js`:

- forbidden keys reject before handler dispatch
- path traversal rejects
- unallowlisted files reject
- secret-like outputs are redacted
- oversized results are bounded

## Live Verification Required

Do not stop at local tests.

Required completion evidence:

1. Commit and push the implementation.
2. GitHub Actions passes.
3. Deploy Cloudflare Worker.
4. Refresh ChatGPT connector actions.
5. Confirm ChatGPT sees:
   - `get_quant_lab_status`
   - `execute_quant_lab_intent`
6. From ChatGPT connector path, invoke:
   - `execute_quant_lab_intent` with `intent: "operator_status"`
   - `execute_quant_lab_intent` with `intent: "read_repo_file"` for `README.md`
   - `execute_quant_lab_intent` with `intent: "run_validation"`
   - `execute_quant_lab_intent` with `intent: "validate_production_sha"`
7. Capture the returned durable operation receipt IDs.

## Required Final Reply To GPT

Reply only after live connector verification with:

- why ChatGPT previously saw only one tool
- exact registry/deployment fix
- operator contract implemented
- live invocation evidence from ChatGPT connector path
- operation receipt IDs
- commit SHA
- exact next action

## Explicit Non-Goal

Do not implement more trading functionality in this milestone.

The candle tools may be kept if already implemented and deployed, but they do not satisfy this milestone. The first priority is the authenticated operator control plane that lets GPT inspect, validate, repair, deploy, and resume Quant Lab through bounded MCP intents.
