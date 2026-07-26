from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable


@dataclass(frozen=True)
class Candle:
    market: str
    open_time: str
    close_time: str
    open: float
    high: float
    low: float
    close: float
    volume: float
    complete: bool = True


def pct_change(old: float, new: float) -> float:
    return ((new - old) / old) * 100 if old else 0.0


def ema(values: Iterable[float], period: int) -> float | None:
    series = list(values)
    if period <= 0:
        raise ValueError("period must be positive")
    if len(series) < period:
        return None
    multiplier = 2 / (period + 1)
    current = sum(series[:period]) / period
    for value in series[period:]:
        current = (value - current) * multiplier + current
    return current


def rsi(values: Iterable[float], period: int = 14) -> float | None:
    closes = list(values)
    if period <= 0:
        raise ValueError("period must be positive")
    if len(closes) < period + 1:
        return None
    gains: list[float] = []
    losses: list[float] = []
    for prev, cur in zip(closes[-(period + 1) : -1], closes[-period:]):
        change = cur - prev
        gains.append(max(change, 0))
        losses.append(abs(min(change, 0)))
    avg_gain = sum(gains) / period
    avg_loss = sum(losses) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))
