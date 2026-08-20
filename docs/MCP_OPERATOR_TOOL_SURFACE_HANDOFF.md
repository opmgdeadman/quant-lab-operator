# Quant Lab MCP Operator Surface

Last updated: 2026-08-06

## Authority

Quant Lab is operated through an authenticated, deployment-scoped MCP. The source-controlled Startup Authority and `docs/ENGINEERING_CONTINUATION_LEDGER.md` govern every operator action. Chat history and D1 continuation records are not continuation authority.

## Public Contract

The public MCP advertises exactly five stable tools:

- `get_quant_lab_startup_context`
- `get_quant_lab_status`
- `get_quant_lab_capability_definition`
- `execute_quant_lab_read_action`
- `execute_quant_lab_mutation_action`

Internal capabilities remain strict entries in `src/operator/capabilityDirectory.js`, but they are server-side registry data rather than one ChatGPT tool per capability. Strategy templates, feature sets, parameter contracts, datasets, workflows, and future research classes therefore evolve without changing `tools/list`.

`get_quant_lab_capability_definition` dynamically returns the bounded current registry or one exact source-controlled capability definition. The two execution gateways carry a stable outer envelope with `operation_id`, exact Startup Authority acknowledgment, current Git ECL SHA, a capability selector, and a generic arguments object. The server then resolves the capability, rejects read/mutation effect mismatches, validates the exact strict capability schema, and dispatches only through the existing execution kernel.

The gateway contract preserves deterministic source-defined routing, bounded output, idempotent receipts, leases, incident handling, and truthful read-vs-mutation annotations without exporting domain vocabulary into the public MCP schema.

## Execution Kernel

`quant-lab-execution-kernel-v1` owns:

- capability resolution
- startup-authority and canonical-ledger validation
- client payload safety
- operation fingerprints and leases
- duplicate replay and conflicting-payload rejection
- stale started-operation takeover
- canonical handler execution
- compact durable receipts and audit records
- unexplained-failure hardening incidents
- ledger-bound action closure

A call that is already active returns `operation_already_in_progress`; it does not launch a competing runner. A completed or failed operation replays its durable result when the same identity and payload are used again.

## Capability Lifecycle

`src/operator/capabilityLifecycle.json` is mandatory. Every capability must have:

- one declaration
- one directory entry
- one strict schema
- one canonical handler
- one stable gateway route
- focused regression coverage
- a minimum validation scope
- an exact-SHA release
- a live-verification contract
- `compatibility_bridge: false`

Module startup fails closed when lifecycle declarations and the directory drift.

## Hardening Lifecycle

Unexpected exceptions and unexplained structured failures open a durable hardening incident. Closure follows this exact sequence:

1. `open`
2. `diagnosed`
3. `fixed`
4. `validated`
5. `deployed`
6. `verified`
7. `closed`

The sequence cannot be skipped. Closure requires root cause, generalized cause, a prevention rule, regression evidence, exact tested SHA, deployment identity, live verification, and the result of resuming the original objective.

## Sessions

MCP sessions are signed and bound to both the deployed SHA and Execution Kernel version. A deployment or kernel change invalidates the old session with `mcp_deployment_changed_reinitialize`. Do not add compatibility bridges for stale client sessions.

## Validation and Release

CI uses one branch-wide validation job that runs Worker tests, Python quant-core tests, and Wrangler validation. Superseded validation runs cancel through workflow concurrency.

Production deployment:

- checks out one exact SHA
- verifies release identity
- reuses successful CI evidence for that SHA when available
- otherwise runs the complete fallback validation
- applies migrations through the release workflow
- deploys the exact Worker head
- verifies production SHA and runtime surfaces

GitHub dispatch responses are reconciled against created workflow runs. An ambiguous HTTP response must not be retried until the side effect is checked.

## Recovery Boundary

The main MCP may create and deploy a separate recovery Worker while Main remains healthy. Recovery must be independently authenticated, separately deployed, free of trading/account data, and used only when Main or its deployment plane cannot receive or complete the repair. It becomes independently callable only after its separate MCP connector is registered and refreshed.

## Trading Boundaries

All operation remains paper-only until explicit owner authorization changes that boundary. Research, paper operation, live qualification, and future execution must share one authoritative promoted strategy selection. Cash is always a valid explicit portfolio state. No shell, arbitrary SQL, arbitrary provider passthrough, or unrestricted repository/cloud control is public.
