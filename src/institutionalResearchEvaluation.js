import { buildWalkForwardWindows } from "./directionalResearch.js";
import { runDirectionalWalkForward } from "./directionalBacktest.js";
import { buildStrategyFromResearchSpec, buildInstitutionalBacktestPolicy, validateInstitutionalResearchSpec } from "./institutionalResearchSpec.js";
import { judgeInstitutionalResearchEvidence } from "./institutionalResearchJudge.js";
import { directionalSignal, applySignedRebalance } from "./directionalShadow.js";

const MARKET = "BTC-USD";
const INTERVAL = "1h";
const FORWARD_INITIAL_EQUITY = 10000;
const FORWARD_SIGNAL_CANDLES = 240;
const ONE_HOUR_MS = 60 * 60 * 1000;
const FORWARD_EPSILON = 1e-9;

export async function runInstitutionalHypothesisEvaluation(env, { hypothesisId, now = new Date() } = {}) {
  requireDatabase(env);
  const hypothesis = await readRegisteredHypothesis(env, hypothesisId);
  if (!["admitted", "testing"].includes(hypothesis.state)) throw new Error("institutional_evaluation_hypothesis_not_admitted");
  const existing = await readEvaluationByHypothesis(env, hypothesis.id);
  if (existing) return { ok: true, paper_only: true, live_capital_enabled: false, evaluation: existing, replayed: true };

  const spec = validateInstitutionalResearchSpec(hypothesis.preregistration);
  const policy = buildInstitutionalBacktestPolicy();
  const asOfClosedAt = await latestClosedAt(env);
  if (!asOfClosedAt) throw new Error("institutional_evaluation_market_history_missing");
  const candles = await readExactHistory(env, asOfClosedAt, policy.required_candles);
  assertContiguousHourly(candles);
  const windows = buildWalkForwardWindows(candles, policy);
  const strategy = buildStrategyFromResearchSpec(hypothesis.id, spec);
  const backtests = runDirectionalWalkForward({ windows, strategies: [strategy], policy });
  const candidate = backtests[0];
  if (!candidate || candidate.candidate_id !== hypothesis.id) throw new Error("institutional_evaluation_candidate_identity_mismatch");

  const regimes = windows.map(classifyTestRegime);
  const tradedRegimes = new Set(candidate.windows.map((row, index) => row.closed_trade_count > 0 ? regimes[index] : null).filter(Boolean));
  const testReturns = candidate.windows.map((row) => Number(row.test_return_percent));
  const doubledReturns = candidate.windows.map((row) => Number(row.doubled_cost_return_percent));
  const tripledReturns = candidate.windows.map((row) => Number(row.tripled_cost_return_percent));
  const drawdowns = candidate.windows.map((row) => Number(row.test_drawdown_percent));
  const artifact = {
    hypothesis_id: hypothesis.id,
    preregistration_hash: hypothesis.preregistration_hash,
    dataset_id: spec.dataset_id,
    strategy_template: spec.strategy.template,
    feature_set_id: spec.strategy.feature_set_id,
    as_of_closed_at: asOfClosedAt,
    candle_start_closed_at: candles[0].closed_at,
    candle_end_closed_at: candles.at(-1).closed_at,
    candle_count: candles.length,
    window_count: windows.length,
    total_closed_trades: sum(candidate.windows.map((row) => row.closed_trade_count)),
    positive_test_windows: testReturns.filter((value) => value > 0).length,
    median_test_return_percent: median(testReturns),
    worst_test_drawdown_percent: Math.max(...drawdowns),
    doubled_cost_median_return_percent: median(doubledReturns),
    tripled_cost_median_return_percent: median(tripledReturns),
    distinct_traded_regimes: tradedRegimes.size,
    evidence_integrity_passed: candidate.windows.length === windows.length && candidate.windows.every((row) => row.evidence_integrity_passed === true),
    execution_model: "next_completed_candle_open",
    caller_supplied_performance_metrics: false,
    windows: candidate.windows.map((row, index) => ({
      window_id: row.window_id,
      regime: regimes[index],
      test_return_percent: row.test_return_percent,
      doubled_cost_return_percent: row.doubled_cost_return_percent,
      tripled_cost_return_percent: row.tripled_cost_return_percent,
      test_drawdown_percent: row.test_drawdown_percent,
      closed_trade_count: row.closed_trade_count,
      fill_count: row.fill_count,
      evidence_integrity_passed: row.evidence_integrity_passed,
      execution_model: row.execution_model,
    })),
  };
  const artifactHash = await hashObject(artifact);
  const createdAt = iso(now, "created_at");
  const evaluation = {
    id: `${hypothesis.id}:evaluation:v1`,
    hypothesis_id: hypothesis.id,
    preregistration_hash: hypothesis.preregistration_hash,
    as_of_closed_at: asOfClosedAt,
    candle_start_closed_at: candles[0].closed_at,
    candle_end_closed_at: candles.at(-1).closed_at,
    artifact,
    artifact_hash: artifactHash,
    created_at: createdAt,
  };

  try {
    await env.DB.prepare(
      `INSERT INTO institutional_research_evaluations
       (id, hypothesis_id, preregistration_hash, as_of_closed_at, candle_start_closed_at, candle_end_closed_at, artifact_json, artifact_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      evaluation.id, evaluation.hypothesis_id, evaluation.preregistration_hash, evaluation.as_of_closed_at,
      evaluation.candle_start_closed_at, evaluation.candle_end_closed_at, JSON.stringify(evaluation.artifact),
      evaluation.artifact_hash, evaluation.created_at,
    ).run();
  } catch (error) {
    const raced = await readEvaluationByHypothesis(env, hypothesis.id);
    if (raced?.artifact_hash === artifactHash) return { ok: true, paper_only: true, live_capital_enabled: false, evaluation: raced, replayed: true };
    throw error;
  }
  return { ok: true, paper_only: true, live_capital_enabled: false, evaluation, replayed: false };
}

export async function runInstitutionalIndependentJudge(env, { hypothesisId, now = new Date() } = {}) {
  requireDatabase(env);
  const hypothesis = await readRegisteredHypothesis(env, hypothesisId);
  if (!["testing", "qualified", "rejected"].includes(hypothesis.state)) throw new Error("institutional_judge_hypothesis_not_testing");
  const evaluation = await readEvaluationByHypothesis(env, hypothesis.id);
  if (!evaluation) throw new Error("institutional_judge_sealed_evaluation_missing");
  if (evaluation.preregistration_hash !== hypothesis.preregistration_hash) throw new Error("institutional_judge_preregistration_hash_mismatch");

  const forwardRows = await readForwardEvidence(env, hypothesis.id);
  const forwardEvidence = aggregateForwardEvidence(forwardRows);
  const verdict = judgeInstitutionalResearchEvidence({ artifact: evaluation.artifact, forwardEvidence });
  const evidenceHash = await hashObject({ evaluation_artifact_hash: evaluation.artifact_hash, forward_evidence_hashes: forwardRows.map((row) => row.evidence_hash) });
  const existing = await readVerdictByEvidenceHash(env, hypothesis.id, evidenceHash);
  if (existing) return { ok: true, paper_only: true, live_capital_enabled: false, verdict: existing, replayed: true };

  const sequence = await nextVerdictSequence(env, hypothesis.id);
  const createdAt = iso(now, "created_at");
  const record = {
    id: `${hypothesis.id}:verdict:${String(sequence).padStart(4, "0")}`,
    hypothesis_id: hypothesis.id,
    evaluation_id: evaluation.id,
    sequence,
    forward_evidence_count: forwardRows.length,
    evidence_hash: evidenceHash,
    verdict: verdict.verdict,
    reason_codes: verdict.reason_codes,
    verdict_payload: verdict,
    created_at: createdAt,
  };
  const verdictHash = await hashObject(record);
  await env.DB.prepare(
    `INSERT INTO institutional_research_verdicts
     (id, hypothesis_id, evaluation_id, sequence, forward_evidence_count, evidence_hash, verdict, reason_codes_json, verdict_json, verdict_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    record.id, record.hypothesis_id, record.evaluation_id, record.sequence, record.forward_evidence_count,
    record.evidence_hash, record.verdict, JSON.stringify(record.reason_codes), JSON.stringify(record.verdict_payload),
    verdictHash, record.created_at,
  ).run();
  return { ok: true, paper_only: true, live_capital_enabled: false, verdict: { ...record, verdict_hash: verdictHash }, replayed: false };
}

export function isInstitutionalForwardExecutionEligible({ testingStartedAt, signalClosedAt, executionClosedAt }) {
  const testing = Date.parse(iso(testingStartedAt, "testing_started_at"));
  const signal = Date.parse(iso(signalClosedAt, "signal_closed_at"));
  const execution = Date.parse(iso(executionClosedAt, "execution_closed_at"));
  return signal > testing && execution - signal === ONE_HOUR_MS;
}

export async function runScheduledInstitutionalResearchForwardEvidence(env, { now = new Date() } = {}) {
  requireDatabase(env);
  const runAt = iso(now, "forward_run_at");
  const hypotheses = await readForwardTestingHypotheses(env);
  const results = [];
  for (const hypothesis of hypotheses) {
    const historical = judgeInstitutionalResearchEvidence({ artifact: hypothesis.artifact, forwardEvidence: null });
    if (!historical.historical_passed) {
      results.push({ hypothesis_id: hypothesis.id, state: "blocked_historical_gate", evidence_written: false });
      continue;
    }
    results.push(await runInstitutionalForwardCycle(env, hypothesis, runAt));
  }
  return {
    ok: true,
    paper_only: true,
    live_capital_enabled: false,
    stage13_promotion_authority_changed: false,
    testing_hypothesis_count: hypotheses.length,
    evidence_written_count: results.filter((row) => row.evidence_written === true).length,
    results,
  };
}

async function runInstitutionalForwardCycle(env, hypothesis, runAt) {
  const candles = await readRecentForwardCandles(env, FORWARD_SIGNAL_CANDLES + 1);
  if (candles.length < 3) return { hypothesis_id: hypothesis.id, state: "waiting_for_market_data", evidence_written: false };
  assertContiguousHourly(candles);
  const executionCandle = candles.at(-1);
  const signalCandles = candles.slice(0, -1);
  const signalCandle = signalCandles.at(-1);
  if (!isInstitutionalForwardExecutionEligible({
    testingStartedAt: hypothesis.testing_started_at,
    signalClosedAt: signalCandle.closed_at,
    executionClosedAt: executionCandle.closed_at,
  })) {
    return {
      hypothesis_id: hypothesis.id,
      state: "waiting_for_post_testing_signal",
      evidence_written: false,
      testing_started_at: hypothesis.testing_started_at,
      signal_closed_at: signalCandle.closed_at,
      execution_closed_at: executionCandle.closed_at,
    };
  }

  const cycleId = `institutional-research-forward:${hypothesis.id}:${executionCandle.closed_at}`;
  const existing = await readForwardEvidenceCycle(env, cycleId);
  if (existing) return { hypothesis_id: hypothesis.id, state: "replayed", evidence_written: false, replayed: true, evidence: existing };

  const spec = validateInstitutionalResearchSpec(hypothesis.preregistration);
  await ensureForwardPortfolio(env, hypothesis, signalCandle, runAt);
  const portfolio = await readForwardPortfolio(env, hypothesis.id);
  if (!portfolio) throw new Error("institutional_forward_portfolio_missing");
  if (portfolio.testing_started_at !== hypothesis.testing_started_at) throw new Error("institutional_forward_testing_boundary_conflict");
  if (portfolio.last_marked_at !== signalCandle.closed_at) {
    return {
      hypothesis_id: hypothesis.id,
      state: "blocked_forward_gap",
      evidence_written: false,
      expected_signal_closed_at: portfolio.last_marked_at,
      actual_signal_closed_at: signalCandle.closed_at,
    };
  }

  const strategy = { id: hypothesis.id, family: spec.strategy.template, market: MARKET, interval: INTERVAL, parameters: spec.strategy.parameters };
  const priorExposure = signedForwardExposure(portfolio.position_quantity);
  const signal = directionalSignal(strategy, signalCandles, priorExposure);
  const transition = applySignedRebalance({
    portfolio,
    targetExposure: signal.target_exposure,
    executionPrice: executionCandle.open,
    markPrice: executionCandle.close,
    hoursElapsed: 1,
  });
  const nextExposure = signedForwardExposure(transition.position_quantity);
  const closedTradeCount = portfolio.closed_trade_count + (priorExposure !== 0 && nextExposure !== priorExposure ? 1 : 0);
  const returnPercent = ((transition.equity / portfolio.initial_equity) - 1) * 100;
  const evidenceIntegrityPassed = isInstitutionalForwardExecutionEligible({
    testingStartedAt: hypothesis.testing_started_at,
    signalClosedAt: signalCandle.closed_at,
    executionClosedAt: executionCandle.closed_at,
  }) && transition.entry_gross_exposure_multiple <= 1 + 1e-7;
  const status = nextExposure === 0 && Math.abs(transition.quantity_delta) <= FORWARD_EPSILON ? "flat" : transition.status;
  const evidenceCore = {
    hypothesis_id: hypothesis.id,
    cycle_id: cycleId,
    expected_closed_at: executionCandle.closed_at,
    target_exposure: signal.target_exposure,
    status,
    equity: transition.equity,
    return_percent: returnPercent,
    max_drawdown_percent: transition.max_drawdown_percent,
    closed_trade_count: closedTradeCount,
    evidence_integrity_passed: evidenceIntegrityPassed,
  };
  const evidenceHash = await hashObject(evidenceCore);
  const evidenceId = `${hypothesis.id}:forward:${executionCandle.closed_at}`;

  const updatePortfolio = env.DB.prepare(
    `UPDATE institutional_research_forward_portfolios SET
       cash_balance = ?, position_quantity = ?, average_entry = ?, realized_pnl = ?, unrealized_pnl = ?,
       total_fees = ?, total_carry = ?, equity = ?, peak_equity = ?, max_drawdown_percent = ?,
       gross_exposure_multiple = ?, closed_trade_count = ?, version = version + 1, last_cycle_id = ?,
       last_mark_price = ?, last_marked_at = ?, updated_at = ?
     WHERE hypothesis_id = ? AND version = ?`,
  ).bind(
    transition.cash_balance, transition.position_quantity, transition.average_entry, transition.realized_pnl,
    transition.unrealized_pnl, transition.total_fees, transition.total_carry, transition.equity,
    transition.peak_equity, transition.max_drawdown_percent, transition.gross_exposure_multiple,
    closedTradeCount, cycleId, executionCandle.close, executionCandle.closed_at, runAt, hypothesis.id, portfolio.version,
  );
  const insertEvidence = env.DB.prepare(
    `INSERT INTO institutional_research_forward_evidence
     (id, hypothesis_id, cycle_id, expected_closed_at, target_exposure, status, equity, return_percent,
      max_drawdown_percent, closed_trade_count, evidence_integrity_passed, evidence_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    evidenceId, hypothesis.id, cycleId, executionCandle.closed_at, signal.target_exposure, status,
    transition.equity, returnPercent, transition.max_drawdown_percent, closedTradeCount,
    evidenceIntegrityPassed ? 1 : 0, evidenceHash, runAt,
  );
  try {
    await env.DB.batch([updatePortfolio, insertEvidence]);
  } catch (error) {
    const raced = await readForwardEvidenceCycle(env, cycleId);
    if (raced?.evidence_hash === evidenceHash) return { hypothesis_id: hypothesis.id, state: "replayed", evidence_written: false, replayed: true, evidence: raced };
    throw error;
  }
  return {
    hypothesis_id: hypothesis.id,
    state: "evidence_appended",
    evidence_written: true,
    replayed: false,
    signal_closed_at: signalCandle.closed_at,
    execution_closed_at: executionCandle.closed_at,
    reason_code: signal.reason_code,
    fee: transition.fee,
    carry: transition.carry,
    gross_exposure_multiple: transition.gross_exposure_multiple,
    evidence: { ...evidenceCore, id: evidenceId, evidence_hash: evidenceHash, created_at: runAt },
  };
}

export async function getInstitutionalEvaluationSummary(env, hypothesisId = null) {
  requireDatabase(env);
  const evaluations = hypothesisId
    ? (await env.DB.prepare(`SELECT * FROM institutional_research_evaluations WHERE hypothesis_id = ? ORDER BY created_at DESC`).bind(hypothesisId).all()).results || []
    : (await env.DB.prepare(`SELECT * FROM institutional_research_evaluations ORDER BY created_at DESC LIMIT 100`).all()).results || [];
  const verdicts = hypothesisId
    ? (await env.DB.prepare(`SELECT * FROM institutional_research_verdicts WHERE hypothesis_id = ? ORDER BY sequence DESC`).bind(hypothesisId).all()).results || []
    : (await env.DB.prepare(`SELECT * FROM institutional_research_verdicts ORDER BY created_at DESC LIMIT 200`).all()).results || [];
  return {
    ok: true,
    paper_only: true,
    live_capital_enabled: false,
    stage13_promotion_authority_changed: false,
    evaluation_count: evaluations.length,
    verdict_count: verdicts.length,
    evaluations: evaluations.map(decodeEvaluationRow),
    verdicts: verdicts.map(decodeVerdictRow),
  };
}

async function readForwardTestingHypotheses(env) {
  const rows = (await env.DB.prepare(
    `SELECT h.id, h.preregistration_json, h.preregistration_hash,
            e.artifact_json, e.artifact_hash, ev.created_at AS testing_started_at
     FROM institutional_hypotheses h
     JOIN institutional_research_evaluations e ON e.hypothesis_id = h.id
     JOIN institutional_hypothesis_events ev ON ev.hypothesis_id = h.id
     WHERE ev.sequence = (
       SELECT MAX(ev2.sequence) FROM institutional_hypothesis_events ev2 WHERE ev2.hypothesis_id = h.id
     ) AND ev.to_state = 'testing'
     ORDER BY ev.created_at ASC, h.id ASC`,
  ).all()).results || [];
  return rows.map((row) => ({
    id: row.id,
    preregistration_hash: row.preregistration_hash,
    preregistration: JSON.parse(row.preregistration_json),
    artifact_hash: row.artifact_hash,
    artifact: JSON.parse(row.artifact_json),
    testing_started_at: row.testing_started_at,
  }));
}

async function readRecentForwardCandles(env, limit) {
  const rows = (await env.DB.prepare(
    `SELECT pair, interval, closed_at, open, high, low, close, volume, source
     FROM market_candles WHERE pair = ? AND interval = ? ORDER BY closed_at DESC LIMIT ?`,
  ).bind(MARKET, INTERVAL, limit).all()).results || [];
  return rows.reverse().map((row) => ({
    ...row,
    open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close), volume: Number(row.volume || 0),
  }));
}

async function ensureForwardPortfolio(env, hypothesis, signalCandle, createdAt) {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO institutional_research_forward_portfolios
     (hypothesis_id, testing_started_at, initial_equity, cash_balance, position_quantity, average_entry,
      realized_pnl, unrealized_pnl, total_fees, total_carry, equity, peak_equity, max_drawdown_percent,
      gross_exposure_multiple, closed_trade_count, version, last_cycle_id, last_mark_price, last_marked_at,
      created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0, 0, ?, ?, 0, 0, 0, 0, NULL, ?, ?, ?, ?)`,
  ).bind(
    hypothesis.id, hypothesis.testing_started_at, FORWARD_INITIAL_EQUITY, FORWARD_INITIAL_EQUITY,
    FORWARD_INITIAL_EQUITY, FORWARD_INITIAL_EQUITY, signalCandle.close, signalCandle.closed_at,
    createdAt, createdAt,
  ).run();
}

async function readForwardPortfolio(env, hypothesisId) {
  const row = await env.DB.prepare(`SELECT * FROM institutional_research_forward_portfolios WHERE hypothesis_id = ?`).bind(hypothesisId).first();
  if (!row) return null;
  return {
    id: `institutional-forward:${row.hypothesis_id}`,
    candidate_id: row.hypothesis_id,
    hypothesis_id: row.hypothesis_id,
    testing_started_at: row.testing_started_at,
    initial_equity: Number(row.initial_equity),
    cash_balance: Number(row.cash_balance),
    position_quantity: Number(row.position_quantity),
    average_entry: Number(row.average_entry),
    realized_pnl: Number(row.realized_pnl),
    unrealized_pnl: Number(row.unrealized_pnl),
    total_fees: Number(row.total_fees),
    total_carry: Number(row.total_carry),
    equity: Number(row.equity),
    peak_equity: Number(row.peak_equity),
    max_drawdown_percent: Number(row.max_drawdown_percent),
    gross_exposure_multiple: Number(row.gross_exposure_multiple),
    closed_trade_count: Number(row.closed_trade_count),
    version: Number(row.version),
    last_cycle_id: row.last_cycle_id || null,
    last_mark_price: row.last_mark_price === null ? null : Number(row.last_mark_price),
    last_marked_at: row.last_marked_at || null,
  };
}

async function readForwardEvidenceCycle(env, cycleId) {
  const row = await env.DB.prepare(`SELECT * FROM institutional_research_forward_evidence WHERE cycle_id = ?`).bind(cycleId).first();
  if (!row) return null;
  return {
    ...row,
    target_exposure: Number(row.target_exposure),
    equity: Number(row.equity),
    return_percent: Number(row.return_percent),
    max_drawdown_percent: Number(row.max_drawdown_percent),
    closed_trade_count: Number(row.closed_trade_count),
    evidence_integrity_passed: Boolean(row.evidence_integrity_passed),
  };
}

function signedForwardExposure(quantity) {
  const value = Number(quantity);
  if (value > FORWARD_EPSILON) return 1;
  if (value < -FORWARD_EPSILON) return -1;
  return 0;
}

async function readRegisteredHypothesis(env, hypothesisId) {
  const id = cleanId(hypothesisId);
  const row = await env.DB.prepare(
    `SELECT id, preregistration_json, preregistration_hash FROM institutional_hypotheses WHERE id = ?`,
  ).bind(id).first();
  if (!row) throw new Error("institutional_hypothesis_not_found");
  const event = await env.DB.prepare(
    `SELECT to_state FROM institutional_hypothesis_events WHERE hypothesis_id = ? ORDER BY sequence DESC LIMIT 1`,
  ).bind(id).first();
  return {
    id: row.id,
    preregistration: JSON.parse(row.preregistration_json),
    preregistration_hash: row.preregistration_hash,
    state: event?.to_state || "unknown",
  };
}

async function readEvaluationByHypothesis(env, hypothesisId) {
  const row = await env.DB.prepare(`SELECT * FROM institutional_research_evaluations WHERE hypothesis_id = ?`).bind(hypothesisId).first();
  return row ? decodeEvaluationRow(row) : null;
}

async function readVerdictByEvidenceHash(env, hypothesisId, evidenceHash) {
  const row = await env.DB.prepare(
    `SELECT * FROM institutional_research_verdicts WHERE hypothesis_id = ? AND evidence_hash = ? ORDER BY sequence DESC LIMIT 1`,
  ).bind(hypothesisId, evidenceHash).first();
  return row ? decodeVerdictRow(row) : null;
}

async function nextVerdictSequence(env, hypothesisId) {
  const row = await env.DB.prepare(
    `SELECT MAX(sequence) AS sequence FROM institutional_research_verdicts WHERE hypothesis_id = ?`,
  ).bind(hypothesisId).first();
  return Number(row?.sequence || 0) + 1;
}

async function readForwardEvidence(env, hypothesisId) {
  const rows = (await env.DB.prepare(
    `SELECT cycle_id, expected_closed_at, target_exposure, status, equity, return_percent, max_drawdown_percent, closed_trade_count, evidence_integrity_passed, evidence_hash
     FROM institutional_research_forward_evidence WHERE hypothesis_id = ? ORDER BY expected_closed_at ASC, cycle_id ASC`,
  ).bind(hypothesisId).all()).results || [];
  return rows.map((row) => ({
    ...row,
    target_exposure: Number(row.target_exposure),
    equity: Number(row.equity),
    return_percent: Number(row.return_percent),
    max_drawdown_percent: Number(row.max_drawdown_percent),
    closed_trade_count: Number(row.closed_trade_count),
    evidence_integrity_passed: Boolean(row.evidence_integrity_passed),
  }));
}

function aggregateForwardEvidence(rows) {
  if (!rows.length) return { cycle_count: 0, closed_trade_count: 0, return_percent: 0, max_drawdown_percent: 0, evidence_integrity_passed: false };
  const latest = rows.at(-1);
  return {
    cycle_count: rows.length,
    closed_trade_count: Number(latest.closed_trade_count || 0),
    return_percent: Number(latest.return_percent || 0),
    max_drawdown_percent: Math.max(...rows.map((row) => Number(row.max_drawdown_percent || 0))),
    evidence_integrity_passed: rows.every((row) => row.evidence_integrity_passed === true),
  };
}

async function latestClosedAt(env) {
  const row = await env.DB.prepare(
    `SELECT closed_at FROM market_candles WHERE pair = ? AND interval = ? ORDER BY closed_at DESC LIMIT 1`,
  ).bind(MARKET, INTERVAL).first();
  return row?.closed_at || null;
}

async function readExactHistory(env, asOfClosedAt, required) {
  const rows = (await env.DB.prepare(
    `SELECT pair AS market, interval, closed_at, open, high, low, close, volume
     FROM (
       SELECT pair, interval, closed_at, open, high, low, close, volume
       FROM market_candles
       WHERE pair = ? AND interval = ? AND closed_at <= ?
       ORDER BY closed_at DESC LIMIT ?
     ) ORDER BY closed_at ASC`,
  ).bind(MARKET, INTERVAL, asOfClosedAt, required).all()).results || [];
  if (rows.length !== required) throw new Error(`institutional_evaluation_requires_${required}_candles`);
  return rows.map((row) => ({ ...row, open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close), volume: Number(row.volume) }));
}

function assertContiguousHourly(candles) {
  for (let index = 1; index < candles.length; index += 1) {
    if (Date.parse(candles[index].closed_at) - Date.parse(candles[index - 1].closed_at) !== 3600000) throw new Error("institutional_evaluation_history_gap");
  }
}

function classifyTestRegime(window) {
  const start = Number(window.test[0].close);
  const end = Number(window.test.at(-1).close);
  const move = ((end / start) - 1) * 100;
  return move > 2 ? "up" : move < -2 ? "down" : "sideways";
}

function decodeEvaluationRow(row) {
  return { ...row, artifact: typeof row.artifact_json === "string" ? JSON.parse(row.artifact_json) : row.artifact, artifact_json: undefined };
}
function decodeVerdictRow(row) {
  return {
    ...row,
    reason_codes: typeof row.reason_codes_json === "string" ? JSON.parse(row.reason_codes_json) : row.reason_codes,
    verdict_payload: typeof row.verdict_json === "string" ? JSON.parse(row.verdict_json) : row.verdict_payload,
    reason_codes_json: undefined,
    verdict_json: undefined,
  };
}
function cleanId(value) { const text = String(value || ""); if (!/^[a-z0-9][a-z0-9-]{2,99}$/.test(text)) throw new Error("institutional_hypothesis_id_invalid"); return text; }
function sum(values) { return values.reduce((total, value) => total + Number(value || 0), 0); }
function median(values) { const sorted = values.map(Number).sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; }
function requireDatabase(env) { if (!env?.DB) throw new Error("institutional_evaluation_database_required"); }
function iso(value, field) { const date = value instanceof Date ? value : new Date(value); if (Number.isNaN(date.getTime())) throw new Error(`institutional_evaluation_${field}_invalid`); return date.toISOString(); }
async function hashObject(value) { const bytes = new TextEncoder().encode(stableStringify(value)); const digest = await crypto.subtle.digest("SHA-256", bytes); return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
function stableStringify(value) { if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`; return JSON.stringify(value); }
