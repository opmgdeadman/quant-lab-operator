import { DIRECTIONAL_STRATEGIES } from "./directionalShadow.js";

const INITIAL_EQUITY = 10000;
const HOURS_PER_DAY = 24;
const EPSILON = 1e-9;
export const DIRECTIONAL_POSITION_HOLD_POLICY_ID = "directional-position-hold-v2";

export function runDirectionalWalkForward({ windows, strategies = DIRECTIONAL_STRATEGIES, policy }) {
  if (!Array.isArray(windows) || windows.length === 0) throw new Error("directional_windows_required");
  if (!Array.isArray(strategies) || strategies.length === 0) throw new Error("directional_strategies_required");
  if (!policy) throw new Error("directional_policy_required");
  return Object.freeze(strategies.map((strategy) => Object.freeze({
    candidate_id: strategy.id,
    family: strategy.family,
    windows: Object.freeze(windows.map((window) => Object.freeze(runDirectionalWindow({ window, strategy, policy })))),
  })));
}

export function runDirectionalWindow({ window, strategy, policy }) {
  const history = normalizeCandles([...window.train, ...window.validation, ...window.test]);
  const testStart = window.train.length + window.validation.length;
  if (window.test.length < 2) throw new Error("directional_test_window_too_short");
  const evaluateSignal = compileDirectionalSignal(strategy, history);

  const base = simulate(history, testStart, policy, 1, evaluateSignal);
  const doubled = simulate(history, testStart, policy, 2, evaluateSignal);
  const tripled = simulate(history, testStart, policy, 3, evaluateSignal);
  return {
    window_id: window.id,
    candidate_id: strategy.id,
    start_closed_at: window.start_closed_at,
    end_closed_at: window.end_closed_at,
    test_return_percent: base.return_percent,
    doubled_cost_return_percent: doubled.return_percent,
    tripled_cost_return_percent: tripled.return_percent,
    test_drawdown_percent: base.max_drawdown_percent,
    closed_trade_count: base.closed_trade_count,
    fill_count: base.fill_count,
    total_fees: base.total_fees,
    total_carry: base.total_carry,
    ending_equity: base.ending_equity,
    evidence_integrity_passed: true,
    execution_model: "next_completed_candle_open",
  };
}

export function runDirectionalExecutionPolicyComparison({ windows, strategy, policyV1, policyV2 }) {
  if (!Array.isArray(windows) || windows.length === 0) throw new Error("directional_windows_required");
  if (!strategy) throw new Error("directional_strategy_required");
  if (!policyV1 || !policyV2) throw new Error("directional_execution_policies_required");
  if (policyV1.id === policyV2.id) throw new Error("directional_execution_policies_must_differ");
  return Object.freeze(windows.map((window) => {
    const history = normalizeCandles([...window.train, ...window.validation, ...window.test]);
    const testStart = window.train.length + window.validation.length;
    const evaluateSignal = compileDirectionalSignal(strategy, history);
    const v1 = policyResearchMetrics(history, testStart, policyV1, evaluateSignal);
    const v2 = policyResearchMetrics(history, testStart, policyV2, evaluateSignal);
    return Object.freeze({
      window_id: window.id,
      start_closed_at: window.start_closed_at,
      end_closed_at: window.end_closed_at,
      v1: Object.freeze(v1),
      v2: Object.freeze(v2),
      delta: Object.freeze({
        base_return_percent: round(v2.base_return_percent - v1.base_return_percent),
        doubled_cost_return_percent: round(v2.doubled_cost_return_percent - v1.doubled_cost_return_percent),
        tripled_cost_return_percent: round(v2.tripled_cost_return_percent - v1.tripled_cost_return_percent),
        max_drawdown_percent: round(v2.max_drawdown_percent - v1.max_drawdown_percent),
        fill_count: v2.fill_count - v1.fill_count,
        closed_trade_count: v2.closed_trade_count - v1.closed_trade_count,
        turnover_notional: round(v2.turnover_notional - v1.turnover_notional),
        total_fees: round(v2.total_fees - v1.total_fees),
        total_slippage: round(v2.total_slippage - v1.total_slippage),
        total_carry: round(v2.total_carry - v1.total_carry),
      }),
    });
  }));
}

function policyResearchMetrics(history, testStart, policy, evaluateSignal) {
  const base = simulate(history, testStart, policy, 1, evaluateSignal);
  const doubled = simulate(history, testStart, policy, 2, evaluateSignal);
  const tripled = simulate(history, testStart, policy, 3, evaluateSignal);
  return {
    policy_id: policy.id,
    base_return_percent: base.return_percent,
    doubled_cost_return_percent: doubled.return_percent,
    tripled_cost_return_percent: tripled.return_percent,
    max_drawdown_percent: base.max_drawdown_percent,
    fill_count: base.fill_count,
    closed_trade_count: base.closed_trade_count,
    turnover_notional: base.turnover_notional,
    total_fees: base.total_fees,
    total_slippage: base.total_slippage,
    total_carry: base.total_carry,
  };
}

export function compileDirectionalSignal(strategy, candles) {
  const rows = normalizeCandles(candles);
  const closes = rows.map((row) => row.close);
  const family = String(strategy?.family || "");
  const parameters = strategy?.parameters || {};

  if (family === "ema_trend") {
    const fast = integer(parameters.fast, "fast");
    const slow = integer(parameters.slow, "slow");
    const fastValues = emaSeries(closes, fast);
    const slowValues = emaSeries(closes, slow);
    return (executionIndex, currentExposure = 0) => {
      const current = clamp(currentExposure);
      if (executionIndex < slow) return current;
      const signalIndex = executionIndex - 1;
      return fastValues[signalIndex] >= slowValues[signalIndex] ? 1 : -1;
    };
  }

  if (family === "ema_pullback_trend") {
    const fast = integer(parameters.fast, "fast");
    const slow = integer(parameters.slow, "slow");
    const threshold = finite(parameters.threshold_percent, "threshold_percent") / 100;
    const fastValues = emaSeries(closes, fast);
    const slowValues = emaSeries(closes, slow);
    return (executionIndex, currentExposure = 0) => {
      const current = clamp(currentExposure);
      if (executionIndex < slow) return current;
      const signalIndex = executionIndex - 1;
      const fastEma = fastValues[signalIndex];
      const slowEma = slowValues[signalIndex];
      const latestClose = closes[signalIndex];
      if (fastEma > slowEma && latestClose <= fastEma * (1 - threshold)) return 1;
      if (fastEma < slowEma && latestClose >= fastEma * (1 + threshold)) return -1;
      return 0;
    };
  }

  if (family === "close_location_pressure") {
    const period = integer(parameters.period, "period");
    const threshold = finite(parameters.pressure_threshold, "pressure_threshold");
    return (executionIndex, currentExposure = 0) => {
      const current = clamp(currentExposure);
      if (executionIndex < period) return current;
      let pressureTotal = 0;
      for (let index = executionIndex - period; index < executionIndex; index += 1) {
        const row = rows[index];
        const range = row.high - row.low;
        pressureTotal += range <= EPSILON ? 0 : ((2 * row.close) - row.high - row.low) / range;
      }
      const pressure = pressureTotal / period;
      if (pressure > threshold) return 1;
      if (pressure < -threshold) return -1;
      return 0;
    };
  }

  if (family === "range_position_state") {
    const period = integer(parameters.period, "period");
    const lower = finite(parameters.lower, "lower") / 100;
    const upper = finite(parameters.upper, "upper") / 100;
    return (executionIndex, currentExposure = 0) => {
      const current = clamp(currentExposure);
      if (executionIndex < period) return current;
      let rangeLow = Infinity;
      let rangeHigh = -Infinity;
      for (let index = executionIndex - period; index < executionIndex; index += 1) {
        rangeLow = Math.min(rangeLow, rows[index].low);
        rangeHigh = Math.max(rangeHigh, rows[index].high);
      }
      const range = rangeHigh - rangeLow;
      if (range <= EPSILON) return 0;
      const position = (rows[executionIndex - 1].close - rangeLow) / range;
      if (position + EPSILON >= upper) return 1;
      if (position - EPSILON <= lower) return -1;
      return 0;
    };
  }

  if (family === "return_zscore_reversal") {
    const period = integer(parameters.period, "period");
    const threshold = finite(parameters.z_threshold, "z_threshold");
    return (executionIndex, currentExposure = 0) => {
      const current = clamp(currentExposure);
      if (executionIndex < period + 2) return current;
      const latestReturn = rows[executionIndex - 1].close / rows[executionIndex - 2].close - 1;
      const priorReturns = [];
      for (let index = executionIndex - period - 1; index <= executionIndex - 2; index += 1) priorReturns.push(rows[index].close / rows[index - 1].close - 1);
      const mean = priorReturns.reduce((sum, value) => sum + value, 0) / priorReturns.length;
      const variance = priorReturns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (priorReturns.length - 1);
      const dispersion = Math.sqrt(Math.max(0, variance));
      if (dispersion <= EPSILON) return 0;
      const z = (latestReturn - mean) / dispersion;
      if (z + EPSILON >= threshold) return -1;
      if (z - EPSILON <= -threshold) return 1;
      return 0;
    };
  }

  if (family === "rolling_drawdown_reversion") {
    const period = integer(parameters.period, "period");
    const threshold = finite(parameters.threshold_percent, "threshold_percent") / 100;
    return (executionIndex, currentExposure = 0) => {
      const current = clamp(currentExposure);
      if (executionIndex < period) return current;
      let peak = -Infinity;
      for (let index = executionIndex - period; index < executionIndex; index += 1) peak = Math.max(peak, rows[index].close);
      if (!Number.isFinite(peak) || peak <= EPSILON) return 0;
      const latest = rows[executionIndex - 1].close;
      const drawdown = (peak - latest) / peak;
      return drawdown + EPSILON >= threshold ? 1 : 0;
    };
  }

  if (family === "wick_rejection_reversal") {
    const period = integer(parameters.period, "period");
    const threshold = finite(parameters.wick_ratio_threshold, "wick_ratio_threshold");
    return (executionIndex, currentExposure = 0) => {
      const current = clamp(currentExposure);
      if (executionIndex < period) return current;
      let lowerRejection = 0;
      let upperRejection = 0;
      for (let index = executionIndex - period; index < executionIndex; index += 1) {
        const row = rows[index];
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
      if (lowerRejection > upperRejection * threshold) return 1;
      if (upperRejection > lowerRejection * threshold) return -1;
      return 0;
    };
  }

  if (family === "return_autocorrelation_state") {
    const period = integer(parameters.period, "period");
    const threshold = finite(parameters.autocorr_threshold, "autocorr_threshold");
    return (executionIndex, currentExposure = 0) => {
      const current = clamp(currentExposure);
      if (executionIndex < period + 2) return current;
      const closes = rows.slice(executionIndex - period - 2, executionIndex).map((row) => row.close);
      const returns = [];
      for (let index = 1; index < closes.length; index += 1) returns.push((closes[index] / closes[index - 1]) - 1);
      const x = returns.slice(0, -1);
      const y = returns.slice(1);
      const xMean = x.reduce((sum, value) => sum + value, 0) / x.length;
      const yMean = y.reduce((sum, value) => sum + value, 0) / y.length;
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
      if (xVariance <= EPSILON || yVariance <= EPSILON) return 0;
      const autocorrelation = covariance / Math.sqrt(xVariance * yVariance);
      const latestReturn = returns.at(-1);
      if (Math.abs(latestReturn) <= EPSILON || Math.abs(autocorrelation) < threshold) return 0;
      const latestSign = latestReturn > 0 ? 1 : -1;
      return autocorrelation > 0 ? latestSign : -latestSign;
    };
  }

  if (family === "return_semivariance_imbalance") {
    const period = integer(parameters.period, "period");
    const threshold = finite(parameters.imbalance_threshold, "imbalance_threshold");
    return (executionIndex, currentExposure = 0) => {
      const current = clamp(currentExposure);
      if (executionIndex < period + 1) return current;
      const windowCloses = rows.slice(executionIndex - period - 1, executionIndex).map((row) => row.close);
      let upside = 0;
      let downside = 0;
      for (let index = 1; index < windowCloses.length; index += 1) {
        const value = (windowCloses[index] / windowCloses[index - 1]) - 1;
        if (!Number.isFinite(value)) return 0;
        if (value > EPSILON) upside += value * value;
        else if (value < -EPSILON) downside += value * value;
      }
      const total = upside + downside;
      if (!Number.isFinite(total) || total <= EPSILON) return 0;
      const upsideShare = upside / total;
      const downsideShare = downside / total;
      if (upsideShare + EPSILON >= threshold) return 1;
      if (downsideShare + EPSILON >= threshold) return -1;
      return 0;
    };
  }

  if (family === "return_sign_transition_state") {
    const period = integer(parameters.period, "period");
    const threshold = finite(parameters.persistence_threshold, "persistence_threshold");
    return (executionIndex, currentExposure = 0) => {
      const current = clamp(currentExposure);
      if (executionIndex < period + 1) return current;
      const windowCloses = rows.slice(executionIndex - period - 1, executionIndex).map((row) => row.close);
      const signs = [];
      for (let index = 1; index < windowCloses.length; index += 1) {
        const value = (windowCloses[index] / windowCloses[index - 1]) - 1;
        if (Math.abs(value) > EPSILON) signs.push(value > 0 ? 1 : -1);
      }
      if (signs.length < 2) return 0;
      let persistentTransitions = 0;
      for (let index = 1; index < signs.length; index += 1) {
        if (signs[index] === signs[index - 1]) persistentTransitions += 1;
      }
      const persistence = persistentTransitions / (signs.length - 1);
      const latestSign = signs.at(-1) > 0 ? 1 : -1;
      if (persistence >= threshold) return latestSign;
      if (persistence <= 1 - threshold) return -latestSign;
      return 0;
    };
  }

  if (family === "return_skew_state") {
    const period = integer(parameters.period, "period");
    const threshold = finite(parameters.skew_threshold, "skew_threshold");
    return (executionIndex, currentExposure = 0) => {
      const current = clamp(currentExposure);
      if (executionIndex < period + 1) return current;
      const windowCloses = rows.slice(executionIndex - period - 1, executionIndex).map((row) => row.close);
      const returns = [];
      for (let index = 1; index < windowCloses.length; index += 1) returns.push((windowCloses[index] / windowCloses[index - 1]) - 1);
      const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
      const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length;
      if (variance <= EPSILON) return 0;
      const sigma = Math.sqrt(variance);
      const thirdMoment = returns.reduce((sum, value) => sum + (value - mean) ** 3, 0) / returns.length;
      const skew = thirdMoment / (sigma ** 3);
      if (skew >= threshold) return 1;
      if (skew <= -threshold) return -1;
      return 0;
    };
  }

  if (family === "hour_of_week_drift") {
    const lookbackWeeks = integer(parameters.lookback_weeks, "lookback_weeks");
    const thresholdBps = finite(parameters.mean_return_threshold_bps, "mean_return_threshold_bps");
    return (executionIndex, currentExposure = 0) => {
      const current = clamp(currentExposure);
      const signalIndex = executionIndex - 1;
      if (signalIndex < 1) return current;
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
      if (samples.length < lookbackWeeks) return 0;
      const meanReturnBps = (samples.reduce((sum, value) => sum + value, 0) / samples.length) * 10000;
      if (meanReturnBps >= thresholdBps) return 1;
      if (meanReturnBps <= -thresholdBps) return -1;
      return 0;
    };
  }

  if (family === "inside_bar_breakout") {
    const maxRatio = finite(parameters.max_inside_range_ratio, "max_inside_range_ratio");
    return (executionIndex, currentExposure = 0) => {
      const current = clamp(currentExposure);
      if (executionIndex < 4) return current;
      const mother = rows[executionIndex - 4];
      const inside = rows[executionIndex - 3];
      const breakout = rows[executionIndex - 2];
      const motherRange = mother.high - mother.low;
      if (motherRange <= EPSILON) return 0;
      const insideRange = inside.high - inside.low;
      const isInside = inside.high <= mother.high + EPSILON
        && inside.low >= mother.low - EPSILON
        && insideRange / motherRange <= maxRatio + EPSILON;
      if (!isInside) return 0;
      if (breakout.close > mother.high) return 1;
      if (breakout.close < mother.low) return -1;
      return 0;
    };
  }

  if (family === "engulfing_reversal") {
    const minBodyRatio = finite(parameters.min_body_ratio, "min_body_ratio");
    return (executionIndex, currentExposure = 0) => {
      const current = clamp(currentExposure);
      if (executionIndex < 3) return current;
      const prior = rows[executionIndex - 3];
      const second = rows[executionIndex - 2];
      const priorBody = Math.abs(prior.close - prior.open);
      const secondBody = Math.abs(second.close - second.open);
      if (priorBody <= EPSILON) return 0;
      const priorDirection = Math.sign(prior.close - prior.open);
      const secondDirection = Math.sign(second.close - second.open);
      if (priorDirection === 0 || secondDirection === 0 || priorDirection === secondDirection) return 0;
      const priorLowBody = Math.min(prior.open, prior.close);
      const priorHighBody = Math.max(prior.open, prior.close);
      const secondLowBody = Math.min(second.open, second.close);
      const secondHighBody = Math.max(second.open, second.close);
      const engulfed = secondLowBody <= priorLowBody + EPSILON && secondHighBody >= priorHighBody - EPSILON;
      if (!engulfed || secondBody / priorBody + EPSILON < minBodyRatio) return 0;
      return secondDirection > 0 ? 1 : -1;
    };
  }

  if (family === "donchian_breakout") {
    const lookback = integer(parameters.lookback, "lookback");
    return (executionIndex, currentExposure = 0) => {
      const current = clamp(currentExposure);
      if (executionIndex < lookback + 1) return current;
      const latest = rows[executionIndex - 1];
      let upper = -Infinity;
      let lower = Infinity;
      for (let index = executionIndex - lookback - 1; index < executionIndex - 1; index += 1) {
        upper = Math.max(upper, rows[index].high);
        lower = Math.min(lower, rows[index].low);
      }
      if (latest.close > upper) return 1;
      if (latest.close < lower) return -1;
      return current;
    };
  }

  if (family === "donchian_regime_breakout") {
    const lookback = integer(parameters.lookback, "lookback");
    const regimeLookback = integer(parameters.regime_lookback, "regime_lookback");
    return (executionIndex, currentExposure = 0) => {
      const current = clamp(currentExposure);
      if (executionIndex < regimeLookback + 1) return current;
      const signalIndex = executionIndex - 1;
      const latest = rows[signalIndex];
      const regimeReturn = (closes[signalIndex] / closes[signalIndex - regimeLookback]) - 1;
      if ((current > 0 && regimeReturn <= 0) || (current < 0 && regimeReturn >= 0)) return 0;
      let upper = -Infinity;
      let lower = Infinity;
      for (let index = executionIndex - lookback - 1; index < executionIndex - 1; index += 1) {
        upper = Math.max(upper, rows[index].high);
        lower = Math.min(lower, rows[index].low);
      }
      if (latest.close > upper && regimeReturn > 0) return 1;
      if (latest.close < lower && regimeReturn < 0) return -1;
      return current;
    };
  }

  if (family === "donchian_compression_breakout") {
    const lookback = integer(parameters.lookback, "lookback");
    const compressionPeriod = integer(parameters.compression_period, "compression_period");
    const baselinePeriod = integer(parameters.baseline_period, "baseline_period");
    return (executionIndex, currentExposure = 0) => {
      const current = clamp(currentExposure);
      if (executionIndex < baselinePeriod + 2) return current;
      const compressionRange = averageTrueRangeBeforeSignal(rows, executionIndex, compressionPeriod);
      const baselineRange = averageTrueRangeBeforeSignal(rows, executionIndex, baselinePeriod);
      if (!(compressionRange < baselineRange)) return current;
      const latest = rows[executionIndex - 1];
      let upper = -Infinity;
      let lower = Infinity;
      for (let index = executionIndex - lookback - 1; index < executionIndex - 1; index += 1) {
        upper = Math.max(upper, rows[index].high);
        lower = Math.min(lower, rows[index].low);
      }
      if (latest.close > upper) return 1;
      if (latest.close < lower) return -1;
      return current;
    };
  }

  if (family === "dmi_adx_trend") {
    const period = integer(parameters.period, "period");
    const threshold = finite(parameters.adx_threshold, "adx_threshold");
    const directional = dmiAdxSeries(rows, period);
    return (executionIndex) => {
      const signalIndex = executionIndex - 1;
      const state = directional[signalIndex];
      if (!state || state.adx < threshold) return 0;
      if (state.plus_di > state.minus_di) return 1;
      if (state.minus_di > state.plus_di) return -1;
      return 0;
    };
  }

  if (family === "efficiency_ratio_trend") {
    const period = integer(parameters.period, "period");
    const threshold = finite(parameters.efficiency_threshold, "efficiency_threshold");
    return (executionIndex, currentExposure = 0) => {
      const current = clamp(currentExposure);
      if (executionIndex < period + 1) return current;
      const signalIndex = executionIndex - 1;
      const startIndex = signalIndex - period;
      const displacement = closes[signalIndex] - closes[startIndex];
      let pathLength = 0;
      for (let index = startIndex + 1; index <= signalIndex; index += 1) pathLength += Math.abs(closes[index] - closes[index - 1]);
      if (pathLength <= EPSILON) return 0;
      const efficiency = Math.abs(displacement) / pathLength;
      if (efficiency + EPSILON < threshold || Math.abs(displacement) <= EPSILON) return 0;
      return displacement > 0 ? 1 : -1;
    };
  }

  if (family === "return_acceleration_state") {
    const period = integer(parameters.period, "period");
    const threshold = finite(parameters.acceleration_threshold_percent, "acceleration_threshold_percent");
    return (executionIndex, currentExposure = 0) => {
      const current = clamp(currentExposure);
      if (executionIndex < 2 * period + 1) return current;
      const signalIndex = executionIndex - 1;
      const midpoint = rows[signalIndex - period].close;
      const priorStart = rows[signalIndex - 2 * period].close;
      const latest = rows[signalIndex].close;
      if (midpoint <= 0 || priorStart <= 0 || latest <= 0) return 0;
      const previousReturnPercent = ((midpoint / priorStart) - 1) * 100;
      const recentReturnPercent = ((latest / midpoint) - 1) * 100;
      const acceleration = recentReturnPercent - previousReturnPercent;
      if (recentReturnPercent > EPSILON && acceleration + EPSILON >= threshold) return 1;
      if (recentReturnPercent < -EPSILON && acceleration - EPSILON <= -threshold) return -1;
      return 0;
    };
  }

  if (family === "close_quantile_reversion") {
    const period = integer(parameters.period, "period");
    const lowerQuantile = finite(parameters.lower_quantile, "lower_quantile");
    const upperQuantile = finite(parameters.upper_quantile, "upper_quantile");
    if (!(lowerQuantile > 0 && lowerQuantile < upperQuantile && upperQuantile < 1)) throw new Error("close_quantile_threshold_order_invalid");
    return (executionIndex, currentExposure = 0) => {
      const current = clamp(currentExposure);
      if (executionIndex < period) return current;
      const window = rows.slice(executionIndex - period, executionIndex).map((row) => finite(row.close, "close"));
      if (window.some((value) => value <= 0)) return 0;
      const latestClose = window.at(-1);
      let below = 0;
      let equal = 0;
      for (const value of window) {
        if (value < latestClose - EPSILON) below += 1;
        else if (Math.abs(value - latestClose) <= EPSILON) equal += 1;
      }
      const midrank = (below + 0.5 * equal) / period;
      if (midrank <= lowerQuantile + EPSILON) return 1;
      if (midrank >= upperQuantile - EPSILON) return -1;
      return 0;
    };
  }

  if (family === "rolling_median_reversion") {
    const period = integer(parameters.period, "period");
    const thresholdPercent = finite(parameters.threshold_percent, "threshold_percent");
    return (executionIndex, currentExposure = 0) => {
      const current = clamp(currentExposure);
      if (executionIndex < period) return current;
      const closes = rows.slice(executionIndex - period, executionIndex).map((row) => finite(row.close, "close")).sort((a, b) => a - b);
      if (closes.some((value) => value <= 0)) return 0;
      const mid = Math.floor(closes.length / 2);
      const median = closes.length % 2 === 0 ? (closes[mid - 1] + closes[mid]) / 2 : closes[mid];
      if (!Number.isFinite(median) || median <= 0) return 0;
      const latestClose = finite(rows[executionIndex - 1].close, "close");
      const displacementPercent = ((latestClose / median) - 1) * 100;
      if (displacementPercent + EPSILON >= thresholdPercent) return -1;
      if (displacementPercent - EPSILON <= -thresholdPercent) return 1;
      return 0;
    };
  }

  if (family === "linear_trend_residual_reversion") {
    const period = integer(parameters.period, "period");
    const thresholdPercent = finite(parameters.threshold_percent, "threshold_percent");
    return (executionIndex, currentExposure = 0) => {
      const current = clamp(currentExposure);
      if (executionIndex < period) return current;
      const closes = rows.slice(executionIndex - period, executionIndex).map((row) => Number(row.close));
      if (closes.length !== period || closes.some((value) => !Number.isFinite(value) || value <= 0)) return 0;
      const xMean = (period - 1) / 2;
      const yMean = closes.reduce((sum, value) => sum + value, 0) / period;
      let numerator = 0;
      let denominator = 0;
      for (let index = 0; index < period; index += 1) {
        const dx = index - xMean;
        numerator += dx * (closes[index] - yMean);
        denominator += dx * dx;
      }
      if (!Number.isFinite(denominator) || denominator <= EPSILON) return 0;
      const slope = numerator / denominator;
      const fittedEndpoint = yMean + slope * ((period - 1) - xMean);
      if (!Number.isFinite(fittedEndpoint) || fittedEndpoint <= EPSILON) return 0;
      const residualPercent = ((closes.at(-1) - fittedEndpoint) / fittedEndpoint) * 100;
      if (residualPercent + EPSILON >= thresholdPercent) return -1;
      if (residualPercent - EPSILON <= -thresholdPercent) return 1;
      return 0;
    };
  }

  if (family === "volatility_shock_reversal") {
    const period = integer(parameters.period, "period");
    const multiplier = finite(parameters.multiplier, "multiplier");
    return (executionIndex, currentExposure = 0) => {
      const current = clamp(currentExposure);
      if (executionIndex < period + 2) return current;
      const start = executionIndex - period - 2;
      const trueRanges = [];
      for (let index = start + 1; index < executionIndex; index += 1) {
        const row = rows[index];
        const previousClose = rows[index - 1].close;
        const tr = Math.max(row.high - row.low, Math.abs(row.high - previousClose), Math.abs(row.low - previousClose));
        if (!Number.isFinite(tr) || tr < 0) return 0;
        trueRanges.push(tr);
      }
      const latestTrueRange = trueRanges.at(-1);
      const prior = trueRanges.slice(0, -1);
      const priorMeanTrueRange = prior.reduce((sum, value) => sum + value, 0) / prior.length;
      if (!Number.isFinite(priorMeanTrueRange) || priorMeanTrueRange <= EPSILON) return 0;
      if (latestTrueRange + EPSILON < priorMeanTrueRange * multiplier) return 0;
      const latest = rows[executionIndex - 1];
      const bodyDirection = Math.sign(latest.close - latest.open);
      if (bodyDirection === 0) return 0;
      return bodyDirection > 0 ? -1 : 1;
    };
  }

  if (family === "body_streak_reversal") {
    const streakLength = integer(parameters.streak_length, "streak_length");
    const minBodyFraction = finite(parameters.min_body_fraction, "min_body_fraction");
    return (executionIndex, currentExposure = 0) => {
      const current = clamp(currentExposure);
      if (executionIndex < streakLength) return current;
      let direction = 0;
      for (let index = executionIndex - streakLength; index < executionIndex; index += 1) {
        const row = rows[index];
        const range = row.high - row.low;
        if (range <= EPSILON) return 0;
        const bodyDirection = Math.sign(row.close - row.open);
        if (bodyDirection === 0) return 0;
        if (Math.abs(row.close - row.open) / range + EPSILON < minBodyFraction) return 0;
        if (direction === 0) direction = bodyDirection;
        else if (bodyDirection !== direction) return 0;
      }
      return direction > 0 ? -1 : 1;
    };
  }

  if (family === "price_momentum") {
    const lookback = integer(parameters.lookback, "lookback");
    const threshold = finite(parameters.threshold_percent, "threshold_percent") / 100;
    return (executionIndex, currentExposure = 0) => {
      const current = clamp(currentExposure);
      if (executionIndex < lookback + 1) return current;
      const change = (closes[executionIndex - 1] / closes[executionIndex - lookback - 1]) - 1;
      if (change > threshold) return 1;
      if (change < -threshold) return -1;
      return 0;
    };
  }

  if (family === "regime_momentum") {
    const lookback = integer(parameters.lookback, "lookback");
    const regimeLookback = integer(parameters.regime_lookback, "regime_lookback");
    const threshold = finite(parameters.threshold_percent, "threshold_percent") / 100;
    return (executionIndex, currentExposure = 0) => {
      const current = clamp(currentExposure);
      if (executionIndex < regimeLookback + 1) return current;
      const signalIndex = executionIndex - 1;
      const momentumReturn = (closes[signalIndex] / closes[signalIndex - lookback]) - 1;
      const regimeReturn = (closes[signalIndex] / closes[signalIndex - regimeLookback]) - 1;
      return regimeReturn > 0 && momentumReturn > threshold ? 1 : 0;
    };
  }

  if (family === "volatility_breakout") {
    const period = integer(parameters.period, "period");
    const multiplier = finite(parameters.multiplier, "multiplier");
    return (executionIndex, currentExposure = 0) => {
      const current = clamp(currentExposure);
      if (executionIndex < period + 2) return current;
      let rangeTotal = 0;
      for (let index = executionIndex - period - 1; index <= executionIndex - 2; index += 1) {
        const row = rows[index];
        const priorClose = rows[index - 1].close;
        rangeTotal += Math.max(
          row.high - row.low,
          Math.abs(row.high - priorClose),
          Math.abs(row.low - priorClose),
        );
      }
      const range = rangeTotal / period;
      const previousClose = closes[executionIndex - 2];
      const latestClose = closes[executionIndex - 1];
      if (latestClose > previousClose + range * multiplier) return 1;
      if (latestClose < previousClose - range * multiplier) return -1;
      return current;
    };
  }

  if (family === "volatility_regime_breakout") {
    const period = integer(parameters.period, "period");
    const regimePeriod = integer(parameters.regime_period, "regime_period");
    const multiplier = finite(parameters.multiplier, "multiplier");
    return (executionIndex, currentExposure = 0) => {
      const current = clamp(currentExposure);
      if (executionIndex < regimePeriod + 2) return current;
      let shortRangeTotal = 0;
      for (let index = executionIndex - period - 1; index <= executionIndex - 2; index += 1) {
        const row = rows[index];
        const priorClose = rows[index - 1].close;
        shortRangeTotal += Math.max(
          row.high - row.low,
          Math.abs(row.high - priorClose),
          Math.abs(row.low - priorClose),
        );
      }
      let regimeRangeTotal = 0;
      for (let index = executionIndex - regimePeriod - 1; index <= executionIndex - 2; index += 1) {
        const row = rows[index];
        const priorClose = rows[index - 1].close;
        regimeRangeTotal += Math.max(
          row.high - row.low,
          Math.abs(row.high - priorClose),
          Math.abs(row.low - priorClose),
        );
      }
      const shortRange = shortRangeTotal / period;
      const regimeRange = regimeRangeTotal / regimePeriod;
      if (shortRange <= regimeRange) return 0;
      const previousClose = closes[executionIndex - 2];
      const latestClose = closes[executionIndex - 1];
      if (latestClose > previousClose + shortRange * multiplier) return 1;
      if (latestClose < previousClose - shortRange * multiplier) return -1;
      return current;
    };
  }

  if (family === "rsi_mean_reversion") {
    const period = integer(parameters.period, "period");
    const values = rsiSeries(closes, period);
    const lower = finite(parameters.lower, "lower");
    const upper = finite(parameters.upper, "upper");
    const exitLower = finite(parameters.exit_lower, "exit_lower");
    const exitUpper = finite(parameters.exit_upper, "exit_upper");
    return (executionIndex, currentExposure = 0) => {
      const current = clamp(currentExposure);
      const value = values[executionIndex - 1];
      if (value === null || value === undefined) return current;
      if (value < lower) return 1;
      if (value > upper) return -1;
      if (current > 0 && value >= exitLower) return 0;
      if (current < 0 && value <= exitUpper) return 0;
      return current;
    };
  }

  if (family === "bollinger_mean_reversion") {
    const period = integer(parameters.period, "period");
    const deviations = finite(parameters.deviations, "deviations");
    return (executionIndex, currentExposure = 0) => {
      const current = clamp(currentExposure);
      if (executionIndex < period) return current;
      const window = closes.slice(executionIndex - period, executionIndex);
      const center = mean(window);
      const deviation = standardDeviation(window);
      const latest = closes[executionIndex - 1];
      if (latest < center - deviations * deviation) return 1;
      if (latest > center + deviations * deviation) return -1;
      if ((current > 0 && latest >= center) || (current < 0 && latest <= center)) return 0;
      return current;
    };
  }

  throw new Error(`directional_shadow_family_unsupported:${family}`);
}

function simulate(candles, testStart, policy, costMultiplier, evaluateSignal) {
  const feeRate = ((policy.base_fee_bps || 0) * costMultiplier) / 10000;
  const slippageRate = ((policy.base_slippage_bps || 0) * costMultiplier) / 10000;
  const carryHourly = ((policy.short_carry_bps_per_day || 0) * costMultiplier) / 10000 / HOURS_PER_DAY;
  let cash = INITIAL_EQUITY;
  let quantity = 0;
  let averageEntry = 0;
  let peakEquity = INITIAL_EQUITY;
  let maxDrawdown = 0;
  let totalFees = 0;
  let totalCarry = 0;
  let totalSlippage = 0;
  let turnoverNotional = 0;
  let closedTrades = 0;
  let fillCount = 0;
  const positionHold = policy.id === DIRECTIONAL_POSITION_HOLD_POLICY_ID;

  for (let executionIndex = testStart; executionIndex < candles.length; executionIndex += 1) {
    const execution = candles[executionIndex];
    const markBefore = candles[executionIndex - 1].close;
    const equityBefore = cash + quantity * markBefore;
    const markedExposure = Math.abs(equityBefore) <= EPSILON ? 0 : (quantity * markBefore) / equityBefore;
    const currentExposure = positionHold ? Math.sign(quantity) : clamp(markedExposure);
    const targetExposure = clamp(evaluateSignal(executionIndex, currentExposure));
    const rawFill = execution.open * (targetExposure >= currentExposure ? 1 + slippageRate : 1 - slippageRate);
    const sameDirectionHold = positionHold && Math.sign(quantity) !== 0 && Math.sign(targetExposure) === Math.sign(quantity);
    const targetQuantity = sameDirectionHold
      ? quantity
      : Math.abs(equityBefore) <= EPSILON ? 0 : (targetExposure * equityBefore) / rawFill;
    const delta = targetQuantity - quantity;

    if (Math.abs(delta) > EPSILON) {
      const fee = Math.abs(delta * rawFill) * feeRate;
      turnoverNotional += Math.abs(delta * execution.open);
      totalSlippage += Math.abs(delta) * Math.abs(rawFill - execution.open);
      const oldSign = Math.sign(quantity);
      const newSign = Math.sign(targetQuantity);
      if (oldSign !== 0 && (newSign !== oldSign || Math.abs(targetQuantity) < Math.abs(quantity))) closedTrades += 1;
      cash -= delta * rawFill;
      cash -= fee;
      totalFees += fee;
      fillCount += 1;
      if (newSign === 0) averageEntry = 0;
      else if (oldSign === 0 || oldSign !== newSign) averageEntry = rawFill;
      else if (Math.abs(targetQuantity) > Math.abs(quantity)) {
        const added = Math.abs(targetQuantity) - Math.abs(quantity);
        averageEntry = ((Math.abs(quantity) * averageEntry) + added * rawFill) / Math.abs(targetQuantity);
      }
      quantity = targetQuantity;
    }

    if (quantity < -EPSILON) {
      const carry = Math.abs(quantity * execution.close) * carryHourly;
      cash -= carry;
      totalCarry += carry;
    }

    const equity = cash + quantity * execution.close;
    peakEquity = Math.max(peakEquity, equity);
    const drawdown = peakEquity <= 0 ? 100 : ((peakEquity - equity) / peakEquity) * 100;
    maxDrawdown = Math.max(maxDrawdown, drawdown);
  }

  const lastClose = candles.at(-1).close;
  if (Math.abs(quantity) > EPSILON) {
    const liquidation = lastClose * (quantity > 0 ? 1 - slippageRate : 1 + slippageRate);
    const fee = Math.abs(quantity * liquidation) * feeRate;
    cash += quantity * liquidation;
    cash -= fee;
    totalFees += fee;
    turnoverNotional += Math.abs(quantity * lastClose);
    totalSlippage += Math.abs(quantity) * Math.abs(liquidation - lastClose);
    fillCount += 1;
    closedTrades += 1;
    quantity = 0;
  }
  const endingEquity = cash;
  return {
    ending_equity: round(endingEquity),
    return_percent: round(((endingEquity / INITIAL_EQUITY) - 1) * 100),
    max_drawdown_percent: round(maxDrawdown),
    closed_trade_count: closedTrades,
    fill_count: fillCount,
    total_fees: round(totalFees),
    total_carry: round(totalCarry),
    turnover_notional: round(turnoverNotional),
    total_slippage: round(totalSlippage),
  };
}

function dmiAdxSeries(rows, period) {
  const output = Array(rows.length).fill(null);
  if (rows.length < period * 2) return output;
  const trueRanges = Array(rows.length).fill(0);
  const plusDm = Array(rows.length).fill(0);
  const minusDm = Array(rows.length).fill(0);
  for (let index = 1; index < rows.length; index += 1) {
    const current = rows[index];
    const previous = rows[index - 1];
    const upMove = current.high - previous.high;
    const downMove = previous.low - current.low;
    plusDm[index] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDm[index] = downMove > upMove && downMove > 0 ? downMove : 0;
    trueRanges[index] = Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close),
    );
  }

  let smoothedTr = 0;
  let smoothedPlus = 0;
  let smoothedMinus = 0;
  for (let index = 1; index <= period; index += 1) {
    smoothedTr += trueRanges[index];
    smoothedPlus += plusDm[index];
    smoothedMinus += minusDm[index];
  }
  const dx = Array(rows.length).fill(null);
  const plusDi = Array(rows.length).fill(null);
  const minusDi = Array(rows.length).fill(null);
  const assignDirectional = (index) => {
    const positive = smoothedTr > 0 ? (100 * smoothedPlus) / smoothedTr : 0;
    const negative = smoothedTr > 0 ? (100 * smoothedMinus) / smoothedTr : 0;
    plusDi[index] = positive;
    minusDi[index] = negative;
    const denominator = positive + negative;
    dx[index] = denominator > 0 ? (100 * Math.abs(positive - negative)) / denominator : 0;
  };
  assignDirectional(period);
  for (let index = period + 1; index < rows.length; index += 1) {
    smoothedTr = smoothedTr - (smoothedTr / period) + trueRanges[index];
    smoothedPlus = smoothedPlus - (smoothedPlus / period) + plusDm[index];
    smoothedMinus = smoothedMinus - (smoothedMinus / period) + minusDm[index];
    assignDirectional(index);
  }

  const firstAdxIndex = period * 2 - 1;
  let adx = mean(dx.slice(period, firstAdxIndex + 1));
  output[firstAdxIndex] = { adx, plus_di: plusDi[firstAdxIndex], minus_di: minusDi[firstAdxIndex] };
  for (let index = firstAdxIndex + 1; index < rows.length; index += 1) {
    adx = ((adx * (period - 1)) + dx[index]) / period;
    output[index] = { adx, plus_di: plusDi[index], minus_di: minusDi[index] };
  }
  return output;
}

function averageTrueRangeBeforeSignal(rows, executionIndex, period) {
  let total = 0;
  for (let index = executionIndex - period - 1; index <= executionIndex - 2; index += 1) {
    const row = rows[index];
    const priorClose = rows[index - 1].close;
    total += Math.max(
      row.high - row.low,
      Math.abs(row.high - priorClose),
      Math.abs(row.low - priorClose),
    );
  }
  return total / period;
}

function emaSeries(values, period) {
  const output = Array(values.length).fill(null);
  if (values.length < period) return output;
  const alpha = 2 / (period + 1);
  let value = mean(values.slice(0, period));
  output[period - 1] = value;
  for (let index = period; index < values.length; index += 1) {
    value = alpha * values[index] + (1 - alpha) * value;
    output[index] = value;
  }
  return output;
}

function rsiSeries(values, period) {
  const output = Array(values.length).fill(null);
  if (values.length <= period) return output;
  let gains = 0;
  let losses = 0;
  for (let index = 1; index <= period; index += 1) {
    const change = values[index] - values[index - 1];
    gains += Math.max(change, 0);
    losses += Math.max(-change, 0);
  }
  let averageGain = gains / period;
  let averageLoss = losses / period;
  output[period] = averageLoss === 0 ? 100 : 100 - (100 / (1 + averageGain / averageLoss));
  for (let index = period + 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    averageGain = ((averageGain * (period - 1)) + Math.max(change, 0)) / period;
    averageLoss = ((averageLoss * (period - 1)) + Math.max(-change, 0)) / period;
    output[index] = averageLoss === 0 ? 100 : 100 - (100 / (1 + averageGain / averageLoss));
  }
  return output;
}

function normalizeCandles(rows) {
  return rows.map((row) => ({
    closed_at: iso(row.closed_at, "closed_at"),
    open: positive(row.open, "open"),
    high: positive(row.high, "high"),
    low: positive(row.low, "low"),
    close: positive(row.close, "close"),
    volume: nonNegative(row.volume || 0, "volume"),
  })).sort((a, b) => a.closed_at.localeCompare(b.closed_at));
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values) {
  const center = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - center) ** 2)));
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

function clamp(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error("invalid_directional_target_exposure");
  return Math.max(-1, Math.min(1, number));
}

function round(value) {
  return Number(Number(value).toFixed(10));
}
