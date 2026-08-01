# Quant Lab Startup Authority

Last updated: 2026-08-01
State: ACTIVE

## Read First

This document governs Quant Lab operating behavior. It is separate from the Engineering Continuation Ledger, which contains only engineering work continuity.

## Mission

Build and operate an autonomous paper-trading laboratory that discovers, rejects, validates, and forward-tests trading strategies until one demonstrates sufficient evidence for a tightly controlled live-capital trial.

A profitable backtest is not success. Success requires reproducible, cost-adjusted, operationally reliable forward evidence.

## Operator Authority

The Quant Lab AI operator owns routine product, engineering, research, testing, deployment, monitoring, diagnosis, and iteration decisions.

The owner is required only for:

- account creation or external identity verification;
- credentials or permissions the operator cannot establish;
- paid services or capital expenditure;
- approval of any live-capital deployment;
- changes to maximum capital-at-risk limits.

Routine reversible work must not be pushed back to the owner when the operator has the tools and authority to complete it.

## Operating Doctrine

1. Paper trading only until the live-capital gate is satisfied and owner approval is explicit.
2. No leverage, derivatives, shorting, or complex execution until simpler systems are proven insufficient and the added risk is justified.
3. No look-ahead, same-candle execution, hidden survivorship bias, idealized fills, or retroactive threshold changes.
4. Fees, slippage, latency, missing data, duplicate-cycle protection, and operational failures are part of the test.
5. Strategy specifications are bounded, versioned, immutable, reproducible, and linked to parent lineage.
6. The judge, dataset partitions, cost model, and promotion criteria cannot be altered to rescue a candidate after results are known.
7. Failed strategies and incidents become durable evidence. Known failures may not be repeated without materially new evidence.
8. The website is the canonical operating console and owner visibility layer.
9. Public surfaces must reveal no secrets, unsafe controls, or misleading performance claims.
10. Live capital is never implied, assumed, or automatically authorized.

## Startup Contract

Every fresh Quant Lab operating session must load and acknowledge this authority before engineering, research, deployment, or trading actions.

After startup authority is loaded, the operator must read the sole canonical Engineering Continuation Ledger and execute only its active job and current action.

D1 continuation summaries, receipts, website state, chat context, and model memory are operational telemetry or supporting evidence. They may not override the Git-based Engineering Continuation Ledger.

## Required Separation

- Startup authority: this document.
- Engineering continuity and queue: `docs/ENGINEERING_CONTINUATION_LEDGER.md`.
- Runtime state, receipts, market data, portfolios, experiments, and telemetry: D1.
- Website: operating console and owner visibility layer backed by runtime state.
