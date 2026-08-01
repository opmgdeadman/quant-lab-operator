# Quant Lab Engineering Continuation Ledger

Last updated: 2026-08-01
Status: ACTIVE
Authority: Sole canonical engineering continuation ledger

## Authority and Precedence

This file contains Quant Lab's accepted incomplete engineering work, queue precedence, one active job, and one current action.

No chat context, model memory, D1 continuation summary, runtime receipt, website state, operating-memory note, or other document may override this ledger.

The governing mission, operator authority, owner boundary, and operating doctrine are defined separately in `docs/QUANT_LAB_STARTUP_AUTHORITY.md`.

## Active Job

Job ID: `stage-8-live-capital-qualification`
Priority: 8
State: ACTIVE

Engineering objective:

Build and production-validate an immutable live-capital qualification gate that evaluates operationally reliable forward-paper evidence and may only produce `not_qualified` or `eligible_for_owner_review`. It can never authorize, fund, deploy, or execute live capital.

Accepted scope:

- immutable qualification policy, evidence thresholds, reason codes, and policy hash;
- qualified-champion, forward-duration, activity, performance, drawdown, cost-resilience, data-reliability, duplicate-safety, and accounting gates;
- evidence drawn only from immutable production selection, forward cycles, scheduler receipts, paper ledger, and stored stress results;
- deterministic assessment batches with durable gate evidence and evidence hashes;
- explicit separation between evidence eligibility and owner approval;
- idempotent assessments with no silent threshold or verdict replacement;
- bounded operator controls and truthful website qualification visibility;
- focused tests, CI, exact-SHA deployment, and production verification.

Out of scope for this job:

- owner approval, capital funding, broker or exchange credentials, or live execution;
- lowering thresholds because current evidence is insufficient;
- changing champion, judge, factory, forward policy, or historical evidence;
- leverage, derivatives, shorting, or any implied promise of profitability.

## Completed Evidence

- Cloudflare Worker deployed and online.
- D1 binding connected.
- Authenticated MCP and bounded execution kernel operational.
- GitHub inspection, mutation, CI, deployment, migration, and production-SHA controls operational.
- Deterministic Python indicator, strategy-specification, backtest, and judge core present.
- `market_candles` and operator receipt tables present.
- Existing website can display the latest stored BTC-USD 1-hour candle.
- Quant Lab Startup Authority separated from this ledger at `docs/QUANT_LAB_STARTUP_AUTHORITY.md`.
- Mandatory startup context loads the full authority and this sole Git ECL before operator work.
- Every bounded operator intent requires the exact authority acknowledgment and this ledger's current Git SHA; skipped or stale continuity fails closed.
- Startup enforcement regression tests and parallel CI diagnostics pass on commit `b384e488a3689de65e1ac08859f0122fa990de7f`.
- Stage 1 market-data implementation now includes Coinbase Exchange BTC-USD 1-hour retrieval behind a provider boundary, completed-candle and OHLCV validation, immutable idempotent D1 persistence, gap/stale/error health state, bounded backfill, ingestion-run telemetry, protected manual execution, website health visibility, and hourly cron wiring.
- Deterministic Worker tests, quant-core tests, and Wrangler validation passed on implementation SHA `ee04077607be099a12206d1ecbb3121038d9ba7a`; D1 migration `0004_market_data_health.sql` applied successfully and that SHA deployed with repository/deployment alignment proven.
- Commissioning SHA `6203eed2b8183cb22024afe6147312cb05bceb25` passed all CI jobs and deployed successfully with bounded public health telemetry and corrected production phase labeling.
- Stage 1 reliability hardening added bounded provider retries, an exact BTCUSD Binance.US fallback for Coinbase availability failures, immutable provider-transition handling, and an authenticated receipt-backed production commissioning capability; Worker tests, quant-core tests, Wrangler validation, and exact-SHA deployment passed on `a7c6ac1a2f8e2d98e019dcf9e26afdd1115c8d58`.
- Production commissioning at `2026-08-01T17:34:27.981Z` recovered the missing `2026-08-01T17:00:00.000Z` candle and reported healthy state with zero staleness and zero gaps; an immediate repeat inserted zero rows and counted one duplicate.
- A real Cloudflare scheduled execution at `2026-08-01T17:35:41.000Z` completed successfully, preserved healthy state, inserted zero rows, and counted one duplicate, proving scheduler wiring and duplicate-safe operation.
- Stage 1 is complete. This transition restores the permanent `5 * * * *` UTC hourly cadence; longer reliability evidence continues as runtime observation and does not block Stage 2.
- Stage 2 implemented migration `0005_paper_execution_ledger.sql`, immutable orders, fills, cash entries, valuation snapshots, cycle receipts, mutable versioned projections, and a cycle-matching concurrency guard.
- The paper execution model is fixed as `paper-spot-next-eligible-open-v1` with 10 bps fees, 5 bps slippage, long-only BTC-USD spot, no leverage, no shorting, and no live-capital path.
- Focused tests prove next-eligible-candle timing, delayed-decision handling, pending retries, immutable replay, payload mismatch rejection, insufficient-cash rejection, oversell rejection, accounting conservation, malformed decision rejection, and version-conflict protection.
- Official CI passed and exact SHA `542ec6c7bd3bf9f9eea303d7b827f3c876ed4aad` deployed after D1 migration success.
- Production commissioning created one bounded paper buy and sell, then replayed both receipts without new effects. The final account has zero BTC, two orders, two fills, two cycles, reconciled cash ledger delta `0`, and no live capital enabled.
- Stage 2 is complete. The website and authenticated status now expose truthful paper-account state and reconciliation without publishing unsupported claims.
- Stage 3 implemented migration `0006_baseline_strategy_bench.sql`, three predeclared immutable reference strategies, deterministic 60/20/20 chronological partitions, cost-adjusted next-candle backtests, hashed artifacts, and idempotent benchmark persistence.
- Focused tests proved catalog immutability, partition separation, gap rejection, deterministic hashes, fixed fees/slippage, next-candle execution, and hash sensitivity to changed data.
- Official CI passed and exact SHA `40fad6975311d946432a41862fc0be23b9b2e763` deployed after migration success.
- Production froze 74 contiguous BTC-USD hourly candles from `2026-07-29T17:00:00.000Z` through `2026-08-01T18:00:00.000Z` into 44/14/16 train-validation-test partitions and persisted nine immutable runs.
- Repeating production commissioning replayed the same benchmark hash and created no duplicate definitions, runs, trades, or artifacts. No tuning or promotion occurred.
- Stage 3 is complete. The website labels all results as historical paper research and explicitly states that comparison order is not promotion.
- Stage 4 implemented migration `0007_hostile_strategy_judge.sql`, immutable judge configuration, evidence-integrity gates, partition-specific activity/performance gates, doubled/tripled cost stress replay, durable verdict reasons, and idempotent batches.
- Seven adversarial tests proved config immutability, inactivity rejection, corruption rejection, missing-partition rejection, deterministic stress replay, deterministic batch hashes, and successful qualification of genuinely active cost-robust synthetic evidence without promotion.
- Official CI passed and exact SHA `35b543d3dc17f2acddaf5c524bbab6db91bebcb3` deployed after migration success.
- Production judged the three Stage 3 baselines: zero qualified, three insufficient-evidence, zero promoted. Replaying the batch returned the identical hash with no duplicate verdicts.
- Stage 4 is complete. The website exposes verdicts and reason codes while explicitly denying promotion and live-capital authority.
- Stage 5 implemented migration `0008_controlled_strategy_factory.sql`, an immutable eight-candidate catalog, fixed lineage, exact reuse of the frozen Stage 3 partitions and costs, 24 deterministic candidate runs, unchanged Stage 4 judging, and chunked idempotent evidence persistence.
- Six focused tests proved catalog cardinality and immutability, deterministic candidate/run/verdict hashes, lineage, next-candle execution, exact partition reuse, non-expansion after weak results, and fail-closed source boundaries.
- Official CI passed and exact SHA `8ef93039935c5075ab7ef3af67e5b32fd85e74d5` deployed after migration success.
- Production generated and judged all eight predeclared candidates: zero qualified, eight insufficient-evidence, zero rejected, zero promoted. Replaying returned the identical factory batch hash without duplicate evidence.
- Stage 5 is complete. The website truthfully shows all candidate verdicts and explicitly denies adaptive tuning, expansion, promotion, forward scheduling, and live capital.
- Stage 6 implemented migration `0009_champion_challenger_selection.sql`, an immutable qualified-only policy, deterministic score and tie-breakers, one-champion/two-challenger limits, explicit no-champion blockers, and idempotent selection evidence.
- Six focused tests proved policy immutability, no-champion behavior, qualified-only eligibility, deterministic ranking and tie-breaking, fixed score math, and fail-closed source/metric validation.
- A diagnostic matrix isolated and permanently fixed a null-to-zero metric coercion; the temporary diagnostics were removed before release and all official CI jobs passed.
- Exact SHA `3ae699c5c4c6fe53db41d01a726b2ed28d14d477` deployed after migration success.
- Production evaluated all eight Stage 5 candidates, found zero eligible, and immutably recorded `no_champion` with blocker `no_qualified_candidates`; no paper execution, scheduling, fallback, or live-capital action occurred. Replay returned the identical selection hash.
- Stage 6 is complete. The website truthfully displays the no-champion state and blocker.
- Stage 7 implemented migration `0010_forward_paper_operation.sql`, an immutable hourly policy, one cycle per expected close, separate scheduler receipts, ingestion-before-decision orchestration, qualified-champion gates, pre-execution-candle signals, fixed 10% buy allocation, full-position sells, Stage 2 ledger reuse, and durable blocked/hold/filled/rejected/error states.
- Eight focused tests proved policy immutability, no-champion idle behavior, ingestion/missing/gap gates, EMA buy and sell behavior, RSI entries and exits, no-look-ahead invariance, hold-without-order behavior, invalid champion rejection, and paper-account reconciliation gates.
- Temporary diagnostics isolated invalid zero-price test fixtures; the fixtures were corrected, diagnostics removed, and all official CI jobs passed on implementation SHA `f0e291293956223361fb9ecb945e5c3496490edf`.
- Commissioning SHA `0ba23a4ad6450578b811b0957b1829a1c1e1b341` deployed migration `0010` with a temporary five-minute cron. Historical commissioning and replay produced the identical blocked-no-champion cycle hash without a paper decision.
- A real Cloudflare scheduled invocation at `2026-08-01T18:50:31.000Z` ingested first, reported healthy data, inserted zero candles, counted one duplicate, created scheduler receipt `forward-scheduler:2026-08-01T18:50:31.000Z`, and durably recorded the single `2026-08-01T18:00:00.000Z` forward cycle as `blocked_no_champion` without any paper order.
- Stage 7 is complete. This transition restores the permanent `5 * * * *` UTC hourly cadence. The autonomous operator can safely ingest, verify, idle, and later execute a qualified champion without human intervention or live capital.

## Current Action

Define and freeze the live-capital qualification policy before reading assessment results. Implement immutable evidence collection and gates for champion status, at least 720 distinct hourly forward cycles spanning 30 days, at least 30 closed forward-paper trades, positive cost-adjusted return, maximum 10% drawdown, doubled- and tripled-cost resilience, healthy scheduled ingestion, zero duplicate violations, reconciled accounting, and zero unresolved operational errors. The only positive state is `eligible_for_owner_review`; no live authorization is permitted.

## Exit Gate

The active job is complete only when:

- focused deterministic tests pass;
- official GitHub Actions validation passes;
- D1 migrations apply successfully;
- an exact commit SHA is deployed and verified in production;
- qualification policy, thresholds, reason codes, and policy hash are immutable before assessment;
- evidence collection verifies source identities and fails closed on missing, malformed, conflicting, or unreconciled records;
- a synthetic complete evidence bundle can reach `eligible_for_owner_review` while production's insufficient evidence remains `not_qualified`;
- champion, 30-day/720-cycle, 30-trade, positive-return, 10% drawdown, cost-resilience, scheduler-health, duplicate-safety, accounting, and unresolved-error gates are all independently recorded;
- repeated assessment creates no duplicate batch, gate, or verdict and cannot silently replace an immutable result;
- the system exposes no live-authorization, funding, credential, order, or execution capability;
- website qualification state reflects live D1 records truthfully and displays every blocker;
- explicit owner approval remains a separate future decision even after evidence eligibility.

## Unified Job Queue

1. `stage-1-truthful-data-foundation` — COMPLETE
2. `stage-2-paper-execution-ledger` — COMPLETE
3. `stage-3-baseline-strategy-bench` — COMPLETE
4. `stage-4-hostile-strategy-judge` — COMPLETE
5. `stage-5-controlled-strategy-factory` — COMPLETE
6. `stage-6-champion-challenger-selection` — COMPLETE
7. `stage-7-forward-paper-operation` — COMPLETE
8. `stage-8-live-capital-qualification` — ACTIVE

Only one job may be ACTIVE. New work must be inserted into this queue with explicit precedence rather than stored in chat or D1 as a competing continuation source.

## Completion Recording

For each completed job, record once:

- exact implementation result;
- validation evidence;
- deployed SHA when applicable;
- production verification;
- unresolved risks;
- next active job and current action.

Runtime measurements, cycle receipts, market data, trades, experiments, incidents, and website telemetry belong in D1, not in this engineering ledger.
