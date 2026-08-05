import test from "node:test";
import assert from "node:assert/strict";
import { runDirectionalWalkForward, runDirectionalWindow } from "../src/directionalBacktest.js";
import { DIRECTIONAL_RESEARCH_POLICY, buildWalkForwardWindows } from "../src/directionalResearch.js";

function candles(count = 4320, mode = "rise") {
  const start = Date.parse("2026-01-01T00:00:00.000Z");
  return Array.from({ length: count }, (_, index) => {
    const base = mode === "rise" ? 100 + index * 0.2 : 1000 - index * 0.1;
    return {
      closed_at: new Date(start + index * 3600000).toISOString(),
      open: base,
      high: base + 1,
      low: base - 1,
      close: mode === "rise" ? base + 0.25 : base - 0.25,
      volume: 10,
    };
  });
}

const ema = { id: "test-ema", family: "ema_trend", parameters: { fast: 3, slow: 8 } };

test("runs all supplied strategies across all immutable walk-forward windows", () => {
  const windows = buildWalkForwardWindows(candles());
  const result = runDirectionalWalkForward({ windows, strategies: [ema], policy: DIRECTIONAL_RESEARCH_POLICY });
  assert.equal(result.length, 1);
  assert.equal(result[0].windows.length, 5);
  assert.equal(result[0].candidate_id, "test-ema");
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result[0].windows));
});

test("uses next-candle execution and fully liquidates evidence at the end of a window", () => {
  const window = buildWalkForwardWindows(candles())[0];
  const result = runDirectionalWindow({ window, strategy: ema, policy: DIRECTIONAL_RESEARCH_POLICY });
  assert.equal(result.execution_model, "next_completed_candle_open");
  assert.ok(result.fill_count >= 2);
  assert.ok(result.closed_trade_count >= 1);
  assert.ok(Number.isFinite(result.ending_equity));
});

test("persists independent base, doubled, and tripled cost replays", () => {
  const window = buildWalkForwardWindows(candles())[0];
  const result = runDirectionalWindow({ window, strategy: ema, policy: DIRECTIONAL_RESEARCH_POLICY });
  assert.ok(Number.isFinite(result.test_return_percent));
  assert.ok(Number.isFinite(result.doubled_cost_return_percent));
  assert.ok(Number.isFinite(result.tripled_cost_return_percent));
  assert.notEqual(result.test_return_percent, result.tripled_cost_return_percent);
});

test("short exposure incurs explicit carry", () => {
  const window = buildWalkForwardWindows(candles(4320, "fall"))[0];
  const result = runDirectionalWindow({ window, strategy: ema, policy: DIRECTIONAL_RESEARCH_POLICY });
  assert.ok(result.total_carry > 0);
  assert.ok(result.total_fees > 0);
});

test("rejects missing policy and malformed strategy inputs instead of manufacturing evidence", () => {
  const windows = buildWalkForwardWindows(candles());
  assert.throws(() => runDirectionalWalkForward({ windows, strategies: [ema] }), /directional_policy_required/);
  assert.throws(() => runDirectionalWalkForward({ windows, strategies: [], policy: DIRECTIONAL_RESEARCH_POLICY }), /directional_strategies_required/);
});
