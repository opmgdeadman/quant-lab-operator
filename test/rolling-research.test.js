import test from "node:test";
import assert from "node:assert/strict";

import {
  ROLLING_FACTORY_POLICY,
  ROLLING_RESEARCH_POLICY,
  buildRollingResearchEpoch,
} from "../src/rollingResearch.js";
import { FACTORY_CANDIDATE_CATALOG } from "../src/strategyFactory.js";

function candles(count = 720, start = "2026-07-03T00:00:00.000Z") {
  const startMs = Date.parse(start);
  return Array.from({ length: count }, (_, index) => {
    const trend = 100 + index * 0.04;
    const wave = Math.sin(index / 8) * 7 + Math.sin(index / 31) * 4;
    const open = trend + wave;
    const close = open + Math.sin(index / 3) * 1.5;
    return {
      market: "BTC-USD",
      interval: "1h",
      closed_at: new Date(startMs + index * 60 * 60 * 1000).toISOString(),
      open,
      high: Math.max(open, close) + 2,
      low: Math.min(open, close) - 2,
      close,
      volume: 1000 + index,
      source: "synthetic",
    };
  });
}

const options = {
  epochDate: "2026-08-01",
  asOfClosedAt: "2026-08-01T23:00:00.000Z",
  availableCandleCount: 720,
  createdAt: "2026-08-02T00:00:00.000Z",
};

test("rolling research policies are immutable and bounded", () => {
  assert.equal(Object.isFrozen(ROLLING_RESEARCH_POLICY), true);
  assert.equal(Object.isFrozen(ROLLING_RESEARCH_POLICY.partitions), true);
  assert.equal(Object.isFrozen(ROLLING_FACTORY_POLICY), true);
  assert.equal(ROLLING_RESEARCH_POLICY.required_contiguous_hourly_candles, 720);
  assert.deepEqual(ROLLING_RESEARCH_POLICY.partitions, { train: 432, validation: 144, test: 144 });
  assert.equal(ROLLING_RESEARCH_POLICY.base_candidate_ids.length, 8);
  assert.deepEqual(ROLLING_RESEARCH_POLICY.base_candidate_ids, FACTORY_CANDIDATE_CATALOG.map((entry) => entry.id));
  assert.equal(ROLLING_RESEARCH_POLICY.candidate_parameters_mutable, false);
  assert.equal(ROLLING_RESEARCH_POLICY.result_dependent_expansion_allowed, false);
  assert.equal(ROLLING_RESEARCH_POLICY.same_candle_activation_allowed, false);
  assert.equal(ROLLING_RESEARCH_POLICY.live_capital_enabled, false);
});

test("insufficient history creates only a durable waiting epoch", async () => {
  const built = await buildRollingResearchEpoch(candles(100), {
    ...options,
    asOfClosedAt: "2026-07-07T03:00:00.000Z",
    availableCandleCount: 100,
  });
  assert.equal(built.summary.state, "waiting_for_history");
  assert.deepEqual(built.summary.blocker_codes, ["insufficient_contiguous_history"]);
  assert.equal(built.summary.available_candle_count, 100);
  assert.equal(built.summary.required_candle_count, 720);
  assert.equal(built.summary.candidate_count, 0);
  assert.equal(built.summary.run_count, 0);
  assert.equal(built.summary.verdict_count, 0);
  assert.equal(built.benchmark, null);
  assert.equal(built.factory, null);
  assert.equal(built.selection, null);
});

test("eligible history builds exact epoch cardinality and partitions", async () => {
  const built = await buildRollingResearchEpoch(candles(), options);
  assert.equal(built.summary.state, "complete");
  assert.equal(built.summary.dataset_candle_count, 720);
  assert.equal(built.source.partitions.train.length, 432);
  assert.equal(built.source.partitions.validation.length, 144);
  assert.equal(built.source.partitions.test.length, 144);
  assert.equal(built.factory.definitions.length, 8);
  assert.equal(built.factory.runs.length, 24);
  assert.equal(built.factory.verdicts.length, 8);
  assert.equal(built.selection.rankings.length, 8);
  assert.equal(built.summary.candidate_count, 8);
  assert.equal(built.summary.run_count, 24);
  assert.equal(built.summary.verdict_count, 8);
  assert.equal(built.summary.benchmark_id, "rolling-benchmark-v1:2026-08-01");
  assert.equal(built.summary.factory_batch_id, "rolling-factory-v1:2026-08-01");
  assert.equal(built.summary.selection_batch_id, "rolling-selection-v1:2026-08-01");
  assert.equal(built.summary.same_candle_activation_allowed, false);
  assert.equal(built.summary.live_capital_enabled, false);
});

test("epoch instances preserve the exact base catalog and lineage", async () => {
  const built = await buildRollingResearchEpoch(candles(), options);
  const expectedIds = FACTORY_CANDIDATE_CATALOG.map((entry) => `${entry.id}:rolling:2026-08-01`);
  assert.deepEqual(built.factory.definitions.map((entry) => entry.id), expectedIds);
  for (let index = 0; index < built.factory.definitions.length; index += 1) {
    const definition = built.factory.definitions[index];
    const base = FACTORY_CANDIDATE_CATALOG[index];
    assert.equal(definition.parent_reference_id, base.id);
    assert.equal(definition.kind, base.kind);
    assert.deepEqual(definition.parameters, base.parameters);
    assert.equal(definition.tuning_allowed, false);
  }
});

test("weak results never expand or retune the catalog", async () => {
  const flat = candles().map((candle) => ({ ...candle, open: 100, high: 101, low: 99, close: 100 }));
  const built = await buildRollingResearchEpoch(flat, options);
  assert.equal(built.factory.definitions.length, 8);
  assert.equal(built.factory.runs.length, 24);
  assert.equal(built.factory.verdicts.length, 8);
  assert.equal(built.summary.qualified_count, 0);
  assert.equal(built.selection.summary.state, "no_champion");
  assert.equal(built.selection.summary.champion_candidate_id, null);
});

test("gapped history produces a safe waiting epoch without research artifacts", async () => {
  const broken = candles();
  broken[300] = { ...broken[300], closed_at: new Date(Date.parse(broken[300].closed_at) + 60 * 60 * 1000).toISOString() };
  const built = await buildRollingResearchEpoch(broken, options);
  assert.equal(built.summary.state, "waiting_for_history");
  assert.equal(built.summary.contiguous_candle_count, 419);
  assert.equal(built.summary.candidate_count, 0);
  assert.equal(built.summary.run_count, 0);
  assert.equal(built.benchmark, null);
  assert.equal(built.factory, null);
  assert.equal(built.selection, null);
});

test("as-of mismatch fails closed", async () => {
  await assert.rejects(
    () => buildRollingResearchEpoch(candles(), { ...options, asOfClosedAt: "2026-08-02T00:00:00.000Z" }),
    /rolling_as_of_boundary_mismatch/,
  );
});

test("same epoch inputs produce deterministic immutable hashes", async () => {
  const first = await buildRollingResearchEpoch(candles(), options);
  const second = await buildRollingResearchEpoch(candles(), options);
  assert.equal(first.policy.policy_hash, second.policy.policy_hash);
  assert.equal(first.benchmark.benchmark_hash, second.benchmark.benchmark_hash);
  assert.equal(first.factory.batch.batch_hash, second.factory.batch.batch_hash);
  assert.equal(first.selection.batch.selection_hash, second.selection.batch.selection_hash);
  assert.equal(first.summary.epoch_hash, second.summary.epoch_hash);
});
