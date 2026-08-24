import { validateInstitutionalResearchSpec } from "./institutionalResearchSpec.js";

const MARKET = "BTC-USD";
const INTERVAL = "1h";

export const INSTITUTIONAL_RESEARCH_POLICY = Object.freeze({
  id: "institutional-research-portfolio-v2",
  version: 2,
  market: MARKET,
  interval: INTERVAL,
  allowed_families: Object.freeze([
    "trend",
    "breakout",
    "momentum",
    "volatility",
    "mean_reversion",
    "regime_filter",
    "price_action",
  ]),
  allowed_origins: Object.freeze(["operator", "bounded_factory"]),
  max_registered_hypotheses: 100,
  max_factory_admissions_per_utc_day: 6,
  states: Object.freeze(["proposed", "admitted", "testing", "rejected", "qualified", "retired", "superseded"]),
  transitions: Object.freeze({
    proposed: Object.freeze(["admitted", "rejected", "retired"]),
    admitted: Object.freeze(["testing", "rejected", "retired"]),
    testing: Object.freeze(["rejected", "qualified", "retired"]),
    rejected: Object.freeze([]),
    qualified: Object.freeze(["retired", "superseded"]),
    retired: Object.freeze([]),
    superseded: Object.freeze([]),
  }),
  qualification_transition_enabled: true,
  stage13_promotion_authority_unchanged: true,
  paper_only: true,
  live_capital_enabled: false,
});

export async function registerInstitutionalHypothesis(env, input, options = {}) {
  requireDatabase(env);
  const hypothesis = validateHypothesisInput(input);
  const createdAt = iso(options.now || new Date(), "created_at");
  const record = {
    id: hypothesis.id,
    title: hypothesis.title,
    family: hypothesis.family,
    origin: hypothesis.origin,
    market: MARKET,
    interval: INTERVAL,
    economic_mechanism: hypothesis.economic_mechanism,
    market_premise: hypothesis.market_premise,
    expected_failure_modes: hypothesis.expected_failure_modes,
    research_function: hypothesis.research_function,
    lineage_parent_id: hypothesis.lineage_parent_id || null,
    materially_new_evidence: hypothesis.materially_new_evidence || null,
    preregistration: hypothesis.preregistration,
    created_at: createdAt,
  };
  const preregistrationHash = await hashObject(record.preregistration);
  const hypothesisHash = await hashObject({ ...record, preregistration_hash: preregistrationHash });

  const existing = await readHypothesis(env, record.id);
  if (existing) {
    if (existing.hypothesis_hash !== hypothesisHash) throw new Error("institutional_hypothesis_id_conflict");
    return { ok: true, paper_only: true, live_capital_enabled: false, hypothesis: existing, replayed: true };
  }

  const countRow = await env.DB.prepare("SELECT COUNT(*) AS count FROM institutional_hypotheses").first();
  if (Number(countRow?.count || 0) >= INSTITUTIONAL_RESEARCH_POLICY.max_registered_hypotheses) {
    throw new Error("institutional_hypothesis_registry_capacity_reached");
  }

  if (record.lineage_parent_id) {
    const parent = await readHypothesis(env, record.lineage_parent_id);
    if (!parent) throw new Error("institutional_hypothesis_lineage_parent_missing");
    if (parent.state === "rejected" && !isMateriallyNewEvidence(record.materially_new_evidence)) {
      throw new Error("rejected_hypothesis_requires_materially_new_evidence");
    }
  }

  let factoryAdmission = null;
  if (record.origin === "bounded_factory") {
    factoryAdmission = validateFactoryAdmission(hypothesis.factory_admission);
    const dayStart = `${createdAt.slice(0, 10)}T00:00:00.000Z`;
    const factoryCount = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM institutional_factory_admissions WHERE created_at >= ?",
    ).bind(dayStart).first();
    if (Number(factoryCount?.count || 0) >= INSTITUTIONAL_RESEARCH_POLICY.max_factory_admissions_per_utc_day) {
      throw new Error("institutional_factory_daily_admission_cap_reached");
    }
  }

  const initialEvent = {
    id: `${record.id}:event:0001`,
    hypothesis_id: record.id,
    sequence: 1,
    from_state: null,
    to_state: "proposed",
    reason_codes: ["hypothesis_registered"],
    evidence_summary: "Immutable preregistration accepted before research evidence was observed.",
    independent_verdict_id: null,
    created_at: createdAt,
  };
  const eventHash = await hashObject(initialEvent);

  const statements = [
    env.DB.prepare(
      `INSERT INTO institutional_hypotheses
       (id, title, family, origin, market, interval, economic_mechanism, market_premise,
        expected_failure_modes_json, research_function, lineage_parent_id, materially_new_evidence,
        preregistration_json, preregistration_hash, hypothesis_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      record.id, record.title, record.family, record.origin, record.market, record.interval,
      record.economic_mechanism, record.market_premise, JSON.stringify(record.expected_failure_modes),
      record.research_function, record.lineage_parent_id, record.materially_new_evidence,
      JSON.stringify(record.preregistration), preregistrationHash, hypothesisHash, createdAt,
    ),
    env.DB.prepare(
      `INSERT INTO institutional_hypothesis_events
       (id, hypothesis_id, sequence, from_state, to_state, reason_codes_json, evidence_summary,
        independent_verdict_id, event_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      initialEvent.id, record.id, initialEvent.sequence, initialEvent.from_state, initialEvent.to_state,
      JSON.stringify(initialEvent.reason_codes), initialEvent.evidence_summary, initialEvent.independent_verdict_id,
      eventHash, createdAt,
    ),
  ];

  if (factoryAdmission) {
    const admission = {
      id: `${record.id}:factory-admission`,
      hypothesis_id: record.id,
      family: record.family,
      novelty_basis: factoryAdmission.novelty_basis,
      expected_information_gain: factoryAdmission.expected_information_gain,
      created_at: createdAt,
    };
    const admissionHash = await hashObject(admission);
    statements.push(env.DB.prepare(
      `INSERT INTO institutional_factory_admissions
       (id, hypothesis_id, family, novelty_basis, expected_information_gain, admission_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      admission.id, admission.hypothesis_id, admission.family, admission.novelty_basis,
      admission.expected_information_gain, admissionHash, createdAt,
    ));
  }

  try {
    await env.DB.batch(statements);
  } catch (error) {
    const raced = await readHypothesis(env, record.id);
    if (raced?.hypothesis_hash === hypothesisHash) {
      return { ok: true, paper_only: true, live_capital_enabled: false, hypothesis: raced, replayed: true };
    }
    throw error;
  }

  return {
    ok: true,
    paper_only: true,
    live_capital_enabled: false,
    hypothesis: {
      ...record,
      preregistration_hash: preregistrationHash,
      hypothesis_hash: hypothesisHash,
      state: "proposed",
      state_sequence: 1,
    },
    replayed: false,
  };
}

export async function advanceInstitutionalHypothesis(env, input, options = {}) {
  requireDatabase(env);
  const hypothesisId = cleanId(input?.hypothesis_id, "hypothesis_id");
  const targetState = cleanEnum(input?.target_state, INSTITUTIONAL_RESEARCH_POLICY.states, "target_state");
  const createdAt = iso(options.now || new Date(), "created_at");
  const current = await readHypothesis(env, hypothesisId);
  if (!current) throw new Error("institutional_hypothesis_not_found");
  if (current.state === targetState) {
    return { ok: true, paper_only: true, live_capital_enabled: false, hypothesis: current, replayed: true };
  }
  if (targetState === "qualified") {
    if (!INSTITUTIONAL_RESEARCH_POLICY.qualification_transition_enabled) throw new Error("institutional_qualification_requires_independent_judge_integration");
    await assertIndependentQualification(env, hypothesisId);
  }
  const allowed = INSTITUTIONAL_RESEARCH_POLICY.transitions[current.state] || [];
  if (!allowed.includes(targetState)) throw new Error("institutional_hypothesis_transition_not_allowed");

  const reasonCodes = cleanStringArray(input?.reason_codes || [], "reason_codes", 12, targetState === "rejected" ? 1 : 0);
  const evidenceSummary = cleanOptionalString(input?.evidence_summary, "evidence_summary", 2000);
  if (targetState === "rejected" && !evidenceSummary) throw new Error("institutional_rejection_evidence_required");
  const independentVerdictId = cleanOptionalString(input?.independent_verdict_id, "independent_verdict_id", 160);

  const sequence = Number(current.state_sequence || 0) + 1;
  const event = {
    id: `${hypothesisId}:event:${String(sequence).padStart(4, "0")}`,
    hypothesis_id: hypothesisId,
    sequence,
    from_state: current.state,
    to_state: targetState,
    reason_codes: reasonCodes,
    evidence_summary: evidenceSummary || "",
    independent_verdict_id: independentVerdictId || null,
    created_at: createdAt,
  };
  const eventHash = await hashObject(event);
  const statements = [env.DB.prepare(
    `INSERT INTO institutional_hypothesis_events
     (id, hypothesis_id, sequence, from_state, to_state, reason_codes_json, evidence_summary,
      independent_verdict_id, event_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    event.id, event.hypothesis_id, event.sequence, event.from_state, event.to_state,
    JSON.stringify(event.reason_codes), event.evidence_summary, event.independent_verdict_id,
    eventHash, createdAt,
  )];

  if (targetState === "rejected") {
    const rejection = {
      id: `${hypothesisId}:rejection`,
      hypothesis_id: hypothesisId,
      family: current.family,
      reason_codes: reasonCodes,
      evidence_summary: evidenceSummary,
      created_at: createdAt,
    };
    const rejectionHash = await hashObject(rejection);
    statements.push(env.DB.prepare(
      `INSERT INTO institutional_rejection_memory
       (id, hypothesis_id, family, reason_codes_json, evidence_summary, rejection_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      rejection.id, rejection.hypothesis_id, rejection.family, JSON.stringify(rejection.reason_codes),
      rejection.evidence_summary, rejectionHash, createdAt,
    ));
  }

  await env.DB.batch(statements);
  return {
    ok: true,
    paper_only: true,
    live_capital_enabled: false,
    hypothesis: {
      ...current,
      state: targetState,
      state_sequence: sequence,
      latest_reason_codes: reasonCodes,
      latest_evidence_summary: evidenceSummary || "",
      latest_event_hash: eventHash,
    },
    replayed: false,
  };
}

export async function getInstitutionalResearchPortfolioSummary(env, options = {}) {
  requireDatabase(env);
  const [hypothesisRows, eventRows, rejectionRows, factoryRows] = await Promise.all([
    env.DB.prepare(
      `SELECT id, title, family, origin, market, interval, economic_mechanism, market_premise,
              expected_failure_modes_json, research_function, lineage_parent_id, materially_new_evidence,
              preregistration_json, preregistration_hash, hypothesis_hash, created_at
       FROM institutional_hypotheses ORDER BY created_at ASC, id ASC LIMIT 100`,
    ).all(),
    env.DB.prepare(
      `SELECT hypothesis_id, sequence, from_state, to_state, reason_codes_json, evidence_summary,
              independent_verdict_id, event_hash, created_at
       FROM institutional_hypothesis_events ORDER BY hypothesis_id ASC, sequence ASC LIMIT 1000`,
    ).all(),
    env.DB.prepare(
      `SELECT hypothesis_id, family, reason_codes_json, evidence_summary, rejection_hash, created_at
       FROM institutional_rejection_memory ORDER BY created_at DESC LIMIT 100`,
    ).all(),
    env.DB.prepare(
      `SELECT hypothesis_id, family, novelty_basis, expected_information_gain, admission_hash, created_at
       FROM institutional_factory_admissions ORDER BY created_at DESC LIMIT 100`,
    ).all(),
  ]);

  const latestEvents = new Map();
  for (const row of eventRows.results || []) latestEvents.set(row.hypothesis_id, row);
  const hypotheses = (hypothesisRows.results || []).map((row) => {
    const event = latestEvents.get(row.id) || null;
    return {
      id: row.id,
      title: row.title,
      family: row.family,
      origin: row.origin,
      market: row.market,
      interval: row.interval,
      economic_mechanism: row.economic_mechanism,
      market_premise: row.market_premise,
      expected_failure_modes: JSON.parse(row.expected_failure_modes_json),
      research_function: row.research_function,
      lineage_parent_id: row.lineage_parent_id,
      materially_new_evidence: row.materially_new_evidence,
      preregistration: JSON.parse(row.preregistration_json),
      preregistration_hash: row.preregistration_hash,
      hypothesis_hash: row.hypothesis_hash,
      created_at: row.created_at,
      state: event?.to_state || "unknown",
      state_sequence: Number(event?.sequence || 0),
      latest_reason_codes: event ? JSON.parse(event.reason_codes_json) : [],
      latest_evidence_summary: event?.evidence_summary || "",
      latest_event_hash: event?.event_hash || null,
    };
  });
  const now = iso(options.now || new Date(), "now");
  return {
    ok: true,
    paper_only: true,
    live_capital_enabled: false,
    stage13_promotion_authority_unchanged: true,
    qualification_transition_enabled: INSTITUTIONAL_RESEARCH_POLICY.qualification_transition_enabled,
    policy: INSTITUTIONAL_RESEARCH_POLICY,
    hypothesis_count: hypotheses.length,
    hypotheses,
    rejection_memory: (rejectionRows.results || []).map((row) => ({
      ...row,
      reason_codes: JSON.parse(row.reason_codes_json),
      reason_codes_json: undefined,
    })),
    factory_admissions: factoryRows.results || [],
    throughput: buildResearchThroughput(hypotheses, now),
  };
}

export function validateHypothesisInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("institutional_hypothesis_object_required");
  const id = cleanId(input.id, "id");
  const title = cleanString(input.title, "title", 180);
  const family = cleanEnum(input.family, INSTITUTIONAL_RESEARCH_POLICY.allowed_families, "family");
  const origin = cleanEnum(input.origin, INSTITUTIONAL_RESEARCH_POLICY.allowed_origins, "origin");
  if (input.market !== MARKET) throw new Error("institutional_hypothesis_market_not_allowed");
  if (input.interval !== INTERVAL) throw new Error("institutional_hypothesis_interval_not_allowed");
  const economicMechanism = cleanString(input.economic_mechanism, "economic_mechanism", 3000);
  const marketPremise = cleanString(input.market_premise, "market_premise", 3000);
  const expectedFailureModes = cleanStringArray(input.expected_failure_modes, "expected_failure_modes", 12, 1);
  const researchFunction = cleanEnum(input.research_function, ["alpha_research", "data_research", "execution_research", "portfolio_research", "risk_research"], "research_function");
  const lineageParentId = input.lineage_parent_id ? cleanId(input.lineage_parent_id, "lineage_parent_id") : null;
  const materiallyNewEvidence = cleanOptionalString(input.materially_new_evidence, "materially_new_evidence", 3000);
  const preregistration = validatePreregistration(input.preregistration);
  const factoryAdmission = origin === "bounded_factory" ? validateFactoryAdmission(input.factory_admission) : null;
  return {
    id,
    title,
    family,
    origin,
    market: MARKET,
    interval: INTERVAL,
    economic_mechanism: economicMechanism,
    market_premise: marketPremise,
    expected_failure_modes: expectedFailureModes,
    research_function: researchFunction,
    lineage_parent_id: lineageParentId,
    materially_new_evidence: materiallyNewEvidence,
    preregistration,
    factory_admission: factoryAdmission,
  };
}

export function assertLifecycleTransition(fromState, targetState) {
  const from = cleanEnum(fromState, INSTITUTIONAL_RESEARCH_POLICY.states, "from_state");
  const target = cleanEnum(targetState, INSTITUTIONAL_RESEARCH_POLICY.states, "target_state");
  if (target === "qualified" && !INSTITUTIONAL_RESEARCH_POLICY.qualification_transition_enabled) {
    throw new Error("institutional_qualification_requires_independent_judge_integration");
  }
  if (!(INSTITUTIONAL_RESEARCH_POLICY.transitions[from] || []).includes(target)) {
    throw new Error("institutional_hypothesis_transition_not_allowed");
  }
  return true;
}

export function buildResearchThroughput(hypotheses, now = new Date().toISOString()) {
  const counts = Object.fromEntries(INSTITUTIONAL_RESEARCH_POLICY.states.map((state) => [state, 0]));
  let oldestOpenCreatedAt = null;
  for (const row of hypotheses || []) {
    if (Object.hasOwn(counts, row.state)) counts[row.state] += 1;
    if (["proposed", "admitted", "testing"].includes(row.state)) {
      if (!oldestOpenCreatedAt || row.created_at < oldestOpenCreatedAt) oldestOpenCreatedAt = row.created_at;
    }
  }
  const terminal = counts.rejected + counts.retired + counts.superseded + counts.qualified;
  const usefulEvidence = counts.rejected + counts.qualified;
  const queueAgeHours = oldestOpenCreatedAt
    ? Math.max(0, (Date.parse(now) - Date.parse(oldestOpenCreatedAt)) / 3600000)
    : 0;
  return {
    counts,
    open_count: counts.proposed + counts.admitted + counts.testing,
    terminal_count: terminal,
    useful_evidence_count: usefulEvidence,
    rejection_rate_percent: terminal > 0 ? (counts.rejected / terminal) * 100 : 0,
    oldest_open_age_hours: Number.isFinite(queueAgeHours) ? queueAgeHours : 0,
  };
}

async function assertIndependentQualification(env, hypothesisId) {
  const row = await env.DB.prepare(
    `SELECT verdict, verdict_hash FROM institutional_research_verdicts WHERE hypothesis_id = ? ORDER BY sequence DESC LIMIT 1`,
  ).bind(hypothesisId).first();
  if (!row || row.verdict !== "qualified" || !row.verdict_hash) {
    throw new Error("institutional_qualification_requires_sealed_independent_verdict");
  }
  return row;
}

async function readHypothesis(env, id) {
  const row = await env.DB.prepare(
    `SELECT id, title, family, origin, market, interval, economic_mechanism, market_premise,
            expected_failure_modes_json, research_function, lineage_parent_id, materially_new_evidence,
            preregistration_json, preregistration_hash, hypothesis_hash, created_at
     FROM institutional_hypotheses WHERE id = ?`,
  ).bind(id).first();
  if (!row) return null;
  const event = await env.DB.prepare(
    `SELECT sequence, to_state, reason_codes_json, evidence_summary, independent_verdict_id, event_hash, created_at
     FROM institutional_hypothesis_events WHERE hypothesis_id = ? ORDER BY sequence DESC LIMIT 1`,
  ).bind(id).first();
  return {
    id: row.id,
    title: row.title,
    family: row.family,
    origin: row.origin,
    market: row.market,
    interval: row.interval,
    economic_mechanism: row.economic_mechanism,
    market_premise: row.market_premise,
    expected_failure_modes: JSON.parse(row.expected_failure_modes_json),
    research_function: row.research_function,
    lineage_parent_id: row.lineage_parent_id,
    materially_new_evidence: row.materially_new_evidence,
    preregistration: JSON.parse(row.preregistration_json),
    preregistration_hash: row.preregistration_hash,
    hypothesis_hash: row.hypothesis_hash,
    created_at: row.created_at,
    state: event?.to_state || "unknown",
    state_sequence: Number(event?.sequence || 0),
    latest_reason_codes: event ? JSON.parse(event.reason_codes_json) : [],
    latest_evidence_summary: event?.evidence_summary || "",
    latest_event_hash: event?.event_hash || null,
  };
}

function validatePreregistration(value) {
  return validateInstitutionalResearchSpec(value);
}

function validateFactoryAdmission(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("institutional_factory_admission_required");
  const keys = Object.keys(value);
  if (keys.some((key) => !["novelty_basis", "expected_information_gain"].includes(key))) {
    throw new Error("institutional_factory_admission_unknown_field");
  }
  const noveltyBasis = cleanString(value.novelty_basis, "factory_novelty_basis", 2000);
  const informationGain = Number(value.expected_information_gain);
  if (!Number.isFinite(informationGain) || informationGain < 0 || informationGain > 1) {
    throw new Error("institutional_factory_information_gain_out_of_bounds");
  }
  return { novelty_basis: noveltyBasis, expected_information_gain: informationGain };
}

function isMateriallyNewEvidence(value) {
  return typeof value === "string" && value.trim().length >= 40;
}

function cleanId(value, field) {
  const text = cleanString(value, field, 100);
  if (!/^[a-z0-9][a-z0-9-]{2,99}$/.test(text)) throw new Error(`institutional_${field}_invalid`);
  return text;
}

function cleanString(value, field, maxLength) {
  if (typeof value !== "string") throw new Error(`institutional_${field}_required`);
  const text = value.trim();
  if (!text || text.length > maxLength) throw new Error(`institutional_${field}_invalid`);
  return text;
}

function cleanOptionalString(value, field, maxLength) {
  if (value === undefined || value === null || value === "") return null;
  return cleanString(value, field, maxLength);
}

function cleanStringArray(value, field, maxItems, minItems = 0) {
  if (!Array.isArray(value) || value.length < minItems || value.length > maxItems) throw new Error(`institutional_${field}_invalid`);
  return value.map((entry, index) => cleanString(entry, `${field}_${index}`, 240));
}

function cleanEnum(value, allowed, field) {
  if (!allowed.includes(value)) throw new Error(`institutional_${field}_not_allowed`);
  return value;
}

function requireDatabase(env) {
  if (!env?.DB) throw new Error("institutional_research_database_required");
}

function iso(value, field) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`institutional_${field}_invalid`);
  return date.toISOString();
}

async function hashObject(value) {
  const payload = new TextEncoder().encode(stableStringify(value));
  const digest = await crypto.subtle.digest("SHA-256", payload);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
