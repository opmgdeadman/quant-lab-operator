import assert from "node:assert/strict";
import test from "node:test";

import {
  createMemoryPaperStore,
  executePaperDecisionWithStore,
  planPaperDecision,
} from "../src/paperLedger.js";

const NOW = new Date("2026-08-01T16:00:00.000Z");

function portfolio(overrides = {}) {
  return {
    id: "paper-main",
    name: "Primary paper portfolio",
    base_currency: "USD",
    initial_cash: 10000,
    cash_balance: 10000,
    realized_pnl: 0,
    total_fees: 0,
    status: "active",
    version: 0,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function position(overrides = {}) {
  return {
    portfolio_id: "paper-main",
    market: "BTC-USD",
    quantity: 0,
    average_cost: 0,
    realized_pnl: 0,
    updated_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function candle(closedAt, open, close = open) {
  return {
    market: "BTC-USD",
    interval: "1h",
    closed_at: closedAt,
    open,
    high: Math.max(open, close) + 2,
    low: Math.min(open, close) - 2,
    close,
    volume: 10,
    source: "test",
  };
}

function buyDecision(overrides = {}) {
  return {
    cycle_id: "cycle-buy-1",
    decision_id: "decision-buy-1",
    portfolio_id: "paper-main",
    market: "BTC-USD",
    action: "buy",
    signal_closed_at: "2026-08-01T12:00:00.000Z",
    decision_at: "2026-08-01T12:00:00.000Z",
    requested_notional_usd: 1000,
    ...overrides,
  };
}

test("buy executes at the next eligible candle open with fees and slippage", async () => {
  const store = createMemoryPaperStore({
    portfolio: portfolio(),
    position: position(),
    candles: [
      candle("2026-08-01T12:00:00.000Z", 98, 100),
      candle("2026-08-01T13:00:00.000Z", 100, 104),
    ],
  });

  const result = await executePaperDecisionWithStore(store, buyDecision(), { now: NOW });

  assert.equal(result.status, "filled");
  assert.equal(result.execution_candle_closed_at, "2026-08-01T13:00:00.000Z");
  assert.equal(result.filled_price, 100.05);
  assert.equal(result.filled_notional, 1000);
  assert.equal(result.fee, 1);
  assert.equal(result.cash_balance, 8999);
  assert.ok(result.position_quantity > 9.99 && result.position_quantity < 10);
  assert.equal(result.reconciled, true);
  assert.equal(store.state.fills[0].fill_time, "2026-08-01T12:00:00.000Z");
  assert.equal(store.state.cashEntries.length, 2);
  assert.equal(store.state.portfolio.version, 1);
});

test("decision latency skips any candle whose open preceded the decision", async () => {
  const store = createMemoryPaperStore({
    portfolio: portfolio(),
    position: position(),
    candles: [
      candle("2026-08-01T12:00:00.000Z", 98, 100),
      candle("2026-08-01T13:00:00.000Z", 100, 101),
      candle("2026-08-01T14:00:00.000Z", 102, 103),
    ],
  });

  const result = await executePaperDecisionWithStore(store, buyDecision({
    cycle_id: "cycle-latency",
    decision_id: "decision-latency",
    decision_at: "2026-08-01T12:05:00.000Z",
  }), { now: NOW });

  assert.equal(result.status, "filled");
  assert.equal(result.execution_candle_closed_at, "2026-08-01T14:00:00.000Z");
  assert.equal(store.state.fills[0].fill_time, "2026-08-01T13:00:00.000Z");
});

test("pending execution creates no ledger mutations and can be retried later", async () => {
  const store = createMemoryPaperStore({
    portfolio: portfolio(),
    position: position(),
    candles: [
      candle("2026-08-01T12:00:00.000Z", 98, 100),
      candle("2026-08-01T13:00:00.000Z", 100, 101),
    ],
  });

  const result = await executePaperDecisionWithStore(store, buyDecision({
    cycle_id: "cycle-pending",
    decision_id: "decision-pending",
    decision_at: "2026-08-01T12:05:00.000Z",
  }), { now: NOW });

  assert.equal(result.status, "pending_execution");
  assert.equal(store.state.receipts.size, 0);
  assert.equal(store.state.orders.size, 0);
  assert.equal(store.state.portfolio.version, 0);
});

test("same cycle replays its immutable receipt without duplicate effects", async () => {
  const store = createMemoryPaperStore({
    portfolio: portfolio(),
    position: position(),
    candles: [
      candle("2026-08-01T12:00:00.000Z", 98, 100),
      candle("2026-08-01T13:00:00.000Z", 100, 104),
    ],
  });
  const decision = buyDecision({ cycle_id: "cycle-replay", decision_id: "decision-replay" });

  const first = await executePaperDecisionWithStore(store, decision, { now: NOW });
  const second = await executePaperDecisionWithStore(store, decision, { now: NOW });

  assert.equal(first.replayed, false);
  assert.equal(second.replayed, true);
  assert.equal(store.state.receipts.size, 1);
  assert.equal(store.state.fills.length, 1);
  assert.equal(store.state.cashEntries.length, 2);
  assert.equal(store.state.portfolio.version, 1);
});

test("same cycle with a changed payload fails closed", async () => {
  const store = createMemoryPaperStore({
    portfolio: portfolio(),
    position: position(),
    candles: [
      candle("2026-08-01T12:00:00.000Z", 98, 100),
      candle("2026-08-01T13:00:00.000Z", 100, 104),
    ],
  });
  const decision = buyDecision({ cycle_id: "cycle-mismatch", decision_id: "decision-mismatch" });
  await executePaperDecisionWithStore(store, decision, { now: NOW });

  await assert.rejects(
    executePaperDecisionWithStore(store, { ...decision, requested_notional_usd: 999 }, { now: NOW }),
    /paper_cycle_payload_mismatch/,
  );
  assert.equal(store.state.fills.length, 1);
});

test("insufficient cash is recorded once as a rejected immutable decision", async () => {
  const store = createMemoryPaperStore({
    portfolio: portfolio({ initial_cash: 50, cash_balance: 50 }),
    position: position(),
    candles: [
      candle("2026-08-01T12:00:00.000Z", 98, 100),
      candle("2026-08-01T13:00:00.000Z", 100, 104),
    ],
  });
  const decision = buyDecision({
    cycle_id: "cycle-no-cash",
    decision_id: "decision-no-cash",
    requested_notional_usd: 100,
  });

  const first = await executePaperDecisionWithStore(store, decision, { now: NOW });
  const replay = await executePaperDecisionWithStore(store, decision, { now: NOW });

  assert.equal(first.status, "rejected");
  assert.equal(first.rejection_reason, "insufficient_cash");
  assert.equal(replay.replayed, true);
  assert.equal(store.state.fills.length, 0);
  assert.equal(store.state.cashEntries.length, 0);
  assert.equal(store.state.portfolio.cash_balance, 50);
  assert.equal(store.state.portfolio.version, 1);
});

test("sell cannot exceed the long position and never creates a short", async () => {
  const store = createMemoryPaperStore({
    portfolio: portfolio({ cash_balance: 8999 }),
    position: position({ quantity: 1, average_cost: 1001 }),
    candles: [
      candle("2026-08-01T12:00:00.000Z", 1000, 1002),
      candle("2026-08-01T13:00:00.000Z", 1005, 1006),
    ],
  });

  const result = await executePaperDecisionWithStore(store, {
    cycle_id: "cycle-oversell",
    decision_id: "decision-oversell",
    portfolio_id: "paper-main",
    market: "BTC-USD",
    action: "sell",
    signal_closed_at: "2026-08-01T12:00:00.000Z",
    decision_at: "2026-08-01T12:00:00.000Z",
    requested_quantity: 2,
  }, { now: NOW });

  assert.equal(result.status, "rejected");
  assert.equal(result.rejection_reason, "insufficient_position");
  assert.equal(store.state.position.quantity, 1);
  assert.equal(store.state.fills.length, 0);
});

test("round trip reconciles cash, realized PnL, fees, and zero position", async () => {
  const store = createMemoryPaperStore({
    portfolio: portfolio(),
    position: position(),
    candles: [
      candle("2026-08-01T12:00:00.000Z", 98, 100),
      candle("2026-08-01T13:00:00.000Z", 100, 108),
      candle("2026-08-01T14:00:00.000Z", 110, 109),
    ],
  });

  const buy = await executePaperDecisionWithStore(store, buyDecision({
    cycle_id: "cycle-roundtrip-buy",
    decision_id: "decision-roundtrip-buy",
  }), { now: NOW });

  const sell = await executePaperDecisionWithStore(store, {
    cycle_id: "cycle-roundtrip-sell",
    decision_id: "decision-roundtrip-sell",
    portfolio_id: "paper-main",
    market: "BTC-USD",
    action: "sell",
    signal_closed_at: "2026-08-01T13:00:00.000Z",
    decision_at: "2026-08-01T13:00:00.000Z",
    requested_quantity: buy.filled_quantity,
  }, { now: NOW });

  assert.equal(sell.status, "filled");
  assert.equal(sell.position_quantity, 0);
  assert.equal(sell.average_cost, 0);
  assert.ok(sell.realized_pnl > 0);
  assert.equal(sell.unrealized_pnl, 0);
  assert.equal(sell.reconciled, true);
  assert.ok(Math.abs(sell.equity - (10000 + sell.realized_pnl)) < 1e-8);
  assert.equal(store.state.fills.length, 2);
  assert.equal(store.state.cashEntries.length, 4);
  assert.equal(store.state.portfolio.version, 2);
});

test("same-candle execution and future or malformed decisions fail closed", async () => {
  const signal = candle("2026-08-01T12:00:00.000Z", 98, 100);

  assert.throws(() => planPaperDecision({
    portfolio: portfolio(),
    position: position(),
    decision: {
      ...buyDecision(),
      requested_quantity: null,
    },
    decisionHash: "sha256:test",
    signalCandle: signal,
    executionCandle: signal,
    createdAt: NOW.toISOString(),
  }), /paper_same_candle_execution_forbidden/);

  const store = createMemoryPaperStore({
    portfolio: portfolio(),
    position: position(),
    candles: [signal, candle("2026-08-01T13:00:00.000Z", 100, 101)],
  });

  await assert.rejects(
    executePaperDecisionWithStore(store, buyDecision({
      cycle_id: "cycle-future",
      decision_id: "decision-future",
      decision_at: "2026-08-01T17:00:00.000Z",
    }), { now: NOW }),
    /paper_decision_in_future/,
  );

  await assert.rejects(
    executePaperDecisionWithStore(store, {
      ...buyDecision({ cycle_id: "cycle-unknown", decision_id: "decision-unknown" }),
      leverage: 2,
    }, { now: NOW }),
    /paper_decision_unknown_field:leverage/,
  );
});

test("portfolio version conflict prevents a stale second transition from committing", async () => {
  const candles = [
    candle("2026-08-01T12:00:00.000Z", 98, 100),
    candle("2026-08-01T13:00:00.000Z", 100, 104),
  ];
  const store = createMemoryPaperStore({
    portfolio: portfolio(),
    position: position(),
    candles,
  });
  const base = {
    portfolio: portfolio(),
    position: position(),
    signalCandle: candles[0],
    executionCandle: candles[1],
    createdAt: NOW.toISOString(),
  };
  const first = planPaperDecision({
    ...base,
    decision: buyDecision({ cycle_id: "cycle-race-a", decision_id: "decision-race-a" }),
    decisionHash: "sha256:race-a",
  });
  const second = planPaperDecision({
    ...base,
    decision: buyDecision({ cycle_id: "cycle-race-b", decision_id: "decision-race-b" }),
    decisionHash: "sha256:race-b",
  });

  await store.commitTransition(first);
  await assert.rejects(store.commitTransition(second), /paper_portfolio_version_conflict/);
  assert.equal(store.state.portfolio.version, 1);
  assert.equal(store.state.receipts.size, 1);
});
