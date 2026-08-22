export const FLEET_FAILURE_INTELLIGENCE_ENFORCEMENT_IMPLEMENTATION = Object.freeze({
  standard: "fleet-failure-intelligence-enforcement-standard-v1",
  version: "1.0.0",
  implementation: "fleet-failure-intelligence-enforcement-implementation-v1",
  production_novel_loss_execution: false,
  required_family_count: 6,
  reference_scenario_count: 8,
});

export const FAILURE_INTELLIGENCE_FAMILIES = Object.freeze([
  "known_losing_route_recurrence",
  "argument_schema_identity_provenance",
  "wrong_recipient_owner_execution_plane",
  "wrong_lifecycle_or_state_transition",
  "missing_prerequisite_or_evidence_gate",
  "controlled_replay_external_transient",
]);

export const FAILURE_INTELLIGENCE_SCHEMA_SQL = Object.freeze([
  `CREATE TABLE IF NOT EXISTS failure_intelligence_preventions (
    prevention_id TEXT PRIMARY KEY,
    standard_version TEXT NOT NULL,
    family TEXT NOT NULL,
    failure_signature TEXT NOT NULL,
    scope_json TEXT NOT NULL,
    losing_action TEXT NOT NULL,
    winning_action TEXT,
    match_context_json TEXT NOT NULL,
    winning_requirements_json TEXT NOT NULL,
    source_evidence_json TEXT NOT NULL,
    learned_at TEXT NOT NULL,
    status TEXT NOT NULL,
    supersedes_prevention_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS failure_intelligence_attempts (
    attempt_id TEXT PRIMARY KEY,
    prevention_id TEXT,
    family TEXT NOT NULL,
    proposed_action TEXT NOT NULL,
    context_json TEXT NOT NULL,
    decision TEXT NOT NULL,
    executed INTEGER NOT NULL,
    outcome TEXT NOT NULL,
    certification_run_id TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_failure_intelligence_attempts_prevention
    ON failure_intelligence_attempts(prevention_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_failure_intelligence_attempts_certification
    ON failure_intelligence_attempts(certification_run_id, created_at)`,
]);

const ACTIVE_STATUS = "ACTIVE";
const ALLOWED_STATUSES = new Set(["ACTIVE", "SUPERSEDED", "RETIRED", "INVALIDATED"]);

function assertObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
}

function assertString(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a non-empty string`);
  return value.trim();
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

export function failureIntelligenceStableStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function sameJson(a, b) {
  return failureIntelligenceStableStringify(a) === failureIntelligenceStableStringify(b);
}

function jsonObject(value, name) {
  const normalized = value ?? {};
  assertObject(normalized, name);
  return normalized;
}

function requiredFamily(value) {
  const family = assertString(value, "family");
  if (!FAILURE_INTELLIGENCE_FAMILIES.includes(family)) throw new Error(`Unsupported failure intelligence family: ${family}`);
  return family;
}

function contextContains(actual, required) {
  if (required === null || required === undefined) return true;
  if (Array.isArray(required)) return Array.isArray(actual) && sameJson(actual, required);
  if (typeof required !== "object") return sameJson(actual, required);
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
  return Object.entries(required).every(([key, value]) => Object.prototype.hasOwnProperty.call(actual, key) && contextContains(actual[key], value));
}

function missingRequiredContext(actual, required, prefix = "") {
  const missing = [];
  if (!required || typeof required !== "object" || Array.isArray(required)) return missing;
  for (const [key, value] of Object.entries(required)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (!actual || typeof actual !== "object" || !Object.prototype.hasOwnProperty.call(actual, key)) {
      missing.push(path);
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) missing.push(...missingRequiredContext(actual[key], value, path));
  }
  return missing;
}

function rowToPrevention(row) {
  if (!row) return null;
  return {
    prevention_id: row.prevention_id,
    standard_version: row.standard_version,
    family: row.family,
    failure_signature: row.failure_signature,
    scope: JSON.parse(row.scope_json),
    losing_action: row.losing_action,
    winning_action: row.winning_action,
    match_context: JSON.parse(row.match_context_json),
    winning_requirements: JSON.parse(row.winning_requirements_json),
    source_evidence: JSON.parse(row.source_evidence_json),
    learned_at: row.learned_at,
    status: row.status,
    supersedes_prevention_id: row.supersedes_prevention_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function rowToAttempt(row) {
  return {
    attempt_id: row.attempt_id,
    prevention_id: row.prevention_id,
    family: row.family,
    proposed_action: row.proposed_action,
    context: JSON.parse(row.context_json),
    decision: row.decision,
    executed: Boolean(row.executed),
    outcome: row.outcome,
    certification_run_id: row.certification_run_id,
    created_at: row.created_at,
  };
}

async function appendAttempt(storage, input) {
  const attempt = {
    attempt_id: input.attempt_id ?? crypto.randomUUID(),
    prevention_id: input.prevention_id ?? null,
    family: input.family ?? "UNSCOPED",
    proposed_action: assertString(input.proposed_action, "proposed_action"),
    context_json: failureIntelligenceStableStringify(input.context ?? {}),
    decision: assertString(input.decision, "decision"),
    executed: input.executed ? 1 : 0,
    outcome: assertString(input.outcome, "outcome"),
    certification_run_id: input.certification_run_id ?? null,
    created_at: input.created_at ?? new Date().toISOString(),
  };
  await storage.appendAttempt(attempt);
  return rowToAttempt(attempt);
}

export async function registerFailurePrevention(storage, input) {
  await storage.ensureSchema();
  assertObject(input, "registerFailurePrevention input");
  const now = new Date().toISOString();
  const family = requiredFamily(input.family);
  const status = String(input.status ?? ACTIVE_STATUS).toUpperCase();
  if (!ALLOWED_STATUSES.has(status)) throw new Error(`Unsupported prevention status: ${status}`);
  const prevention = {
    prevention_id: input.prevention_id ? assertString(input.prevention_id, "prevention_id") : `prevention:${crypto.randomUUID()}`,
    standard_version: FLEET_FAILURE_INTELLIGENCE_ENFORCEMENT_IMPLEMENTATION.version,
    family,
    failure_signature: assertString(input.failure_signature, "failure_signature"),
    scope_json: failureIntelligenceStableStringify(jsonObject(input.scope, "scope")),
    losing_action: assertString(input.losing_action, "losing_action"),
    winning_action: input.winning_action == null ? null : assertString(input.winning_action, "winning_action"),
    match_context_json: failureIntelligenceStableStringify(jsonObject(input.match_context, "match_context")),
    winning_requirements_json: failureIntelligenceStableStringify(jsonObject(input.winning_requirements, "winning_requirements")),
    source_evidence_json: failureIntelligenceStableStringify(jsonObject(input.source_evidence, "source_evidence")),
    learned_at: input.learned_at ? assertString(input.learned_at, "learned_at") : now,
    status,
    supersedes_prevention_id: input.supersedes_prevention_id ?? null,
    created_at: now,
    updated_at: now,
  };
  const existing = await storage.getPrevention(prevention.prevention_id);
  if (existing) {
    const normalizedExisting = rowToPrevention(existing);
    const normalizedProposed = rowToPrevention(prevention);
    const immutableExisting = { ...normalizedExisting, created_at: null, updated_at: null };
    const immutableProposed = { ...normalizedProposed, created_at: null, updated_at: null };
    if (!sameJson(immutableExisting, immutableProposed)) throw new Error(`Prevention already exists with different immutable content: ${prevention.prevention_id}`);
    return { prevention: normalizedExisting, changed: false };
  }
  await storage.createPrevention(prevention);
  return { prevention: rowToPrevention(prevention), changed: true };
}

function evaluateAgainstPreventions(preventions, proposedAction, context) {
  let nonEquivalentCandidate = null;
  for (const prevention of preventions) {
    if (prevention.status !== ACTIVE_STATUS) continue;
    if (prevention.losing_action === proposedAction) {
      if (contextContains(context, prevention.match_context)) {
        return { allowed: false, decision: "DENY_KNOWN_RECURRENCE", outcome: "BLOCKED_BY_STORED_PREVENTION", prevention, executed: false };
      }
      nonEquivalentCandidate ??= prevention;
    }
    if (prevention.winning_action && prevention.winning_action === proposedAction) {
      const missing = missingRequiredContext(context, prevention.winning_requirements);
      if (missing.length) return { allowed: false, decision: "DENY_MISSING_EVIDENCE", outcome: "WINNING_ROUTE_MISSING_REQUIRED_CONTEXT", missing_context: missing, prevention, executed: false };
      if (!contextContains(context, prevention.winning_requirements)) return { allowed: false, decision: "DENY_INVALID_CONTEXT", outcome: "WINNING_ROUTE_CONTEXT_MISMATCH", prevention, executed: false };
      return { allowed: true, decision: "ALLOW", outcome: "WINNING_ROUTE_CONTEXT_VALID", prevention, executed: false };
    }
  }
  if (nonEquivalentCandidate) return { allowed: true, decision: "ALLOW", outcome: "NON_EQUIVALENT_CONTEXT", prevention: nonEquivalentCandidate, executed: false };
  return { allowed: true, decision: "ALLOW", outcome: "NO_APPLICABLE_PREVENTION", prevention: null, executed: false };
}

export async function checkFailureIntelligence(storage, input, options = {}) {
  await storage.ensureSchema();
  assertObject(input, "checkFailureIntelligence input");
  const proposedAction = assertString(input.proposed_action, "proposed_action");
  const context = jsonObject(input.context, "context");
  const active = (await storage.listActivePreventions()).map(rowToPrevention);
  const evaluation = evaluateAgainstPreventions(active, proposedAction, context);
  if (options.record !== false) {
    evaluation.attempt = await appendAttempt(storage, {
      prevention_id: evaluation.prevention?.prevention_id ?? null,
      family: evaluation.prevention?.family ?? "UNSCOPED",
      proposed_action: proposedAction,
      context,
      decision: evaluation.decision,
      executed: false,
      outcome: evaluation.outcome,
      certification_run_id: options.certification_run_id ?? null,
    });
  }
  return { allowed: evaluation.allowed, decision: evaluation.decision, outcome: evaluation.outcome, executed: false, prevention_id: evaluation.prevention?.prevention_id ?? null, family: evaluation.prevention?.family ?? null, missing_context: evaluation.missing_context ?? [], attempt_id: evaluation.attempt?.attempt_id ?? null };
}

export async function recordFailureExecution(storage, input, options = {}) {
  await storage.ensureSchema();
  assertObject(input, "recordFailureExecution input");
  const proposedAction = assertString(input.proposed_action, "proposed_action");
  const context = jsonObject(input.context, "context");
  const active = (await storage.listActivePreventions()).map(rowToPrevention);
  const evaluation = evaluateAgainstPreventions(active, proposedAction, context);
  if (!evaluation.allowed) throw new Error(`Execution is ineligible under active prevention: ${evaluation.decision}`);
  const attempt = await appendAttempt(storage, {
    prevention_id: input.prevention_id ?? evaluation.prevention?.prevention_id ?? null,
    family: evaluation.prevention?.family ?? input.family ?? "UNSCOPED",
    proposed_action: proposedAction,
    context,
    decision: "ALLOW",
    executed: true,
    outcome: assertString(input.outcome ?? "SUCCESS", "outcome"),
    certification_run_id: options.certification_run_id ?? null,
  });
  return attempt;
}

export async function readFailurePrevention(storage, input) {
  await storage.ensureSchema();
  assertObject(input, "readFailurePrevention input");
  const preventionId = assertString(input.prevention_id, "prevention_id");
  const row = await storage.getPrevention(preventionId);
  if (!row) throw new Error(`Failure prevention not found: ${preventionId}`);
  const attempts = (await storage.listAttempts(preventionId)).map(rowToAttempt);
  return { prevention: rowToPrevention(row), attempts };
}

const REFERENCE_SCENARIOS = Object.freeze([
  { id: "known_losing_route", family: "known_losing_route_recurrence", signature: "SIMULATED_KNOWN_LOSING_ROUTE", losing: "unsafe_search", winning: "bounded_search", match: { route_class: "unsafe_unbounded" }, requirements: { route_class: "bounded_verified" }, anti_overblock_context: { route_class: "different_safe_context" } },
  { id: "schema_optional_null", family: "argument_schema_identity_provenance", signature: "SIMULATED_OPTIONAL_NULL_SCHEMA_MISS", losing: "serialize_optional_null", winning: "omit_unset_optional", match: { optional_state: "null" }, requirements: { optional_state: "omitted" } },
  { id: "path_provenance", family: "argument_schema_identity_provenance", signature: "SIMULATED_UNVERIFIED_PATH_PROVENANCE", losing: "use_inferred_path", winning: "use_current_verified_path", match: { provenance: "inferred" }, requirements: { provenance: "current_verified" } },
  { id: "owner_recipient_plane", family: "wrong_recipient_owner_execution_plane", signature: "SIMULATED_WRONG_OWNER_OR_EXECUTION_PLANE", losing: "dispatch_wrong_plane", winning: "dispatch_owner_plane", match: { task_owner: "M-BRAIN Gateway", recipient_owner: "Other Plane" }, requirements: { task_owner: "M-BRAIN Gateway", recipient_owner: "M-BRAIN Gateway" } },
  { id: "lifecycle_next_state", family: "wrong_lifecycle_or_state_transition", signature: "SIMULATED_WRONG_NEXT_STATE", losing: "repeat_or_skip_stage", winning: "dispatch_expected_next_stage", match: { expected_state: "verify", proposed_state: "deploy" }, requirements: { expected_state: "verify", proposed_state: "verify" } },
  { id: "authority_set_complete", family: "missing_prerequisite_or_evidence_gate", signature: "SIMULATED_INCOMPLETE_AUTHORITY_SET", losing: "synthesize_with_missing_authority", winning: "synthesize_after_complete_authority_set", match: { authority_state: "incomplete" }, requirements: { authority_state: "complete" } },
  { id: "recipient_restoration", family: "wrong_recipient_owner_execution_plane", signature: "SIMULATED_SIBLING_SUBSTITUTION_AFTER_SURFACE_LOSS", losing: "substitute_sibling_recipient", winning: "restore_exact_recipient", match: { exact_recipient_available: true, proposed_recipient: "sibling" }, requirements: { exact_recipient_available: true, proposed_recipient: "exact" } },
  { id: "controlled_replay", family: "controlled_replay_external_transient", signature: "SIMULATED_BLIND_RETRY_WITHOUT_NONEXECUTION_PROOF", losing: "blind_retry", winning: "evidence_gated_replay", match: { nonexecution_proven: false, idempotent_safe: false }, requirements: { nonexecution_proven: true, idempotent_safe: true } },
]);

export async function runFailureIntelligenceCertification(storage, input = {}) {
  await storage.ensureSchema();
  const runId = input.run_id ? assertString(input.run_id, "run_id") : `fi-cert-${crypto.randomUUID()}`;
  const scenarioResults = [];
  let coreDecisionPasses = 0;
  const familySet = new Set();
  for (const scenario of REFERENCE_SCENARIOS) {
    familySet.add(scenario.family);
    const preventionId = `cert:${runId}:${scenario.id}`;
    const registration = await registerFailurePrevention(storage, {
      prevention_id: preventionId, family: scenario.family, failure_signature: scenario.signature,
      scope: { certification_run_id: runId, scenario: scenario.id }, losing_action: scenario.losing,
      winning_action: scenario.winning, match_context: scenario.match, winning_requirements: scenario.requirements,
      source_evidence: { kind: "bounded_synthetic_certification", run_id: runId, scenario: scenario.id },
      learned_at: new Date().toISOString(), status: "ACTIVE",
    });
    const novel = await appendAttempt(storage, { prevention_id: preventionId, family: scenario.family, proposed_action: scenario.losing, context: scenario.match, decision: "ALLOW_NOVEL_TEST_ONLY", executed: true, outcome: "NOVEL_FAILURE_LEARNED", certification_run_id: runId });
    const recurrence = await checkFailureIntelligence(storage, { proposed_action: scenario.losing, context: scenario.match }, { record: true, certification_run_id: runId });
    const winningCheck = await checkFailureIntelligence(storage, { proposed_action: scenario.winning, context: scenario.requirements }, { record: false, certification_run_id: runId });
    let winningExecution = null;
    if (winningCheck.allowed) winningExecution = await recordFailureExecution(storage, { prevention_id: preventionId, proposed_action: scenario.winning, context: scenario.requirements, outcome: "SUCCESS" }, { certification_run_id: runId });
    const corePass = novel.decision === "ALLOW_NOVEL_TEST_ONLY" && novel.executed === true && recurrence.decision === "DENY_KNOWN_RECURRENCE" && recurrence.executed === false && winningCheck.decision === "ALLOW" && winningExecution?.executed === true && winningExecution?.outcome === "SUCCESS";
    if (corePass) coreDecisionPasses += 3;
    const readback = await readFailurePrevention(storage, { prevention_id: preventionId });
    const coreAttempts = readback.attempts.filter((attempt) => attempt.certification_run_id === runId && [scenario.losing, scenario.winning].includes(attempt.proposed_action));
    scenarioResults.push({ scenario: scenario.id, family: scenario.family, prevention_id: preventionId, registration_changed: registration.changed, core_pass: corePass, recurrence, winning_check: winningCheck, winning_execution: winningExecution, persisted_core_attempt_count: coreAttempts.length });
  }
  const authorityScenario = REFERENCE_SCENARIOS.find((scenario) => scenario.id === "authority_set_complete");
  const invalidContext = await checkFailureIntelligence(storage, { proposed_action: authorityScenario.winning, context: {} }, { record: true, certification_run_id: runId });
  const routeScenario = REFERENCE_SCENARIOS.find((scenario) => scenario.id === "known_losing_route");
  const antiOverblock = await checkFailureIntelligence(storage, { proposed_action: routeScenario.losing, context: routeScenario.anti_overblock_context }, { record: true, certification_run_id: runId });
  const controlledReplay = scenarioResults.find((result) => result.scenario === "controlled_replay");
  const allScenariosPass = scenarioResults.every((result) => result.core_pass && result.persisted_core_attempt_count >= 3);
  const pass = allScenariosPass && familySet.size === FLEET_FAILURE_INTELLIGENCE_ENFORCEMENT_IMPLEMENTATION.required_family_count && coreDecisionPasses === 24 && invalidContext.decision === "DENY_MISSING_EVIDENCE" && invalidContext.executed === false && antiOverblock.decision === "ALLOW" && antiOverblock.outcome === "NON_EQUIVALENT_CONTEXT" && controlledReplay?.recurrence?.decision === "DENY_KNOWN_RECURRENCE" && controlledReplay?.winning_execution?.outcome === "SUCCESS";
  return {
    ok: pass, standard: FLEET_FAILURE_INTELLIGENCE_ENFORCEMENT_IMPLEMENTATION, run_id: runId,
    scenario_count: scenarioResults.length, family_count: familySet.size, expected_core_decisions: 24,
    passed_core_decisions: coreDecisionPasses,
    known_recurrence_executions: scenarioResults.filter((result) => result.recurrence.executed).length,
    corrected_successes: scenarioResults.filter((result) => result.winning_execution?.outcome === "SUCCESS").length,
    invalid_context_gate: invalidContext, anti_overblocking_gate: antiOverblock,
    controlled_replay_gate: { blind_retry: controlledReplay?.recurrence ?? null, evidence_gated_replay: controlledReplay?.winning_execution ?? null },
    scenarios: scenarioResults, result: pass ? "CERTIFICATION_PASS" : "CERTIFICATION_FAIL",
  };
}

export function createD1FailureIntelligenceStorage(db) {
  return {
    async ensureSchema() { for (const sql of FAILURE_INTELLIGENCE_SCHEMA_SQL) await db.prepare(sql).run(); },
    async createPrevention(row) {
      await db.prepare(`INSERT INTO failure_intelligence_preventions
        (prevention_id, standard_version, family, failure_signature, scope_json, losing_action, winning_action,
         match_context_json, winning_requirements_json, source_evidence_json, learned_at, status,
         supersedes_prevention_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(row.prevention_id, row.standard_version, row.family, row.failure_signature, row.scope_json, row.losing_action, row.winning_action, row.match_context_json, row.winning_requirements_json, row.source_evidence_json, row.learned_at, row.status, row.supersedes_prevention_id, row.created_at, row.updated_at).run();
    },
    async getPrevention(preventionId) { return await db.prepare("SELECT * FROM failure_intelligence_preventions WHERE prevention_id = ?").bind(preventionId).first(); },
    async listActivePreventions() { const rows = await db.prepare("SELECT * FROM failure_intelligence_preventions WHERE status = 'ACTIVE' ORDER BY learned_at, prevention_id").all(); return rows.results; },
    async appendAttempt(row) {
      await db.prepare(`INSERT INTO failure_intelligence_attempts
        (attempt_id, prevention_id, family, proposed_action, context_json, decision, executed, outcome,
         certification_run_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(row.attempt_id, row.prevention_id, row.family, row.proposed_action, row.context_json, row.decision, row.executed, row.outcome, row.certification_run_id, row.created_at).run();
    },
    async listAttempts(preventionId) { const rows = await db.prepare("SELECT * FROM failure_intelligence_attempts WHERE prevention_id = ? ORDER BY created_at, attempt_id").bind(preventionId).all(); return rows.results; },
  };
}
