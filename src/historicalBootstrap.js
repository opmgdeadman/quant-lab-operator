import {
  expectedLatestClosedAt,
  runHistoricalCandleWindow,
} from "./marketData.js";

const POLICY_ID = "bounded-historical-bootstrap-v1";
const MARKET = "BTC-USD";
const INTERVAL = "1h";
const TARGET_CONTIGUOUS_CANDLES = 720;
const WINDOW_HOURS = 200;
const MAX_WINDOWS_PER_ATTEMPT = 2;
const HOUR_MS = 60 * 60 * 1000;

export const HISTORICAL_BOOTSTRAP_POLICY = deepFreeze({
  id: POLICY_ID,
  version: 1,
  market: MARKET,
  interval: INTERVAL,
  target_contiguous_candles: TARGET_CONTIGUOUS_CANDLES,
  window_hours: WINDOW_HOURS,
  max_windows_per_attempt: MAX_WINDOWS_PER_ATTEMPT,
  provider_order: ["coinbase_exchange", "binance_us_exact_fallback"],
  completed_candles_only: true,
  backward_only: true,
  overwrite_allowed: false,
  synthetic_interpolation_allowed: false,
  paid_data_allowed: false,
  research_artifact_creation_allowed: false,
  live_capital_enabled: false,
});

export async function runProductionHistoricalBootstrap(env, options = {}) {
  const now = options.now || new Date();
  const startedAt = iso(options.startedAt || now, "started_at");
  const policy = await policyRecord(startedAt);
  await ensurePolicy(env, policy);
  const expectedClosedAt = expectedLatestClosedAt(now);
  const initialCloses = await readRecentCloses(env, TARGET_CONTIGUOUS_CANDLES);
  const initialPlan = buildHistoricalBootstrapPlan(initialCloses, expectedClosedAt);

  if (initialPlan.state === "complete") {
    const existing = await readLatestCompleteAttempt(env);
    if (existing) return { ...existing, replayed: true };
    return persistAttempt(env, await buildAttemptSummary({
      attemptId: `${POLICY_ID}:complete:${expectedClosedAt}`,
      policy,
      startedAt,
      completedAt: new Date().toISOString(),
      expectedClosedAt,
      state: "complete",
      contiguousBefore: initialPlan.contiguous_candle_count,
      contiguousAfter: initialPlan.contiguous_candle_count,
      chunksPlanned: 0,
      chunksCompleted: 0,
      chunkSummaries: [],
      blockerCodes: [],
    }));
  }

  if (initialPlan.state === "blocked") {
    return persistAttempt(env, await buildAttemptSummary({
      attemptId: `${POLICY_ID}:attempt:${startedAt}`,
      policy,
      startedAt,
      completedAt: new Date().toISOString(),
      expectedClosedAt,
      state: "blocked",
      contiguousBefore: initialPlan.contiguous_candle_count,
      contiguousAfter: initialPlan.contiguous_candle_count,
      chunksPlanned: 0,
      chunksCompleted: 0,
      chunkSummaries: [],
      blockerCodes: initialPlan.blocker_codes,
    }));
  }

  const attemptId = `${POLICY_ID}:attempt:${startedAt}`;
  const chunkSummaries = [];
  let currentCloses = initialCloses;
  let currentPlan = initialPlan;
  let blockerCodes = [];

  for (const window of initialPlan.windows) {
    const chunkId = chunkIdFor(window);
    const existingChunk = await readChunk(env, chunkId);
    if (existingChunk) {
      chunkSummaries.push({ ...existingChunk, replayed: true });
      currentCloses = await readRecentCloses(env, TARGET_CONTIGUOUS_CANDLES);
      currentPlan = buildHistoricalBootstrapPlan(currentCloses, expectedClosedAt);
      continue;
    }

    const before = trailingContiguousCount(normalizeCloses(currentCloses));
    let ingestion;
    try {
      ingestion = await runHistoricalCandleWindow(env, {
        now,
        startedAt,
        startClosedAt: window.start_closed_at,
        endClosedAt: window.end_closed_at,
        provider: "coinbase_exchange",
        fetchImpl: options.fetchImpl,
        sleepImpl: options.sleepImpl,
      });
    } catch (error) {
      blockerCodes = [`provider_error:${error instanceof Error ? error.message : "historical_window_failed"}`];
      break;
    }

    currentCloses = await readRecentCloses(env, TARGET_CONTIGUOUS_CANDLES);
    currentPlan = buildHistoricalBootstrapPlan(currentCloses, expectedClosedAt);
    const after = currentPlan.contiguous_candle_count;
    if (after - before !== window.requested_hours) {
      blockerCodes = ["provider_window_incomplete"];
      break;
    }

    const chunk = await buildChunkRecord({
      policy,
      window,
      ingestion,
      contiguousBefore: before,
      contiguousAfter: after,
      createdAt: new Date().toISOString(),
    });
    await persistChunk(env, chunk);
    chunkSummaries.push({ ...JSON.parse(chunk.summary_json), replayed: false });
    if (after >= TARGET_CONTIGUOUS_CANDLES) break;
  }

  currentCloses = await readRecentCloses(env, TARGET_CONTIGUOUS_CANDLES);
  currentPlan = buildHistoricalBootstrapPlan(currentCloses, expectedClosedAt);
  const state = blockerCodes.length > 0
    ? "blocked"
    : currentPlan.contiguous_candle_count >= TARGET_CONTIGUOUS_CANDLES
      ? "complete"
      : "in_progress";
  return persistAttempt(env, await buildAttemptSummary({
    attemptId,
    policy,
    startedAt,
    completedAt: new Date().toISOString(),
    expectedClosedAt,
    state,
    contiguousBefore: initialPlan.contiguous_candle_count,
    contiguousAfter: currentPlan.contiguous_candle_count,
    chunksPlanned: initialPlan.windows.length,
    chunksCompleted: chunkSummaries.length,
    chunkSummaries,
    blockerCodes,
  }));
}

export async function runScheduledHistoricalBootstrap(env, scheduledAt = new Date()) {
  return runProductionHistoricalBootstrap(env, { now: scheduledAt, startedAt: scheduledAt });
}

export async function getHistoricalBootstrapSummary(env, now = new Date()) {
  const expectedClosedAt = expectedLatestClosedAt(now);
  const closes = await readRecentCloses(env, TARGET_CONTIGUOUS_CANDLES);
  const plan = buildHistoricalBootstrapPlan(closes, expectedClosedAt);
  const attemptRow = await env.DB.prepare(
    `SELECT id, summary_json FROM historical_bootstrap_attempts
     ORDER BY completed_at DESC LIMIT 1`,
  ).first();
  const chunkRows = await env.DB.prepare(
    `SELECT id, summary_json FROM historical_bootstrap_chunks
     ORDER BY created_at DESC LIMIT 5`,
  ).all();
  return {
    ok: true,
    paper_only: true,
    live_capital_enabled: false,
    policy: HISTORICAL_BOOTSTRAP_POLICY,
    progress: {
      expected_closed_at: expectedClosedAt,
      state: plan.state,
      contiguous_candle_count: plan.contiguous_candle_count,
      target_contiguous_candles: TARGET_CONTIGUOUS_CANDLES,
      remaining_candles: Math.max(0, TARGET_CONTIGUOUS_CANDLES - plan.contiguous_candle_count),
      latest_closed_at: plan.latest_closed_at,
      earliest_contiguous_closed_at: plan.earliest_contiguous_closed_at,
      blocker_codes: plan.blocker_codes,
    },
    latest_attempt: attemptRow ? { ...parseJson(attemptRow.summary_json, "bootstrap_attempt_summary_invalid"), attempt_id: attemptRow.id } : null,
    recent_chunks: resultRows(chunkRows).map((row) => ({ ...parseJson(row.summary_json, "bootstrap_chunk_summary_invalid"), chunk_id: row.id })),
  };
}

export function buildHistoricalBootstrapPlan(rawCloses, expectedClosedAt) {
  const expected = iso(expectedClosedAt, "expected_closed_at");
  const closes = normalizeCloses(rawCloses);
  const contiguousCount = trailingContiguousCount(closes);
  const latestClosedAt = closes.at(-1) || null;
  const earliestContiguousClosedAt = contiguousCount > 0
    ? closes[closes.length - contiguousCount]
    : null;
  if (!latestClosedAt || latestClosedAt !== expected) {
    return {
      state: "blocked",
      blocker_codes: ["latest_completed_candle_missing"],
      contiguous_candle_count: contiguousCount,
      latest_closed_at: latestClosedAt,
      earliest_contiguous_closed_at: earliestContiguousClosedAt,
      windows: [],
    };
  }
  if (contiguousCount >= TARGET_CONTIGUOUS_CANDLES) {
    return {
      state: "complete",
      blocker_codes: [],
      contiguous_candle_count: contiguousCount,
      latest_closed_at: latestClosedAt,
      earliest_contiguous_closed_at: earliestContiguousClosedAt,
      windows: [],
    };
  }
  const windows = [];
  let remaining = TARGET_CONTIGUOUS_CANDLES - contiguousCount;
  let nextEndMs = Date.parse(earliestContiguousClosedAt) - HOUR_MS;
  for (let index = 0; index < MAX_WINDOWS_PER_ATTEMPT && remaining > 0; index += 1) {
    const requestedHours = Math.min(WINDOW_HOURS, remaining);
    const startMs = nextEndMs - (requestedHours - 1) * HOUR_MS;
    windows.push({
      start_closed_at: new Date(startMs).toISOString(),
      end_closed_at: new Date(nextEndMs).toISOString(),
      requested_hours: requestedHours,
    });
    remaining -= requestedHours;
    nextEndMs = startMs - HOUR_MS;
  }
  return {
    state: "in_progress",
    blocker_codes: [],
    contiguous_candle_count: contiguousCount,
    latest_closed_at: latestClosedAt,
    earliest_contiguous_closed_at: earliestContiguousClosedAt,
    windows,
  };
}

async function buildChunkRecord({ policy, window, ingestion, contiguousBefore, contiguousAfter, createdAt }) {
  const id = chunkIdFor(window);
  const summary = {
    ok: true,
    paper_only: true,
    live_capital_enabled: false,
    chunk_id: id,
    start_closed_at: window.start_closed_at,
    end_closed_at: window.end_closed_at,
    requested_hours: window.requested_hours,
    provider: ingestion.provider,
    status: "complete",
    fetched_count: ingestion.fetched_count,
    inserted_count: ingestion.inserted_count,
    duplicate_count: ingestion.duplicate_count,
    contiguous_before: contiguousBefore,
    contiguous_after: contiguousAfter,
    blocker_code: null,
    created_at: createdAt,
  };
  const chunkHash = await stableHash({
    policy_hash: policy.policy_hash,
    ...summary,
    created_at: undefined,
  });
  return {
    id,
    policy_id: policy.id,
    policy_hash: policy.policy_hash,
    start_closed_at: window.start_closed_at,
    end_closed_at: window.end_closed_at,
    requested_hours: window.requested_hours,
    provider: ingestion.provider,
    status: "complete",
    fetched_count: ingestion.fetched_count,
    inserted_count: ingestion.inserted_count,
    duplicate_count: ingestion.duplicate_count,
    contiguous_before: contiguousBefore,
    contiguous_after: contiguousAfter,
    blocker_code: null,
    summary_json: JSON.stringify({ ...summary, chunk_hash: chunkHash }),
    chunk_hash: chunkHash,
    created_at: createdAt,
  };
}

async function buildAttemptSummary({
  attemptId,
  policy,
  startedAt,
  completedAt,
  expectedClosedAt,
  state,
  contiguousBefore,
  contiguousAfter,
  chunksPlanned,
  chunksCompleted,
  chunkSummaries,
  blockerCodes,
}) {
  const attemptHash = await stableHash({
    attempt_id: attemptId,
    policy_hash: policy.policy_hash,
    expected_closed_at: expectedClosedAt,
    state,
    contiguous_before: contiguousBefore,
    contiguous_after: contiguousAfter,
    chunks_planned: chunksPlanned,
    chunks_completed: chunksCompleted,
    blocker_codes: blockerCodes,
    chunk_hashes: chunkSummaries.map((chunk) => chunk.chunk_hash),
  });
  const summary = {
    ok: true,
    paper_only: true,
    live_capital_enabled: false,
    research_artifacts_created: false,
    attempt_id: attemptId,
    bootstrap_policy_id: policy.id,
    bootstrap_policy_hash: policy.policy_hash,
    expected_closed_at: expectedClosedAt,
    state,
    contiguous_before: contiguousBefore,
    contiguous_after: contiguousAfter,
    target_contiguous_candles: TARGET_CONTIGUOUS_CANDLES,
    remaining_candles: Math.max(0, TARGET_CONTIGUOUS_CANDLES - contiguousAfter),
    chunks_planned: chunksPlanned,
    chunks_completed: chunksCompleted,
    blocker_codes: blockerCodes,
    chunks: chunkSummaries,
    attempt_hash: attemptHash,
    started_at: startedAt,
    completed_at: completedAt,
  };
  return {
    id: attemptId,
    policy_id: policy.id,
    policy_hash: policy.policy_hash,
    started_at: startedAt,
    completed_at: completedAt,
    state,
    contiguous_before: contiguousBefore,
    contiguous_after: contiguousAfter,
    chunks_planned: chunksPlanned,
    chunks_completed: chunksCompleted,
    blocker_codes_json: JSON.stringify(blockerCodes),
    summary_json: JSON.stringify(summary),
    attempt_hash: attemptHash,
    summary,
  };
}

async function policyRecord(createdAt) {
  return {
    id: POLICY_ID,
    version: HISTORICAL_BOOTSTRAP_POLICY.version,
    policy_json: canonicalJson(HISTORICAL_BOOTSTRAP_POLICY),
    policy_hash: await stableHash(HISTORICAL_BOOTSTRAP_POLICY),
    created_at: createdAt,
  };
}

async function ensurePolicy(env, policy) {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO historical_bootstrap_policies
     (id, version, policy_json, policy_hash, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).bind(policy.id, policy.version, policy.policy_json, policy.policy_hash, policy.created_at).run();
  const stored = await env.DB.prepare(
    `SELECT policy_hash FROM historical_bootstrap_policies WHERE id = ?`,
  ).bind(policy.id).first();
  if (!stored || stored.policy_hash !== policy.policy_hash) throw new Error("bootstrap_policy_hash_conflict");
}

async function persistChunk(env, chunk) {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO historical_bootstrap_chunks (
       id, policy_id, policy_hash, start_closed_at, end_closed_at,
       requested_hours, provider, status, fetched_count, inserted_count,
       duplicate_count, contiguous_before, contiguous_after, blocker_code,
       summary_json, chunk_hash, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    chunk.id, chunk.policy_id, chunk.policy_hash, chunk.start_closed_at,
    chunk.end_closed_at, chunk.requested_hours, chunk.provider, chunk.status,
    chunk.fetched_count, chunk.inserted_count, chunk.duplicate_count,
    chunk.contiguous_before, chunk.contiguous_after, chunk.blocker_code,
    chunk.summary_json, chunk.chunk_hash, chunk.created_at,
  ).run();
  const stored = await env.DB.prepare(
    `SELECT chunk_hash FROM historical_bootstrap_chunks WHERE id = ?`,
  ).bind(chunk.id).first();
  if (!stored || stored.chunk_hash !== chunk.chunk_hash) throw new Error("bootstrap_chunk_hash_conflict");
}

async function persistAttempt(env, attempt) {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO historical_bootstrap_attempts (
       id, policy_id, policy_hash, started_at, completed_at, state,
       contiguous_before, contiguous_after, chunks_planned, chunks_completed,
       blocker_codes_json, summary_json, attempt_hash
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    attempt.id, attempt.policy_id, attempt.policy_hash, attempt.started_at,
    attempt.completed_at, attempt.state, attempt.contiguous_before,
    attempt.contiguous_after, attempt.chunks_planned, attempt.chunks_completed,
    attempt.blocker_codes_json, attempt.summary_json, attempt.attempt_hash,
  ).run();
  const stored = await env.DB.prepare(
    `SELECT summary_json, attempt_hash FROM historical_bootstrap_attempts WHERE id = ?`,
  ).bind(attempt.id).first();
  if (!stored || stored.attempt_hash !== attempt.attempt_hash) throw new Error("bootstrap_attempt_hash_conflict");
  return { ...parseJson(stored.summary_json, "bootstrap_attempt_summary_invalid"), replayed: stored.attempt_hash === attempt.attempt_hash && stored.summary_json !== attempt.summary_json };
}

async function readChunk(env, id) {
  const row = await env.DB.prepare(
    `SELECT id, summary_json FROM historical_bootstrap_chunks WHERE id = ?`,
  ).bind(id).first();
  return row ? { ...parseJson(row.summary_json, "bootstrap_chunk_summary_invalid"), chunk_id: row.id } : null;
}

async function readLatestCompleteAttempt(env) {
  const row = await env.DB.prepare(
    `SELECT id, summary_json FROM historical_bootstrap_attempts
     WHERE state = 'complete' ORDER BY completed_at DESC LIMIT 1`,
  ).first();
  return row ? { ...parseJson(row.summary_json, "bootstrap_attempt_summary_invalid"), attempt_id: row.id } : null;
}

async function readRecentCloses(env, limit) {
  const rows = await env.DB.prepare(
    `SELECT closed_at FROM market_candles
     WHERE pair = ? AND interval = ?
     ORDER BY closed_at DESC LIMIT ?`,
  ).bind(MARKET, INTERVAL, limit).all();
  return resultRows(rows).map((row) => row.closed_at).reverse();
}

function chunkIdFor(window) {
  return `${POLICY_ID}:chunk:${window.start_closed_at}:${window.end_closed_at}`;
}

function normalizeCloses(rawCloses) {
  if (!Array.isArray(rawCloses)) throw new Error("bootstrap_closes_array_required");
  return [...new Set(rawCloses.map((value) => iso(value, "closed_at")))]
    .sort((left, right) => left.localeCompare(right));
}

function trailingContiguousCount(closes) {
  if (closes.length === 0) return 0;
  let count = 1;
  for (let index = closes.length - 1; index > 0; index -= 1) {
    if (Date.parse(closes[index]) - Date.parse(closes[index - 1]) !== HOUR_MS) break;
    count += 1;
  }
  return count;
}

function iso(value, field) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`bootstrap_${field}_invalid`);
  const output = date.toISOString();
  if (date.getTime() % HOUR_MS !== 0 && field !== "started_at") throw new Error(`bootstrap_${field}_not_hour_aligned`);
  return output;
}

function parseJson(value, code) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(code);
  }
}

function resultRows(result) {
  return Array.isArray(result) ? result : Array.isArray(result?.results) ? result.results : [];
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function stableHash(value) {
  const bytes = new TextEncoder().encode(typeof value === "string" ? value : canonicalJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${base64Url(new Uint8Array(digest))}`;
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
