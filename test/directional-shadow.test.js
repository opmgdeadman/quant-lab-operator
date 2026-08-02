import assert from "node:assert/strict";
import test from "node:test";

import {
  DIRECTIONAL_SHADOW_POLICY,
  DIRECTIONAL_STRATEGIES,
  applySignedRebalance,
  directionalSignal,
} from "../src/directionalShadow.js";

function portfolio(overrides = {}) {
  return {
    id: "shadow:test",
    candidate_id: "test",
    initial_equity: 10000,
    cash_balance: 10000,
    position_quantity: 0,
    average_entry: 0,
    realized_pnl: 0,
    unrealized_pnl: 0,
    total_fees: 0,
    total_carry: 0,
    equity: 10000,
    peak_equity: 10000,
    max_drawdown_percent: 0,
    gross_exposure_multiple: 0,
    version: 0,
    last_mark_price: null,
    last_marked_at: null,
    ...overrides,
  };
}

function candles(closes) {
  return closes.map((close, index) => ({
    pair: "BTC-USD",
    interval: "1h",
    closed_at: new Date(Date.UTC(2026, 0, 1, index)).toISOString(),
    open: close,
    high: close + 2,
    low: close - 2,
    close,
    volume: 1,
    source: "test",
  }));
}

test("directional catalog is fixed, diversified, and capped at 1x", () => {
  assert.equal(DIRECTIONAL_SHADOW_POLICY.max_entry_gross_exposure_multiple, 1);
  assert.equal(DIRECTIONAL_SHADOW_POLICY.live_capital_enabled, false);
  assert.equal(DIRECTIONAL_STRATEGIES.length, 12);
  assert.deepEqual(
    [...new Set(DIRECTIONAL_STRATEGIES.map((item) => item.family))].sort(),
    [
      "bollinger_mean_reversion",
      "donchian_breakout",
      "ema_trend",
      "price_momentum",
      "rsi_mean_reversion",
      "volatility_breakout",
    ],
  );
  assert.ok(DIRECTIONAL_STRATEGIES.every((item) => Math.abs(item.target_exposure_multiple) <= 1));
  assert.throws(() => {
    DIRECTIONAL_STRATEGIES.push({});
  }, TypeError);
});

test("EMA strategy can express long and short targets", () => {
  const spec = DIRECTIONAL_STRATEGIES.find((item) => item.id === "shadow-ema-8-24-v1");
  const rising = directionalSignal(spec, candles(Array.from({ length: 30 }, (_, index) => 100 + index)));
  const falling = directionalSignal(spec, candles(Array.from({ length: 30 }, (_, index) => 130 - index)));
  assert.equal(rising.target_exposure, 1);
  assert.equal(falling.target_exposure, -1);
});

test("long paper exposure earns marked profit without exceeding entry equity", () => {
  const result = applySignedRebalance({
    portfolio: portfolio(),
    targetExposure: 1,
    executionPrice: 100,
    markPrice: 110,
    hoursElapsed: 1,
  });
  assert.ok(result.position_quantity > 0);
  assert.ok(result.equity > 10000);
  assert.ok(result.fee > 0);
  assert.equal(result.carry, 0);
  assert.ok(result.entry_gross_exposure_multiple <= 1 + 1e-7);
  assert.ok(Math.abs(result.position_quantity * result.execution_price) < 10000);
});

test("short paper exposure earns when price falls and pays explicit carry", () => {
  const opened = applySignedRebalance({
    portfolio: portfolio(),
    targetExposure: -1,
    executionPrice: 100,
    markPrice: 100,
    hoursElapsed: 1,
  });
  const marked = applySignedRebalance({
    portfolio: portfolio({
      cash_balance: opened.cash_balance,
      position_quantity: opened.position_quantity,
      average_entry: opened.average_entry,
      realized_pnl: opened.realized_pnl,
      unrealized_pnl: opened.unrealized_pnl,
      total_fees: opened.total_fees,
      total_carry: opened.total_carry,
      equity: opened.equity,
      peak_equity: opened.peak_equity,
      max_drawdown_percent: opened.max_drawdown_percent,
      gross_exposure_multiple: opened.gross_exposure_multiple,
      version: 1,
      last_mark_price: 100,
      last_marked_at: "2026-01-01T00:00:00.000Z",
    }),
    targetExposure: -1,
    executionPrice: 100,
    markPrice: 90,
    hoursElapsed: 1,
  });
  assert.ok(marked.position_quantity < 0);
  assert.ok(marked.equity > opened.equity);
  assert.ok(marked.carry > 0);
});

test("flipping from long to short realizes the long position", () => {
  const result = applySignedRebalance({
    portfolio: portfolio({
      cash_balance: 10000,
      position_quantity: 50,
      average_entry: 100,
      equity: 10000,
      peak_equity: 10000,
      gross_exposure_multiple: 0.5,
      version: 1,
    }),
    targetExposure: -1,
    executionPrice: 110,
    markPrice: 110,
    hoursElapsed: 1,
  });
  assert.ok(result.position_quantity < 0);
  assert.ok(result.realized_pnl_delta > 0);
  assert.equal(result.average_entry, result.execution_price);
});

test("exposure above 1x fails closed", () => {
  assert.throws(() => applySignedRebalance({
    portfolio: portfolio(),
    targetExposure: 1.01,
    executionPrice: 100,
    markPrice: 100,
    hoursElapsed: 1,
  }), /exposure_above_1x/);
});
