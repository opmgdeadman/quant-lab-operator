const MARKET = "BTC-USD";
const INTERVAL = "1h";
const HOUR_MS = 60 * 60 * 1000;
const INITIAL_CASH = 10000;
const FEE_BPS = 10;
const SLIPPAGE_BPS = 5;
const MAX_DATASET_CANDLES = 240;
const MIN_DATASET_CANDLES = 60;
const BENCHMARK_ID = "stage3-baseline-bench-v1";
const EPSILON = 1e-10;

export const BASELINE_CATALOG = Object.freeze([
  Object.freeze({
    id: "baseline-buy-hold-v1",
    version: 1,
    kind: "buy_hold",
    market: MARKET,
    interval: INTERVAL,
    direction: "long",
    position_size_percent: 100,
    parameters: Object.freeze({}),
    tuning_allowed: false,
  }),
  Object.freeze({
    id: "baseline-ema-12-26-v1",
    version: 1,
    kind: "ema_cross",
    market: MARKET,
    interval: INTERVAL,
    direction: "long",
    position_size_percent: 100,
    parameters: Object.freeze({ fast: 12, slow: 26 }),
    tuning_allowed: false,
  }),
  Object.freeze({
    id: "baseline-rsi-14-30-55-v1",
    version: 1,
    kind: "rsi_mean_reversion",
    market: MARKET,
    interval: INTERVAL,
    direction: "long",
    position_size_percent: 100,
    parameters: Object.freeze({ period: 14, entry_below: 30, exit_above: 55 }),
    tuning_allowed: false,
  }),
]);

export const BASELINE_COST_MODEL = Object.freeze({
  initial_cash: INITIAL_CASH,
  fee_bps_per_side: FEE_BPS,
  slippage_bps_per_side: SLIPPAGE_BPS,
  execution: "next_candle_open",
  completed_candles_only: true,
});

export async function runProductionBaselineBench(env, options = {}) {
  const existing = await readBenchmark(env, BENCHMARK_ID);
  if (existing) {
    return { ...existing, replayed: true };
  }

  const candles = await readLatestCandles(env, options.maxCandles || MAX_DATASET_CANDLES);
  const benchmark = await buildBaselineBenchmark(candles, {
    benchmarkId: BENCHMARK_ID,
    createdAt: options.now || new Date(),
  });

  const existingDefinitions = await readDefinitions(env);
  verifyExistingDefinitions(existingDefinitions, benchmark.definitions);

  try {
    await persistBenchmark(env, benchmark, existingDefinitions);
  } catch (error) {
    const raced = await readBenchmark(env, BENCHMARK_ID);
    if (raced) {
      return { ...raced, replayed: true };
    }
    throw error;
  }

  return { ...benchmark.summary, replayed: false };
}

export async function getBaselineBenchSummary(env) {
  const row = await env.DB.prepare(
    `SELECT id, summary_json, created_at
     FROM baseline_benchmarks
     ORDER BY created_at DESC
     LIMIT 1`,
  ).first();
  if (!row) {
    return null;
  }
  const summary = parseJson(row.summary_json, "baseline_summary_invalid");
  return {
    ...summary,
    benchmark_id: row.id,
    created_at: row.created_at,
    historical_paper_research: true,
    live_capital_enabled: false,
  };
}

export async function buildBaselineBenchmark(rawCandles, options = {}) {
  const createdAt = iso(options.createdAt || new Date(), "created_at");
  const benchmarkId = options.benchmarkId || BENCHMARK_ID;
  const candles = normalizeDataset(rawCandles);
  const partitions = partitionDataset(candles);
  const definitions = [];

  for (const spec of BASELINE_CATALOG) {
    const normalized = normalizedDefinition(spec);
    definitions.push({
      ...normalized,
      spec_json: canonicalJson(normalized),
      spec_hash: await stableHash(normalized),
      created_at: createdAt,
    });
  }

  const datasetHash = await stableHash(candles);
  const partitionManifest = {};
  for (const [name, partitionCandles] of Object.entries(partitions)) {
    partitionManifest[name] = {
      name,
      candle_count: partitionCandles.length,
      start_closed_at: partitionCandles[0].closed_at,
      end_closed_at: partitionCandles.at(-1).closed_at,
      dataset_hash: await stableHash(partitionCandles),
    };
  }
  assertPartitions(partitionManifest, candles);

  const runs = [];
  for (const definition of definitions) {
    for (const [partitionName, partitionCandles] of Object.entries(partitions)) {
      runs.push(await runBaseline({
        benchmarkId,
        definition,
        partitionName,
        candles: partitionCandles,
        datasetHash: partitionManifest[partitionName].dataset_hash,
        createdAt,
      }));
    }
  }

  const testComparison = runs
    .filter((run) => run.partition_name === "test")
    .map((run) => ({
      baseline_id: run.baseline_id,
      result_hash: run.result_hash,
      metrics: run.metrics,
    }))
    .sort((left, right) => (
      right.metrics.total_return_percent - left.metrics.total_return_percent
      || left.baseline_id.localeCompare(right.baseline_id)
    ));

  const benchmarkHash = await stableHash({
    benchmark_id: benchmarkId,
    market: MARKET,
    interval: INTERVAL,
    dataset_hash: datasetHash,
    partition_manifest: partitionManifest,
    cost_model: BASELINE_COST_MODEL,
    definitions: definitions.map((definition) => ({
      id: definition.id,
      spec_hash: definition.spec_hash,
    })),
    runs: runs.map((run) => ({
      id: run.id,
      result_hash: run.result_hash,
    })),
  });

  const summary = {
    ok: true,
    historical_paper_research: true,
    live_capital_enabled: false,
    tuning_allowed: false,
    promotion_performed: false,
    comparison_order_is_not_promotion: true,
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
    baseline_count: definitions.length,
    run_count: runs.length,
    test_comparison: testComparison,
    created_at: createdAt,
  };

  return {
    benchmark: {
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
      summary_json: JSON.stringify(summary),
      created_at: createdAt,
    },
    definitions,
    runs,
    summary,
  };
}

export async function runBaseline({
  benchmarkId,
  definition,
  partitionName,
  candles,
  datasetHash,
  createdAt,
}) {
  if (!["train", "validation", "test"].includes(partitionName)) {
    throw new Error("baseline_partition_not_allowed");
  }
  const runId = `${benchmarkId}:${definition.id}:${partitionName}`;
  let cash = INITIAL_CASH;
  let quantity = 0;
  let pending = null;
  let entryFill = null;
  let orderSequence = 0;
  let fillSequence = 0;
  let tradeSequence = 0;
  let totalFees = 0;
  let exposureSum = 0;
  const orders = [];
  const fills = [];
  const trades = [];
  const equityCurve = [];
  const closes = [];

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];

    if (pending) {
      if (pending.side === "buy" && quantity === 0) {
        orderSequence += 1;
        fillSequence += 1;
        const budget = cash * (definition.position_size_percent / 100);
        const feeRate = FEE_BPS / 10000;
        const notional = budget / (1 + feeRate);
        const fee = notional * feeRate;
        const price = candle.open * (1 + SLIPPAGE_BPS / 10000);
        const boughtQuantity = notional / price;
        cash = clampZero(cash - notional - fee);
        quantity = boughtQuantity;
        totalFees += fee;
        const orderId = `${runId}:order:${orderSequence}`;
        const fillId = `${runId}:fill:${fillSequence}`;
        orders.push({
          id: orderId,
          side: "buy",
          signal_closed_at: pending.signal_closed_at,
          execution_candle_closed_at: candle.closed_at,
          status: "filled",
        });
        const fill = {
          id: fillId,
          order_id: orderId,
          side: "buy",
          fill_time: candleOpenAt(candle.closed_at),
          source_candle_closed_at: candle.closed_at,
          price,
          quantity,
          notional,
          fee,
        };
        fills.push(fill);
        entryFill = fill;
      } else if (pending.side === "sell" && quantity > 0) {
        orderSequence += 1;
        fillSequence += 1;
        const price = candle.open * (1 - SLIPPAGE_BPS / 10000);
        const notional = quantity * price;
        const fee = notional * (FEE_BPS / 10000);
        const soldQuantity = quantity;
        cash += notional - fee;
        totalFees += fee;
        const orderId = `${runId}:order:${orderSequence}`;
        const fillId = `${runId}:fill:${fillSequence}`;
        orders.push({
          id: orderId,
          side: "sell",
          signal_closed_at: pending.signal_closed_at,
          execution_candle_closed_at: candle.closed_at,
          status: "filled",
        });
        const fill = {
          id: fillId,
          order_id: orderId,
          side: "sell",
          fill_time: candleOpenAt(candle.closed_at),
          source_candle_closed_at: candle.closed_at,
          price,
          quantity: soldQuantity,
          notional,
          fee,
        };
        fills.push(fill);
        if (entryFill) {
          tradeSequence += 1;
          const entryCost = entryFill.notional + entryFill.fee;
          const exitProceeds = notional - fee;
          const grossPnl = notional - entryFill.notional;
          const netPnl = exitProceeds - entryCost;
          trades.push({
            id: `${runId}:trade:${tradeSequence}`,
            run_id: runId,
            entry_fill_id: entryFill.id,
            exit_fill_id: fill.id,
            entry_time: entryFill.fill_time,
            exit_time: fill.fill_time,
            quantity: soldQuantity,
            entry_price: entryFill.price,
            exit_price: fill.price,
            gross_pnl: grossPnl,
            net_pnl: netPnl,
            net_pnl_percent: entryCost ? (netPnl / entryCost) * 100 : 0,
            total_fees: entryFill.fee + fill.fee,
            created_at: createdAt,
          });
        }
        quantity = 0;
        entryFill = null;
      }
      pending = null;
    }

    closes.push(candle.close);
    const marketValue = quantity * candle.close;
    const equity = cash + marketValue;
    const exposure = equity ? marketValue / equity : 0;
    exposureSum += exposure;
    equityCurve.push({
      close_time: candle.closed_at,
      cash,
      quantity,
      mark_price: candle.close,
      equity,
      exposure,
    });

    if (index === candles.length - 1) {
      continue;
    }
    const signal = baselineSignal(definition, closes, index, quantity);
    if (signal) {
      pending = { side: signal, signal_closed_at: candle.closed_at };
    }
  }

  assertNextCandleExecution(orders);
  const metrics = baselineMetrics({
    equityCurve,
    trades,
    fills,
    totalFees,
    exposureSum,
    candleCount: candles.length,
    openQuantity: quantity,
  });
  const artifact = {
    schema: "deterministic_baseline_result_v1",
    benchmark_id: benchmarkId,
    baseline_id: definition.id,
    partition_name: partitionName,
    spec_hash: definition.spec_hash,
    dataset_hash: datasetHash,
    cost_model: BASELINE_COST_MODEL,
    orders,
    fills,
    trades,
    equity_curve: equityCurve,
    metrics,
  };
  const resultHash = await stableHash(artifact);
  const artifactJson = JSON.stringify({ ...artifact, result_hash: resultHash });
  const artifactHash = await stableHash(artifactJson);

  return {
    id: runId,
    benchmark_id: benchmarkId,
    baseline_id: definition.id,
    partition_name: partitionName,
    spec_hash: definition.spec_hash,
    dataset_hash: datasetHash,
    result_hash: resultHash,
    metrics,
    metrics_json: JSON.stringify(metrics),
    order_count: orders.length,
    fill_count: fills.length,
    trade_count: trades.length,
    trades,
    artifact: {
      id: `${runId}:artifact`,
      run_id: runId,
      artifact_type: "deterministic_result_v1",
      artifact_hash: artifactHash,
      content_json: artifactJson,
      created_at: createdAt,
    },
    created_at: createdAt,
  };
}

export function partitionDataset(candles) {
  if (!Array.isArray(candles) || candles.length < MIN_DATASET_CANDLES) {
    throw new Error(`baseline_dataset_requires_${MIN_DATASET_CANDLES}_candles`);
  }
  const trainCount = Math.floor(candles.length * 0.6);
  const validationCount = Math.floor(candles.length * 0.2);
  const testCount = candles.length - trainCount - validationCount;
  if (trainCount < 12 || validationCount < 12 || testCount < 12) {
    throw new Error("baseline_partition_too_small");
  }
  return {
    train: candles.slice(0, trainCount),
    validation: candles.slice(trainCount, trainCount + validationCount),
    test: candles.slice(trainCount + validationCount),
  };
}

function baselineSignal(definition, closes, index, quantity) {
  if (definition.kind === "buy_hold") {
    return index === 0 && quantity === 0 ? "buy" : null;
  }

  if (definition.kind === "ema_cross") {
    const { fast, slow } = definition.parameters;
    if (closes.length < slow + 1) {
      return null;
    }
    const previous = closes.slice(0, -1);
    const fastPrevious = ema(previous, fast);
    const slowPrevious = ema(previous, slow);
    const fastCurrent = ema(closes, fast);
    const slowCurrent = ema(closes, slow);
    if ([fastPrevious, slowPrevious, fastCurrent, slowCurrent].some((value) => value === null)) {
      return null;
    }
    if (quantity === 0 && fastPrevious <= slowPrevious && fastCurrent > slowCurrent) {
      return "buy";
    }
    if (quantity > 0 && fastPrevious >= slowPrevious && fastCurrent < slowCurrent) {
      return "sell";
    }
    return null;
  }

  if (definition.kind === "rsi_mean_reversion") {
    const { period, entry_below: entryBelow, exit_above: exitAbove } = definition.parameters;
    const currentRsi = rsi(closes, period);
    if (currentRsi === null) {
      return null;
    }
    if (quantity === 0 && currentRsi < entryBelow) {
      return "buy";
    }
    if (quantity > 0 && currentRsi > exitAbove) {
      return "sell";
    }
    return null;
  }

  throw new Error("baseline_kind_not_supported");
}

function baselineMetrics({
  equityCurve,
  trades,
  fills,
  totalFees,
  exposureSum,
  candleCount,
  openQuantity,
}) {
  const endingEquity = equityCurve.at(-1)?.equity || INITIAL_CASH;
  let peak = INITIAL_CASH;
  let maxDrawdown = 0;
  for (const point of equityCurve) {
    peak = Math.max(peak, point.equity);
    const drawdown = peak ? ((peak - point.equity) / peak) * 100 : 0;
    maxDrawdown = Math.max(maxDrawdown, drawdown);
  }
  const winners = trades.filter((trade) => trade.net_pnl > 0).length;
  return {
    initial_cash: INITIAL_CASH,
    ending_equity: endingEquity,
    total_return_percent: ((endingEquity / INITIAL_CASH) - 1) * 100,
    max_drawdown_percent: maxDrawdown,
    trade_count: trades.length,
    win_rate_percent: trades.length ? (winners / trades.length) * 100 : 0,
    total_fees: totalFees,
    fill_count: fills.length,
    average_exposure_percent: candleCount ? (exposureSum / candleCount) * 100 : 0,
    open_position_quantity: openQuantity,
  };
}

function normalizedDefinition(spec) {
  if (spec.tuning_allowed !== false) {
    throw new Error("baseline_tuning_must_be_disabled");
  }
  return {
    schema: "baseline_definition_v1",
    id: spec.id,
    version: spec.version,
    kind: spec.kind,
    market: spec.market,
    interval: spec.interval,
    direction: spec.direction,
    position_size_percent: spec.position_size_percent,
    parameters: spec.parameters,
    tuning_allowed: false,
    promotion_role: "reference_only",
  };
}

function normalizeDataset(rawCandles) {
  if (!Array.isArray(rawCandles)) {
    throw new Error("baseline_candles_array_required");
  }
  const candles = rawCandles.map(normalizeCandle)
    .sort((left, right) => left.closed_at.localeCompare(right.closed_at));
  if (candles.length < MIN_DATASET_CANDLES) {
    throw new Error(`baseline_dataset_requires_${MIN_DATASET_CANDLES}_candles`);
  }
  for (let index = 1; index < candles.length; index += 1) {
    const previous = Date.parse(candles[index - 1].closed_at);
    const current = Date.parse(candles[index].closed_at);
    if (current - previous !== HOUR_MS) {
      throw new Error(`baseline_dataset_gap:${candles[index - 1].closed_at}:${candles[index].closed_at}`);
    }
  }
  return candles;
}

function normalizeCandle(raw) {
  const closedAt = iso(raw.closed_at, "closed_at");
  const candle = {
    market: String(raw.market || raw.pair),
    interval: String(raw.interval || INTERVAL),
    closed_at: closedAt,
    open: positive(raw.open, "open"),
    high: positive(raw.high, "high"),
    low: positive(raw.low, "low"),
    close: positive(raw.close, "close"),
    volume: nonNegative(raw.volume, "volume"),
    source: String(raw.source || ""),
  };
  if (candle.market !== MARKET || candle.interval !== INTERVAL) {
    throw new Error("baseline_candle_market_interval_mismatch");
  }
  if (Date.parse(candle.closed_at) % HOUR_MS !== 0) {
    throw new Error("baseline_candle_not_hour_aligned");
  }
  if (candle.high < Math.max(candle.open, candle.close, candle.low)) {
    throw new Error("baseline_candle_invalid_high");
  }
  if (candle.low > Math.min(candle.open, candle.close, candle.high)) {
    throw new Error("baseline_candle_invalid_low");
  }
  return candle;
}

function assertPartitions(manifest, candles) {
  const ordered = [manifest.train, manifest.validation, manifest.test];
  if (ordered.some((partition) => !partition || partition.candle_count < 12)) {
    throw new Error("baseline_partition_manifest_invalid");
  }
  if (
    Date.parse(ordered[0].end_closed_at) >= Date.parse(ordered[1].start_closed_at)
    || Date.parse(ordered[1].end_closed_at) >= Date.parse(ordered[2].start_closed_at)
  ) {
    throw new Error("baseline_partitions_overlap");
  }
  const total = ordered.reduce((sum, partition) => sum + partition.candle_count, 0);
  if (total !== candles.length) {
    throw new Error("baseline_partition_count_mismatch");
  }
}

function assertNextCandleExecution(orders) {
  for (const order of orders) {
    if (
      Date.parse(order.execution_candle_closed_at) - Date.parse(order.signal_closed_at)
      < HOUR_MS
    ) {
      throw new Error("baseline_same_candle_execution_forbidden");
    }
  }
}

function ema(values, period) {
  if (values.length < period) {
    return null;
  }
  const multiplier = 2 / (period + 1);
  let current = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (const value of values.slice(period)) {
    current = (value - current) * multiplier + current;
  }
  return current;
}

function rsi(values, period) {
  if (values.length < period + 1) {
    return null;
  }
  const sample = values.slice(-(period + 1));
  let gains = 0;
  let losses = 0;
  for (let index = 1; index < sample.length; index += 1) {
    const change = sample[index] - sample[index - 1];
    gains += Math.max(change, 0);
    losses += Math.abs(Math.min(change, 0));
  }
  const averageGain = gains / period;
  const averageLoss = losses / period;
  if (averageLoss === 0) {
    return 100;
  }
  const relativeStrength = averageGain / averageLoss;
  return 100 - (100 / (1 + relativeStrength));
}

async function persistBenchmark(env, built, existingDefinitions) {
  const existingIds = new Set(existingDefinitions.map((definition) => definition.id));
  const statements = [];

  for (const definition of built.definitions) {
    if (!existingIds.has(definition.id)) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO baseline_definitions (
             id, version, kind, spec_json, spec_hash, created_at
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        ).bind(
          definition.id,
          definition.version,
          definition.kind,
          definition.spec_json,
          definition.spec_hash,
          definition.created_at,
        ),
      );
    }
  }

  statements.push(
    env.DB.prepare(
      `INSERT INTO baseline_benchmarks (
         id, market, interval, dataset_start_closed_at, dataset_end_closed_at,
         dataset_candle_count, dataset_hash, partition_manifest_json, cost_model_json,
         benchmark_hash, status, summary_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      built.benchmark.id,
      built.benchmark.market,
      built.benchmark.interval,
      built.benchmark.dataset_start_closed_at,
      built.benchmark.dataset_end_closed_at,
      built.benchmark.dataset_candle_count,
      built.benchmark.dataset_hash,
      built.benchmark.partition_manifest_json,
      built.benchmark.cost_model_json,
      built.benchmark.benchmark_hash,
      built.benchmark.status,
      built.benchmark.summary_json,
      built.benchmark.created_at,
    ),
  );

  for (const run of built.runs) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO baseline_runs (
           id, benchmark_id, baseline_id, partition_name, spec_hash, dataset_hash,
           result_hash, metrics_json, order_count, fill_count, trade_count, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        run.id,
        run.benchmark_id,
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
      ),
      env.DB.prepare(
        `INSERT INTO baseline_artifacts (
           id, run_id, artifact_type, artifact_hash, content_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(
        run.artifact.id,
        run.artifact.run_id,
        run.artifact.artifact_type,
        run.artifact.artifact_hash,
        run.artifact.content_json,
        run.artifact.created_at,
      ),
    );
    for (const trade of run.trades) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO baseline_trades (
             id, run_id, entry_fill_id, exit_fill_id, entry_time, exit_time,
             quantity, entry_price, exit_price, gross_pnl, net_pnl,
             net_pnl_percent, total_fees, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          trade.id,
          trade.run_id,
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
        ),
      );
    }
  }

  await env.DB.batch(statements);
}

async function readBenchmark(env, benchmarkId) {
  const row = await env.DB.prepare(
    `SELECT id, summary_json, created_at
     FROM baseline_benchmarks WHERE id = ?`,
  ).bind(benchmarkId).first();
  if (!row) {
    return null;
  }
  return {
    ...parseJson(row.summary_json, "baseline_summary_invalid"),
    benchmark_id: row.id,
    created_at: row.created_at,
  };
}

async function readDefinitions(env) {
  const rows = await env.DB.prepare(
    `SELECT id, version, kind, spec_json, spec_hash, created_at
     FROM baseline_definitions
     ORDER BY id ASC`,
  ).all();
  return rows.results || [];
}

function verifyExistingDefinitions(existing, expected) {
  const byId = new Map(existing.map((definition) => [definition.id, definition]));
  for (const definition of expected) {
    const prior = byId.get(definition.id);
    if (prior && prior.spec_hash !== definition.spec_hash) {
      throw new Error(`baseline_definition_hash_conflict:${definition.id}`);
    }
  }
}

async function readLatestCandles(env, limit) {
  const boundedLimit = Math.max(MIN_DATASET_CANDLES, Math.min(Number(limit) || MAX_DATASET_CANDLES, MAX_DATASET_CANDLES));
  const rows = await env.DB.prepare(
    `SELECT pair AS market, interval, closed_at, open, high, low, close, volume, source
     FROM market_candles
     WHERE pair = ? AND interval = ?
     ORDER BY closed_at DESC
     LIMIT ?`,
  ).bind(MARKET, INTERVAL, boundedLimit).all();
  return (rows.results || []).reverse();
}

function candleOpenAt(closedAt) {
  return new Date(Date.parse(closedAt) - HOUR_MS).toISOString();
}

function clampZero(value) {
  return Math.abs(value) <= EPSILON ? 0 : value;
}

function positive(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`baseline_invalid_${field}`);
  }
  return number;
}

function nonNegative(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`baseline_invalid_${field}`);
  }
  return number;
}

function iso(value, field) {
  const millis = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(millis)) {
    throw new Error(`baseline_invalid_${field}`);
  }
  return new Date(millis).toISOString();
}

function parseJson(value, errorCode) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(errorCode);
  }
}

async function stableHash(value) {
  const bytes = new TextEncoder().encode(
    typeof value === "string" ? value : canonicalJson(value),
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${base64Url(new Uint8Array(digest))}`;
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
