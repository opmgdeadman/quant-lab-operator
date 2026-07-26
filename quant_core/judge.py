from __future__ import annotations

from dataclasses import dataclass

from .backtest import BacktestResult, ExecutionConfig, run_backtest
from .hashing import stable_hash
from .indicators import Candle
from .strategy_spec import StrategySpec


@dataclass(frozen=True)
class JudgeConfig:
    version: str = "judge_v1"
    initial_cash: float = 10000.0
    fee_bps_per_side: float = 10.0
    slippage_bps_per_side: float = 5.0
    train_fraction: float = 0.5
    validation_fraction: float = 0.25

    def validate(self) -> None:
        if self.version != "judge_v1":
            raise ValueError("unsupported judge version")
        if self.initial_cash <= 0:
            raise ValueError("initial_cash must be positive")
        if self.fee_bps_per_side < 0 or self.slippage_bps_per_side < 0:
            raise ValueError("fees and slippage must be non-negative")
        if self.train_fraction <= 0 or self.validation_fraction <= 0:
            raise ValueError("partitions must be positive")
        if self.train_fraction + self.validation_fraction >= 1:
            raise ValueError("train plus validation must leave untouched test data")

    @property
    def config_hash(self) -> str:
        return stable_hash(self)

    @property
    def execution(self) -> ExecutionConfig:
        return ExecutionConfig(self.initial_cash, self.fee_bps_per_side, self.slippage_bps_per_side)


@dataclass(frozen=True)
class Partition:
    name: str
    start_close_time: str
    end_close_time: str
    candle_count: int


@dataclass(frozen=True)
class Benchmarks:
    cash_total_return: float
    buy_and_hold_total_return: float
    buy_and_hold_fee_total: float
    buy_and_hold_slippage_total: float


@dataclass(frozen=True)
class JudgeEvidence:
    strategy_id: str
    strategy_version: int
    parent_strategy_id: str | None
    parent_version: int | None
    strategy_hash: str
    dataset_hash: str
    judge_hash: str
    partitions: list[Partition]
    metrics: dict[str, float]
    benchmarks: Benchmarks
    backtest_result_hash: str
    evidence_hash: str


def evaluate_strategy(candles: list[Candle], spec: StrategySpec, judge: JudgeConfig) -> JudgeEvidence:
    judge.validate()
    partitions = chronological_partitions(candles, judge)
    result = run_backtest(candles, spec, judge.execution, judge.config_hash)
    benchmarks = benchmark_returns(candles, judge)
    evidence_without_hash = {
        "strategy_id": spec.strategy_id,
        "strategy_version": spec.version,
        "parent_strategy_id": spec.parent_strategy_id,
        "parent_version": spec.parent_version,
        "strategy_hash": spec.spec_hash,
        "dataset_hash": result.dataset_hash,
        "judge_hash": judge.config_hash,
        "partitions": partitions,
        "metrics": result.metrics,
        "benchmarks": benchmarks,
        "backtest_result_hash": result.result_hash,
    }
    return JudgeEvidence(
        spec.strategy_id,
        spec.version,
        spec.parent_strategy_id,
        spec.parent_version,
        spec.spec_hash,
        result.dataset_hash,
        judge.config_hash,
        partitions,
        result.metrics,
        benchmarks,
        result.result_hash,
        stable_hash(evidence_without_hash),
    )


def chronological_partitions(candles: list[Candle], judge: JudgeConfig) -> list[Partition]:
    judge.validate()
    if len(candles) < 4:
        raise ValueError("at least four candles are required for train/validation/test partitions")
    count = len(candles)
    train_end = max(1, int(count * judge.train_fraction))
    validation_end = max(train_end + 1, int(count * (judge.train_fraction + judge.validation_fraction)))
    if validation_end >= count:
        validation_end = count - 1
    slices = [
        ("train", candles[:train_end]),
        ("validation", candles[train_end:validation_end]),
        ("test", candles[validation_end:]),
    ]
    if any(not part for _, part in slices):
        raise ValueError("partitions must be non-empty")
    return [Partition(name, part[0].close_time, part[-1].close_time, len(part)) for name, part in slices]


def benchmark_returns(candles: list[Candle], judge: JudgeConfig) -> Benchmarks:
    judge.validate()
    if len(candles) < 2:
        raise ValueError("at least two candles are required")
    fee_rate = judge.fee_bps_per_side / 10000
    buy_price = candles[0].open * (1 + judge.slippage_bps_per_side / 10000)
    sell_price = candles[-1].close * (1 - judge.slippage_bps_per_side / 10000)
    buy_notional = judge.initial_cash / (1 + fee_rate)
    buy_fee = buy_notional * fee_rate
    quantity = buy_notional / buy_price
    sell_notional = quantity * sell_price
    sell_fee = sell_notional * fee_rate
    final_cash = sell_notional - sell_fee
    return Benchmarks(
        cash_total_return=0.0,
        buy_and_hold_total_return=(final_cash - judge.initial_cash) / judge.initial_cash,
        buy_and_hold_fee_total=buy_fee + sell_fee,
        buy_and_hold_slippage_total=(buy_price - candles[0].open) * quantity + (candles[-1].close - sell_price) * quantity,
    )
