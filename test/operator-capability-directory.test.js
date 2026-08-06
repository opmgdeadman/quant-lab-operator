import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  capabilityDirectory,
  lifecycleDeclarations,
  lifecycleMandatorySequence,
  supportedIntents,
} from "../src/operator/capabilityDirectory.js";
import { handlers } from "../src/operator/handlers/controlPlane.js";
import { buildActionClosure, parseContinuationMetadata } from "../src/operator/executionKernel.js";
import { operationLeaseMs } from "../src/operator/receipts.js";

test("every supported intent exists in capability directory with lifecycle declaration and handler", () => {
  const declarationIds = new Set(lifecycleDeclarations.map((item) => item.id));
  const directoryIntents = capabilityDirectory.map((entry) => entry.intent);

  assert.deepEqual(directoryIntents, supportedIntents);
  for (const entry of capabilityDirectory) {
    assert.ok(entry.id);
    assert.ok(entry.handler_id);
    assert.equal(typeof handlers[entry.handler_id], "function");
    assert.ok(declarationIds.has(entry.lifecycle_declaration_id));
    assert.equal(entry.input_schema.additionalProperties, false);
    assert.ok(entry.output_schema);
    assert.ok(entry.max_response_bytes > 0);
    assert.ok(entry.risk_gates.length > 0);
    assert.ok(entry.tests.length > 0);
  }
});

test("every handler has a directory entry", () => {
  const handlerIds = new Set(capabilityDirectory.map((entry) => entry.handler_id));
  assert.deepEqual(Object.keys(handlers).sort(), [...handlerIds].sort());
});

test("mutations list idempotency tests and path capabilities have allowlists", () => {
  for (const entry of capabilityDirectory) {
    if (entry.operation_class === "mutation") {
      assert.match(entry.tests.join(" "), /replay|idempotency|operation_id/i);
    }
    if (entry.intent === "read_repo_file") {
      assert.ok(entry.allowed_paths.length > 0);
      assert.ok(entry.risk_gates.includes("path_allowlist"));
    }
    if (entry.external_systems.length > 0) {
      assert.ok(entry.risk_gates.length > 0);
    }
  }
});

test("directional institutional research intents are discoverable and handler-backed", () => {
  assert.ok(supportedIntents.includes("get_directional_institutional_research"));
  assert.ok(supportedIntents.includes("run_directional_institutional_research"));
  assert.equal(typeof handlers.get_directional_institutional_research, "function");
  assert.equal(typeof handlers.run_directional_institutional_research, "function");
  const validation = capabilityDirectory.find((entry) => entry.intent === "run_validation");
  assert.ok(validation.input_schema.properties.validation.enum.includes("production directional institutional research commission"));
});

test("capability lifecycle contains mandatory sequence", () => {
  assert.deepEqual(lifecycleMandatorySequence, [
    "declaration",
    "directory_entry",
    "strict_schema",
    "canonical_handler",
    "tests",
    "migration_when_needed",
    "validation_command",
    "deploy_live_verification_contract",
  ]);
});

test("execution leases are bounded by operation class", () => {
  assert.equal(operationLeaseMs("operator_status"), 15 * 60 * 1000);
  assert.equal(operationLeaseMs("monitor_github_workflow"), 5 * 60 * 1000);
  assert.equal(operationLeaseMs("run_directional_institutional_research"), 30 * 60 * 1000);
  assert.equal(operationLeaseMs("deploy_cloudflare_worker"), 30 * 60 * 1000);
});

test("action closure is bound to the sole canonical Git ledger", () => {
  const content = "## Active Job\n\nJob ID: `stage-13-directional-shadow-paper-research`\n\n## Current Action\n\nComplete the authority transition.";
  assert.deepEqual(parseContinuationMetadata(content), {
    active_job_id: "stage-13-directional-shadow-paper-research",
    current_action: "Complete the authority transition.",
  });
  const closure = buildActionClosure({
    status: "completed",
    capability: { id: "operating.operator_status", handler_id: "operator_status" },
    operationId: "closure-test",
    startupContext: { canonical_continuation: { path: "docs/ENGINEERING_CONTINUATION_LEDGER.md", sha: "abc123", content } },
  });
  assert.equal(closure.canonical_continuation_sha, "abc123");
  assert.equal(closure.active_job_id, "stage-13-directional-shadow-paper-research");
  assert.equal(closure.owner_action_required, false);
  assert.equal(closure.next_action, "reload_canonical_continuation_and_continue_current_action");
});

test("kernel source acquires a started receipt before handler execution", () => {
  const source = readFileSync(new URL("../src/operator/executionKernel.js", import.meta.url), "utf8");
  assert.ok(source.indexOf("beginOperationReceipt") < source.indexOf("await handler(capabilityInputs, context)"));
  assert.match(source, /operation_already_in_progress/);
  assert.match(source, /recordIncident/);
});

test("workflows use one validation runner and reuse exact-SHA evidence", () => {
  const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  const deploy = readFileSync(new URL("../.github/workflows/quant-lab-deploy.yml", import.meta.url), "utf8");
  assert.match(ci, /concurrency:/);
  assert.match(ci, /jobs:\n  validation:/);
  assert.doesNotMatch(ci, /worker-tests:|quant-core-tests:|wrangler-check:/);
  assert.match(deploy, /runs-on: ubuntu-latest/);
  assert.match(deploy, /Reuse successful exact-SHA CI evidence/);
  assert.match(deploy, /steps\.validation_evidence\.outputs\.reuse != 'true'/);
  assert.doesNotMatch(deploy, /Cancel older Quant Lab deploy runs/);
});

