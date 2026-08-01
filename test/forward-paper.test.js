import assert from "node:assert/strict";
import test from "node:test";
import {
  FORWARD_OPERATION_POLICY,
  buildForwardCyclePlan,
  championSignal,
} from "../src/forwardPaper.js";

const START = Date.parse("2026-08-01T10:00:00.000Z");

function candles(closes) {
  return closes.map((close, index) => {
    const open = index === 0 ? close : closes[index - 1];
    return {
      market: "BTC-USD",
      interval: "1h",
      closed_at: new Date(START + index * 60 * 60 * 1000).toISOString(),
      open,
      high: Math.max(open, close) + 1,
      low: Math.min(open, close) - 1,
      close,
      volume: 100,
      source: "test",
    };
  });
}

function selection(champion = "candidate-ema-test") {
  return {
    id: "selection-batch",
    state: champion ? "champion_selected" : "no_champion",
    champion_candidate_id: champion,
  };
}

function account(overrides = {}) {
  return {
    paper_only: true,
    live_capital_enabled: false,
    accounting_reconciled: true,
    cash_balance: 10000,
    position_quantity: 0,
    ...overrides,
  };
}

function emaSpec(overrides = {}) {
  return {
    id: "candidate-ema-test",
    kind: "ema_cross",
    parameters: { fast: 2, slow: 3 },
    ...overrides,
  };
}

function planInput(rows, overrides = {}) {
  return {
    cycleId: `forward-operation:${rows.at(-1).closed_at}`,
    scheduledAt: new Date(Date.parse(rows.at(-1).closed_at) + 5 * 60 * 1000).toISOString(),
    expectedClosedAt: rows.at(-1).closed_at,
    ingestionError: null,
    selection: selection(),
    championSpec: emaSpec(),
    account: account(),
    candles: rows,
    ...overrides,
  };
}

test("forward policy is frozen, paper-only, hourly, and uses fixed allocation", () => {
  assert.equal(FORWARD_OPERATION_POLICY.one_cycle_per_expected_close, true);
  assert.equal(FORWARD_OPERATION_POLICY.buy_allocation_percent_of_cash, 10);
  assert.equal(FORWARD_OPERATION_POLICY.sell_allocation_percent_of_position, 100);
  assert.equal(FORWARD_OPERATION_POLICY.hold_creates_paper_order, false);
  assert.equal(FORWARD_OPERATION_POLICY.live_capital_enabled, false);
  assert.equal(FORWARD_OPERATION_POLICY.leverage_enabled, false);
  assert.equal(FORWARD_OPERATION_POLICY.shorting_enabled, false);
  assert.throws(() => {
    FORWARD_OPERATION_POLICY.buy_allocation_percent_of_cash = 100;
  }, TypeError);
});

test("healthy data with no qualified champion records a blocked idle plan", () => {
  const rows = candles([100, 101]);
  const plan = buildForwardCyclePlan(planInput(rows, {
    selection: selection(null),
    championSpec: null,
    account: null,
  }));
  assert.equal(plan.state, "blocked_no_champion");
  assert.equal(plan.market_data_status, "healthy");
  assert.deepEqual(plan.blocker_codes, ["no_qualified_champion"]);
  assert.equal(plan.decision, null);
  assert.equal(plan.paper_decision, null);
});

test("ingestion failures, missing expected candles, and gaps block before selection", () => {
  const rows = candles([100, 101, 102]);
  const ingestion = buildForwardCyclePlan(planInput(rows, {
    ingestionError: "market_data_http_429",
    selection: selection(null),
  }));
  assert.equal(ingestion.state, "blocked_data_unhealthy");
  assert.ok(ingestion.blocker_codes.includes("ingestion_error:market_data_http_429"));

  const missing = buildForwardCyclePlan(planInput(rows, {
    expectedClosedAt: new Date(Date.parse(rows.at(-1).closed_at) + 60 * 60 * 1000).toISOString(),
  }));
  assert.equal(missing.state, "blocked_data_unhealthy");
  assert.ok(missing.blocker_codes.includes("expected_candle_missing"));

  const gappedRows = [rows[0], rows[2]];
  const gap = buildForwardCyclePlan(planInput(gappedRows));
  assert.equal(gap.state, "blocked_data_unhealthy");
  assert.ok(gap.blocker_codes.includes("market_data_gap"));
});

test("EMA bullish cross buys ten percent of cash using only pre-execution candles", () => {
  const rows = candles([3, 2, 1, 4, 999]);
  const plan = buildForwardCyclePlan(planInput(rows));
  assert.equal(plan.state, "hold");
  assert.equal(plan.decision.action, "buy");
  assert.equal(plan.decision.reason_code, "ema_bullish_cross");
  assert.equal(plan.decision.signal_closed_at, rows[3].closed_at);
  assert.equal(plan.decision.execution_candle_closed_at, rows[4].closed_at);
  assert.equal(plan.decision.requested_notional, 1000);
  assert.equal(plan.paper_decision.requested_notional_usd, 1000);
  assert.equal(plan.paper_decision.signal_closed_at, rows[3].closed_at);
  assert.equal(plan.paper_decision.decision_at, rows[3].closed_at);

  const changedExecution = structuredClone(rows);
  changedExecution[4].close = 1;
  changedExecution[4].low = 0.5;
  const unchanged = buildForwardCyclePlan(planInput(changedExecution));
  assert.equal(unchanged.decision.action, "buy");
  assert.equal(unchanged.decision.reason_code, "ema_bullish_cross");
});

test("EMA bearish cross sells the full existing position", () => {
  const rows = candles([1, 2, 3, 0.5, 0.5]);
  const plan = buildForwardCyclePlan(planInput(rows, {
    account: account({ cash_balance: 5000, position_quantity: 0.75 }),
  }));
  assert.equal(plan.decision.action, "sell");
  assert.equal(plan.decision.reason_code, "ema_bearish_cross");
  assert.equal(plan.decision.requested_quantity, 0.75);
  assert.equal(plan.paper_decision.requested_quantity, 0.75);
});

test("RSI entries and exits are long-only and use the fixed full-position exit", () => {
  const buy = championSignal({
    id: "candidate-rsi",
    kind: "rsi_mean_reversion",
    parameters: { period: 2, entry_below: 30, exit_above: 70 },
  }, candles([10, 5, 1]), 0);
  assert.deepEqual(buy, { action: "buy", reason_code: "rsi_entry" });

  const sell = championSignal({
    id: "candidate-rsi",
    kind: "rsi_mean_reversion",
    parameters: { period: 2, entry_below: 30, exit_above: 70 },
  }, candles([1, 5, 10]), 2);
  assert.deepEqual(sell, { action: "sell", reason_code: "rsi_exit" });
});

test("no signal creates a durable hold decision but no paper order", () => {
  const rows = candles([1, 1, 1]);
  const plan = buildForwardCyclePlan(planInput(rows, {
    championSpec: emaSpec({ parameters: { fast: 2, slow: 10 } }),
  }));
  assert.equal(plan.state, "hold");
  assert.equal(plan.decision.action, "hold");
  assert.equal(plan.decision.reason_code, "insufficient_ema_history");
  assert.equal(plan.paper_decision, null);
});

test("invalid champion and unreconciled paper account fail closed without decisions", () => {
  const rows = candles([100, 101, 102]);
  const mismatched = buildForwardCyclePlan(planInput(rows, {
    championSpec: emaSpec({ id: "wrong" }),
  }));
  assert.equal(mismatched.state, "blocked_invalid_champion");
  assert.equal(mismatched.decision, null);

  const unsupported = buildForwardCyclePlan(planInput(rows, {
    championSpec: { id: "candidate-ema-test", kind: "unsupported", parameters: {} },
  }));
  assert.equal(unsupported.state, "blocked_invalid_champion");
  assert.ok(unsupported.blocker_codes.includes("forward_champion_kind_unsupported"));

  const unreconciled = buildForwardCyclePlan(planInput(rows, {
    account: account({ accounting_reconciled: false }),
  }));
  assert.equal(unreconciled.state, "blocked_invalid_champion");
  assert.ok(unreconciled.blocker_codes.includes("paper_account_unavailable_or_unreconciled"));
});
