import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const wrangler = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const index = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const telemetry = readFileSync(new URL("../src/operator/fleetTelemetry.js", import.meta.url), "utf8");
const deployWorker = readFileSync(new URL("../scripts/deploy-worker.mjs", import.meta.url), "utf8");
const deployWorkflow = readFileSync(new URL("../.github/workflows/quant-lab-deploy.yml", import.meta.url), "utf8");

test("Quant Lab remains dormant read-only", () => {
  assert.doesNotMatch(wrangler, /"crons"\s*:/);
  assert.match(wrangler, /"CURRENT_PHASE"\s*:\s*"dormant-read-only"/);
  assert.match(index, /scheduled\(_controller, _env, _ctx\) \{\s*return;\s*\}/s);
  assert.match(index, /name === "execute_quant_lab_mutation_action"[\s\S]*quant_lab_read_only_dormant_mode/);
  assert.doesNotMatch(index, /ctx\.waitUntil\(runScheduledQuantLabOperation/);
  assert.doesNotMatch(telemetry, /scheduleTelemetry\(runtimeEnv\.TELEMETRY_DB/);
  assert.match(telemetry, /capture_mode: "response_only"/);

  assert.match(deployWorker, /const phase = "dormant-read-only";/);
  assert.doesNotMatch(deployWorker, /process\.env\.CURRENT_PHASE/);
  assert.doesNotMatch(deployWorker, /"d1"[\s\S]*"migrations"[\s\S]*"apply"/);
  assert.doesNotMatch(deployWorkflow, /CURRENT_PHASE:\s*autonomous-steady-state/);
  assert.match(deployWorkflow, /CURRENT_PHASE:\s*dormant-read-only/);
});
