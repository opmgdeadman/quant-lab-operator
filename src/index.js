const SYSTEM_NAME = "Quant Lab";

export async function handleRequest(request, env) {
  const url = new URL(request.url);
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
  const header = request.headers.get("authorization") || "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
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
