import test from "node:test";
import assert from "node:assert/strict";

import {
  HISTORICAL_BOOTSTRAP_POLICY,
  buildHistoricalBootstrapPlan,
} from "../src/historicalBootstrap.js";

const EXPECTED = "2026-08-01T20:00:00.000Z";
const HOUR_MS = 60 * 60 * 1000;

function closes(count, end = EXPECTED) {
  const endMs = Date.parse(end);
  return Array.from({ length: count }, (_, index) =>
    new Date(endMs - (count - 1 - index) * HOUR_MS).toISOString());
}

test("historical bootstrap policy is immutable and bounded", () => {
  assert.equal(Object.isFrozen(HISTORICAL_BOOTSTRAP_POLICY), true);
  assert.equal(Object.isFrozen(HISTORICAL_BOOTSTRAP_POLICY.provider_order), true);
  assert.equal(HISTORICAL_BOOTSTRAP_POLICY.target_contiguous_candles, 4320);
  assert.equal(HISTORICAL_BOOTSTRAP_POLICY.window_hours, 100);
  assert.equal(HISTORICAL_BOOTSTRAP_POLICY.max_windows_per_attempt, 4);
  assert.deepEqual(HISTORICAL_BOOTSTRAP_POLICY.provider_order, [
    "coinbase_exchange",
    "binance_us_exact_fallback",
  ]);
  assert.equal(HISTORICAL_BOOTSTRAP_POLICY.completed_candles_only, true);
  assert.equal(HISTORICAL_BOOTSTRAP_POLICY.backward_only, true);
  assert.equal(HISTORICAL_BOOTSTRAP_POLICY.overwrite_allowed, false);
  assert.equal(HISTORICAL_BOOTSTRAP_POLICY.synthetic_interpolation_allowed, false);
  assert.equal(HISTORICAL_BOOTSTRAP_POLICY.paid_data_allowed, false);
  assert.equal(HISTORICAL_BOOTSTRAP_POLICY.research_artifact_creation_allowed, false);
  assert.equal(HISTORICAL_BOOTSTRAP_POLICY.live_capital_enabled, false);
});

test("76 candles plans four adjacent 100-hour backward windows", () => {
  const plan = buildHistoricalBootstrapPlan(closes(76), EXPECTED);
  assert.equal(plan.state, "in_progress");
  assert.equal(plan.contiguous_candle_count, 76);
  assert.equal(plan.windows.length, 4);
  assert.deepEqual(plan.windows.map((window) => window.requested_hours), [100, 100, 100, 100]);
  assert.equal(
    Date.parse(plan.windows[0].end_closed_at),
    Date.parse(plan.earliest_contiguous_closed_at) - HOUR_MS,
  );
  assert.equal(
    Date.parse(plan.windows[1].end_closed_at),
    Date.parse(plan.windows[0].start_closed_at) - HOUR_MS,
  );
  assert.equal(Date.parse(plan.windows[0].end_closed_at) < Date.parse(plan.earliest_contiguous_closed_at), true);
});

test("4076 candles plans the exact remaining 100, 100, and 44 hours", () => {
  const plan = buildHistoricalBootstrapPlan(closes(4076), EXPECTED);
  assert.equal(plan.state, "in_progress");
  assert.deepEqual(plan.windows.map((window) => window.requested_hours), [100, 100, 44]);
  const total = plan.windows.reduce((sum, window) => sum + window.requested_hours, 0);
  assert.equal(total, 244);
});

test("4320 contiguous candles stop bootstrap with no windows", () => {
  const plan = buildHistoricalBootstrapPlan(closes(4320), EXPECTED);
  assert.equal(plan.state, "complete");
  assert.equal(plan.contiguous_candle_count, 4320);
  assert.deepEqual(plan.blocker_codes, []);
  assert.deepEqual(plan.windows, []);
});

test("missing latest completed candle blocks backward work", () => {
  const staleEnd = "2026-08-01T19:00:00.000Z";
  const plan = buildHistoricalBootstrapPlan(closes(100, staleEnd), EXPECTED);
  assert.equal(plan.state, "blocked");
  assert.deepEqual(plan.blocker_codes, ["latest_completed_candle_missing"]);
  assert.equal(plan.latest_closed_at, staleEnd);
  assert.deepEqual(plan.windows, []);
});

test("internal gap uses only the contiguous trailing suffix", () => {
  const values = closes(300);
  values.splice(100, 1);
  const plan = buildHistoricalBootstrapPlan(values, EXPECTED);
  assert.equal(plan.state, "in_progress");
  assert.equal(plan.contiguous_candle_count, 199);
  assert.equal(plan.earliest_contiguous_closed_at, values[100]);
  assert.equal(
    Date.parse(plan.windows[0].end_closed_at),
    Date.parse(plan.earliest_contiguous_closed_at) - HOUR_MS,
  );
});

test("same history produces deterministic bootstrap windows", () => {
  const first = buildHistoricalBootstrapPlan(closes(76), EXPECTED);
  const second = buildHistoricalBootstrapPlan(closes(76), EXPECTED);
  assert.deepEqual(first, second);
});
