import test from "node:test";
import assert from "node:assert/strict";
import { runDirectionalWalkForward, runDirectionalWindow } from "../src/directionalBacktest.js";
import { DIRECTIONAL_RESEARCH_POLICY, buildWalkForwardWindows } from "../src/directionalResearch.js";

function candles(count = 4320) {
  const start = Date.parse("2026-01-01T00:00:00.000Z");
  return Array.from({ length: count }, (_, index) => {
    const base = 100 + index * 0.2;
    return {
      closed_at: new Date(start + index * 3600000).toISOString(),
      open: base,
      high: base + 1,
      low: base - 1,
      close: base + 0.25,
      volume: 10,
    };
  });
}

const ema = { id: "test-ema", family: "ema_trend", parameters: { fast: 3, slow: 8 } };

test("runs deterministic next-candle evidence across five walk-forward windows", () => {
  const windows = buildWalkForwardWindows(candles());
  const result = runDirectionalWalkForward({ windows, strategies: [ema], policy: DIRECTIONAL_RESEARCH_POLICY });
  assert.equal(result.length, 1);
  assert.equal(result[0].windows.length, 5);
  for (const evidence of result[0].windows) {
    assert.equal(evidence.execution_model, "next_completed_candle_open");
    assert.ok(Number.isFinite(evidence.test_return_percent));
    assert.ok(Number.isFinite(evidence.doubled_cost_return_percent));
    assert.ok(Number.isFinite(evidence.tripled_cost_return_percent));
    assert.ok(evidence.fill_count >= 1);
  }
});

test("liquidates open exposure at the end of the immutable test window", () => {
  const result = runDirectionalWindow({
    window: buildWalkForwardWindows(candles())[0],
    strategy: ema,
    policy: DIRECTIONAL_RESEARCH_POLICY,
  });
  assert.ok(result.closed_trade_count >= 1);
  assert.ok(result.total_fees > 0);
  assert.ok(Number.isFinite(result.ending_equity));
});

test("fails closed when required research definitions are absent", () => {
  const windows = buildWalkForwardWindows(candles());
  assert.throws(() => runDirectionalWalkForward({ windows, strategies: [ema] }), /directional_policy_required/);
  assert.throws(() => runDirectionalWalkForward({ windows, strategies: [], policy: DIRECTIONAL_RESEARCH_POLICY }), /directional_strategies_required/);
});
