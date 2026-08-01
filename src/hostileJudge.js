const JUDGE_ID = "hostile-judge-v1";
const JUDGE_VERSION = 1;
const BATCH_ID = "stage4-hostile-judge-v1:stage3-baseline-bench-v1";
const BENCHMARK_ID = "stage3-baseline-bench-v1";
const BASE_FEE_BPS = 10;
const BASE_SLIPPAGE_BPS = 5;
const INITIAL_CASH = 10000;
const EPSILON = 1e-10;

export const HOSTILE_JUDGE_CONFIG = deepFreeze({
  id: JUDGE_ID,
  version: JUDGE_VERSION,
  purpose: "evidence_qualification_only",
  promotion_allowed: false,
  live_capital_enabled: false,
  gates: {
    minimum_test_fills: 2,
    minimum_test_closed_trades: 1,
    minimum_validation_return_percent: 0.25,
    minimum_test_return_percent: 0.25,
    maximum_test_drawdown_percent: 12,
    maximum_validation_to_test_drop_percent: 3,
    doubled_cost_minimum_return_percent: 0,
    tripled_cost_minimum_return_percent: -0.5,
  },
  stress_cost_multipliers: [2, 3],
});

export const HOSTILE_REASON_CODES = deepFreeze([
  "definition_hash_mismatch",
  "dataset_hash_mismatch",
  "result_hash_mismatch",
  "artifact_hash_mismatch",
  "artifact_link_mismatch",
  "missing_partition_evidence",
  "insufficient_test_fills",
  "insufficient_test_closed_trades",
  "validation_return_below_gate",
  "test_return_below_gate",
  "test_drawdown_above_gate",
  "validation_to_test_degradation_above_gate",
  "doubled_cost_return_below_gate",
  "tripled_cost_return_below_gate",
]);

export async function runProductionHostileJudge(env, options = {}) {
  const existing = await readBatch(env, BATCH_ID);
  if (existing) return { ...existing, replayed: true };

  const evidence = await readBenchmarkEvidence(env, BENCHMARK_ID);
  const batch = await buildHostileJudgeBatch(evidence, {
    batchId: BATCH_ID,
    createdAt: options.now || new Date(),
  });
  const existingConfig = await readJudgeConfig(env, JUDGE_ID);
  if (existingConfig && existingConfig.config_hash !== batch.config.config_hash) {
    throw new Error("hostile_judge_config_hash_conflict");
  }

  try {
    await persistBatch(env, batch, Boolean(existingConfig));
  } catch (error) {
    const raced = await readBatch(env, BATCH_ID);
    if (raced) return { ...raced, replayed: true };
    throw error;
  }
  return { ...batch.summary, replayed: false };
}

export async function getHostileJudgeSummary(env) {
  const row = await env.DB.prepare(
    `SELECT id, summary_json, created_at FROM hostile_judge_batches
     ORDER BY created_at DESC LIMIT 1`,
  ).first();
  if (!row) return null;
  return {
    ...parseJson(row.summary_json, "hostile_judge_summary_invalid"),
    batch_id: row.id,
    created_at: row.created_at,
    promotion_performed: false,
    live_capital_enabled: false,
  };
}

export async function buildHostileJudgeBatch(evidence, options = {}) {
  const createdAt = iso(options.createdAt || new Date(), "created_at");
  const batchId = options.batchId || BATCH_ID;
  validateEvidenceShape(evidence);
  const configJson = canonicalJson(HOSTILE_JUDGE_CONFIG);
  const configHash = await stableHash(HOSTILE_JUDGE_CONFIG);
  const config = {
    id: JUDGE_ID,
    version: JUDGE_VERSION,
    config_json: configJson,
    config_hash: configHash,
    created_at: createdAt,
  };

  const evaluations = [];
  for (const definition of evidence.definitions) {
    const partitionRuns = evidence.runs.filter((run) => run.baseline_id === definition.id);
    evaluations.push(await evaluateCandidate({
      batchId,
      definition,
      partitionRuns,
      benchmark: evidence.benchmark,
      configHash,
      createdAt,
    }));
  }

  const counts = {
    qualified: evaluations.filter((entry) => entry.verdict === "qualified").length,
    insufficient_evidence: evaluations.filter((entry) => entry.verdict === "insufficient_evidence").length,
    rejected: evaluations.filter((entry) => entry.verdict === "rejected").length,
  };
  const batchHash = await stableHash({
    batch_id: batchId,
    benchmark_id: evidence.benchmark.id,
    benchmark_hash: evidence.benchmark.benchmark_hash,
    judge_config_hash: configHash,
    evaluations: evaluations.map((entry) => ({
      baseline_id: entry.baseline_id,
      verdict: entry.verdict,
      evidence_hash: entry.evidence_hash,
    })),
  });
  const summary = {
    ok: true,
    historical_paper_research: true,
    live_capital_enabled: false,
    promotion_performed: false,
    judge_id: JUDGE_ID,
    judge_config_hash: configHash,
    batch_id: batchId,
    batch_hash: batchHash,
    benchmark_id: evidence.benchmark.id,
    benchmark_hash: evidence.benchmark.benchmark_hash,
    evaluation_count: evaluations.length,
    qualified_count: counts.qualified,
    insufficient_count: counts.insufficient_evidence,
    rejected_count: counts.rejected,
    verdicts: evaluations.map((entry) => ({
      baseline_id: entry.baseline_id,
      verdict: entry.verdict,
      reason_codes: entry.reason_codes,
      test_return_percent: entry.summary.test_return_percent,
      doubled_cost_return_percent: entry.summary.doubled_cost_return_percent,
      tripled_cost_return_percent: entry.summary.tripled_cost_return_percent,
    })),
    gate_contract: HOSTILE_JUDGE_CONFIG.gates,
    created_at: createdAt,
  };

  return {
    config,
    batch: {
      id: batchId,
      benchmark_id: evidence.benchmark.id,
      benchmark_hash: evidence.benchmark.benchmark_hash,
      judge_config_id: JUDGE_ID,
      judge_config_hash: configHash,
      status: "complete",
      evaluation_count: evaluations.length,
      qualified_count: counts.qualified,
      insufficient_count: counts.insufficient_evidence,
      rejected_count: counts.rejected,
      summary_json: JSON.stringify(summary),
      batch_hash: batchHash,
      created_at: createdAt,
    },
    evaluations,
    summary,
  };
}

export async function evaluateCandidate({
  batchId,
  definition,
  partitionRuns,
  benchmark,
  configHash,
  createdAt,
}) {
  const evaluationId = `${batchId}:${definition.id}`;
  const byPartition = new Map(partitionRuns.map((run) => [run.partition_name, run]));
  const train = byPartition.get("train");
  const validation = byPartition.get("validation");
  const test = byPartition.get("test");
  const gates = [];
  const integrityReasons = [];

  const expectedDefinitionHash = await stableHash(parseJson(definition.spec_json, "hostile_definition_json_invalid"));
  addGate(gates, evaluationId, "definition_integrity", expectedDefinitionHash === definition.spec_hash,
    { expected: expectedDefinitionHash, stored: definition.spec_hash }, { equality: true }, "definition_hash_mismatch", createdAt);

  if (!train || !validation || !test) {
    addGate(gates, evaluationId, "partition_completeness", false,
      { found: [...byPartition.keys()].sort() }, { required: ["train", "validation", "test"] }, "missing_partition_evidence", createdAt);
    const reasons = ["missing_partition_evidence"];
    return finalizeEvaluation({
      evaluationId, batchId, definition, verdict: "rejected", reasons, gates,
      train, validation, test, stresses: [], configHash, benchmark, createdAt,
    });
  }
  addGate(gates, evaluationId, "partition_completeness", true,
    { found: ["train", "validation", "test"] }, { required: ["train", "validation", "test"] }, "missing_partition_evidence", createdAt);

  for (const run of [train, validation, test]) {
    const integrity = await verifyRunIntegrity(run, definition);
    for (const result of integrity) {
      addGate(gates, evaluationId, `${run.partition_name}:${result.code}`, result.passed,
        result.observed, result.threshold, result.reason_code, createdAt);
      if (!result.passed) integrityReasons.push(result.reason_code);
    }
  }

  const stresses = [];
  let doubled = null;
  let tripled = null;
  if (integrityReasons.length === 0) {
    doubled = await stressReplay(test.artifact, 2, evaluationId, createdAt);
    tripled = await stressReplay(test.artifact, 3, evaluationId, createdAt);
    stresses.push(doubled, tripled);
  }

  const validationMetrics = metrics(validation);
  const testMetrics = metrics(test);
  addGate(gates, evaluationId, "minimum_test_fills",
    testMetrics.fill_count >= HOSTILE_JUDGE_CONFIG.gates.minimum_test_fills,
    { fill_count: testMetrics.fill_count }, { minimum: HOSTILE_JUDGE_CONFIG.gates.minimum_test_fills },
    "insufficient_test_fills", createdAt);
  addGate(gates, evaluationId, "minimum_test_closed_trades",
    testMetrics.trade_count >= HOSTILE_JUDGE_CONFIG.gates.minimum_test_closed_trades,
    { trade_count: testMetrics.trade_count }, { minimum: HOSTILE_JUDGE_CONFIG.gates.minimum_test_closed_trades },
    "insufficient_test_closed_trades", createdAt);
  addGate(gates, evaluationId, "validation_return",
    validationMetrics.total_return_percent >= HOSTILE_JUDGE_CONFIG.gates.minimum_validation_return_percent,
    { total_return_percent: validationMetrics.total_return_percent }, { minimum: HOSTILE_JUDGE_CONFIG.gates.minimum_validation_return_percent },
    "validation_return_below_gate", createdAt);
  addGate(gates, evaluationId, "test_return",
    testMetrics.total_return_percent >= HOSTILE_JUDGE_CONFIG.gates.minimum_test_return_percent,
    { total_return_percent: testMetrics.total_return_percent }, { minimum: HOSTILE_JUDGE_CONFIG.gates.minimum_test_return_percent },
    "test_return_below_gate", createdAt);
  addGate(gates, evaluationId, "test_drawdown",
    testMetrics.max_drawdown_percent <= HOSTILE_JUDGE_CONFIG.gates.maximum_test_drawdown_percent,
    { max_drawdown_percent: testMetrics.max_drawdown_percent }, { maximum: HOSTILE_JUDGE_CONFIG.gates.maximum_test_drawdown_percent },
    "test_drawdown_above_gate", createdAt);
  const degradation = validationMetrics.total_return_percent - testMetrics.total_return_percent;
  addGate(gates, evaluationId, "generalization_degradation",
    degradation <= HOSTILE_JUDGE_CONFIG.gates.maximum_validation_to_test_drop_percent,
    { degradation_percent: degradation }, { maximum: HOSTILE_JUDGE_CONFIG.gates.maximum_validation_to_test_drop_percent },
    "validation_to_test_degradation_above_gate", createdAt);
  addGate(gates, evaluationId, "doubled_cost_return",
    doubled !== null && doubled.metrics.total_return_percent >= HOSTILE_JUDGE_CONFIG.gates.doubled_cost_minimum_return_percent,
    { total_return_percent: doubled?.metrics.total_return_percent ?? null }, { minimum: HOSTILE_JUDGE_CONFIG.gates.doubled_cost_minimum_return_percent },
    "doubled_cost_return_below_gate", createdAt);
  addGate(gates, evaluationId, "tripled_cost_return",
    tripled !== null && tripled.metrics.total_return_percent >= HOSTILE_JUDGE_CONFIG.gates.tripled_cost_minimum_return_percent,
    { total_return_percent: tripled?.metrics.total_return_percent ?? null }, { minimum: HOSTILE_JUDGE_CONFIG.gates.tripled_cost_minimum_return_percent },
    "tripled_cost_return_below_gate", createdAt);

  const failed = gates.filter((gate) => gate.passed === 0).map((gate) => gate.reason_code);
  const reasons = [...new Set(failed)];
  let verdict = "qualified";
  if (integrityReasons.length > 0) {
    verdict = "rejected";
  } else if (reasons.includes("insufficient_test_fills") || reasons.includes("insufficient_test_closed_trades")) {
    verdict = "insufficient_evidence";
  } else if (reasons.length > 0) {
    verdict = "rejected";
  }

  return finalizeEvaluation({
    evaluationId, batchId, definition, verdict, reasons, gates,
    train, validation, test, stresses, configHash, benchmark, createdAt,
  });
}

export async function stressReplay(artifactRecord, multiplier, evaluationId = "evaluation", createdAt = new Date().toISOString()) {
  if (![2, 3].includes(multiplier)) throw new Error("hostile_stress_multiplier_not_allowed");
  const artifact = parseJson(artifactRecord.content_json, "hostile_artifact_json_invalid");
  const fillsByCandle = new Map();
  for (const fill of artifact.fills || []) {
    const list = fillsByCandle.get(fill.source_candle_closed_at) || [];
    list.push(fill);
    fillsByCandle.set(fill.source_candle_closed_at, list);
  }
  let cash = INITIAL_CASH;
  let quantity = 0;
  let totalFees = 0;
  let peak = INITIAL_CASH;
  let maxDrawdown = 0;
  let tradeCount = 0;
  const feeBps = BASE_FEE_BPS * multiplier;
  const slippageBps = BASE_SLIPPAGE_BPS * multiplier;

  for (const point of artifact.equity_curve || []) {
    for (const fill of fillsByCandle.get(point.close_time) || []) {
      if (fill.side === "buy" && quantity === 0) {
        const rawOpen = Number(fill.price) / (1 + BASE_SLIPPAGE_BPS / 10000);
        const price = rawOpen * (1 + slippageBps / 10000);
        const feeRate = feeBps / 10000;
        const notional = cash / (1 + feeRate);
        const fee = notional * feeRate;
        quantity = notional / price;
        cash = clampZero(cash - notional - fee);
        totalFees += fee;
      } else if (fill.side === "sell" && quantity > 0) {
        const rawOpen = Number(fill.price) / (1 - BASE_SLIPPAGE_BPS / 10000);
        const price = rawOpen * (1 - slippageBps / 10000);
        const notional = quantity * price;
        const fee = notional * (feeBps / 10000);
        cash += notional - fee;
        totalFees += fee;
        quantity = 0;
        tradeCount += 1;
      }
    }
    const equity = cash + quantity * Number(point.mark_price);
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak ? ((peak - equity) / peak) * 100 : 0);
  }
  const finalMark = Number(artifact.equity_curve?.at(-1)?.mark_price || 0);
  const endingEquity = cash + quantity * finalMark;
  const metrics = {
    initial_cash: INITIAL_CASH,
    ending_equity: endingEquity,
    total_return_percent: ((endingEquity / INITIAL_CASH) - 1) * 100,
    max_drawdown_percent: maxDrawdown,
    total_fees: totalFees,
    fill_count: (artifact.fills || []).length,
    trade_count: tradeCount,
    open_position_quantity: quantity,
  };
  const resultHash = await stableHash({
    evaluation_id: evaluationId,
    cost_multiplier: multiplier,
    fee_bps: feeBps,
    slippage_bps: slippageBps,
    metrics,
  });
  return {
    id: `${evaluationId}:stress:${multiplier}x`,
    evaluation_id: evaluationId,
    cost_multiplier: multiplier,
    fee_bps: feeBps,
    slippage_bps: slippageBps,
    metrics,
    metrics_json: JSON.stringify(metrics),
    result_hash: resultHash,
    created_at: iso(createdAt, "created_at"),
  };
}

async function verifyRunIntegrity(run, definition) {
  const artifact = parseJson(run.artifact.content_json, "hostile_artifact_json_invalid");
  const artifactWithoutResultHash = { ...artifact };
  delete artifactWithoutResultHash.result_hash;
  const expectedResultHash = await stableHash(artifactWithoutResultHash);
  const expectedArtifactHash = await stableHash(run.artifact.content_json);
  return [
    integrity("dataset_hash", artifact.dataset_hash === run.dataset_hash,
      { artifact: artifact.dataset_hash, run: run.dataset_hash }, { equality: true }, "dataset_hash_mismatch"),
    integrity("result_hash", artifact.result_hash === run.result_hash && expectedResultHash === run.result_hash,
      { artifact: artifact.result_hash, recomputed: expectedResultHash, run: run.result_hash }, { equality: true }, "result_hash_mismatch"),
    integrity("artifact_hash", expectedArtifactHash === run.artifact.artifact_hash,
      { recomputed: expectedArtifactHash, stored: run.artifact.artifact_hash }, { equality: true }, "artifact_hash_mismatch"),
    integrity("artifact_link", artifact.baseline_id === definition.id
      && artifact.partition_name === run.partition_name
      && artifact.spec_hash === definition.spec_hash,
      { baseline_id: artifact.baseline_id, partition_name: artifact.partition_name, spec_hash: artifact.spec_hash },
      { baseline_id: definition.id, partition_name: run.partition_name, spec_hash: definition.spec_hash }, "artifact_link_mismatch"),
  ];
}

function finalizeEvaluation({ evaluationId, batchId, definition, verdict, reasons, gates, train, validation, test, stresses, configHash, benchmark, createdAt }) {
  const summary = {
    baseline_id: definition.id,
    verdict,
    reason_codes: reasons,
    promotion_performed: false,
    live_capital_enabled: false,
    train_return_percent: train ? metrics(train).total_return_percent : null,
    validation_return_percent: validation ? metrics(validation).total_return_percent : null,
    test_return_percent: test ? metrics(test).total_return_percent : null,
    test_drawdown_percent: test ? metrics(test).max_drawdown_percent : null,
    test_fill_count: test ? metrics(test).fill_count : null,
    test_trade_count: test ? metrics(test).trade_count : null,
    doubled_cost_return_percent: stresses.find((entry) => entry.cost_multiplier === 2)?.metrics.total_return_percent ?? null,
    tripled_cost_return_percent: stresses.find((entry) => entry.cost_multiplier === 3)?.metrics.total_return_percent ?? null,
  };
  const evidenceHashInput = {
    baseline_id: definition.id,
    definition_hash: definition.spec_hash,
    benchmark_hash: benchmark.benchmark_hash,
    judge_config_hash: configHash,
    train_result_hash: train?.result_hash || "missing",
    validation_result_hash: validation?.result_hash || "missing",
    test_result_hash: test?.result_hash || "missing",
    gates: gates.map((gate) => ({ code: gate.gate_code, passed: gate.passed, reason: gate.reason_code })),
    stresses: stresses.map((entry) => ({ multiplier: entry.cost_multiplier, result_hash: entry.result_hash })),
    verdict,
  };
  return stableHash(evidenceHashInput).then((evidenceHash) => ({
    id: evaluationId,
    batch_id: batchId,
    baseline_id: definition.id,
    verdict,
    reason_codes: reasons,
    reason_codes_json: JSON.stringify(reasons),
    evidence_hash: evidenceHash,
    train_result_hash: train?.result_hash || "missing",
    validation_result_hash: validation?.result_hash || "missing",
    test_result_hash: test?.result_hash || "missing",
    summary,
    summary_json: JSON.stringify(summary),
    gates,
    stresses,
    created_at: createdAt,
  }));
}

function addGate(gates, evaluationId, code, passed, observed, threshold, reasonCode, createdAt) {
  gates.push({
    id: `${evaluationId}:gate:${code}`,
    evaluation_id: evaluationId,
    gate_code: code,
    passed: passed ? 1 : 0,
    observed_json: JSON.stringify(observed),
    threshold_json: JSON.stringify(threshold),
    reason_code: reasonCode,
    created_at: createdAt,
  });
}

function integrity(code, passed, observed, threshold, reasonCode) {
  return { code, passed, observed, threshold, reason_code: reasonCode };
}

function metrics(run) {
  const value = typeof run.metrics === "object" && run.metrics !== null
    ? run.metrics
    : parseJson(run.metrics_json, "hostile_metrics_json_invalid");
  for (const key of ["total_return_percent", "max_drawdown_percent", "fill_count", "trade_count"]) {
    if (!Number.isFinite(Number(value[key]))) throw new Error(`hostile_metric_invalid:${key}`);
  }
  return {
    ...value,
    total_return_percent: Number(value.total_return_percent),
    max_drawdown_percent: Number(value.max_drawdown_percent),
    fill_count: Number(value.fill_count),
    trade_count: Number(value.trade_count),
  };
}

function validateEvidenceShape(evidence) {
  if (!evidence?.benchmark?.id || !evidence.benchmark.benchmark_hash) throw new Error("hostile_benchmark_evidence_missing");
  if (!Array.isArray(evidence.definitions) || evidence.definitions.length === 0) throw new Error("hostile_definitions_missing");
  if (!Array.isArray(evidence.runs) || evidence.runs.length === 0) throw new Error("hostile_runs_missing");
}

async function readBenchmarkEvidence(env, benchmarkId) {
  const benchmark = await env.DB.prepare(
    `SELECT id, benchmark_hash, dataset_hash, partition_manifest_json, cost_model_json, summary_json, created_at
     FROM baseline_benchmarks WHERE id = ?`,
  ).bind(benchmarkId).first();
  if (!benchmark) throw new Error("hostile_benchmark_not_found");
  const definitionsRows = await env.DB.prepare(
    `SELECT id, version, kind, spec_json, spec_hash, created_at
     FROM baseline_definitions ORDER BY id ASC`,
  ).all();
  const runRows = await env.DB.prepare(
    `SELECT r.id, r.benchmark_id, r.baseline_id, r.partition_name, r.spec_hash,
            r.dataset_hash, r.result_hash, r.metrics_json, r.order_count, r.fill_count,
            r.trade_count, r.created_at, a.id AS artifact_id, a.artifact_type,
            a.artifact_hash, a.content_json, a.created_at AS artifact_created_at
     FROM baseline_runs r
     JOIN baseline_artifacts a ON a.run_id = r.id
     WHERE r.benchmark_id = ?
     ORDER BY r.baseline_id, r.partition_name`,
  ).bind(benchmarkId).all();
  return {
    benchmark,
    definitions: definitionsRows.results || [],
    runs: (runRows.results || []).map((run) => ({
      ...run,
      metrics: parseJson(run.metrics_json, "hostile_metrics_json_invalid"),
      artifact: {
        id: run.artifact_id,
        run_id: run.id,
        artifact_type: run.artifact_type,
        artifact_hash: run.artifact_hash,
        content_json: run.content_json,
        created_at: run.artifact_created_at,
      },
    })),
  };
}

async function persistBatch(env, built, configExists) {
  const statements = [];
  if (!configExists) {
    statements.push(env.DB.prepare(
      `INSERT INTO hostile_judge_configs (id, version, config_json, config_hash, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(built.config.id, built.config.version, built.config.config_json, built.config.config_hash, built.config.created_at));
  }
  statements.push(env.DB.prepare(
    `INSERT INTO hostile_judge_batches (
       id, benchmark_id, benchmark_hash, judge_config_id, judge_config_hash, status,
       evaluation_count, qualified_count, insufficient_count, rejected_count,
       summary_json, batch_hash, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    built.batch.id, built.batch.benchmark_id, built.batch.benchmark_hash,
    built.batch.judge_config_id, built.batch.judge_config_hash, built.batch.status,
    built.batch.evaluation_count, built.batch.qualified_count, built.batch.insufficient_count,
    built.batch.rejected_count, built.batch.summary_json, built.batch.batch_hash, built.batch.created_at,
  ));
  for (const evaluation of built.evaluations) {
    statements.push(env.DB.prepare(
      `INSERT INTO hostile_judge_evaluations (
         id, batch_id, baseline_id, verdict, reason_codes_json, evidence_hash,
         train_result_hash, validation_result_hash, test_result_hash, summary_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      evaluation.id, evaluation.batch_id, evaluation.baseline_id, evaluation.verdict,
      evaluation.reason_codes_json, evaluation.evidence_hash, evaluation.train_result_hash,
      evaluation.validation_result_hash, evaluation.test_result_hash, evaluation.summary_json,
      evaluation.created_at,
    ));
    for (const gate of evaluation.gates) {
      statements.push(env.DB.prepare(
        `INSERT INTO hostile_judge_gate_results (
           id, evaluation_id, gate_code, passed, observed_json, threshold_json, reason_code, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(gate.id, gate.evaluation_id, gate.gate_code, gate.passed, gate.observed_json, gate.threshold_json, gate.reason_code, gate.created_at));
    }
    for (const stress of evaluation.stresses) {
      statements.push(env.DB.prepare(
        `INSERT INTO hostile_judge_stress_results (
           id, evaluation_id, cost_multiplier, fee_bps, slippage_bps, metrics_json, result_hash, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(stress.id, stress.evaluation_id, stress.cost_multiplier, stress.fee_bps, stress.slippage_bps, stress.metrics_json, stress.result_hash, stress.created_at));
    }
  }
  await env.DB.batch(statements);
}

async function readBatch(env, batchId) {
  const row = await env.DB.prepare(
    `SELECT id, summary_json, created_at FROM hostile_judge_batches WHERE id = ?`,
  ).bind(batchId).first();
  if (!row) return null;
  return { ...parseJson(row.summary_json, "hostile_judge_summary_invalid"), batch_id: row.id, created_at: row.created_at };
}

async function readJudgeConfig(env, judgeId) {
  return env.DB.prepare(
    `SELECT id, version, config_hash, created_at FROM hostile_judge_configs WHERE id = ?`,
  ).bind(judgeId).first();
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function clampZero(value) { return Math.abs(value) <= EPSILON ? 0 : value; }
function iso(value, field) {
  const millis = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(millis)) throw new Error(`hostile_invalid_${field}`);
  return new Date(millis).toISOString();
}
function parseJson(value, code) { try { return JSON.parse(value); } catch { throw new Error(code); } }
async function stableHash(value) {
  const text = typeof value === "string" ? value : canonicalJson(value);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return `sha256:${base64Url(new Uint8Array(digest))}`;
}
function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}
function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
