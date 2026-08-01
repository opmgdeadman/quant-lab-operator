import {
  expectedLatestClosedAt,
  runHourlyCandleIngestion,
} from "./marketData.js";
import {
  executePaperDecision,
  getPaperAccountSummary,
} from "./paperLedger.js";

const POLICY_ID = "hourly-forward-paper-v1";
const MARKET = "BTC-USD";
const INTERVAL = "1h";
const HOUR_MS = 60 * 60 * 1000;
const BUY_ALLOCATION_PERCENT = 10;
const MAX_SIGNAL_CANDLES = 100;

export const FORWARD_OPERATION_POLICY = deepFreeze({
  id: POLICY_ID,
  version: 1,
  cadence: "hourly_after_market_data_ingestion",
  market: MARKET,
  interval: INTERVAL,
  champion_source: "latest_immutable_selection_batch",
  execution: "signal_on_previous_closed_candle_execute_at_current_candle_open",
  buy_allocation_percent_of_cash: BUY_ALLOCATION_PERCENT,
  sell_allocation_percent_of_position: 100,
  hold_creates_paper_order: false,
  one_cycle_per_expected_close: true,
  paper_only: true,
  leverage_enabled: false,
  shorting_enabled: false,
  live_capital_enabled: false,
});

export async function runProductionForwardPaperCycle(env, options = {}) {
  const now = iso(options.now || new Date(), "now");
  const expectedClosedAt = options.expectedClosedAt
    ? iso(options.expectedClosedAt, "expected_closed_at")
    : expectedLatestClosedAt(new Date(now));
  const cycleId = `forward-operation:${expectedClosedAt}`;
  const existing = await readCycle(env, cycleId);
  if (existing) return { ...existing, replayed: true };

  const policyHash = await stableHash(FORWARD_OPERATION_POLICY);
  const selection = await readLatestSelection(env);
  const candles = await readCandlesThrough(env, expectedClosedAt, MAX_SIGNAL_CANDLES);
  let championSpec = null;
  let account = null;
  if (selection?.champion_candidate_id) {
    championSpec = await readCandidateSpec(env, selection.champion_candidate_id);
    account = await getPaperAccountSummary(env);
  }

  const plan = buildForwardCyclePlan({
    cycleId,
    scheduledAt: now,
    expectedClosedAt,
    ingestionError: options.ingestionError || null,
    selection,
    championSpec,
    account,
    candles,
  });

  let paperResult = null;
  let state = plan.state;
  const blockerCodes = [...plan.blocker_codes];
  if (plan.paper_decision) {
    try {
      paperResult = await executePaperDecision(env, plan.paper_decision, { now: new Date(now) });
      if (paperResult.status === "filled") state = "filled";
      else if (paperResult.status === "rejected") state = "rejected";
      else {
        state = "error";
        blockerCodes.push(`unexpected_paper_status:${paperResult.status}`);
      }
    } catch (error) {
      state = "error";
      blockerCodes.push(error instanceof Error ? error.message : "paper_execution_failed");
    }
  }

  const result = {
    ok: state !== "error",
    paper_only: true,
    live_capital_enabled: false,
    policy_id: POLICY_ID,
    policy_hash: policyHash,
    cycle_id: cycleId,
    expected_closed_at: expectedClosedAt,
    scheduled_at: now,
    selection_batch_id: selection?.id || null,
    champion_candidate_id: selection?.champion_candidate_id || null,
    market_data_status: plan.market_data_status,
    state,
    blocker_codes: uniqueStrings(blockerCodes),
    decision: plan.decision,
    paper_result: paperResult,
  };
  const cycleHash = await stableHash(result);
  const built = {
    policy: {
      id: POLICY_ID,
      version: FORWARD_OPERATION_POLICY.version,
      policy_json: canonicalJson(FORWARD_OPERATION_POLICY),
      policy_hash: policyHash,
      created_at: now,
    },
    cycle: {
      id: cycleId,
      policy_id: POLICY_ID,
      policy_hash: policyHash,
      expected_closed_at: expectedClosedAt,
      scheduled_at: now,
      selection_batch_id: selection?.id || null,
      champion_candidate_id: selection?.champion_candidate_id || null,
      market_data_status: plan.market_data_status,
      state,
      blocker_codes_json: JSON.stringify(result.blocker_codes),
      decision_id: plan.decision?.id || null,
      paper_cycle_id: plan.paper_decision?.cycle_id || null,
      result_json: JSON.stringify(result),
      cycle_hash: cycleHash,
      created_at: now,
    },
    decision: plan.decision ? {
      ...plan.decision,
      paper_cycle_id: plan.paper_decision?.cycle_id || null,
      paper_status: paperResult?.status || null,
      result_json: JSON.stringify({ plan: plan.decision, paper_result: paperResult }),
      created_at: now,
    } : null,
  };

  const existingPolicy = await readPolicy(env, POLICY_ID);
  if (existingPolicy && existingPolicy.policy_hash !== policyHash) {
    throw new Error("forward_policy_hash_conflict");
  }
  try {
    await persistCycle(env, built, Boolean(existingPolicy));
  } catch (error) {
    const raced = await readCycle(env, cycleId);
    if (raced) return { ...raced, replayed: true };
    throw error;
  }
  return { ...result, cycle_hash: cycleHash, replayed: false };
}

export async function runScheduledForwardOperation(env, scheduledAt = new Date()) {
  const scheduledIso = iso(scheduledAt, "scheduled_at");
  const receiptId = `forward-scheduler:${scheduledIso}`;
  const existing = await readSchedulerReceipt(env, receiptId);
  if (existing) return { ...existing, replayed: true };

  let ingestion = null;
  let ingestionError = null;
  try {
    ingestion = await runHourlyCandleIngestion(env, { now: new Date(scheduledIso) });
  } catch (error) {
    ingestionError = error instanceof Error ? error.message : "market_data_ingestion_failed";
  }

  const forward = await runProductionForwardPaperCycle(env, {
    now: new Date(scheduledIso),
    ingestionError,
  });
  const result = {
    ok: forward.ok,
    paper_only: true,
    live_capital_enabled: false,
    scheduler_receipt_id: receiptId,
    scheduled_at: scheduledIso,
    ingestion_ok: ingestionError === null,
    ingestion_error: ingestionError,
    ingestion,
    forward,
  };
  try {
    await env.DB.prepare(
      `INSERT INTO forward_scheduler_receipts (
         id, scheduled_at, cycle_id, ingestion_ok, ingestion_error,
         forward_state, result_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      receiptId,
      scheduledIso,
      forward.cycle_id,
      ingestionError === null ? 1 : 0,
      ingestionError,
      forward.state,
      JSON.stringify(result),
      new Date().toISOString(),
    ).run();
  } catch (error) {
    const raced = await readSchedulerReceipt(env, receiptId);
    if (raced) return { ...raced, replayed: true };
    throw error;
  }
  return { ...result, replayed: false };
}

export async function commissionForwardPaperOperation(env) {
  const rows = await env.DB.prepare(
    `SELECT closed_at FROM market_candles
     WHERE pair = ? AND interval = ?
     ORDER BY closed_at DESC LIMIT 2`,
  ).bind(MARKET, INTERVAL).all();
  const candles = rows.results || [];
  if (candles.length < 2) throw new Error("forward_commission_requires_two_candles");
  const historicalExpected = candles[1].closed_at;
  return runProductionForwardPaperCycle(env, {
    now: new Date(Date.parse(historicalExpected) + 5 * 60 * 1000),
    expectedClosedAt: historicalExpected,
  });
}

export async function getForwardOperationSummary(env) {
  const [cycle, scheduler] = await Promise.all([
    env.DB.prepare(
      `SELECT id, result_json, created_at FROM forward_operation_cycles
       ORDER BY created_at DESC LIMIT 1`,
    ).first(),
    env.DB.prepare(
      `SELECT id, result_json, created_at FROM forward_scheduler_receipts
       ORDER BY created_at DESC LIMIT 1`,
    ).first(),
  ]);
  if (!cycle && !scheduler) return null;
  return {
    paper_only: true,
    live_capital_enabled: false,
    latest_cycle: cycle ? {
      ...parseJson(cycle.result_json, "forward_cycle_result_invalid"),
      cycle_id: cycle.id,
      created_at: cycle.created_at,
    } : null,
    latest_scheduler_receipt: scheduler ? {
      ...parseJson(scheduler.result_json, "forward_scheduler_result_invalid"),
      scheduler_receipt_id: scheduler.id,
      created_at: scheduler.created_at,
    } : null,
  };
}

export function buildForwardCyclePlan({
  cycleId,
  scheduledAt,
  expectedClosedAt,
  ingestionError,
  selection,
  championSpec,
  account,
  candles,
}) {
  const normalizedCandles = normalizeCandles(candles || []);
  const dataBlockers = [];
  if (ingestionError) dataBlockers.push(`ingestion_error:${ingestionError}`);
  if (normalizedCandles.length === 0) dataBlockers.push("expected_candle_missing");
  const latest = normalizedCandles.at(-1) || null;
  if (latest && latest.closed_at !== expectedClosedAt) dataBlockers.push("expected_candle_missing");
  for (let index = 1; index < normalizedCandles.length; index += 1) {
    if (Date.parse(normalizedCandles[index].closed_at) - Date.parse(normalizedCandles[index - 1].closed_at) !== HOUR_MS) {
      dataBlockers.push("market_data_gap");
      break;
    }
  }
  if (dataBlockers.length > 0) {
    return blockedPlan("blocked_data_unhealthy", "unhealthy", uniqueStrings(dataBlockers));
  }
  if (!selection || selection.state !== "champion_selected" || !selection.champion_candidate_id) {
    return blockedPlan("blocked_no_champion", "healthy", ["no_qualified_champion"]);
  }
  if (!championSpec || championSpec.id !== selection.champion_candidate_id) {
    return blockedPlan("blocked_invalid_champion", "healthy", ["champion_spec_missing_or_mismatched"]);
  }
  if (!account || account.live_capital_enabled !== false || account.accounting_reconciled !== true) {
    return blockedPlan("blocked_invalid_champion", "healthy", ["paper_account_unavailable_or_unreconciled"]);
  }
  if (normalizedCandles.length < 2) {
    return blockedPlan("blocked_data_unhealthy", "unhealthy", ["signal_history_missing"]);
  }

  const executionCandle = normalizedCandles.at(-1);
  const signalCandle = normalizedCandles.at(-2);
  const signalCandles = normalizedCandles.slice(0, -1);
  const signal = championSignal(championSpec, signalCandles, Number(account.position_quantity || 0));
  const decisionId = `${cycleId}:decision`;
  const decision = {
    id: decisionId,
    cycle_id: cycleId,
    candidate_id: championSpec.id,
    action: signal.action,
    signal_closed_at: signalCandle.closed_at,
    decision_at: signalCandle.closed_at,
    execution_candle_closed_at: executionCandle.closed_at,
    requested_notional: signal.action === "buy"
      ? Number(account.cash_balance) * (BUY_ALLOCATION_PERCENT / 100)
      : null,
    requested_quantity: signal.action === "sell"
      ? Number(account.position_quantity)
      : null,
    reason_code: signal.reason_code,
  };
  if (signal.action === "hold") {
    return {
      state: "hold",
      market_data_status: "healthy",
      blocker_codes: [],
      decision,
      paper_decision: null,
    };
  }
  const paperCycleId = `forward-paper:${executionCandle.closed_at}:${championSpec.id}`;
  return {
    state: signal.action === "buy" || signal.action === "sell" ? "hold" : "error",
    market_data_status: "healthy",
    blocker_codes: [],
    decision,
    paper_decision: {
      cycle_id: paperCycleId,
      decision_id: decisionId,
      portfolio_id: "paper-main",
      market: MARKET,
      action: signal.action,
      signal_closed_at: signalCandle.closed_at,
      decision_at: signalCandle.closed_at,
      ...(signal.action === "buy"
        ? { requested_notional_usd: decision.requested_notional }
        : { requested_quantity: decision.requested_quantity }),
    },
  };
}

export function championSignal(spec, candles, positionQuantity) {
  const closes = candles.map((candle) => Number(candle.close));
  const positionOpen = positionQuantity > 0;
  if (spec.kind === "ema_cross") {
    const fast = integer(spec.parameters?.fast, "ema_fast");
    const slow = integer(spec.parameters?.slow, "ema_slow");
    if (!(fast < slow) || closes.length < slow + 1) {
      return { action: "hold", reason_code: "insufficient_ema_history" };
    }
    const previous = closes.slice(0, -1);
    const fastPrevious = ema(previous, fast);
    const slowPrevious = ema(previous, slow);
    const fastCurrent = ema(closes, fast);
    const slowCurrent = ema(closes, slow);
    if (!positionOpen && fastPrevious <= slowPrevious && fastCurrent > slowCurrent) {
      return { action: "buy", reason_code: "ema_bullish_cross" };
    }
    if (positionOpen && fastPrevious >= slowPrevious && fastCurrent < slowCurrent) {
      return { action: "sell", reason_code: "ema_bearish_cross" };
    }
    return { action: "hold", reason_code: "ema_no_cross" };
  }
  if (spec.kind === "rsi_mean_reversion") {
    const period = integer(spec.parameters?.period, "rsi_period");
    const entryBelow = finite(spec.parameters?.entry_below, "rsi_entry");
    const exitAbove = finite(spec.parameters?.exit_above, "rsi_exit");
    const current = rsi(closes, period);
    if (current === null) return { action: "hold", reason_code: "insufficient_rsi_history" };
    if (!positionOpen && current < entryBelow) return { action: "buy", reason_code: "rsi_entry" };
    if (positionOpen && current > exitAbove) return { action: "sell", reason_code: "rsi_exit" };
    return { action: "hold", reason_code: "rsi_no_signal" };
  }
  throw new Error("forward_champion_kind_unsupported");
}

function blockedPlan(state, marketDataStatus, blockerCodes) {
  return {
    state,
    market_data_status: marketDataStatus,
    blocker_codes: blockerCodes,
    decision: null,
    paper_decision: null,
  };
}

async function readLatestSelection(env) {
  return env.DB.prepare(
    `SELECT id, state, champion_candidate_id, summary_json, created_at
     FROM selection_batches ORDER BY created_at DESC LIMIT 1`,
  ).first();
}

async function readCandidateSpec(env, candidateId) {
  const row = await env.DB.prepare(
    `SELECT id, spec_json, spec_hash FROM strategy_candidates WHERE id = ?`,
  ).bind(candidateId).first();
  if (!row) return null;
  const spec = parseJson(row.spec_json, "forward_candidate_spec_invalid");
  return { ...spec, spec_hash: row.spec_hash };
}

async function readCandlesThrough(env, expectedClosedAt, limit) {
  const rows = await env.DB.prepare(
    `SELECT pair AS market, interval, closed_at, open, high, low, close, volume, source
     FROM market_candles
     WHERE pair = ? AND interval = ? AND closed_at <= ?
     ORDER BY closed_at DESC LIMIT ?`,
  ).bind(MARKET, INTERVAL, expectedClosedAt, limit).all();
  return (rows.results || []).reverse();
}

function normalizeCandles(rows) {
  return rows.map((row) => ({
    market: String(row.market || row.pair),
    interval: String(row.interval || INTERVAL),
    closed_at: iso(row.closed_at, "candle_closed_at"),
    open: positive(row.open, "open"),
    high: positive(row.high, "high"),
    low: positive(row.low, "low"),
    close: positive(row.close, "close"),
    volume: nonNegative(row.volume, "volume"),
    source: String(row.source || ""),
  })).sort((left, right) => left.closed_at.localeCompare(right.closed_at));
}

async function persistCycle(env, built, policyExists) {
  const statements = [];
  if (!policyExists) {
    statements.push(env.DB.prepare(
      `INSERT INTO forward_operation_policies (id, version, policy_json, policy_hash, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(built.policy.id, built.policy.version, built.policy.policy_json, built.policy.policy_hash, built.policy.created_at));
  }
  statements.push(env.DB.prepare(
    `INSERT INTO forward_operation_cycles (
       id, policy_id, policy_hash, expected_closed_at, scheduled_at, selection_batch_id,
       champion_candidate_id, market_data_status, state, blocker_codes_json,
       decision_id, paper_cycle_id, result_json, cycle_hash, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    built.cycle.id, built.cycle.policy_id, built.cycle.policy_hash,
    built.cycle.expected_closed_at, built.cycle.scheduled_at, built.cycle.selection_batch_id,
    built.cycle.champion_candidate_id, built.cycle.market_data_status, built.cycle.state,
    built.cycle.blocker_codes_json, built.cycle.decision_id, built.cycle.paper_cycle_id,
    built.cycle.result_json, built.cycle.cycle_hash, built.cycle.created_at,
  ));
  if (built.decision) {
    statements.push(env.DB.prepare(
      `INSERT INTO forward_operation_decisions (
         id, cycle_id, candidate_id, action, signal_closed_at, decision_at,
         execution_candle_closed_at, requested_notional, requested_quantity,
         reason_code, paper_cycle_id, paper_status, result_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      built.decision.id, built.decision.cycle_id, built.decision.candidate_id,
      built.decision.action, built.decision.signal_closed_at, built.decision.decision_at,
      built.decision.execution_candle_closed_at, built.decision.requested_notional,
      built.decision.requested_quantity, built.decision.reason_code,
      built.decision.paper_cycle_id, built.decision.paper_status,
      built.decision.result_json, built.decision.created_at,
    ));
  }
  await env.DB.batch(statements);
}

async function readCycle(env, cycleId) {
  const row = await env.DB.prepare(
    `SELECT id, cycle_hash, result_json, created_at FROM forward_operation_cycles WHERE id = ?`,
  ).bind(cycleId).first();
  if (!row) return null;
  return {
    ...parseJson(row.result_json, "forward_cycle_result_invalid"),
    cycle_id: row.id,
    cycle_hash: row.cycle_hash,
    created_at: row.created_at,
  };
}

async function readSchedulerReceipt(env, receiptId) {
  const row = await env.DB.prepare(
    `SELECT id, result_json, created_at FROM forward_scheduler_receipts WHERE id = ?`,
  ).bind(receiptId).first();
  if (!row) return null;
  return {
    ...parseJson(row.result_json, "forward_scheduler_result_invalid"),
    scheduler_receipt_id: row.id,
    created_at: row.created_at,
  };
}

async function readPolicy(env, policyId) {
  return env.DB.prepare(
    `SELECT id, policy_hash, created_at FROM forward_operation_policies WHERE id = ?`,
  ).bind(policyId).first();
}

function ema(values, period) {
  if (values.length < period) return null;
  const multiplier = 2 / (period + 1);
  let current = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (const value of values.slice(period)) current = (value - current) * multiplier + current;
  return current;
}

function rsi(values, period) {
  if (values.length < period + 1) return null;
  const sample = values.slice(-(period + 1));
  let gains = 0;
  let losses = 0;
  for (let index = 1; index < sample.length; index += 1) {
    const change = sample[index] - sample[index - 1];
    gains += Math.max(change, 0);
    losses += Math.abs(Math.min(change, 0));
  }
  const averageGain = gains / period;
  const averageLoss = losses / period;
  if (averageLoss === 0) return 100;
  const relativeStrength = averageGain / averageLoss;
  return 100 - 100 / (1 + relativeStrength);
}

function integer(value, field) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`forward_invalid_${field}`);
  return number;
}
function finite(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`forward_invalid_${field}`);
  return number;
}
function positive(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`forward_invalid_${field}`);
  return number;
}
function nonNegative(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`forward_invalid_${field}`);
  return number;
}
function uniqueStrings(values) { return [...new Set(values.filter(Boolean))]; }
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
function iso(value, field) {
  const millis = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(millis)) throw new Error(`forward_invalid_${field}`);
  return new Date(millis).toISOString();
}
function parseJson(value, code) { try { return JSON.parse(value); } catch { throw new Error(code); } }
async function stableHash(value) {
  const text = typeof value === "string" ? value : canonicalJson(value);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return `sha256:${base64Url(new Uint8Array(digest))}`;
}
function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}
function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
