import { runBaseline } from "./baselineBench.js";
import { buildHostileJudgeBatch, HOSTILE_JUDGE_CONFIG } from "./hostileJudge.js";

const POLICY_ID = "controlled-strategy-factory-v1";
const BATCH_ID = "stage5-controlled-factory-v1";
const SOURCE_BENCHMARK_ID = "stage3-baseline-bench-v1";
const MARKET = "BTC-USD";
const INTERVAL = "1h";
const MAX_STATEMENTS_PER_BATCH = 40;

export const FACTORY_CANDIDATE_CATALOG = deepFreeze([
  candidate("candidate-ema-6-24-v1", "ema_cross", "baseline-ema-12-26-v1", { fast: 6, slow: 24 }),
  candidate("candidate-ema-8-32-v1", "ema_cross", "baseline-ema-12-26-v1", { fast: 8, slow: 32 }),
  candidate("candidate-ema-12-36-v1", "ema_cross", "baseline-ema-12-26-v1", { fast: 12, slow: 36 }),
  candidate("candidate-ema-18-48-v1", "ema_cross", "baseline-ema-12-26-v1", { fast: 18, slow: 48 }),
  candidate("candidate-rsi-7-25-55-v1", "rsi_mean_reversion", "baseline-rsi-14-30-55-v1", { period: 7, entry_below: 25, exit_above: 55 }),
  candidate("candidate-rsi-14-25-55-v1", "rsi_mean_reversion", "baseline-rsi-14-30-55-v1", { period: 14, entry_below: 25, exit_above: 55 }),
  candidate("candidate-rsi-14-30-60-v1", "rsi_mean_reversion", "baseline-rsi-14-30-55-v1", { period: 14, entry_below: 30, exit_above: 60 }),
  candidate("candidate-rsi-21-35-65-v1", "rsi_mean_reversion", "baseline-rsi-14-30-55-v1", { period: 21, entry_below: 35, exit_above: 65 }),
]);

export const FACTORY_POLICY = deepFreeze({
  id: POLICY_ID,
  version: 1,
  candidate_count: FACTORY_CANDIDATE_CATALOG.length,
  candidate_ids: FACTORY_CANDIDATE_CATALOG.map((entry) => entry.id),
  source_benchmark_id: SOURCE_BENCHMARK_ID,
  dataset_policy: "exact_frozen_stage3_partitions",
  execution_policy: "stage3_fixed_next_candle_cost_model",
  judge_policy: HOSTILE_JUDGE_CONFIG.id,
  adaptive_tuning_allowed: false,
  result_dependent_expansion_allowed: false,
  promotion_allowed: false,
  forward_scheduling_allowed: false,
  live_capital_enabled: false,
});

export async function runProductionStrategyFactory(env, options = {}) {
  const existing = await readFactoryBatch(env, BATCH_ID);
  if (existing) return { ...existing, replayed: true };
  const source = await readFrozenSource(env, SOURCE_BENCHMARK_ID);
  const built = await buildStrategyFactoryBatch(source, {
    batchId: BATCH_ID,
    createdAt: options.now || new Date(),
  });
  await persistStrategyFactoryBatch(env, built);
  return { ...built.summary, replayed: false };
}

export async function getStrategyFactorySummary(env) {
  const row = await env.DB.prepare(
    `SELECT id, summary_json, created_at FROM strategy_factory_batches
     ORDER BY created_at DESC LIMIT 1`,
  ).first();
  if (!row) return null;
  return { ...parseJson(row.summary_json, "factory_summary_invalid"), batch_id: row.id, created_at: row.created_at };
}

export async function buildStrategyFactoryBatch(source, options = {}) {
  const batchId = options.batchId || BATCH_ID;
  const createdAt = iso(options.createdAt || new Date(), "created_at");
  const policyDefinition = options.policy || FACTORY_POLICY;
  const candidateCatalog = options.candidateCatalog || FACTORY_CANDIDATE_CATALOG;
  const sourceBenchmarkId = options.sourceBenchmarkId || SOURCE_BENCHMARK_ID;
  validateSource(source, sourceBenchmarkId);
  const policyHash = await stableHash(policyDefinition);
  const policy = {
    id: policyDefinition.id,
    version: policyDefinition.version,
    policy_json: canonicalJson(policyDefinition),
    policy_hash: policyHash,
    created_at: createdAt,
  };
  const definitions = [];
  for (const catalogEntry of candidateCatalog) {
    const spec = {
      schema: "controlled_candidate_v1",
      id: catalogEntry.id,
      version: 1,
      kind: catalogEntry.kind,
      market: MARKET,
      interval: INTERVAL,
      direction: "long",
      position_size_percent: 100,
      parameters: catalogEntry.parameters,
      tuning_allowed: false,
      parent_reference_id: catalogEntry.parent_reference_id,
      generation_policy_id: policyDefinition.id,
    };
    const specHash = await stableHash(spec);
    const lineageHash = await stableHash({
      candidate_id: spec.id,
      parent_reference_id: spec.parent_reference_id,
      policy_hash: policyHash,
      spec_hash: specHash,
    });
    definitions.push({
      ...spec,
      spec_json: canonicalJson(spec),
      spec_hash: specHash,
      lineage_hash: lineageHash,
      created_at: createdAt,
    });
  }
  assertCatalogExact(definitions, candidateCatalog);

  const runs = [];
  for (const definition of definitions) {
    for (const [partitionName, candles] of Object.entries(source.partitions)) {
      runs.push(await runBaseline({
        benchmarkId: batchId,
        definition,
        partitionName,
        candles,
        datasetHash: source.partition_manifest[partitionName].dataset_hash,
        createdAt,
      }));
    }
  }
  const candidateBenchmarkHash = await stableHash({
    batch_id: batchId,
    source_benchmark_hash: source.benchmark.benchmark_hash,
    policy_hash: policyHash,
    candidate_specs: definitions.map((entry) => ({
      id: entry.id,
      spec_hash: entry.spec_hash,
      lineage_hash: entry.lineage_hash,
    })),
    runs: runs.map((run) => ({ id: run.id, result_hash: run.result_hash })),
  });
  const judge = await buildHostileJudgeBatch({
    benchmark: { id: batchId, benchmark_hash: candidateBenchmarkHash },
    definitions,
    runs,
  }, { batchId: `${batchId}:hostile-judge-v1`, createdAt });

  const verdicts = judge.evaluations.map((evaluation) => ({
    id: `${batchId}:verdict:${evaluation.baseline_id}`,
    batch_id: batchId,
    candidate_id: evaluation.baseline_id,
    judge_config_hash: judge.config.config_hash,
    verdict: evaluation.verdict,
    reason_codes: evaluation.reason_codes,
    reason_codes_json: evaluation.reason_codes_json,
    evidence_hash: evaluation.evidence_hash,
    summary: evaluation.summary,
    summary_json: evaluation.summary_json,
    gates: evaluation.gates,
    stresses: evaluation.stresses,
    created_at: createdAt,
  }));
  const counts = {
    qualified: verdicts.filter((entry) => entry.verdict === "qualified").length,
    insufficient: verdicts.filter((entry) => entry.verdict === "insufficient_evidence").length,
    rejected: verdicts.filter((entry) => entry.verdict === "rejected").length,
  };
  const batchHash = await stableHash({
    batch_id: batchId,
    policy_hash: policyHash,
    source_benchmark_hash: source.benchmark.benchmark_hash,
    judge_config_hash: judge.config.config_hash,
    definitions: definitions.map((entry) => ({
      id: entry.id,
      spec_hash: entry.spec_hash,
      lineage_hash: entry.lineage_hash,
    })),
    runs: runs.map((run) => ({ id: run.id, result_hash: run.result_hash })),
    verdicts: verdicts.map((entry) => ({
      candidate_id: entry.candidate_id,
      verdict: entry.verdict,
      evidence_hash: entry.evidence_hash,
    })),
  });
  const summary = {
    ok: true,
    historical_paper_research: true,
    live_capital_enabled: false,
    promotion_performed: false,
    adaptive_tuning_allowed: false,
    result_dependent_expansion_allowed: false,
    factory_policy_id: policyDefinition.id,
    factory_policy_hash: policyHash,
    batch_id: batchId,
    batch_hash: batchHash,
    source_benchmark_id: source.benchmark.id,
    source_benchmark_hash: source.benchmark.benchmark_hash,
    dataset_candle_count: source.candles.length,
    judge_config_hash: judge.config.config_hash,
    candidate_count: definitions.length,
    run_count: runs.length,
    qualified_count: counts.qualified,
    insufficient_count: counts.insufficient,
    rejected_count: counts.rejected,
    verdicts: verdicts.map((entry) => ({
      candidate_id: entry.candidate_id,
      family: definitions.find((definition) => definition.id === entry.candidate_id).kind,
      verdict: entry.verdict,
      reason_codes: entry.reason_codes,
    })),
    created_at: createdAt,
  };
  return {
    policy,
    definitions,
    runs,
    verdicts,
    batch: {
      id: batchId,
      policy_id: policyDefinition.id,
      policy_hash: policyHash,
      source_benchmark_id: source.benchmark.id,
      source_benchmark_hash: source.benchmark.benchmark_hash,
      judge_config_hash: judge.config.config_hash,
      candidate_count: definitions.length,
      qualified_count: counts.qualified,
      insufficient_count: counts.insufficient,
      rejected_count: counts.rejected,
      summary_json: JSON.stringify(summary),
      batch_hash: batchHash,
      created_at: createdAt,
    },
    summary,
  };
}

async function readFrozenSource(env, benchmarkId) {
  const benchmark = await env.DB.prepare(
    `SELECT id, benchmark_hash, dataset_start_closed_at, dataset_end_closed_at,
            dataset_candle_count, dataset_hash, partition_manifest_json, cost_model_json
     FROM baseline_benchmarks WHERE id = ?`,
  ).bind(benchmarkId).first();
  if (!benchmark) throw new Error("factory_source_benchmark_not_found");
  const rows = await env.DB.prepare(
    `SELECT pair AS market, interval, closed_at, open, high, low, close, volume, source
     FROM market_candles
     WHERE pair = ? AND interval = ? AND closed_at >= ? AND closed_at <= ?
     ORDER BY closed_at ASC`,
  ).bind(MARKET, INTERVAL, benchmark.dataset_start_closed_at, benchmark.dataset_end_closed_at).all();
  const candles = rows.results || [];
  const manifest = parseJson(benchmark.partition_manifest_json, "factory_partition_manifest_invalid");
  const trainEnd = manifest.train.candle_count;
  const validationEnd = trainEnd + manifest.validation.candle_count;
  const partitions = {
    train: candles.slice(0, trainEnd),
    validation: candles.slice(trainEnd, validationEnd),
    test: candles.slice(validationEnd),
  };
  return { benchmark, candles, partition_manifest: manifest, partitions };
}

function validateSource(source, expectedBenchmarkId = SOURCE_BENCHMARK_ID) {
  if (!source?.benchmark?.id || source.benchmark.id !== expectedBenchmarkId) {
    throw new Error("factory_source_benchmark_mismatch");
  }
  if (source.candles.length !== Number(source.benchmark.dataset_candle_count)) {
    throw new Error("factory_source_candle_count_mismatch");
  }
  for (const name of ["train", "validation", "test"]) {
    const partition = source.partitions[name];
    const manifest = source.partition_manifest[name];
    if (!partition || partition.length !== Number(manifest.candle_count)) {
      throw new Error(`factory_partition_count_mismatch:${name}`);
    }
    if (
      partition[0].closed_at !== manifest.start_closed_at
      || partition.at(-1).closed_at !== manifest.end_closed_at
    ) {
      throw new Error(`factory_partition_boundary_mismatch:${name}`);
    }
  }
}

function assertCatalogExact(definitions, candidateCatalog = FACTORY_CANDIDATE_CATALOG) {
  const expected = candidateCatalog.map((entry) => entry.id);
  const actual = definitions.map((entry) => entry.id);
  if (canonicalJson(actual) !== canonicalJson(expected)) throw new Error("factory_catalog_changed");
  if (new Set(actual).size !== actual.length || actual.length !== 8) {
    throw new Error("factory_catalog_cardinality_invalid");
  }
}

export async function persistStrategyFactoryBatch(env, built) {
  const evidenceStatements = [];
  evidenceStatements.push(env.DB.prepare(
    `INSERT OR IGNORE INTO strategy_factory_policies
       (id, version, policy_json, policy_hash, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).bind(
    built.policy.id,
    built.policy.version,
    built.policy.policy_json,
    built.policy.policy_hash,
    built.policy.created_at,
  ));
  for (const definition of built.definitions) {
    evidenceStatements.push(env.DB.prepare(
      `INSERT OR IGNORE INTO strategy_candidates
       (id, batch_id, family, parent_reference_id, spec_json, spec_hash, lineage_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      definition.id,
      built.batch.id,
      definition.kind,
      definition.parent_reference_id,
      definition.spec_json,
      definition.spec_hash,
      definition.lineage_hash,
      definition.created_at,
    ));
  }
  await runStatementChunks(env, evidenceStatements);

  const runStatements = [];
  for (const run of built.runs) {
    runStatements.push(env.DB.prepare(
      `INSERT OR IGNORE INTO strategy_candidate_runs (
         id, batch_id, candidate_id, partition_name, spec_hash, dataset_hash, result_hash,
         metrics_json, order_count, fill_count, trade_count, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      run.id,
      built.batch.id,
      run.baseline_id,
      run.partition_name,
      run.spec_hash,
      run.dataset_hash,
      run.result_hash,
      run.metrics_json,
      run.order_count,
      run.fill_count,
      run.trade_count,
      run.created_at,
    ));
    runStatements.push(env.DB.prepare(
      `INSERT OR IGNORE INTO strategy_candidate_artifacts
       (id, run_id, artifact_hash, content_json, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(
      run.artifact.id,
      run.id,
      run.artifact.artifact_hash,
      run.artifact.content_json,
      run.artifact.created_at,
    ));
    for (const trade of run.trades) {
      runStatements.push(env.DB.prepare(
        `INSERT OR IGNORE INTO strategy_candidate_trades (
           id, run_id, entry_fill_id, exit_fill_id, entry_time, exit_time, quantity,
           entry_price, exit_price, gross_pnl, net_pnl, net_pnl_percent, total_fees, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        trade.id,
        run.id,
        trade.entry_fill_id,
        trade.exit_fill_id,
        trade.entry_time,
        trade.exit_time,
        trade.quantity,
        trade.entry_price,
        trade.exit_price,
        trade.gross_pnl,
        trade.net_pnl,
        trade.net_pnl_percent,
        trade.total_fees,
        trade.created_at,
      ));
    }
  }
  await runStatementChunks(env, runStatements);

  const verdictStatements = [];
  for (const verdict of built.verdicts) {
    verdictStatements.push(env.DB.prepare(
      `INSERT OR IGNORE INTO strategy_candidate_verdicts (
         id, batch_id, candidate_id, judge_config_hash, verdict, reason_codes_json,
         evidence_hash, summary_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      verdict.id,
      verdict.batch_id,
      verdict.candidate_id,
      verdict.judge_config_hash,
      verdict.verdict,
      verdict.reason_codes_json,
      verdict.evidence_hash,
      verdict.summary_json,
      verdict.created_at,
    ));
    for (const gate of verdict.gates) {
      verdictStatements.push(env.DB.prepare(
        `INSERT OR IGNORE INTO strategy_candidate_gate_results (
           id, verdict_id, gate_code, passed, observed_json, threshold_json, reason_code, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        `${verdict.id}:${gate.gate_code}`,
        verdict.id,
        gate.gate_code,
        gate.passed,
        gate.observed_json,
        gate.threshold_json,
        gate.reason_code,
        gate.created_at,
      ));
    }
    for (const stress of verdict.stresses) {
      verdictStatements.push(env.DB.prepare(
        `INSERT OR IGNORE INTO strategy_candidate_stress_results (
           id, verdict_id, cost_multiplier, fee_bps, slippage_bps, metrics_json, result_hash, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        `${verdict.id}:stress:${stress.cost_multiplier}x`,
        verdict.id,
        stress.cost_multiplier,
        stress.fee_bps,
        stress.slippage_bps,
        stress.metrics_json,
        stress.result_hash,
        stress.created_at,
      ));
    }
  }
  await runStatementChunks(env, verdictStatements);

  const existing = await readFactoryBatch(env, built.batch.id);
  if (existing) {
    if (existing.batch_hash !== built.batch.batch_hash) throw new Error("factory_batch_hash_conflict");
    return;
  }
  await env.DB.prepare(
    `INSERT INTO strategy_factory_batches (
       id, policy_id, policy_hash, source_benchmark_id, source_benchmark_hash,
       judge_config_hash, candidate_count, qualified_count, insufficient_count,
       rejected_count, summary_json, batch_hash, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    built.batch.id,
    built.batch.policy_id,
    built.batch.policy_hash,
    built.batch.source_benchmark_id,
    built.batch.source_benchmark_hash,
    built.batch.judge_config_hash,
    built.batch.candidate_count,
    built.batch.qualified_count,
    built.batch.insufficient_count,
    built.batch.rejected_count,
    built.batch.summary_json,
    built.batch.batch_hash,
    built.batch.created_at,
  ).run();
}

async function runStatementChunks(env, statements) {
  for (let index = 0; index < statements.length; index += MAX_STATEMENTS_PER_BATCH) {
    await env.DB.batch(statements.slice(index, index + MAX_STATEMENTS_PER_BATCH));
  }
}

async function readFactoryBatch(env, batchId) {
  const row = await env.DB.prepare(
    `SELECT id, batch_hash, summary_json, created_at
     FROM strategy_factory_batches WHERE id = ?`,
  ).bind(batchId).first();
  if (!row) return null;
  return {
    ...parseJson(row.summary_json, "factory_summary_invalid"),
    batch_id: row.id,
    batch_hash: row.batch_hash,
    created_at: row.created_at,
  };
}

function candidate(id, kind, parentReferenceId, parameters) {
  return { id, kind, parent_reference_id: parentReferenceId, parameters };
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function iso(value, field) {
  const millis = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(millis)) throw new Error(`factory_invalid_${field}`);
  return new Date(millis).toISOString();
}

function parseJson(value, code) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(code);
  }
}

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
