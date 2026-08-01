const POLICY_ID = "qualified-only-selection-v1";
const BATCH_ID = "stage6-selection-v1:stage5-controlled-factory-v1";
const SOURCE_FACTORY_BATCH_ID = "stage5-controlled-factory-v1";
const MAX_CHALLENGERS = 2;

export const SELECTION_POLICY = deepFreeze({
  id: POLICY_ID,
  version: 1,
  eligibility: "hostile_judge_verdict_equals_qualified",
  ranking_formula: {
    test_return_weight: 1,
    doubled_cost_return_weight: 0.5,
    tripled_cost_return_weight: 0.25,
    test_drawdown_penalty_weight: 0.5,
  },
  tie_breakers: ["score_desc", "candidate_id_asc"],
  champion_limit: 1,
  challenger_limit: MAX_CHALLENGERS,
  fallback_selection_allowed: false,
  paper_execution_allowed: false,
  scheduling_allowed: false,
  live_capital_enabled: false,
});

export async function runProductionChampionSelection(env, options = {}) {
  const existing = await readSelectionBatch(env, BATCH_ID);
  if (existing) return { ...existing, replayed: true };
  const source = await readFactoryEvidence(env, SOURCE_FACTORY_BATCH_ID);
  const built = await buildChampionSelection(source, {
    batchId: BATCH_ID,
    createdAt: options.now || new Date(),
  });
  const existingPolicy = await readPolicy(env, POLICY_ID);
  if (existingPolicy && existingPolicy.policy_hash !== built.policy.policy_hash) {
    throw new Error("selection_policy_hash_conflict");
  }
  try {
    await persistSelection(env, built, Boolean(existingPolicy));
  } catch (error) {
    const raced = await readSelectionBatch(env, BATCH_ID);
    if (raced) return { ...raced, replayed: true };
    throw error;
  }
  return { ...built.summary, replayed: false };
}

export async function runChampionSelectionForFactoryBatch(env, factoryBatchId, options = {}) {
  if (!factoryBatchId) throw new Error("selection_source_factory_batch_required");
  const batchId = options.batchId || `rolling-selection-v1:${factoryBatchId}`;
  const existing = await readSelectionBatch(env, batchId);
  if (existing) return { ...existing, replayed: true };
  const source = await readFactoryEvidence(env, factoryBatchId);
  const built = await buildChampionSelection(source, {
    batchId,
    sourceFactoryBatchId: factoryBatchId,
    createdAt: options.now || new Date(),
  });
  const existingPolicy = await readPolicy(env, POLICY_ID);
  if (existingPolicy && existingPolicy.policy_hash !== built.policy.policy_hash) {
    throw new Error("selection_policy_hash_conflict");
  }
  try {
    await persistSelection(env, built, Boolean(existingPolicy));
  } catch (error) {
    const raced = await readSelectionBatch(env, batchId);
    if (raced) return { ...raced, replayed: true };
    throw error;
  }
  return { ...built.summary, replayed: false };
}

export async function getChampionSelectionSummary(env) {
  const row = await env.DB.prepare(
    `SELECT id, summary_json, created_at FROM selection_batches
     ORDER BY created_at DESC LIMIT 1`,
  ).first();
  if (!row) return null;
  return {
    ...parseJson(row.summary_json, "selection_summary_invalid"),
    batch_id: row.id,
    created_at: row.created_at,
    paper_execution_started: false,
    scheduling_started: false,
    live_capital_enabled: false,
  };
}

export async function buildChampionSelection(source, options = {}) {
  validateSource(source, options.sourceFactoryBatchId || SOURCE_FACTORY_BATCH_ID);
  const batchId = options.batchId || BATCH_ID;
  const createdAt = iso(options.createdAt || new Date(), "created_at");
  const policyHash = await stableHash(SELECTION_POLICY);
  const policy = {
    id: POLICY_ID,
    version: SELECTION_POLICY.version,
    policy_json: canonicalJson(SELECTION_POLICY),
    policy_hash: policyHash,
    created_at: createdAt,
  };

  const eligible = [];
  const ineligible = [];
  for (const evidence of source.candidates) {
    validateCandidateEvidence(evidence);
    if (evidence.verdict === "qualified") {
      const metrics = normalizedMetrics(evidence.summary);
      eligible.push({
        ...evidence,
        metrics,
        score: selectionScore(metrics),
      });
    } else {
      ineligible.push({
        ...evidence,
        metrics: normalizedMetrics(evidence.summary, true),
        blocker_codes: [
          "verdict_not_qualified",
          ...uniqueStrings(evidence.reason_codes),
        ],
      });
    }
  }

  eligible.sort((left, right) => right.score - left.score || left.candidate_id.localeCompare(right.candidate_id));
  const champion = eligible[0] || null;
  const challengers = eligible.slice(1, 1 + MAX_CHALLENGERS);
  const rankingByCandidate = new Map();
  eligible.forEach((entry, index) => rankingByCandidate.set(entry.candidate_id, index + 1));

  const rankings = [];
  for (const evidence of eligible) {
    const rank = rankingByCandidate.get(evidence.candidate_id);
    const role = rank === 1 ? "champion" : rank <= 1 + MAX_CHALLENGERS ? "challenger" : "none";
    rankings.push(rankingRow({
      batchId,
      evidence,
      eligible: true,
      selectedRole: role,
      rankPosition: rank,
      score: evidence.score,
      blockerCodes: [],
      createdAt,
    }));
  }
  for (const evidence of ineligible.sort((a, b) => a.candidate_id.localeCompare(b.candidate_id))) {
    rankings.push(rankingRow({
      batchId,
      evidence,
      eligible: false,
      selectedRole: "none",
      rankPosition: null,
      score: null,
      blockerCodes: evidence.blocker_codes,
      createdAt,
    }));
  }

  const state = champion ? "champion_selected" : "no_champion";
  const blockerCodes = champion ? [] : ["no_qualified_candidates"];
  const selectionHash = await stableHash({
    batch_id: batchId,
    policy_hash: policyHash,
    source_factory_batch_id: source.batch.id,
    source_factory_batch_hash: source.batch.batch_hash,
    state,
    champion_candidate_id: champion?.candidate_id || null,
    challenger_candidate_ids: challengers.map((entry) => entry.candidate_id),
    rankings: rankings.map((row) => ({
      candidate_id: row.candidate_id,
      eligible: row.eligible,
      selected_role: row.selected_role,
      rank_position: row.rank_position,
      score: row.score,
      evidence_hash: row.evidence_hash,
    })),
  });
  const summary = {
    ok: true,
    historical_paper_research: true,
    live_capital_enabled: false,
    paper_execution_started: false,
    scheduling_started: false,
    fallback_selection_allowed: false,
    selection_policy_id: POLICY_ID,
    selection_policy_hash: policyHash,
    batch_id: batchId,
    selection_hash: selectionHash,
    source_factory_batch_id: source.batch.id,
    source_factory_batch_hash: source.batch.batch_hash,
    state,
    champion_candidate_id: champion?.candidate_id || null,
    challenger_candidate_ids: challengers.map((entry) => entry.candidate_id),
    eligible_count: eligible.length,
    evaluated_count: source.candidates.length,
    blocker_codes: blockerCodes,
    ranking: rankings
      .filter((row) => row.eligible === 1)
      .sort((a, b) => a.rank_position - b.rank_position)
      .map((row) => ({
        candidate_id: row.candidate_id,
        selected_role: row.selected_role,
        rank_position: row.rank_position,
        score: row.score,
      })),
    created_at: createdAt,
  };
  return {
    policy,
    rankings,
    batch: {
      id: batchId,
      policy_id: POLICY_ID,
      policy_hash: policyHash,
      source_factory_batch_id: source.batch.id,
      source_factory_batch_hash: source.batch.batch_hash,
      state,
      champion_candidate_id: champion?.candidate_id || null,
      challenger_count: challengers.length,
      eligible_count: eligible.length,
      blocker_codes_json: JSON.stringify(blockerCodes),
      selection_hash: selectionHash,
      summary_json: JSON.stringify(summary),
      created_at: createdAt,
    },
    summary,
  };
}

function rankingRow({ batchId, evidence, eligible, selectedRole, rankPosition, score, blockerCodes, createdAt }) {
  return {
    id: `${batchId}:ranking:${evidence.candidate_id}`,
    batch_id: batchId,
    candidate_id: evidence.candidate_id,
    eligible: eligible ? 1 : 0,
    selected_role: selectedRole,
    rank_position: rankPosition,
    score,
    verdict: evidence.verdict,
    blocker_codes_json: JSON.stringify(blockerCodes),
    evidence_hash: evidence.evidence_hash,
    metrics_json: JSON.stringify(normalizedMetrics(evidence.summary, true)),
    created_at: createdAt,
  };
}

export function selectionScore(metrics) {
  const weights = SELECTION_POLICY.ranking_formula;
  return (
    metrics.test_return_percent * weights.test_return_weight
    + metrics.doubled_cost_return_percent * weights.doubled_cost_return_weight
    + metrics.tripled_cost_return_percent * weights.tripled_cost_return_weight
    - metrics.test_drawdown_percent * weights.test_drawdown_penalty_weight
  );
}

function validateSource(source, expectedFactoryBatchId = SOURCE_FACTORY_BATCH_ID) {
  if (!source?.batch?.id || source.batch.id !== expectedFactoryBatchId) {
    throw new Error("selection_source_factory_batch_mismatch");
  }
  if (!source.batch.batch_hash || !Array.isArray(source.candidates)) {
    throw new Error("selection_source_evidence_missing");
  }
  if (source.candidates.length !== Number(source.batch.candidate_count)) {
    throw new Error("selection_candidate_count_mismatch");
  }
}

function validateCandidateEvidence(evidence) {
  if (!evidence?.candidate_id || !evidence.evidence_hash) throw new Error("selection_candidate_evidence_missing");
  if (!["qualified", "insufficient_evidence", "rejected"].includes(evidence.verdict)) {
    throw new Error("selection_candidate_verdict_invalid");
  }
  if (!Array.isArray(evidence.reason_codes) || typeof evidence.summary !== "object") {
    throw new Error("selection_candidate_evidence_invalid");
  }
}

function normalizedMetrics(summary, allowNull = false) {
  const keys = [
    "test_return_percent",
    "test_drawdown_percent",
    "doubled_cost_return_percent",
    "tripled_cost_return_percent",
  ];
  const output = {};
  for (const key of keys) {
    const value = summary?.[key];
    if (value === null || value === undefined) {
      if (allowNull) {
        output[key] = null;
        continue;
      }
      throw new Error(`selection_metric_invalid:${key}`);
    }
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error(`selection_metric_invalid:${key}`);
    output[key] = number;
  }
  return output;
}

async function readFactoryEvidence(env, batchId) {
  const batch = await env.DB.prepare(
    `SELECT id, batch_hash, candidate_count FROM strategy_factory_batches WHERE id = ?`,
  ).bind(batchId).first();
  if (!batch) throw new Error("selection_source_factory_batch_not_found");
  const rows = await env.DB.prepare(
    `SELECT v.candidate_id, v.verdict, v.reason_codes_json, v.evidence_hash, v.summary_json
     FROM strategy_candidate_verdicts v
     WHERE v.batch_id = ?
     ORDER BY v.candidate_id ASC`,
  ).bind(batchId).all();
  return {
    batch,
    candidates: (rows.results || []).map((row) => ({
      candidate_id: row.candidate_id,
      verdict: row.verdict,
      reason_codes: parseJson(row.reason_codes_json, "selection_reason_codes_invalid"),
      evidence_hash: row.evidence_hash,
      summary: parseJson(row.summary_json, "selection_candidate_summary_invalid"),
    })),
  };
}

async function persistSelection(env, built, policyExists) {
  const statements = [];
  if (!policyExists) {
    statements.push(env.DB.prepare(
      `INSERT INTO selection_policies (id, version, policy_json, policy_hash, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(built.policy.id, built.policy.version, built.policy.policy_json, built.policy.policy_hash, built.policy.created_at));
  }
  statements.push(env.DB.prepare(
    `INSERT INTO selection_batches (
       id, policy_id, policy_hash, source_factory_batch_id, source_factory_batch_hash,
       state, champion_candidate_id, challenger_count, eligible_count, blocker_codes_json,
       selection_hash, summary_json, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    built.batch.id, built.batch.policy_id, built.batch.policy_hash,
    built.batch.source_factory_batch_id, built.batch.source_factory_batch_hash,
    built.batch.state, built.batch.champion_candidate_id, built.batch.challenger_count,
    built.batch.eligible_count, built.batch.blocker_codes_json, built.batch.selection_hash,
    built.batch.summary_json, built.batch.created_at,
  ));
  for (const row of built.rankings) {
    statements.push(env.DB.prepare(
      `INSERT INTO selection_rankings (
         id, batch_id, candidate_id, eligible, selected_role, rank_position, score,
         verdict, blocker_codes_json, evidence_hash, metrics_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      row.id, row.batch_id, row.candidate_id, row.eligible, row.selected_role,
      row.rank_position, row.score, row.verdict, row.blocker_codes_json,
      row.evidence_hash, row.metrics_json, row.created_at,
    ));
  }
  await env.DB.batch(statements);
}

async function readSelectionBatch(env, batchId) {
  const row = await env.DB.prepare(
    `SELECT id, selection_hash, summary_json, created_at FROM selection_batches WHERE id = ?`,
  ).bind(batchId).first();
  if (!row) return null;
  return {
    ...parseJson(row.summary_json, "selection_summary_invalid"),
    batch_id: row.id,
    selection_hash: row.selection_hash,
    created_at: row.created_at,
  };
}

async function readPolicy(env, policyId) {
  return env.DB.prepare(
    `SELECT id, policy_hash, created_at FROM selection_policies WHERE id = ?`,
  ).bind(policyId).first();
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string"))];
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
  if (!Number.isFinite(millis)) throw new Error(`selection_invalid_${field}`);
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
