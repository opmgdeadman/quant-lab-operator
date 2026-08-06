import assert from "node:assert/strict";
import test from "node:test";

import {
  capabilityDirectory,
  lifecycleDeclarations,
  lifecycleMandatorySequence,
  supportedIntents,
} from "../src/operator/capabilityDirectory.js";
import { handlers } from "../src/operator/handlers/controlPlane.js";

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

