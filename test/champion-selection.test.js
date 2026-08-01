import assert from "node:assert/strict";
import test from "node:test";
import {
  SELECTION_POLICY,
  buildChampionSelection,
  selectionScore,
} from "../src/championSelection.js";

const CREATED = "2026-08-01T18:00:00.000Z";

function candidate(candidateId, verdict, metrics = {}, reasonCodes = []) {
  return {
    candidate_id: candidateId,
    verdict,
    reason_codes: reasonCodes,
    evidence_hash: `sha256:${candidateId}`,
    summary: {
      test_return_percent: metrics.test_return_percent ?? null,
      test_drawdown_percent: metrics.test_drawdown_percent ?? null,
      doubled_cost_return_percent: metrics.doubled_cost_return_percent ?? null,
      tripled_cost_return_percent: metrics.tripled_cost_return_percent ?? null,
    },
  };
}

function source(candidates) {
  return {
    batch: {
      id: "stage5-controlled-factory-v1",
      batch_hash: "sha256:factory",
      candidate_count: candidates.length,
    },
    candidates,
  };
}

test("selection policy is frozen and forbids fallback, execution, scheduling, and live capital", () => {
  assert.equal(SELECTION_POLICY.eligibility, "hostile_judge_verdict_equals_qualified");
  assert.equal(SELECTION_POLICY.fallback_selection_allowed, false);
  assert.equal(SELECTION_POLICY.paper_execution_allowed, false);
  assert.equal(SELECTION_POLICY.scheduling_allowed, false);
  assert.equal(SELECTION_POLICY.live_capital_enabled, false);
  assert.equal(SELECTION_POLICY.champion_limit, 1);
  assert.equal(SELECTION_POLICY.challenger_limit, 2);
  assert.throws(() => {
    SELECTION_POLICY.challenger_limit = 10;
  }, TypeError);
});

test("zero qualified candidates produces explicit no-champion state", async () => {
  const built = await buildChampionSelection(source([
    candidate("a", "insufficient_evidence", {}, ["insufficient_test_fills"]),
    candidate("b", "rejected", {}, ["test_return_below_gate"]),
  ]), { batchId: "selection-none", createdAt: CREATED });

  assert.equal(built.summary.state, "no_champion");
  assert.equal(built.summary.champion_candidate_id, null);
  assert.deepEqual(built.summary.challenger_candidate_ids, []);
  assert.equal(built.summary.eligible_count, 0);
  assert.deepEqual(built.summary.blocker_codes, ["no_qualified_candidates"]);
  assert.equal(built.summary.paper_execution_started, false);
  assert.equal(built.summary.scheduling_started, false);
  assert.equal(built.rankings.every((row) => row.eligible === 0), true);
  assert.equal(built.rankings.every((row) => row.selected_role === "none"), true);
  assert.equal(built.rankings.every((row) => row.rank_position === null), true);
  assert.equal(built.rankings.every((row) => row.score === null), true);
});

test("only qualified candidates can become champion or challenger", async () => {
  const built = await buildChampionSelection(source([
    candidate("qualified-low", "qualified", {
      test_return_percent: 2,
      test_drawdown_percent: 1,
      doubled_cost_return_percent: 1.5,
      tripled_cost_return_percent: 1,
    }),
    candidate("qualified-high", "qualified", {
      test_return_percent: 4,
      test_drawdown_percent: 1,
      doubled_cost_return_percent: 3,
      tripled_cost_return_percent: 2,
    }),
    candidate("rejected-high-looking", "rejected", {
      test_return_percent: 100,
      test_drawdown_percent: 0,
      doubled_cost_return_percent: 100,
      tripled_cost_return_percent: 100,
    }, ["artifact_hash_mismatch"]),
  ]), { batchId: "selection-qualified", createdAt: CREATED });

  assert.equal(built.summary.state, "champion_selected");
  assert.equal(built.summary.champion_candidate_id, "qualified-high");
  assert.deepEqual(built.summary.challenger_candidate_ids, ["qualified-low"]);
  assert.equal(built.summary.eligible_count, 2);
  const rejected = built.rankings.find((row) => row.candidate_id === "rejected-high-looking");
  assert.equal(rejected.eligible, 0);
  assert.equal(rejected.selected_role, "none");
  assert.equal(rejected.score, null);
});

test("ranking is deterministic and candidate id breaks equal scores", async () => {
  const metrics = {
    test_return_percent: 3,
    test_drawdown_percent: 2,
    doubled_cost_return_percent: 2,
    tripled_cost_return_percent: 1,
  };
  const candidates = [
    candidate("candidate-z", "qualified", metrics),
    candidate("candidate-a", "qualified", metrics),
    candidate("candidate-m", "qualified", {
      test_return_percent: 1,
      test_drawdown_percent: 1,
      doubled_cost_return_percent: 1,
      tripled_cost_return_percent: 0.5,
    }),
    candidate("candidate-fourth", "qualified", {
      test_return_percent: 0.5,
      test_drawdown_percent: 1,
      doubled_cost_return_percent: 0.5,
      tripled_cost_return_percent: 0,
    }),
  ];
  const first = await buildChampionSelection(source(candidates), {
    batchId: "selection-tie",
    createdAt: CREATED,
  });
  const second = await buildChampionSelection(source([...candidates].reverse()), {
    batchId: "selection-tie",
    createdAt: CREATED,
  });

  assert.equal(first.summary.champion_candidate_id, "candidate-a");
  assert.deepEqual(first.summary.challenger_candidate_ids, ["candidate-z", "candidate-m"]);
  assert.deepEqual(first.summary.ranking, second.summary.ranking);
  assert.equal(first.summary.selection_hash, second.summary.selection_hash);
  const fourth = first.rankings.find((row) => row.candidate_id === "candidate-fourth");
  assert.equal(fourth.eligible, 1);
  assert.equal(fourth.selected_role, "none");
  assert.equal(fourth.rank_position, 4);
});

test("score formula uses only fixed test and cost-stress evidence", () => {
  const score = selectionScore({
    test_return_percent: 4,
    test_drawdown_percent: 2,
    doubled_cost_return_percent: 3,
    tripled_cost_return_percent: 2,
  });
  assert.equal(score, 5);
});

test("source identity, counts, and qualified metrics fail closed", async () => {
  await assert.rejects(
    buildChampionSelection({
      batch: { id: "wrong", batch_hash: "sha256:x", candidate_count: 0 },
      candidates: [],
    }, { batchId: "wrong", createdAt: CREATED }),
    /selection_source_factory_batch_mismatch/,
  );

  await assert.rejects(
    buildChampionSelection({
      batch: { id: "stage5-controlled-factory-v1", batch_hash: "sha256:x", candidate_count: 2 },
      candidates: [candidate("only-one", "insufficient_evidence")],
    }, { batchId: "count", createdAt: CREATED }),
    /selection_candidate_count_mismatch/,
  );

  await assert.rejects(
    buildChampionSelection(source([
      candidate("bad-qualified", "qualified", {
        test_return_percent: 1,
        test_drawdown_percent: 1,
        doubled_cost_return_percent: 1,
      }),
    ]), { batchId: "bad-metric", createdAt: CREATED }),
    /selection_metric_invalid:tripled_cost_return_percent/,
  );
});
