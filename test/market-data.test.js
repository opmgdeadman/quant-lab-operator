import assert from "node:assert/strict";
import test from "node:test";

import {
  getMarketDataHealth,
  runHistoricalCandleWindow,
  runHourlyCandleIngestion,
  validateCompletedCandle,
} from "../src/marketData.js";

const NOW = new Date("2026-08-01T12:32:00.000Z");

function createEnv() {
  return {
    MARKET_DATA_PROVIDER: "coinbase_exchange",
    DB: new MarketDataMemoryD1(),
  };
}

test("hourly ingestion stores only completed candles and is idempotent", async () => {
  const env = createEnv();
  const payload = [
    coinbaseRow("2026-08-01T13:00:00.000Z", 103, 106, 102, 105, 12),
    coinbaseRow("2026-08-01T12:00:00.000Z", 102, 105, 101, 103, 11),
    coinbaseRow("2026-08-01T11:00:00.000Z", 101, 104, 100, 102, 10),
    coinbaseRow("2026-08-01T10:00:00.000Z", 100, 103, 99, 101, 9),
  ];
  const fetchImpl = async () => jsonResponse(payload);

  const first = await runHourlyCandleIngestion(env, { now: NOW, fetchImpl });
  const second = await runHourlyCandleIngestion(env, { now: NOW, fetchImpl });
  const health = await getMarketDataHealth(env, NOW);

  assert.equal(first.fetched_count, 3);
  assert.equal(first.inserted_count, 3);
  assert.equal(first.duplicate_count, 0);
  assert.equal(first.health.status, "healthy");
  assert.equal(second.fetched_count, 1);
  assert.equal(second.inserted_count, 0);
  assert.equal(second.duplicate_count, 1);
  assert.equal(env.DB.candles.size, 3);
  assert.equal(env.DB.candles.has("2026-08-01T13:00:00.000Z"), false);
  assert.equal(health.status, "healthy");
  assert.equal(health.latest_closed_at, "2026-08-01T12:00:00.000Z");
  assert.equal(health.missing_candles, 0);
});

test("bounded historical window persists exact candles and replays as duplicates", async () => {
  const env = createEnv();
  const fetchImpl = async () => jsonResponse([
    coinbaseRow("2026-07-30T02:00:00.000Z", 102, 105, 101, 103, 11),
    coinbaseRow("2026-07-30T01:00:00.000Z", 101, 104, 100, 102, 10),
    coinbaseRow("2026-07-30T00:00:00.000Z", 100, 103, 99, 101, 9),
  ]);
  const options = {
    now: NOW,
    startedAt: NOW,
    startClosedAt: "2026-07-30T00:00:00.000Z",
    endClosedAt: "2026-07-30T02:00:00.000Z",
    fetchImpl,
  };
  const first = await runHistoricalCandleWindow(env, options);
  const second = await runHistoricalCandleWindow(env, options);
  assert.equal(first.requested_hours, 3);
  assert.equal(first.fetched_count, 3);
  assert.equal(first.inserted_count, 3);
  assert.equal(first.duplicate_count, 0);
  assert.equal(second.inserted_count, 0);
  assert.equal(second.duplicate_count, 3);
  assert.equal(env.DB.candles.size, 3);
  assert.equal(env.DB.candles.get("2026-07-30T00:00:00.000Z").source, "coinbase_exchange");
});

test("historical window rejects incomplete provider evidence before persistence", async () => {
  const env = createEnv();
  await assert.rejects(() => runHistoricalCandleWindow(env, {
    now: NOW,
    startClosedAt: "2026-07-30T00:00:00.000Z",
    endClosedAt: "2026-07-30T02:00:00.000Z",
    fetchImpl: async () => jsonResponse([
      coinbaseRow("2026-07-30T02:00:00.000Z", 102, 105, 101, 103, 11),
      coinbaseRow("2026-07-30T01:00:00.000Z", 101, 104, 100, 102, 10),
    ]),
  }), /historical_provider_window_incomplete/);
  assert.equal(env.DB.candles.size, 0);
});

test("historical window rejects future, oversized, and conflicting evidence", async () => {
  const env = createEnv();
  await assert.rejects(() => runHistoricalCandleWindow(env, {
    now: NOW,
    startClosedAt: "2026-08-01T13:00:00.000Z",
    endClosedAt: "2026-08-01T13:00:00.000Z",
    fetchImpl: async () => jsonResponse([]),
  }), /historical_window_incomplete_candle/);
  await assert.rejects(() => runHistoricalCandleWindow(env, {
    now: NOW,
    startClosedAt: "2026-07-20T00:00:00.000Z",
    endClosedAt: "2026-08-01T12:00:00.000Z",
    fetchImpl: async () => jsonResponse([]),
  }), /historical_window_size_invalid/);
  const first = async () => jsonResponse([
    coinbaseRow("2026-07-30T00:00:00.000Z", 100, 103, 99, 101, 9),
  ]);
  await runHistoricalCandleWindow(env, {
    now: NOW,
    startClosedAt: "2026-07-30T00:00:00.000Z",
    endClosedAt: "2026-07-30T00:00:00.000Z",
    fetchImpl: first,
  });
  await assert.rejects(() => runHistoricalCandleWindow(env, {
    now: NOW,
    startClosedAt: "2026-07-30T00:00:00.000Z",
    endClosedAt: "2026-07-30T00:00:00.000Z",
    fetchImpl: async () => jsonResponse([
      coinbaseRow("2026-07-30T00:00:00.000Z", 200, 203, 199, 201, 19),
    ]),
  }), /stored_candle_conflict/);
});

test("hourly ingestion retries transient provider rate limits", async () => {
  const env = createEnv();
  const delays = [];
  let attempts = 0;
  const payload = [
    coinbaseRow("2026-08-01T12:00:00.000Z", 102, 105, 101, 103, 11),
  ];

  const result = await runHourlyCandleIngestion(env, {
    now: NOW,
    fetchImpl: async () => {
      attempts += 1;
      return attempts < 3 ? jsonResponse({ error: "rate limited" }, 429) : jsonResponse(payload);
    },
    sleepImpl: async (milliseconds) => delays.push(milliseconds),
  });

  assert.equal(result.ok, true);
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [500, 1000]);
  assert.equal(result.inserted_count, 1);
  assert.equal(result.health.status, "healthy");
  assert.equal(result.health.last_error, null);
});

test("persistent Coinbase limits fall back to Binance.US without rewriting stored candles", async () => {
  const env = createEnv();
  await runHourlyCandleIngestion(env, {
    now: NOW,
    fetchImpl: async () => jsonResponse([
      coinbaseRow("2026-08-01T12:00:00.000Z", 102, 105, 101, 103, 11),
    ]),
  });

  let coinbaseAttempts = 0;
  let binanceAttempts = 0;
  const result = await runHourlyCandleIngestion(env, {
    now: new Date("2026-08-01T13:32:00.000Z"),
    fetchImpl: async (url) => {
      if (url.includes("api.exchange.coinbase.com")) {
        coinbaseAttempts += 1;
        return jsonResponse({ error: "rate limited" }, 429);
      }
      if (url.includes("api.binance.us")) {
        binanceAttempts += 1;
        return jsonResponse([
          binanceRow("2026-08-01T12:00:00.000Z", 202, 205, 201, 203, 21),
          binanceRow("2026-08-01T13:00:00.000Z", 203, 206, 202, 204, 22),
        ]);
      }
      throw new Error(`unexpected provider URL: ${url}`);
    },
    sleepImpl: async () => {},
  });

  assert.equal(result.ok, true);
  assert.equal(coinbaseAttempts, 3);
  assert.equal(binanceAttempts, 1);
  assert.equal(result.fetched_count, 1);
  assert.equal(result.inserted_count, 1);
  assert.equal(result.health.provider, "binance_us");
  assert.equal(env.DB.candles.get("2026-08-01T12:00:00.000Z").source, "coinbase_exchange");
  assert.equal(env.DB.candles.get("2026-08-01T13:00:00.000Z").source, "binance_us");
});

test("continuity health detects a missing closed candle", async () => {
  const env = createEnv();
  const payload = [
    coinbaseRow("2026-08-01T12:00:00.000Z", 102, 105, 101, 103, 11),
    coinbaseRow("2026-08-01T10:00:00.000Z", 100, 103, 99, 101, 9),
  ];

  const result = await runHourlyCandleIngestion(env, {
    now: NOW,
    fetchImpl: async () => jsonResponse(payload),
  });
  const health = await getMarketDataHealth(env, NOW);

  assert.equal(result.ok, false);
  assert.equal(result.health.status, "gapped");
  assert.equal(result.health.missing_candles, 1);
  assert.equal(health.status, "gapped");
  assert.equal(health.stale_hours, 0);
});

test("invalid OHLC data fails closed and records an error health state", async () => {
  const env = createEnv();
  const invalid = [
    coinbaseRow("2026-08-01T12:00:00.000Z", 102, 101, 99, 103, 11),
  ];

  await assert.rejects(
    runHourlyCandleIngestion(env, {
      now: NOW,
      fetchImpl: async () => jsonResponse(invalid),
    }),
    /invalid_candle_high/,
  );

  const health = await getMarketDataHealth(env, NOW);
  assert.equal(env.DB.candles.size, 0);
  assert.equal(health.status, "error");
  assert.match(health.last_error, /invalid_candle_high/);
  assert.equal(env.DB.runs.size, 1);
});

test("completed-candle validator rejects misaligned timestamps and impossible ranges", () => {
  assert.throws(() => validateCompletedCandle({
    pair: "BTC-USD",
    interval: "1h",
    closed_at: "2026-08-01T12:30:00.000Z",
    open: 100,
    high: 103,
    low: 99,
    close: 101,
    volume: 5,
    source: "coinbase_exchange",
  }, "2026-08-01T13:00:00.000Z"), /candle_not_hour_aligned/);

  assert.throws(() => validateCompletedCandle({
    pair: "BTC-USD",
    interval: "1h",
    closed_at: "2026-08-01T12:00:00.000Z",
    open: 100,
    high: 99,
    low: 98,
    close: 101,
    volume: 5,
    source: "coinbase_exchange",
  }, "2026-08-01T12:00:00.000Z"), /invalid_candle_high/);
});

function coinbaseRow(closedAt, open, high, low, close, volume) {
  const bucketStartSeconds = (Date.parse(closedAt) - 60 * 60 * 1000) / 1000;
  return [bucketStartSeconds, low, high, open, close, volume];
}

function binanceRow(closedAt, open, high, low, close, volume) {
  const openTime = Date.parse(closedAt) - 60 * 60 * 1000;
  return [openTime, String(open), String(high), String(low), String(close), String(volume)];
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

class MarketDataMemoryD1 {
  constructor() {
    this.candles = new Map();
    this.health = null;
    this.runs = new Map();
  }

  prepare(sql) {
    return new MarketDataMemoryStatement(this, sql);
  }
}

class MarketDataMemoryStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async first() {
    if (this.sql.includes("FROM market_data_health")) {
      return this.db.health;
    }
    if (this.sql.includes("FROM market_candles") && this.sql.includes("closed_at = ?")) {
      return this.db.candles.get(this.values[2]) || null;
    }
    if (this.sql.includes("FROM market_candles") && this.sql.includes("ORDER BY closed_at DESC")) {
      return [...this.db.candles.values()]
        .sort((left, right) => right.closed_at.localeCompare(left.closed_at))[0] || null;
    }
    throw new Error(`unhandled first SQL: ${this.sql}`);
  }

  async all() {
    if (this.sql.includes("SELECT closed_at") && this.sql.includes("FROM market_candles")) {
      return {
        results: [...this.db.candles.values()]
          .sort((left, right) => right.closed_at.localeCompare(left.closed_at))
          .slice(0, 168)
          .map((row) => ({ closed_at: row.closed_at })),
      };
    }
    if (this.sql.includes("FROM market_candles") && this.sql.includes("closed_at >= ?")) {
      const [, , startClosedAt, endClosedAt] = this.values;
      return {
        results: [...this.db.candles.values()]
          .filter((row) => row.closed_at >= startClosedAt && row.closed_at <= endClosedAt)
          .sort((left, right) => left.closed_at.localeCompare(right.closed_at)),
      };
    }
    throw new Error(`unhandled all SQL: ${this.sql}`);
  }

  async run() {
    if (this.sql.includes("INSERT INTO market_candles")) {
      const [
        id,
        pair,
        interval,
        closed_at,
        open,
        high,
        low,
        close,
        volume,
        source,
        created_at,
        updated_at,
      ] = this.values;
      if (this.db.candles.has(closed_at)) {
        return { success: true, meta: { changes: 0 } };
      }
      this.db.candles.set(closed_at, {
        id,
        pair,
        interval,
        closed_at,
        open,
        high,
        low,
        close,
        volume,
        source,
        created_at,
        updated_at,
      });
      return { success: true, meta: { changes: 1 } };
    }

    if (this.sql.includes("INSERT INTO market_data_health")) {
      const [
        id,
        pair,
        interval,
        provider,
        status,
        latest_closed_at,
        expected_latest_closed_at,
        stale_hours,
        missing_candles,
        last_attempt_at,
        last_success_at,
        last_error,
        fetched_count,
        inserted_count,
        duplicate_count,
        updated_at,
      ] = this.values;
      this.db.health = {
        id,
        pair,
        interval,
        provider,
        status,
        latest_closed_at,
        expected_latest_closed_at,
        stale_hours,
        missing_candles,
        last_attempt_at,
        last_success_at,
        last_error,
        fetched_count,
        inserted_count,
        duplicate_count,
        updated_at,
      };
      return { success: true, meta: { changes: 1 } };
    }

    if (this.sql.includes("INSERT INTO market_data_ingestion_runs")) {
      const [
        id,
        pair,
        interval,
        provider,
        started_at,
        completed_at,
        status,
        requested_start_closed_at,
        requested_end_closed_at,
        fetched_count,
        inserted_count,
        duplicate_count,
        missing_candles,
        error,
      ] = this.values;
      this.db.runs.set(id, {
        id,
        pair,
        interval,
        provider,
        started_at,
        completed_at,
        status,
        requested_start_closed_at,
        requested_end_closed_at,
        fetched_count,
        inserted_count,
        duplicate_count,
        missing_candles,
        error,
      });
      return { success: true, meta: { changes: 1 } };
    }

    throw new Error(`unhandled run SQL: ${this.sql}`);
  }
}
