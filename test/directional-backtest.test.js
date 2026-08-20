import test from "node:test";
import assert from "node:assert/strict";
import { DIRECTIONAL_POSITION_HOLD_POLICY_ID, compileDirectionalSignal, runDirectionalExecutionPolicyComparison, runDirectionalWalkForward, runDirectionalWindow } from "../src/directionalBacktest.js";
import { DIRECTIONAL_RESEARCH_POLICY, buildWalkForwardWindows } from "../src/directionalResearch.js";
import { DIRECTIONAL_STRATEGIES, directionalSignal } from "../src/directionalShadow.js";

// Keep the full institutional workload covered so prefix-slicing CPU blowups cannot return unnoticed.
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

function oscillatingCandles(count = 320) {
  const start = Date.parse("2026-01-01T00:00:00.000Z");
  return Array.from({ length: count }, (_, index) => {
    const center = 100 + Math.sin(index / 5) * 8 + Math.cos(index / 17) * 3 + index * 0.01;
    const open = center + Math.sin(index / 3) * 0.4;
    const close = center + Math.cos(index / 4) * 0.5;
    return {
      closed_at: new Date(start + index * 3600000).toISOString(),
      open,
      high: Math.max(open, close) + 1,
      low: Math.min(open, close) - 1,
      close,
      volume: 10 + index,
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

test("compiled signal evaluation preserves canonical directional semantics", () => {
  const rows = oscillatingCandles();
  const executionIndexes = [2, 8, 20, 56, 100, 180, 319];
  const exposures = [-1, -0.37, 0, 0.42, 1];
  for (const strategy of DIRECTIONAL_STRATEGIES) {
    const compiled = compileDirectionalSignal(strategy, rows);
    for (const executionIndex of executionIndexes) {
      for (const exposure of exposures) {
        const expected = directionalSignal(strategy, rows.slice(0, executionIndex), exposure).target_exposure;
        assert.equal(compiled(executionIndex, exposure), expected, `${strategy.id}:${executionIndex}:${exposure}`);
      }
    }
  }
});

test("completes the full twelve-candidate institutional workload", () => {
  const windows = buildWalkForwardWindows(candles());
  const result = runDirectionalWalkForward({
    windows,
    strategies: DIRECTIONAL_STRATEGIES,
    policy: DIRECTIONAL_RESEARCH_POLICY,
  });
  assert.equal(result.length, 12);
  assert.equal(result.reduce((sum, candidate) => sum + candidate.windows.length, 0), 60);
});

test("v1 intentionally rebalances unchanged directional exposure and records economic partial reductions", () => {
  const result = runDirectionalWindow({
    window: buildWalkForwardWindows(candles())[0],
    strategy: ema,
    policy: DIRECTIONAL_RESEARCH_POLICY,
  });
  // directional-walk-forward-v1 targets 1.0x marked gross exposure each execution candle.
  // On this monotonic fixture the EMA signal remains long, yet price/equity drift changes the
  // target quantity. Those adjustments are actual simulated fills with fees/slippage, and
  // same-sign quantity reductions are intentionally included in closed_trade_count. The metric
  // therefore measures realized reduction/closure events, not independent round-trip trades.
  assert.ok(result.fill_count > 400);
  assert.ok(result.closed_trade_count > 400);
  assert.ok(result.total_fees > 0);
});

test("position-hold v2 removes recurring same-direction rebalance fills without changing the signal", () => {
  const windows = buildWalkForwardWindows(candles());
  const v2Policy = Object.freeze({ ...DIRECTIONAL_RESEARCH_POLICY, id: DIRECTIONAL_POSITION_HOLD_POLICY_ID });
  const comparison = runDirectionalExecutionPolicyComparison({
    windows: [windows[0]],
    strategy: ema,
    policyV1: DIRECTIONAL_RESEARCH_POLICY,
    policyV2: v2Policy,
  })[0];
  assert.ok(comparison.v1.fill_count > 400);
  assert.equal(comparison.v2.fill_count, 2);
  assert.equal(comparison.v2.closed_trade_count, 1);
  // Fewer fills must reduce direct fee/slippage drag, but total traded notional is path-dependent:
  // on a strong rising path, a held position can finish larger than one continuously trimmed to 1.0x.
  // Turnover reduction is therefore an empirical paired-study outcome, not a unit-test invariant.
  assert.ok(Number.isFinite(comparison.v1.turnover_notional));
  assert.ok(Number.isFinite(comparison.v2.turnover_notional));
  assert.ok(Number.isFinite(comparison.v1.total_fees));
  assert.ok(Number.isFinite(comparison.v2.total_fees));
  assert.ok(Number.isFinite(comparison.v1.total_slippage));
  assert.ok(Number.isFinite(comparison.v2.total_slippage));
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
