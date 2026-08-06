import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  runProductionDirectionalInstitutionalResearch,
  getDirectionalInstitutionalResearchSummary,
} from "../src/directionalInstitutionalResearch.js";

function candles(count = 4320) {
  const start = Date.UTC(2026, 0, 1, 0, 0, 0);
  return Array.from({ length: count }, (_, index) => {
    const wave = Math.sin(index / 18) * 450;
    const drift = index * 1.5;
    const close = 50000 + drift + wave;
    return {
      market: "BTC-USD",
      interval: "1h",
      closed_at: new Date(start + index * 3600000).toISOString(),
      open: close - Math.sin(index / 7) * 40,
      high: close + 90,
      low: close - 90,
      close,
      volume: 100 + index % 25,
    };
  });
}

function fakeDb(history) {
  const stored = new Map();
  const statements = [];
  return {
    stored,
    statements,
    prepare(sql) {
      const statement = {
        sql,
        args: [],
        bind(...args) { this.args = args; return this; },
        async first() {
          if (sql.includes("ORDER BY closed_at DESC LIMIT 1")) return { closed_at: history.at(-1).closed_at };
          if (sql.includes("FROM directional_research_batches WHERE id")) {
            const row = stored.get(this.args[0]);
            return row ? { result_json: row } : null;
          }
          if (sql.includes("FROM directional_research_batches ORDER BY")) {
            const last = [...stored.values()].at(-1);
            return last ? { result_json: last } : null;
          }
          return null;
        },
        async all() {
          if (sql.includes("FROM market_candles")) return { results: history };
          if (sql.includes("FROM directional_shadow_portfolios")) return { results: [] };
          if (sql.includes("FROM directional_shadow_candidate_cycles")) return { results: [] };
          return { results: [] };
        },
        async run() { statements.push(this); return { success: true }; },
      };
      return statement;
    },
    async batch(batchStatements) {
      statements.push(...batchStatements);
      const batchStatement = batchStatements.find((row) => row.sql.includes("INSERT INTO directional_research_batches"));
      if (batchStatement) stored.set(batchStatement.args[0], batchStatement.args[10]);
      return batchStatements.map(() => ({ success: true }));
    },
  };
}

test("migration creates immutable institutional evidence tables", async () => {
  const sql = await readFile(new URL("../migrations/0015_directional_institutional_research.sql", import.meta.url), "utf8");
  for (const table of [
    "directional_research_policies",
    "directional_research_batches",
    "directional_research_windows",
    "directional_research_runs",
    "directional_research_verdicts",
    "directional_research_portfolio_selections",
  ]) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(sql, /directional_research_batch_immutable/);
  assert.match(sql, /candle_count INTEGER NOT NULL CHECK \(candle_count = 4320\)/);
  assert.match(sql, /candidate_count INTEGER NOT NULL CHECK \(candidate_count = 12\)/);
});

test("production orchestration persists exact 4320-candle, 12-candidate, five-window evidence and replays", async () => {
  const history = candles();
  const DB = fakeDb(history);
  const env = { DB };
  const first = await runProductionDirectionalInstitutionalResearch(env, {
    asOfClosedAt: history.at(-1).closed_at,
    now: "2026-08-05T14:00:00.000Z",
  });
  assert.equal(first.ok, true);
  assert.equal(first.paper_only, true);
  assert.equal(first.live_capital_enabled, false);
  assert.equal(first.candle_count, 4320);
  assert.equal(first.candidate_count, 12);
  assert.equal(first.window_count, 5);
  assert.equal(first.run_count, 60);
  assert.equal(first.qualified_count, 0);
  assert.equal(first.selection.state, "no_qualified_candidates");
  assert.equal(first.selection.cash_is_valid_allocation, true);
  assert.equal(first.replayed, false);
  assert.match(first.batch_hash, /^[a-f0-9]{64}$/);

  const windowIds = new Set(DB.statements
    .filter((row) => row.sql.includes("INSERT INTO directional_research_windows"))
    .map((row) => row.args[0]));
  const persistedRuns = DB.statements.filter((row) => row.sql.includes("INSERT INTO directional_research_runs"));
  assert.equal(windowIds.size, 5);
  assert.equal(persistedRuns.length, 60);
  assert.equal(persistedRuns.every((row) => windowIds.has(row.args[2])), true);

  const second = await runProductionDirectionalInstitutionalResearch(env, {
    asOfClosedAt: history.at(-1).closed_at,
  });
  assert.equal(second.replayed, true);
  assert.equal(second.batch_hash, first.batch_hash);

  const summary = await getDirectionalInstitutionalResearchSummary(env);
  assert.equal(summary.batch_id, first.batch_id);
  assert.equal(summary.run_count, 60);
});

test("orchestration fails closed before persistence when exact history is unavailable", async () => {
  const history = candles(4319);
  const DB = fakeDb(history);
  await assert.rejects(
    runProductionDirectionalInstitutionalResearch({ DB }, { asOfClosedAt: history.at(-1).closed_at }),
    /directional_research_requires_4320_candles/,
  );
  assert.equal(DB.statements.length, 0);
});
