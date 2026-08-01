# Quant Lab Engineering Continuation Ledger

Last updated: 2026-08-01
Status: ACTIVE
Authority: Sole canonical engineering continuation ledger

## Authority and Precedence

This file contains Quant Lab's accepted incomplete engineering work, queue precedence, one active job, and one current action.

No chat context, model memory, D1 continuation summary, runtime receipt, website state, operating-memory note, or other document may override this ledger.

The governing mission, operator authority, owner boundary, and operating doctrine are defined separately in `docs/QUANT_LAB_STARTUP_AUTHORITY.md`.

## Active Job

Job ID: `stage-6-champion-challenger-selection`
Priority: 6
State: ACTIVE

Engineering objective:

Build and production-validate a deterministic, fail-closed champion/challenger selector that considers only hostile-judge-qualified candidates, records no champion when qualification evidence is absent, and never schedules paper execution or authorizes capital.

Accepted scope:

- immutable selection policy, ranking formula, tie-breakers, and policy hash;
- eligibility restricted to Stage 5 candidates with `qualified` hostile-judge verdicts;
- deterministic champion and bounded challenger roster when qualified evidence exists;
- explicit no-champion state and blocker reason codes when no candidate is eligible;
- immutable selection batches, eligibility decisions, rankings, and evidence hashes;
- idempotent selection with no duplicate or silent replacement;
- bounded operator controls and truthful website selection visibility;
- focused tests, CI, exact-SHA deployment, and production verification.

Out of scope for this job:

- changing judge verdicts or candidate evidence;
- selecting an insufficient or rejected candidate;
- forward paper scheduling or execution;
- manual favoritism, result-dependent policy changes, or silent champion replacement;
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
- Stage 5 implemented migration `0008_controlled_strategy_factory.sql`, an immutable eight-candidate catalog, fixed lineage, exact reuse of the frozen Stage 3 partitions and costs, 24 deterministic candidate runs, unchanged Stage 4 judging, and chunked idempotent evidence persistence.
- Six focused tests proved catalog cardinality and immutability, deterministic candidate/run/verdict hashes, lineage, next-candle execution, exact partition reuse, non-expansion after weak results, and fail-closed source boundaries.
- Official CI passed and exact SHA `8ef93039935c5075ab7ef3af67e5b32fd85e74d5` deployed after migration success.
- Production generated and judged all eight predeclared candidates: zero qualified, eight insufficient-evidence, zero rejected, zero promoted. Replaying returned the identical factory batch hash without duplicate evidence.
- Stage 5 is complete. The website truthfully shows all candidate verdicts and explicitly denies adaptive tuning, expansion, promotion, forward scheduling, and live capital.

## Current Action

Define and freeze the champion/challenger eligibility and ranking policy, then implement qualified-only selection, deterministic tie-breaking, explicit no-champion blockers, immutable selection evidence, idempotent production commissioning, and website visibility. Production must select nobody unless a Stage 5 verdict is `qualified`.

## Exit Gate

The active job is complete only when:

- focused deterministic tests pass;
- official GitHub Actions validation passes;
- D1 migrations apply successfully;
- an exact commit SHA is deployed and verified in production;
- selection policy, eligibility rules, ranking metrics, tie-breakers, roster limits, and hashes are immutable before selection;
- only `qualified` Stage 5 verdicts can be eligible;
- zero eligible candidates produces an explicit immutable no-champion state rather than fallback selection;
- deterministic synthetic qualified evidence proves champion and challenger ranking can work;
- repeated selection creates no duplicate batches or silent champion replacement;
- selection performs no paper execution, scheduling, or live-capital action;
- website selection state reflects live D1 records truthfully and displays blockers;
- existing judge or factory evidence is never mutated.

## Unified Job Queue

1. `stage-1-truthful-data-foundation` — COMPLETE
2. `stage-2-paper-execution-ledger` — COMPLETE
3. `stage-3-baseline-strategy-bench` — COMPLETE
4. `stage-4-hostile-strategy-judge` — COMPLETE
5. `stage-5-controlled-strategy-factory` — COMPLETE
6. `stage-6-champion-challenger-selection` — ACTIVE
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
