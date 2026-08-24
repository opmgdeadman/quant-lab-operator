const MARKET = "BTC-USD";
const INTERVAL = "1h";
export const POSITION_HOLD_WALK_FORWARD_POLICY_ID = "directional-position-hold-v2";

export const INSTITUTIONAL_RESEARCH_SPEC_POLICY = deepFreeze({
  id: "institutional-research-spec-v2",
  version: 2,
  dataset: {
    id: "btc-usd-1h-completed-4320-v1",
    market: MARKET,
    interval: INTERVAL,
    completed_candles_only: true,
    required_contiguous_candles: 4320,
  },
  walk_forward: {
    id: "institutional-walk-forward-v1",
    train_candles: 1440,
    validation_candles: 480,
    test_candles: 480,
    step_candles: 480,
    minimum_windows: 5,
  },
  cost_model: {
    id: "institutional-cost-model-v1",
    fee_bps: 10,
    slippage_bps: 5,
    short_carry_bps_per_day: 3,
    stress_multipliers: [1, 2, 3],
    execution: "next_completed_candle_open",
  },
  judge_policy_id: "institutional-independent-judge-v1",
  evidence_integrity: {
    completed_candles_only: true,
    gap_free_required: true,
    no_look_ahead: true,
    same_candle_signal_and_fill_allowed: false,
    immutable_artifacts: true,
    caller_supplied_performance_metrics_allowed: false,
  },
});

export const INSTITUTIONAL_STRATEGY_TEMPLATES = deepFreeze({
  ema_trend: {
    family: "ema_trend",
    feature_set_id: "close-ema-v1",
    parameters: {
      fast: integerRule(2, 100),
      slow: integerRule(5, 300),
    },
    cross_validate(parameters) {
      if (parameters.fast >= parameters.slow) throw new Error("institutional_spec_ema_fast_must_be_below_slow");
    },
  },
  ema_pullback_trend: {
    family: "ema_pullback_trend",
    feature_set_id: "close-ema-pullback-v1",
    parameters: {
      fast: integerRule(2, 100),
      slow: integerRule(5, 300),
      threshold_percent: numberRule(0.05, 10),
    },
    cross_validate(parameters) {
      if (parameters.fast >= parameters.slow) throw new Error("institutional_spec_ema_pullback_fast_must_be_below_slow");
    },
  },
  close_location_pressure: {
    family: "close_location_pressure",
    feature_set_id: "ohlc-close-location-pressure-v1",
    parameters: {
      period: integerRule(2, 120),
      pressure_threshold: numberRule(0.05, 0.95),
    },
  },
  wick_rejection_reversal: {
    family: "wick_rejection_reversal",
    feature_set_id: "ohlc-wick-rejection-v1",
    parameters: {
      period: integerRule(2, 120),
      wick_ratio_threshold: numberRule(1, 10),
    },
  },
  return_autocorrelation_state: {
    family: "return_autocorrelation_state",
    feature_set_id: "close-return-autocorrelation-v1",
    parameters: {
      period: integerRule(12, 240),
      autocorr_threshold: numberRule(0.01, 0.95),
    },
  },
  return_semivariance_imbalance: {
    family: "return_semivariance_imbalance",
    feature_set_id: "close-return-semivariance-imbalance-v1",
    parameters: {
      period: integerRule(12, 240),
      imbalance_threshold: numberRule(0.51, 0.95),
    },
  },
  return_sign_transition_state: {
    family: "return_sign_transition_state",
    feature_set_id: "close-return-sign-transition-v1",
    parameters: {
      period: integerRule(12, 240),
      persistence_threshold: numberRule(0.51, 0.95),
    },
  },
  return_skew_state: {
    family: "return_skew_state",
    feature_set_id: "close-return-skew-v1",
    parameters: {
      period: integerRule(12, 240),
      skew_threshold: numberRule(0.05, 5),
    },
  },
  hour_of_week_drift: {
    family: "hour_of_week_drift",
    feature_set_id: "time-hour-of-week-drift-v1",
    parameters: {
      lookback_weeks: integerRule(4, 24),
      mean_return_threshold_bps: numberRule(0.1, 100),
    },
  },
  inside_bar_breakout: {
    family: "inside_bar_breakout",
    feature_set_id: "ohlc-inside-bar-v1",
    parameters: {
      max_inside_range_ratio: numberRule(0.25, 1),
    },
  },
  engulfing_reversal: {
    family: "engulfing_reversal",
    feature_set_id: "ohlc-engulfing-reversal-v1",
    parameters: {
      min_body_ratio: numberRule(1, 4),
    },
  },
  efficiency_ratio_trend: {
    family: "efficiency_ratio_trend",
    feature_set_id: "close-efficiency-ratio-v1",
    parameters: {
      period: integerRule(4, 240),
      efficiency_threshold: numberRule(0.05, 1),
    },
  },
  linear_trend_residual_reversion: {
    family: "linear_trend_residual_reversion",
    feature_set_id: "close-linear-trend-residual-v1",
    parameters: {
      period: integerRule(12, 120),
      threshold_percent: numberRule(0.25, 10),
    },
  },
  rolling_median_reversion: {
    family: "rolling_median_reversion",
    feature_set_id: "close-rolling-median-deviation-v1",
    parameters: {
      period: integerRule(12, 240),
      threshold_percent: numberRule(0.25, 10),
    },
  },
  body_streak_reversal: {
    family: "body_streak_reversal",
    feature_set_id: "ohlc-body-streak-reversal-v1",
    parameters: {
      streak_length: integerRule(2, 12),
      min_body_fraction: numberRule(0.05, 0.95),
    },
  },
  donchian_breakout: {
    family: "donchian_breakout",
    feature_set_id: "ohlc-donchian-v1",
    parameters: { lookback: integerRule(5, 240) },
  },
  donchian_regime_breakout: {
    family: "donchian_regime_breakout",
    feature_set_id: "ohlc-donchian-regime-v1",
    parameters: {
      lookback: integerRule(5, 240),
      regime_lookback: integerRule(24, 240),
    },
    cross_validate(parameters) {
      if (parameters.lookback >= parameters.regime_lookback) throw new Error("institutional_spec_donchian_regime_lookback_order_invalid");
    },
  },
  donchian_compression_breakout: {
    family: "donchian_compression_breakout",
    feature_set_id: "ohlc-donchian-compression-v1",
    parameters: {
      lookback: integerRule(5, 240),
      compression_period: integerRule(2, 120),
      baseline_period: integerRule(24, 240),
    },
    cross_validate(parameters) {
      if (!(parameters.compression_period < parameters.lookback && parameters.lookback < parameters.baseline_period)) {
        throw new Error("institutional_spec_donchian_compression_period_order_invalid");
      }
    },
  },
  dmi_adx_trend: {
    family: "dmi_adx_trend",
    feature_set_id: "ohlc-dmi-adx-v1",
    parameters: {
      period: integerRule(5, 60),
      adx_threshold: numberRule(10, 60),
    },
  },
  price_momentum: {
    family: "price_momentum",
    feature_set_id: "close-momentum-v1",
    parameters: {
      lookback: integerRule(2, 240),
      threshold_percent: numberRule(0.05, 10),
    },
  },
  regime_momentum: {
    family: "regime_momentum",
    feature_set_id: "close-regime-momentum-v1",
    parameters: {
      lookback: integerRule(2, 120),
      regime_lookback: integerRule(24, 240),
      threshold_percent: numberRule(0.05, 10),
    },
    cross_validate(parameters) {
      if (parameters.lookback >= parameters.regime_lookback) throw new Error("institutional_spec_regime_momentum_lookback_order_invalid");
    },
  },
  volatility_shock_reversal: {
    family: "volatility_shock_reversal",
    feature_set_id: "ohlc-true-range-shock-reversal-v1",
    parameters: {
      period: integerRule(12, 120),
      multiplier: numberRule(1.25, 5),
    },
  },
  volatility_breakout: {
    family: "volatility_breakout",
    feature_set_id: "ohlc-true-range-v1",
    parameters: {
      period: integerRule(2, 120),
      multiplier: numberRule(0.25, 5),
    },
  },
  volatility_regime_breakout: {
    family: "volatility_regime_breakout",
    feature_set_id: "ohlc-true-range-regime-v1",
    parameters: {
      period: integerRule(2, 120),
      regime_period: integerRule(24, 240),
      multiplier: numberRule(0.25, 5),
    },
    cross_validate(parameters) {
      if (parameters.period >= parameters.regime_period) throw new Error("institutional_spec_volatility_regime_period_order_invalid");
    },
  },
  rsi_mean_reversion: {
    family: "rsi_mean_reversion",
    feature_set_id: "close-rsi-v1",
    parameters: {
      period: integerRule(2, 100),
      lower: numberRule(5, 45),
      upper: numberRule(55, 95),
      exit_lower: numberRule(20, 55),
      exit_upper: numberRule(45, 80),
    },
    cross_validate(parameters) {
      if (!(parameters.lower < parameters.exit_lower && parameters.exit_lower < parameters.exit_upper && parameters.exit_upper < parameters.upper)) {
        throw new Error("institutional_spec_rsi_threshold_order_invalid");
      }
    },
  },
  bollinger_mean_reversion: {
    family: "bollinger_mean_reversion",
    feature_set_id: "close-bollinger-v1",
    parameters: {
      period: integerRule(5, 240),
      deviations: numberRule(0.5, 5),
    },
  },
});

export function validateInstitutionalResearchSpec(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("institutional_research_spec_object_required");
  assertExactKeys(value, ["spec_version", "dataset_id", "strategy", "walk_forward_policy_id", "cost_model_id", "judge_policy_id", "evidence_integrity_policy_id"], "research_spec");
  if (value.spec_version !== INSTITUTIONAL_RESEARCH_SPEC_POLICY.version) throw new Error("institutional_research_spec_version_not_supported");
  if (value.dataset_id !== INSTITUTIONAL_RESEARCH_SPEC_POLICY.dataset.id) throw new Error("institutional_research_spec_dataset_not_allowed");
  if (![INSTITUTIONAL_RESEARCH_SPEC_POLICY.walk_forward.id, POSITION_HOLD_WALK_FORWARD_POLICY_ID].includes(value.walk_forward_policy_id)) throw new Error("institutional_research_spec_walk_forward_not_allowed");
  if (value.cost_model_id !== INSTITUTIONAL_RESEARCH_SPEC_POLICY.cost_model.id) throw new Error("institutional_research_spec_cost_model_not_allowed");
  if (value.judge_policy_id !== INSTITUTIONAL_RESEARCH_SPEC_POLICY.judge_policy_id) throw new Error("institutional_research_spec_judge_not_allowed");
  if (value.evidence_integrity_policy_id !== "institutional-evidence-integrity-v1") throw new Error("institutional_research_spec_integrity_policy_not_allowed");
  const strategy = validateStrategy(value.strategy);
  return deepFreeze({
    spec_version: value.spec_version,
    dataset_id: value.dataset_id,
    strategy,
    walk_forward_policy_id: value.walk_forward_policy_id,
    cost_model_id: value.cost_model_id,
    judge_policy_id: value.judge_policy_id,
    evidence_integrity_policy_id: value.evidence_integrity_policy_id,
  });
}

export function buildStrategyFromResearchSpec(hypothesisId, spec) {
  const validated = validateInstitutionalResearchSpec(spec);
  return deepFreeze({
    id: cleanId(hypothesisId),
    family: validated.strategy.template,
    parameters: validated.strategy.parameters,
  });
}

export function buildInstitutionalBacktestPolicy(walkForwardPolicyId = INSTITUTIONAL_RESEARCH_SPEC_POLICY.walk_forward.id) {
  const policy = INSTITUTIONAL_RESEARCH_SPEC_POLICY;
  if (![policy.walk_forward.id, POSITION_HOLD_WALK_FORWARD_POLICY_ID].includes(walkForwardPolicyId)) throw new Error("institutional_research_spec_walk_forward_not_allowed");
  return deepFreeze({
    id: walkForwardPolicyId,
    required_candles: policy.dataset.required_contiguous_candles,
    train_candles: policy.walk_forward.train_candles,
    validation_candles: policy.walk_forward.validation_candles,
    test_candles: policy.walk_forward.test_candles,
    step_candles: policy.walk_forward.step_candles,
    minimum_windows: policy.walk_forward.minimum_windows,
    base_fee_bps: policy.cost_model.fee_bps,
    base_slippage_bps: policy.cost_model.slippage_bps,
    short_carry_bps_per_day: policy.cost_model.short_carry_bps_per_day,
    cost_stress_multipliers: policy.cost_model.stress_multipliers,
  });
}

function validateStrategy(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("institutional_research_strategy_object_required");
  assertExactKeys(value, ["template", "feature_set_id", "parameters"], "strategy");
  const template = INSTITUTIONAL_STRATEGY_TEMPLATES[value.template];
  if (!template) throw new Error("institutional_research_strategy_template_not_allowed");
  if (value.feature_set_id !== template.feature_set_id) throw new Error("institutional_research_feature_set_not_allowed");
  if (!value.parameters || typeof value.parameters !== "object" || Array.isArray(value.parameters)) throw new Error("institutional_research_parameters_object_required");
  assertExactKeys(value.parameters, Object.keys(template.parameters), "strategy_parameters");
  const parameters = {};
  for (const [name, rule] of Object.entries(template.parameters)) parameters[name] = validateParameter(name, value.parameters[name], rule);
  template.cross_validate?.(parameters);
  return deepFreeze({ template: value.template, feature_set_id: value.feature_set_id, parameters });
}

function validateParameter(name, raw, rule) {
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`institutional_research_parameter_${name}_invalid`);
  if (rule.integer && !Number.isInteger(value)) throw new Error(`institutional_research_parameter_${name}_integer_required`);
  if (value < rule.minimum || value > rule.maximum) throw new Error(`institutional_research_parameter_${name}_out_of_bounds`);
  return value;
}

function assertExactKeys(value, allowed, label) {
  const keys = Object.keys(value).sort();
  const expected = [...allowed].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) throw new Error(`institutional_${label}_shape_invalid`);
}

function cleanId(value) {
  const text = String(value || "");
  if (!/^[a-z0-9][a-z0-9-]{2,99}$/.test(text)) throw new Error("institutional_hypothesis_id_invalid");
  return text;
}

function integerRule(minimum, maximum) { return Object.freeze({ integer: true, minimum, maximum }); }
function numberRule(minimum, maximum) { return Object.freeze({ integer: false, minimum, maximum }); }

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
