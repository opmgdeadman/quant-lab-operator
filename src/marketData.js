const PAIR = "BTC-USD";
const INTERVAL = "1h";
const HOUR_MS = 60 * 60 * 1000;
const INITIAL_BACKFILL_HOURS = 72;
const MAX_BACKFILL_HOURS_PER_RUN = 720;
const PROVIDER_REQUEST_HOURS = 250;
const HEALTH_ROW_ID = `${PAIR}:${INTERVAL}`;

export function expectedLatestClosedAt(now = new Date()) {
  const nowMs = dateMillis(now, "now");
  return new Date(Math.floor(nowMs / HOUR_MS) * HOUR_MS).toISOString();
}

export async function runHourlyCandleIngestion(env, options = {}) {
  const now = options.now || new Date();
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const provider = env.MARKET_DATA_PROVIDER || "coinbase_exchange";
  const startedAt = new Date(dateMillis(now, "now")).toISOString();
  const expectedClosedAt = expectedLatestClosedAt(now);
  const expectedClosedMs = Date.parse(expectedClosedAt);
  const runId = `market-data:${PAIR}:${INTERVAL}:${startedAt}`;
  let requestedStartClosedAt = expectedClosedAt;
  let requestedEndClosedAt = expectedClosedAt;
  let fetchedCount = 0;
  let insertedCount = 0;
  let duplicateCount = 0;

  try {
    const latestBefore = await latestStoredCandle(env);
    const window = ingestionWindow(latestBefore?.closed_at || null, expectedClosedMs);
    requestedStartClosedAt = new Date(window.startMs).toISOString();
    requestedEndClosedAt = new Date(window.endMs).toISOString();

    const providerCandles = [];
    for (let cursorMs = window.startMs; cursorMs <= window.endMs; cursorMs += PROVIDER_REQUEST_HOURS * HOUR_MS) {
      const chunkEndMs = Math.min(
        window.endMs,
        cursorMs + (PROVIDER_REQUEST_HOURS - 1) * HOUR_MS,
      );
      const chunk = await fetchProviderCandles(provider, {
        startClosedAt: new Date(cursorMs).toISOString(),
        endClosedAt: new Date(chunkEndMs).toISOString(),
        expectedClosedAt,
        fetchImpl,
      });
      providerCandles.push(...chunk);
    }

    const candles = deduplicateAndSort(providerCandles);
    fetchedCount = candles.length;
    const existingRows = await storedCandlesBetween(env, requestedStartClosedAt, requestedEndClosedAt);
    const existingByClosedAt = new Map(existingRows.map((row) => [row.closed_at, normalizeStoredCandle(row)]));

    for (const candle of candles) {
      const existing = existingByClosedAt.get(candle.closed_at);
      if (existing) {
        if (!sameCandleValues(existing, candle)) {
          throw new Error(`stored_candle_conflict:${candle.closed_at}`);
        }
        duplicateCount += 1;
        continue;
      }

      const insertResult = await insertCandle(env, candle, startedAt);
      if (affectedRows(insertResult) > 0) {
        insertedCount += 1;
        existingByClosedAt.set(candle.closed_at, candle);
        continue;
      }

      const raced = await findStoredCandle(env, candle.closed_at);
      if (!raced || !sameCandleValues(normalizeStoredCandle(raced), candle)) {
        throw new Error(`candle_insert_conflict:${candle.closed_at}`);
      }
      duplicateCount += 1;
    }

    const completedAt = new Date().toISOString();
    const liveHealth = await calculateLiveHealth(env, expectedClosedAt);
    const health = {
      ...liveHealth,
      provider,
      last_attempt_at: startedAt,
      last_success_at: completedAt,
      last_error: null,
      fetched_count: fetchedCount,
      inserted_count: insertedCount,
      duplicate_count: duplicateCount,
      updated_at: completedAt,
    };
    await persistHealth(env, health);
    await persistRun(env, {
      id: runId,
      provider,
      started_at: startedAt,
      completed_at: completedAt,
      status: health.status,
      requested_start_closed_at: requestedStartClosedAt,
      requested_end_closed_at: requestedEndClosedAt,
      fetched_count: fetchedCount,
      inserted_count: insertedCount,
      duplicate_count: duplicateCount,
      missing_candles: health.missing_candles,
      error: null,
    });

    return {
      ok: health.status === "healthy",
      pair: PAIR,
      interval: INTERVAL,
      run_id: runId,
      requested_start_closed_at: requestedStartClosedAt,
      requested_end_closed_at: requestedEndClosedAt,
      fetched_count: fetchedCount,
      inserted_count: insertedCount,
      duplicate_count: duplicateCount,
      health,
    };
  } catch (error) {
    const completedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : "unknown_error";
    let prior = null;
    let liveHealth = emptyHealth(expectedClosedAt);
    try {
      prior = await storedHealth(env);
      liveHealth = await calculateLiveHealth(env, expectedClosedAt);
      await persistHealth(env, {
        ...liveHealth,
        provider,
        status: "error",
        last_attempt_at: startedAt,
        last_success_at: prior?.last_success_at || null,
        last_error: message,
        fetched_count: fetchedCount,
        inserted_count: insertedCount,
        duplicate_count: duplicateCount,
        updated_at: completedAt,
      });
      await persistRun(env, {
        id: runId,
        provider,
        started_at: startedAt,
        completed_at: completedAt,
        status: "error",
        requested_start_closed_at: requestedStartClosedAt,
        requested_end_closed_at: requestedEndClosedAt,
        fetched_count: fetchedCount,
        inserted_count: insertedCount,
        duplicate_count: duplicateCount,
        missing_candles: liveHealth.missing_candles,
        error: message,
      });
    } catch {
      // Preserve the original ingestion failure when health persistence is unavailable.
    }
    throw error;
  }
}

export async function getMarketDataHealth(env, now = new Date()) {
  const expectedClosedAt = expectedLatestClosedAt(now);
  const persisted = await storedHealth(env);
  const live = await calculateLiveHealth(env, expectedClosedAt);
  const latestAttemptFailed = persisted?.status === "error"
    && persisted.last_attempt_at
    && (!persisted.last_success_at || persisted.last_attempt_at > persisted.last_success_at);

  return {
    ...live,
    provider: persisted?.provider || env.MARKET_DATA_PROVIDER || "coinbase_exchange",
    status: latestAttemptFailed ? "error" : live.status,
    last_attempt_at: persisted?.last_attempt_at || null,
    last_success_at: persisted?.last_success_at || null,
    last_error: latestAttemptFailed ? persisted.last_error : null,
    fetched_count: Number(persisted?.fetched_count || 0),
    inserted_count: Number(persisted?.inserted_count || 0),
    duplicate_count: Number(persisted?.duplicate_count || 0),
    updated_at: persisted?.updated_at || null,
  };
}

export function validateCompletedCandle(candle, expectedClosedAt) {
  const closedMs = dateMillis(candle.closed_at, "closed_at");
  const expectedMs = dateMillis(expectedClosedAt, "expected_closed_at");
  if (closedMs % HOUR_MS !== 0) {
    throw new Error(`candle_not_hour_aligned:${candle.closed_at}`);
  }
  if (closedMs > expectedMs) {
    throw new Error(`candle_not_completed:${candle.closed_at}`);
  }

  for (const field of ["open", "high", "low", "close"]) {
    if (!Number.isFinite(candle[field]) || candle[field] <= 0) {
      throw new Error(`invalid_candle_${field}:${candle.closed_at}`);
    }
  }
  if (!Number.isFinite(candle.volume) || candle.volume < 0) {
    throw new Error(`invalid_candle_volume:${candle.closed_at}`);
  }
  if (candle.high < Math.max(candle.open, candle.close, candle.low)) {
    throw new Error(`invalid_candle_high:${candle.closed_at}`);
  }
  if (candle.low > Math.min(candle.open, candle.close, candle.high)) {
    throw new Error(`invalid_candle_low:${candle.closed_at}`);
  }
  if (typeof candle.source !== "string" || !candle.source) {
    throw new Error(`invalid_candle_source:${candle.closed_at}`);
  }
  return candle;
}

function ingestionWindow(latestClosedAt, expectedClosedMs) {
  const startMs = latestClosedAt
    ? dateMillis(latestClosedAt, "latest_closed_at")
    : expectedClosedMs - (INITIAL_BACKFILL_HOURS - 1) * HOUR_MS;
  const endMs = Math.min(
    expectedClosedMs,
    startMs + (MAX_BACKFILL_HOURS_PER_RUN - 1) * HOUR_MS,
  );
  return { startMs, endMs: Math.max(startMs, endMs) };
}

async function fetchProviderCandles(provider, request) {
  if (provider === "coinbase_exchange") {
    return fetchCoinbaseExchangeCandles(request);
  }
  throw new Error(`unsupported_market_data_provider:${provider}`);
}

async function fetchCoinbaseExchangeCandles({ startClosedAt, endClosedAt, expectedClosedAt, fetchImpl }) {
  const startBucketMs = dateMillis(startClosedAt, "start_closed_at") - HOUR_MS;
  const endBucketMs = dateMillis(endClosedAt, "end_closed_at");
  const url = new URL("https://api.exchange.coinbase.com/products/BTC-USD/candles");
  url.searchParams.set("granularity", "3600");
  url.searchParams.set("start", new Date(startBucketMs).toISOString());
  url.searchParams.set("end", new Date(endBucketMs).toISOString());

  const response = await fetchImpl(url.toString(), {
    headers: {
      accept: "application/json",
      "user-agent": "quant-lab-operator/1.0",
    },
  });
  if (!response.ok) {
    throw new Error(`market_data_http_${response.status}`);
  }
  const payload = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error("market_data_invalid_payload");
  }

  const startClosedMs = dateMillis(startClosedAt, "start_closed_at");
  const endClosedMs = dateMillis(endClosedAt, "end_closed_at");
  return payload.map((row) => {
    if (!Array.isArray(row) || row.length < 6) {
      throw new Error("market_data_invalid_candle_shape");
    }
    const bucketStartMs = Number(row[0]) * 1000;
    const candle = {
      id: candleId(new Date(bucketStartMs + HOUR_MS).toISOString()),
      pair: PAIR,
      interval: INTERVAL,
      closed_at: new Date(bucketStartMs + HOUR_MS).toISOString(),
      open: Number(row[3]),
      high: Number(row[2]),
      low: Number(row[1]),
      close: Number(row[4]),
      volume: Number(row[5]),
      source: "coinbase_exchange",
    };
    return validateCompletedCandle(candle, expectedClosedAt);
  }).filter((candle) => {
    const closedMs = Date.parse(candle.closed_at);
    return closedMs >= startClosedMs && closedMs <= endClosedMs;
  });
}

function deduplicateAndSort(candles) {
  const byClosedAt = new Map();
  for (const candle of candles) {
    const existing = byClosedAt.get(candle.closed_at);
    if (existing && !sameCandleValues(existing, candle)) {
      throw new Error(`provider_candle_conflict:${candle.closed_at}`);
    }
    byClosedAt.set(candle.closed_at, candle);
  }
  return [...byClosedAt.values()].sort((left, right) => left.closed_at.localeCompare(right.closed_at));
}

async function latestStoredCandle(env) {
  const row = await env.DB.prepare(
    `SELECT id, pair, interval, closed_at, open, high, low, close, volume, source
     FROM market_candles
     WHERE pair = ? AND interval = ?
     ORDER BY closed_at DESC
     LIMIT 1`,
  ).bind(PAIR, INTERVAL).first();
  return row ? normalizeStoredCandle(row) : null;
}

async function storedCandlesBetween(env, startClosedAt, endClosedAt) {
  const result = await env.DB.prepare(
    `SELECT id, pair, interval, closed_at, open, high, low, close, volume, source
     FROM market_candles
     WHERE pair = ? AND interval = ? AND closed_at >= ? AND closed_at <= ?
     ORDER BY closed_at ASC`,
  ).bind(PAIR, INTERVAL, startClosedAt, endClosedAt).all();
  return resultRows(result);
}

async function recentStoredCloses(env) {
  const result = await env.DB.prepare(
    `SELECT closed_at
     FROM market_candles
     WHERE pair = ? AND interval = ?
     ORDER BY closed_at DESC
     LIMIT 168`,
  ).bind(PAIR, INTERVAL).all();
  return resultRows(result).map((row) => row.closed_at);
}

async function findStoredCandle(env, closedAt) {
  return env.DB.prepare(
    `SELECT id, pair, interval, closed_at, open, high, low, close, volume, source
     FROM market_candles
     WHERE pair = ? AND interval = ? AND closed_at = ?`,
  ).bind(PAIR, INTERVAL, closedAt).first();
}

async function insertCandle(env, candle, timestamp) {
  return env.DB.prepare(
    `INSERT INTO market_candles
      (id, pair, interval, closed_at, open, high, low, close, volume, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(pair, interval, closed_at) DO NOTHING`,
  ).bind(
    candle.id,
    candle.pair,
    candle.interval,
    candle.closed_at,
    candle.open,
    candle.high,
    candle.low,
    candle.close,
    candle.volume,
    candle.source,
    timestamp,
    timestamp,
  ).run();
}

async function calculateLiveHealth(env, expectedClosedAt) {
  const closes = [...new Set(await recentStoredCloses(env))]
    .sort((left, right) => left.localeCompare(right));
  if (closes.length === 0) {
    return emptyHealth(expectedClosedAt);
  }

  let internalMissing = 0;
  for (let index = 1; index < closes.length; index += 1) {
    const deltaHours = Math.round((Date.parse(closes[index]) - Date.parse(closes[index - 1])) / HOUR_MS);
    if (deltaHours > 1) {
      internalMissing += deltaHours - 1;
    }
  }

  const latestClosedAt = closes.at(-1);
  const staleHours = Math.max(
    0,
    Math.round((Date.parse(expectedClosedAt) - Date.parse(latestClosedAt)) / HOUR_MS),
  );
  const missingCandles = internalMissing + staleHours;
  const status = internalMissing > 0 ? "gapped" : staleHours > 0 ? "stale" : "healthy";
  return {
    pair: PAIR,
    interval: INTERVAL,
    status,
    latest_closed_at: latestClosedAt,
    expected_latest_closed_at: expectedClosedAt,
    stale_hours: staleHours,
    missing_candles: missingCandles,
  };
}

function emptyHealth(expectedClosedAt) {
  return {
    pair: PAIR,
    interval: INTERVAL,
    status: "empty",
    latest_closed_at: null,
    expected_latest_closed_at: expectedClosedAt,
    stale_hours: null,
    missing_candles: 0,
  };
}

async function storedHealth(env) {
  return env.DB.prepare(
    `SELECT id, pair, interval, provider, status, latest_closed_at,
            expected_latest_closed_at, stale_hours, missing_candles,
            last_attempt_at, last_success_at, last_error,
            fetched_count, inserted_count, duplicate_count, updated_at
     FROM market_data_health
     WHERE id = ?`,
  ).bind(HEALTH_ROW_ID).first();
}

async function persistHealth(env, health) {
  return env.DB.prepare(
    `INSERT INTO market_data_health
      (id, pair, interval, provider, status, latest_closed_at,
       expected_latest_closed_at, stale_hours, missing_candles,
       last_attempt_at, last_success_at, last_error,
       fetched_count, inserted_count, duplicate_count, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       provider = excluded.provider,
       status = excluded.status,
       latest_closed_at = excluded.latest_closed_at,
       expected_latest_closed_at = excluded.expected_latest_closed_at,
       stale_hours = excluded.stale_hours,
       missing_candles = excluded.missing_candles,
       last_attempt_at = excluded.last_attempt_at,
       last_success_at = excluded.last_success_at,
       last_error = excluded.last_error,
       fetched_count = excluded.fetched_count,
       inserted_count = excluded.inserted_count,
       duplicate_count = excluded.duplicate_count,
       updated_at = excluded.updated_at`,
  ).bind(
    HEALTH_ROW_ID,
    PAIR,
    INTERVAL,
    health.provider,
    health.status,
    health.latest_closed_at,
    health.expected_latest_closed_at,
    health.stale_hours,
    health.missing_candles,
    health.last_attempt_at,
    health.last_success_at,
    health.last_error,
    health.fetched_count,
    health.inserted_count,
    health.duplicate_count,
    health.updated_at,
  ).run();
}

async function persistRun(env, run) {
  return env.DB.prepare(
    `INSERT INTO market_data_ingestion_runs
      (id, pair, interval, provider, started_at, completed_at, status,
       requested_start_closed_at, requested_end_closed_at,
       fetched_count, inserted_count, duplicate_count, missing_candles, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       completed_at = excluded.completed_at,
       status = excluded.status,
       fetched_count = excluded.fetched_count,
       inserted_count = excluded.inserted_count,
       duplicate_count = excluded.duplicate_count,
       missing_candles = excluded.missing_candles,
       error = excluded.error`,
  ).bind(
    run.id,
    PAIR,
    INTERVAL,
    run.provider,
    run.started_at,
    run.completed_at,
    run.status,
    run.requested_start_closed_at,
    run.requested_end_closed_at,
    run.fetched_count,
    run.inserted_count,
    run.duplicate_count,
    run.missing_candles,
    run.error,
  ).run();
}

function normalizeStoredCandle(row) {
  return {
    id: row.id,
    pair: row.pair,
    interval: row.interval,
    closed_at: row.closed_at,
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume),
    source: row.source,
  };
}

function sameCandleValues(left, right) {
  return left.pair === right.pair
    && left.interval === right.interval
    && left.closed_at === right.closed_at
    && Number(left.open) === Number(right.open)
    && Number(left.high) === Number(right.high)
    && Number(left.low) === Number(right.low)
    && Number(left.close) === Number(right.close)
    && Number(left.volume) === Number(right.volume)
    && left.source === right.source;
}

function candleId(closedAt) {
  return `${PAIR}:${INTERVAL}:${closedAt}`;
}

function resultRows(result) {
  if (Array.isArray(result)) {
    return result;
  }
  return Array.isArray(result?.results) ? result.results : [];
}

function affectedRows(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

function dateMillis(value, field) {
  const milliseconds = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw new Error(`invalid_${field}`);
  }
  return milliseconds;
}
