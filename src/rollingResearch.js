import { BASELINE_COST_MODEL } from "./baselineBench.js";
import {
  FACTORY_CANDIDATE_CATALOG,
  buildStrategyFactoryBatch,
  persistStrategyFactoryBatch,
} from "./strategyFactory.js";
import {
  buildChampionSelection,
  runChampionSelectionForFactoryBatch,
} from "./championSelection.js";

const POLICY_ID = "autonomous-rolling-research-v1";
const FACTORY_POLICY_ID = "rolling-strategy-factory-v1";
const MARKET = "BTC-USD";
const INTERVAL = "1h";
const REQUIRED_CANDLES = 720;
const TRAIN_CANDLES = 432;
const VALIDATION_CANDLES = 144;
const TEST_CANDLES = 144;
const HOUR_MS = 60 * 60 * 1000;

export const ROLLING_RESEARCH_POLICY = deepFreeze({
  id: POLICY_ID,
  version: 1,
  cadence: "one_epoch_per_utc_date",
  required_contiguous_hourly_candles: REQUIRED_CANDLES,
  trailing_window_candles: REQUIRED_CANDLES,
  partitions: {
    train: TRAIN_CANDLES,
    validation: VALIDATION_CANDLES,
    test: TEST_CANDLES,
  },
  market: MARKET,
  interval: INTERVAL,
  completed_candles_only: true,
  cost_model: BASELINE_COST_MODEL,
  base_candidate_ids: FACTORY_CANDIDATE_CATALOG.map((entry) => entry.id),
  candidate_instance_rule: "base_candidate_id:rolling:utc_date",
  candidate_parameters_mutable: false,
  result_dependent_expansion_allowed: false,
  hostile_judge_policy: "hostile-judge-v1",
  selection_policy: "qualified-only-selection-v1",
  same_candle_activation_allowed: false,
  live_capital_enabled: false,
});

export const ROLLING_FACTORY_POLICY = deepFreeze({
  id: FACTORY_POLICY_ID,
  version: 1,
  candidate_count: FACTORY_CANDIDATE_CATALOG.length,
  base_candidate_ids: FACTORY_CANDIDATE_CATALOG.map((entry) => entry.id),
  instance_id_rule: ROLLING_RESEARCH_POLICY.candidate_instance_rule,
  dataset_policy: "trailing_720_contiguous_completed_candles",
  partition_policy: "fixed_432_144_144",
  execution_policy: "stage3_fixed_next_candle_cost_model",
  judge_policy: "hostile-judge-v1",
  adaptive_tuning_allowed: false,
  result_dependent_expansion_allowed: false,
  promotion_allowed: false,
  live_capital_enabled: false,
});

export async function runProductionRollingResearch(env, options = {}) {
  const asOfClosedAt = options.asOfClosedAt
    ? iso(options.asOfClosedAt, "as_of_closed_at")
    : await latestMarketClose(env);
  if (!asOfClosedAt) throw new Error("rolling_research_market_history_missing");
  const epochDate = options.epochDate || asOfClosedAt.slice(0, 10);
  const epochId = `${POLICY_ID}:${epochDate}`;
  const existing = await readEpoch(env, epochId);
  if (existing) return { ...existing, replayed: true };

  const available = await countAvailableCandles(env, asOfClosedAt);
  const rows = await readTrailingCandles(env, asOfClosedAt, Math.min(REQUIRED_CANDLES, available));
  const built = await buildRollingResearchEpoch(rows, {
    epochDate,
    asOfClosedAt,
    availableCandleCount: available,
    createdAt: options.now || new Date(),
  });
  await ensurePolicy(env, built.policy);

  if (built.summary.state === "complete") {
    await persistBenchmark(env, built.benchmark);
    try {
      await persistStrategyFactoryBatch(env, built.factory);
    } catch (error) {
      const storedFactory = await env.DB.prepare(
        `SELECT batch_hash FROM strategy_factory_batches WHERE id = ?`,
      ).bind(built.factory.batch.id).first();
      if (!storedFactory || storedFactory.batch_hash !== built.factory.batch.batch_hash) throw error;
    }
    const selection = await runChampionSelectionForFactoryBatch(env, built.factory.batch.id, {
      batchId: built.selection.batch.id,
      now: built.summary.created_at,
    });
    if (selection.selection_hash !== built.selection.summary.selection_hash) {
      throw new Error("rolling_research_selection_hash_conflict");
    }
  }

  try {
    await persistEpoch(env, built.epoch);
  } catch (error) {
    const raced = await readEpoch(env, epochId);
    if (raced) return { ...raced, replayed: true };
    throw error;
  }
  return { ...built.summary, replayed: false };
}

export async function runScheduledRollingResearch(env, scheduledAt = new Date()) {
  const scheduled = iso(scheduledAt, "scheduled_at");
  const receiptId = `rolling-research-scheduler:${scheduled}`;
  const existing = await readSchedulerReceipt(env, receiptId);
  if (existing) return { ...existing, replayed: true };
  const epoch = await runProductionRollingResearch(env, { now: scheduledAt });
  const receipt = {
    id: receiptId,
    scheduled_at: scheduled,
    epoch_id: epoch.epoch_id,
    state: epoch.state,
    result_hash: epoch.epoch_hash,
    summary_json: JSON.stringify({
      ok: true,
      paper_only: true,
      live_capital_enabled: false,
      scheduler_receipt_id: receiptId,
      scheduled_at: scheduled,
      epoch_id: epoch.epoch_id,
      epoch_date: epoch.epoch_date,
      state: epoch.state,
      blocker_codes: epoch.blocker_codes,
      available_candle_count: epoch.available_candle_count,
      required_candle_count: epoch.required_candle_count,
      benchmark_id: epoch.benchmark_id,
      factory_batch_id: epoch.factory_batch_id,
      selection_batch_id: epoch.selection_batch_id,
      epoch_hash: epoch.epoch_hash,
    }),
    created_at: new Date().toISOString(),
  };
  await env.DB.prepare(
    `INSERT OR IGNORE INTO rolling_research_scheduler_receipts
     (id, scheduled_at, epoch_id, state, result_hash, summary_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    receipt.id,
    receipt.scheduled_at,
    receipt.epoch_id,
    receipt.state,
    receipt.result_hash,
    receipt.summary_json,
    receipt.created_at,
  ).run();
  return { ...JSON.parse(receipt.summary_json), replayed: false };
}

export async function getRollingResearchSummary(env) {
  const epochRow = await env.DB.prepare(
    `SELECT id, summary_json, created_at
     FROM rolling_research_epochs
     ORDER BY epoch_date DESC
     LIMIT 1`,
  ).first();
  const receiptRow = await env.DB.prepare(
    `SELECT id, summary_json, created_at
     FROM rolling_research_scheduler_receipts
     ORDER BY scheduled_at DESC
     LIMIT 1`,
  ).first();
  return {
    paper_only: true,
    live_capital_enabled: false,
    latest_epoch: epochRow
      ? { ...parseJson(epochRow.summary_json, "rolling_epoch_summary_invalid"), epoch_id: epochRow.id, created_at: epochRow.created_at }
      : null,
    latest_scheduler_receipt: receiptRow
      ? { ...parseJson(receiptRow.summary_json, "rolling_scheduler_summary_invalid"), scheduler_receipt_id: receiptRow.id, created_at: receiptRow.created_at }
      : null,
  };
}

export async function buildRollingResearchEpoch(rawCandles, options = {}) {
  const epochDate = String(options.epochDate || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(epochDate)) throw new Error("rolling_epoch_date_invalid");
  const asOfClosedAt = iso(options.asOfClosedAt, "as_of_closed_at");
  const createdAt = iso(options.createdAt || new Date(), "created_at");
  const availableCandleCount = nonNegativeInteger(
    options.availableCandleCount ?? rawCandles.length,
    "available_candle_count",
  );
  const epochId = `${POLICY_ID}:${epochDate}`;
  const policyHash = await stableHash(ROLLING_RESEARCH_POLICY);
  const policy = {
    id: POLICY_ID,
    version: ROLLING_RESEARCH_POLICY.version,
    policy_json: canonicalJson(ROLLING_RESEARCH_POLICY),
    policy_hash: policyHash,
    created_at: createdAt,
  };
  const normalized = normalizeCandles(rawCandles);
  if (normalized.length > 0 && normalized.at(-1).closed_at !== asOfClosedAt) {
    throw new Error("rolling_as_of_boundary_mismatch");
  }
  const contiguousCandleCount = trailingContiguousCount(normalized);

  if (availableCandleCount < REQUIRED_CANDLES
    || normalized.length < REQUIRED_CANDLES
    || contiguousCandleCount < REQUIRED_CANDLES) {
    return buildWaitingEpoch({
      epochId,
      epochDate,
      asOfClosedAt,
      availableCandleCount,
      contiguousCandleCount,
      policy,
      createdAt,
    });
  }

  const candles = normalized.slice(-REQUIRED_CANDLES);
  assertContiguous(candles);
  const partitions = {
    train: candles.slice(0, TRAIN_CANDLES),
    validation: candles.slice(TRAIN_CANDLES, TRAIN_CANDLES + VALIDATION_CANDLES),
    test: candles.slice(TRAIN_CANDLES + VALIDATION_CANDLES),
  };
  const datasetHash = await stableHash(candles);
  const partitionManifest = {};
  for (const [name, partition] of Object.entries(partitions)) {
    partitionManifest[name] = {
      name,
      candle_count: partition.length,
      start_closed_at: partition[0].closed_at,
      end_closed_at: partition.at(-1).closed_at,
      dataset_hash: await stableHash(partition),
    };
  }

  const benchmarkId = `rolling-benchmark-v1:${epochDate}`;
  const benchmarkHash = await stableHash({
    benchmark_id: benchmarkId,
    dataset_hash: datasetHash,
    partition_manifest: partitionManifest,
    cost_model: BASELINE_COST_MODEL,
  });
  const benchmarkSummary = {
    ok: true,
    historical_paper_research: true,
    live_capital_enabled: false,
    rolling_research: true,
    benchmark_id: benchmarkId,
    benchmark_hash: benchmarkHash,
    market: MARKET,
    interval: INTERVAL,
    dataset_start_closed_at: candles[0].closed_at,
    dataset_end_closed_at: candles.at(-1).closed_at,
    dataset_candle_count: candles.length,
    dataset_hash: datasetHash,
    partition_manifest: partitionManifest,
    cost_model: BASELINE_COST_MODEL,
    created_at: createdAt,
  };
  const benchmark = {
    id: benchmarkId,
    market: MARKET,
    interval: INTERVAL,
    dataset_start_closed_at: candles[0].closed_at,
    dataset_end_closed_at: candles.at(-1).closed_at,
    dataset_candle_count: candles.length,
    dataset_hash: datasetHash,
    partition_manifest_json: JSON.stringify(partitionManifest),
    cost_model_json: JSON.stringify(BASELINE_COST_MODEL),
    benchmark_hash: benchmarkHash,
    status: "complete",
    summary_json: JSON.stringify(benchmarkSummary),
    created_at: createdAt,
  };
  const source = {
    benchmark,
    candles,
    partition_manifest: partitionManifest,
    partitions,
  };
  const candidateCatalog = rollingCandidateCatalog(epochDate);
  const factoryBatchId = `rolling-factory-v1:${epochDate}`;
  const factory = await buildStrategyFactoryBatch(source, {
    batchId: factoryBatchId,
    policy: ROLLING_FACTORY_POLICY,
    candidateCatalog,
    sourceBenchmarkId: benchmarkId,
    createdAt,
  });
  const selectionBatchId = `rolling-selection-v1:${epochDate}`;
  const selectionSource = {
    batch: factory.batch,
    candidates: factory.verdicts.map((verdict) => ({
      candidate_id: verdict.candidate_id,
      verdict: verdict.verdict,
      reason_codes: verdict.reason_codes,
      evidence_hash: verdict.evidence_hash,
      summary: verdict.summary,
    })),
  };
  const selection = await buildChampionSelection(selectionSource, {
    batchId: selectionBatchId,
    sourceFactoryBatchId: factoryBatchId,
    createdAt,
  });
  const epochHash = await stableHash({
    epoch_id: epochId,
    policy_hash: policyHash,
    dataset_hash: datasetHash,
    benchmark_hash: benchmarkHash,
    factory_batch_hash: factory.batch.batch_hash,
    selection_hash: selection.batch.selection_hash,
  });
  const summary = {
    ok: true,
    paper_only: true,
    live_capital_enabled: false,
    rolling_policy_id: POLICY_ID,
    rolling_policy_hash: policyHash,
    epoch_id: epochId,
    epoch_date: epochDate,
    as_of_closed_at: asOfClosedAt,
    state: "complete",
    blocker_codes: [],
    available_candle_count: availableCandleCount,
    contiguous_candle_count: contiguousCandleCount,
    required_candle_count: REQUIRED_CANDLES,
    dataset_candle_count: candles.length,
    dataset_hash: datasetHash,
    benchmark_id: benchmarkId,
    factory_batch_id: factoryBatchId,
    selection_batch_id: selectionBatchId,
    candidate_count: factory.summary.candidate_count,
    run_count: factory.summary.run_count,
    verdict_count: factory.verdicts.length,
    qualified_count: factory.summary.qualified_count,
    selection_state: selection.summary.state,
    champion_candidate_id: selection.summary.champion_candidate_id,
    same_candle_activation_allowed: false,
    epoch_hash: epochHash,
    created_at: createdAt,
  };
  return {
    policy,
    benchmark,
    source,
    factory,
    selection,
    epoch: epochRecord(summary, policyHash),
    summary,
  };
}

function buildWaitingEpoch({ epochId, epochDate, asOfClosedAt, availableCandleCount, contiguousCandleCount, policy, createdAt }) {
  return stableHash({
    epoch_id: epochId,
    policy_hash: policy.policy_hash,
    state: "waiting_for_history",
    available_candle_count: availableCandleCount,
    contiguous_candle_count: contiguousCandleCount,
    required_candle_count: REQUIRED_CANDLES,
    as_of_closed_at: asOfClosedAt,
  }).then((epochHash) => {
    const summary = {
      ok: true,
      paper_only: true,
      live_capital_enabled: false,
      rolling_policy_id: POLICY_ID,
      rolling_policy_hash: policy.policy_hash,
      epoch_id: epochId,
      epoch_date: epochDate,
      as_of_closed_at: asOfClosedAt,
      state: "waiting_for_history",
      blocker_codes: ["insufficient_contiguous_history"],
      available_candle_count: availableCandleCount,
      contiguous_candle_count: contiguousCandleCount,
      required_candle_count: REQUIRED_CANDLES,
      dataset_candle_count: 0,
      dataset_hash: null,
      benchmark_id: null,
      factory_batch_id: null,
      selection_batch_id: null,
      candidate_count: 0,
      run_count: 0,
      verdict_count: 0,
      qualified_count: 0,
      selection_state: null,
      champion_candidate_id: null,
      same_candle_activation_allowed: false,
      epoch_hash: epochHash,
      created_at: createdAt,
    };
    return {
      policy,
      benchmark: null,
      source: null,
      factory: null,
      selection: null,
      epoch: epochRecord(summary, policy.policy_hash),
      summary,
    };
  });
}

function epochRecord(summary, policyHash) {
  return {
    id: summary.epoch_id,
    policy_id: POLICY_ID,
    policy_hash: policyHash,
    epoch_date: summary.epoch_date,
    as_of_closed_at: summary.as_of_closed_at,
    state: summary.state,
    available_candle_count: summary.available_candle_count,
    required_candle_count: REQUIRED_CANDLES,
    dataset_hash: summary.dataset_hash,
    benchmark_id: summary.benchmark_id,
    factory_batch_id: summary.factory_batch_id,
    selection_batch_id: summary.selection_batch_id,
    blocker_codes_json: JSON.stringify(summary.blocker_codes),
    summary_json: JSON.stringify(summary),
    epoch_hash: summary.epoch_hash,
    created_at: summary.created_at,
  };
}

function rollingCandidateCatalog(epochDate) {
  return FACTORY_CANDIDATE_CATALOG.map((entry) => ({
    id: `${entry.id}:rolling:${epochDate}`,
    kind: entry.kind,
    parent_reference_id: entry.id,
    parameters: entry.parameters,
  }));
}

async function ensurePolicy(env, policy) {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO rolling_research_policies
     (id, version, policy_json, policy_hash, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).bind(policy.id, policy.version, policy.policy_json, policy.policy_hash, policy.created_at).run();
  const stored = await env.DB.prepare(
    `SELECT policy_hash FROM rolling_research_policies WHERE id = ?`,
  ).bind(policy.id).first();
  if (!stored || stored.policy_hash !== policy.policy_hash) throw new Error("rolling_policy_hash_conflict");
}

async function persistBenchmark(env, benchmark) {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO baseline_benchmarks (
       id, market, interval, dataset_start_closed_at, dataset_end_closed_at,
       dataset_candle_count, dataset_hash, partition_manifest_json, cost_model_json,
       benchmark_hash, status, summary_json, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    benchmark.id,
    benchmark.market,
    benchmark.interval,
    benchmark.dataset_start_closed_at,
    benchmark.dataset_end_closed_at,
    benchmark.dataset_candle_count,
    benchmark.dataset_hash,
    benchmark.partition_manifest_json,
    benchmark.cost_model_json,
    benchmark.benchmark_hash,
    benchmark.status,
    benchmark.summary_json,
    benchmark.created_at,
  ).run();
  const stored = await env.DB.prepare(
    `SELECT benchmark_hash FROM baseline_benchmarks WHERE id = ?`,
  ).bind(benchmark.id).first();
  if (!stored || stored.benchmark_hash !== benchmark.benchmark_hash) throw new Error("rolling_benchmark_hash_conflict");
}

async function persistEpoch(env, epoch) {
  await env.DB.prepare(
    `INSERT INTO rolling_research_epochs (
       id, policy_id, policy_hash, epoch_date, as_of_closed_at, state,
       available_candle_count, required_candle_count, dataset_hash, benchmark_id,
       factory_batch_id, selection_batch_id, blocker_codes_json, summary_json,
       epoch_hash, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    epoch.id,
    epoch.policy_id,
    epoch.policy_hash,
    epoch.epoch_date,
    epoch.as_of_closed_at,
    epoch.state,
    epoch.available_candle_count,
    epoch.required_candle_count,
    epoch.dataset_hash,
    epoch.benchmark_id,
    epoch.factory_batch_id,
    epoch.selection_batch_id,
    epoch.blocker_codes_json,
    epoch.summary_json,
    epoch.epoch_hash,
    epoch.created_at,
  ).run();
}

async function readEpoch(env, epochId) {
  const row = await env.DB.prepare(
    `SELECT id, summary_json, created_at FROM rolling_research_epochs WHERE id = ?`,
  ).bind(epochId).first();
  if (!row) return null;
  return { ...parseJson(row.summary_json, "rolling_epoch_summary_invalid"), epoch_id: row.id, created_at: row.created_at };
}

async function readSchedulerReceipt(env, receiptId) {
  const row = await env.DB.prepare(
    `SELECT id, summary_json, created_at FROM rolling_research_scheduler_receipts WHERE id = ?`,
  ).bind(receiptId).first();
  if (!row) return null;
  return { ...parseJson(row.summary_json, "rolling_scheduler_summary_invalid"), scheduler_receipt_id: row.id, created_at: row.created_at };
}

async function latestMarketClose(env) {
  const row = await env.DB.prepare(
    `SELECT closed_at FROM market_candles
     WHERE pair = ? AND interval = ?
     ORDER BY closed_at DESC LIMIT 1`,
  ).bind(MARKET, INTERVAL).first();
  return row?.closed_at || null;
}

async function countAvailableCandles(env, asOfClosedAt) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS candle_count FROM market_candles
     WHERE pair = ? AND interval = ? AND closed_at <= ?`,
  ).bind(MARKET, INTERVAL, asOfClosedAt).first();
  return Number(row?.candle_count || 0);
}

async function readTrailingCandles(env, asOfClosedAt, limit) {
  if (limit <= 0) return [];
  const rows = await env.DB.prepare(
    `SELECT pair AS market, interval, closed_at, open, high, low, close, volume, source
     FROM market_candles
     WHERE pair = ? AND interval = ? AND closed_at <= ?
     ORDER BY closed_at DESC LIMIT ?`,
  ).bind(MARKET, INTERVAL, asOfClosedAt, limit).all();
  return [...(rows.results || [])].reverse();
}

function normalizeCandles(rawCandles) {
  if (!Array.isArray(rawCandles)) throw new Error("rolling_candles_array_required");
  return rawCandles.map((raw) => {
    const candle = {
      market: String(raw.market || raw.pair || ""),
      interval: String(raw.interval || ""),
      closed_at: iso(raw.closed_at, "closed_at"),
      open: positive(raw.open, "open"),
      high: positive(raw.high, "high"),
      low: positive(raw.low, "low"),
      close: positive(raw.close, "close"),
      volume: nonNegative(raw.volume, "volume"),
      source: String(raw.source || "unknown"),
    };
    if (candle.market !== MARKET || candle.interval !== INTERVAL) throw new Error("rolling_market_interval_mismatch");
    if (candle.high < Math.max(candle.open, candle.close) || candle.low > Math.min(candle.open, candle.close) || candle.high < candle.low) {
      throw new Error("rolling_ohlc_invalid");
    }
    return candle;
  }).sort((left, right) => left.closed_at.localeCompare(right.closed_at));
}

function trailingContiguousCount(candles) {
  if (candles.length === 0) return 0;
  let count = 1;
  for (let index = candles.length - 1; index > 0; index -= 1) {
    if (Date.parse(candles[index].closed_at) - Date.parse(candles[index - 1].closed_at) !== HOUR_MS) break;
    count += 1;
  }
  return count;
}

function assertContiguous(candles) {
  if (candles.length !== REQUIRED_CANDLES) throw new Error("rolling_window_count_invalid");
  for (let index = 1; index < candles.length; index += 1) {
    if (Date.parse(candles[index].closed_at) - Date.parse(candles[index - 1].closed_at) !== HOUR_MS) {
      throw new Error(`rolling_history_gap:${candles[index - 1].closed_at}:${candles[index].closed_at}`);
    }
  }
}

function iso(value, field) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`rolling_${field}_invalid`);
  return date.toISOString();
}

function positive(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`rolling_${field}_invalid`);
  return number;
}

function nonNegative(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`rolling_${field}_invalid`);
  return number;
}

function nonNegativeInteger(value, field) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new Error(`rolling_${field}_invalid`);
  return number;
}

function parseJson(value, code) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(code);
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function stableHash(value) {
  const bytes = new TextEncoder().encode(typeof value === "string" ? value : canonicalJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${base64Url(new Uint8Array(digest))}`;
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
