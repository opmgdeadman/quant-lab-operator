# Quant Lab Engineering Continuation Ledger

Last updated: 2026-08-02
Status: ACTIVE
Authority: Sole canonical engineering continuation ledger

## Authority and Precedence

This file contains Quant Lab's accepted incomplete engineering work, queue precedence, one active job, and one current action.

No chat context, model memory, D1 continuation summary, runtime receipt, website state, operating-memory note, or other document may override this ledger.

The governing mission, operator authority, owner boundary, and operating doctrine are defined separately in `docs/QUANT_LAB_STARTUP_AUTHORITY.md`.

## Active Job

Job ID: `stage-13-directional-shadow-paper-research`
Priority: P0
State: ACTIVE

Engineering objective:

End the safe-idle failure mode by turning Quant Lab into an active directional paper-research system. Every bounded candidate must be able to gather real forward-paper evidence in an isolated account, take either long or short BTC-USD exposure, and compete for promotion without waiting for a prequalified champion before any trading occurs.

Required scope:

- add signed long/flat/short paper positions with conservative, explicit short carry, fees, slippage, next-candle execution, and accounting reconciliation;
- cap every candidate at 1.0x gross exposure with no leverage above paper equity, no live derivatives, and no live-capital path;
- run each approved research candidate hourly in its own isolated shadow paper portfolio so failed candidates lose paper money and useful evidence accumulates immediately;
- expand beyond four EMA and four RSI variants into predeclared trend, breakout, momentum, volatility, and mean-reversion families that can express both directions;
- use longer history and multiple immutable walk-forward windows rather than relying on one 30-day split;
- select champions using cost-adjusted historical robustness plus independent forward-paper evidence;
- keep the canonical `paper-main` portfolio qualification-gated while exposing every shadow account, position, trade, return, drawdown, and blocker on the website;
- preserve completed-candle-only data, no look-ahead, immutable strategy lineage, duplicate protection, and hostile judging.

Permanent boundaries:

- paper only until explicit owner approval after evidence eligibility;
- simulated 1.0x long and short exposure is allowed for research; leverage above 1.0x, live derivatives, paid data, synthetic candles, hidden parameter tuning, and silent threshold changes remain prohibited;
- no strategy may be promoted merely to create activity, but bounded candidates must trade in isolated shadow paper accounts to generate forward evidence.

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
- Stage 8 implemented migration `0011_live_capital_qualification.sql`, an immutable evidence-only qualification policy, 14 independently recorded gates, source-identity and market-health checks, deterministic evidence and assessment hashes, and explicit separation from owner approval.
- The full Stage 8 suite proved a complete synthetic evidence bundle can become `eligible_for_owner_review`, every threshold fails independently, malformed or conflicting evidence fails closed, hashes are deterministic, and no-trade/closed-trade accounting reconstruction reconciles.
- Official CI passed and exact SHA `0d035d0351fa148ac63b9ed481bea88bba642694` deployed after migration success.
- Production assessed itself as `not_qualified` with six truthful blockers, eight passed gates, zero owner approval, zero authorization, and no funding, credential, or live-order capability. Replay returned the identical assessment and evidence hashes.
- Stage 8 is complete. The website and authenticated status expose every blocker while preserving the permanent paper-only boundary.
- Stage 9 implemented migration `0012_autonomous_rolling_research.sql`, immutable daily epoch and scheduler ledgers, trailing 720-candle windows, fixed 432/144/144 partitions, eight epoch-scoped instances of the unchanged catalog, reused next-candle simulation and hostile judging, and generic qualified-only selection.
- Eight focused tests proved immutable policy, waiting with zero artifacts, exact complete-epoch cardinality, epoch-scoped lineage, non-expansion after weak results, safe waiting on gapped history, as-of boundaries, and deterministic hashes.
- Official CI passed and final exact SHA `92b4fba0f854e7e94e3706698e4ae9252859bfa5` deployed after migration success.
- Production created and replayed one immutable `waiting_for_history` epoch at 75/720 candles with zero benchmark, candidates, runs, verdicts, or selection changes.
- A real scheduled invocation at `2026-08-01T20:05:18.000Z` ingested first, ran the no-champion forward gate, reassessed live qualification, and finally wrote rolling scheduler receipt `rolling-research-scheduler:2026-08-01T20:05:18.000Z` without same-candle activation.
- Stage 9 is complete. The laboratory can now grow history, research daily, select only qualified evidence, forward-test, and reassess qualification autonomously.
- Stage 10 implemented migration `0013_historical_bootstrap.sql`, immutable policy/chunk/attempt receipts, bounded 200-hour backward windows, at most two windows per invocation, exact provider lineage, completed-candle validation, conflict rejection, resumable progress, and website/MCP visibility.
- Focused tests proved policy immutability, deterministic two-attempt planning, exact remainder sizing, complete-stop behavior, stale-tail blocking, gap-aware suffix handling, historical-window idempotency, future/oversized rejection, and stored-candle conflict rejection.
- Official CI passed and exact SHA `22bf60f81c57c475ba06d14617f2bf9de0aa69a4` deployed after migration success.
- Production first extended continuity from 76 to 276 candles, safely stopped on a transient Coinbase HTTP 403, then resumed without duplicate effects to 676 and finally 720 contiguous completed candles.
- Final production history spans `2026-07-02T21:00:00.000Z` through `2026-08-01T20:00:00.000Z`, contains zero gaps, uses Coinbase exact-source candles, and has zero synthetic rows, conflicts, or remaining bootstrap work.
- Repeating the completed bootstrap replayed the same immutable completion attempt. The sealed August 1 rolling epoch also replayed unchanged, proving the new history could not retroactively affect same-day research or selection.
- Stage 10 is complete. All accepted engineering jobs are complete and Quant Lab is ready for autonomous paper-only steady-state operation.
- Stage 11 replaced the broken 760-pixel diagnostic document with a dark institutional operating console: persistent navigation, executive KPIs, paper-account view, autonomous-operation evidence, responsive research tables, expandable blocker details, qualification progress, and system-integrity panels.
- The market terminal includes the official responsive TradingView Advanced Chart for Coinbase BTC-USD plus a first-party 96-candle Quant Lab SVG fallback. A safe public status route refreshes selected operating state every 30 seconds without exposing operator credentials or unsafe controls.
- Desktop, tablet, and mobile breakpoints, keyboard focus, skip navigation, reduced-motion behavior, table overflow containment, and runtime HTML escaping were implemented. The raw definition-list layout and unbounded diagnostic strings were removed from the active route.
- Official CI passed on exact implementation SHA `f47ed4b4b1dcf6b89dbbfdcdd4c7ad5f5bdac817`, including Worker tests, quant-core tests, Wrangler validation, and the runtime-escaping regression.
- Exact SHA `f47ed4b4b1dcf6b89dbbfdcdd4c7ad5f5bdac817` deployed successfully. The production professional-console contract rendered 64,760 bytes against live D1 state with 96 candles and eight candidates and passed all nine checks: professional shell, TradingView, first-party fallback, responsive breakpoints, readable strategy table, expandable evidence, paper-only boundary, legacy-layout removal, and runtime escaping.
- Stage 11 is complete. Quant Lab now presents the quality and operating rigor of the underlying autonomous paper laboratory without changing trading logic or live-capital authority.
- Stage 12 integrated the owner-supplied rising-chart logo as Quant Lab's canonical brand mark in the professional console and exposed verified browser, Apple, Android, and social-preview assets through bounded public Worker routes.
- The document head now includes canonical URL, favicon, Apple touch icon, web-app manifest, Open Graph, and Twitter metadata. The manifest declares Quant Lab identity, standalone display behavior, theme colors, and 192/512 application icons.
- Regression coverage verifies the console markup, every public brand asset, content types, cache policy, manifest contract, and social metadata. Official CI run `30723724885` passed Worker tests, quant-core tests, and Wrangler validation on exact implementation SHA `2bce3f332575cdf579d36e17e485b84184cada62`.
- Exact SHA `2bce3f332575cdf579d36e17e485b84184cada62` deployed successfully in workflow run `30723744571`. Its post-deploy production smoke gate fetched the live console, manifest, all eight brand assets, and public status route and passed every assertion.
- Repository and production deployment SHAs were proven aligned at `2bce3f332575cdf579d36e17e485b84184cada62`. No trading logic, strategy evidence, paper accounting, scheduler behavior, or live-capital authority changed.
- Stage 12 is complete. Quant Lab now carries one consistent owner-approved visual identity across the live console, browser surfaces, installed-app surfaces, and link previews.

## Current Action

Design and implement the Stage 13 immutable execution and research contract: signed 1.0x long/short shadow portfolios, conservative short-cost accounting, concurrent hourly candidate forward-paper cycles, broader predeclared directional strategy families, walk-forward evidence, and website visibility. Validate accounting and no-look-ahead behavior before production deployment.

## Steady-State Operating Gate

Quant Lab remains healthy only while:

- repository and production deployment SHAs stay aligned;
- hourly ingestion remains completed-candle-only, gap-free, and duplicate-safe;
- no champion means explicit safe idle with no fallback trade;
- only hostile-judge-qualified evidence can become champion;
- rolling research uses the fixed catalog and immutable daily epochs;
- live-capital qualification remains evidence-only and owner approval remains separate;
- paper accounting stays reconciled;
- public surfaces remain truthful and expose no unsafe controls;
- any verified defect creates one new canonical engineering job with explicit precedence.

## Unified Job Queue

1. `stage-1-truthful-data-foundation` — COMPLETE
2. `stage-2-paper-execution-ledger` — COMPLETE
3. `stage-3-baseline-strategy-bench` — COMPLETE
4. `stage-4-hostile-strategy-judge` — COMPLETE
5. `stage-5-controlled-strategy-factory` — COMPLETE
6. `stage-6-champion-challenger-selection` — COMPLETE
7. `stage-7-forward-paper-operation` — COMPLETE
8. `stage-8-live-capital-qualification` — COMPLETE
9. `stage-9-autonomous-rolling-research` — COMPLETE
10. `stage-10-bounded-historical-bootstrap` — COMPLETE
11. `stage-11-professional-quant-console` — COMPLETE
12. `stage-12-canonical-brand-identity` — COMPLETE
13. `stage-13-directional-shadow-paper-research` — ACTIVE

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
