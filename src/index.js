import { getMarketDataHealth, runHourlyCandleIngestion } from "./marketData.js";
import { getPaperAccountSummary } from "./paperLedger.js";
import { getBaselineBenchSummary } from "./baselineBench.js";
import { getHostileJudgeSummary } from "./hostileJudge.js";
import { getStrategyFactorySummary } from "./strategyFactory.js";
import { getChampionSelectionSummary } from "./championSelection.js";
import { getForwardOperationSummary, runScheduledForwardOperation } from "./forwardPaper.js";
import { getLiveQualificationSummary, runProductionLiveQualification } from "./liveQualification.js";
import { getRollingResearchSummary, runScheduledRollingResearch } from "./rollingResearch.js";
import { getHistoricalBootstrapSummary, runScheduledHistoricalBootstrap } from "./historicalBootstrap.js";
import { getDirectionalShadowSummary, runScheduledDirectionalShadow } from "./directionalShadow.js";
import { getDirectionalInstitutionalResearchSummary, runProductionDirectionalInstitutionalResearch } from "./directionalInstitutionalResearch.js";
import { getInstitutionalResearchPortfolioSummary } from "./institutionalResearchPortfolio.js";
import { runScheduledInstitutionalResearchForwardEvidence } from "./institutionalResearchEvaluation.js";
import { renderProfessionalConsole } from "./professionalConsole.js";
import { BRAND_ASSETS as CANONICAL_BRAND_ASSETS, BRAND_MANIFEST } from "./brandAssetsCanonical.js";
import { executeQuantLabIntent, executionKernelInfo } from "./operator/executionKernel.js";
import { capabilityDirectory, resolveCapabilitySelector } from "./operator/capabilityDirectory.js";
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
const MCP_SERVER_VERSION = "0.5.0";
const BRAND_ASSETS = Object.freeze({
  ...CANONICAL_BRAND_ASSETS,
  "/og-image.png": CANONICAL_BRAND_ASSETS["/android-chrome-512x512.png"],
});

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
  if (url.pathname === "/internal/market-data/ingest" && request.method === "POST") {
    if (!(await isAuthorized(request, env))) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }
    try {
      return json(await runHourlyCandleIngestion(env));
    } catch (error) {
      return json({
        ok: false,
        error: error instanceof Error ? error.message : "market_data_ingestion_failed",
      }, 502);
    }
  }
  if (request.method !== "GET") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }
  if (BRAND_ASSETS[url.pathname]) {
    return brandAsset(BRAND_ASSETS[url.pathname]);
  }
  if (url.pathname === "/site.webmanifest") {
    return webManifest();
  }
  if (url.pathname === "/") {
    return html(await renderHome(env, url.origin));
  }
  if (url.pathname === "/api/public/status") {
    return json(await publicStatusPayload(env));
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
  scheduled(controller, env, ctx) {
    const scheduledAt = new Date(controller.scheduledTime);
    ctx.waitUntil(runScheduledQuantLabOperation(env, scheduledAt));
  },
};

async function runScheduledQuantLabOperation(env, scheduledAt) {
  const forward = await runScheduledForwardOperation(env, scheduledAt);
  const directionalShadow = await runScheduledDirectionalShadow(env, scheduledAt);
  const directionalResearch = await runProductionDirectionalInstitutionalResearch(env, { now: scheduledAt });
  const institutionalForward = await runScheduledInstitutionalResearchForwardEvidence(env, { now: scheduledAt });
  const qualification = await runProductionLiveQualification(env);
  const rollingResearch = await runScheduledRollingResearch(env, scheduledAt);
  const historicalBootstrap = await runScheduledHistoricalBootstrap(env, scheduledAt);
  return { forward, directionalShadow, directionalResearch, institutionalForward, qualification, rollingResearch, historicalBootstrap };
}

async function publicStatusPayload(env) {
  try {
    const status = await statusPayload(env);
    return {
      ok: status.ok,
      system: status.system,
      environment: status.environment,
      workerStatus: status.workerStatus,
      databaseConnected: status.databaseConnected,
      latestDeploymentSha: status.latestDeploymentSha,
      currentPhase: status.currentPhase,
      dataHealth: status.dataHealth,
      paperAccount: status.paperAccount,
      baselineBench: status.baselineBench,
      hostileJudge: status.hostileJudge,
      strategyFactory: status.strategyFactory,
      championSelection: status.championSelection,
      forwardOperation: status.forwardOperation,
      liveQualification: status.liveQualification,
      rollingResearch: status.rollingResearch,
      historicalBootstrap: status.historicalBootstrap,
      directionalShadow: status.directionalShadow,
      directionalResearch: status.directionalResearch,
    };
  } catch {
    const dbProbe = await databaseProbe(env);
    return {
      ok: dbProbe.connected,
      system: SYSTEM_NAME,
      environment: env.ENVIRONMENT || "unknown",
      workerStatus: "online",
      databaseConnected: dbProbe.connected,
      latestDeploymentSha: env.DEPLOYMENT_SHA || "unknown",
      currentPhase: env.CURRENT_PHASE || "unknown",
      dataHealth: null,
      paperAccount: null,
      baselineBench: null,
      hostileJudge: null,
      strategyFactory: null,
      championSelection: null,
      forwardOperation: null,
      liveQualification: null,
      rollingResearch: null,
      historicalBootstrap: null,
      directionalShadow: null,
      directionalResearch: null,
    };
  }
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
            version: MCP_SERVER_VERSION,
            deploymentSha: env.DEPLOYMENT_SHA || "unknown",
            executionKernelVersion: executionKernelInfo.version,
          },
          instructions: "Authenticated Quant Operator MCP. Sessions are deployment-scoped and must reinitialize after a Worker, Execution Kernel, or public schema change. The public surface is a stable five-tool gateway: load startup authority, inspect dynamic server-side capability definitions, then execute through the read-only or mutation gateway matching the capability effect class. Internal capability and strategy evolution must not change tools/list. Before any operator execution, call get_quant_lab_startup_context, read the full Startup Authority and sole canonical Git ECL, then send the exact required acknowledgment and current ECL SHA.",
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
    const sessionValidation = await validateMcpSession(request, env);
    if (!sessionValidation.ok) {
      const replacementSessionId = sessionValidation.stale ? await createMcpSessionId(env) : null;
      return {
        ...(replacementSessionId ? { headers: { "mcp-session-id": replacementSessionId } } : {}),
        body: mcpErrorObject(id, -32001, sessionValidation.stale
          ? "mcp_deployment_changed_reinitialize"
          : "valid_mcp_session_required"),
      };
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
    const sessionValidation = await validateMcpSession(request, env);
    if (!sessionValidation.ok) {
      const replacementSessionId = sessionValidation.stale ? await createMcpSessionId(env) : null;
      return {
        ...(replacementSessionId ? { headers: { "mcp-session-id": replacementSessionId } } : {}),
        body: mcpErrorObject(id, -32001, sessionValidation.stale
          ? "mcp_deployment_changed_reinitialize"
          : "valid_mcp_session_required"),
      };
    }
    const name = message.params?.name;
    const args = message.params?.arguments || {};
    if (!operatorPublicTools(publicStatusSchema(), startupContextSchema(), executeIntentOutputSchema()).some((tool) => tool.name === name)) {
      return { body: mcpErrorObject(id, -32602, "stable_operator_gateway_required") };
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
    const sessionValidation = await validateMcpSession(request, env);
    if (!sessionValidation.ok) {
      const replacementSessionId = sessionValidation.stale ? await createMcpSessionId(env) : null;
      return {
        ...(replacementSessionId ? { headers: { "mcp-session-id": replacementSessionId } } : {}),
        body: mcpErrorObject(id, -32001, sessionValidation.stale
          ? "mcp_deployment_changed_reinitialize"
          : "valid_mcp_session_required"),
      };
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
  if (name === "get_quant_lab_capability_definition") {
    return quantCapabilityDefinition(args.capability);
  }
  if (name !== "execute_quant_lab_read_action" && name !== "execute_quant_lab_mutation_action") {
    throw new ToolInputError("stable_operator_gateway_required");
  }

  const capability = resolveCapabilitySelector(args.capability);
  if (!capability) {
    throw new ToolInputError("unknown_capability");
  }
  const requiredClass = name === "execute_quant_lab_read_action" ? "read" : "mutation";
  if (capability.operation_class !== requiredClass) {
    throw new ToolInputError(`capability_effect_mismatch:${requiredClass}_gateway`);
  }
  if (!args.arguments || typeof args.arguments !== "object" || Array.isArray(args.arguments)) {
    throw new ToolInputError("invalid_capability_arguments");
  }

  const startupContext = await loadQuantStartupContext(env);
  return executeQuantLabIntent({
    operation_id: args.operation_id,
    intent: capability.intent,
    inputs: {
      ...args.arguments,
      governing_authority_ack: args.governing_authority_ack,
      canonical_continuation_sha: args.canonical_continuation_sha,
    },
  }, {
    env,
    databaseProbe,
    startupContext,
    marketDataIngestion: runHourlyCandleIngestion,
  });
}

function quantCapabilityDefinition(selector) {
  if (selector !== undefined && (typeof selector !== "string" || selector.length < 1 || selector.length > 120)) {
    throw new ToolInputError("invalid_capability_selector");
  }
  if (selector === undefined) {
    return {
      ok: true,
      public_tool_count: 5,
      public_schema_stable: true,
      capability_count: capabilityDirectory.length,
      capabilities: capabilityDirectory.map((capability) => ({
        id: capability.id,
        intent: capability.intent,
        title: capability.title,
        operation_class: capability.operation_class,
      })),
    };
  }
  const capability = resolveCapabilitySelector(selector);
  if (!capability) {
    throw new ToolInputError("unknown_capability");
  }
  return {
    ok: true,
    public_tool_count: 5,
    public_schema_stable: true,
    capability_count: capabilityDirectory.length,
    capability: {
      id: capability.id,
      intent: capability.intent,
      title: capability.title,
      operation_class: capability.operation_class,
      input_schema: capability.input_schema,
      output_schema: capability.output_schema,
      risk_gates: capability.risk_gates,
      external_systems: capability.external_systems,
      allowed_paths: capability.allowed_paths || [],
      allowed_actions: capability.allowed_actions || [],
      max_response_bytes: capability.max_response_bytes,
    },
  };
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
    executionKernelVersion: executionKernelInfo.version,
  }, env);
}

async function validateMcpSession(request, env) {
  const sessionId = request.headers.get("mcp-session-id") || "";
  const payload = await verifySignedPayload(sessionId, env);
  if (payload?.type !== "mcp_session") {
    return { ok: false, stale: false, reason: "valid_mcp_session_required" };
  }
  const deploymentSha = env.DEPLOYMENT_SHA || "unknown";
  if (payload.deploymentSha !== deploymentSha || payload.executionKernelVersion !== executionKernelInfo.version) {
    return {
      ok: false,
      stale: true,
      reason: "mcp_deployment_changed_reinitialize",
      sessionDeploymentSha: payload.deploymentSha || null,
      currentDeploymentSha: deploymentSha,
      sessionExecutionKernelVersion: payload.executionKernelVersion || null,
      currentExecutionKernelVersion: executionKernelInfo.version,
    };
  }
  return { ok: true, stale: false, reason: null };
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
  const [dbProbe, dataHealth, paperAccount, baselineBench, hostileJudge, strategyFactory, championSelection, forwardOperation, liveQualification, rollingResearch, historicalBootstrap, directionalShadow, directionalResearch] = await Promise.all([
    databaseProbe(env),
    marketDataHealthForHome(env),
    paperAccountForHome(env),
    baselineBenchForHome(env),
    hostileJudgeForHome(env),
    strategyFactoryForHome(env),
    championSelectionForHome(env),
    forwardOperationForHome(env),
    liveQualificationForHome(env),
    rollingResearchForHome(env),
    historicalBootstrapForHome(env),
    directionalShadowForHome(env),
    directionalResearchForHome(env),
  ]);
  return {
    ok: dbProbe.connected,
    system: SYSTEM_NAME,
    environment: env.ENVIRONMENT || "unknown",
    workerStatus: "online",
    databaseConnected: dbProbe.connected,
    databaseProbe: dbProbe,
    dataHealth,
    paperAccount: forwardOperation?.paper_main || paperAccount,
    baselineBench,
    hostileJudge,
    strategyFactory,
    championSelection,
    forwardOperation,
    liveQualification,
    rollingResearch,
    historicalBootstrap,
    directionalShadow,
    directionalResearch,
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

async function renderHome(env, siteOrigin) {
  const [latest, candles, health, paperAccount, baselineBench, hostileJudge, strategyFactory, championSelection, forwardOperation, liveQualification, rollingResearch, historicalBootstrap, directionalShadow, directionalResearch, institutionalResearchPortfolio] = await Promise.all([
    latestCandleForHome(env),
    recentCandlesForHome(env),
    marketDataHealthForHome(env),
    paperAccountForHome(env),
    baselineBenchForHome(env),
    hostileJudgeForHome(env),
    strategyFactoryForHome(env),
    championSelectionForHome(env),
    forwardOperationForHome(env),
    liveQualificationForHome(env),
    rollingResearchForHome(env),
    historicalBootstrapForHome(env),
    directionalShadowForHome(env),
    directionalResearchForHome(env),
    institutionalResearchPortfolioForHome(env),
  ]);
  return renderProfessionalConsole({
    siteOrigin,
    environment: env.ENVIRONMENT || "unknown",
    currentPhase: env.CURRENT_PHASE || "unknown",
    deploymentSha: env.DEPLOYMENT_SHA || "unknown",
    latest,
    candles,
    health,
    paperAccount,
    baselineBench,
    hostileJudge,
    strategyFactory,
    championSelection,
    forwardOperation,
    liveQualification,
    rollingResearch,
    historicalBootstrap,
    directionalShadow,
    directionalResearch,
    institutionalResearchPortfolio,
  });
}

async function renderLegacyHome(env) {
  const [latest, health, paperAccount, baselineBench, hostileJudge, strategyFactory, championSelection, forwardOperation, liveQualification, rollingResearch, historicalBootstrap] = await Promise.all([
    latestCandleForHome(env),
    marketDataHealthForHome(env),
    paperAccountForHome(env),
    baselineBenchForHome(env),
    hostileJudgeForHome(env),
    strategyFactoryForHome(env),
    championSelectionForHome(env),
    forwardOperationForHome(env),
    liveQualificationForHome(env),
    rollingResearchForHome(env),
    historicalBootstrapForHome(env),
  ]);
  const healthMarkup = health ? `
    <section>
      <h2>BTC-USD 1h Data Health</h2>
      <dl>
        <div><dt>Status</dt><dd>${escapeHtml(health.status)}</dd></div>
        <div><dt>Provider</dt><dd>${escapeHtml(health.provider)}</dd></div>
        <div><dt>Latest closed</dt><dd>${escapeHtml(health.latest_closed_at || "none")}</dd></div>
        <div><dt>Expected latest</dt><dd>${escapeHtml(health.expected_latest_closed_at)}</dd></div>
        <div><dt>Stale hours</dt><dd>${escapeHtml(health.stale_hours ?? "n/a")}</dd></div>
        <div><dt>Missing candles</dt><dd>${escapeHtml(health.missing_candles)}</dd></div>
        <div><dt>Last success</dt><dd>${escapeHtml(health.last_success_at || "none")}</dd></div>
        <div><dt>Last error</dt><dd>${escapeHtml(health.last_error || "none")}</dd></div>
      </dl>
    </section>` : `
    <section>
      <h2>BTC-USD 1h Data Health</h2>
      <p>Data-health state is unavailable until the latest migration is applied.</p>
    </section>`;
  const paperMarkup = paperAccount ? `
    <section>
      <h2>Paper Account</h2>
      <p>Simulation only. No live capital is connected or authorized.</p>
      <dl>
        <div><dt>Status</dt><dd>${escapeHtml(paperAccount.status)}</dd></div>
        <div><dt>Cash</dt><dd>${escapeHtml(paperAccount.cash_balance)}</dd></div>
        <div><dt>BTC quantity</dt><dd>${escapeHtml(paperAccount.position_quantity)}</dd></div>
        <div><dt>Average cost</dt><dd>${escapeHtml(paperAccount.average_cost)}</dd></div>
        <div><dt>Realized P&amp;L</dt><dd>${escapeHtml(paperAccount.realized_pnl)}</dd></div>
        <div><dt>Unrealized P&amp;L</dt><dd>${escapeHtml(paperAccount.unrealized_pnl)}</dd></div>
        <div><dt>Fees</dt><dd>${escapeHtml(paperAccount.total_fees)}</dd></div>
        <div><dt>Equity</dt><dd>${escapeHtml(paperAccount.equity)}</dd></div>
        <div><dt>Portfolio version</dt><dd>${escapeHtml(paperAccount.portfolio_version)}</dd></div>
        <div><dt>Cycles</dt><dd>${escapeHtml(paperAccount.cycle_count)}</dd></div>
        <div><dt>Fills</dt><dd>${escapeHtml(paperAccount.fill_count)}</dd></div>
        <div><dt>Reconciled</dt><dd>${escapeHtml(paperAccount.accounting_reconciled)}</dd></div>
      </dl>
    </section>` : `
    <section>
      <h2>Paper Account</h2>
      <p>Paper-account state is unavailable until the Stage 2 migration is applied.</p>
    </section>`;
  const baselineRows = baselineBench?.test_comparison?.map((entry) => `
        <div><dt>${escapeHtml(entry.baseline_id)}</dt><dd>${escapeHtml(entry.metrics.total_return_percent)}% return · ${escapeHtml(entry.metrics.max_drawdown_percent)}% max drawdown · ${escapeHtml(entry.metrics.trade_count)} trades</dd></div>`).join("") || "";
  const baselineMarkup = baselineBench ? `
    <section>
      <h2>Historical Baseline Research</h2>
      <p>Fixed historical paper benchmarks only. This ordering is not a promotion, recommendation, or live-trading claim.</p>
      <dl>
        <div><dt>Benchmark</dt><dd>${escapeHtml(baselineBench.benchmark_id)}</dd></div>
        <div><dt>Dataset candles</dt><dd>${escapeHtml(baselineBench.dataset_candle_count)}</dd></div>
        <div><dt>Dataset start</dt><dd>${escapeHtml(baselineBench.dataset_start_closed_at)}</dd></div>
        <div><dt>Dataset end</dt><dd>${escapeHtml(baselineBench.dataset_end_closed_at)}</dd></div>
        <div><dt>Baselines</dt><dd>${escapeHtml(baselineBench.baseline_count)}</dd></div>
        <div><dt>Partitioned runs</dt><dd>${escapeHtml(baselineBench.run_count)}</dd></div>
        <div><dt>Tuning allowed</dt><dd>${escapeHtml(baselineBench.tuning_allowed)}</dd></div>
        <div><dt>Promotion performed</dt><dd>${escapeHtml(baselineBench.promotion_performed)}</dd></div>
        ${baselineRows}
      </dl>
    </section>` : `
    <section>
      <h2>Historical Baseline Research</h2>
      <p>No frozen baseline benchmark has been commissioned yet.</p>
    </section>`;
  const judgeRows = hostileJudge?.verdicts?.map((entry) => `
        <div><dt>${escapeHtml(entry.baseline_id)}</dt><dd>${escapeHtml(entry.verdict)} · ${escapeHtml(entry.reason_codes.join(", ") || "all gates passed")}</dd></div>`).join("") || "";
  const judgeMarkup = hostileJudge ? `
    <section>
      <h2>Hostile Evidence Judge</h2>
      <p>Qualification evidence only. The judge rejects or qualifies evidence; it never promotes a strategy or enables live capital.</p>
      <dl>
        <div><dt>Judge</dt><dd>${escapeHtml(hostileJudge.judge_id)}</dd></div>
        <div><dt>Evaluated</dt><dd>${escapeHtml(hostileJudge.evaluation_count)}</dd></div>
        <div><dt>Qualified</dt><dd>${escapeHtml(hostileJudge.qualified_count)}</dd></div>
        <div><dt>Insufficient</dt><dd>${escapeHtml(hostileJudge.insufficient_count)}</dd></div>
        <div><dt>Rejected</dt><dd>${escapeHtml(hostileJudge.rejected_count)}</dd></div>
        <div><dt>Promotion performed</dt><dd>${escapeHtml(hostileJudge.promotion_performed)}</dd></div>
        ${judgeRows}
      </dl>
    </section>` : `
    <section>
      <h2>Hostile Evidence Judge</h2>
      <p>No immutable judge batch has been commissioned yet.</p>
    </section>`;
  const factoryRows = strategyFactory?.verdicts?.map((entry) => `
        <div><dt>${escapeHtml(entry.candidate_id)}</dt><dd>${escapeHtml(entry.verdict)} · ${escapeHtml(entry.reason_codes.join(", ") || "all gates passed")}</dd></div>`).join("") || "";
  const factoryMarkup = strategyFactory ? `
    <section>
      <h2>Controlled Strategy Factory</h2>
      <p>Exactly eight predeclared candidates. No adaptive tuning, result-dependent expansion, promotion, forward scheduling, or live capital.</p>
      <dl>
        <div><dt>Policy</dt><dd>${escapeHtml(strategyFactory.factory_policy_id)}</dd></div>
        <div><dt>Candidates</dt><dd>${escapeHtml(strategyFactory.candidate_count)}</dd></div>
        <div><dt>Partitioned runs</dt><dd>${escapeHtml(strategyFactory.run_count)}</dd></div>
        <div><dt>Qualified</dt><dd>${escapeHtml(strategyFactory.qualified_count)}</dd></div>
        <div><dt>Insufficient</dt><dd>${escapeHtml(strategyFactory.insufficient_count)}</dd></div>
        <div><dt>Rejected</dt><dd>${escapeHtml(strategyFactory.rejected_count)}</dd></div>
        <div><dt>Adaptive tuning</dt><dd>${escapeHtml(strategyFactory.adaptive_tuning_allowed)}</dd></div>
        <div><dt>Promotion performed</dt><dd>${escapeHtml(strategyFactory.promotion_performed)}</dd></div>
        ${factoryRows}
      </dl>
    </section>` : `
    <section>
      <h2>Controlled Strategy Factory</h2>
      <p>No immutable candidate batch has been commissioned yet.</p>
    </section>`;
  const selectionRankingRows = championSelection?.ranking?.map((entry) => `
        <div><dt>${escapeHtml(entry.candidate_id)}</dt><dd>${escapeHtml(entry.selected_role)} · rank ${escapeHtml(entry.rank_position)} · score ${escapeHtml(entry.score)}</dd></div>`).join("") || "";
  const selectionMarkup = championSelection ? `
    <section>
      <h2>Champion / Challenger Selection</h2>
      <p>Only hostile-judge-qualified candidates are eligible. No fallback selection, paper execution, scheduling, or live capital occurs here.</p>
      <dl>
        <div><dt>State</dt><dd>${escapeHtml(championSelection.state)}</dd></div>
        <div><dt>Champion</dt><dd>${escapeHtml(championSelection.champion_candidate_id || "none")}</dd></div>
        <div><dt>Challengers</dt><dd>${escapeHtml(championSelection.challenger_candidate_ids.join(", ") || "none")}</dd></div>
        <div><dt>Eligible candidates</dt><dd>${escapeHtml(championSelection.eligible_count)}</dd></div>
        <div><dt>Blockers</dt><dd>${escapeHtml(championSelection.blocker_codes.join(", ") || "none")}</dd></div>
        <div><dt>Paper execution started</dt><dd>${escapeHtml(championSelection.paper_execution_started)}</dd></div>
        <div><dt>Scheduling started</dt><dd>${escapeHtml(championSelection.scheduling_started)}</dd></div>
        ${selectionRankingRows}
      </dl>
    </section>` : `
    <section>
      <h2>Champion / Challenger Selection</h2>
      <p>No immutable selection batch has been commissioned yet.</p>
    </section>`;
  const forwardCycle = forwardOperation?.latest_cycle || null;
  const schedulerReceipt = forwardOperation?.latest_scheduler_receipt || null;
  const forwardMarkup = forwardOperation ? `
    <section>
      <h2>Autonomous Forward Paper Operation</h2>
      <p>Hourly paper-only operation. Market ingestion runs before the forward gate. No qualified champion means a durable idle cycle, not a fallback trade.</p>
      <dl>
        <div><dt>Latest cycle</dt><dd>${escapeHtml(forwardCycle?.cycle_id || "none")}</dd></div>
        <div><dt>Cycle state</dt><dd>${escapeHtml(forwardCycle?.state || "none")}</dd></div>
        <div><dt>Expected close</dt><dd>${escapeHtml(forwardCycle?.expected_closed_at || "none")}</dd></div>
        <div><dt>Champion</dt><dd>${escapeHtml(forwardCycle?.champion_candidate_id || "none")}</dd></div>
        <div><dt>Blockers</dt><dd>${escapeHtml(forwardCycle?.blocker_codes?.join(", ") || "none")}</dd></div>
        <div><dt>Latest scheduler receipt</dt><dd>${escapeHtml(schedulerReceipt?.scheduler_receipt_id || "none")}</dd></div>
        <div><dt>Scheduler ingestion</dt><dd>${escapeHtml(schedulerReceipt ? schedulerReceipt.ingestion_ok : "not yet proven")}</dd></div>
        <div><dt>Paper only</dt><dd>true</dd></div>
        <div><dt>Live capital</dt><dd>false</dd></div>
      </dl>
    </section>` : `
    <section>
      <h2>Autonomous Forward Paper Operation</h2>
      <p>No forward cycle has been commissioned yet.</p>
    </section>`;
  const qualificationMarkup = liveQualification ? `
    <section>
      <h2>Live-Capital Evidence Qualification</h2>
      <p>Evidence eligibility only. This system cannot approve, fund, credential, authorize, or execute live capital.</p>
      <dl>
        <div><dt>State</dt><dd>${escapeHtml(liveQualification.state)}</dd></div>
        <div><dt>Champion</dt><dd>${escapeHtml(liveQualification.champion_candidate_id || "none")}</dd></div>
        <div><dt>Passed gates</dt><dd>${escapeHtml(liveQualification.passed_gate_count)}</dd></div>
        <div><dt>Failed gates</dt><dd>${escapeHtml(liveQualification.failed_gate_count)}</dd></div>
        <div><dt>Blockers</dt><dd>${escapeHtml(liveQualification.blocker_codes?.join(", ") || "none")}</dd></div>
        <div><dt>Owner approval required</dt><dd>true</dd></div>
        <div><dt>Owner approval present</dt><dd>false</dd></div>
        <div><dt>Live authorized</dt><dd>false</dd></div>
      </dl>
    </section>` : `
    <section>
      <h2>Live-Capital Evidence Qualification</h2>
      <p>No immutable qualification assessment has been commissioned yet.</p>
    </section>`;
  const rollingEpoch = rollingResearch?.latest_epoch || null;
  const rollingReceipt = rollingResearch?.latest_scheduler_receipt || null;
  const rollingMarkup = rollingResearch ? `
    <section>
      <h2>Autonomous Rolling Research</h2>
      <p>One immutable epoch per UTC date. The fixed eight-strategy catalog runs only after 720 contiguous completed candles and after the current forward and qualification cycle.</p>
      <dl>
        <div><dt>Latest epoch</dt><dd>${escapeHtml(rollingEpoch?.epoch_id || "none")}</dd></div>
        <div><dt>Epoch state</dt><dd>${escapeHtml(rollingEpoch?.state || "not yet run")}</dd></div>
        <div><dt>Available candles</dt><dd>${escapeHtml(rollingEpoch?.available_candle_count ?? 0)}</dd></div>
        <div><dt>Required candles</dt><dd>${escapeHtml(rollingEpoch?.required_candle_count ?? 720)}</dd></div>
        <div><dt>Blockers</dt><dd>${escapeHtml(rollingEpoch?.blocker_codes?.join(", ") || "none")}</dd></div>
        <div><dt>Selection</dt><dd>${escapeHtml(rollingEpoch?.selection_batch_id || "none")}</dd></div>
        <div><dt>Champion</dt><dd>${escapeHtml(rollingEpoch?.champion_candidate_id || "none")}</dd></div>
        <div><dt>Scheduler receipt</dt><dd>${escapeHtml(rollingReceipt?.scheduler_receipt_id || "none")}</dd></div>
        <div><dt>Catalog mutable</dt><dd>false</dd></div>
        <div><dt>Live capital</dt><dd>false</dd></div>
      </dl>
    </section>` : `
    <section>
      <h2>Autonomous Rolling Research</h2>
      <p>No rolling-research epoch has been recorded yet.</p>
    </section>`;
  const bootstrapProgress = historicalBootstrap?.progress || null;
  const bootstrapAttempt = historicalBootstrap?.latest_attempt || null;
  const bootstrapMarkup = historicalBootstrap ? `
    <section>
      <h2>Historical Research Bootstrap</h2>
      <p>Backward-only ingestion of completed BTC-USD hourly candles. No synthetic interpolation, paid data, research artifacts, or live capital.</p>
      <dl>
        <div><dt>State</dt><dd>${escapeHtml(bootstrapProgress?.state || "unknown")}</dd></div>
        <div><dt>Contiguous candles</dt><dd>${escapeHtml(bootstrapProgress?.contiguous_candle_count ?? 0)}</dd></div>
        <div><dt>Target candles</dt><dd>${escapeHtml(bootstrapProgress?.target_contiguous_candles ?? 720)}</dd></div>
        <div><dt>Remaining candles</dt><dd>${escapeHtml(bootstrapProgress?.remaining_candles ?? 720)}</dd></div>
        <div><dt>Earliest contiguous close</dt><dd>${escapeHtml(bootstrapProgress?.earliest_contiguous_closed_at || "none")}</dd></div>
        <div><dt>Latest attempt</dt><dd>${escapeHtml(bootstrapAttempt?.attempt_id || "none")}</dd></div>
        <div><dt>Attempt state</dt><dd>${escapeHtml(bootstrapAttempt?.state || "not yet run")}</dd></div>
        <div><dt>Blockers</dt><dd>${escapeHtml(bootstrapProgress?.blocker_codes?.join(", ") || bootstrapAttempt?.blocker_codes?.join(", ") || "none")}</dd></div>
        <div><dt>Synthetic data</dt><dd>false</dd></div>
        <div><dt>Live capital</dt><dd>false</dd></div>
      </dl>
    </section>` : `
    <section>
      <h2>Historical Research Bootstrap</h2>
      <p>No bootstrap progress has been recorded yet.</p>
    </section>`;
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
    ${paperMarkup}
    ${baselineMarkup}
    ${judgeMarkup}
    ${factoryMarkup}
    ${selectionMarkup}
    ${forwardMarkup}
    ${qualificationMarkup}
    ${rollingMarkup}
    ${bootstrapMarkup}
    ${healthMarkup}
    ${latestMarkup}
  </main>
</body>
</html>`;
}

async function marketDataHealthForHome(env) {
  try {
    return await getMarketDataHealth(env);
  } catch {
    return null;
  }
}

async function latestCandleForHome(env) {
  try {
    return latestBtcUsdHourlyCandle(env);
  } catch {
    return null;
  }
}

async function recentCandlesForHome(env, limit = 96) {
  try {
    const result = await env.DB.prepare(
      `SELECT closed_at, open, high, low, close, volume, source
       FROM market_candles
       WHERE pair = ? AND interval = ?
       ORDER BY closed_at DESC
       LIMIT ?`,
    ).bind("BTC-USD", "1h", limit).all();
    const rows = Array.isArray(result?.results) ? result.results : [];
    return rows.reverse().map((row) => ({
      closed_at: row.closed_at,
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: Number(row.volume),
      source: row.source,
    }));
  } catch {
    return [];
  }
}

async function paperAccountForHome(env) {
  try {
    return await getPaperAccountSummary(env);
  } catch {
    return null;
  }
}

async function baselineBenchForHome(env) {
  try {
    return await getBaselineBenchSummary(env);
  } catch {
    return null;
  }
}

async function hostileJudgeForHome(env) {
  try {
    return await getHostileJudgeSummary(env);
  } catch {
    return null;
  }
}

async function strategyFactoryForHome(env) {
  try {
    return await getStrategyFactorySummary(env);
  } catch {
    return null;
  }
}

async function championSelectionForHome(env) {
  try {
    return await getChampionSelectionSummary(env);
  } catch {
    return null;
  }
}

async function forwardOperationForHome(env) {
  try {
    return await getForwardOperationSummary(env);
  } catch {
    return null;
  }
}

async function liveQualificationForHome(env) {
  try {
    return await getLiveQualificationSummary(env);
  } catch {
    return null;
  }
}

async function rollingResearchForHome(env) {
  try {
    return await getRollingResearchSummary(env);
  } catch {
    return null;
  }
}

async function historicalBootstrapForHome(env) {
  try {
    return await getHistoricalBootstrapSummary(env);
  } catch {
    return null;
  }
}

async function directionalShadowForHome(env) {
  try {
    return await getDirectionalShadowSummary(env);
  } catch {
    return null;
  }
}

async function directionalResearchForHome(env) {
  try {
    return await getDirectionalInstitutionalResearchSummary(env);
  } catch {
    return null;
  }
}

async function institutionalResearchPortfolioForHome(env) {
  try {
    return await getInstitutionalResearchPortfolioSummary(env);
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
      paperAccount: {
        anyOf: [
          { type: "null" },
          { type: "object", additionalProperties: true },
        ],
      },
      baselineBench: {
        anyOf: [
          { type: "null" },
          { type: "object", additionalProperties: true },
        ],
      },
      hostileJudge: {
        anyOf: [
          { type: "null" },
          { type: "object", additionalProperties: true },
        ],
      },
      strategyFactory: {
        anyOf: [
          { type: "null" },
          { type: "object", additionalProperties: true },
        ],
      },
      championSelection: {
        anyOf: [
          { type: "null" },
          { type: "object", additionalProperties: true },
        ],
      },
      forwardOperation: {
        anyOf: [
          { type: "null" },
          { type: "object", additionalProperties: true },
        ],
      },
      liveQualification: {
        anyOf: [
          { type: "null" },
          { type: "object", additionalProperties: true },
        ],
      },
      rollingResearch: {
        anyOf: [
          { type: "null" },
          { type: "object", additionalProperties: true },
        ],
      },
      historicalBootstrap: {
        anyOf: [
          { type: "null" },
          { type: "object", additionalProperties: true },
        ],
      },
      directionalShadow: {
        anyOf: [
          { type: "null" },
          { type: "object", additionalProperties: true },
        ],
      },
      directionalResearch: {
        anyOf: [
          { type: "null" },
          { type: "object", additionalProperties: true },
        ],
      },
      dataHealth: {
        anyOf: [
          { type: "null" },
          {
            type: "object",
            additionalProperties: true,
            properties: {
              status: { type: "string" },
              latest_closed_at: { anyOf: [{ type: "null" }, { type: "string" }] },
              expected_latest_closed_at: { type: "string" },
              stale_hours: { anyOf: [{ type: "null" }, { type: "number" }] },
              missing_candles: { type: "number" },
              last_attempt_at: { anyOf: [{ type: "null" }, { type: "string" }] },
              last_success_at: { anyOf: [{ type: "null" }, { type: "string" }] },
              last_error: { anyOf: [{ type: "null" }, { type: "string" }] },
            },
            required: ["status", "expected_latest_closed_at", "missing_candles"],
          },
        ],
      },
    },
    required: [
      "ok",
      "system",
      "environment",
      "workerStatus",
      "databaseConnected",
      "latestDeploymentSha",
      "currentPhase",
      "dataHealth",
      "paperAccount",
      "baselineBench",
      "hostileJudge",
      "strategyFactory",
      "championSelection",
      "forwardOperation",
      "liveQualification",
      "rollingResearch",
      "historicalBootstrap",
      "directionalShadow",
      "directionalResearch",
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

function brandAsset(asset) {
  const bytes = Uint8Array.from(atob(asset.base64), (character) => character.charCodeAt(0));
  return new Response(bytes, {
    headers: {
      "content-type": asset.contentType,
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
}

function webManifest() {
  return new Response(JSON.stringify(BRAND_MANIFEST), {
    headers: {
      "content-type": "application/manifest+json; charset=utf-8",
      "cache-control": "public, max-age=3600",
      "x-content-type-options": "nosniff",
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
