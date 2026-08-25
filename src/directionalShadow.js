const POLICY_ID = "directional-shadow-paper-v2";
const MARKET = "BTC-USD";
const INTERVAL = "1h";
const MAX_GROSS_EXPOSURE = 1;
const TARGET_EXPOSURE = 1;
const INITIAL_EQUITY = 10000;
const FEE_BPS = 10;
const SLIPPAGE_BPS = 5;
const SHORT_CARRY_BPS_PER_DAY = 3;
const MAX_SIGNAL_CANDLES = 240;
const WALK_FORWARD_TARGET_CANDLES = 4320;
const EPSILON = 1e-9;

export const DIRECTIONAL_SHADOW_POLICY = deepFreeze({
  id: POLICY_ID,
  version: 1,
  market: MARKET,
  interval: INTERVAL,
  paper_only: true,
  initial_virtual_equity_usd: INITIAL_EQUITY,
  allowed_directions: ["long", "flat", "short"],
  max_entry_gross_exposure_multiple: MAX_GROSS_EXPOSURE,
  leverage_above_entry_equity_allowed: false,
  marked_short_exposure_may_drift_between_hourly_rebalances: true,
  target_exposure_multiple: TARGET_EXPOSURE,
  execution: "next_completed_candle_open",
  valuation: "execution_candle_close",
  fee_bps_per_fill: FEE_BPS,
  slippage_bps_per_fill: SLIPPAGE_BPS,
  short_carry_bps_per_day: SHORT_CARRY_BPS_PER_DAY,
  completed_candles_only: true,
  same_candle_signal_and_fill_allowed: false,
  isolated_candidate_portfolios: true,
  live_capital_enabled: false,
  live_derivatives_enabled: false,
  walk_forward_target_candles: WALK_FORWARD_TARGET_CANDLES,
});

export const DIRECTIONAL_STRATEGIES = deepFreeze([
  strategy("shadow-ema-8-24-v1", "ema_trend", { fast: 8, slow: 24 }),
  strategy("shadow-ema-12-36-v1", "ema_trend", { fast: 12, slow: 36 }),
  strategy("shadow-donchian-20-v1", "donchian_breakout", { lookback: 20 }),
  strategy("shadow-donchian-55-v1", "donchian_breakout", { lookback: 55 }),
  strategy("shadow-momentum-24-v1", "price_momentum", { lookback: 24, threshold_percent: 0.5 }),
  strategy("shadow-momentum-72-v1", "price_momentum", { lookback: 72, threshold_percent: 1.25 }),
  strategy("shadow-volatility-14-15-v1", "volatility_breakout", { period: 14, multiplier: 1.5 }),
  strategy("shadow-volatility-20-20-v1", "volatility_breakout", { period: 20, multiplier: 2 }),
  strategy("shadow-rsi-7-25-75-v1", "rsi_mean_reversion", { period: 7, lower: 25, upper: 75, exit_lower: 45, exit_upper: 55 }),
  strategy("shadow-rsi-14-30-70-v1", "rsi_mean_reversion", { period: 14, lower: 30, upper: 70, exit_lower: 45, exit_upper: 55 }),
  strategy("shadow-bollinger-20-20-v1", "bollinger_mean_reversion", { period: 20, deviations: 2 }),
  strategy("shadow-bollinger-40-20-v1", "bollinger_mean_reversion", { period: 40, deviations: 2 }),
]);

export async function runScheduledDirectionalShadow(env, scheduledAt = new Date()) {
  const scheduledIso = iso(scheduledAt, "scheduled_at");
  const receiptId = `directional-shadow-scheduler:${scheduledIso}`;
  const existing = await readSchedulerReceipt(env, receiptId);
  if (existing) return { ...existing, replayed: true };

  let result;
  try {
    result = await runProductionDirectionalShadowCycle(env, { scheduledAt: scheduledIso });
  } catch (error) {
    result = {
      ok: false,
      paper_only: true,
      live_capital_enabled: false,
      state: "error",
      error: error instanceof Error ? error.message : "directional_shadow_failed",
    };
  }

  const receipt = {
    ok: result.ok,
    paper_only: true,
    live_capital_enabled: false,
    scheduler_receipt_id: receiptId,
    scheduled_at: scheduledIso,
    cycle_id: result.cycle_id || null,
    state: result.state,
    result,
  };
  try {
    await env.DB.prepare(
      `INSERT INTO directional_shadow_scheduler_receipts
       (id, scheduled_at, cycle_id, state, result_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(
      receiptId,
      scheduledIso,
      result.cycle_id || null,
      result.state || "error",
      JSON.stringify(receipt),
      new Date().toISOString(),
    ).run();
  } catch (error) {
    const raced = await readSchedulerReceipt(env, receiptId);
    if (raced) return { ...raced, replayed: true };
    throw error;
  }
  return { ...receipt, replayed: false };
}

export async function runProductionDirectionalShadowCycle(env, options = {}) {
  const scheduledAt = iso(options.scheduledAt || new Date(), "scheduled_at");
  const candles = await readRecentCandles(env, MAX_SIGNAL_CANDLES);
  if (candles.length < 3) {
    return {
      ok: false,
      paper_only: true,
      live_capital_enabled: false,
      state: "blocked_data",
      blocker_codes: ["insufficient_completed_candles"],
      cycle_id: null,
    };
  }

  const executionCandle = candles.at(-1);
  const signalCandles = candles.slice(0, -1);
  const signalCandle = signalCandles.at(-1);
  const cycleId = `directional-shadow:${executionCandle.closed_at}`;
  const existing = await readCycle(env, cycleId);
  if (existing) return { ...existing, replayed: true };

  assertContiguous(candles);
  const policyHash = await stableHash(DIRECTIONAL_SHADOW_POLICY);
  await ensureDefinitions(env, policyHash, scheduledAt);
  const portfolios = await readPortfolios(env);
  const byCandidate = new Map(portfolios.map((row) => [row.candidate_id, normalizePortfolio(row)]));

  const candidateResults = [];
  const statements = [];
  for (const spec of DIRECTIONAL_STRATEGIES) {
    const portfolio = byCandidate.get(spec.id);
    if (!portfolio) throw new Error(`directional_shadow_portfolio_missing:${spec.id}`);
    const currentExposure = signedExposure(portfolio.position_quantity);
    const signal = directionalSignal(spec, signalCandles, currentExposure);
    const transition = applySignedRebalance({
      portfolio,
      targetExposure: signal.target_exposure,
      executionPrice: executionCandle.open,
      markPrice: executionCandle.close,
      hoursElapsed: hoursBetween(portfolio.last_marked_at, executionCandle.closed_at),
    });
    const candidateCycleId = `${cycleId}:${spec.id}`;
    const result = {
      candidate_cycle_id: candidateCycleId,
      candidate_id: spec.id,
      family: spec.family,
      signal_closed_at: signalCandle.closed_at,
      execution_candle_closed_at: executionCandle.closed_at,
      target_exposure: signal.target_exposure,
      reason_code: signal.reason_code,
      status: transition.status,
      position_quantity: transition.position_quantity,
      exposure_side: signedExposure(transition.position_quantity),
      entry_gross_exposure_multiple: transition.entry_gross_exposure_multiple,
      gross_exposure_multiple: transition.gross_exposure_multiple,
      equity: transition.equity,
      return_percent: ((transition.equity / portfolio.initial_equity) - 1) * 100,
      realized_pnl: transition.realized_pnl,
      unrealized_pnl: transition.unrealized_pnl,
      fee: transition.fee,
      carry: transition.carry,
      total_fees: transition.total_fees,
      total_carry: transition.total_carry,
      max_drawdown_percent: transition.max_drawdown_percent,
    };
    const resultHash = await stableHash(result);
    candidateResults.push({ ...result, result_hash: resultHash });

    statements.push(env.DB.prepare(
      `UPDATE directional_shadow_portfolios SET
         cash_balance = ?, position_quantity = ?, average_entry = ?,
         realized_pnl = ?, unrealized_pnl = ?, total_fees = ?, total_carry = ?,
         equity = ?, peak_equity = ?, max_drawdown_percent = ?,
         gross_exposure_multiple = ?, version = version + 1,
         last_cycle_id = ?, last_mark_price = ?, last_marked_at = ?, updated_at = ?
       WHERE id = ? AND version = ?`,
    ).bind(
      transition.cash_balance,
      transition.position_quantity,
      transition.average_entry,
      transition.realized_pnl,
      transition.unrealized_pnl,
      transition.total_fees,
      transition.total_carry,
      transition.equity,
      transition.peak_equity,
      transition.max_drawdown_percent,
      transition.gross_exposure_multiple,
      cycleId,
      executionCandle.close,
      executionCandle.closed_at,
      scheduledAt,
      portfolio.id,
      portfolio.version,
    ));
    statements.push(env.DB.prepare(
      `INSERT INTO directional_shadow_candidate_cycles (
         id, cycle_id, candidate_id, family, signal_closed_at, execution_candle_closed_at,
         prior_exposure, target_exposure, prior_quantity, position_quantity, average_entry,
         execution_price, mark_price, quantity_delta, realized_pnl_delta, fee, carry,
         equity, gross_exposure_multiple, max_drawdown_percent, reason_code, status,
         result_json, result_hash, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      candidateCycleId,
      cycleId,
      spec.id,
      spec.family,
      signalCandle.closed_at,
      executionCandle.closed_at,
      currentExposure,
      signal.target_exposure,
      portfolio.position_quantity,
      transition.position_quantity,
      transition.average_entry,
      transition.execution_price,
      executionCandle.close,
      transition.quantity_delta,
      transition.realized_pnl_delta,
      transition.fee,
      transition.carry,
      transition.equity,
      transition.gross_exposure_multiple,
      transition.max_drawdown_percent,
      signal.reason_code,
      transition.status,
      JSON.stringify(result),
      resultHash,
      scheduledAt,
    ));
  }

  const ranked = [...candidateResults].sort((a, b) =>
    b.return_percent - a.return_percent ||
    a.max_drawdown_percent - b.max_drawdown_percent ||
    a.candidate_id.localeCompare(b.candidate_id));
  const summary = {
    ok: true,
    paper_only: true,
    live_capital_enabled: false,
    policy_id: POLICY_ID,
    policy_hash: policyHash,
    cycle_id: cycleId,
    state: "complete",
    scheduled_at: scheduledAt,
    signal_closed_at: signalCandle.closed_at,
    execution_candle_closed_at: executionCandle.closed_at,
    candidate_count: candidateResults.length,
    long_count: candidateResults.filter((row) => row.exposure_side === 1).length,
    flat_count: candidateResults.filter((row) => row.exposure_side === 0).length,
    short_count: candidateResults.filter((row) => row.exposure_side === -1).length,
    trade_count: candidateResults.filter((row) => Math.abs(row.fee) > EPSILON).length,
    virtual_equity_total: candidateResults.reduce((sum, row) => sum + row.equity, 0),
    leader: ranked[0] || null,
    laggard: ranked.at(-1) || null,
    candidates: ranked,
  };
  const cycleHash = await stableHash(summary);
  statements.unshift(env.DB.prepare(
    `INSERT INTO directional_shadow_cycles (
       id, policy_id, policy_hash, scheduled_at, signal_closed_at,
       execution_candle_closed_at, candidate_count, long_count, flat_count,
       short_count, trade_count, state, result_json, cycle_hash, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    cycleId,
    POLICY_ID,
    policyHash,
    scheduledAt,
    signalCandle.closed_at,
    executionCandle.closed_at,
    summary.candidate_count,
    summary.long_count,
    summary.flat_count,
    summary.short_count,
    summary.trade_count,
    summary.state,
    JSON.stringify(summary),
    cycleHash,
    scheduledAt,
  ));

  try {
    await env.DB.batch(statements);
  } catch (error) {
    const raced = await readCycle(env, cycleId);
    if (raced) return { ...raced, replayed: true };
    throw error;
  }
  return { ...summary, cycle_hash: cycleHash, replayed: false };
}

export async function getDirectionalShadowSummary(env) {
  const [cycle, scheduler, portfolios, candleCount] = await Promise.all([
    env.DB.prepare(
      `SELECT id, result_json, created_at FROM directional_shadow_cycles
       ORDER BY execution_candle_closed_at DESC LIMIT 1`,
    ).first(),
    env.DB.prepare(
      `SELECT id, result_json, created_at FROM directional_shadow_scheduler_receipts
       ORDER BY scheduled_at DESC LIMIT 1`,
    ).first(),
    env.DB.prepare(
      `SELECT p.*, c.family FROM directional_shadow_portfolios p
       JOIN directional_shadow_candidates c ON c.id = p.candidate_id
       ORDER BY p.equity DESC, p.candidate_id ASC`,
    ).all(),
    env.DB.prepare(
      `SELECT COUNT(*) AS count FROM market_candles WHERE pair = ? AND interval = ?`,
    ).bind(MARKET, INTERVAL).first(),
  ]);
  const accountRows = (portfolios.results || []).map((row) => {
    const normalized = normalizePortfolio(row);
    return {
      candidate_id: row.candidate_id,
      family: row.family,
      virtual_initial_equity: normalized.initial_equity,
      equity: normalized.equity,
      return_percent: ((normalized.equity / normalized.initial_equity) - 1) * 100,
      position_quantity: normalized.position_quantity,
      exposure_side: signedExposure(normalized.position_quantity),
      gross_exposure_multiple: normalized.gross_exposure_multiple,
      realized_pnl: normalized.realized_pnl,
      unrealized_pnl: normalized.unrealized_pnl,
      total_fees: normalized.total_fees,
      total_carry: normalized.total_carry,
      max_drawdown_percent: normalized.max_drawdown_percent,
      last_mark_price: normalized.last_mark_price,
      last_marked_at: normalized.last_marked_at,
      cycle_count: normalized.version,
    };
  });
  return {
    paper_only: true,
    live_capital_enabled: false,
    max_entry_gross_exposure_multiple: MAX_GROSS_EXPOSURE,
    marked_exposure_rebalanced_hourly: true,
    initial_virtual_equity_per_candidate: INITIAL_EQUITY,
    candidate_count: accountRows.length || DIRECTIONAL_STRATEGIES.length,
    history_candle_count: Number(candleCount?.count || 0),
    walk_forward_target_candles: WALK_FORWARD_TARGET_CANDLES,
    walk_forward_ready: Number(candleCount?.count || 0) >= WALK_FORWARD_TARGET_CANDLES,
    latest_cycle: cycle ? {
      ...parseJson(cycle.result_json, "directional_shadow_cycle_invalid"),
      cycle_id: cycle.id,
      created_at: cycle.created_at,
    } : null,
    latest_scheduler_receipt: scheduler ? {
      ...parseJson(scheduler.result_json, "directional_shadow_scheduler_invalid"),
      scheduler_receipt_id: scheduler.id,
      created_at: scheduler.created_at,
    } : null,
    accounts: accountRows,
  };
}

export function directionalSignal(spec, candles, currentExposure = 0) {
  const rows = normalizeCandles(candles);
  const closes = rows.map((row) => row.close);
  const current = clampExposure(currentExposure);
  if (spec.family === "ema_trend") {
    const fast = integer(spec.parameters.fast, "fast");
    const slow = integer(spec.parameters.slow, "slow");
    if (closes.length < slow) return signal(current, "ema_insufficient_history");
    return ema(closes, fast) >= ema(closes, slow)
      ? signal(TARGET_EXPOSURE, "ema_trend_long")
      : signal(-TARGET_EXPOSURE, "ema_trend_short");
  }
  if (spec.family === "ema_pullback_trend") {
    const fast = integer(spec.parameters.fast, "fast");
    const slow = integer(spec.parameters.slow, "slow");
    const threshold = finite(spec.parameters.threshold_percent, "threshold_percent") / 100;
    if (closes.length < slow) return signal(current, "ema_pullback_insufficient_history");
    const fastEma = ema(closes, fast);
    const slowEma = ema(closes, slow);
    const latestClose = closes.at(-1);
    if (fastEma > slowEma && latestClose <= fastEma * (1 - threshold)) return signal(TARGET_EXPOSURE, "ema_pullback_uptrend_long");
    if (fastEma < slowEma && latestClose >= fastEma * (1 + threshold)) return signal(-TARGET_EXPOSURE, "ema_pullback_downtrend_short");
    return signal(0, "ema_pullback_no_entry_flat");
  }
  if (spec.family === "close_location_pressure") {
    const period = integer(spec.parameters.period, "period");
    const threshold = finite(spec.parameters.pressure_threshold, "pressure_threshold");
    if (rows.length < period) return signal(current, "close_location_pressure_insufficient_history");
    const window = rows.slice(-period);
    const pressure = mean(window.map((row) => {
      const range = row.high - row.low;
      return range <= EPSILON ? 0 : ((2 * row.close) - row.high - row.low) / range;
    }));
    if (pressure > threshold) return signal(TARGET_EXPOSURE, "close_location_pressure_long");
    if (pressure < -threshold) return signal(-TARGET_EXPOSURE, "close_location_pressure_short");
    return signal(0, "close_location_pressure_flat");
  }
  if (spec.family === "range_position_state") {
    const period = integer(spec.parameters.period, "period");
    const lower = finite(spec.parameters.lower, "lower") / 100;
    const upper = finite(spec.parameters.upper, "upper") / 100;
    if (rows.length < period) return signal(current, "range_position_insufficient_history");
    const window = rows.slice(-period);
    const rangeLow = Math.min(...window.map((row) => row.low));
    const rangeHigh = Math.max(...window.map((row) => row.high));
    const range = rangeHigh - rangeLow;
    if (range <= EPSILON) return signal(0, "range_position_zero_range_flat");
    const position = (window.at(-1).close - rangeLow) / range;
    if (position + EPSILON >= upper) return signal(TARGET_EXPOSURE, "range_position_high_long");
    if (position - EPSILON <= lower) return signal(-TARGET_EXPOSURE, "range_position_low_short");
    return signal(0, "range_position_interior_flat");
  }
  if (spec.family === "return_zscore_reversal") {
    const period = integer(spec.parameters.period, "period");
    const threshold = finite(spec.parameters.z_threshold, "z_threshold");
    if (rows.length < period + 2) return signal(current, "return_zscore_insufficient_history");
    const latestReturn = rows.at(-1).close / rows.at(-2).close - 1;
    const priorReturns = [];
    for (let index = rows.length - period - 1; index <= rows.length - 2; index += 1) priorReturns.push(rows[index].close / rows[index - 1].close - 1);
    const mean = priorReturns.reduce((sum, value) => sum + value, 0) / priorReturns.length;
    const variance = priorReturns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (priorReturns.length - 1);
    const dispersion = Math.sqrt(Math.max(0, variance));
    if (dispersion <= EPSILON) return signal(0, "return_zscore_zero_dispersion_flat");
    const z = (latestReturn - mean) / dispersion;
    if (z + EPSILON >= threshold) return signal(-TARGET_EXPOSURE, "return_zscore_high_short");
    if (z - EPSILON <= -threshold) return signal(TARGET_EXPOSURE, "return_zscore_low_long");
    return signal(0, "return_zscore_interior_flat");
  }
  if (spec.family === "rolling_drawdown_reversion") {
    const period = integer(spec.parameters.period, "period");
    const threshold = finite(spec.parameters.threshold_percent, "threshold_percent") / 100;
    if (rows.length < period) return signal(current, "rolling_drawdown_insufficient_history");
    const window = rows.slice(-period);
    const peak = Math.max(...window.map((row) => row.close));
    if (!Number.isFinite(peak) || peak <= EPSILON) return signal(0, "rolling_drawdown_invalid_peak_flat");
    const latest = window.at(-1).close;
    const drawdown = (peak - latest) / peak;
    if (drawdown + EPSILON >= threshold) return signal(TARGET_EXPOSURE, "rolling_drawdown_capitulation_long");
    return signal(0, "rolling_drawdown_interior_flat");
  }
  if (spec.family === "body_pressure_trend") {
    const period = integer(spec.parameters.period, "period");
    const threshold = finite(spec.parameters.pressure_threshold, "pressure_threshold");
    if (rows.length < period) return signal(current, "body_pressure_insufficient_history");
    const window = rows.slice(-period);
    let total = 0;
    for (const row of window) {
      const range = row.high - row.low;
      total += range <= EPSILON ? 0 : (row.close - row.open) / range;
    }
    const pressure = total / period;
    if (pressure + EPSILON >= threshold) return signal(TARGET_EXPOSURE, "body_pressure_positive_long");
    if (pressure - EPSILON <= -threshold) return signal(-TARGET_EXPOSURE, "body_pressure_negative_short");
    return signal(0, "body_pressure_interior_flat");
  }
  if (spec.family === "linear_slope_tscore_trend") {
    const period = integer(spec.parameters.period, "period");
    const threshold = finite(spec.parameters.t_threshold, "t_threshold");
    if (rows.length < period) return signal(current, "linear_slope_tscore_insufficient_history");
    const window = rows.slice(-period);
    const xMean = (period - 1) / 2;
    const yMean = mean(window.map((row) => row.close));
    let sxx = 0;
    let sxy = 0;
    for (let index = 0; index < period; index += 1) {
      const dx = index - xMean;
      sxx += dx * dx;
      sxy += dx * (window[index].close - yMean);
    }
    if (sxx <= EPSILON) return signal(0, "linear_slope_tscore_degenerate_flat");
    const slope = sxy / sxx;
    let sse = 0;
    for (let index = 0; index < period; index += 1) {
      const fitted = yMean + slope * (index - xMean);
      const residual = window[index].close - fitted;
      sse += residual * residual;
    }
    const variance = sse / (period - 2);
    const slopeSe = Math.sqrt(Math.max(0, variance) / sxx);
    if (!Number.isFinite(slopeSe) || slopeSe <= EPSILON) return signal(0, "linear_slope_tscore_degenerate_flat");
    const tScore = slope / slopeSe;
    if (tScore + EPSILON >= threshold) return signal(TARGET_EXPOSURE, "linear_slope_tscore_positive_long");
    if (tScore - EPSILON <= -threshold) return signal(-TARGET_EXPOSURE, "linear_slope_tscore_negative_short");
    return signal(0, "linear_slope_tscore_interior_flat");
  }
  if (spec.family === "directional_crowding_reversal") {
    const period = integer(spec.parameters.period, "period");
    const upper = finite(spec.parameters.upper_fraction, "upper_fraction");
    const lower = finite(spec.parameters.lower_fraction, "lower_fraction");
    if (!(lower < upper)) throw new Error("directional_crowding_fraction_order_invalid");
    if (rows.length < period + 1) return signal(current, "directional_crowding_insufficient_history");
    let positive = 0;
    for (let index = rows.length - period; index < rows.length; index += 1) {
      if (rows[index].close > rows[index - 1].close) positive += 1;
    }
    const fraction = positive / period;
    if (fraction + EPSILON >= upper) return signal(-TARGET_EXPOSURE, "directional_crowding_high_short");
    if (fraction - EPSILON <= lower) return signal(TARGET_EXPOSURE, "directional_crowding_low_long");
    return signal(0, "directional_crowding_interior_flat");
  }
  if (spec.family === "wick_rejection_reversal") {
    const period = integer(spec.parameters.period, "period");
    const threshold = finite(spec.parameters.wick_ratio_threshold, "wick_ratio_threshold");
    if (rows.length < period) return signal(current, "wick_rejection_insufficient_history");
    const window = rows.slice(-period);
    let lowerRejection = 0;
    let upperRejection = 0;
    for (const row of window) {
      const body = Math.abs(row.close - row.open);
      const upperWick = Math.max(0, row.high - Math.max(row.open, row.close));
      const lowerWick = Math.max(0, Math.min(row.open, row.close) - row.low);
      if (body <= EPSILON) {
        if (upperWick <= EPSILON && lowerWick <= EPSILON) continue;
        const scale = Math.max(upperWick, lowerWick, EPSILON);
        upperRejection += upperWick / scale;
        lowerRejection += lowerWick / scale;
      } else {
        upperRejection += upperWick / body;
        lowerRejection += lowerWick / body;
      }
    }
    if (lowerRejection > upperRejection * threshold) return signal(TARGET_EXPOSURE, "wick_rejection_lower_dominant_long");
    if (upperRejection > lowerRejection * threshold) return signal(-TARGET_EXPOSURE, "wick_rejection_upper_dominant_short");
    return signal(0, "wick_rejection_balanced_flat");
  }
  if (spec.family === "return_autocorrelation_state") {
    const period = integer(spec.parameters.period, "period");
    const threshold = finite(spec.parameters.autocorr_threshold, "autocorr_threshold");
    if (rows.length < period + 2) return signal(current, "return_autocorrelation_insufficient_history");
    const closes = rows.slice(-(period + 2)).map((row) => row.close);
    const returns = [];
    for (let index = 1; index < closes.length; index += 1) returns.push((closes[index] / closes[index - 1]) - 1);
    const x = returns.slice(0, -1);
    const y = returns.slice(1);
    const xMean = mean(x);
    const yMean = mean(y);
    let covariance = 0;
    let xVariance = 0;
    let yVariance = 0;
    for (let index = 0; index < x.length; index += 1) {
      const dx = x[index] - xMean;
      const dy = y[index] - yMean;
      covariance += dx * dy;
      xVariance += dx * dx;
      yVariance += dy * dy;
    }
    if (xVariance <= EPSILON || yVariance <= EPSILON) return signal(0, "return_autocorrelation_zero_variance_flat");
    const autocorrelation = covariance / Math.sqrt(xVariance * yVariance);
    const latestReturn = returns.at(-1);
    if (Math.abs(latestReturn) <= EPSILON || Math.abs(autocorrelation) < threshold) return signal(0, "return_autocorrelation_neutral_flat");
    const latestSign = latestReturn > 0 ? TARGET_EXPOSURE : -TARGET_EXPOSURE;
    if (autocorrelation > 0) return signal(latestSign, "return_autocorrelation_continuation");
    return signal(-latestSign, "return_autocorrelation_reversal");
  }
  if (spec.family === "return_semivariance_imbalance") {
    const period = integer(spec.parameters.period, "period");
    const threshold = finite(spec.parameters.imbalance_threshold, "imbalance_threshold");
    if (rows.length < period + 1) return signal(current, "return_semivariance_insufficient_history");
    const windowCloses = rows.slice(-(period + 1)).map((row) => row.close);
    let upside = 0;
    let downside = 0;
    for (let index = 1; index < windowCloses.length; index += 1) {
      const value = (windowCloses[index] / windowCloses[index - 1]) - 1;
      if (!Number.isFinite(value)) return signal(0, "return_semivariance_invalid_return_flat");
      if (value > EPSILON) upside += value * value;
      else if (value < -EPSILON) downside += value * value;
    }
    const total = upside + downside;
    if (!Number.isFinite(total) || total <= EPSILON) return signal(0, "return_semivariance_zero_energy_flat");
    const upsideShare = upside / total;
    const downsideShare = downside / total;
    if (upsideShare + EPSILON >= threshold) return signal(TARGET_EXPOSURE, "return_semivariance_upside_dominant_long");
    if (downsideShare + EPSILON >= threshold) return signal(-TARGET_EXPOSURE, "return_semivariance_downside_dominant_short");
    return signal(0, "return_semivariance_balanced_flat");
  }
  if (spec.family === "return_sign_transition_state") {
    const period = integer(spec.parameters.period, "period");
    const threshold = finite(spec.parameters.persistence_threshold, "persistence_threshold");
    if (rows.length < period + 1) return signal(current, "return_sign_transition_insufficient_history");
    const windowCloses = rows.slice(-(period + 1)).map((row) => row.close);
    const signs = [];
    for (let index = 1; index < windowCloses.length; index += 1) {
      const value = (windowCloses[index] / windowCloses[index - 1]) - 1;
      if (Math.abs(value) > EPSILON) signs.push(value > 0 ? 1 : -1);
    }
    if (signs.length < 2) return signal(0, "return_sign_transition_insufficient_nonzero_flat");
    let persistentTransitions = 0;
    for (let index = 1; index < signs.length; index += 1) {
      if (signs[index] === signs[index - 1]) persistentTransitions += 1;
    }
    const persistence = persistentTransitions / (signs.length - 1);
    const latestSign = signs.at(-1) > 0 ? TARGET_EXPOSURE : -TARGET_EXPOSURE;
    if (persistence >= threshold) return signal(latestSign, "return_sign_transition_persistence");
    if (persistence <= 1 - threshold) return signal(-latestSign, "return_sign_transition_alternation");
    return signal(0, "return_sign_transition_neutral_flat");
  }
  if (spec.family === "return_skew_state") {
    const period = integer(spec.parameters.period, "period");
    const threshold = finite(spec.parameters.skew_threshold, "skew_threshold");
    if (rows.length < period + 1) return signal(current, "return_skew_insufficient_history");
    const windowCloses = rows.slice(-(period + 1)).map((row) => row.close);
    const returns = [];
    for (let index = 1; index < windowCloses.length; index += 1) returns.push((windowCloses[index] / windowCloses[index - 1]) - 1);
    const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
    const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length;
    if (variance <= EPSILON) return signal(0, "return_skew_zero_variance_flat");
    const sigma = Math.sqrt(variance);
    const thirdMoment = returns.reduce((sum, value) => sum + (value - mean) ** 3, 0) / returns.length;
    const skew = thirdMoment / (sigma ** 3);
    if (skew >= threshold) return signal(TARGET_EXPOSURE, "return_skew_positive");
    if (skew <= -threshold) return signal(-TARGET_EXPOSURE, "return_skew_negative");
    return signal(0, "return_skew_neutral_flat");
  }
  if (spec.family === "hour_of_week_drift") {
    const lookbackWeeks = integer(spec.parameters.lookback_weeks, "lookback_weeks");
    const thresholdBps = finite(spec.parameters.mean_return_threshold_bps, "mean_return_threshold_bps");
    if (rows.length < 2) return signal(current, "hour_of_week_insufficient_history");
    const signalIndex = rows.length - 1;
    const signalDate = new Date(rows[signalIndex].closed_at);
    const targetSlot = signalDate.getUTCDay() * 24 + signalDate.getUTCHours();
    const samples = [];
    const hoursPerWeek = 7 * 24;
    for (let week = 1; week <= lookbackWeeks; week += 1) {
      const index = signalIndex - week * hoursPerWeek;
      if (index < 1) break;
      const date = new Date(rows[index].closed_at);
      if (date.getUTCDay() * 24 + date.getUTCHours() !== targetSlot) {
        throw new Error("hour_of_week_contiguous_slot_alignment_invalid");
      }
      samples.push((rows[index].close / rows[index - 1].close) - 1);
    }
    if (samples.length < lookbackWeeks) return signal(0, "hour_of_week_insufficient_same_slot_history");
    const meanReturnBps = (samples.reduce((sum, value) => sum + value, 0) / samples.length) * 10000;
    if (meanReturnBps >= thresholdBps) return signal(TARGET_EXPOSURE, "hour_of_week_positive_drift");
    if (meanReturnBps <= -thresholdBps) return signal(-TARGET_EXPOSURE, "hour_of_week_negative_drift");
    return signal(0, "hour_of_week_neutral_flat");
  }
  if (spec.family === "inside_bar_breakout") {
    const maxRatio = finite(spec.parameters.max_inside_range_ratio, "max_inside_range_ratio");
    if (rows.length < 3) return signal(current, "inside_bar_insufficient_history");
    const mother = rows.at(-3);
    const inside = rows.at(-2);
    const breakout = rows.at(-1);
    const motherRange = mother.high - mother.low;
    if (motherRange <= EPSILON) return signal(0, "inside_bar_zero_range_mother_flat");
    const insideRange = inside.high - inside.low;
    const isInside = inside.high <= mother.high + EPSILON
      && inside.low >= mother.low - EPSILON
      && insideRange / motherRange <= maxRatio + EPSILON;
    if (!isInside) return signal(0, "inside_bar_pattern_invalid_flat");
    if (breakout.close > mother.high) return signal(TARGET_EXPOSURE, "inside_bar_breakout_long");
    if (breakout.close < mother.low) return signal(-TARGET_EXPOSURE, "inside_bar_breakout_short");
    return signal(0, "inside_bar_no_break_flat");
  }
  if (spec.family === "engulfing_reversal") {
    const minBodyRatio = finite(spec.parameters.min_body_ratio, "min_body_ratio");
    if (rows.length < 2) return signal(current, "engulfing_insufficient_history");
    const prior = rows.at(-2);
    const second = rows.at(-1);
    const priorBody = Math.abs(prior.close - prior.open);
    const secondBody = Math.abs(second.close - second.open);
    if (priorBody <= EPSILON) return signal(0, "engulfing_zero_prior_body_flat");
    const priorDirection = Math.sign(prior.close - prior.open);
    const secondDirection = Math.sign(second.close - second.open);
    if (priorDirection === 0 || secondDirection === 0 || priorDirection === secondDirection) return signal(0, "engulfing_direction_invalid_flat");
    const priorLowBody = Math.min(prior.open, prior.close);
    const priorHighBody = Math.max(prior.open, prior.close);
    const secondLowBody = Math.min(second.open, second.close);
    const secondHighBody = Math.max(second.open, second.close);
    const engulfed = secondLowBody <= priorLowBody + EPSILON && secondHighBody >= priorHighBody - EPSILON;
    if (!engulfed || secondBody / priorBody + EPSILON < minBodyRatio) return signal(0, "engulfing_pattern_invalid_flat");
    return secondDirection > 0 ? signal(TARGET_EXPOSURE, "engulfing_bullish_reversal") : signal(-TARGET_EXPOSURE, "engulfing_bearish_reversal");
  }
  if (spec.family === "donchian_breakout") {
    const lookback = integer(spec.parameters.lookback, "lookback");
    if (rows.length < lookback + 1) return signal(current, "donchian_insufficient_history");
    const previous = rows.slice(-(lookback + 1), -1);
    const latest = rows.at(-1);
    const upper = Math.max(...previous.map((row) => row.high));
    const lower = Math.min(...previous.map((row) => row.low));
    if (latest.close > upper) return signal(TARGET_EXPOSURE, "donchian_breakout_long");
    if (latest.close < lower) return signal(-TARGET_EXPOSURE, "donchian_breakout_short");
    return signal(current, "donchian_hold");
  }
  if (spec.family === "efficiency_ratio_trend") {
    const period = integer(spec.parameters.period, "period");
    const threshold = finite(spec.parameters.efficiency_threshold, "efficiency_threshold");
    if (closes.length < period + 1) return signal(current, "efficiency_ratio_insufficient_history");
    const window = closes.slice(-(period + 1));
    const displacement = window.at(-1) - window[0];
    let pathLength = 0;
    for (let index = 1; index < window.length; index += 1) pathLength += Math.abs(window[index] - window[index - 1]);
    if (pathLength <= EPSILON) return signal(0, "efficiency_ratio_zero_path_flat");
    const efficiency = Math.abs(displacement) / pathLength;
    if (efficiency + EPSILON < threshold || Math.abs(displacement) <= EPSILON) return signal(0, "efficiency_ratio_below_threshold_flat");
    return displacement > 0 ? signal(TARGET_EXPOSURE, "efficiency_ratio_trend_long") : signal(-TARGET_EXPOSURE, "efficiency_ratio_trend_short");
  }
  if (spec.family === "return_acceleration_state") {
    const period = integer(spec.parameters.period, "period");
    const threshold = finite(spec.parameters.acceleration_threshold_percent, "acceleration_threshold_percent");
    if (rows.length < 2 * period + 1) return signal(current, "return_acceleration_insufficient_history");
    const signalIndex = rows.length - 1;
    const midpoint = rows[signalIndex - period].close;
    const priorStart = rows[signalIndex - 2 * period].close;
    const latest = rows[signalIndex].close;
    if (midpoint <= 0 || priorStart <= 0 || latest <= 0) return signal(0, "return_acceleration_nonpositive_close_flat");
    const previousReturnPercent = ((midpoint / priorStart) - 1) * 100;
    const recentReturnPercent = ((latest / midpoint) - 1) * 100;
    const acceleration = recentReturnPercent - previousReturnPercent;
    if (recentReturnPercent > EPSILON && acceleration + EPSILON >= threshold) return signal(TARGET_EXPOSURE, "return_acceleration_up_long");
    if (recentReturnPercent < -EPSILON && acceleration - EPSILON <= -threshold) return signal(-TARGET_EXPOSURE, "return_acceleration_down_short");
    return signal(0, "return_acceleration_flat");
  }
  if (spec.family === "close_quantile_reversion") {
    const period = integer(spec.parameters.period, "period");
    const lowerQuantile = finite(spec.parameters.lower_quantile, "lower_quantile");
    const upperQuantile = finite(spec.parameters.upper_quantile, "upper_quantile");
    if (!(lowerQuantile > 0 && lowerQuantile < upperQuantile && upperQuantile < 1)) throw new Error("close_quantile_threshold_order_invalid");
    if (rows.length < period) return signal(current, "close_quantile_insufficient_history");
    const window = rows.slice(-period).map((row) => finite(row.close, "close"));
    if (window.some((value) => value <= 0)) return signal(0, "close_quantile_nonpositive_close_flat");
    const latestClose = window.at(-1);
    let below = 0;
    let equal = 0;
    for (const value of window) {
      if (value < latestClose - EPSILON) below += 1;
      else if (Math.abs(value - latestClose) <= EPSILON) equal += 1;
    }
    const midrank = (below + 0.5 * equal) / period;
    if (midrank <= lowerQuantile + EPSILON) return signal(TARGET_EXPOSURE, "close_quantile_lower_tail_long");
    if (midrank >= upperQuantile - EPSILON) return signal(-TARGET_EXPOSURE, "close_quantile_upper_tail_short");
    return signal(0, "close_quantile_middle_flat");
  }
  if (spec.family === "rolling_median_reversion") {
    const period = integer(spec.parameters.period, "period");
    const thresholdPercent = finite(spec.parameters.threshold_percent, "threshold_percent");
    if (rows.length < period) return signal(current, "rolling_median_insufficient_history");
    const closes = rows.slice(-period).map((row) => finite(row.close, "close")).sort((a, b) => a - b);
    if (closes.some((value) => value <= 0)) return signal(0, "rolling_median_nonpositive_close_flat");
    const mid = Math.floor(closes.length / 2);
    const median = closes.length % 2 === 0 ? (closes[mid - 1] + closes[mid]) / 2 : closes[mid];
    if (!Number.isFinite(median) || median <= 0) return signal(0, "rolling_median_invalid_flat");
    const latestClose = finite(rows.at(-1).close, "close");
    const displacementPercent = ((latestClose / median) - 1) * 100;
    if (displacementPercent + EPSILON >= thresholdPercent) return signal(-TARGET_EXPOSURE, "rolling_median_above_fair_value_short");
    if (displacementPercent - EPSILON <= -thresholdPercent) return signal(TARGET_EXPOSURE, "rolling_median_below_fair_value_long");
    return signal(0, "rolling_median_inside_threshold_flat");
  }
  if (spec.family === "body_streak_reversal") {
    const streakLength = integer(spec.parameters.streak_length, "streak_length");
    const minBodyFraction = finite(spec.parameters.min_body_fraction, "min_body_fraction");
    if (rows.length < streakLength) return signal(current, "body_streak_insufficient_history");
    const window = rows.slice(-streakLength);
    let direction = 0;
    for (const row of window) {
      const range = row.high - row.low;
      if (range <= EPSILON) return signal(0, "body_streak_zero_range_flat");
      const bodyDirection = Math.sign(row.close - row.open);
      if (bodyDirection === 0) return signal(0, "body_streak_zero_body_flat");
      if (Math.abs(row.close - row.open) / range + EPSILON < minBodyFraction) return signal(0, "body_streak_body_below_threshold_flat");
      if (direction === 0) direction = bodyDirection;
      else if (bodyDirection !== direction) return signal(0, "body_streak_mixed_direction_flat");
    }
    return direction > 0
      ? signal(-TARGET_EXPOSURE, "body_streak_bullish_exhaustion_short")
      : signal(TARGET_EXPOSURE, "body_streak_bearish_exhaustion_long");
  }
  if (spec.family === "price_momentum") {
    const lookback = integer(spec.parameters.lookback, "lookback");
    const threshold = finite(spec.parameters.threshold_percent, "threshold_percent") / 100;
    if (closes.length < lookback + 1) return signal(current, "momentum_insufficient_history");
    const change = (closes.at(-1) / closes.at(-(lookback + 1))) - 1;
    if (change > threshold) return signal(TARGET_EXPOSURE, "momentum_long");
    if (change < -threshold) return signal(-TARGET_EXPOSURE, "momentum_short");
    return signal(0, "momentum_flat");
  }
  if (spec.family === "regime_momentum") {
    const lookback = integer(spec.parameters.lookback, "lookback");
    const regimeLookback = integer(spec.parameters.regime_lookback, "regime_lookback");
    const threshold = finite(spec.parameters.threshold_percent, "threshold_percent") / 100;
    if (closes.length < regimeLookback + 1) return signal(current, "regime_momentum_insufficient_history");
    const momentumReturn = (closes.at(-1) / closes.at(-(lookback + 1))) - 1;
    const regimeReturn = (closes.at(-1) / closes.at(-(regimeLookback + 1))) - 1;
    if (regimeReturn > 0 && momentumReturn > threshold) return signal(TARGET_EXPOSURE, "regime_momentum_up_up_long");
    return signal(0, regimeReturn <= 0 ? "regime_momentum_non_up_regime_flat" : "regime_momentum_weak_momentum_flat");
  }
  if (spec.family === "linear_trend_residual_reversion") {
    const period = integer(spec.parameters.period, "period");
    const thresholdPercent = finite(spec.parameters.threshold_percent, "threshold_percent");
    if (rows.length < period) return signal(current, "linear_trend_residual_insufficient_history");
    const closes = rows.slice(-period).map((row) => finite(row.close, "close"));
    if (closes.some((value) => value <= 0)) return signal(0, "linear_trend_residual_invalid_close_flat");
    const xMean = (period - 1) / 2;
    const yMean = mean(closes);
    let numerator = 0;
    let denominator = 0;
    for (let index = 0; index < period; index += 1) {
      const dx = index - xMean;
      numerator += dx * (closes[index] - yMean);
      denominator += dx * dx;
    }
    if (!Number.isFinite(denominator) || denominator <= EPSILON) return signal(0, "linear_trend_residual_invalid_fit_flat");
    const slope = numerator / denominator;
    const fittedEndpoint = yMean + slope * ((period - 1) - xMean);
    if (!Number.isFinite(fittedEndpoint) || fittedEndpoint <= EPSILON) return signal(0, "linear_trend_residual_invalid_endpoint_flat");
    const residualPercent = ((closes.at(-1) - fittedEndpoint) / fittedEndpoint) * 100;
    if (residualPercent + EPSILON >= thresholdPercent) return signal(-TARGET_EXPOSURE, "linear_trend_residual_above_short");
    if (residualPercent - EPSILON <= -thresholdPercent) return signal(TARGET_EXPOSURE, "linear_trend_residual_below_long");
    return signal(0, "linear_trend_residual_inside_threshold_flat");
  }
  if (spec.family === "volatility_shock_reversal") {
    const period = integer(spec.parameters.period, "period");
    const multiplier = finite(spec.parameters.multiplier, "multiplier");
    if (rows.length < period + 2) return signal(current, "volatility_shock_reversal_insufficient_history");
    const window = rows.slice(-(period + 2));
    const trueRanges = [];
    for (let index = 1; index < window.length; index += 1) {
      const row = window[index];
      const previousClose = window[index - 1].close;
      const tr = Math.max(row.high - row.low, Math.abs(row.high - previousClose), Math.abs(row.low - previousClose));
      if (!Number.isFinite(tr) || tr < 0) return signal(0, "volatility_shock_reversal_invalid_range_flat");
      trueRanges.push(tr);
    }
    const latestTrueRange = trueRanges.at(-1);
    const priorMeanTrueRange = mean(trueRanges.slice(0, -1));
    if (!Number.isFinite(priorMeanTrueRange) || priorMeanTrueRange <= EPSILON) return signal(0, "volatility_shock_reversal_zero_baseline_flat");
    if (latestTrueRange + EPSILON < priorMeanTrueRange * multiplier) return signal(0, "volatility_shock_reversal_below_threshold_flat");
    const latest = window.at(-1);
    const bodyDirection = Math.sign(latest.close - latest.open);
    if (bodyDirection === 0) return signal(0, "volatility_shock_reversal_zero_body_flat");
    return bodyDirection > 0
      ? signal(-TARGET_EXPOSURE, "volatility_shock_reversal_bullish_shock_short")
      : signal(TARGET_EXPOSURE, "volatility_shock_reversal_bearish_shock_long");
  }
  if (spec.family === "volatility_breakout") {
    const period = integer(spec.parameters.period, "period");
    const multiplier = finite(spec.parameters.multiplier, "multiplier");
    if (rows.length < period + 2) return signal(current, "volatility_insufficient_history");
    const range = atr(rows.slice(0, -1), period);
    const previousClose = closes.at(-2);
    const latestClose = closes.at(-1);
    if (latestClose > previousClose + range * multiplier) return signal(TARGET_EXPOSURE, "volatility_breakout_long");
    if (latestClose < previousClose - range * multiplier) return signal(-TARGET_EXPOSURE, "volatility_breakout_short");
    return signal(current, "volatility_hold");
  }
  if (spec.family === "volatility_regime_breakout") {
    const period = integer(spec.parameters.period, "period");
    const regimePeriod = integer(spec.parameters.regime_period, "regime_period");
    const multiplier = finite(spec.parameters.multiplier, "multiplier");
    if (rows.length < regimePeriod + 2) return signal(current, "volatility_regime_insufficient_history");
    const previousRows = rows.slice(0, -1);
    const shortRange = atr(previousRows, period);
    const regimeRange = atr(previousRows, regimePeriod);
    if (shortRange <= regimeRange) return signal(0, "volatility_regime_not_expanding_flat");
    const previousClose = closes.at(-2);
    const latestClose = closes.at(-1);
    if (latestClose > previousClose + shortRange * multiplier) return signal(TARGET_EXPOSURE, "volatility_regime_breakout_long");
    if (latestClose < previousClose - shortRange * multiplier) return signal(-TARGET_EXPOSURE, "volatility_regime_breakout_short");
    return signal(current, "volatility_regime_hold");
  }
  if (spec.family === "rsi_mean_reversion") {
    const period = integer(spec.parameters.period, "period");
    const value = rsi(closes, period);
    if (value === null) return signal(current, "rsi_insufficient_history");
    if (value < finite(spec.parameters.lower, "lower")) return signal(TARGET_EXPOSURE, "rsi_oversold_long");
    if (value > finite(spec.parameters.upper, "upper")) return signal(-TARGET_EXPOSURE, "rsi_overbought_short");
    if (current > 0 && value >= finite(spec.parameters.exit_lower, "exit_lower")) return signal(0, "rsi_long_exit");
    if (current < 0 && value <= finite(spec.parameters.exit_upper, "exit_upper")) return signal(0, "rsi_short_exit");
    return signal(current, "rsi_hold");
  }
  if (spec.family === "bollinger_mean_reversion") {
    const period = integer(spec.parameters.period, "period");
    const deviations = finite(spec.parameters.deviations, "deviations");
    if (closes.length < period) return signal(current, "bollinger_insufficient_history");
    const window = closes.slice(-period);
    const center = mean(window);
    const deviation = standardDeviation(window);
    const latest = closes.at(-1);
    if (latest < center - deviations * deviation) return signal(TARGET_EXPOSURE, "bollinger_lower_long");
    if (latest > center + deviations * deviation) return signal(-TARGET_EXPOSURE, "bollinger_upper_short");
    if ((current > 0 && latest >= center) || (current < 0 && latest <= center)) {
      return signal(0, "bollinger_mean_exit");
    }
    return signal(current, "bollinger_hold");
  }
  throw new Error(`directional_shadow_family_unsupported:${spec.family}`);
}

export function applySignedRebalance({
  portfolio,
  targetExposure,
  executionPrice,
  markPrice,
  hoursElapsed = 1,
}) {
  const p = normalizePortfolio(portfolio);
  const target = clampExposure(targetExposure);
  const open = positive(executionPrice, "execution_price");
  const mark = positive(markPrice, "mark_price");
  const hours = Math.max(0, Math.min(24 * 7, finite(hoursElapsed, "hours_elapsed")));

  const existingUnrealizedAtOpen = p.position_quantity * (open - p.average_entry);
  const shortNotional = p.position_quantity < 0 ? Math.abs(p.position_quantity) * open : 0;
  const carry = shortNotional * (SHORT_CARRY_BPS_PER_DAY / 10000) * (hours / 24);
  let cash = p.cash_balance - carry;
  const equityBeforeTrade = Math.max(0, cash + existingUnrealizedAtOpen);
  const approximateDesired = target * Math.min(MAX_GROSS_EXPOSURE, Math.abs(target)) * equityBeforeTrade / open;
  const approximateDelta = approximateDesired - p.position_quantity;
  const fillDirection = Math.sign(approximateDelta);
  const fillPrice = fillDirection === 0
    ? open
    : open * (1 + fillDirection * SLIPPAGE_BPS / 10000);
  const equityAtFillBeforeFee = Math.max(
    0,
    cash + p.position_quantity * (fillPrice - p.average_entry),
  );
  let desiredQuantity = target
    * Math.min(MAX_GROSS_EXPOSURE, Math.abs(target))
    * equityAtFillBeforeFee
    / fillPrice;
  const feeRate = FEE_BPS / 10000;
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const estimatedFee = Math.abs(desiredQuantity - p.position_quantity) * fillPrice * feeRate;
    const safeEntryNotional = Math.max(0, equityAtFillBeforeFee - estimatedFee);
    const nextDesired = Math.sign(target) * safeEntryNotional / fillPrice;
    if (Math.abs(nextDesired - desiredQuantity) <= EPSILON) {
      desiredQuantity = nextDesired;
      break;
    }
    desiredQuantity = nextDesired;
  }
  const quantityDelta = desiredQuantity - p.position_quantity;
  const fee = Math.abs(quantityDelta) * fillPrice * feeRate;

  const positionTransition = transitionPosition(
    p.position_quantity,
    p.average_entry,
    desiredQuantity,
    fillPrice,
  );
  cash += positionTransition.realized_pnl_delta - fee;
  const unrealized = positionTransition.quantity * (mark - positionTransition.average_entry);
  const equityAtFill = Math.max(0, cash + positionTransition.quantity * (fillPrice - positionTransition.average_entry));
  const entryGross = equityAtFill > EPSILON
    ? Math.abs(positionTransition.quantity * fillPrice) / equityAtFill
    : 0;
  if (entryGross > MAX_GROSS_EXPOSURE + 1e-7) {
    throw new Error("directional_shadow_entry_exposure_above_1x");
  }
  const equity = Math.max(0, cash + unrealized);
  const peakEquity = Math.max(p.peak_equity, equity);
  const drawdown = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;
  const gross = equity > EPSILON ? Math.abs(positionTransition.quantity * mark) / equity : 0;

  return {
    status: Math.abs(quantityDelta) <= EPSILON ? "held" : "filled",
    cash_balance: cash,
    position_quantity: positionTransition.quantity,
    average_entry: positionTransition.average_entry,
    realized_pnl_delta: positionTransition.realized_pnl_delta,
    realized_pnl: p.realized_pnl + positionTransition.realized_pnl_delta,
    unrealized_pnl: unrealized,
    fee,
    carry,
    total_fees: p.total_fees + fee,
    total_carry: p.total_carry + carry,
    equity,
    peak_equity: peakEquity,
    max_drawdown_percent: Math.max(p.max_drawdown_percent, drawdown),
    entry_gross_exposure_multiple: entryGross,
    gross_exposure_multiple: gross,
    quantity_delta: quantityDelta,
    execution_price: fillPrice,
  };
}

function transitionPosition(currentQuantity, currentAverage, desiredQuantity, fillPrice) {
  const current = finite(currentQuantity, "current_quantity");
  const desired = finite(desiredQuantity, "desired_quantity");
  const average = current === 0 ? 0 : positive(currentAverage, "current_average");
  if (Math.abs(desired - current) <= EPSILON) {
    return { quantity: current, average_entry: average, realized_pnl_delta: 0 };
  }
  if (Math.abs(current) <= EPSILON) {
    return { quantity: desired, average_entry: Math.abs(desired) <= EPSILON ? 0 : fillPrice, realized_pnl_delta: 0 };
  }
  const currentSign = Math.sign(current);
  const desiredSign = Math.sign(desired);
  if (desiredSign === 0) {
    return {
      quantity: 0,
      average_entry: 0,
      realized_pnl_delta: Math.abs(current) * (fillPrice - average) * currentSign,
    };
  }
  if (currentSign !== desiredSign) {
    return {
      quantity: desired,
      average_entry: fillPrice,
      realized_pnl_delta: Math.abs(current) * (fillPrice - average) * currentSign,
    };
  }
  if (Math.abs(desired) < Math.abs(current)) {
    const closed = Math.abs(current) - Math.abs(desired);
    return {
      quantity: desired,
      average_entry: average,
      realized_pnl_delta: closed * (fillPrice - average) * currentSign,
    };
  }
  const added = Math.abs(desired) - Math.abs(current);
  const weightedAverage = ((Math.abs(current) * average) + (added * fillPrice)) / Math.abs(desired);
  return { quantity: desired, average_entry: weightedAverage, realized_pnl_delta: 0 };
}

async function ensureDefinitions(env, policyHash, createdAt) {
  const policy = await env.DB.prepare(
    `SELECT policy_hash FROM directional_shadow_policies WHERE id = ?`,
  ).bind(POLICY_ID).first();
  if (policy && policy.policy_hash !== policyHash) throw new Error("directional_shadow_policy_hash_conflict");

  const statements = [];
  if (!policy) {
    statements.push(env.DB.prepare(
      `INSERT INTO directional_shadow_policies
       (id, version, policy_json, policy_hash, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(
      POLICY_ID,
      DIRECTIONAL_SHADOW_POLICY.version,
      canonicalJson(DIRECTIONAL_SHADOW_POLICY),
      policyHash,
      createdAt,
    ));
  }
  for (const spec of DIRECTIONAL_STRATEGIES) {
    const specHash = await stableHash(spec);
    statements.push(env.DB.prepare(
      `INSERT OR IGNORE INTO directional_shadow_candidates
       (id, family, spec_json, spec_hash, portfolio_id, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
    ).bind(spec.id, spec.family, canonicalJson(spec), specHash, `shadow:${spec.id}`, createdAt));
    statements.push(env.DB.prepare(
      `INSERT OR IGNORE INTO directional_shadow_portfolios (
         id, candidate_id, initial_equity, cash_balance, position_quantity,
         average_entry, realized_pnl, unrealized_pnl, total_fees, total_carry,
         equity, peak_equity, max_drawdown_percent, gross_exposure_multiple,
         status, version, last_cycle_id, last_mark_price, last_marked_at,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0, 0, ?, ?, 0, 0, 'active', 0, NULL, NULL, NULL, ?, ?)`,
    ).bind(
      `shadow:${spec.id}`,
      spec.id,
      INITIAL_EQUITY,
      INITIAL_EQUITY,
      INITIAL_EQUITY,
      INITIAL_EQUITY,
      createdAt,
      createdAt,
    ));
  }
  if (statements.length > 0) await env.DB.batch(statements);
}

async function readPortfolios(env) {
  const rows = await env.DB.prepare(
    `SELECT * FROM directional_shadow_portfolios
     WHERE status = 'active' ORDER BY candidate_id ASC`,
  ).all();
  return rows.results || [];
}

async function readRecentCandles(env, limit) {
  const rows = await env.DB.prepare(
    `SELECT pair, interval, closed_at, open, high, low, close, volume, source
     FROM market_candles
     WHERE pair = ? AND interval = ?
     ORDER BY closed_at DESC LIMIT ?`,
  ).bind(MARKET, INTERVAL, limit).all();
  return normalizeCandles((rows.results || []).reverse());
}

async function readCycle(env, cycleId) {
  const row = await env.DB.prepare(
    `SELECT id, result_json, cycle_hash, created_at
     FROM directional_shadow_cycles WHERE id = ?`,
  ).bind(cycleId).first();
  if (!row) return null;
  return {
    ...parseJson(row.result_json, "directional_shadow_cycle_invalid"),
    cycle_id: row.id,
    cycle_hash: row.cycle_hash,
    created_at: row.created_at,
  };
}

async function readSchedulerReceipt(env, receiptId) {
  const row = await env.DB.prepare(
    `SELECT id, result_json, created_at
     FROM directional_shadow_scheduler_receipts WHERE id = ?`,
  ).bind(receiptId).first();
  if (!row) return null;
  return {
    ...parseJson(row.result_json, "directional_shadow_scheduler_invalid"),
    scheduler_receipt_id: row.id,
    created_at: row.created_at,
  };
}

function normalizePortfolio(row) {
  return {
    id: String(row.id),
    candidate_id: String(row.candidate_id),
    initial_equity: positive(row.initial_equity, "initial_equity"),
    cash_balance: finite(row.cash_balance, "cash_balance"),
    position_quantity: finite(row.position_quantity, "position_quantity"),
    average_entry: nonNegative(row.average_entry, "average_entry"),
    realized_pnl: finite(row.realized_pnl, "realized_pnl"),
    unrealized_pnl: finite(row.unrealized_pnl, "unrealized_pnl"),
    total_fees: nonNegative(row.total_fees, "total_fees"),
    total_carry: nonNegative(row.total_carry, "total_carry"),
    equity: nonNegative(row.equity, "equity"),
    peak_equity: positive(row.peak_equity, "peak_equity"),
    max_drawdown_percent: nonNegative(row.max_drawdown_percent, "max_drawdown_percent"),
    gross_exposure_multiple: nonNegative(row.gross_exposure_multiple, "gross_exposure_multiple"),
    version: integerOrZero(row.version, "version"),
    last_mark_price: row.last_mark_price === null || row.last_mark_price === undefined
      ? null : positive(row.last_mark_price, "last_mark_price"),
    last_marked_at: row.last_marked_at || null,
  };
}

function normalizeCandles(rows) {
  return rows.map((row) => ({
    pair: String(row.pair || MARKET),
    interval: String(row.interval || INTERVAL),
    closed_at: iso(row.closed_at, "closed_at"),
    open: positive(row.open, "open"),
    high: positive(row.high, "high"),
    low: positive(row.low, "low"),
    close: positive(row.close, "close"),
    volume: nonNegative(row.volume || 0, "volume"),
    source: String(row.source || ""),
  })).sort((a, b) => a.closed_at.localeCompare(b.closed_at));
}

function assertContiguous(candles) {
  for (let index = 1; index < candles.length; index += 1) {
    if (Date.parse(candles[index].closed_at) - Date.parse(candles[index - 1].closed_at) !== 60 * 60 * 1000) {
      throw new Error("directional_shadow_market_data_gap");
    }
  }
}

function strategy(id, family, parameters) {
  return {
    id,
    family,
    market: MARKET,
    interval: INTERVAL,
    direction: "long_flat_short",
    target_exposure_multiple: TARGET_EXPOSURE,
    parameters,
    immutable: true,
  };
}

function signal(targetExposure, reasonCode) {
  return { target_exposure: clampExposure(targetExposure), reason_code: reasonCode };
}

function signedExposure(quantity) {
  if (quantity > EPSILON) return 1;
  if (quantity < -EPSILON) return -1;
  return 0;
}

function clampExposure(value) {
  const number = finite(value, "target_exposure");
  if (number > MAX_GROSS_EXPOSURE + EPSILON || number < -MAX_GROSS_EXPOSURE - EPSILON) {
    throw new Error("directional_shadow_exposure_above_1x");
  }
  return Math.max(-MAX_GROSS_EXPOSURE, Math.min(MAX_GROSS_EXPOSURE, number));
}

function ema(values, period) {
  if (values.length < period) throw new Error("ema_insufficient_history");
  const alpha = 2 / (period + 1);
  let result = mean(values.slice(0, period));
  for (const value of values.slice(period)) result = alpha * value + (1 - alpha) * result;
  return result;
}

function rsi(values, period) {
  if (values.length <= period) return null;
  const changes = [];
  for (let index = 1; index < values.length; index += 1) changes.push(values[index] - values[index - 1]);
  let gains = 0;
  let losses = 0;
  for (const change of changes.slice(0, period)) {
    gains += Math.max(change, 0);
    losses += Math.max(-change, 0);
  }
  let averageGain = gains / period;
  let averageLoss = losses / period;
  for (const change of changes.slice(period)) {
    averageGain = ((averageGain * (period - 1)) + Math.max(change, 0)) / period;
    averageLoss = ((averageLoss * (period - 1)) + Math.max(-change, 0)) / period;
  }
  if (averageLoss === 0) return 100;
  const relativeStrength = averageGain / averageLoss;
  return 100 - (100 / (1 + relativeStrength));
}

function atr(rows, period) {
  if (rows.length < period + 1) throw new Error("atr_insufficient_history");
  const ranges = [];
  for (let index = 1; index < rows.length; index += 1) {
    const current = rows[index];
    const priorClose = rows[index - 1].close;
    ranges.push(Math.max(
      current.high - current.low,
      Math.abs(current.high - priorClose),
      Math.abs(current.low - priorClose),
    ));
  }
  return mean(ranges.slice(-period));
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values) {
  const center = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - center) ** 2)));
}

function hoursBetween(previous, current) {
  if (!previous) return 1;
  const difference = (Date.parse(current) - Date.parse(previous)) / (60 * 60 * 1000);
  if (!Number.isFinite(difference) || difference <= 0) return 1;
  return difference;
}

function iso(value, name) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`invalid_${name}`);
  return date.toISOString();
}

function positive(value, name) {
  const number = finite(value, name);
  if (!(number > 0)) throw new Error(`${name}_must_be_positive`);
  return number;
}

function nonNegative(value, name) {
  const number = finite(value, name);
  if (number < 0) throw new Error(`${name}_must_be_nonnegative`);
  return number;
}

function finite(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${name}_must_be_finite`);
  return number;
}

function integer(value, name) {
  const number = finite(value, name);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${name}_must_be_positive_integer`);
  return number;
}

function integerOrZero(value, name) {
  const number = finite(value, name);
  if (!Number.isInteger(number) || number < 0) throw new Error(`${name}_must_be_nonnegative_integer`);
  return number;
}

function parseJson(value, errorCode) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(errorCode);
  }
}

function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
  }
  return value;
}

async function stableHash(value) {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return `sha256:${btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")}`;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}
