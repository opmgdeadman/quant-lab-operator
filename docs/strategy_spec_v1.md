# strategy_spec_v1

`strategy_spec_v1` is the declarative strategy contract for the deterministic Phase 1 core. It is intentionally bounded so a model can propose research ideas without controlling infrastructure, execution costs, datasets, or judge criteria.

## Allowed Top-Level Fields

- `schema`: must be `strategy_spec_v1`.
- `strategy_id`: non-empty string.
- `version`: integer `>= 1`.
- `parent_strategy_id`: string or `null`.
- `parent_version`: integer `>= 1` or `null`.
- `market`: `BTC-USD` or `ETH-USD`.
- `execution_timeframe`: `1h`.
- `direction`: `long` or `cash`.
- `entry`: condition group.
- `exit`: condition group.
- `position_size_percent`: numeric, `> 0` and `<= 100`.

Unknown top-level fields are rejected.

## Forbidden Strategy Control

Strategies cannot define:

- executable code or Python;
- leverage, shorting, or derivatives;
- fees or slippage;
- judge configuration;
- datasets, partitions, benchmarks, success criteria, or promotion thresholds.

## Conditions

`entry` and `exit` must contain exactly one of:

- `all`: non-empty list of conditions;
- `any`: non-empty list of conditions.

Supported condition indicators:

- `ema_cross`: `fast` integer `2..200`, `slow` integer `3..400`, `fast < slow`.
- `ema_cross_down`: same bounds as `ema_cross`.
- `rsi`: `period` integer `2..100`, `operator` one of `<`, `<=`, `>`, `>=`, `==`, `value` `0..100`.
- `price_change_percent`: `lookback` integer `1..500`, operator as above, `value` `-100..100`.

Indicators are evaluated from completed candles only.

## Execution Semantics

A signal generated from candle `t` may execute no earlier than candle `t+1` open. Execution cost, benchmark definitions, partitions, and evidence metrics belong to the judge, not the strategy spec.
