import { DIRECTIONAL_RESEARCH_POLICY, buildWalkForwardWindows, judgeDirectionalCandidate, selectDirectionalPortfolio } from "./directionalResearch.js";
import { runDirectionalWalkForward } from "./directionalBacktest.js";
import { DIRECTIONAL_STRATEGIES } from "./directionalShadow.js";

const MARKET = "BTC-USD";
const INTERVAL = "1h";
const POLICY_VERSION = 1;

export async function runProductionDirectionalInstitutionalResearch(env, options = {}) {
  if (!env?.DB) throw new Error("directional_research_database_required");
  const createdAt = iso(options.now || new Date(), "created_at");
  const asOfClosedAt = options.asOfClosedAt
    ? iso(options.asOfClosedAt, "as_of_closed_at")
    : await latestClosedAt(env);
  if (!asOfClosedAt) throw new Error("directional_research_market_history_missing");

  const batchId = `${DIRECTIONAL_RESEARCH_POLICY.id}:${asOfClosedAt.slice(0, 10)}`;
  const existing = await readBatch(env, batchId);
  if (existing) return { ...existing, replayed: true };

  const candles = await readExactHistory(env, asOfClosedAt, DIRECTIONAL_RESEARCH_POLICY.required_candles);
  const windows = buildWalkForwardWindows(candles, DIRECTIONAL_RESEARCH_POLICY);
  const backtests = runDirectionalWalkForward({
    windows,
    strategies: DIRECTIONAL_STRATEGIES,
    policy: DIRECTIONAL_RESEARCH_POLICY,
  });
  const shadowByCandidate = await readShadowEvidence(env, DIRECTIONAL_STRATEGIES.map((row) => row.id));
  const familyFragility = calculateFamilyFragility(backtests);
  const regimeCoverage = calculateRegimeCoverage(windows, backtests);

  const verdicts = backtests.map((candidate) => judgeDirectionalCandidate({
    candidate_id: candidate.candidate_id,
    windows: candidate.windows,
    shadow: shadowByCandidate.get(candidate.candidate_id) || emptyShadow(),
    parameter_fragility_percent: familyFragility.get(candidate.candidate_id) ?? 100,
    evidence_integrity_passed: candidate.windows.length === windows.length
      && candidate.windows.every((row) => row.evidence_integrity_passed === true),
    regime_coverage_passed: regimeCoverage.get(candidate.candidate_id) === true,
  }, DIRECTIONAL_RESEARCH_POLICY));
  const selection = selectDirectionalPortfolio(verdicts);

  const policyHash = await hashObject(DIRECTIONAL_RESEARCH_POLICY);
  const windowRecords = await Promise.all(windows.map(async (window, index) => {
    const record = {
      id: `${batchId}:window:${String(index + 1).padStart(2, "0")}`,
      batch_id: batchId,
      ordinal: index + 1,
      train_start_closed_at: window.train[0].closed_at,
      train_end_closed_at: window.train.at(-1).closed_at,
      validation_start_closed_at: window.validation[0].closed_at,
      validation_end_closed_at: window.validation.at(-1).closed_at,
      test_start_closed_at: window.test[0].closed_at,
      test_end_closed_at: window.test.at(-1).closed_at,
    };
    return { ...record, window_hash: await hashObject(record) };
  }));

  const runRecords = [];
  for (const candidate of backtests) {
    const strategy = DIRECTIONAL_STRATEGIES.find((row) => row.id === candidate.candidate_id);
    for (const run of candidate.windows) {
      const mappedWindowId = windowRecords.find((row) => row.ordinal === windowOrdinal(run.window_id))?.id;
      if (!mappedWindowId) throw new Error("directional_research_window_mapping_failed");
      const record = {
        ...run,
        id: `${batchId}:run:${candidate.candidate_id}:${run.window_id}`,
        batch_id: batchId,
        window_id: mappedWindowId,
        candidate_id: candidate.candidate_id,
        family: strategy.family,
      };
      runRecords.push({ ...record, run_hash: await hashObject(record) });
    }
  }

  const verdictRecords = await Promise.all(verdicts.map(async (verdict) => {
    const record = {
      id: `${batchId}:verdict:${verdict.candidate_id}`,
      batch_id: batchId,
      candidate_id: verdict.candidate_id,
      verdict: verdict.verdict,
      reason_codes: verdict.reason_codes,
      metrics: verdict.metrics,
    };
    return { ...record, verdict_hash: await hashObject(record) };
  }));

  const selectionRecord = {
    id: `${batchId}:portfolio`,
    batch_id: batchId,
    ...selection,
  };
  selectionRecord.selection_hash = await hashObject(selectionRecord);

  const summary = {
    ok: true,
    paper_only: true,
    live_capital_enabled: false,
    batch_id: batchId,
    policy_id: DIRECTIONAL_RESEARCH_POLICY.id,
    as_of_closed_at: asOfClosedAt,
    candle_start_closed_at: candles[0].closed_at,
    candle_end_closed_at: candles.at(-1).closed_at,
    candle_count: candles.length,
    candidate_count: backtests.length,
    window_count: windows.length,
    run_count: runRecords.length,
    qualified_count: verdicts.filter((row) => row.verdict === "qualified").length,
    awaiting_forward_count: verdicts.filter((row) => row.verdict === "awaiting_forward_evidence").length,
    rejected_count: verdicts.filter((row) => row.verdict === "rejected").length,
    selection,
    state: "complete",
    created_at: createdAt,
  };
  const batchHash = await hashObject({ summary, policy_hash: policyHash, windows: windowRecords, runs: runRecords, verdicts: verdictRecords, selection: selectionRecord });

  await persistResearch(env, {
    summary,
    policyHash,
    batchHash,
    windowRecords,
    runRecords,
    verdictRecords,
    selectionRecord,
  });
  return { ...summary, batch_hash: batchHash, replayed: false };
}

export async function getDirectionalInstitutionalResearchSummary(env) {
  const row = await env.DB.prepare(
    `SELECT id, result_json FROM directional_research_batches ORDER BY as_of_closed_at DESC LIMIT 1`,
  ).first();
  if (!row) return {
    ok: true,
    paper_only: true,
    live_capital_enabled: false,
    state: "not_run",
    blocker: "no_directional_research_batch",
    windows: [],
    verdicts: [],
    selection: null,
  };
  const [windows, verdicts, selection, runCounts] = await Promise.all([
    env.DB.prepare(
      `SELECT ordinal, train_start_closed_at, train_end_closed_at,
              validation_start_closed_at, validation_end_closed_at,
              test_start_closed_at, test_end_closed_at, window_hash
       FROM directional_research_windows WHERE batch_id = ? ORDER BY ordinal ASC`,
    ).bind(row.id).all(),
    env.DB.prepare(
      `SELECT candidate_id, verdict, reason_codes_json, metrics_json, verdict_hash
       FROM directional_research_verdicts WHERE batch_id = ? ORDER BY candidate_id ASC`,
    ).bind(row.id).all(),
    env.DB.prepare(
      `SELECT id, state, champion_candidate_ids_json, challenger_candidate_ids_json,
              ranking_json, cash_is_valid_allocation, selection_hash
       FROM directional_research_portfolio_selections WHERE batch_id = ?`,
    ).bind(row.id).first(),
    env.DB.prepare(
      `SELECT candidate_id, COUNT(*) AS run_count
       FROM directional_research_runs WHERE batch_id = ? GROUP BY candidate_id ORDER BY candidate_id ASC`,
    ).bind(row.id).all(),
  ]);
  const summary = JSON.parse(row.result_json);
  return {
    ...summary,
    windows: windows.results || [],
    verdicts: (verdicts.results || []).map((entry) => ({
      candidate_id: entry.candidate_id,
      verdict: entry.verdict,
      reason_codes: JSON.parse(entry.reason_codes_json),
      metrics: JSON.parse(entry.metrics_json),
      verdict_hash: entry.verdict_hash,
    })),
    selection: selection ? {
      id: selection.id,
      state: selection.state,
      champion_candidate_ids: JSON.parse(selection.champion_candidate_ids_json),
      challenger_candidate_ids: JSON.parse(selection.challenger_candidate_ids_json),
      ranking: JSON.parse(selection.ranking_json),
      cash_is_valid_allocation: Number(selection.cash_is_valid_allocation) === 1,
      selection_hash: selection.selection_hash,
    } : null,
    candidate_run_counts: runCounts.results || [],
  };
}

async function persistResearch(env, data) {
  const { summary, policyHash, batchHash, windowRecords, runRecords, verdictRecords, selectionRecord } = data;
  const statements = [];
  statements.push(env.DB.prepare(
    `INSERT OR IGNORE INTO directional_research_policies
     (id, version, policy_json, policy_hash, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).bind(DIRECTIONAL_RESEARCH_POLICY.id, POLICY_VERSION, JSON.stringify(DIRECTIONAL_RESEARCH_POLICY), policyHash, summary.created_at));
  statements.push(env.DB.prepare(
    `INSERT INTO directional_research_batches
     (id, policy_id, as_of_closed_at, candle_start_closed_at, candle_end_closed_at, candle_count, candidate_count, window_count, state, batch_hash, result_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(summary.batch_id, summary.policy_id, summary.as_of_closed_at, summary.candle_start_closed_at, summary.candle_end_closed_at,
    summary.candle_count, summary.candidate_count, summary.window_count, summary.state, batchHash,
    JSON.stringify({ ...summary, batch_hash: batchHash }), summary.created_at));
  for (const row of windowRecords) statements.push(env.DB.prepare(
    `INSERT INTO directional_research_windows
     (id, batch_id, ordinal, train_start_closed_at, train_end_closed_at, validation_start_closed_at, validation_end_closed_at, test_start_closed_at, test_end_closed_at, window_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(row.id, row.batch_id, row.ordinal, row.train_start_closed_at, row.train_end_closed_at,
    row.validation_start_closed_at, row.validation_end_closed_at, row.test_start_closed_at, row.test_end_closed_at,
    row.window_hash, summary.created_at));
  for (const row of runRecords) statements.push(env.DB.prepare(
    `INSERT INTO directional_research_runs
     (id, batch_id, window_id, candidate_id, family, test_return_percent, doubled_cost_return_percent, tripled_cost_return_percent,
      test_drawdown_percent, closed_trade_count, fill_count, total_fees, total_carry, ending_equity, execution_model,
      evidence_integrity_passed, run_hash, result_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(row.id, row.batch_id, row.window_id, row.candidate_id, row.family, row.test_return_percent,
    row.doubled_cost_return_percent, row.tripled_cost_return_percent, row.test_drawdown_percent, row.closed_trade_count,
    row.fill_count, row.total_fees, row.total_carry, row.ending_equity, row.execution_model,
    row.evidence_integrity_passed ? 1 : 0, row.run_hash, JSON.stringify(row), summary.created_at));
  for (const row of verdictRecords) statements.push(env.DB.prepare(
    `INSERT INTO directional_research_verdicts
     (id, batch_id, candidate_id, verdict, reason_codes_json, metrics_json, verdict_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(row.id, row.batch_id, row.candidate_id, row.verdict, JSON.stringify(row.reason_codes), JSON.stringify(row.metrics), row.verdict_hash, summary.created_at));
  statements.push(env.DB.prepare(
    `INSERT INTO directional_research_portfolio_selections
     (id, batch_id, state, champion_candidate_ids_json, challenger_candidate_ids_json, ranking_json, cash_is_valid_allocation, selection_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(selectionRecord.id, selectionRecord.batch_id, selectionRecord.state,
    JSON.stringify(selectionRecord.champion_candidate_ids), JSON.stringify(selectionRecord.challenger_candidate_ids),
    JSON.stringify(selectionRecord.ranking), selectionRecord.cash_is_valid_allocation ? 1 : 0,
    selectionRecord.selection_hash, summary.created_at));

  try {
    await env.DB.batch(statements);
  } catch (error) {
    const raced = await readBatch(env, summary.batch_id);
    if (raced) return raced;
    throw error;
  }
}

async function readExactHistory(env, asOfClosedAt, required) {
  const result = await env.DB.prepare(
    `SELECT pair AS market, interval, closed_at, open, high, low, close, volume
     FROM (
       SELECT pair, interval, closed_at, open, high, low, close, volume
       FROM market_candles
       WHERE pair = ? AND interval = ? AND closed_at <= ?
       ORDER BY closed_at DESC LIMIT ?
     ) ORDER BY closed_at ASC`,
  ).bind(MARKET, INTERVAL, asOfClosedAt, required).all();
  const rows = result.results || [];
  if (rows.length !== required) throw new Error(`directional_research_requires_${required}_candles`);
  return rows.map((row) => ({
    ...row,
    open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close), volume: Number(row.volume),
  }));
}

async function latestClosedAt(env) {
  const row = await env.DB.prepare(
    `SELECT closed_at FROM market_candles WHERE pair = ? AND interval = ? ORDER BY closed_at DESC LIMIT 1`,
  ).bind(MARKET, INTERVAL).first();
  return row?.closed_at || null;
}

async function readShadowEvidence(env, candidateIds) {
  const map = new Map(candidateIds.map((id) => [id, emptyShadow()]));
  const portfolioRows = (await env.DB.prepare(
    `SELECT candidate_id, initial_equity, equity, max_drawdown_percent
     FROM directional_shadow_portfolios WHERE status = 'active'`,
  ).all()).results || [];
  const cycleRows = (await env.DB.prepare(
    `SELECT candidate_id, prior_exposure, target_exposure, status
     FROM directional_shadow_candidate_cycles ORDER BY execution_candle_closed_at ASC`,
  ).all()).results || [];
  for (const row of cycleRows) {
    if (!map.has(row.candidate_id)) continue;
    const evidence = map.get(row.candidate_id);
    evidence.cycle_count += 1;
    if (row.status === "filled" && Number(row.prior_exposure) !== 0
      && (Number(row.target_exposure) === 0 || Math.sign(Number(row.prior_exposure)) !== Math.sign(Number(row.target_exposure)))) {
      evidence.closed_trade_count += 1;
    }
  }
  for (const row of portfolioRows) {
    if (!map.has(row.candidate_id)) continue;
    const evidence = map.get(row.candidate_id);
    evidence.return_percent = ((Number(row.equity) / Number(row.initial_equity)) - 1) * 100;
    evidence.max_drawdown_percent = Number(row.max_drawdown_percent);
  }
  return map;
}

function calculateFamilyFragility(backtests) {
  const medians = new Map(backtests.map((candidate) => [candidate.candidate_id, median(candidate.windows.map((row) => row.test_return_percent))]));
  const families = new Map();
  for (const strategy of DIRECTIONAL_STRATEGIES) {
    if (!families.has(strategy.family)) families.set(strategy.family, []);
    families.get(strategy.family).push(strategy.id);
  }
  const result = new Map();
  for (const ids of families.values()) {
    const familyMedian = median(ids.map((id) => medians.get(id)));
    for (const id of ids) {
      const value = medians.get(id);
      result.set(id, Math.min(100, Math.abs(value - familyMedian) / Math.max(1, Math.abs(familyMedian)) * 100));
    }
  }
  return result;
}

function calculateRegimeCoverage(windows, backtests) {
  const regimes = windows.map((window) => {
    const start = Number(window.test[0].close);
    const end = Number(window.test.at(-1).close);
    const move = ((end / start) - 1) * 100;
    return move > 2 ? "up" : move < -2 ? "down" : "sideways";
  });
  const distinct = new Set(regimes);
  const result = new Map();
  for (const candidate of backtests) {
    const tradedRegimes = new Set(candidate.windows
      .map((row, index) => row.closed_trade_count > 0 ? regimes[index] : null)
      .filter(Boolean));
    result.set(candidate.candidate_id, distinct.size >= 2 && tradedRegimes.size >= 2);
  }
  return result;
}

async function readBatch(env, batchId) {
  const row = await env.DB.prepare(
    `SELECT result_json FROM directional_research_batches WHERE id = ?`,
  ).bind(batchId).first();
  return row ? JSON.parse(row.result_json) : null;
}

function emptyShadow() {
  return { cycle_count: 0, closed_trade_count: 0, return_percent: 0, max_drawdown_percent: 0 };
}

function windowOrdinal(windowId) {
  const match = String(windowId).match(/window:(\d+)$/);
  if (!match) throw new Error("directional_research_invalid_window_id");
  return Number(match[1]);
}

function median(values) {
  const sorted = values.map(Number).sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

async function hashObject(value) {
  const bytes = new TextEncoder().encode(stableStringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function iso(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`invalid_${label}`);
  return date.toISOString();
}
