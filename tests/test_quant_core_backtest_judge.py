from __future__ import annotations

import pytest

from quant_core.backtest import ExecutionConfig, run_backtest
from quant_core.hashing import stable_json
from quant_core.indicators import Candle
from quant_core.judge import JudgeConfig, benchmark_returns, chronological_partitions, evaluate_strategy
from quant_core.strategy_spec import validate_strategy_spec


def test_incomplete_candles_cannot_enter_backtest() -> None:
    candles = sample_candles()
    candles[2] = Candle(**{**candles[2].__dict__, "complete": False})
    spec = validate_strategy_spec(momentum_spec())

    with pytest.raises(ValueError, match="incomplete"):
        run_backtest(candles, spec, ExecutionConfig(), "judge")


def test_signal_cannot_fill_on_same_candle_that_generated_it() -> None:
    spec = validate_strategy_spec(momentum_spec())
    result = run_backtest(sample_candles(), spec, ExecutionConfig(fee_bps_per_side=0, slippage_bps_per_side=0), "judge")

    assert result.orders
    first_order = result.orders[0]
    assert first_order.signal_candle_close_time == "2026-01-01T02:00:00Z"
    assert first_order.requested_candle_open_time == "2026-01-01T02:00:00Z"
    assert first_order.requested_candle_open_time != "2026-01-01T01:00:00Z"
    assert result.fills[0].candle_open_time == "2026-01-01T02:00:00Z"


def test_fees_and_slippage_affect_cash_and_returns() -> None:
    spec = validate_strategy_spec(momentum_spec(position_size_percent=100))
    free = run_backtest(sample_candles(), spec, ExecutionConfig(fee_bps_per_side=0, slippage_bps_per_side=0), "judge")
    costly = run_backtest(sample_candles(), spec, ExecutionConfig(fee_bps_per_side=10, slippage_bps_per_side=10), "judge")

    assert costly.metrics["fee_total"] > 0
    assert costly.metrics["slippage_total"] > 0
    assert costly.equity_curve[-1].equity < free.equity_curve[-1].equity
    assert costly.metrics["total_return"] < free.metrics["total_return"]


def test_orders_and_fills_are_unique_and_replay_identically() -> None:
    spec = validate_strategy_spec(momentum_spec())
    config = ExecutionConfig()
    first = run_backtest(sample_candles(), spec, config, "judge")
    second = run_backtest(sample_candles(), spec, config, "judge")

    assert len({order.order_id for order in first.orders}) == len(first.orders)
    assert len({fill.fill_id for fill in first.fills}) == len(first.fills)
    assert first.result_hash == second.result_hash
    assert stable_json(first.normalized()) == stable_json(second.normalized())


def test_cash_cannot_become_negative_and_sizing_obeys_limit() -> None:
    spec = validate_strategy_spec(momentum_spec(position_size_percent=100))
    result = run_backtest(sample_candles(), spec, ExecutionConfig(initial_cash=1000, fee_bps_per_side=100, slippage_bps_per_side=50), "judge")
    first_fill = result.fills[0]

    assert all(point.cash >= 0 for point in result.equity_curve)
    assert first_fill.notional + first_fill.fee <= 1000


def test_train_validation_test_partitions_are_chronological_and_non_overlapping() -> None:
    partitions = chronological_partitions(sample_candles(), JudgeConfig(train_fraction=0.5, validation_fraction=0.25))

    assert [partition.name for partition in partitions] == ["train", "validation", "test"]
    assert partitions[0].end_close_time < partitions[1].start_close_time
    assert partitions[1].end_close_time < partitions[2].start_close_time
    assert sum(partition.candle_count for partition in partitions) == len(sample_candles())


def test_benchmarks_are_correct_with_zero_costs() -> None:
    judge = JudgeConfig(fee_bps_per_side=0, slippage_bps_per_side=0)
    benchmarks = benchmark_returns(sample_candles(), judge)

    assert benchmarks.cash_total_return == 0
    assert benchmarks.buy_and_hold_total_return == pytest.approx((110 - 100) / 100)
    assert benchmarks.buy_and_hold_fee_total == 0
    assert benchmarks.buy_and_hold_slippage_total == 0


def test_judge_evidence_identifies_strategy_data_and_judge_hashes() -> None:
    spec = validate_strategy_spec(momentum_spec(parent_strategy_id="seed", parent_version=1))
    judge = JudgeConfig()

    evidence = evaluate_strategy(sample_candles(), spec, judge)
    replay = evaluate_strategy(sample_candles(), spec, judge)

    assert evidence.strategy_id == "momentum"
    assert evidence.parent_strategy_id == "seed"
    assert evidence.strategy_hash == spec.spec_hash
    assert evidence.judge_hash == judge.config_hash
    assert len(evidence.dataset_hash) == 64
    assert len(evidence.backtest_result_hash) == 64
    assert evidence.evidence_hash == replay.evidence_hash


def sample_candles() -> list[Candle]:
    prices = [
        (100, 101),
        (101, 103),
        (103, 106),
        (106, 108),
        (108, 106),
        (106, 104),
        (104, 107),
        (107, 110),
    ]
    return [
        Candle(
            market="BTC-USD",
            open_time=f"2026-01-01T{hour:02d}:00:00Z",
            close_time=f"2026-01-01T{hour + 1:02d}:00:00Z",
            open=float(open_price),
            high=float(max(open_price, close_price) + 1),
            low=float(min(open_price, close_price) - 1),
            close=float(close_price),
            volume=1000.0 + hour,
            complete=True,
        )
        for hour, (open_price, close_price) in enumerate(prices)
    ]


def momentum_spec(**overrides):
    raw = {
        "schema": "strategy_spec_v1",
        "strategy_id": "momentum",
        "version": 1,
        "parent_strategy_id": None,
        "parent_version": None,
        "market": "BTC-USD",
        "execution_timeframe": "1h",
        "direction": "long",
        "entry": {"all": [{"indicator": "price_change_percent", "lookback": 1, "operator": ">", "value": 1.0}]},
        "exit": {"any": [{"indicator": "price_change_percent", "lookback": 1, "operator": "<", "value": -1.0}]},
        "position_size_percent": 50,
    }
    raw.update(overrides)
    return raw
