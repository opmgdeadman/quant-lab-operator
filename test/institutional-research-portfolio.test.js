import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  INSTITUTIONAL_RESEARCH_POLICY,
  registerInstitutionalHypothesis,
  advanceInstitutionalHypothesis,
  getInstitutionalResearchPortfolioSummary,
  validateHypothesisInput,
  assertLifecycleTransition,
  buildResearchThroughput,
} from "../src/institutionalResearchPortfolio.js";

function baseHypothesis(overrides = {}) {
  return {
    id: "trend-persistence-001",
    title: "Trend persistence after volatility expansion",
    family: "trend",
    origin: "operator",
    market: "BTC-USD",
    interval: "1h",
    economic_mechanism: "Persistent order-flow imbalance after volatility expansion may create multi-hour directional continuation.",
    market_premise: "BTC-USD hourly completed candles remain liquid enough for conservative paper execution assumptions.",
    expected_failure_modes: ["range-bound chop", "cost sensitivity", "regime reversal"],
    research_function: "alpha_research",
    preregistration: {
      spec_version: 2,
      dataset_id: "btc-usd-1h-completed-4320-v1",
      strategy: { template: "ema_trend", feature_set_id: "close-ema-v1", parameters: { fast: 12, slow: 36 } },
      walk_forward_policy_id: "institutional-walk-forward-v1",
      cost_model_id: "institutional-cost-model-v1",
      judge_policy_id: "institutional-independent-judge-v1",
      evidence_integrity_policy_id: "institutional-evidence-integrity-v1",
    },
    ...overrides,
  };
}

function fakeDb() {
  const hypotheses = new Map();
  const events = new Map();
  const rejections = new Map();
  const admissions = [];
  return {
    hypotheses,
    events,
    rejections,
    admissions,
    prepare(sql) {
      const statement = {
        sql,
        args: [],
        bind(...args) { this.args = args; return this; },
        async first() {
          if (sql.includes("FROM institutional_hypotheses WHERE id = ?")) return hypotheses.get(this.args[0]) || null;
          if (sql.includes("FROM institutional_hypothesis_events WHERE hypothesis_id = ?")) {
            const rows = events.get(this.args[0]) || [];
            return rows.at(-1) || null;
          }
          if (sql.includes("COUNT(*) AS count FROM institutional_hypotheses")) return { count: hypotheses.size };
          if (sql.includes("COUNT(*) AS count FROM institutional_factory_admissions")) {
            return { count: admissions.filter((row) => row.created_at >= this.args[0]).length };
          }
          return null;
        },
        async all() {
          if (sql.includes("FROM institutional_hypotheses ORDER BY")) return { results: [...hypotheses.values()] };
          if (sql.includes("FROM institutional_hypothesis_events ORDER BY")) {
            return { results: [...events.values()].flat().sort((a, b) => a.hypothesis_id.localeCompare(b.hypothesis_id) || a.sequence - b.sequence) };
          }
          if (sql.includes("FROM institutional_rejection_memory ORDER BY")) return { results: [...rejections.values()] };
          if (sql.includes("FROM institutional_factory_admissions ORDER BY")) return { results: [...admissions] };
          return { results: [] };
        },
      };
      return statement;
    },
    async batch(statements) {
      for (const row of statements) {
        if (row.sql.includes("INSERT INTO institutional_hypotheses")) {
          const a = row.args;
          hypotheses.set(a[0], {
            id: a[0], title: a[1], family: a[2], origin: a[3], market: a[4], interval: a[5],
            economic_mechanism: a[6], market_premise: a[7], expected_failure_modes_json: a[8],
            research_function: a[9], lineage_parent_id: a[10], materially_new_evidence: a[11],
            preregistration_json: a[12], preregistration_hash: a[13], hypothesis_hash: a[14], created_at: a[15],
          });
        } else if (row.sql.includes("INSERT INTO institutional_hypothesis_events")) {
          const a = row.args;
          const event = {
            id: a[0], hypothesis_id: a[1], sequence: a[2], from_state: a[3], to_state: a[4],
            reason_codes_json: a[5], evidence_summary: a[6], independent_verdict_id: a[7], event_hash: a[8], created_at: a[9],
          };
          const list = events.get(a[1]) || [];
          if (list.some((entry) => entry.sequence === event.sequence)) throw new Error("duplicate_event_sequence");
          list.push(event);
          events.set(a[1], list);
        } else if (row.sql.includes("INSERT INTO institutional_rejection_memory")) {
          const a = row.args;
          if (rejections.has(a[1])) throw new Error("duplicate_rejection_memory");
          rejections.set(a[1], {
            id: a[0], hypothesis_id: a[1], family: a[2], reason_codes_json: a[3], evidence_summary: a[4], rejection_hash: a[5], created_at: a[6],
          });
        } else if (row.sql.includes("INSERT INTO institutional_factory_admissions")) {
          const a = row.args;
          admissions.push({
            id: a[0], hypothesis_id: a[1], family: a[2], novelty_basis: a[3], expected_information_gain: a[4], admission_hash: a[5], created_at: a[6],
          });
        }
      }
      return statements.map(() => ({ success: true }));
    },
  };
}

test("0018 creates append-only hypothesis, lifecycle, rejection, and factory evidence", async () => {
  const sql = await readFile(new URL("../migrations/0018_institutional_research_portfolio.sql", import.meta.url), "utf8");
  for (const table of [
    "institutional_hypotheses",
    "institutional_hypothesis_events",
    "institutional_rejection_memory",
    "institutional_factory_admissions",
  ]) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  for (const marker of [
    "institutional_hypothesis_immutable",
    "institutional_hypothesis_event_immutable",
    "institutional_rejection_memory_immutable",
    "institutional_factory_admission_immutable",
  ]) assert.match(sql, new RegExp(marker));
  assert.match(sql, /market TEXT NOT NULL CHECK \(market = 'BTC-USD'\)/);
  assert.match(sql, /interval TEXT NOT NULL CHECK \(interval = '1h'\)/);
});

test("preregistration is typed and rejects post-hoc unknown fields", () => {
  assert.equal(validateHypothesisInput(baseHypothesis()).market, "BTC-USD");
  assert.throws(() => validateHypothesisInput(baseHypothesis({
    preregistration: { ...baseHypothesis().preregistration, rescue_threshold_after_results: "not allowed" },
  })), /institutional_research_spec_shape_invalid/);
  const missing = baseHypothesis();
  delete missing.preregistration.judge_policy_id;
  assert.throws(() => validateHypothesisInput(missing), /institutional_research_spec_shape_invalid/);
});

test("qualification transition exists only behind the independent verdict gate", () => {
  assert.equal(INSTITUTIONAL_RESEARCH_POLICY.qualification_transition_enabled, true);
  assert.equal(assertLifecycleTransition("testing", "qualified"), true);
  assert.equal(assertLifecycleTransition("proposed", "admitted"), true);
  assert.throws(() => assertLifecycleTransition("rejected", "admitted"), /institutional_hypothesis_transition_not_allowed/);
});

test("registration is immutable by id and lifecycle rejection is terminal durable memory", async () => {
  const DB = fakeDb();
  const env = { DB };
  const first = await registerInstitutionalHypothesis(env, baseHypothesis(), { now: "2026-08-19T18:00:00.000Z" });
  assert.equal(first.ok, true);
  assert.equal(first.hypothesis.state, "proposed");
  assert.match(first.hypothesis.hypothesis_hash, /^[a-f0-9]{64}$/);

  const replay = await registerInstitutionalHypothesis(env, baseHypothesis(), { now: "2026-08-19T18:00:00.000Z" });
  assert.equal(replay.replayed, true);
  await assert.rejects(
    registerInstitutionalHypothesis(env, baseHypothesis({ title: "Mutated after registration" }), { now: "2026-08-19T18:00:00.000Z" }),
    /institutional_hypothesis_id_conflict/,
  );

  await advanceInstitutionalHypothesis(env, { hypothesis_id: first.hypothesis.id, target_state: "admitted", reason_codes: ["admission_gate_passed"] }, { now: "2026-08-19T19:00:00.000Z" });
  await advanceInstitutionalHypothesis(env, { hypothesis_id: first.hypothesis.id, target_state: "testing", reason_codes: ["research_started"] }, { now: "2026-08-19T20:00:00.000Z" });
  const rejected = await advanceInstitutionalHypothesis(env, {
    hypothesis_id: first.hypothesis.id,
    target_state: "rejected",
    reason_codes: ["cost_stress_failed"],
    evidence_summary: "The preregistered candidate failed doubled and tripled cost stress and is durably rejected.",
  }, { now: "2026-08-19T21:00:00.000Z" });
  assert.equal(rejected.hypothesis.state, "rejected");
  assert.equal(DB.rejections.has(first.hypothesis.id), true);
  await assert.rejects(
    advanceInstitutionalHypothesis(env, { hypothesis_id: first.hypothesis.id, target_state: "admitted", reason_codes: ["retry"] }),
    /institutional_hypothesis_transition_not_allowed/,
  );
});

test("qualified lifecycle transition fails without a sealed independent verdict", async () => {
  const DB = fakeDb();
  const env = { DB };
  const registered = await registerInstitutionalHypothesis(env, baseHypothesis(), { now: "2026-08-19T18:00:00.000Z" });
  await advanceInstitutionalHypothesis(env, { hypothesis_id: registered.hypothesis.id, target_state: "admitted", reason_codes: ["admission_gate_passed"] }, { now: "2026-08-19T19:00:00.000Z" });
  await advanceInstitutionalHypothesis(env, { hypothesis_id: registered.hypothesis.id, target_state: "testing", reason_codes: ["research_started"] }, { now: "2026-08-19T20:00:00.000Z" });
  await assert.rejects(
    advanceInstitutionalHypothesis(env, { hypothesis_id: registered.hypothesis.id, target_state: "qualified", reason_codes: ["attempted_bypass"] }, { now: "2026-08-19T21:00:00.000Z" }),
    /institutional_qualification_requires_sealed_independent_verdict/,
  );
});

test("rejected ideas require a new lineage child with materially new evidence", async () => {
  const DB = fakeDb();
  const env = { DB };
  const parent = await registerInstitutionalHypothesis(env, baseHypothesis(), { now: "2026-08-19T18:00:00.000Z" });
  await advanceInstitutionalHypothesis(env, { hypothesis_id: parent.hypothesis.id, target_state: "rejected", reason_codes: ["mechanism_failed"], evidence_summary: "Independent evidence falsified the registered mechanism." }, { now: "2026-08-19T19:00:00.000Z" });

  const childBase = baseHypothesis({ id: "trend-persistence-002", lineage_parent_id: parent.hypothesis.id });
  await assert.rejects(
    registerInstitutionalHypothesis(env, childBase, { now: "2026-08-20T18:00:00.000Z" }),
    /rejected_hypothesis_requires_materially_new_evidence/,
  );
  const child = await registerInstitutionalHypothesis(env, {
    ...childBase,
    materially_new_evidence: "A newly observed independent regime-segmentation result changes the economic premise rather than retuning the rejected thresholds.",
  }, { now: "2026-08-20T18:00:00.000Z" });
  assert.equal(child.hypothesis.lineage_parent_id, parent.hypothesis.id);
});

test("bounded factory admission requires declared family, novelty, and information gain", async () => {
  const DB = fakeDb();
  const env = { DB };
  const registered = await registerInstitutionalHypothesis(env, baseHypothesis({
    id: "factory-volatility-001",
    family: "volatility",
    origin: "bounded_factory",
    factory_admission: {
      novelty_basis: "Tests a preregistered volatility persistence mechanism not represented by the existing Stage 13 parameterizations.",
      expected_information_gain: 0.72,
    },
  }), { now: "2026-08-19T18:00:00.000Z" });
  assert.equal(registered.ok, true);
  assert.equal(DB.admissions.length, 1);
  assert.equal(DB.admissions[0].expected_information_gain, 0.72);
  await assert.rejects(
    registerInstitutionalHypothesis(env, baseHypothesis({
      id: "factory-volatility-002",
      family: "volatility",
      origin: "bounded_factory",
      factory_admission: { novelty_basis: "Out of bounds score", expected_information_gain: 1.2 },
    })),
    /institutional_factory_information_gain_out_of_bounds/,
  );
});

test("portfolio summary derives throughput without granting Stage 13 promotion authority", async () => {
  const DB = fakeDb();
  const env = { DB };
  await registerInstitutionalHypothesis(env, baseHypothesis(), { now: "2026-08-19T18:00:00.000Z" });
  const summary = await getInstitutionalResearchPortfolioSummary(env, { now: "2026-08-19T20:00:00.000Z" });
  assert.equal(summary.ok, true);
  assert.equal(summary.stage13_promotion_authority_unchanged, true);
  assert.equal(summary.qualification_transition_enabled, true);
  assert.equal(summary.hypothesis_count, 1);
  assert.equal(summary.throughput.open_count, 1);
  assert.equal(summary.throughput.oldest_open_age_hours, 2);
  const pure = buildResearchThroughput([
    { state: "rejected", created_at: "2026-08-19T10:00:00.000Z" },
    { state: "testing", created_at: "2026-08-19T19:00:00.000Z" },
  ], "2026-08-19T20:00:00.000Z");
  assert.equal(pure.useful_evidence_count, 1);
  assert.equal(pure.rejection_rate_percent, 100);
});
