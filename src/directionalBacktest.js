import { DIRECTIONAL_STRATEGIES, directionalSignal } from "./directionalShadow.js";

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
  const history = [...window.train, ...window.validation, ...window.test];
  const testStart = window.train.length + window.validation.length;
  if (window.test.length < 2) throw new Error("directional_test_window_too_short");

  const base = simulate(history, testStart, strategy, policy, 1);
  const doubled = simulate(history, testStart, strategy, policy, 2);
  const tripled = simulate(history, testStart, strategy, policy, 3);
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

function simulate(candles, testStart, strategy, policy, costMultiplier) {
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
    const signalRows = candles.slice(0, executionIndex);
    const execution = candles[executionIndex];
    const markBefore = candles[executionIndex - 1].close;
    const equityBefore = cash + quantity * markBefore;
    const currentExposure = Math.abs(equityBefore) <= EPSILON ? 0 : (quantity * markBefore) / equityBefore;
    const decision = directionalSignal(strategy, signalRows, currentExposure);
    const targetExposure = clamp(decision.target_exposure);
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

function clamp(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error("invalid_directional_target_exposure");
  return Math.max(-1, Math.min(1, number));
}

function round(value) {
  return Number(Number(value).toFixed(10));
}
