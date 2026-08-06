# Quant Lab Operating Memory

Last updated: 2026-08-06

Keep this file limited to active reusable rules. Historical debugging belongs in Git history and durable hardening incidents.

## Governing Authority

- Quant Lab is paper-only. No live capital, live order routing, or relaxation of risk boundaries occurs without explicit owner authorization.
- `docs/ENGINEERING_CONTINUATION_LEDGER.md` is the sole continuation authority.
- Chat history, D1 continuation tables, receipts, workflow state, and runtime summaries are evidence only. They cannot create, reorder, or resume work.
- Before every capability call, load the Startup Authority and canonical Git ledger. Supply the exact acknowledgment and current ledger SHA. Stale authority fails closed.

## MCP Contract

- The public surface is direct typed tools: startup, bounded status, and one tool per capability-directory entry.
- The generic `execute_quant_lab_intent` public router is retired.
- Every public capability schema is closed and accepts only `operation_id`, authority metadata, and declared domain inputs.
- Sessions are signed and bound to the deployed SHA and Execution Kernel version. Deployment changes require reinitialization; do not add stale-session compatibility bridges.
- Unknown and internal tools fail with `public_direct_tool_required`.

## Execution Kernel

- The canonical runtime is `quant-lab-execution-kernel-v1`.
- Acquire a durable `started` receipt before handler execution.
- Use semantic request fingerprints. A reused identity with different inputs fails.
- Active operations hold bounded leases. Competing calls return `operation_already_in_progress`; stale leases may be taken over atomically.
- Completed and failed operations replay their exact durable result.
- Receipts must finalize status and result, not merely update a timestamp.
- Every result contains action closure bound back to the canonical Git ledger.

## Capability Lifecycle

- `src/operator/capabilityLifecycle.json` is mandatory and enforced at module startup.
- Resolve and reuse an existing capability first.
- Every capability requires one declaration, one directory entry, one strict schema, one canonical handler, one static route, focused regressions, a minimum validation scope, exact-SHA release, live verification, and `compatibility_bridge: false`.
- New tools or handlers are incomplete until the lifecycle, tests, release, and live proof are all present.

## Hardening and Prevention

- Expected control outcomes do not create incidents. Unexpected exceptions and unexplained structured failures do.
- Durable incident sequence is `open` → `diagnosed` → `fixed` → `validated` → `deployed` → `verified` → `closed`.
- Transitions are compare-and-swap atomic and cannot skip states.
- Closure requires exact root cause, generalized cause, prevention rule, regression IDs, exact tested SHA, deployment identity, live verification, and evidence that the original objective resumed.
- A retry is not prevention. A chat note is not enforcement.

## Repository Operations

- GitHub `main` is authoritative.
- Read the current head before mutations.
- Repository paths are allowlisted. Use exact find/replace patch sets with match-count enforcement and non-forced Git commits.
- Do not expose arbitrary shell, arbitrary SQL, free-form patch execution, unrestricted GitHub/Cloudflare passthrough, or secret values.
- A stale head or ambiguous replacement requires refreshed source and corrected input, not a bypass.

## Validation and Release

- CI uses one branch-wide Ubuntu validation job: Worker tests, Python quant-core tests, and Wrangler validation.
- Manual and push CI share one concurrency group so only the newest branch validation remains authoritative.
- Deployment runs on Ubuntu against one explicit SHA.
- Reuse successful exact-SHA CI evidence. Run complete fallback validation only when that evidence is unavailable.
- GitHub dispatch responses are ambiguous until reconciled against workflow runs. Never retry an external mutation solely because the HTTP response was 500.
- Deployment applies required D1 migrations, deploys the exact Worker head, and verifies repository/production SHA alignment and live MCP behavior.
- Do not report validation or deployment success until the terminal workflow and production checks prove it.

## Research and Trading Authority

- Research, paper operation, live qualification, and any future execution must consume one authoritative promoted strategy selection.
- Institutional research may explicitly select cash. No qualified candidate means no position.
- Candidate, data-window, verdict, promotion, paper-decision, position, and qualification lineage must remain intact.
- Market-data completeness, time ordering, no-lookahead boundaries, fee/slippage assumptions, exposure limits, and kill switches are backend enforced.
- Paper and live systems remain strictly separated.

## Recovery

- Recovery is a separate, independently authenticated and deployed MCP.
- Main may construct and deploy Recovery while Main is healthy.
- Recovery contains no trading/account state and is used only when Main or its deployment plane cannot receive or complete a repair.
- Recovery cannot bypass exact-SHA validation and cannot become the normal operation path.
- Independent use begins only after its separate connector is registered and refreshed.

## Current Engineering State

The Lensically-derived main control-plane transplant is implemented in source. It is not complete until the final head passes Worker, quant-core, and Wrangler validation; migrations and Worker deployment complete; production reports the exact SHA; direct typed tools are live; and the canonical continuation ledger records the verified state and next Stage 13 action.
