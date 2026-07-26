from __future__ import annotations

from dataclasses import dataclass, field
from statistics import pstdev
from typing import Any

from .hashing import stable_hash
from .indicators import Candle, ema, pct_change, rsi
from .strategy_spec import StrategySpec


@dataclass(frozen=True)
class ExecutionConfig:
    initial_cash: float = 10000.0
    fee_bps_per_side: float = 10.0
    slippage_bps_per_side: float = 5.0


@dataclass(frozen=True)
class OrderRecord:
    order_id: str
    market: str
    side: str
    signal_candle_close_time: str
    requested_candle_open_time: str
    quantity: float
    status: str


@dataclass(frozen=True)
class FillRecord:
    fill_id: str
    order_id: str
    market: str
    side: str
    candle_open_time: str
    price: float
    quantity: float
    notional: float
    fee: float
    slippage: float


@dataclass(frozen=True)
class TradeRecord:
    trade_id: str
    entry_fill_id: str
    exit_fill_id: str
    market: str
    entry_time: str
    exit_time: str
    quantity: float
    pnl: float
    pnl_percent: float


@dataclass(frozen=True)
class EquityRecord:
    close_time: str
    cash: float
    position_quantity: float
    close_price: float
    equity: float
    exposure: float


@dataclass(frozen=True)
class BacktestResult:
    strategy_id: str
    strategy_version: int
    strategy_hash: str
    dataset_hash: str
    judge_hash: str
    orders: list[OrderRecord]
    fills: list[FillRecord]
    trades: list[TradeRecord]
    equity_curve: list[EquityRecord]
    metrics: dict[str, float]
    result_hash: str = field(default="")

    def normalized(self) -> dict[str, Any]:
        return {
            "strategy_id": self.strategy_id,
            "strategy_version": self.strategy_version,
            "strategy_hash": self.strategy_hash,
            "dataset_hash": self.dataset_hash,
            "judge_hash": self.judge_hash,
            "orders": self.orders,
            "fills": self.fills,
            "trades": self.trades,
            "equity_curve": self.equity_curve,
            "metrics": self.metrics,
        }


def run_backtest(candles: list[Candle], spec: StrategySpec, execution: ExecutionConfig, judge_hash: str) -> BacktestResult:
    _validate_candles(candles, spec.market)
    dataset_hash = stable_hash(candles)
    cash = execution.initial_cash
    quantity = 0.0
    entry_fill: FillRecord | None = None
    pending_side: str | None = None
    pending_signal_close: str | None = None
    orders: list[OrderRecord] = []
    fills: list[FillRecord] = []
    trades: list[TradeRecord] = []
    equity_curve: list[EquityRecord] = []
    used_order_ids: set[str] = set()
    used_fill_ids: set[str] = set()
    closes: list[float] = []
    returns: list[float] = []

    for index, candle in enumerate(candles):
        if pending_side:
            if pending_side == "buy" and quantity == 0:
                cash, quantity, fill = _buy(candle, cash, spec.position_size_percent, execution, len(fills) + 1, pending_signal_close or "")
                if fill:
                    _append_unique_fill(fill, fills, used_fill_ids)
                    order = OrderRecord(fill.order_id, candle.market, "buy", pending_signal_close or "", candle.open_time, fill.quantity, "filled")
                    _append_unique_order(order, orders, used_order_ids)
                    entry_fill = fill
            elif pending_side == "sell" and quantity > 0:
                cash, exit_fill = _sell(candle, cash, quantity, execution, len(fills) + 1, pending_signal_close or "")
                _append_unique_fill(exit_fill, fills, used_fill_ids)
                order = OrderRecord(exit_fill.order_id, candle.market, "sell", pending_signal_close or "", candle.open_time, exit_fill.quantity, "filled")
                _append_unique_order(order, orders, used_order_ids)
                if entry_fill:
                    trades.append(_trade(entry_fill, exit_fill, len(trades) + 1))
                quantity = 0.0
                entry_fill = None
            pending_side = None
            pending_signal_close = None

        closes.append(candle.close)
        equity = cash + quantity * candle.close
        previous_equity = equity_curve[-1].equity if equity_curve else execution.initial_cash
        returns.append((equity - previous_equity) / previous_equity if previous_equity else 0.0)
        exposure = (quantity * candle.close) / equity if equity else 0.0
        equity_curve.append(EquityRecord(candle.close_time, cash, quantity, candle.close, equity, exposure))

        if index == len(candles) - 1:
            continue
        if quantity == 0 and spec.direction == "long" and _group_matches(spec.entry, closes):
            pending_side = "buy"
            pending_signal_close = candle.close_time
        elif quantity > 0 and _group_matches(spec.exit, closes):
            pending_side = "sell"
            pending_signal_close = candle.close_time

    metrics = _metrics(execution.initial_cash, equity_curve, trades, fills, returns)
    result_without_hash = BacktestResult(
        spec.strategy_id,
        spec.version,
        spec.spec_hash,
        dataset_hash,
        judge_hash,
        orders,
        fills,
        trades,
        equity_curve,
        metrics,
    )
    result_hash = stable_hash(result_without_hash.normalized())
    return BacktestResult(
        spec.strategy_id,
        spec.version,
        spec.spec_hash,
        dataset_hash,
        judge_hash,
        orders,
        fills,
        trades,
        equity_curve,
        metrics,
        result_hash,
    )


def _validate_candles(candles: list[Candle], market: str) -> None:
    if len(candles) < 2:
        raise ValueError("at least two completed candles are required")
    previous_close = ""
    for candle in candles:
        if candle.market != market:
            raise ValueError("candle market does not match strategy")
        if not candle.complete:
            raise ValueError("incomplete candles cannot enter a backtest")
        if candle.open_time < previous_close:
            raise ValueError("candles must be chronological and non-overlapping")
        if candle.open_time >= candle.close_time:
            raise ValueError("candle open_time must be before close_time")
        previous_close = candle.close_time


def _buy(candle: Candle, cash: float, position_size_percent: float, execution: ExecutionConfig, fill_number: int, signal_time: str) -> tuple[float, float, FillRecord | None]:
    budget = cash * (position_size_percent / 100)
    price = candle.open * (1 + execution.slippage_bps_per_side / 10000)
    fee_rate = execution.fee_bps_per_side / 10000
    notional = budget / (1 + fee_rate)
    fee = notional * fee_rate
    if notional <= 0 or notional + fee > cash + 1e-9:
        return cash, 0.0, None
    quantity = notional / price
    new_cash = cash - notional - fee
    if new_cash < -1e-9:
        raise ValueError("cash cannot become negative")
    fill = FillRecord(
        f"fill-{fill_number:06d}",
        f"order-{fill_number:06d}",
        candle.market,
        "buy",
        candle.open_time,
        price,
        quantity,
        notional,
        fee,
        price - candle.open,
    )
    return max(new_cash, 0.0), quantity, fill


def _sell(candle: Candle, cash: float, quantity: float, execution: ExecutionConfig, fill_number: int, signal_time: str) -> tuple[float, FillRecord]:
    price = candle.open * (1 - execution.slippage_bps_per_side / 10000)
    notional = quantity * price
    fee = notional * (execution.fee_bps_per_side / 10000)
    fill = FillRecord(
        f"fill-{fill_number:06d}",
        f"order-{fill_number:06d}",
        candle.market,
        "sell",
        candle.open_time,
        price,
        quantity,
        notional,
        fee,
        candle.open - price,
    )
    return cash + notional - fee, fill


def _append_unique_order(order: OrderRecord, orders: list[OrderRecord], used: set[str]) -> None:
    if order.order_id in used:
        raise ValueError("duplicate order id")
    used.add(order.order_id)
    orders.append(order)


def _append_unique_fill(fill: FillRecord, fills: list[FillRecord], used: set[str]) -> None:
    if fill.fill_id in used:
        raise ValueError("duplicate fill id")
    used.add(fill.fill_id)
    fills.append(fill)


def _trade(entry: FillRecord, exit_fill: FillRecord, trade_number: int) -> TradeRecord:
    pnl = exit_fill.notional - exit_fill.fee - entry.notional - entry.fee
    return TradeRecord(
        f"trade-{trade_number:06d}",
        entry.fill_id,
        exit_fill.fill_id,
        entry.market,
        entry.candle_open_time,
        exit_fill.candle_open_time,
        entry.quantity,
        pnl,
        (pnl / (entry.notional + entry.fee)) * 100 if entry.notional else 0.0,
    )


def _group_matches(group: dict[str, Any], closes: list[float]) -> bool:
    if "all" in group:
        return all(_condition_matches(condition, closes) for condition in group["all"])
    return any(_condition_matches(condition, closes) for condition in group["any"])


def _condition_matches(condition: dict[str, Any], closes: list[float]) -> bool:
    indicator = condition["indicator"]
    if indicator == "ema_cross":
        fast = ema(closes, condition["fast"])
        slow = ema(closes, condition["slow"])
        return fast is not None and slow is not None and fast > slow
    if indicator == "ema_cross_down":
        fast = ema(closes, condition["fast"])
        slow = ema(closes, condition["slow"])
        return fast is not None and slow is not None and fast < slow
    if indicator == "rsi":
        value = rsi(closes, condition["period"])
        return value is not None and _compare(value, condition["operator"], condition["value"])
    if indicator == "price_change_percent":
        lookback = condition["lookback"]
        if len(closes) <= lookback:
            return False
        value = pct_change(closes[-(lookback + 1)], closes[-1])
        return _compare(value, condition["operator"], condition["value"])
    raise ValueError(f"unsupported indicator: {indicator}")


def _compare(left: float, operator: str, right: float) -> bool:
    if operator == "<":
        return left < right
    if operator == "<=":
        return left <= right
    if operator == ">":
        return left > right
    if operator == ">=":
        return left >= right
    if operator == "==":
        return left == right
    raise ValueError(f"unsupported operator: {operator}")


def _metrics(initial_cash: float, equity_curve: list[EquityRecord], trades: list[TradeRecord], fills: list[FillRecord], returns: list[float]) -> dict[str, float]:
    final_equity = equity_curve[-1].equity if equity_curve else initial_cash
    total_return = (final_equity - initial_cash) / initial_cash
    peak = initial_cash
    max_drawdown = 0.0
    for point in equity_curve:
        peak = max(peak, point.equity)
        if peak:
            max_drawdown = min(max_drawdown, (point.equity - peak) / peak)
    wins = [trade for trade in trades if trade.pnl > 0]
    losses = [trade for trade in trades if trade.pnl < 0]
    gross_profit = sum(trade.pnl for trade in wins)
    gross_loss = abs(sum(trade.pnl for trade in losses))
    volatility = pstdev(returns) if len(returns) > 1 else 0.0
    avg_return = sum(returns) / len(returns) if returns else 0.0
    sharpe = avg_return / volatility if volatility else 0.0
    exposure = sum(point.exposure for point in equity_curve) / len(equity_curve) if equity_curve else 0.0
    return {
        "total_return": total_return,
        "maximum_drawdown": abs(max_drawdown),
        "trade_count": float(len(trades)),
        "win_rate": len(wins) / len(trades) if trades else 0.0,
        "profit_factor": gross_profit / gross_loss if gross_loss else (gross_profit if gross_profit else 0.0),
        "volatility": volatility,
        "sharpe_style_return": sharpe,
        "exposure": exposure,
        "fee_total": sum(fill.fee for fill in fills),
        "slippage_total": sum(fill.slippage * fill.quantity for fill in fills),
    }
