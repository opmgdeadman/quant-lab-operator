import { getPaperAccountSummary } from "./paperLedger.js";

const POLICY_ID = "live-capital-qualification-v1";
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const EPSILON = 1e-8;

export const LIVE_QUALIFICATION_POLICY = deepFreeze({
  id: POLICY_ID,
  version: 1,
  output_states: ["not_qualified", "eligible_for_owner_review"],
  minimum_forward_cycles: 720,
  minimum_inclusive_span_days: 30,
  minimum_closed_trades: 30,
  minimum_forward_return_percent: 0,
  maximum_forward_drawdown_percent: 10,
  minimum_doubled_cost_return_percent: 0,
  minimum_tripled_cost_return_percent: 0,
  minimum_scheduler_success_rate_percent: 99.5,
  maximum_duplicate_violations: 0,
  maximum_unresolved_operational_errors: 0,
  accounting_reconciliation_required: true,
  qualified_champion_required: true,
  source_identity_required: true,
  healthy_market_data_required: true,
  owner_approval_required_after_eligibility: true,
  owner_approval_is_separate: true,
  live_authorization_allowed: false,
  funding_allowed: false,
  credential_collection_allowed: false,
  live_order_execution_allowed: false,
});

export const LIVE_QUALIFICATION_REASON_CODES = deepFreeze([
  "source_identity_invalid",
  "qualified_champion_missing",
  "qualified_champion_evidence_invalid",
  "insufficient_forward_cycles",
  "insufficient_forward_duration",
  "insufficient_closed_trades",
  "forward_return_not_positive",
  "forward_drawdown_exceeds_limit",
  "doubled_cost_stress_failed",
  "tripled_cost_stress_failed",
  "scheduler_reliability_below_gate",
  "market_data_unhealthy",
  "duplicate_safety_violation",
  "accounting_not_reconciled",
  "unresolved_operational_errors",
]);

export async function runProductionLiveQualification(env, options = {}) {
  const asOfClosedAt = options.asOfClosedAt
    ? iso(options.asOfClosedAt, "as_of_closed_at")
    : await latestForwardClose(env);
  if (!asOfClosedAt) throw new Error("qualification_forward_evidence_missing");
  const assessmentId = `${POLICY_ID}:${asOfClosedAt}`;
  const existing = await readAssessment(env, assessmentId);
  if (existing) return { ...existing, replayed: true };

  const evidence = await collectProductionQualificationEvidence(env, asOfClosedAt);
  const built = await buildLiveCapitalQualification(evidence, {
    assessmentId,
    createdAt: options.now || new Date(),
  });
  const existingPolicy = await readPolicy(env, POLICY_ID);
  if (existingPolicy && existingPolicy.policy_hash !== built.policy.policy_hash) {
    throw new Error("qualification_policy_hash_conflict");
  }
  try {
    await persistAssessment(env, built, Boolean(existingPolicy));
  } catch (error) {
    const raced = await readAssessment(env, assessmentId);
    if (raced) return { ...raced, replayed: true };
    throw error;
  }
  return { ...built.summary, replayed: false };
}

export async function getLiveQualificationSummary(env) {
  const row = await env.DB.prepare(
    `SELECT id, summary_json, created_at
     FROM live_qualification_assessments
     ORDER BY created_at DESC
     LIMIT 1`,
  ).first();
  if (!row) return null;
  return {
    ...parseJson(row.summary_json, "qualification_summary_invalid"),
    assessment_id: row.id,
    created_at: row.created_at,
    owner_approval_present: false,
    live_authorized: false,
  };
}

export async function buildLiveCapitalQualification(rawEvidence, options = {}) {
  const evidence = normalizeEvidence(rawEvidence);
  const assessmentId = options.assessmentId || `${POLICY_ID}:${evidence.as_of_closed_at}`;
  const createdAt = iso(options.createdAt || new Date(), "created_at");
  const policyHash = await stableHash(LIVE_QUALIFICATION_POLICY);
  const gates = [];

  addGate(gates, assessmentId, "source_identity",
    Boolean(evidence.selection_batch_id) && Boolean(evidence.selection_hash),
    {
      selection_batch_id: evidence.selection_batch_id,
      selection_hash: evidence.selection_hash,
    },
    { selection_batch_id_required: true, selection_hash_required: true },
    "source_identity_invalid", createdAt);
  addGate(gates, assessmentId, "qualified_champion",
    evidence.selection_state === "champion_selected"
      && Boolean(evidence.champion_candidate_id)
      && evidence.champion_verdict === "qualified",
    {
      selection_state: evidence.selection_state,
      champion_candidate_id: evidence.champion_candidate_id,
      champion_verdict: evidence.champion_verdict,
    },
    { required_state: "champion_selected", required_verdict: "qualified" },
    evidence.champion_candidate_id ? "qualified_champion_evidence_invalid" : "qualified_champion_missing",
    createdAt);
  addGate(gates, assessmentId, "forward_cycle_count",
    evidence.forward_cycle_count >= LIVE_QUALIFICATION_POLICY.minimum_forward_cycles,
    { forward_cycle_count: evidence.forward_cycle_count },
    { minimum: LIVE_QUALIFICATION_POLICY.minimum_forward_cycles },
    "insufficient_forward_cycles", createdAt);
  addGate(gates, assessmentId, "forward_duration",
    evidence.inclusive_span_days >= LIVE_QUALIFICATION_POLICY.minimum_inclusive_span_days,
    { inclusive_span_days: evidence.inclusive_span_days },
    { minimum: LIVE_QUALIFICATION_POLICY.minimum_inclusive_span_days },
    "insufficient_forward_duration", createdAt);
  addGate(gates, assessmentId, "closed_trades",
    evidence.closed_trade_count >= LIVE_QUALIFICATION_POLICY.minimum_closed_trades,
    { closed_trade_count: evidence.closed_trade_count },
    { minimum: LIVE_QUALIFICATION_POLICY.minimum_closed_trades },
    "insufficient_closed_trades", createdAt);
  addGate(gates, assessmentId, "forward_return",
    evidence.forward_return_percent > LIVE_QUALIFICATION_POLICY.minimum_forward_return_percent,
    { forward_return_percent: evidence.forward_return_percent },
    { exclusive_minimum: LIVE_QUALIFICATION_POLICY.minimum_forward_return_percent },
    "forward_return_not_positive", createdAt);
  addGate(gates, assessmentId, "forward_drawdown",
    evidence.maximum_drawdown_percent <= LIVE_QUALIFICATION_POLICY.maximum_forward_drawdown_percent,
    { maximum_drawdown_percent: evidence.maximum_drawdown_percent },
    { maximum: LIVE_QUALIFICATION_POLICY.maximum_forward_drawdown_percent },
    "forward_drawdown_exceeds_limit", createdAt);
  addGate(gates, assessmentId, "doubled_cost_resilience",
    evidence.doubled_cost_return_percent >= LIVE_QUALIFICATION_POLICY.minimum_doubled_cost_return_percent,
    { doubled_cost_return_percent: evidence.doubled_cost_return_percent },
    { minimum: LIVE_QUALIFICATION_POLICY.minimum_doubled_cost_return_percent },
    "doubled_cost_stress_failed", createdAt);
  addGate(gates, assessmentId, "tripled_cost_resilience",
    evidence.tripled_cost_return_percent >= LIVE_QUALIFICATION_POLICY.minimum_tripled_cost_return_percent,
    { tripled_cost_return_percent: evidence.tripled_cost_return_percent },
    { minimum: LIVE_QUALIFICATION_POLICY.minimum_tripled_cost_return_percent },
    "tripled_cost_stress_failed", createdAt);
  addGate(gates, assessmentId, "scheduler_reliability",
    evidence.scheduler_receipt_count >= evidence.forward_cycle_count
      && evidence.scheduler_success_rate_percent >= LIVE_QUALIFICATION_POLICY.minimum_scheduler_success_rate_percent,
    {
      scheduler_receipt_count: evidence.scheduler_receipt_count,
      forward_cycle_count: evidence.forward_cycle_count,
      scheduler_success_rate_percent: evidence.scheduler_success_rate_percent,
    },
    {
      minimum_receipts: "forward_cycle_count",
      minimum_success_rate_percent: LIVE_QUALIFICATION_POLICY.minimum_scheduler_success_rate_percent,
    },
    "scheduler_reliability_below_gate", createdAt);
  addGate(gates, assessmentId, "market_data_health",
    evidence.market_data_status === "healthy",
    { market_data_status: evidence.market_data_status },
    { required_status: "healthy" },
    "market_data_unhealthy", createdAt);
  addGate(gates, assessmentId, "duplicate_safety",
    evidence.duplicate_violation_count <= LIVE_QUALIFICATION_POLICY.maximum_duplicate_violations,
    { duplicate_violation_count: evidence.duplicate_violation_count },
    { maximum: LIVE_QUALIFICATION_POLICY.maximum_duplicate_violations },
    "duplicate_safety_violation", createdAt);
  addGate(gates, assessmentId, "accounting_reconciliation",
    evidence.accounting_reconciled === true
      && Math.abs(evidence.cash_ledger_delta) <= EPSILON
      && Math.abs(evidence.simulated_cash_delta) <= 0.01
      && Math.abs(evidence.simulated_position_delta) <= EPSILON,
    {
      accounting_reconciled: evidence.accounting_reconciled,
      cash_ledger_delta: evidence.cash_ledger_delta,
      simulated_cash_delta: evidence.simulated_cash_delta,
      simulated_position_delta: evidence.simulated_position_delta,
    },
    { required: true },
    "accounting_not_reconciled", createdAt);
  addGate(gates, assessmentId, "operational_errors",
    evidence.unresolved_operational_error_count <= LIVE_QUALIFICATION_POLICY.maximum_unresolved_operational_errors,
    { unresolved_operational_error_count: evidence.unresolved_operational_error_count },
    { maximum: LIVE_QUALIFICATION_POLICY.maximum_unresolved_operational_errors },
    "unresolved_operational_errors", createdAt);

  const blockerCodes = gates.filter((gate) => gate.passed === 0).map((gate) => gate.reason_code);
  const state = blockerCodes.length === 0 ? "eligible_for_owner_review" : "not_qualified";
  const evidenceHash = await stableHash(evidence);
  const assessmentHash = await stableHash({
    assessment_id: assessmentId,
    policy_hash: policyHash,
    evidence_hash: evidenceHash,
    state,
    gates: gates.map((gate) => ({
      gate_code: gate.gate_code,
      passed: gate.passed,
      reason_code: gate.reason_code,
    })),
  });
  const summary = {
    ok: true,
    assessment_id: assessmentId,
    qualification_policy_id: POLICY_ID,
    qualification_policy_hash: policyHash,
    assessment_hash: assessmentHash,
    evidence_hash: evidenceHash,
    as_of_closed_at: evidence.as_of_closed_at,
    state,
    blocker_codes: blockerCodes,
    gate_count: gates.length,
    passed_gate_count: gates.filter((gate) => gate.passed === 1).length,
    failed_gate_count: blockerCodes.length,
    selection_batch_id: evidence.selection_batch_id,
    champion_candidate_id: evidence.champion_candidate_id,
    evidence: compactEvidence(evidence),
    owner_approval_required: true,
    owner_approval_present: false,
    eligible_for_owner_review: state === "eligible_for_owner_review",
    live_authorized: false,
    funding_allowed: false,
    credential_collection_allowed: false,
    live_order_execution_allowed: false,
    created_at: createdAt,
  };
  return {
    policy: {
      id: POLICY_ID,
      version: LIVE_QUALIFICATION_POLICY.version,
      policy_json: canonicalJson(LIVE_QUALIFICATION_POLICY),
      policy_hash: policyHash,
      created_at: createdAt,
    },
    assessment: {
      id: assessmentId,
      policy_id: POLICY_ID,
      policy_hash: policyHash,
      selection_batch_id: evidence.selection_batch_id,
      champion_candidate_id: evidence.champion_candidate_id,
      state,
      evidence_json: JSON.stringify(evidence),
      evidence_hash: evidenceHash,
      blocker_codes_json: JSON.stringify(blockerCodes),
      gate_count: gates.length,
      passed_gate_count: summary.passed_gate_count,
      failed_gate_count: summary.failed_gate_count,
      assessment_hash: assessmentHash,
      summary_json: JSON.stringify(summary),
      owner_approval_required: 1,
      owner_approval_present: 0,
      live_authorized: 0,
      created_at: createdAt,
    },
    gates,
    summary,
  };
}

async function collectLegacyProductionQualificationEvidence(env, asOfClosedAt) {
  const asOf = iso(asOfClosedAt, "as_of_closed_at");
  const selection = await env.DB.prepare(
    `SELECT id, state, champion_candidate_id, selection_hash, created_at
     FROM selection_batches
     ORDER BY created_at DESC
     LIMIT 1`,
  ).first();
  const championId = selection?.champion_candidate_id || null;
  let championVerdict = null;
  let doubledCostReturn = null;
  let tripledCostReturn = null;
  if (championId) {
    const verdict = await env.DB.prepare(
      `SELECT id, verdict, evidence_hash
       FROM strategy_candidate_verdicts
       WHERE candidate_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
    ).bind(championId).first();
    championVerdict = verdict?.verdict || null;
    if (verdict) {
      const stresses = await env.DB.prepare(
        `SELECT cost_multiplier, metrics_json
         FROM strategy_candidate_stress_results
         WHERE verdict_id = ?
         ORDER BY cost_multiplier ASC`,
      ).bind(verdict.id).all();
      for (const row of stresses.results || []) {
        const metrics = parseJson(row.metrics_json, "qualification_stress_metrics_invalid");
        if (Number(row.cost_multiplier) === 2) doubledCostReturn = Number(metrics.total_return_percent);
        if (Number(row.cost_multiplier) === 3) tripledCostReturn = Number(metrics.total_return_percent);
      }
    }
  }

  const cycles = championId ? await env.DB.prepare(
    `SELECT expected_closed_at, state
     FROM forward_operation_cycles
     WHERE champion_candidate_id = ? AND expected_closed_at <= ?
     ORDER BY expected_closed_at ASC`,
  ).bind(championId, asOf).all() : { results: [] };
  const cycleRows = cycles.results || [];
  const cycleIds = cycleRows.map((row) => `forward-operation:${row.expected_closed_at}`);
  const firstClose = cycleRows[0]?.expected_closed_at || null;
  const lastClose = cycleRows.at(-1)?.expected_closed_at || null;
  const inclusiveSpanDays = firstClose && lastClose
    ? ((Date.parse(lastClose) - Date.parse(firstClose) + HOUR_MS) / DAY_MS)
    : 0;

  const schedulerStats = championId ? await env.DB.prepare(
    `SELECT COUNT(*) AS receipt_count,
            SUM(CASE WHEN r.ingestion_ok = 1 THEN 1 ELSE 0 END) AS success_count
     FROM forward_scheduler_receipts r
     JOIN forward_operation_cycles c ON c.id = r.cycle_id
     WHERE c.champion_candidate_id = ? AND c.expected_closed_at <= ?`,
  ).bind(championId, asOf).first() : null;
  const schedulerReceiptCount = Number(schedulerStats?.receipt_count || 0);
  const schedulerSuccessCount = Number(schedulerStats?.success_count || 0);
  const schedulerSuccessRate = schedulerReceiptCount
    ? (schedulerSuccessCount / schedulerReceiptCount) * 100
    : 0;

  const decisions = championId ? await env.DB.prepare(
    `SELECT d.id, d.cycle_id, d.action, d.paper_cycle_id, d.paper_status,
            d.execution_candle_closed_at, f.id AS fill_id, f.side, f.fill_time,
            f.source_candle_closed_at, f.price, f.quantity, f.notional, f.fee
     FROM forward_operation_decisions d
     LEFT JOIN paper_orders o ON o.cycle_id = d.paper_cycle_id
     LEFT JOIN paper_fills f ON f.order_id = o.id
     WHERE d.candidate_id = ? AND d.execution_candle_closed_at <= ?
     ORDER BY d.execution_candle_closed_at ASC`,
  ).bind(championId, asOf).all() : { results: [] };
  const decisionRows = decisions.results || [];
  const fills = decisionRows.filter((row) => row.fill_id).map((row) => ({
    id: row.fill_id,
    side: row.side,
    fill_time: row.fill_time,
    source_candle_closed_at: row.source_candle_closed_at,
    price: Number(row.price),
    quantity: Number(row.quantity),
    notional: Number(row.notional),
    fee: Number(row.fee),
  }));
  const candles = championId && firstClose ? await env.DB.prepare(
    `SELECT closed_at, close
     FROM market_candles
     WHERE pair = 'BTC-USD' AND interval = '1h'
       AND closed_at >= ? AND closed_at <= ?
     ORDER BY closed_at ASC`,
  ).bind(firstClose, asOf).all() : { results: [] };

  const account = await getPaperAccountSummary(env);
  const forwardMetrics = calculateForwardMetrics({
    cycleRows,
    fills,
    candles: candles.results || [],
    endingCash: Number(account?.cash_balance || 0),
    endingPosition: Number(account?.position_quantity || 0),
    initialCashFallback: Number(account?.initial_cash || 10000),
  });

  const duplicateStats = championId ? await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM forward_operation_cycles WHERE champion_candidate_id = ? AND expected_closed_at <= ?) AS cycle_count,
       (SELECT COUNT(DISTINCT expected_closed_at) FROM forward_operation_cycles WHERE champion_candidate_id = ? AND expected_closed_at <= ?) AS distinct_cycle_count,
       (SELECT COUNT(*) FROM forward_operation_decisions WHERE candidate_id = ? AND execution_candle_closed_at <= ?) AS decision_count,
       (SELECT COUNT(DISTINCT cycle_id) FROM forward_operation_decisions WHERE candidate_id = ? AND execution_candle_closed_at <= ?) AS distinct_decision_cycle_count,
       (SELECT COUNT(paper_cycle_id) FROM forward_operation_decisions WHERE candidate_id = ? AND execution_candle_closed_at <= ?) AS paper_cycle_count,
       (SELECT COUNT(DISTINCT paper_cycle_id) FROM forward_operation_decisions WHERE candidate_id = ? AND execution_candle_closed_at <= ? AND paper_cycle_id IS NOT NULL) AS distinct_paper_cycle_count`,
  ).bind(
    championId, asOf, championId, asOf,
    championId, asOf, championId, asOf,
    championId, asOf, championId, asOf,
  ).first() : null;
  const duplicateViolationCount = duplicateStats ? (
    Math.max(0, Number(duplicateStats.cycle_count) - Number(duplicateStats.distinct_cycle_count))
    + Math.max(0, Number(duplicateStats.decision_count) - Number(duplicateStats.distinct_decision_cycle_count))
    + Math.max(0, Number(duplicateStats.paper_cycle_count) - Number(duplicateStats.distinct_paper_cycle_count))
  ) : 0;

  const dataHealth = await env.DB.prepare(
    `SELECT status, last_error FROM market_data_health WHERE id = ?`,
  ).bind("BTC-USD:1h").first();
  const forwardErrorCount = cycleRows.filter((row) => row.state === "error").length;
  const unresolvedOperationalErrors = forwardErrorCount
    + (dataHealth?.status === "error" || dataHealth?.last_error ? 1 : 0);

  return {
    schema: "live_qualification_evidence_v1",
    as_of_closed_at: asOf,
    selection_batch_id: selection?.id || null,
    selection_hash: selection?.selection_hash || null,
    selection_state: selection?.state || "missing",
    champion_candidate_id: championId,
    champion_verdict: championVerdict,
    forward_cycle_count: cycleRows.length,
    first_forward_closed_at: firstClose,
    last_forward_closed_at: lastClose,
    inclusive_span_days: inclusiveSpanDays,
    closed_trade_count: forwardMetrics.closed_trade_count,
    forward_net_pnl: forwardMetrics.net_pnl,
    forward_return_percent: forwardMetrics.return_percent,
    maximum_drawdown_percent: forwardMetrics.maximum_drawdown_percent,
    doubled_cost_return_percent: finiteOrSentinel(doubledCostReturn, -1000000),
    tripled_cost_return_percent: finiteOrSentinel(tripledCostReturn, -1000000),
    scheduler_receipt_count: schedulerReceiptCount,
    scheduler_success_count: schedulerSuccessCount,
    scheduler_success_rate_percent: schedulerSuccessRate,
    duplicate_violation_count: duplicateViolationCount,
    accounting_reconciled: Boolean(account?.accounting_reconciled)
      && Math.abs(Number(account?.cash_ledger_delta || 0)) <= EPSILON
      && Math.abs(forwardMetrics.simulated_cash_delta) <= 0.01
      && Math.abs(forwardMetrics.simulated_position_delta) <= EPSILON,
    cash_ledger_delta: Number(account?.cash_ledger_delta || 0),
    simulated_cash_delta: forwardMetrics.simulated_cash_delta,
    simulated_position_delta: forwardMetrics.simulated_position_delta,
    unresolved_operational_error_count: unresolvedOperationalErrors,
    market_data_status: dataHealth?.status || "missing",
    owner_approval_present: false,
    live_authorized: false,
  };
}

export function calculateForwardMetrics({ cycleRows, fills, candles, endingCash, endingPosition, initialCashFallback }) {
  const sortedFills = [...fills].sort((left, right) => left.fill_time.localeCompare(right.fill_time));
  const cashDelta = sortedFills.reduce((sum, fill) => (
    sum + (fill.side === "buy" ? -(fill.notional + fill.fee) : fill.notional - fill.fee)
  ), 0);
  const positionDelta = sortedFills.reduce((sum, fill) => (
    sum + (fill.side === "buy" ? fill.quantity : -fill.quantity)
  ), 0);
  const startingCash = sortedFills.length ? endingCash - cashDelta : endingCash;
  const startingPosition = sortedFills.length ? endingPosition - positionDelta : endingPosition;
  let cash = startingCash;
  let quantity = startingPosition;
  let peak = startingCash;
  let maximumDrawdown = 0;
  let entryCost = null;
  let entryQuantity = null;
  let closedTradeCount = 0;
  let netPnl = 0;
  const fillsByClose = new Map();
  for (const fill of sortedFills) {
    const list = fillsByClose.get(fill.source_candle_closed_at) || [];
    list.push(fill);
    fillsByClose.set(fill.source_candle_closed_at, list);
  }
  for (const candle of candles) {
    for (const fill of fillsByClose.get(candle.closed_at) || []) {
      if (fill.side === "buy") {
        cash -= fill.notional + fill.fee;
        quantity += fill.quantity;
        entryCost = (entryCost || 0) + fill.notional + fill.fee;
        entryQuantity = (entryQuantity || 0) + fill.quantity;
      } else if (fill.side === "sell") {
        cash += fill.notional - fill.fee;
        quantity -= fill.quantity;
        if (entryCost !== null && entryQuantity !== null && Math.abs(fill.quantity - entryQuantity) <= 1e-6) {
          const tradePnl = fill.notional - fill.fee - entryCost;
          netPnl += tradePnl;
          closedTradeCount += 1;
          entryCost = null;
          entryQuantity = null;
        }
      }
    }
    const equity = cash + quantity * Number(candle.close);
    peak = Math.max(peak, equity);
    const drawdown = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
    maximumDrawdown = Math.max(maximumDrawdown, drawdown);
  }
  const returnPercent = startingCash > 0 ? (netPnl / startingCash) * 100 : -1000000;
  return {
    starting_cash: startingCash,
    closed_trade_count: closedTradeCount,
    net_pnl: netPnl,
    return_percent: returnPercent,
    maximum_drawdown_percent: maximumDrawdown,
    simulated_cash_delta: cash - endingCash,
    simulated_position_delta: quantity - endingPosition,
    cycle_count: cycleRows.length,
  };
}

function normalizeEvidence(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("qualification_evidence_object_required");
  }
  const evidence = {
    schema: String(raw.schema || ""),
    as_of_closed_at: iso(raw.as_of_closed_at, "as_of_closed_at"),
    selection_batch_id: nullableString(raw.selection_batch_id),
    selection_hash: nullableString(raw.selection_hash),
    selection_state: String(raw.selection_state || "missing"),
    champion_candidate_id: nullableString(raw.champion_candidate_id),
    champion_verdict: nullableString(raw.champion_verdict),
    forward_cycle_count: nonNegativeInteger(raw.forward_cycle_count, "forward_cycle_count"),
    first_forward_closed_at: nullableIso(raw.first_forward_closed_at, "first_forward_closed_at"),
    last_forward_closed_at: nullableIso(raw.last_forward_closed_at, "last_forward_closed_at"),
    inclusive_span_days: nonNegative(raw.inclusive_span_days, "inclusive_span_days"),
    closed_trade_count: nonNegativeInteger(raw.closed_trade_count, "closed_trade_count"),
    forward_net_pnl: finite(raw.forward_net_pnl, "forward_net_pnl"),
    forward_return_percent: finite(raw.forward_return_percent, "forward_return_percent"),
    maximum_drawdown_percent: nonNegative(raw.maximum_drawdown_percent, "maximum_drawdown_percent"),
    doubled_cost_return_percent: finite(raw.doubled_cost_return_percent, "doubled_cost_return_percent"),
    tripled_cost_return_percent: finite(raw.tripled_cost_return_percent, "tripled_cost_return_percent"),
    scheduler_receipt_count: nonNegativeInteger(raw.scheduler_receipt_count, "scheduler_receipt_count"),
    scheduler_success_count: nonNegativeInteger(raw.scheduler_success_count, "scheduler_success_count"),
    scheduler_success_rate_percent: nonNegative(raw.scheduler_success_rate_percent, "scheduler_success_rate_percent"),
    duplicate_violation_count: nonNegativeInteger(raw.duplicate_violation_count, "duplicate_violation_count"),
    accounting_reconciled: raw.accounting_reconciled === true,
    cash_ledger_delta: finite(raw.cash_ledger_delta, "cash_ledger_delta"),
    simulated_cash_delta: finite(raw.simulated_cash_delta, "simulated_cash_delta"),
    simulated_position_delta: finite(raw.simulated_position_delta, "simulated_position_delta"),
    unresolved_operational_error_count: nonNegativeInteger(raw.unresolved_operational_error_count, "unresolved_operational_error_count"),
    market_data_status: String(raw.market_data_status || "missing"),
    owner_approval_present: false,
    live_authorized: false,
  };
  if (evidence.schema !== "live_qualification_evidence_v1") {
    throw new Error("qualification_evidence_schema_invalid");
  }
  if (evidence.scheduler_success_count > evidence.scheduler_receipt_count) {
    throw new Error("qualification_scheduler_counts_invalid");
  }
  if (evidence.first_forward_closed_at && evidence.last_forward_closed_at
    && Date.parse(evidence.first_forward_closed_at) > Date.parse(evidence.last_forward_closed_at)) {
    throw new Error("qualification_forward_boundaries_invalid");
  }
  if (evidence.forward_cycle_count > 0
    && (!evidence.first_forward_closed_at || !evidence.last_forward_closed_at)) {
    throw new Error("qualification_forward_boundaries_required");
  }
  if (evidence.forward_cycle_count === 0
    && (evidence.first_forward_closed_at || evidence.last_forward_closed_at || evidence.inclusive_span_days !== 0)) {
    throw new Error("qualification_empty_forward_evidence_invalid");
  }
  if (evidence.first_forward_closed_at && evidence.last_forward_closed_at) {
    const spanHours = ((Date.parse(evidence.last_forward_closed_at) - Date.parse(evidence.first_forward_closed_at)) / HOUR_MS) + 1;
    const expectedSpanDays = spanHours / 24;
    if (Math.abs(evidence.inclusive_span_days - expectedSpanDays) > EPSILON
      || evidence.forward_cycle_count > Math.floor(spanHours + EPSILON)) {
      throw new Error("qualification_forward_span_conflict");
    }
  }
  const expectedSchedulerRate = evidence.scheduler_receipt_count
    ? (evidence.scheduler_success_count / evidence.scheduler_receipt_count) * 100
    : 0;
  if (Math.abs(evidence.scheduler_success_rate_percent - expectedSchedulerRate) > EPSILON) {
    throw new Error("qualification_scheduler_rate_conflict");
  }
  return evidence;
}

function compactEvidence(evidence) {
  return {
    forward_cycle_count: evidence.forward_cycle_count,
    inclusive_span_days: evidence.inclusive_span_days,
    closed_trade_count: evidence.closed_trade_count,
    forward_return_percent: evidence.forward_return_percent,
    maximum_drawdown_percent: evidence.maximum_drawdown_percent,
    doubled_cost_return_percent: evidence.doubled_cost_return_percent,
    tripled_cost_return_percent: evidence.tripled_cost_return_percent,
    scheduler_receipt_count: evidence.scheduler_receipt_count,
    scheduler_success_rate_percent: evidence.scheduler_success_rate_percent,
    duplicate_violation_count: evidence.duplicate_violation_count,
    accounting_reconciled: evidence.accounting_reconciled,
    unresolved_operational_error_count: evidence.unresolved_operational_error_count,
  };
}

function addGate(gates, assessmentId, gateCode, passed, observed, threshold, reasonCode, createdAt) {
  gates.push({
    id: `${assessmentId}:gate:${gateCode}`,
    assessment_id: assessmentId,
    gate_code: gateCode,
    passed: passed ? 1 : 0,
    observed_json: JSON.stringify(observed),
    threshold_json: JSON.stringify(threshold),
    reason_code: reasonCode,
    created_at: createdAt,
  });
}

async function persistAssessment(env, built, policyExists) {
  const statements = [];
  if (!policyExists) {
    statements.push(env.DB.prepare(
      `INSERT INTO live_qualification_policies (id, version, policy_json, policy_hash, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(built.policy.id, built.policy.version, built.policy.policy_json, built.policy.policy_hash, built.policy.created_at));
  }
  statements.push(env.DB.prepare(
    `INSERT INTO live_qualification_assessments (
       id, policy_id, policy_hash, selection_batch_id, champion_candidate_id, state,
       evidence_json, evidence_hash, blocker_codes_json, gate_count, passed_gate_count,
       failed_gate_count, assessment_hash, summary_json, owner_approval_required,
       owner_approval_present, live_authorized, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    built.assessment.id, built.assessment.policy_id, built.assessment.policy_hash,
    built.assessment.selection_batch_id, built.assessment.champion_candidate_id,
    built.assessment.state, built.assessment.evidence_json, built.assessment.evidence_hash,
    built.assessment.blocker_codes_json, built.assessment.gate_count,
    built.assessment.passed_gate_count, built.assessment.failed_gate_count,
    built.assessment.assessment_hash, built.assessment.summary_json,
    built.assessment.owner_approval_required, built.assessment.owner_approval_present,
    built.assessment.live_authorized, built.assessment.created_at,
  ));
  for (const gate of built.gates) {
    statements.push(env.DB.prepare(
      `INSERT INTO live_qualification_gate_results (
         id, assessment_id, gate_code, passed, observed_json, threshold_json, reason_code, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      gate.id, gate.assessment_id, gate.gate_code, gate.passed,
      gate.observed_json, gate.threshold_json, gate.reason_code, gate.created_at,
    ));
  }
  await env.DB.batch(statements);
}

async function latestForwardClose(env) {
  const row = await env.DB.prepare(
    `SELECT expected_closed_at FROM forward_operation_cycles
     ORDER BY expected_closed_at DESC LIMIT 1`,
  ).first();
  return row?.expected_closed_at || null;
}
async function readAssessment(env, assessmentId) {
  const row = await env.DB.prepare(
    `SELECT id, assessment_hash, summary_json, created_at
     FROM live_qualification_assessments WHERE id = ?`,
  ).bind(assessmentId).first();
  if (!row) return null;
  return {
    ...parseJson(row.summary_json, "qualification_summary_invalid"),
    assessment_id: row.id,
    assessment_hash: row.assessment_hash,
    created_at: row.created_at,
  };
}
async function readPolicy(env, policyId) {
  return env.DB.prepare(
    `SELECT id, policy_hash, created_at FROM live_qualification_policies WHERE id = ?`,
  ).bind(policyId).first();
}

function finiteOrSentinel(value, sentinel) { return Number.isFinite(Number(value)) ? Number(value) : sentinel; }
function nullableString(value) { return value === null || value === undefined ? null : String(value); }
function nullableIso(value, field) { return value === null || value === undefined ? null : iso(value, field); }
function nonNegativeInteger(value, field) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new Error(`qualification_invalid_${field}`);
  return number;
}
function nonNegative(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`qualification_invalid_${field}`);
  return number;
}
function finite(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`qualification_invalid_${field}`);
  return number;
}
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
function iso(value, field) {
  const millis = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(millis)) throw new Error(`qualification_invalid_${field}`);
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
