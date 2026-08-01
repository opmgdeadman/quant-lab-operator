import assert from "node:assert/strict";
import test from "node:test";
import {
  BASELINE_CATALOG,
  BASELINE_COST_MODEL,
  buildBaselineBenchmark,
  partitionDataset,
  runBaseline,
} from "../src/baselineBench.js";

const CREATED_AT = "2026-08-01T18:00:00.000Z";

function candles(count = 120, { start = "2026-07-27T18:00:00.000Z", gapAt = null } = {}) {
  const rows = [];
  let previous = 60000;
  const startMs = Date.parse(start);
  for (let index = 0; index < count; index += 1) {
    const offset = index + (gapAt !== null && index >= gapAt ? 1 : 0);
    const closedAt = new Date(startMs + offset * 60 * 60 * 1000).toISOString();
    const wave = Math.sin(index / 5) * 600;
    const trend = index * 18;
    const open = previous;
    const close = 60000 + trend + wave;
    rows.push({
      market: "BTC-USD",
      interval: "1h",
      closed_at: closedAt,
      open,
      high: Math.max(open, close) + 50,
      low: Math.min(open, close) - 50,
      close,
      volume: 100 + index,
      source: "test",
    });
    previous = close;
  }
  return rows;
}

test("catalog is permanently predeclared with tuning disabled and fixed costs", () => {
  assert.deepEqual(BASELINE_CATALOG.map((entry) => entry.id), [
    "baseline-buy-hold-v1",
    "baseline-ema-12-26-v1",
    "baseline-rsi-14-30-55-v1",
  ]);
  assert.equal(BASELINE_CATALOG.every((entry) => entry.tuning_allowed === false), true);
  assert.deepEqual(BASELINE_COST_MODEL, {
    initial_cash: 10000,
    fee_bps_per_side: 10,
    slippage_bps_per_side: 5,
    execution: "next_candle_open",
    completed_candles_only: true,
  });
  assert.throws(() => BASELINE_CATALOG.push({}), TypeError);
});

test("partitions are chronological, disjoint, complete, and 60/20/20", () => {
  const rows = candles(100);
  const parts = partitionDataset(rows);
  assert.equal(parts.train.length, 60);
  assert.equal(parts.validation.length, 20);
  assert.equal(parts.test.length, 20);
  assert.equal(parts.train.at(-1).closed_at < parts.validation[0].closed_at, true);
  assert.equal(parts.validation.at(-1).closed_at < parts.test[0].closed_at, true);
  assert.equal(new Set([...parts.train, ...parts.validation, ...parts.test].map((row) => row.closed_at)).size, 100);
});

test("dataset gaps and insufficient history fail closed", async () => {
  await assert.rejects(
    buildBaselineBenchmark(candles(80, { gapAt: 30 }), { benchmarkId: "gap", createdAt: CREATED_AT }),
    /baseline_dataset_gap/,
  );
  await assert.rejects(
    buildBaselineBenchmark(candles(59), { benchmarkId: "short", createdAt: CREATED_AT }),
    /baseline_dataset_requires_60_candles/,
  );
});

test("benchmark is deterministic and produces exactly three definitions across three partitions", async () => {
  const rows = candles(120);
  const first = await buildBaselineBenchmark(rows, { benchmarkId: "bench-v1", createdAt: CREATED_AT });
  const second = await buildBaselineBenchmark(rows, { benchmarkId: "bench-v1", createdAt: CREATED_AT });

  assert.equal(first.definitions.length, 3);
  assert.equal(first.runs.length, 9);
  assert.equal(first.summary.run_count, 9);
  assert.equal(first.summary.baseline_count, 3);
  assert.equal(first.summary.tuning_allowed, false);
  assert.equal(first.summary.promotion_performed, false);
  assert.equal(first.summary.historical_paper_research, true);
  assert.equal(first.summary.live_capital_enabled, false);
  assert.equal(first.summary.benchmark_hash, second.summary.benchmark_hash);
  assert.equal(first.summary.dataset_hash, second.summary.dataset_hash);
  assert.deepEqual(first.runs.map((run) => run.result_hash), second.runs.map((run) => run.result_hash));
  assert.deepEqual(first.runs.map((run) => run.artifact.artifact_hash), second.runs.map((run) => run.artifact.artifact_hash));
});

test("buy and hold enters on the next candle open with fee and slippage", async () => {
  const rows = candles(60);
  const definition = {
    id: "baseline-buy-hold-v1",
    version: 1,
    kind: "buy_hold",
    market: "BTC-USD",
    interval: "1h",
    direction: "long",
    position_size_percent: 100,
    parameters: {},
    tuning_allowed: false,
    spec_hash: "sha256:test",
  };
  const run = await runBaseline({
    benchmarkId: "bench",
    definition,
    partitionName: "train",
    candles: rows,
    datasetHash: "sha256:data",
    createdAt: CREATED_AT,
  });
  const artifact = JSON.parse(run.artifact.content_json);

  assert.equal(run.order_count, 1);
  assert.equal(run.fill_count, 1);
  assert.equal(artifact.orders[0].signal_closed_at, rows[0].closed_at);
  assert.equal(artifact.orders[0].execution_candle_closed_at, rows[1].closed_at);
  assert.equal(
    artifact.fills[0].fill_time,
    new Date(Date.parse(rows[1].closed_at) - 60 * 60 * 1000).toISOString(),
  );
  assert.equal(artifact.fills[0].price, rows[1].open * 1.0005);
  assert.ok(artifact.fills[0].fee > 0);
  assert.ok(run.metrics.total_fees > 0);
});

test("all generated orders execute at least one full candle after their signal", async () => {
  const built = await buildBaselineBenchmark(candles(180), {
    benchmarkId: "timing",
    createdAt: CREATED_AT,
  });
  for (const run of built.runs) {
    const artifact = JSON.parse(run.artifact.content_json);
    for (const order of artifact.orders) {
      assert.ok(
        Date.parse(order.execution_candle_closed_at) - Date.parse(order.signal_closed_at)
          >= 60 * 60 * 1000,
      );
    }
  }
});

test("changing one candle changes dataset and benchmark hashes", async () => {
  const original = candles(120);
  const changed = structuredClone(original);
  changed[70].close += 25;
  changed[70].high += 25;

  const first = await buildBaselineBenchmark(original, { benchmarkId: "hash", createdAt: CREATED_AT });
  const second = await buildBaselineBenchmark(changed, { benchmarkId: "hash", createdAt: CREATED_AT });

  assert.notEqual(first.summary.dataset_hash, second.summary.dataset_hash);
  assert.notEqual(first.summary.benchmark_hash, second.summary.benchmark_hash);
});
