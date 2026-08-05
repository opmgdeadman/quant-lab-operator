import test from "node:test";
import assert from "node:assert/strict";
import {
  buildWalkForwardWindows,
  judgeDirectionalCandidate,
  selectDirectionalPortfolio,
} from "../src/directionalResearch.js";

function candles(count = 4320) {
  const start = Date.parse("2026-01-01T00:00:00.000Z");
  return Array.from({ length: count }, (_, index) => ({
    closed_at: new Date(start + index * 3600000).toISOString(),
    open: 100 + index,
    high: 101 + index,
    low: 99 + index,
    close: 100.5 + index,
    volume: 10,
  }));
}

function passingWindow(overrides = {}) {
  return {
    test_return_percent: 1.2,
    doubled_cost_return_percent: 0.7,
    tripled_cost_return_percent: 0.1,
    test_drawdown_percent: 4,
    closed_trade_count: 3,
    ...overrides,
  };
}

test("builds five immutable overlapping walk-forward windows from 4320 candles", () => {
  const windows = buildWalkForwardWindows(candles());
  assert.equal(windows.length, 5);
  assert.equal(windows[0].train.length, 1440);
  assert.equal(windows[0].validation.length, 480);
  assert.equal(windows[0].test.length, 480);
  assert.equal(windows[1].start_closed_at, candles()[480].closed_at);
  assert.ok(Object.isFrozen(windows));
  assert.ok(Object.isFrozen(windows[0].test));
});

test("rejects gapped history before any research artifact can be produced", () => {
  const rows = candles();
  rows[2000] = { ...rows[2000], closed_at: new Date(Date.parse(rows[2000].closed_at) + 3600000).toISOString() };
  assert.throws(() => buildWalkForwardWindows(rows), /non_contiguous_directional_history/);
});

test("qualifies only evidence that passes historical, stress, integrity, regime, and forward gates", () => {
  const verdict = judgeDirectionalCandidate({
    candidate_id: "candidate-a",
    windows: Array.from({ length: 5 }, () => passingWindow()),
    parameter_fragility_percent: 10,
    evidence_integrity_passed: true,
    regime_coverage_passed: true,
    shadow: { cycle_count: 200, closed_trade_count: 5, return_percent: 1.5, max_drawdown_percent: 3 },
  });
  assert.equal(verdict.verdict, "qualified");
  assert.deepEqual(verdict.reason_codes, []);
});

test("historically valid candidate remains awaiting forward evidence rather than being promoted", () => {
  const verdict = judgeDirectionalCandidate({
    candidate_id: "candidate-b",
    windows: Array.from({ length: 5 }, () => passingWindow()),
    parameter_fragility_percent: 10,
    evidence_integrity_passed: true,
    regime_coverage_passed: true,
    shadow: { cycle_count: 68, closed_trade_count: 1, return_percent: 2, max_drawdown_percent: 2 },
  });
  assert.equal(verdict.verdict, "awaiting_forward_evidence");
  assert.ok(verdict.reason_codes.includes("insufficient_shadow_cycles"));
});

test("tripled-cost failure is a hard historical rejection", () => {
  const verdict = judgeDirectionalCandidate({
    candidate_id: "candidate-c",
    windows: Array.from({ length: 5 }, () => passingWindow({ tripled_cost_return_percent: -1 })),
    parameter_fragility_percent: 10,
    evidence_integrity_passed: true,
    regime_coverage_passed: true,
    shadow: { cycle_count: 300, closed_trade_count: 8, return_percent: 5, max_drawdown_percent: 2 },
  });
  assert.equal(verdict.verdict, "rejected");
  assert.ok(verdict.reason_codes.includes("tripled_cost_stress_failed"));
});

test("selection admits only qualified candidates and permits all-cash outcome", () => {
  const none = selectDirectionalPortfolio([{ candidate_id: "x", verdict: "rejected", metrics: {} }]);
  assert.equal(none.state, "no_qualified_candidates");
  assert.deepEqual(none.champion_candidate_ids, []);
  assert.equal(none.cash_is_valid_allocation, true);

  const qualified = selectDirectionalPortfolio([
    { candidate_id: "b", verdict: "qualified", metrics: { median_test_return_percent: 1, doubled_cost_median_return_percent: 0.5, shadow_return_percent: 1, worst_test_drawdown_percent: 4, parameter_fragility_percent: 20, shadow_max_drawdown_percent: 3 } },
    { candidate_id: "a", verdict: "qualified", metrics: { median_test_return_percent: 2, doubled_cost_median_return_percent: 1, shadow_return_percent: 2, worst_test_drawdown_percent: 3, parameter_fragility_percent: 10, shadow_max_drawdown_percent: 2 } },
  ]);
  assert.deepEqual(qualified.champion_candidate_ids, ["a"]);
  assert.deepEqual(qualified.challenger_candidate_ids, ["b"]);
});
