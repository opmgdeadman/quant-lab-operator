import test from "node:test";
import assert from "node:assert/strict";

import {
  LIVE_QUALIFICATION_POLICY,
  LIVE_QUALIFICATION_REASON_CODES,
  buildLiveCapitalQualification,
  calculateForwardMetrics,
} from "../src/liveQualification.js";

function completeEvidence() {
  return {
    schema: "live_qualification_evidence_v1",
    as_of_closed_at: "2026-08-01T23:00:00.000Z",
    selection_batch_id: "selection-qualified-v1",
    selection_hash: "sha256:selection-qualified",
    selection_state: "champion_selected",
    champion_candidate_id: "candidate-qualified-v1",
    champion_verdict: "qualified",
    forward_cycle_count: 720,
    first_forward_closed_at: "2026-07-03T00:00:00.000Z",
    last_forward_closed_at: "2026-08-01T23:00:00.000Z",
    inclusive_span_days: 30,
    closed_trade_count: 30,
    forward_net_pnl: 250,
    forward_return_percent: 2.5,
    maximum_drawdown_percent: 6,
    doubled_cost_return_percent: 1.25,
    tripled_cost_return_percent: 0.5,
    scheduler_receipt_count: 720,
    scheduler_success_count: 720,
    scheduler_success_rate_percent: 100,
    duplicate_violation_count: 0,
    accounting_reconciled: true,
    cash_ledger_delta: 0,
    simulated_cash_delta: 0,
    simulated_position_delta: 0,
    unresolved_operational_error_count: 0,
    market_data_status: "healthy",
    owner_approval_present: false,
    live_authorized: false,
  };
}

async function assess(evidence = completeEvidence(), id = "qualification:test") {
  return buildLiveCapitalQualification(evidence, {
    assessmentId: id,
    createdAt: "2026-08-02T00:00:00.000Z",
  });
}

test("qualification policy is immutable and cannot authorize live capital", () => {
  assert.equal(Object.isFrozen(LIVE_QUALIFICATION_POLICY), true);
  assert.equal(Object.isFrozen(LIVE_QUALIFICATION_POLICY.output_states), true);
  assert.deepEqual(LIVE_QUALIFICATION_POLICY.output_states, ["not_qualified", "eligible_for_owner_review"]);
  assert.equal(LIVE_QUALIFICATION_POLICY.live_authorization_allowed, false);
  assert.equal(LIVE_QUALIFICATION_POLICY.funding_allowed, false);
  assert.equal(LIVE_QUALIFICATION_POLICY.credential_collection_allowed, false);
  assert.equal(LIVE_QUALIFICATION_POLICY.live_order_execution_allowed, false);
  assert.equal(LIVE_QUALIFICATION_POLICY.owner_approval_is_separate, true);
});

test("complete synthetic evidence reaches owner review without live authorization", async () => {
  const built = await assess();
  assert.equal(built.summary.state, "eligible_for_owner_review");
  assert.deepEqual(built.summary.blocker_codes, []);
  assert.equal(built.summary.eligible_for_owner_review, true);
  assert.equal(built.summary.owner_approval_required, true);
  assert.equal(built.summary.owner_approval_present, false);
  assert.equal(built.summary.live_authorized, false);
  assert.equal(built.summary.funding_allowed, false);
  assert.equal(built.summary.credential_collection_allowed, false);
  assert.equal(built.summary.live_order_execution_allowed, false);
  assert.equal(built.gates.every((gate) => gate.passed === 1), true);
});

test("no-champion production-shaped evidence remains not qualified", async () => {
  const evidence = {
    ...completeEvidence(),
    selection_state: "no_champion",
    champion_candidate_id: null,
    champion_verdict: null,
    forward_cycle_count: 0,
    first_forward_closed_at: null,
    last_forward_closed_at: null,
    inclusive_span_days: 0,
    closed_trade_count: 0,
    forward_net_pnl: 0,
    forward_return_percent: 0,
    doubled_cost_return_percent: -1000000,
    tripled_cost_return_percent: -1000000,
    scheduler_receipt_count: 0,
    scheduler_success_count: 0,
    scheduler_success_rate_percent: 0,
  };
  const built = await assess(evidence, "qualification:no-champion");
  assert.equal(built.summary.state, "not_qualified");
  assert.equal(built.summary.blocker_codes.includes("qualified_champion_missing"), true);
  assert.equal(built.summary.blocker_codes.includes("insufficient_forward_cycles"), true);
  assert.equal(built.summary.blocker_codes.includes("insufficient_forward_duration"), true);
  assert.equal(built.summary.blocker_codes.includes("insufficient_closed_trades"), true);
  assert.equal(built.summary.live_authorized, false);
});

test("every declared qualification reason is exercised by a failing gate", async () => {
  const cases = [
    ["source_identity_invalid", { selection_hash: null }],
    ["qualified_champion_evidence_invalid", { selection_state: "no_champion" }],
    ["insufficient_forward_cycles", { forward_cycle_count: 719 }],
    ["insufficient_forward_duration", {
      forward_cycle_count: 696,
      first_forward_closed_at: "2026-07-04T00:00:00.000Z",
      inclusive_span_days: 29,
    }],
    ["insufficient_closed_trades", { closed_trade_count: 29 }],
    ["forward_return_not_positive", { forward_return_percent: 0 }],
    ["forward_drawdown_exceeds_limit", { maximum_drawdown_percent: 10.01 }],
    ["doubled_cost_stress_failed", { doubled_cost_return_percent: -0.01 }],
    ["tripled_cost_stress_failed", { tripled_cost_return_percent: -0.01 }],
    ["scheduler_reliability_below_gate", {
      scheduler_success_count: 716,
      scheduler_success_rate_percent: (716 / 720) * 100,
    }],
    ["market_data_unhealthy", { market_data_status: "stale" }],
    ["duplicate_safety_violation", { duplicate_violation_count: 1 }],
    ["accounting_not_reconciled", { simulated_cash_delta: 0.02 }],
    ["unresolved_operational_errors", { unresolved_operational_error_count: 1 }],
  ];

  for (const [reason, override] of cases) {
    const built = await assess({ ...completeEvidence(), ...override }, `qualification:${reason}`);
    assert.equal(built.summary.state, "not_qualified", reason);
    assert.equal(built.summary.blocker_codes.includes(reason), true, reason);
  }
  for (const reason of LIVE_QUALIFICATION_REASON_CODES) {
    assert.equal(cases.some(([candidate]) => candidate === reason)
      || reason === "qualified_champion_missing", true, `untested reason ${reason}`);
  }
});

test("assessment and evidence hashes are deterministic", async () => {
  const first = await buildLiveCapitalQualification(completeEvidence(), {
    assessmentId: "qualification:deterministic",
    createdAt: "2026-08-02T00:00:00.000Z",
  });
  const second = await buildLiveCapitalQualification(completeEvidence(), {
    assessmentId: "qualification:deterministic",
    createdAt: "2026-08-03T00:00:00.000Z",
  });
  assert.equal(first.policy.policy_hash, second.policy.policy_hash);
  assert.equal(first.summary.evidence_hash, second.summary.evidence_hash);
  assert.equal(first.summary.assessment_hash, second.summary.assessment_hash);
});

test("malformed and conflicting evidence fails closed", async () => {
  const malformed = [
    [{ ...completeEvidence(), schema: "wrong" }, "qualification_evidence_schema_invalid"],
    [{ ...completeEvidence(), first_forward_closed_at: null }, "qualification_forward_boundaries_required"],
    [{ ...completeEvidence(), inclusive_span_days: 29 }, "qualification_forward_span_conflict"],
    [{ ...completeEvidence(), scheduler_success_count: 721 }, "qualification_scheduler_counts_invalid"],
    [{ ...completeEvidence(), scheduler_success_rate_percent: 99 }, "qualification_scheduler_rate_conflict"],
    [{ ...completeEvidence(), first_forward_closed_at: "2026-08-02T00:00:00.000Z" }, "qualification_forward_boundaries_invalid"],
  ];
  for (const [evidence, message] of malformed) {
    await assert.rejects(() => assess(evidence, `qualification:malformed:${message}`), new RegExp(message));
  }
});

test("forward metrics reconcile a complete profitable trade", () => {
  const metrics = calculateForwardMetrics({
    cycleRows: [{ expected_closed_at: "2026-08-01T00:00:00.000Z" }, { expected_closed_at: "2026-08-01T01:00:00.000Z" }],
    fills: [
      {
        id: "buy-1",
        side: "buy",
        fill_time: "2026-08-01T00:00:01.000Z",
        source_candle_closed_at: "2026-08-01T00:00:00.000Z",
        price: 100,
        quantity: 1,
        notional: 100,
        fee: 1,
      },
      {
        id: "sell-1",
        side: "sell",
        fill_time: "2026-08-01T01:00:01.000Z",
        source_candle_closed_at: "2026-08-01T01:00:00.000Z",
        price: 110,
        quantity: 1,
        notional: 110,
        fee: 1,
      },
    ],
    candles: [
      { closed_at: "2026-08-01T00:00:00.000Z", close: 100 },
      { closed_at: "2026-08-01T01:00:00.000Z", close: 110 },
    ],
    endingCash: 1008,
    endingPosition: 0,
    initialCashFallback: 10000,
  });
  assert.equal(metrics.starting_cash, 1000);
  assert.equal(metrics.closed_trade_count, 1);
  assert.equal(metrics.net_pnl, 8);
  assert.equal(metrics.return_percent, 0.8);
  assert.equal(metrics.simulated_cash_delta, 0);
  assert.equal(metrics.simulated_position_delta, 0);
});

test("no-trade forward metrics begin from actual forward cash and reconcile", () => {
  const metrics = calculateForwardMetrics({
    cycleRows: [],
    fills: [],
    candles: [],
    endingCash: 9999.5,
    endingPosition: 0,
    initialCashFallback: 10000,
  });
  assert.equal(metrics.starting_cash, 9999.5);
  assert.equal(metrics.closed_trade_count, 0);
  assert.equal(metrics.net_pnl, 0);
  assert.equal(metrics.return_percent, 0);
  assert.equal(metrics.simulated_cash_delta, 0);
  assert.equal(metrics.simulated_position_delta, 0);
});
