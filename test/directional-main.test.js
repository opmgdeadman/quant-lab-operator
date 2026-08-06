import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DIRECTIONAL_FORWARD_POLICY, buildDirectionalMainPlan } from "../src/directionalMain.js";

const START = Date.parse("2026-08-06T10:00:00.000Z");
function candles(closes) {
  return closes.map((close, index) => ({
    market: "BTC-USD", interval: "1h", closed_at: new Date(START + index * 3600000).toISOString(),
    open: index ? closes[index - 1] : close, high: Math.max(close, index ? closes[index - 1] : close) + 10,
    low: Math.min(close, index ? closes[index - 1] : close) - 10, close, volume: 100, source: "test",
  }));
}
function portfolio(overrides = {}) {
  return {
    id: "paper-main-directional", initial_equity: 10000, cash_balance: 10000,
    position_quantity: 0, average_entry: 0, realized_pnl: 0, unrealized_pnl: 0,
    total_fees: 0, total_carry: 0, equity: 10000, peak_equity: 10000,
    max_drawdown_percent: 0, gross_exposure_multiple: 0, status: "active", version: 0,
    last_marked_at: null, ...overrides,
  };
}
function selection(champion = null) {
  return champion ? {
    id: "directional-batch:portfolio", batch_id: "directional-batch", state: "portfolio_selected",
    champion_candidate_ids: [champion], cash_is_valid_allocation: true,
  } : {
    id: "directional-batch:portfolio", batch_id: "directional-batch", state: "no_qualified_candidates",
    champion_candidate_ids: [], cash_is_valid_allocation: true,
  };
}
function input(rows, overrides = {}) {
  return {
    cycleId: `directional-forward:${rows.at(-1).closed_at}`,
    expectedClosedAt: rows.at(-1).closed_at, ingestionError: null,
    selection: selection(), candidate: null, portfolio: portfolio(), candles: rows, ...overrides,
  };
}

test("directional forward policy makes institutional selection sole authority", () => {
  assert.equal(DIRECTIONAL_FORWARD_POLICY.authority_source, "directional_institutional_research");
  assert.equal(DIRECTIONAL_FORWARD_POLICY.legacy_selection_authority, false);
  assert.equal(DIRECTIONAL_FORWARD_POLICY.all_cash_when_no_candidate_qualifies, true);
  assert.deepEqual(DIRECTIONAL_FORWARD_POLICY.allowed_directions, ["long", "flat", "short"]);
  assert.equal(DIRECTIONAL_FORWARD_POLICY.max_entry_gross_exposure_multiple, 1);
  assert.equal(DIRECTIONAL_FORWARD_POLICY.live_capital_enabled, false);
});

test("no qualified directional candidate keeps a flat paper-main all cash", () => {
  const rows = candles([100, 101, 102, 103]);
  const plan = buildDirectionalMainPlan(input(rows));
  assert.equal(plan.state, "blocked_no_champion");
  assert.deepEqual(plan.blocker_codes, ["no_qualified_directional_candidate"]);
  assert.equal(plan.transition, null);
});

test("loss of qualification liquidates an existing signed position to cash", () => {
  const rows = candles([100, 99, 98, 97]);
  const open = portfolio({ cash_balance: 10000, position_quantity: -100, average_entry: 100, equity: 10000, peak_equity: 10000 });
  const plan = buildDirectionalMainPlan(input(rows, { portfolio: open }));
  assert.equal(plan.state, "filled");
  assert.equal(plan.decision.target_exposure, 0);
  assert.equal(plan.decision.reason_code, "qualified_only_all_cash_liquidation");
  assert.equal(Math.abs(plan.transition.position_quantity) < 1e-8, true);
});

test("qualified directional champion can enter long and short without exceeding 1x entry exposure", () => {
  const id = "shadow-ema-test";
  const candidate = { id, family: "ema_trend", parameters: { fast: 2, slow: 3 } };
  const longRows = candles([100, 101, 102, 103, 104]);
  const longPlan = buildDirectionalMainPlan(input(longRows, { selection: selection(id), candidate }));
  assert.equal(longPlan.decision.target_exposure, 1);
  assert.equal(longPlan.transition.position_quantity > 0, true);
  assert.equal(longPlan.transition.entry_gross_exposure_multiple <= 1.0000001, true);

  const shortRows = candles([104, 103, 102, 101, 100]);
  const shortPlan = buildDirectionalMainPlan(input(shortRows, { selection: selection(id), candidate }));
  assert.equal(shortPlan.decision.target_exposure, -1);
  assert.equal(shortPlan.transition.position_quantity < 0, true);
  assert.equal(shortPlan.transition.entry_gross_exposure_multiple <= 1.0000001, true);
});

test("migration and operational wrappers retire legacy promotion authority", async () => {
  const migration = await readFile(new URL("../migrations/0016_directional_main_authority.sql", import.meta.url), "utf8");
  for (const table of ["directional_main_portfolios", "directional_forward_cycles", "directional_forward_executions", "directional_forward_scheduler_receipts"]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(migration, /directional_forward_cycle_immutable/);
  const forward = await readFile(new URL("../src/forwardPaper.js", import.meta.url), "utf8");
  assert.match(forward, /return runDirectionalMainForwardCycle\(env, options\)/);
  assert.match(forward, /return runScheduledDirectionalMainForward\(env, scheduledAt\)/);
  const qualification = await readFile(new URL("../src/liveQualification.js", import.meta.url), "utf8");
  assert.match(qualification, /return collectDirectionalQualificationEvidence\(env, asOfClosedAt\)/);
  assert.doesNotMatch(qualification.slice(0, qualification.indexOf("collectLegacyProductionQualificationEvidence")), /FROM selection_batches/);
});
