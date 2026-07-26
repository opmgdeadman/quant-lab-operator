import assert from "node:assert/strict";
import test from "node:test";

import { handleRequest } from "../src/index.js";

const env = {
  ENVIRONMENT: "test",
  CURRENT_PHASE: "infrastructure-shell",
  DEPLOYMENT_SHA: "test-sha",
  INTERNAL_API_TOKEN: "test-token",
  DB: {
    prepare() {
      return {
        bind() {
          return {
            async first() {
              return { value: "true", updated_at: "2026-07-26T00:00:00Z" };
            },
          };
        },
      };
    },
  },
};

test("public status exposes shell state only", async () => {
  const response = await handleRequest(new Request("https://example.com/status"), env);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.system, "Quant Lab");
  assert.equal(body.databaseConnected, true);
  assert.equal(body.currentPhase, "infrastructure-shell");
  assert.equal(body.databaseProbe, undefined);
});

test("internal status requires bearer token", async () => {
  const denied = await handleRequest(new Request("https://example.com/internal/status"), env);
  assert.equal(denied.status, 401);

  const allowed = await handleRequest(
    new Request("https://example.com/internal/status", {
      headers: { "x-internal-token": "test-token" },
    }),
    env,
  );
  const body = await allowed.json();

  assert.equal(allowed.status, 200);
  assert.equal(body.databaseProbe.connected, true);
});

test("home renders no trading claims or fake metrics", async () => {
  const response = await handleRequest(new Request("https://example.com/"), env);
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(body, /Infrastructure shell/);
  assert.doesNotMatch(body, /return/i);
  assert.doesNotMatch(body, /profit/i);
});

test("openapi schema exposes only public status action", async () => {
  const response = await handleRequest(new Request("https://example.com/openapi.json"), env);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.openapi, "3.1.0");
  assert.equal(body.paths["/status"].get.operationId, "getQuantLabStatus");
  assert.equal(body.paths["/internal/status"], undefined);
});
