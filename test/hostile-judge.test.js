import assert from "node:assert/strict";
import test from "node:test";
import { buildBaselineBenchmark } from "../src/baselineBench.js";
import {
  HOSTILE_JUDGE_CONFIG,
  HOSTILE_REASON_CODES,
  buildHostileJudgeBatch,
  stressReplay,
} from "../src/hostileJudge.js";

const CREATED = "2026-08-01T18:00:00.000Z";

function market(count = 180, mode = "trend") {
  const rows = [];
  let previous = 100;
  const start = Date.parse("2026-07-20T00:00:00.000Z");
  for (let index = 0; index < count; index += 1) {
    let close;
    if (mode === "trend") {
      close = 100 + index * 0.2 + Math.sin(index / 5) * 2;
    } else if (mode === "saw") {
      const cycle = index % 20;
      close = cycle < 10 ? 120 - cycle * 2.5 : 95 + (cycle - 10) * 3;
    } else {
      close = 100;
    }
    const open = previous;
    rows.push({
      market: "BTC-USD",
      interval: "1h",
      closed_at: new Date(start + index * 60 * 60 * 1000).toISOString(),
      open,
      high: Math.max(open, close) + 1,
      low: Math.min(open, close) - 1,
      close,
      volume: 100,
      source: "test",
    });
    previous = close;
  }
  return rows;
}

async function evidence(mode = "trend") {
  const built = await buildBaselineBenchmark(market(180, mode), {
    benchmarkId: `bench-${mode}`,
    createdAt: CREATED,
  });
  return {
    benchmark: built.benchmark,
    definitions: built.definitions,
    runs: built.runs,
  };
}

test("judge contract is frozen, qualification-only, and has durable reasons", () => {
  assert.equal(HOSTILE_JUDGE_CONFIG.promotion_allowed, false);
  assert.equal(HOSTILE_JUDGE_CONFIG.live_capital_enabled, false);
  assert.deepEqual(HOSTILE_JUDGE_CONFIG.stress_cost_multipliers, [2, 3]);
  assert.ok(HOSTILE_REASON_CODES.includes("artifact_hash_mismatch"));
  assert.throws(() => {
    HOSTILE_JUDGE_CONFIG.gates.minimum_test_fills = 0;
  }, TypeError);
});

test("inactive baseline evidence is insufficient, never qualified", async () => {
  const batch = await buildHostileJudgeBatch(await evidence("trend"), {
    batchId: "judge-inactive",
    createdAt: CREATED,
  });
  assert.equal(batch.summary.evaluation_count, 3);
  assert.equal(batch.summary.qualified_count, 0);
  assert.ok(batch.summary.insufficient_count >= 1);
  for (const verdict of batch.summary.verdicts) {
    assert.notEqual(verdict.verdict, "qualified");
    assert.ok(
      verdict.reason_codes.includes("insufficient_test_fills")
      || verdict.reason_codes.includes("insufficient_test_closed_trades"),
    );
  }
});

test("corrupted artifact is rejected by integrity gates", async () => {
  const candidateEvidence = await evidence("trend");
  candidateEvidence.runs[0].artifact.content_json = candidateEvidence.runs[0].artifact.content_json
    .replace("deterministic_baseline_result_v1", "tampered");
  const batch = await buildHostileJudgeBatch(candidateEvidence, {
    batchId: "judge-corrupt",
    createdAt: CREATED,
  });
  const target = batch.evaluations.find((entry) => entry.baseline_id === candidateEvidence.runs[0].baseline_id);
  assert.equal(target.verdict, "rejected");
  assert.ok(target.reason_codes.includes("result_hash_mismatch"));
  assert.ok(target.reason_codes.includes("artifact_hash_mismatch"));
});

test("missing partition evidence is rejected", async () => {
  const candidateEvidence = await evidence("trend");
  const baseline = candidateEvidence.definitions[0].id;
  candidateEvidence.runs = candidateEvidence.runs.filter(
    (run) => !(run.baseline_id === baseline && run.partition_name === "test"),
  );
  const batch = await buildHostileJudgeBatch(candidateEvidence, {
    batchId: "judge-missing",
    createdAt: CREATED,
  });
  const target = batch.evaluations.find((entry) => entry.baseline_id === baseline);
  assert.equal(target.verdict, "rejected");
  assert.deepEqual(target.reason_codes, ["missing_partition_evidence"]);
});

test("stress replay increases costs and is deterministic", async () => {
  const candidateEvidence = await evidence("trend");
  const buyHoldTest = candidateEvidence.runs.find(
    (run) => run.baseline_id === "baseline-buy-hold-v1" && run.partition_name === "test",
  );
  const twice = await stressReplay(buyHoldTest.artifact, 2, "eval", CREATED);
  const twiceAgain = await stressReplay(buyHoldTest.artifact, 2, "eval", CREATED);
  const thrice = await stressReplay(buyHoldTest.artifact, 3, "eval", CREATED);
  assert.equal(twice.result_hash, twiceAgain.result_hash);
  assert.equal(twice.fee_bps, 20);
  assert.equal(thrice.slippage_bps, 15);
  assert.ok(thrice.metrics.ending_equity <= twice.metrics.ending_equity);
});

test("judge batch is deterministic for identical evidence", async () => {
  const candidateEvidence = await evidence("saw");
  const first = await buildHostileJudgeBatch(candidateEvidence, {
    batchId: "judge-deterministic",
    createdAt: CREATED,
  });
  const second = await buildHostileJudgeBatch(candidateEvidence, {
    batchId: "judge-deterministic",
    createdAt: CREATED,
  });
  assert.equal(first.summary.batch_hash, second.summary.batch_hash);
  assert.deepEqual(first.summary.verdicts, second.summary.verdicts);
});

async function hash(value) {
  const text = typeof value === "string" ? value : canonical(value);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return `sha256:${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")}`;
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

async function qualifiedEvidence() {
  const spec = {
    schema: "baseline_definition_v1",
    id: "synthetic-robust-v1",
    version: 1,
    kind: "synthetic",
    market: "BTC-USD",
    interval: "1h",
    direction: "long",
    position_size_percent: 100,
    parameters: {},
    tuning_allowed: false,
    promotion_role: "reference_only",
  };
  const specHash = await hash(spec);
  const definition = {
    ...spec,
    spec_json: canonical(spec),
    spec_hash: specHash,
    created_at: CREATED,
  };
  const runs = [];
  for (const [partition, totalReturn] of [["train", 8], ["validation", 7], ["test", 6]]) {
    const runId = `bench-qualified:${definition.id}:${partition}`;
    const hour = partition === "train" ? 1 : partition === "validation" ? 3 : 5;
    const firstClose = `2026-08-01T0${hour}:00:00.000Z`;
    const secondClose = `2026-08-01T0${hour + 1}:00:00.000Z`;
    const artifact = {
      schema: "deterministic_baseline_result_v1",
      benchmark_id: "bench-qualified",
      baseline_id: definition.id,
      partition_name: partition,
      spec_hash: specHash,
      dataset_hash: `data-${partition}`,
      cost_model: {
        initial_cash: 10000,
        fee_bps_per_side: 10,
        slippage_bps_per_side: 5,
        execution: "next_candle_open",
        completed_candles_only: true,
      },
      orders: [
        { id: `${runId}:o1`, side: "buy", signal_closed_at: firstClose, execution_candle_closed_at: firstClose, status: "filled" },
        { id: `${runId}:o2`, side: "sell", signal_closed_at: firstClose, execution_candle_closed_at: secondClose, status: "filled" },
      ],
      fills: [
        { id: `${runId}:f1`, order_id: `${runId}:o1`, side: "buy", fill_time: firstClose, source_candle_closed_at: firstClose, price: 100.05, quantity: 99.8501748, notional: 9990.00999, fee: 9.99000999 },
        { id: `${runId}:f2`, order_id: `${runId}:o2`, side: "sell", fill_time: secondClose, source_candle_closed_at: secondClose, price: 119.94, quantity: 99.8501748, notional: 11976.03, fee: 11.976 },
      ],
      trades: [{ id: `${runId}:t1` }],
      equity_curve: [
        { close_time: firstClose, cash: 0, quantity: 99.8501748, mark_price: 100, equity: 9985, exposure: 1 },
        { close_time: secondClose, cash: 10600, quantity: 0, mark_price: 120, equity: 10600, exposure: 0 },
      ],
      metrics: {
        initial_cash: 10000,
        ending_equity: 10000 * (1 + totalReturn / 100),
        total_return_percent: totalReturn,
        max_drawdown_percent: 1,
        trade_count: 1,
        win_rate_percent: 100,
        total_fees: 22,
        fill_count: 2,
        average_exposure_percent: 50,
        open_position_quantity: 0,
      },
    };
    const resultHash = await hash(artifact);
    const content = JSON.stringify({ ...artifact, result_hash: resultHash });
    runs.push({
      id: runId,
      benchmark_id: "bench-qualified",
      baseline_id: definition.id,
      partition_name: partition,
      spec_hash: specHash,
      dataset_hash: `data-${partition}`,
      result_hash: resultHash,
      metrics: artifact.metrics,
      metrics_json: JSON.stringify(artifact.metrics),
      order_count: 2,
      fill_count: 2,
      trade_count: 1,
      artifact: {
        id: `${runId}:artifact`,
        run_id: runId,
        artifact_type: "deterministic_result_v1",
        artifact_hash: await hash(content),
        content_json: content,
        created_at: CREATED,
      },
      created_at: CREATED,
    });
  }
  return {
    benchmark: { id: "bench-qualified", benchmark_hash: "bench-hash" },
    definitions: [definition],
    runs,
  };
}

test("genuinely active profitable and cost-robust evidence can qualify without promotion", async () => {
  const batch = await buildHostileJudgeBatch(await qualifiedEvidence(), {
    batchId: "judge-qualified",
    createdAt: CREATED,
  });
  assert.equal(batch.summary.qualified_count, 1);
  assert.equal(batch.summary.rejected_count, 0);
  assert.equal(batch.summary.insufficient_count, 0);
  assert.equal(batch.evaluations[0].verdict, "qualified");
  assert.deepEqual(batch.evaluations[0].reason_codes, []);
  assert.equal(batch.summary.promotion_performed, false);
  assert.ok(batch.evaluations[0].summary.doubled_cost_return_percent > 0);
  assert.ok(batch.evaluations[0].summary.tripled_cost_return_percent > 0);
});
