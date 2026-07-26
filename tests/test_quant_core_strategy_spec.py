from __future__ import annotations

import pytest

from quant_core.strategy_spec import StrategySpecError, validate_strategy_spec


def test_valid_strategy_spec_records_lineage_and_hash() -> None:
    spec = validate_strategy_spec(valid_spec(parent_strategy_id="parent", parent_version=2))

    assert spec.schema if hasattr(spec, "schema") else "strategy_spec_v1"
    assert spec.strategy_id == "breakout"
    assert spec.parent_strategy_id == "parent"
    assert spec.parent_version == 2
    assert len(spec.spec_hash) == 64


@pytest.mark.parametrize(
    "patch",
    [
        {"market": "SOL-USD"},
        {"execution_timeframe": "5m"},
        {"direction": "short"},
        {"position_size_percent": 0},
        {"position_size_percent": 101},
        {"leverage": 2},
        {"fees": {"bps": 1}},
        {"judge_config": {"fee_bps": 0}},
        {"dataset": "cherry-picked"},
        {"code": "print('no')"},
    ],
)
def test_invalid_strategy_spec_fields_are_rejected(patch) -> None:
    raw = valid_spec()
    raw.update(patch)

    with pytest.raises(StrategySpecError):
        validate_strategy_spec(raw)


def test_unknown_top_level_fields_are_rejected() -> None:
    raw = valid_spec()
    raw["notes"] = "unknown"

    with pytest.raises(StrategySpecError):
        validate_strategy_spec(raw)


def test_unknown_condition_fields_and_indicators_are_rejected() -> None:
    raw = valid_spec()
    raw["entry"] = {"all": [{"indicator": "macd", "fast": 1}]}

    with pytest.raises(StrategySpecError):
        validate_strategy_spec(raw)

    raw = valid_spec()
    raw["entry"] = {"all": [{"indicator": "rsi", "period": 14, "operator": "<", "value": 50, "judge": "hack"}]}

    with pytest.raises(StrategySpecError):
        validate_strategy_spec(raw)


def test_strategy_rules_cannot_modify_judge_settings() -> None:
    raw = valid_spec()
    raw["exit"] = {"any": [{"indicator": "price_change_percent", "lookback": 1, "operator": "<", "value": -2, "fee_bps_per_side": 0}]}

    with pytest.raises(StrategySpecError):
        validate_strategy_spec(raw)


def valid_spec(**overrides):
    raw = {
        "schema": "strategy_spec_v1",
        "strategy_id": "breakout",
        "version": 1,
        "parent_strategy_id": None,
        "parent_version": None,
        "market": "BTC-USD",
        "execution_timeframe": "1h",
        "direction": "long",
        "entry": {"all": [{"indicator": "price_change_percent", "lookback": 1, "operator": ">", "value": 0.5}]},
        "exit": {"any": [{"indicator": "price_change_percent", "lookback": 1, "operator": "<", "value": -0.5}]},
        "position_size_percent": 50,
    }
    raw.update(overrides)
    return raw
