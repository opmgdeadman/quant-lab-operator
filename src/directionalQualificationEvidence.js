const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const PORTFOLIO_ID = "paper-main-directional";

export async function collectDirectionalQualificationEvidence(env, asOfClosedAt) {
  if (!env?.DB) throw new Error("directional_qualification_database_required");
  const asOf = iso(asOfClosedAt, "as_of_closed_at");
  const selection = await readLatestSelection(env);
  const championId = selection?.champion_candidate_ids?.[0] || null;
  const verdict = championId ? await readVerdict(env, selection.batch_id, championId) : null;

  const cycleRows = championId ? (await env.DB.prepare(
    `SELECT id, expected_closed_at, state, result_json
     FROM directional_forward_cycles
     WHERE champion_candidate_id = ? AND expected_closed_at <= ?
     ORDER BY expected_closed_at ASC`,
  ).bind(championId, asOf).all()).results || [] : [];
  const firstClose = cycleRows[0]?.expected_closed_at || null;
  const lastClose = cycleRows.at(-1)?.expected_closed_at || null;
  const inclusiveSpanDays = firstClose && lastClose
    ? (Date.parse(lastClose) - Date.parse(firstClose) + HOUR_MS) / DAY_MS
    : 0;

  const cycleEvidence = cycleRows.map((row) => {
    const result = parseJson(row.result_json, "directional_qualification_cycle_result_invalid");
    return {
      expected_closed_at: row.expected_closed_at,
      state: row.state,
      equity: numberOrNull(result.paper_result?.equity),
      drawdown: numberOrNull(result.paper_result?.max_drawdown_percent),
    };
  });
  const equityRows = cycleEvidence.filter((row) => row.equity !== null);
  const startingEquity = equityRows[0]?.equity ?? null;
  const endingEquity = equityRows.at(-1)?.equity ?? null;
  const forwardReturnPercent = startingEquity !== null && startingEquity > 0 && endingEquity !== null
    ? ((endingEquity / startingEquity) - 1) * 100
    : 0;
  const maximumDrawdownPercent = equityRows.reduce(
    (max, row) => Math.max(max, row.drawdown ?? 0),
    0,
  );

  const executionRows = championId ? (await env.DB.prepare(
    `SELECT id, cycle_id, candidate_id, action, closed_trade, realized_pnl_delta, fee, carry,
            ending_equity, execution_hash, execution_candle_closed_at
     FROM directional_forward_executions
     WHERE candidate_id = ? AND execution_candle_closed_at <= ?
     ORDER BY execution_candle_closed_at ASC`,
  ).bind(championId, asOf).all()).results || [] : [];
  const closedTradeCount = executionRows.reduce((sum, row) => sum + (Number(row.closed_trade) === 1 ? 1 : 0), 0);
  const forwardNetPnl = executionRows.reduce((sum, row) => sum + Number(row.realized_pnl_delta || 0) - Number(row.fee || 0) - Number(row.carry || 0), 0);

  const schedulerStats = championId ? await env.DB.prepare(
    `SELECT COUNT(*) AS receipt_count,
            SUM(CASE WHEN r.ingestion_ok = 1 THEN 1 ELSE 0 END) AS success_count
     FROM directional_forward_scheduler_receipts r
     JOIN directional_forward_cycles c ON c.id = r.cycle_id
     WHERE c.champion_candidate_id = ? AND c.expected_closed_at <= ?`,
  ).bind(championId, asOf).first() : null;
  const schedulerReceiptCount = Number(schedulerStats?.receipt_count || 0);
  const schedulerSuccessCount = Number(schedulerStats?.success_count || 0);
  const schedulerSuccessRate = schedulerReceiptCount
    ? schedulerSuccessCount / schedulerReceiptCount * 100
    : 0;

  const duplicateStats = championId ? await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM directional_forward_cycles WHERE champion_candidate_id = ? AND expected_closed_at <= ?) AS cycle_count,
       (SELECT COUNT(DISTINCT expected_closed_at) FROM directional_forward_cycles WHERE champion_candidate_id = ? AND expected_closed_at <= ?) AS distinct_cycle_count,
       (SELECT COUNT(*) FROM directional_forward_executions WHERE candidate_id = ? AND execution_candle_closed_at <= ?) AS execution_count,
       (SELECT COUNT(DISTINCT cycle_id) FROM directional_forward_executions WHERE candidate_id = ? AND execution_candle_closed_at <= ?) AS distinct_execution_cycle_count`,
  ).bind(
    championId, asOf, championId, asOf,
    championId, asOf, championId, asOf,
  ).first() : null;
  const duplicateViolationCount = duplicateStats
    ? Math.max(0, Number(duplicateStats.cycle_count) - Number(duplicateStats.distinct_cycle_count))
      + Math.max(0, Number(duplicateStats.execution_count) - Number(duplicateStats.distinct_execution_cycle_count))
    : 0;

  const portfolio = await env.DB.prepare(
    `SELECT initial_equity, cash_balance, position_quantity, unrealized_pnl, equity,
            current_candidate_id, current_selection_id
     FROM directional_main_portfolios WHERE id = ?`,
  ).bind(PORTFOLIO_ID).first();
  const accountingDelta = portfolio
    ? Number(portfolio.cash_balance) + Number(portfolio.unrealized_pnl) - Number(portfolio.equity)
    : 0;
  const accountingReconciled = Boolean(portfolio) && Math.abs(accountingDelta) <= 1e-6;

  const dataHealth = await env.DB.prepare(
    `SELECT status, last_error FROM market_data_health WHERE id = ?`,
  ).bind("BTC-USD:1h").first();
  const unresolvedOperationalErrors = cycleRows.filter((row) => row.state === "error").length
    + (dataHealth?.status === "error" || dataHealth?.last_error ? 1 : 0);

  return {
    schema: "live_qualification_evidence_v1",
    authority_source: "directional_institutional_research",
    legacy_selection_authority: false,
    as_of_closed_at: asOf,
    selection_batch_id: selection?.id || null,
    selection_hash: selection?.selection_hash || null,
    selection_state: championId ? "champion_selected" : "no_champion",
    champion_candidate_id: championId,
    champion_verdict: verdict?.verdict || null,
    forward_cycle_count: cycleRows.length,
    first_forward_closed_at: firstClose,
    last_forward_closed_at: lastClose,
    inclusive_span_days: inclusiveSpanDays,
    closed_trade_count: closedTradeCount,
    forward_net_pnl: forwardNetPnl,
    forward_return_percent: forwardReturnPercent,
    maximum_drawdown_percent: maximumDrawdownPercent,
    doubled_cost_return_percent: Number(verdict?.metrics?.doubled_cost_median_return_percent ?? 0),
    tripled_cost_return_percent: Number(verdict?.metrics?.tripled_cost_median_return_percent ?? 0),
    scheduler_receipt_count: schedulerReceiptCount,
    scheduler_success_count: schedulerSuccessCount,
    scheduler_success_rate_percent: schedulerSuccessRate,
    duplicate_violation_count: duplicateViolationCount,
    accounting_reconciled: accountingReconciled,
    cash_ledger_delta: accountingDelta,
    simulated_cash_delta: 0,
    simulated_position_delta: 0,
    unresolved_operational_error_count: unresolvedOperationalErrors,
    market_data_status: dataHealth?.status || "missing",
    owner_approval_present: false,
    live_authorized: false,
  };
}

export async function latestDirectionalForwardClose(env) {
  const row = await env.DB.prepare(
    `SELECT expected_closed_at FROM directional_forward_cycles
     ORDER BY expected_closed_at DESC LIMIT 1`,
  ).first();
  return row?.expected_closed_at || null;
}

async function readLatestSelection(env) {
  const row = await env.DB.prepare(
    `SELECT s.id, s.batch_id, s.state, s.champion_candidate_ids_json,
            s.selection_hash, s.created_at, b.as_of_closed_at
     FROM directional_research_portfolio_selections s
     JOIN directional_research_batches b ON b.id = s.batch_id
     ORDER BY b.as_of_closed_at DESC LIMIT 1`,
  ).first();
  if (!row) return null;
  return {
    id: row.id,
    batch_id: row.batch_id,
    state: row.state,
    champion_candidate_ids: parseJson(row.champion_candidate_ids_json, "directional_qualification_champions_invalid"),
    selection_hash: row.selection_hash,
    created_at: row.created_at,
    as_of_closed_at: row.as_of_closed_at,
  };
}

async function readVerdict(env, batchId, candidateId) {
  const row = await env.DB.prepare(
    `SELECT verdict, metrics_json, verdict_hash
     FROM directional_research_verdicts
     WHERE batch_id = ? AND candidate_id = ?`,
  ).bind(batchId, candidateId).first();
  if (!row) return null;
  return {
    verdict: row.verdict,
    metrics: parseJson(row.metrics_json, "directional_qualification_metrics_invalid"),
    verdict_hash: row.verdict_hash,
  };
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function parseJson(value, errorCode) {
  try { return JSON.parse(value); } catch { throw new Error(errorCode); }
}
function iso(value, field) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`directional_qualification_invalid_${field}`);
  return date.toISOString();
}
