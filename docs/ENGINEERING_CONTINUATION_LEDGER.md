# Quant Lab Engineering Continuation Ledger

Last updated: 2026-08-01
State: ACTIVE
Operator: Quant Lab AI Operator
Owner: 007

## 1. Mission

Build and operate an autonomous paper-trading laboratory that discovers, rejects, validates, and forward-tests trading strategies until one demonstrates sufficient evidence for a tightly controlled live-capital trial.

Success is not a profitable backtest. Success is a reproducible, cost-adjusted, operationally reliable strategy that survives untouched data, walk-forward testing, adverse conditions, and forward paper execution.

## 2. Authority and Owner Boundary

The AI operator owns routine product, engineering, research, testing, deployment, monitoring, and iteration decisions.

The owner is not required for normal execution. Owner involvement is reserved for:

- account creation or external identity verification;
- credentials or permissions that cannot be created by the operator;
- new paid services or capital expenditure;
- approval of any live-capital deployment;
- changes to maximum capital-at-risk limits.

The operator must report completed work, evidence, unresolved risks, and the next intended action. It must not push routine reversible work back to the owner.

## 3. Operating Doctrine

1. Paper trading only until the live-capital gate is satisfied and owner approval is explicit.
2. No leverage, derivatives, shorting, or complex execution until a simpler system proves insufficient and the added risk is justified.
3. No look-ahead, same-candle execution, hidden survivorship bias, idealized fills, or retroactive threshold changes.
4. Fees, slippage, latency, missing data, duplicate-cycle protection, and operational failures are part of the test.
5. Strategy specifications are bounded, versioned, immutable, reproducible, and linked to parent lineage.
6. The judge, dataset partitions, cost model, and promotion criteria cannot be modified to rescue a candidate after results are known.
7. Failed strategies and incidents become durable evidence. Repeating a known failure without new evidence is prohibited.
8. The website is the canonical operating console and owner visibility layer.
9. The public website must reveal no secrets, private credentials, unsafe controls, or misleading performance claims.
10. Live capital is never implied, assumed, or automatically authorized.

## 4. Current Verified State

Completed foundation:

- Cloudflare Worker is deployed and online.
- D1 is connected.
- Authenticated MCP and bounded execution kernel exist.
- GitHub inspection, mutation, CI, deployment, migration, and production-SHA controls exist.
- Deterministic Python core exists for indicators, strategy specifications, backtests, and judge evidence.
- Current strategy boundary supports BTC-USD and ETH-USD, 1-hour timeframe, and long/cash direction.
- Market candle and operator receipt tables exist.
- The website currently shows only environment, phase, and the latest stored BTC-USD 1-hour candle.

Missing operating system:

- no scheduled market-data ingestion;
- no autonomous hourly decision cycle;
- no durable strategy, signal, order, fill, trade, position, portfolio, or experiment state;
- no champion/challenger registry;
- no production paper strategy;
- no forward-performance history;
- no research queue or autonomous improvement loop;
- no useful website operating console.

## 5. Canonical Build Sequence

### Stage 1 — Truthful Data Foundation

Build a provider-independent market-data ingestion boundary for closed BTC-USD 1-hour candles.

Required capabilities:

- fetch only completed candles;
- validate timestamps, OHLC relationships, volume, continuity, and duplicates;
- idempotent inserts and missed-candle backfill;
- provider/source attribution;
- stale-data and gap detection;
- scheduled hourly execution;
- website data-health panel.

Exit gate:

- deterministic tests pass;
- production ingestion runs repeatedly without duplicates;
- gaps and stale data are visible and actionable;
- at least seven consecutive days of reliable production candle collection or an equivalent validated historical backfill plus live proof.

### Stage 2 — Complete Paper Execution Ledger

Build durable D1 records for:

- strategy specifications and versions;
- signals and decisions;
- simulated orders and fills;
- open positions and cash;
- closed trades;
- equity snapshots;
- cycle receipts and incidents.

Execution must occur no earlier than the next available candle after the signal. Fees and slippage must be conservative and explicit.

Exit gate:

- one BTC-USD 1-hour baseline strategy completes an end-to-end production cycle;
- duplicate execution is impossible under replay;
- portfolio accounting reconciles exactly;
- website displays current strategy, position, cash, equity, latest decision, and cycle health.

### Stage 3 — Baseline Strategy Bench

Run fixed, simple baselines before broad experimentation:

- cash;
- buy and hold;
- trend following;
- momentum;
- mean reversion;
- bounded EMA, RSI, and price-change combinations.

Exit gate:

- each baseline has reproducible evidence hashes;
- all results include costs and benchmark comparisons;
- weak baselines are retained as evidence, not silently discarded.

### Stage 4 — Hardened Judge

Upgrade evaluation beyond a single chronological split.

Required tests:

- locked train, validation, and untouched test partitions;
- rolling walk-forward evaluation;
- bull, bear, sideways, volatile, and low-volatility regime slices where data permits;
- fee and slippage stress tests;
- parameter-neighborhood sensitivity;
- minimum trade and exposure sufficiency;
- turnover and complexity penalties;
- bootstrap or Monte Carlo stability analysis;
- comparison against cash, buy-and-hold, parent, and current champion.

Exit gate:

- judge configuration is versioned and immutable per experiment;
- candidate code cannot modify its own judge or success criteria;
- deliberately overfit fixtures are rejected in tests.

### Stage 5 — Champion/Challenger Research Engine

Create a controlled strategy factory with:

- explicit hypotheses;
- bounded parameter spaces;
- immutable lineage;
- experiment queue;
- rejection reasons;
- champion, challenger, retired, and disqualified states;
- promotion gates based on unseen evidence and risk-adjusted improvement.

Exit gate:

- the system can generate or select a bounded candidate, evaluate it, record the decision, and choose the next research action without owner intervention;
- no candidate is promoted from train performance alone.

### Stage 6 — Forward Paper Operations

Run the selected champion against new market data with decisions locked before outcomes exist.

Website must expose:

- equity and benchmark curves;
- open and closed positions;
- trade ledger;
- net return after costs;
- expectancy, profit factor, drawdown, Sharpe, Sortino, exposure, turnover, and win/loss distribution;
- performance by regime;
- operational uptime, missed cycles, data gaps, and incidents;
- champion/challenger status and recent research decisions.

Exit gate:

- continuous forward operation is reliable;
- accounting and execution incidents are resolved and prevented from recurring;
- performance evidence is sufficiently mature for the qualification clock.

### Stage 7 — Autonomous Diagnosis and Improvement

Each cycle must distinguish:

- operational failure;
- data failure;
- accounting failure;
- execution-model failure;
- statistical deterioration;
- strategy underperformance;
- normal variance.

The system must choose and execute the next bounded action: retry, repair, pause, retire, test a challenger, or continue gathering evidence.

Exit gate:

- routine incidents are diagnosed, repaired, verified, recorded, and prevented without owner intervention;
- the research queue continues autonomously without weakening safeguards.

### Stage 8 — Live-Capital Qualification

Provisional minimum evidence gate:

- at least 90 consecutive days of forward paper operation;
- at least 100 closed trades, unless a lower-frequency design requires a longer observation period;
- positive net expectancy after conservative costs;
- profit factor greater than 1.25;
- acceptable maximum drawdown relative to return;
- evidence across more than one market regime;
- no unresolved data, accounting, execution, or security incidents;
- forward results materially consistent with locked research expectations;
- explicit owner approval.

Initial live trial constraints:

- trivial capital allocation;
- no leverage;
- hard position and daily-loss limits;
- automatic pause on anomalies;
- paper-versus-live execution comparison;
- capital increases only after additional evidence and owner authorization.

These gates may become stricter. They cannot be weakened merely to force launch.

## 6. Website Product Contract

The website serves two audiences through separated surfaces.

### Owner Console

Authenticated and decision-oriented. It must support:

- current objective, stage, completion evidence, and exact next action;
- system health and incidents;
- data freshness and gaps;
- paper portfolio and trade ledger;
- strategy registry and experiment evidence;
- champion/challenger decisions;
- performance and benchmark analysis;
- bounded pause/resume or owner-only approval controls where justified.

### Public Proof Surface

Read-only and deliberately limited. It may show truthful delayed or aggregated information such as:

- paper-only status;
- system uptime and current development stage;
- methodology and safeguards;
- selected non-sensitive performance evidence after sufficient maturity.

It must never expose secrets, private strategy parameters during active research, unsafe mutation controls, or claims implying guaranteed returns.

## 7. Reporting Contract

After each material work unit, the operator reports:

- what was completed;
- direct validation evidence;
- what remains;
- any risk or failure discovered;
- the single next intended action.

The owner does not need to approve routine continuation. The operator proceeds unless the next action crosses an owner-only boundary.

## 8. Current Active Stage

Stage 1 — Truthful Data Foundation.

Current objective:

Build the production BTC-USD 1-hour closed-candle ingestion and health system, then expose its state on the website.

Immediate next action:

Design the D1 data-health state and scheduled ingestion boundary, select a free reliable market-data source compatible with Cloudflare Workers, implement deterministic validation and idempotent backfill, test through GitHub Actions, deploy, and verify on the live website.
