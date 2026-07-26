from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .hashing import stable_hash, stable_json


ALLOWED_MARKETS = {"BTC-USD", "ETH-USD"}
ALLOWED_OPERATORS = {"<", "<=", ">", ">=", "=="}
ALLOWED_TOP_LEVEL = {
    "schema",
    "strategy_id",
    "version",
    "parent_strategy_id",
    "parent_version",
    "market",
    "execution_timeframe",
    "direction",
    "entry",
    "exit",
    "position_size_percent",
}
FORBIDDEN_TOP_LEVEL = {
    "code",
    "python",
    "fees",
    "fee",
    "slippage",
    "judge",
    "judge_config",
    "dataset",
    "datasets",
    "success_threshold",
    "success_criteria",
    "leverage",
}
SUPPORTED_INDICATORS = {"ema_cross", "ema_cross_down", "rsi", "price_change_percent"}


class StrategySpecError(ValueError):
    pass


@dataclass(frozen=True)
class StrategySpec:
    raw: dict[str, Any]
    strategy_id: str
    version: int
    parent_strategy_id: str | None
    parent_version: int | None
    market: str
    execution_timeframe: str
    direction: str
    entry: dict[str, Any]
    exit: dict[str, Any]
    position_size_percent: float
    spec_hash: str

    def normalized_json(self) -> str:
        return stable_json(self.raw)


def validate_strategy_spec(raw_spec: dict[str, Any]) -> StrategySpec:
    if not isinstance(raw_spec, dict):
        raise StrategySpecError("strategy spec must be an object")
    unknown = set(raw_spec) - ALLOWED_TOP_LEVEL
    forbidden = set(raw_spec) & FORBIDDEN_TOP_LEVEL
    if unknown:
        raise StrategySpecError(f"unknown fields: {sorted(unknown)}")
    if forbidden:
        raise StrategySpecError(f"forbidden fields: {sorted(forbidden)}")
    if raw_spec.get("schema") != "strategy_spec_v1":
        raise StrategySpecError("schema must be strategy_spec_v1")
    strategy_id = _required_str(raw_spec, "strategy_id")
    version = _required_int(raw_spec, "version", min_value=1)
    parent_strategy_id = raw_spec.get("parent_strategy_id")
    if parent_strategy_id is not None and not isinstance(parent_strategy_id, str):
        raise StrategySpecError("parent_strategy_id must be string or null")
    parent_version = raw_spec.get("parent_version")
    if parent_version is not None:
        parent_version = _int_value(parent_version, "parent_version", min_value=1)
    market = _required_str(raw_spec, "market")
    if market not in ALLOWED_MARKETS:
        raise StrategySpecError("market must be BTC-USD or ETH-USD")
    timeframe = _required_str(raw_spec, "execution_timeframe")
    if timeframe != "1h":
        raise StrategySpecError("execution_timeframe must be 1h")
    direction = _required_str(raw_spec, "direction")
    if direction not in {"long", "cash"}:
        raise StrategySpecError("direction must be long or cash")
    position_size = _number(raw_spec.get("position_size_percent"), "position_size_percent")
    if position_size <= 0 or position_size > 100:
        raise StrategySpecError("position_size_percent must be > 0 and <= 100")
    entry = _condition_group(raw_spec.get("entry"), "entry")
    exit_rule = _condition_group(raw_spec.get("exit"), "exit")
    normalized = {
        "schema": "strategy_spec_v1",
        "strategy_id": strategy_id,
        "version": version,
        "parent_strategy_id": parent_strategy_id,
        "parent_version": parent_version,
        "market": market,
        "execution_timeframe": timeframe,
        "direction": direction,
        "entry": entry,
        "exit": exit_rule,
        "position_size_percent": position_size,
    }
    return StrategySpec(
        raw=normalized,
        strategy_id=strategy_id,
        version=version,
        parent_strategy_id=parent_strategy_id,
        parent_version=parent_version,
        market=market,
        execution_timeframe=timeframe,
        direction=direction,
        entry=entry,
        exit=exit_rule,
        position_size_percent=position_size,
        spec_hash=stable_hash(normalized),
    )


def _condition_group(value: Any, field: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise StrategySpecError(f"{field} must be an object")
    keys = set(value)
    if keys not in ({"all"}, {"any"}):
        raise StrategySpecError(f"{field} must contain exactly one of all or any")
    mode = "all" if "all" in value else "any"
    conditions = value[mode]
    if not isinstance(conditions, list) or not conditions:
        raise StrategySpecError(f"{field}.{mode} must be a non-empty list")
    return {mode: [_condition(item, f"{field}.{mode}") for item in conditions]}


def _condition(value: Any, field: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise StrategySpecError(f"{field} condition must be an object")
    indicator = value.get("indicator")
    if indicator not in SUPPORTED_INDICATORS:
        raise StrategySpecError(f"unsupported indicator: {indicator}")
    allowed = {"indicator"}
    if indicator in {"ema_cross", "ema_cross_down"}:
        allowed |= {"fast", "slow"}
        unknown = set(value) - allowed
        if unknown:
            raise StrategySpecError(f"unknown condition fields: {sorted(unknown)}")
        fast = _int_value(value.get("fast"), "fast", 2, 200)
        slow = _int_value(value.get("slow"), "slow", 3, 400)
        if fast >= slow:
            raise StrategySpecError("ema fast must be less than slow")
        return {"indicator": indicator, "fast": fast, "slow": slow}
    if indicator == "rsi":
        allowed |= {"period", "operator", "value"}
        unknown = set(value) - allowed
        if unknown:
            raise StrategySpecError(f"unknown condition fields: {sorted(unknown)}")
        period = _int_value(value.get("period", 14), "period", 2, 100)
        operator = _operator(value.get("operator"))
        threshold = _number(value.get("value"), "value")
        if threshold < 0 or threshold > 100:
            raise StrategySpecError("rsi value must be between 0 and 100")
        return {"indicator": indicator, "period": period, "operator": operator, "value": threshold}
    if indicator == "price_change_percent":
        allowed |= {"lookback", "operator", "value"}
        unknown = set(value) - allowed
        if unknown:
            raise StrategySpecError(f"unknown condition fields: {sorted(unknown)}")
        lookback = _int_value(value.get("lookback"), "lookback", 1, 500)
        operator = _operator(value.get("operator"))
        threshold = _number(value.get("value"), "value")
        if threshold < -100 or threshold > 100:
            raise StrategySpecError("price_change_percent value must be between -100 and 100")
        return {"indicator": indicator, "lookback": lookback, "operator": operator, "value": threshold}
    raise StrategySpecError(f"unsupported indicator: {indicator}")


def _required_str(raw: dict[str, Any], field: str) -> str:
    value = raw.get(field)
    if not isinstance(value, str) or not value:
        raise StrategySpecError(f"{field} must be a non-empty string")
    return value


def _required_int(raw: dict[str, Any], field: str, min_value: int) -> int:
    return _int_value(raw.get(field), field, min_value=min_value)


def _int_value(value: Any, field: str, min_value: int, max_value: int | None = None) -> int:
    if not isinstance(value, int) or isinstance(value, bool):
        raise StrategySpecError(f"{field} must be an integer")
    if value < min_value:
        raise StrategySpecError(f"{field} must be >= {min_value}")
    if max_value is not None and value > max_value:
        raise StrategySpecError(f"{field} must be <= {max_value}")
    return value


def _number(value: Any, field: str) -> float:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise StrategySpecError(f"{field} must be numeric")
    return float(value)


def _operator(value: Any) -> str:
    if value not in ALLOWED_OPERATORS:
        raise StrategySpecError("unsupported operator")
    return str(value)
