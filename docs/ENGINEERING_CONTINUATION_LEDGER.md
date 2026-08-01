# Quant Lab Engineering Continuation Ledger

Last updated: 2026-08-01
Status: ACTIVE
Authority: Sole canonical engineering continuation ledger

## Authority and Precedence

This file contains Quant Lab's accepted incomplete engineering work, queue precedence, one active job, and one current action.

No chat context, model memory, D1 continuation summary, runtime receipt, website state, operating-memory note, or other document may override this ledger.

The governing mission, operator authority, owner boundary, and operating doctrine are defined separately in `docs/QUANT_LAB_STARTUP_AUTHORITY.md`.

## Active Job

Job ID: `stage-5-controlled-strategy-factory`
Priority: 5
State: ACTIVE

Engineering objective:

Build and production-validate a bounded strategy factory that creates a small, predeclared set of immutable candidate specifications, evaluates them on the frozen benchmark partitions, and submits their evidence to the hostile judge without adaptive tuning or promotion.

Accepted scope:

- immutable factory policy, candidate catalog, generation batch, and lineage hashes;
- a small predeclared EMA and RSI candidate set only;
- exact reuse of the frozen Stage 3 dataset, partitions, execution model, fees, and slippage;
- deterministic candidate runs, trades, metrics, and artifacts;
- hostile-judge evaluation using the immutable Stage 4 configuration;
- durable candidate verdicts and reason codes;
- idempotent generation and evaluation with no duplicate candidates or evidence;
- bounded operator controls and truthful website factory visibility;
- focused tests, CI, exact-SHA deployment, and production verification.

Out of scope for this job:

- open-ended search, random mutation, genetic optimization, or model-invented parameters;
- changing candidates because results are weak;
- champion/challenger selection or promotion;
- forward paper scheduling;
- leverage, derivatives, shorting, or live capital.

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

## Current Action

Define and freeze a small candidate catalog and generation policy, then implement immutable candidate specifications, exact frozen-partition backtests, hashed artifacts, hostile-judge evaluation, durable candidate verdicts, and idempotent production commissioning. Results may not alter the catalog or trigger promotion.

## Exit Gate

The active job is complete only when:

- focused deterministic tests pass;
- official GitHub Actions validation passes;
- D1 migrations apply successfully;
- an exact commit SHA is deployed and verified in production;
- factory policy and every candidate parameter are immutable, predeclared, bounded, and hashed before results exist;
- candidate lineage, frozen dataset, partitions, execution costs, runs, trades, and artifacts are reproducible;
- repeated generation creates no duplicate candidates, runs, artifacts, or verdicts;
- candidates are evaluated by the unchanged Stage 4 judge configuration;
- weak or inactive candidates remain rejected or insufficient rather than triggering parameter changes;
- the factory performs no selection, promotion, forward scheduling, or live-capital action;
- website factory state reflects live D1 records truthfully and displays judge verdict reasons;
- no result-dependent search-space expansion occurs.

## Unified Job Queue

1. `stage-1-truthful-data-foundation` — COMPLETE
2. `stage-2-paper-execution-ledger` — COMPLETE
3. `stage-3-baseline-strategy-bench` — COMPLETE
4. `stage-4-hostile-strategy-judge` — COMPLETE
5. `stage-5-controlled-strategy-factory` — ACTIVE
6. `stage-6-champion-challenger-selection` — QUEUED
7. `stage-7-forward-paper-operation` — QUEUED
8. `stage-8-live-capital-qualification` — QUEUED

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
