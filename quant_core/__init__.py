"""Deterministic quantitative core for the future public runner package."""

from .backtest import BacktestResult, run_backtest
from .judge import JudgeConfig, JudgeEvidence, evaluate_strategy
from .strategy_spec import StrategySpec, StrategySpecError, validate_strategy_spec

__all__ = [
    "BacktestResult",
    "JudgeConfig",
    "JudgeEvidence",
    "StrategySpec",
    "StrategySpecError",
    "evaluate_strategy",
    "run_backtest",
    "validate_strategy_spec",
]
