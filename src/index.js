const SYSTEM_NAME = "Quant Lab";

export async function handleRequest(request, env) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (url.pathname === "/mcp") {
    return handleMcpRequest(request, env);
  }
  if (request.method !== "GET") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }
  if (url.pathname === "/") {
    const status = await statusPayload(env);
    return html(renderHome(status));
  }
  if (url.pathname === "/status") {
    return json(await publicStatusPayload(env));
  }
  if (url.pathname === "/openapi.json") {
    return json(openApiSpec(request));
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

async function handleMcpRequest(request, env) {
  if (request.method === "GET") {
    return json({
      ok: true,
      protocol: "mcp",
      transport: "streamable-http",
      endpoint: "/mcp",
      tools: ["get_quant_lab_status"],
    });
  }
  if (request.method !== "POST") {
    return mcpError(null, -32600, "Only GET and POST are supported for MCP");
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
      const response = await mcpResponseFor(item, env);
      if (response !== null) {
        responses.push(response);
      }
    }
    return mcpJson(responses);
  }

  const response = await mcpResponseFor(message, env);
  if (response === null) {
    return new Response(null, { status: 202, headers: corsHeaders() });
  }
  return mcpJson(response);
}

async function mcpResponseFor(message, env) {
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return mcpErrorObject(message?.id ?? null, -32600, "Invalid JSON-RPC request");
  }

  const id = Object.hasOwn(message, "id") ? message.id : undefined;
  const isNotification = id === undefined;

  if (message.method === "initialize") {
    if (isNotification) {
      return null;
    }
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "quant-lab", version: "0.1.0" },
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
    return {
      jsonrpc: "2.0",
      id,
      result: {
        tools: [
          {
            name: "get_quant_lab_status",
            title: "Get Quant Lab Status",
            description: "Return public, read-only Quant Lab infrastructure status. No trading actions or private strategy data.",
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
            inputSchema: {
              type: "object",
              additionalProperties: false,
              properties: {},
            },
            outputSchema: publicStatusSchema(),
          },
        ],
      },
    };
  }

  if (message.method === "tools/call") {
    if (isNotification) {
      return null;
    }
    const name = message.params?.name;
    if (name !== "get_quant_lab_status") {
      return mcpErrorObject(id, -32602, "Unknown tool");
    }
    const status = await publicStatusPayload(env);
    return {
      jsonrpc: "2.0",
      id,
      result: {
        content: [
          {
            type: "text",
            text: JSON.stringify(status, null, 2),
          },
        ],
        structuredContent: status,
      },
    };
  }

  return mcpErrorObject(id ?? null, -32601, "Method not found");
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

function renderHome(status) {
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
    dl { display: grid; grid-template-columns: minmax(130px, 220px) 1fr; gap: 10px 16px; padding: 20px 0; border-top: 1px solid #d0d5dd; border-bottom: 1px solid #d0d5dd; }
    dt { color: #667085; }
    dd { margin: 0; font-weight: 700; overflow-wrap: anywhere; }
    .ok { color: #067647; }
    .bad { color: #b42318; }
  </style>
</head>
<body>
  <main>
    <h1>${SYSTEM_NAME}</h1>
    <p>Infrastructure shell. Paper-trading laboratory foundations only. No trading claims, fake metrics, or live strategy display.</p>
    <dl>
      <dt>Environment</dt><dd>${escapeHtml(status.environment)}</dd>
      <dt>Worker status</dt><dd class="ok">${escapeHtml(status.workerStatus)}</dd>
      <dt>Database connectivity</dt><dd class="${status.databaseConnected ? "ok" : "bad"}">${status.databaseConnected ? "connected" : "not connected"}</dd>
      <dt>Latest deployment SHA</dt><dd>${escapeHtml(status.latestDeploymentSha)}</dd>
      <dt>Current phase</dt><dd>${escapeHtml(status.currentPhase)}</dd>
    </dl>
  </main>
</body>
</html>`;
}

function openApiSpec(request) {
  const origin = new URL(request.url).origin;
  return {
    openapi: "3.1.0",
    info: {
      title: "Quant Lab Infrastructure Shell",
      version: "0.1.0",
      description: "Read-only public status for the Quant Lab infrastructure shell. No trading actions.",
    },
    servers: [{ url: origin }],
    paths: {
      "/status": {
        get: {
          operationId: "getQuantLabStatus",
          summary: "Get Quant Lab infrastructure shell status",
          description: "Returns public, read-only infrastructure status with no trading claims or private strategy data.",
          responses: {
            "200": {
              description: "Current public infrastructure status",
              content: {
                "application/json": {
                  schema: {
                    ...publicStatusSchema(),
                  },
                },
              },
            },
          },
        },
      },
    },
  };
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

function mcpJson(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...corsHeaders(),
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
