import { expectedLatestClosedAt, runHourlyCandleIngestion } from "./marketData.js";
import { applySignedRebalance, directionalSignal } from "./directionalShadow.js";

const POLICY_ID = "directional-forward-paper-v2";
const PORTFOLIO_ID = "paper-main-directional";
const MARKET = "BTC-USD";
const INTERVAL = "1h";
const INITIAL_EQUITY = 10000;
const HOUR_MS = 3600000;
const EPSILON = 1e-9;

export const DIRECTIONAL_FORWARD_POLICY = freeze({
  id: POLICY_ID, version: 1, cadence: "hourly_after_market_data_ingestion",
  authority_source: "directional_institutional_research", legacy_selection_authority: false,
  selection_rule: "latest_immutable_qualified_only_directional_portfolio",
  all_cash_when_no_candidate_qualifies: true, allowed_directions: ["long", "flat", "short"],
  max_entry_gross_exposure_multiple: 1, execution: "next_completed_candle_open",
  valuation: "execution_candle_close", completed_candles_only: true,
  one_cycle_per_expected_close: true, paper_only: true, live_capital_enabled: false,
});

export async function runDirectionalMainForwardCycle(env, options = {}) {
  const now = iso(options.now || new Date(), "now");
  const expected = options.expectedClosedAt ? iso(options.expectedClosedAt, "expected_closed_at") : expectedLatestClosedAt(new Date(now));
  const cycleId = `directional-forward:${expected}`;
  const replay = await readCycle(env, cycleId);
  if (replay) return { ...replay, replayed: true };
  const policyHash = await hash(DIRECTIONAL_FORWARD_POLICY);
  await ensureDefinitions(env, policyHash, now);
  const [selection, portfolio, candles] = await Promise.all([readSelection(env), readPortfolio(env), readCandles(env, expected)]);
  if (!portfolio) throw new Error("directional_main_portfolio_missing");
  const championId = selection?.champion_candidate_ids?.[0] || null;
  const candidate = championId ? await readCandidate(env, championId) : null;
  const plan = buildDirectionalMainPlan({
    cycleId, scheduledAt: now, expectedClosedAt: expected, ingestionError: options.ingestionError || null,
    selection, candidate, portfolio, candles,
  });
  const result = {
    ok: plan.state !== "error", paper_only: true, live_capital_enabled: false,
    authority_source: "directional_institutional_research", legacy_selection_authority: false,
    policy_id: POLICY_ID, policy_hash: policyHash, cycle_id: cycleId,
    expected_closed_at: expected, scheduled_at: now, selection_id: selection?.id || null,
    research_batch_id: selection?.batch_id || null, selection_state: selection?.state || "missing",
    champion_candidate_id: championId, market_data_status: plan.market_data_status,
    state: plan.state, blocker_codes: plan.blocker_codes, decision: plan.decision,
    paper_result: plan.transition ? compact(plan.transition) : null,
  };
  const cycleHash = await hash(result);
  await persist(env, { now, selection, portfolio, championId, plan, result, policyHash, cycleHash });
  return { ...result, cycle_hash: cycleHash, replayed: false };
}

export async function runScheduledDirectionalMainForward(env, scheduledAt = new Date()) {
  const scheduled = iso(scheduledAt, "scheduled_at");
  const id = `directional-forward-scheduler:${scheduled}`;
  const replay = await readReceipt(env, id);
  if (replay) return { ...replay, replayed: true };
  let ingestion = null;
  let ingestionError = null;
  try { ingestion = await runHourlyCandleIngestion(env, { now: new Date(scheduled) }); }
  catch (error) { ingestionError = error instanceof Error ? error.message : "market_data_ingestion_failed"; }
  const forward = await runDirectionalMainForwardCycle(env, { now: new Date(scheduled), ingestionError });
  const result = {
    ok: forward.ok, paper_only: true, live_capital_enabled: false, scheduler_receipt_id: id,
    scheduled_at: scheduled, ingestion_ok: ingestionError === null, ingestion_error: ingestionError, ingestion, forward,
  };
  try {
    await env.DB.prepare(`INSERT INTO directional_forward_scheduler_receipts
      (id, scheduled_at, cycle_id, ingestion_ok, ingestion_error, forward_state, result_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, scheduled, forward.cycle_id, ingestionError === null ? 1 : 0, ingestionError, forward.state, JSON.stringify(result), new Date().toISOString()).run();
  } catch (error) {
    const raced = await readReceipt(env, id);
    if (raced) return { ...raced, replayed: true };
    throw error;
  }
  return { ...result, replayed: false };
}

export async function commissionDirectionalMainForward(env) {
  const row = await env.DB.prepare(`SELECT closed_at FROM market_candles
    WHERE pair = ? AND interval = ? ORDER BY closed_at DESC LIMIT 1`).bind(MARKET, INTERVAL).first();
  if (!row?.closed_at) throw new Error("directional_forward_commission_requires_candle");
  return runDirectionalMainForwardCycle(env, { now: new Date(Date.parse(row.closed_at) + 600000), expectedClosedAt: row.closed_at });
}

export async function getDirectionalMainForwardSummary(env) {
  const [cycle, receipt, portfolio, selection, execution, counts] = await Promise.all([
    env.DB.prepare(`SELECT id, result_json, created_at FROM directional_forward_cycles ORDER BY expected_closed_at DESC LIMIT 1`).first(),
    env.DB.prepare(`SELECT id, result_json, created_at FROM directional_forward_scheduler_receipts ORDER BY scheduled_at DESC LIMIT 1`).first(),
    readPortfolio(env), readSelection(env),
    env.DB.prepare(`SELECT id, result_json, created_at FROM directional_forward_executions ORDER BY execution_candle_closed_at DESC LIMIT 1`).first(),
    env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM directional_forward_cycles) AS cycle_count,
      (SELECT COUNT(*) FROM directional_forward_executions) AS execution_count,
      (SELECT COUNT(*) FROM directional_forward_executions WHERE closed_trade = 1) AS closed_trade_count`).first(),
  ]);
  return {
    paper_only: true, live_capital_enabled: false,
    authority: {
      source: "directional_institutional_research", legacy_selection_authority: false,
      selection_id: selection?.id || null, research_batch_id: selection?.batch_id || null,
      selection_state: selection?.state || "missing", champion_candidate_id: selection?.champion_candidate_ids?.[0] || null,
      cash_is_valid_allocation: selection?.cash_is_valid_allocation !== false,
    },
    paper_main: portfolio ? { ...summaryPortfolio(portfolio), cycle_count: Number(counts?.cycle_count || 0), fill_count: Number(counts?.execution_count || 0), closed_trade_count: Number(counts?.closed_trade_count || 0) } : null,
    latest_cycle: cycle ? { ...json(cycle.result_json, "directional_forward_cycle_result_invalid"), cycle_id: cycle.id, created_at: cycle.created_at } : null,
    latest_scheduler_receipt: receipt ? { ...json(receipt.result_json, "directional_forward_scheduler_result_invalid"), scheduler_receipt_id: receipt.id, created_at: receipt.created_at } : null,
    latest_execution: execution ? { ...json(execution.result_json, "directional_forward_execution_result_invalid"), execution_id: execution.id, created_at: execution.created_at } : null,
  };
}

export function buildDirectionalMainPlan({ cycleId, expectedClosedAt, ingestionError, selection, candidate, portfolio, candles }) {
  let rows;
  try { rows = normalizeCandles(candles || []); }
  catch (error) { return blocked("blocked_data_unhealthy", "unhealthy", [error.message]); }
  const blockers = [];
  if (ingestionError) blockers.push(`ingestion_error:${ingestionError}`);
  if (rows.length < 2) blockers.push("signal_history_missing");
  if (rows.at(-1)?.closed_at !== expectedClosedAt) blockers.push("expected_candle_missing");
  if (rows.some((row, index) => index && Date.parse(row.closed_at) - Date.parse(rows[index - 1].closed_at) !== HOUR_MS)) blockers.push("market_data_gap");
  if (blockers.length) return blocked("blocked_data_unhealthy", "unhealthy", [...new Set(blockers)]);
  const execution = rows.at(-1);
  const signalRows = rows.slice(0, -1);
  const priorExposure = side(portfolio.position_quantity);
  const championId = selection?.champion_candidate_ids?.[0] || null;
  if (selection?.state !== "portfolio_selected" || !championId) {
    if (Math.abs(Number(portfolio.position_quantity)) <= EPSILON) return blocked("blocked_no_champion", "healthy", ["no_qualified_directional_candidate"]);
    return transitionPlan(cycleId, selection, null, priorExposure, 0, "qualified_only_all_cash_liquidation", signalRows, execution,
      applySignedRebalance({ portfolio, targetExposure: 0, executionPrice: execution.open, markPrice: execution.close, hoursElapsed: elapsed(portfolio.last_marked_at, execution.closed_at) }),
      ["no_qualified_directional_candidate"]);
  }
  if (!candidate || candidate.id !== championId) return blocked("blocked_invalid_champion", "healthy", ["directional_candidate_missing_or_mismatched"]);
  const signal = directionalSignal(candidate, signalRows, priorExposure);
  return transitionPlan(cycleId, selection, candidate, priorExposure, signal.target_exposure, signal.reason_code, signalRows, execution,
    applySignedRebalance({ portfolio, targetExposure: signal.target_exposure, executionPrice: execution.open, markPrice: execution.close, hoursElapsed: elapsed(portfolio.last_marked_at, execution.closed_at) }), []);
}

function transitionPlan(cycleId, selection, candidate, priorExposure, targetExposure, reason, signalRows, execution, transition, blockerCodes) {
  const action = transition.quantity_delta > EPSILON ? "buy" : transition.quantity_delta < -EPSILON ? "sell" : "hold";
  return {
    state: transition.status === "filled" ? "filled" : "hold", market_data_status: "healthy", blocker_codes: blockerCodes,
    decision: { id: `${cycleId}:decision`, cycle_id: cycleId, selection_id: selection?.id || null, candidate_id: candidate?.id || null,
      prior_exposure: priorExposure, target_exposure: targetExposure, action, reason_code: reason,
      signal_closed_at: signalRows.at(-1).closed_at, decision_at: signalRows.at(-1).closed_at, execution_candle_closed_at: execution.closed_at },
    transition,
  };
}
function blocked(state, market, blocker_codes) { return { state, market_data_status: market, blocker_codes, decision: null, transition: null }; }

async function ensureDefinitions(env, policyHash, createdAt) {
  const policy = await env.DB.prepare(`SELECT policy_hash FROM directional_forward_policies WHERE id = ?`).bind(POLICY_ID).first();
  if (policy && policy.policy_hash !== policyHash) throw new Error("directional_forward_policy_hash_conflict");
  if (!policy) await env.DB.prepare(`INSERT INTO directional_forward_policies (id, version, policy_json, policy_hash, created_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(POLICY_ID, 1, canonical(DIRECTIONAL_FORWARD_POLICY), policyHash, createdAt).run();
  await env.DB.prepare(`INSERT OR IGNORE INTO directional_main_portfolios
    (id, initial_equity, cash_balance, position_quantity, average_entry, realized_pnl, unrealized_pnl, total_fees, total_carry,
     equity, peak_equity, max_drawdown_percent, gross_exposure_multiple, status, version, created_at, updated_at)
    VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0, ?, ?, 0, 0, 'active', 0, ?, ?)`)
    .bind(PORTFOLIO_ID, INITIAL_EQUITY, INITIAL_EQUITY, INITIAL_EQUITY, INITIAL_EQUITY, createdAt, createdAt).run();
}

async function persist(env, { now, selection, portfolio, championId, plan, result, policyHash, cycleHash }) {
  const statements = [env.DB.prepare(`INSERT INTO directional_forward_cycles
    (id, policy_id, policy_hash, expected_closed_at, scheduled_at, selection_id, research_batch_id, selection_state,
     champion_candidate_id, market_data_status, state, blocker_codes_json, decision_id, result_json, cycle_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(result.cycle_id, POLICY_ID, policyHash, result.expected_closed_at, now, selection?.id || null, selection?.batch_id || null,
      selection?.state || "missing", championId, plan.market_data_status, plan.state, JSON.stringify(plan.blocker_codes),
      plan.decision?.id || null, JSON.stringify(result), cycleHash, now)];
  if (plan.transition) {
    const t = plan.transition;
    const oldCandidate = portfolio.current_candidate_id || null;
    const executionCandidate = plan.decision.candidate_id || oldCandidate;
    const closed = Math.abs(Number(portfolio.position_quantity)) > EPSILON && (Math.abs(t.position_quantity) <= EPSILON || Math.sign(Number(portfolio.position_quantity)) !== Math.sign(t.position_quantity));
    const execution = {
      ok: true, paper_only: true, live_capital_enabled: false, cycle_id: result.cycle_id, portfolio_id: PORTFOLIO_ID,
      selection_id: selection?.id || null, candidate_id: executionCandidate, action: plan.decision.action, reason_code: plan.decision.reason_code,
      prior_exposure: plan.decision.prior_exposure, target_exposure: plan.decision.target_exposure,
      prior_quantity: Number(portfolio.position_quantity), position_quantity: t.position_quantity,
      execution_price: t.execution_price, mark_price: Number(result.paper_result ? (await candle(env, result.expected_closed_at)).close : 0),
      realized_pnl_delta: t.realized_pnl_delta, fee: t.fee, carry: t.carry, ending_equity: t.equity,
      max_drawdown_percent: t.max_drawdown_percent, closed_trade: closed,
    };
    const executionHash = await hash(execution);
    statements.push(env.DB.prepare(`UPDATE directional_main_portfolios SET current_candidate_id = ?, current_selection_id = ?,
      cash_balance = ?, position_quantity = ?, average_entry = ?, realized_pnl = ?, unrealized_pnl = ?, total_fees = ?, total_carry = ?,
      equity = ?, peak_equity = ?, max_drawdown_percent = ?, gross_exposure_multiple = ?, version = version + 1,
      last_cycle_id = ?, last_mark_price = ?, last_marked_at = ?, updated_at = ? WHERE id = ? AND version = ?`)
      .bind(championId, selection?.id || null, t.cash_balance, t.position_quantity, t.average_entry, t.realized_pnl, t.unrealized_pnl,
        t.total_fees, t.total_carry, t.equity, t.peak_equity, t.max_drawdown_percent, t.gross_exposure_multiple,
        result.cycle_id, execution.mark_price, result.expected_closed_at, now, PORTFOLIO_ID, Number(portfolio.version)));
    statements.push(env.DB.prepare(`INSERT INTO directional_forward_executions
      (id, cycle_id, portfolio_id, selection_id, candidate_id, action, reason_code, prior_exposure, target_exposure,
       signal_closed_at, execution_candle_closed_at, prior_quantity, position_quantity, execution_price, mark_price,
       realized_pnl_delta, fee, carry, ending_equity, max_drawdown_percent, closed_trade, result_json, execution_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(`${result.cycle_id}:execution`, result.cycle_id, PORTFOLIO_ID, selection?.id || null, executionCandidate,
        plan.decision.action, plan.decision.reason_code, plan.decision.prior_exposure, plan.decision.target_exposure,
        plan.decision.signal_closed_at, plan.decision.execution_candle_closed_at, execution.prior_quantity,
        execution.position_quantity, execution.execution_price, execution.mark_price, execution.realized_pnl_delta,
        execution.fee, execution.carry, execution.ending_equity, execution.max_drawdown_percent, closed ? 1 : 0,
        JSON.stringify(execution), executionHash, now));
  }
  try { await env.DB.batch(statements); }
  catch (error) { if (await readCycle(env, result.cycle_id)) return; throw error; }
}

async function readSelection(env) {
  const row = await env.DB.prepare(`SELECT s.id, s.batch_id, s.state, s.champion_candidate_ids_json,
    s.challenger_candidate_ids_json, s.ranking_json, s.cash_is_valid_allocation, s.selection_hash, s.created_at,
    b.as_of_closed_at, b.batch_hash FROM directional_research_portfolio_selections s
    JOIN directional_research_batches b ON b.id = s.batch_id ORDER BY b.as_of_closed_at DESC LIMIT 1`).first();
  return row ? { ...row, champion_candidate_ids: json(row.champion_candidate_ids_json, "directional_selection_champions_invalid"),
    challenger_candidate_ids: json(row.challenger_candidate_ids_json, "directional_selection_challengers_invalid"),
    ranking: json(row.ranking_json, "directional_selection_ranking_invalid"), cash_is_valid_allocation: Number(row.cash_is_valid_allocation) === 1 } : null;
}
async function readCandidate(env, id) {
  const row = await env.DB.prepare(`SELECT id, family, spec_json, spec_hash FROM directional_shadow_candidates WHERE id = ? AND enabled = 1`).bind(id).first();
  return row ? { ...json(row.spec_json, "directional_forward_candidate_spec_invalid"), id: row.id, family: row.family, spec_hash: row.spec_hash } : null;
}
async function readCandles(env, expected) {
  const rows = await env.DB.prepare(`SELECT pair AS market, interval, closed_at, open, high, low, close, volume, source
    FROM market_candles WHERE pair = ? AND interval = ? AND closed_at <= ? ORDER BY closed_at DESC LIMIT 240`)
    .bind(MARKET, INTERVAL, expected).all();
  return (rows.results || []).reverse();
}
async function candle(env, closedAt) { return env.DB.prepare(`SELECT close FROM market_candles WHERE pair = ? AND interval = ? AND closed_at = ?`).bind(MARKET, INTERVAL, closedAt).first(); }
async function readPortfolio(env) { return env.DB.prepare(`SELECT * FROM directional_main_portfolios WHERE id = ?`).bind(PORTFOLIO_ID).first(); }
async function readCycle(env, id) {
  const row = await env.DB.prepare(`SELECT id, cycle_hash, result_json, created_at FROM directional_forward_cycles WHERE id = ?`).bind(id).first();
  return row ? { ...json(row.result_json, "directional_forward_cycle_result_invalid"), cycle_id: row.id, cycle_hash: row.cycle_hash, created_at: row.created_at } : null;
}
async function readReceipt(env, id) {
  const row = await env.DB.prepare(`SELECT id, result_json, created_at FROM directional_forward_scheduler_receipts WHERE id = ?`).bind(id).first();
  return row ? { ...json(row.result_json, "directional_forward_scheduler_result_invalid"), scheduler_receipt_id: row.id, created_at: row.created_at } : null;
}
function summaryPortfolio(row) {
  const initial = Number(row.initial_equity), cash = Number(row.cash_balance), unrealized = Number(row.unrealized_pnl), equity = Number(row.equity);
  const delta = cash + unrealized - equity;
  return { portfolio_id: row.id, status: row.status, paper_only: true, live_capital_enabled: false,
    current_candidate_id: row.current_candidate_id || null, current_selection_id: row.current_selection_id || null,
    initial_cash: initial, initial_equity: initial, cash_balance: cash, position_quantity: Number(row.position_quantity),
    exposure_side: side(row.position_quantity), average_entry: Number(row.average_entry), realized_pnl: Number(row.realized_pnl),
    unrealized_pnl: unrealized, total_fees: Number(row.total_fees), total_carry: Number(row.total_carry), equity,
    return_percent: ((equity / initial) - 1) * 100, peak_equity: Number(row.peak_equity),
    max_drawdown_percent: Number(row.max_drawdown_percent), gross_exposure_multiple: Number(row.gross_exposure_multiple),
    portfolio_version: Number(row.version), last_cycle_id: row.last_cycle_id || null,
    last_mark_price: row.last_mark_price == null ? null : Number(row.last_mark_price), last_marked_at: row.last_marked_at || null,
    accounting_reconciled: Math.abs(delta) <= 1e-6, cash_ledger_delta: delta };
}
function compact(t) { return { status: t.status, position_quantity: t.position_quantity, exposure_side: side(t.position_quantity),
  equity: t.equity, realized_pnl: t.realized_pnl, unrealized_pnl: t.unrealized_pnl, fee: t.fee, carry: t.carry,
  total_fees: t.total_fees, total_carry: t.total_carry, max_drawdown_percent: t.max_drawdown_percent,
  entry_gross_exposure_multiple: t.entry_gross_exposure_multiple, gross_exposure_multiple: t.gross_exposure_multiple }; }
function normalizeCandles(rows) { return rows.map((r) => ({ market: String(r.market || r.pair || MARKET), interval: String(r.interval || INTERVAL),
  closed_at: iso(r.closed_at, "candle_closed_at"), open: positive(r.open, "open"), high: positive(r.high, "high"),
  low: positive(r.low, "low"), close: positive(r.close, "close"), volume: nonNegative(r.volume, "volume"), source: String(r.source || "") }))
  .sort((a, b) => a.closed_at.localeCompare(b.closed_at)); }
function elapsed(previous, current) { return previous ? Math.max(0, (Date.parse(current) - Date.parse(previous)) / HOUR_MS) : 1; }
function side(q) { const n = Number(q); return Math.abs(n) <= EPSILON ? 0 : Math.sign(n); }
function json(value, error) { try { return JSON.parse(value); } catch { throw new Error(error); } }
function iso(value, field) { const d = value instanceof Date ? value : new Date(value); if (Number.isNaN(d.getTime())) throw new Error(`directional_forward_invalid_${field}`); return d.toISOString(); }
function positive(value, field) { const n = Number(value); if (!Number.isFinite(n) || n <= 0) throw new Error(`directional_forward_invalid_${field}`); return n; }
function nonNegative(value, field) { const n = Number(value); if (!Number.isFinite(n) || n < 0) throw new Error(`directional_forward_invalid_${field}`); return n; }
function canonical(value) { if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`; return JSON.stringify(value); }
async function hash(value) { const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(value))); return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
function freeze(value) { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; Object.freeze(value); Object.values(value).forEach(freeze); return value; }
