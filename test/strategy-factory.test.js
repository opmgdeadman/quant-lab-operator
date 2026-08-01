import assert from "node:assert/strict";
import test from "node:test";
import { buildBaselineBenchmark, partitionDataset } from "../src/baselineBench.js";
import { HOSTILE_JUDGE_CONFIG } from "../src/hostileJudge.js";
import {
  FACTORY_CANDIDATE_CATALOG,
  FACTORY_POLICY,
  buildStrategyFactoryBatch,
} from "../src/strategyFactory.js";

const CREATED = "2026-08-01T18:00:00.000Z";

function candles(count = 120) {
  const rows = [];
  let previous = 100;
  const start = Date.parse("2026-07-20T00:00:00.000Z");
  for (let index = 0; index < count; index += 1) {
    const close = 100 + index * 0.1 + Math.sin(index / 4) * 4;
    rows.push({
      market: "BTC-USD",
      interval: "1h",
      closed_at: new Date(start + index * 60 * 60 * 1000).toISOString(),
      open: previous,
      high: Math.max(previous, close) + 1,
      low: Math.min(previous, close) - 1,
      close,
      volume: 100 + index,
      source: "test",
    });
    previous = close;
  }
  return rows;
}

async function source() {
  const rows = candles(120);
  const built = await buildBaselineBenchmark(rows, {
    benchmarkId: "stage3-baseline-bench-v1",
    createdAt: CREATED,
  });
  return {
    benchmark: built.benchmark,
    candles: rows,
    partition_manifest: built.summary.partition_manifest,
    partitions: partitionDataset(rows),
  };
}

test("factory catalog is exactly eight frozen predeclared candidates", () => {
  assert.equal(FACTORY_CANDIDATE_CATALOG.length, 8);
  assert.equal(new Set(FACTORY_CANDIDATE_CATALOG.map((entry) => entry.id)).size, 8);
  assert.equal(FACTORY_POLICY.candidate_count, 8);
  assert.equal(FACTORY_POLICY.adaptive_tuning_allowed, false);
  assert.equal(FACTORY_POLICY.result_dependent_expansion_allowed, false);
  assert.equal(FACTORY_POLICY.promotion_allowed, false);
  assert.equal(FACTORY_POLICY.live_capital_enabled, false);
  assert.throws(() => FACTORY_CANDIDATE_CATALOG.push({}), TypeError);
});

test("factory deterministically creates eight candidates, 24 runs, and hostile verdicts", async () => {
  const frozenSource = await source();
  const first = await buildStrategyFactoryBatch(frozenSource, {
    batchId: "factory-test",
    createdAt: CREATED,
  });
  const second = await buildStrategyFactoryBatch(frozenSource, {
    batchId: "factory-test",
    createdAt: CREATED,
  });

  assert.equal(first.definitions.length, 8);
  assert.equal(first.runs.length, 24);
  assert.equal(first.verdicts.length, 8);
  assert.equal(first.summary.batch_hash, second.summary.batch_hash);
  assert.equal(first.summary.factory_policy_hash, second.summary.factory_policy_hash);
  assert.deepEqual(first.definitions.map((entry) => entry.spec_hash), second.definitions.map((entry) => entry.spec_hash));
  assert.deepEqual(first.runs.map((entry) => entry.result_hash), second.runs.map((entry) => entry.result_hash));
  assert.equal(first.summary.promotion_performed, false);
  assert.equal(first.summary.adaptive_tuning_allowed, false);
  assert.equal(first.summary.result_dependent_expansion_allowed, false);
  assert.equal(first.summary.judge_config_hash.length > 20, true);
});

test("every candidate has immutable lineage to a declared reference family", async () => {
  const built = await buildStrategyFactoryBatch(await source(), {
    batchId: "factory-lineage",
    createdAt: CREATED,
  });
  for (const definition of built.definitions) {
    assert.ok(definition.parent_reference_id.startsWith("baseline-"));
    assert.ok(definition.lineage_hash.startsWith("sha256:"));
    assert.equal(definition.tuning_allowed, false);
    assert.ok(["ema_cross", "rsi_mean_reversion"].includes(definition.kind));
  }
});

test("candidate runs retain next-candle execution and exact partition hashes", async () => {
  const frozenSource = await source();
  const built = await buildStrategyFactoryBatch(frozenSource, {
    batchId: "factory-timing",
    createdAt: CREATED,
  });
  for (const run of built.runs) {
    assert.equal(run.dataset_hash, frozenSource.partition_manifest[run.partition_name].dataset_hash);
    const artifact = JSON.parse(run.artifact.content_json);
    for (const order of artifact.orders) {
      assert.ok(
        Date.parse(order.execution_candle_closed_at) - Date.parse(order.signal_closed_at)
          >= 60 * 60 * 1000,
      );
    }
  }
});

test("weak candidates stay insufficient or rejected and never expand the catalog", async () => {
  const built = await buildStrategyFactoryBatch(await source(), {
    batchId: "factory-weak",
    createdAt: CREATED,
  });
  assert.equal(
    built.summary.qualified_count + built.summary.insufficient_count + built.summary.rejected_count,
    8,
  );
  assert.equal(built.summary.verdicts.length, 8);
  assert.equal(FACTORY_CANDIDATE_CATALOG.length, 8);
  assert.equal(HOSTILE_JUDGE_CONFIG.id, "hostile-judge-v1");
  assert.equal(built.summary.promotion_performed, false);
});

test("source benchmark identity and partition boundaries fail closed", async () => {
  const wrongBenchmark = await source();
  wrongBenchmark.benchmark.id = "wrong-benchmark";
  await assert.rejects(
    buildStrategyFactoryBatch(wrongBenchmark, { batchId: "factory-wrong", createdAt: CREATED }),
    /factory_source_benchmark_mismatch/,
  );

  const wrongPartition = await source();
  wrongPartition.partitions.test = wrongPartition.partitions.test.slice(1);
  await assert.rejects(
    buildStrategyFactoryBatch(wrongPartition, { batchId: "factory-boundary", createdAt: CREATED }),
    /factory_partition_count_mismatch:test/,
  );
});
