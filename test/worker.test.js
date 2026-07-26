import assert from "node:assert/strict";
import test from "node:test";

import { handleRequest } from "../src/index.js";

const env = {
  ENVIRONMENT: "test",
  CURRENT_PHASE: "infrastructure-shell",
  DEPLOYMENT_SHA: "test-sha",
  INTERNAL_API_TOKEN: "test-token",
  MCP_CLIENT_ID: "test-client",
  MCP_CLIENT_SECRET: "test-client-secret",
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
  assert.match(body, /Paper-trading laboratory/);
  assert.doesNotMatch(body, /return/i);
  assert.doesNotMatch(body, /profit/i);
});

test("public status and openapi proof routes are removed", async () => {
  const status = await handleRequest(new Request("https://example.com/status"), env);
  const statusBody = await status.json();
  const openapi = await handleRequest(new Request("https://example.com/openapi.json"), env);

  assert.equal(status.status, 404);
  assert.equal(statusBody.error, "not_found");
  assert.equal(openapi.status, 404);
});

test("legacy public mcp route is removed", async () => {
  const response = await handleRequest(new Request("https://example.com/mcp"), env);
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.equal(body.error, "not_found");
});

test("operator mcp rejects unauthenticated requests before parsing", async () => {
  const response = await handleRequest(
    new Request("https://example.com/api/operator/mcp", {
      method: "POST",
      body: "{not-json",
    }),
    env,
  );
  const body = await response.json();

  assert.equal(response.status, 401);
  assert.equal(body.error, "unauthorized");
});

test("operator mcp initialize requires auth and returns a session id", async () => {
  const initialize = await handleRequest(
    new Request("https://example.com/api/operator/mcp", {
      method: "POST",
      headers: { authorization: "Bearer test-token" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    }),
    env,
  );
  const initializeBody = await initialize.json();

  assert.equal(initialize.status, 200);
  assert.equal(initializeBody.result.serverInfo.name, "quant-lab");
  assert.match(initialize.headers.get("mcp-session-id"), /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
});

test("operator mcp tools require valid session and expose one typed status tool", async () => {
  const initialize = await initializeMcpSession();
  const sessionId = initialize.headers.get("mcp-session-id");

  const noSession = await handleRequest(
    new Request("https://example.com/api/operator/mcp", {
      method: "POST",
      headers: { authorization: "Bearer test-token" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    }),
    env,
  );
  const noSessionBody = await noSession.json();

  assert.equal(noSession.status, 200);
  assert.equal(noSessionBody.error.message, "valid_mcp_session_required");

  const tools = await handleRequest(
    new Request("https://example.com/api/operator/mcp", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "mcp-session-id": sessionId,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list" }),
    }),
    env,
  );
  const toolsBody = await tools.json();

  assert.deepEqual(
    toolsBody.result.tools.map((tool) => tool.name),
    ["get_quant_lab_status"],
  );
  assert.equal(toolsBody.result.tools[0].inputSchema.additionalProperties, false);
  assert.equal(toolsBody.result.tools[0].annotations.readOnlyHint, true);
  assert.equal(toolsBody.result.tools[0].annotations.destructiveHint, false);
});

test("operator mcp status tool returns bounded status only", async () => {
  const initialize = await initializeMcpSession();
  const sessionId = initialize.headers.get("mcp-session-id");

  const response = await handleRequest(
    new Request("https://example.com/api/operator/mcp", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "mcp-session-id": sessionId,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "get_quant_lab_status", arguments: {} },
      }),
    }),
    env,
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.result.structuredContent.system, "Quant Lab");
  assert.equal(body.result.structuredContent.databaseConnected, true);
  assert.equal(body.result.structuredContent.databaseProbe, undefined);
});

test("operator mcp rejects unadvertised tools", async () => {
  const initialize = await initializeMcpSession();
  const sessionId = initialize.headers.get("mcp-session-id");

  const response = await handleRequest(
    new Request("https://example.com/api/operator/mcp", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "mcp-session-id": sessionId,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "internal_admin_shell", arguments: {} },
      }),
    }),
    env,
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.error.message, "public_direct_tool_required");
});

test("oauth metadata and token endpoint support connector auth", async () => {
  const metadata = await handleRequest(new Request("https://example.com/.well-known/oauth-authorization-server"), env);
  const metadataBody = await metadata.json();

  assert.equal(metadata.status, 200);
  assert.equal(metadataBody.token_endpoint, "https://example.com/api/operator/oauth/token");

  const token = await handleRequest(
    new Request("https://example.com/api/operator/oauth/token", {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: "test-client",
        client_secret: "test-client-secret",
      }),
    }),
    env,
  );
  const tokenBody = await token.json();

  assert.equal(token.status, 200);
  assert.equal(tokenBody.token_type, "Bearer");
  assert.match(tokenBody.access_token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
});

async function initializeMcpSession() {
  return handleRequest(
    new Request("https://example.com/api/operator/mcp", {
      method: "POST",
      headers: { authorization: "Bearer test-token" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    }),
    env,
  );
}
