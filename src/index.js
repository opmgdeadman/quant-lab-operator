import { executeQuantLabIntent } from "./operator/executionKernel.js";
import { loadQuantStartupContext } from "./operator/startupAuthority.js";
import { publicTools as operatorPublicTools } from "./operator/toolRegistry.js";

const SYSTEM_NAME = "Quant Lab";
const MCP_PATH = "/api/operator/mcp";
const OAUTH_METADATA_PATH = "/.well-known/oauth-authorization-server";
const OAUTH_AUTHORIZE_PATH = "/api/operator/oauth/authorize";
const OAUTH_TOKEN_PATH = "/api/operator/oauth/token";
const OPERATOR_ACCESS_TOKEN_TTL_SECONDS = 24 * 60 * 60;
const OPERATOR_REFRESH_TOKEN_TTL_SECONDS = 365 * 24 * 60 * 60;
const MCP_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export async function handleRequest(request, env) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (url.pathname === OAUTH_METADATA_PATH && request.method === "GET") {
    return json(oauthMetadata(request));
  }
  if (url.pathname === OAUTH_AUTHORIZE_PATH && request.method === "GET") {
    return handleOauthAuthorize(request, env);
  }
  if (url.pathname === OAUTH_TOKEN_PATH && request.method === "POST") {
    return handleOauthToken(request, env);
  }
  if (url.pathname === MCP_PATH) {
    return handleOperatorMcpRequest(request, env);
  }
  if (request.method !== "GET") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }
  if (url.pathname === "/") {
    return html(await renderHome(env));
  }
  if (url.pathname === "/internal/status") {
    if (!(await isAuthorized(request, env))) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }
    return json(await statusPayload(env));
  }
  return json({ ok: false, error: "not_found" }, 404);
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};

async function publicStatusPayload(env) {
  const status = await statusPayload(env);
  return {
    ok: status.ok,
    system: status.system,
    environment: status.environment,
    workerStatus: status.workerStatus,
    databaseConnected: status.databaseConnected,
    latestDeploymentSha: status.latestDeploymentSha,
    currentPhase: status.currentPhase,
  };
}

async function handleOperatorMcpRequest(request, env) {
  if (request.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }
  if (!(await isAnyOperatorRequestAuthorized(request, env))) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  let message;
  try {
    message = await request.json();
  } catch {
    return mcpError(null, -32700, "Invalid JSON");
  }

  if (Array.isArray(message)) {
    const responses = [];
    for (const item of message) {
      const response = await mcpResponseFor(item, request, env);
      if (response !== null) {
        responses.push(response);
      }
    }
    return mcpJson(responses);
  }

  const response = await mcpResponseFor(message, request, env);
  if (response === null) {
    return new Response(null, { status: 202, headers: corsHeaders() });
  }
  return mcpJson(response.body, 200, response.headers);
}

async function mcpResponseFor(message, request, env) {
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return { body: mcpErrorObject(message?.id ?? null, -32600, "Invalid JSON-RPC request") };
  }

  const id = Object.hasOwn(message, "id") ? message.id : undefined;
  const isNotification = id === undefined;

  if (message.method === "initialize") {
    if (isNotification) {
      return null;
    }
    const sessionId = await createMcpSessionId(env);
    return {
      headers: { "mcp-session-id": sessionId },
      body: {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: {
            name: "quant-lab",
            version: "0.2.0",
            deploymentSha: env.DEPLOYMENT_SHA || "unknown",
          },
          instructions: "Authenticated Quant Operator MCP. Before any operator intent, call get_quant_lab_startup_context, read the full Startup Authority and sole canonical Git ECL, then send the exact required acknowledgment and current ECL SHA with every intent.";
        },
      },
    };
  }

  if (message.method === "notifications/initialized") {
    return null;
  }

  if (message.method === "tools/list") {
    if (isNotification) {
      return null;
    }
    if (!(await hasValidMcpSession(request, env))) {
      return { body: mcpErrorObject(id, -32001, "valid_mcp_session_required") };
    }
    return {
      body: {
        jsonrpc: "2.0",
        id,
        result: {
          tools: operatorPublicTools(publicStatusSchema(), startupContextSchema(), executeIntentOutputSchema()),
        },
      },
    };
  }

  if (message.method === "tools/call") {
    if (isNotification) {
      return null;
    }
    if (!(await hasValidMcpSession(request, env))) {
      return { body: mcpErrorObject(id, -32001, "valid_mcp_session_required") };
    }
    const name = message.params?.name;
    const args = message.params?.arguments || {};
    if (!operatorPublicTools(publicStatusSchema(), startupContextSchema(), executeIntentOutputSchema()).some((tool) => tool.name === name)) {
      return { body: mcpErrorObject(id, -32602, "public_direct_tool_required") };
    }
    let structuredContent;
    try {
      structuredContent = await callPublicTool(name, args, env);
    } catch (error) {
      return {
        body: mcpErrorObject(
          id,
          -32602,
          error instanceof Error ? error.message : "tool_execution_failed",
        ),
      };
    }
    return {
      body: {
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify(structuredContent, null, 2),
            },
          ],
          structuredContent,
        },
      },
    };
  }

  if (message.method === "ping") {
    if (isNotification) {
      return null;
    }
    if (!(await hasValidMcpSession(request, env))) {
      return { body: mcpErrorObject(id, -32001, "valid_mcp_session_required") };
    }
    return {
      body: {
        jsonrpc: "2.0",
        id,
        result: {
          ok: true,
          deploymentSha: env.DEPLOYMENT_SHA || "unknown",
        },
      },
    };
  }

  return { body: mcpErrorObject(id ?? null, -32601, "Method not found") };
}

async function callPublicTool(name, args, env) {
  if (name === "get_quant_lab_startup_context") {
    return loadQuantStartupContext(env);
  }
  if (name === "get_quant_lab_status") {
    return publicStatusPayload(env);
  }
  if (name === "execute_quant_lab_intent") {
    const startupContext = await loadQuantStartupContext(env);
    return executeQuantLabIntent(args, {
      env,
      databaseProbe,
      startupContext,
    });
  }
  throw new ToolInputError("public_direct_tool_required");
}

async function findCandleByClosedAt(env, closedAt) {
  return env.DB.prepare(
    `SELECT id, pair, interval, closed_at, open, high, low, close, volume, source
     FROM market_candles
     WHERE pair = ? AND interval = ? AND closed_at = ?`,
  ).bind("BTC-USD", "1h", closedAt).first();
}

async function latestBtcUsdHourlyCandle(env) {
  const row = await env.DB.prepare(
    `SELECT id, pair, interval, closed_at, open, high, low, close, volume, source
     FROM market_candles
     WHERE pair = ? AND interval = ?
     ORDER BY closed_at DESC
     LIMIT 1`,
  ).bind("BTC-USD", "1h").first();
  return row ? candlePublicRow(row) : null;
}

function sameCandleValues(row, candle) {
  return row.pair === "BTC-USD"
    && row.interval === "1h"
    && row.closed_at === candle.closed_at
    && Number(row.open) === candle.open
    && Number(row.high) === candle.high
    && Number(row.low) === candle.low
    && Number(row.close) === candle.close
    && Number(row.volume) === candle.volume
    && row.source === candle.source;
}

function candlePublicRow(row) {
  return {
    id: row.id,
    pair: row.pair,
    interval: row.interval,
    closed_at: row.closed_at,
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume),
    source: row.source,
  };
}

function candleId(closedAt) {
  return `BTC-USD:1h:${closedAt}`;
}

class ToolInputError extends Error {}

function oauthMetadata(request) {
  const origin = new URL(request.url).origin;
  return {
    issuer: origin,
    authorization_endpoint: `${origin}${OAUTH_AUTHORIZE_PATH}`,
    token_endpoint: `${origin}${OAUTH_TOKEN_PATH}`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "client_credentials", "refresh_token"],
    token_endpoint_auth_methods_supported: ["client_secret_post"],
    scopes_supported: ["quant.operator"],
  };
}

async function handleOauthAuthorize(request, env) {
  const url = new URL(request.url);
  const redirectUri = url.searchParams.get("redirect_uri");
  if (!redirectUri) {
    return json({ ok: false, error: "missing_redirect_uri" }, 400);
  }
  const code = await createOauthCode(env);
  const redirect = new URL(redirectUri);
  redirect.searchParams.set("code", code);
  const state = url.searchParams.get("state");
  if (state) {
    redirect.searchParams.set("state", state);
  }
  return Response.redirect(redirect.toString(), 302);
}

async function handleOauthToken(request, env) {
  const form = await request.formData();
  const clientId = String(form.get("client_id") || "");
  const clientSecret = String(form.get("client_secret") || "");
  const code = String(form.get("code") || "");
  const refreshToken = String(form.get("refresh_token") || "");
  const grantType = String(form.get("grant_type") || "");
  if (!(await isOauthClientAuthorized(clientId, clientSecret, env))) {
    return json({ ok: false, error: "invalid_client" }, 401);
  }
  if (grantType === "authorization_code") {
    if (!(await verifyOauthCode(code, env))) {
      return json({ ok: false, error: "invalid_grant" }, 400);
    }
  } else if (grantType === "refresh_token") {
    if (!(await verifyOperatorRefreshToken(refreshToken, env))) {
      return json({ ok: false, error: "invalid_grant" }, 400);
    }
  } else if (grantType !== "client_credentials") {
    return json({ ok: false, error: "unsupported_grant_type" }, 400);
  }

  const response = {
    access_token: await createOperatorAccessToken(env),
    token_type: "Bearer",
    expires_in: OPERATOR_ACCESS_TOKEN_TTL_SECONDS,
    scope: "quant.operator",
  };
  if (grantType !== "client_credentials") {
    response.refresh_token = await createOperatorRefreshToken(env);
  }
  return json(response);
}

async function isAnyOperatorRequestAuthorized(request, env) {
  return (
    await isGptRequestAuthorized(request, env)
    || await isOperatorMcpRequestAuthorized(request, env)
    || await isInternalRequestAuthorized(request, env)
  );
}

async function isGptRequestAuthorized(request, env) {
  return isBearerTokenAuthorized(request, env);
}

async function isOperatorMcpRequestAuthorized(request, env) {
  return isBearerTokenAuthorized(request, env);
}

async function isInternalRequestAuthorized(request, env) {
  return isAuthorized(request, env);
}

async function isBearerTokenAuthorized(request, env) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) {
    return false;
  }
  const supplied = authorization.slice(7);
  const expected = env.INTERNAL_API_TOKEN;
  if (!supplied || !expected) {
    return false;
  }
  if (await timingSafeEqual(supplied, expected)) {
    return true;
  }
  return verifyOperatorAccessToken(supplied, env);
}

async function isOauthClientAuthorized(clientId, clientSecret, env) {
  const expectedId = env.MCP_CLIENT_ID || "quant-lab-dev";
  const expectedSecret = env.MCP_CLIENT_SECRET;
  if (!expectedSecret || !clientSecret || clientId !== expectedId) {
    return false;
  }
  return timingSafeEqual(clientSecret, expectedSecret);
}

async function createOauthCode(env) {
  const payload = {
    type: "oauth_code",
    exp: Math.floor(Date.now() / 1000) + 300,
    deploymentSha: env.DEPLOYMENT_SHA || "unknown",
  };
  return signPayload(payload, env);
}

async function verifyOauthCode(code, env) {
  const payload = await verifySignedPayload(code, env);
  return payload?.type === "oauth_code";
}

async function createOperatorAccessToken(env) {
  return signPayload({
    type: "operator_access",
    exp: Math.floor(Date.now() / 1000) + OPERATOR_ACCESS_TOKEN_TTL_SECONDS,
    deploymentSha: env.DEPLOYMENT_SHA || "unknown",
  }, env);
}

async function verifyOperatorAccessToken(token, env) {
  const payload = await verifySignedPayload(token, env);
  return payload?.type === "operator_access";
}

async function createOperatorRefreshToken(env) {
  return signPayload({
    type: "operator_refresh",
    exp: Math.floor(Date.now() / 1000) + OPERATOR_REFRESH_TOKEN_TTL_SECONDS,
  }, env);
}

async function verifyOperatorRefreshToken(token, env) {
  const payload = await verifySignedPayload(token, env);
  return payload?.type === "operator_refresh";
}

async function createMcpSessionId(env) {
  return signPayload({
    type: "mcp_session",
    exp: Math.floor(Date.now() / 1000) + MCP_SESSION_TTL_SECONDS,
    deploymentSha: env.DEPLOYMENT_SHA || "unknown",
  }, env);
}

async function hasValidMcpSession(request, env) {
  const sessionId = request.headers.get("mcp-session-id") || "";
  const payload = await verifySignedPayload(sessionId, env);
  return payload?.type === "mcp_session";
}

async function signPayload(payload, env) {
  const encodedPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await hmacSha256(encodedPayload, env);
  return `${encodedPayload}.${signature}`;
}

async function verifySignedPayload(token, env) {
  const [encodedPayload, suppliedSignature] = String(token || "").split(".");
  if (!encodedPayload || !suppliedSignature) {
    return null;
  }
  const expectedSignature = await hmacSha256(encodedPayload, env);
  if (!(await timingSafeEqual(suppliedSignature, expectedSignature))) {
    return null;
  }
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encodedPayload)));
  } catch {
    return null;
  }
  if (typeof payload.exp === "number" && payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  return payload;
}

async function hmacSha256(value, env) {
  const secret = env.INTERNAL_API_TOKEN;
  if (!secret) {
    throw new Error("missing_internal_api_token");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return base64UrlEncode(new Uint8Array(signature));
}

function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlDecode(value) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function mcpError(id, code, message) {
  return mcpJson(mcpErrorObject(id, code, message));
}

function mcpErrorObject(id, code, message) {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message },
  };
}

async function statusPayload(env) {
  const dbProbe = await databaseProbe(env);
  return {
    ok: dbProbe.connected,
    system: SYSTEM_NAME,
    environment: env.ENVIRONMENT || "unknown",
    workerStatus: "online",
    databaseConnected: dbProbe.connected,
    databaseProbe: dbProbe,
    latestDeploymentSha: env.DEPLOYMENT_SHA || "unknown",
    currentPhase: env.CURRENT_PHASE || "unknown",
    boundaries: {
      paperTradingOnly: true,
      tradingClaims: false,
      fakeMetrics: false,
      localDependencies: false,
    },
  };
}

async function databaseProbe(env) {
  try {
    const row = await env.DB.prepare("SELECT value, updated_at FROM infra_status WHERE key = ?")
      .bind("database_connected")
      .first();
    return {
      connected: row?.value === "true",
      updatedAt: row?.updated_at || null,
    };
  } catch (error) {
    return {
      connected: false,
      error: error instanceof Error ? error.message : "unknown_error",
    };
  }
}

async function isAuthorized(request, env) {
  const expected = env.INTERNAL_API_TOKEN;
  if (!expected) {
    return false;
  }
  const internalHeader = request.headers.get("x-internal-token") || "";
  const authorization = request.headers.get("authorization") || "";
  const supplied = internalHeader || (authorization.startsWith("Bearer ") ? authorization.slice(7) : "");
  if (!supplied) {
    return false;
  }
  return timingSafeEqual(supplied, expected);
}

async function timingSafeEqual(left, right) {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  if (leftBytes.length !== rightBytes.length) {
    return false;
  }
  const leftDigest = await crypto.subtle.digest("SHA-256", leftBytes);
  const rightDigest = await crypto.subtle.digest("SHA-256", rightBytes);
  return constantTimeBytesEqual(new Uint8Array(leftDigest), new Uint8Array(rightDigest));
}

function constantTimeBytesEqual(left, right) {
  if (left.length !== right.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index] ^ right[index];
  }
  return diff === 0;
}

async function renderHome(env) {
  const latest = await latestCandleForHome(env);
  const latestMarkup = latest ? `
    <section>
      <h2>Latest Stored BTC-USD 1h Candle</h2>
      <dl>
        <div><dt>Closed</dt><dd>${escapeHtml(latest.closed_at)}</dd></div>
        <div><dt>Open</dt><dd>${escapeHtml(latest.open)}</dd></div>
        <div><dt>High</dt><dd>${escapeHtml(latest.high)}</dd></div>
        <div><dt>Low</dt><dd>${escapeHtml(latest.low)}</dd></div>
        <div><dt>Close</dt><dd>${escapeHtml(latest.close)}</dd></div>
        <div><dt>Volume</dt><dd>${escapeHtml(latest.volume)}</dd></div>
        <div><dt>Source</dt><dd>${escapeHtml(latest.source)}</dd></div>
      </dl>
    </section>` : `
    <section>
      <h2>Latest Stored BTC-USD 1h Candle</h2>
      <p>No stored candle yet.</p>
    </section>`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${SYSTEM_NAME}</title>
  <style>
    body { margin: 0; font-family: Inter, Segoe UI, Arial, sans-serif; background: #f7f8fa; color: #101828; }
    main { max-width: 760px; margin: 0 auto; padding: 48px 20px; }
    h1 { margin: 0 0 8px; font-size: 34px; letter-spacing: 0; }
    p { color: #475467; line-height: 1.5; }
    .meta { display: flex; gap: 12px; flex-wrap: wrap; padding-top: 18px; border-top: 1px solid #d0d5dd; }
    .pill { border: 1px solid #d0d5dd; border-radius: 999px; padding: 8px 12px; font-weight: 700; color: #344054; }
    section { margin-top: 32px; border-top: 1px solid #d0d5dd; padding-top: 24px; }
    h2 { margin: 0 0 14px; font-size: 18px; }
    dl { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 0; }
    dt { font-size: 12px; color: #667085; text-transform: uppercase; font-weight: 700; }
    dd { margin: 4px 0 0; font-weight: 700; color: #101828; }
  </style>
</head>
<body>
  <main>
    <h1>${SYSTEM_NAME}</h1>
    <p>Paper-trading laboratory. Public display is intentionally limited while authenticated operator controls and durable state are developed.</p>
    <div class="meta">
      <span class="pill">${escapeHtml(env.ENVIRONMENT || "unknown")}</span>
      <span class="pill">${escapeHtml(env.CURRENT_PHASE || "unknown")}</span>
    </div>
    ${latestMarkup}
  </main>
</body>
</html>`;
}

async function latestCandleForHome(env) {
  try {
    return latestBtcUsdHourlyCandle(env);
  } catch {
    return null;
  }
}

function publicStatusSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      ok: { type: "boolean" },
      system: { type: "string" },
      environment: { type: "string" },
      workerStatus: { type: "string" },
      databaseConnected: { type: "boolean" },
      latestDeploymentSha: { type: "string" },
      currentPhase: { type: "string" },
    },
    required: [
      "ok",
      "system",
      "environment",
      "workerStatus",
      "databaseConnected",
      "latestDeploymentSha",
      "currentPhase",
    ],
  };
}

function startupContextSchema() {
  const documentSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      ok: { type: "boolean" },
      path: { type: "string" },
      sha: { type: "string" },
      source: { type: "string" },
      content: { type: "string" },
    },
    required: ["ok", "path", "sha", "source", "content"],
  };
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      ok: { type: "boolean" },
      required_governing_authority_ack: { type: "string" },
      startup_authority: { anyOf: [{ type: "null" }, documentSchema] },
      canonical_continuation: { anyOf: [{ type: "null" }, documentSchema] },
      errors: { type: "array", items: { type: "string" } },
    },
    required: ["ok", "required_governing_authority_ack", "startup_authority", "canonical_continuation", "errors"],
  };
}

function ingestCandleOutputSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      ok: { type: "boolean" },
      tool: { type: "string" },
      pair: { type: "string" },
      closed_at: { type: "string" },
      inserted: { type: "boolean" },
      replayed: { type: "boolean" },
      candle_id: { type: "string" },
      database_connected: { type: "boolean" },
    },
    required: ["ok", "tool", "pair", "closed_at", "inserted", "replayed", "candle_id", "database_connected"],
  };
}

function latestCandleOutputSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      ok: { type: "boolean" },
      pair: { type: "string" },
      candle: {
        anyOf: [
          { type: "null" },
          {
            type: "object",
            additionalProperties: false,
            properties: {
              id: { type: "string" },
              pair: { type: "string" },
              interval: { type: "string" },
              closed_at: { type: "string" },
              open: { type: "number" },
              high: { type: "number" },
              low: { type: "number" },
              close: { type: "number" },
              volume: { type: "number" },
              source: { type: "string" },
            },
            required: ["id", "pair", "interval", "closed_at", "open", "high", "low", "close", "volume", "source"],
          },
        ],
      },
      database_connected: { type: "boolean" },
    },
    required: ["ok", "pair", "candle", "database_connected"],
  };
}

function executeIntentOutputSchema() {
  return {
    type: "object",
    additionalProperties: true,
    properties: {
      ok: { type: "boolean" },
      intent: { type: "string" },
      operation_id: { type: "string" },
      receipt: { type: "object", additionalProperties: true },
      execution_kernel: { type: "object", additionalProperties: true },
      operator_action_closure: { type: "object", additionalProperties: true },
      result: { type: "object", additionalProperties: true },
    },
    required: ["ok", "intent", "operation_id", "receipt", "execution_kernel", "operator_action_closure", "result"],
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...corsHeaders(),
    },
  });
}

function html(body) {
  return new Response(body, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function mcpJson(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...corsHeaders(),
      ...extraHeaders,
    },
  });
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization, x-internal-token, mcp-session-id",
    "access-control-expose-headers": "mcp-session-id",
  };
}
