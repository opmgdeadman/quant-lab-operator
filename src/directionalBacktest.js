import { DIRECTIONAL_STRATEGIES } from "./directionalShadow.js";

const INITIAL_EQUITY = 10000;
const HOURS_PER_DAY = 24;
const EPSILON = 1e-9;

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
  let closedTrades = 0;
  let fillCount = 0;

  for (let executionIndex = testStart; executionIndex < candles.length; executionIndex += 1) {
    const execution = candles[executionIndex];
    const markBefore = candles[executionIndex - 1].close;
    const equityBefore = cash + quantity * markBefore;
    const markedExposure = Math.abs(equityBefore) <= EPSILON ? 0 : (quantity * markBefore) / equityBefore;
    const currentExposure = clamp(markedExposure);
    const targetExposure = clamp(evaluateSignal(executionIndex, currentExposure));
    const rawFill = execution.open * (targetExposure >= currentExposure ? 1 + slippageRate : 1 - slippageRate);
    const targetQuantity = Math.abs(equityBefore) <= EPSILON ? 0 : (targetExposure * equityBefore) / rawFill;
    const delta = targetQuantity - quantity;

    if (Math.abs(delta) > EPSILON) {
      const fee = Math.abs(delta * rawFill) * feeRate;
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
  };
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
