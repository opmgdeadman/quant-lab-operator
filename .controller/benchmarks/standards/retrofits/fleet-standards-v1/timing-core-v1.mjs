export function createFleetTimingTelemetry(config) {
  const identity = Object.freeze({
    standard: "fleet-timing-telemetry-standard-v1",
    version: "1.0.0",
    implementation: "fleet-timing-telemetry-implementation-v1",
    mcp_name: config.mcp_name,
    central_store: config.central_store || "mcp-controller-audit",
    capture_mode: "async",
    raw_prompt_storage: false,
    raw_tool_argument_storage: false,
    raw_tool_result_storage: false
  });
  const retentionMs = Number(config.raw_retention_days || 7) * 86400000;

  async function traceTool(runtime, toolName, suppliedTraceId, businessArgs, operation) {
    const startedAt = new Date().toISOString();
    const startedPerf = performance.now();
    const traceId = normalizeTraceId(suppliedTraceId) || `${config.mcp_name}:${crypto.randomUUID()}`;
    const spanId = crypto.randomUUID();
    const requestBytes = byteLength(businessArgs);
    try {
      const value = await operation();
      const durationMs = roundMs(performance.now() - startedPerf);
      const finishedAt = new Date().toISOString();
      schedule(runtime, { traceId, spanId, mcpName: config.mcp_name, toolName, startedAt, finishedAt, durationMs, outcome: "SUCCESS", requestBytes, responseBytes: byteLength(value), errorClass: null, errorMessage: null });
      return attach(value, { trace_id: traceId, span_id: spanId, duration_ms: durationMs, capture_mode: "async" });
    } catch (error) {
      const durationMs = roundMs(performance.now() - startedPerf);
      const finishedAt = new Date().toISOString();
      schedule(runtime, { traceId, spanId, mcpName: config.mcp_name, toolName, startedAt, finishedAt, durationMs, outcome: "FAILURE", requestBytes, responseBytes: null, errorClass: error instanceof Error ? error.name : "Error", errorMessage: String(error instanceof Error ? error.message : error).slice(0, 400) });
      throw error;
    }
  }

  function schedule(runtime, event) {
    const db = runtime?.db;
    if (!db || typeof db.batch !== "function" || typeof db.prepare !== "function") return;
    const task = persist(db, event).catch(() => undefined);
    if (runtime?.ctx && typeof runtime.ctx.waitUntil === "function") runtime.ctx.waitUntil(task);
    else void task;
  }

  async function persist(db, event) {
    const expiresAt = new Date(Date.parse(event.finishedAt) + retentionMs).toISOString();
    const bucketDate = event.startedAt.slice(0, 10);
    const failed = event.outcome === "FAILURE" ? 1 : 0;
    await db.batch([
      db.prepare(`INSERT INTO telemetry_traces (trace_id,first_seen_at,last_seen_at,source_client,call_count,total_tool_ms,failure_count,retain_class,expires_at) VALUES (?,?,?,'chatgpt',1,?,?,'ephemeral',?) ON CONFLICT(trace_id) DO UPDATE SET last_seen_at=excluded.last_seen_at,call_count=telemetry_traces.call_count+1,total_tool_ms=telemetry_traces.total_tool_ms+excluded.total_tool_ms,failure_count=telemetry_traces.failure_count+excluded.failure_count,expires_at=CASE WHEN telemetry_traces.retain_class='promoted' THEN NULL ELSE excluded.expires_at END`).bind(event.traceId,event.startedAt,event.finishedAt,event.durationMs,failed,expiresAt),
      db.prepare(`INSERT INTO telemetry_spans (span_id,trace_id,mcp_name,tool_name,started_at,finished_at,duration_ms,outcome,request_bytes,response_bytes,error_class,error_message,retain_class,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'ephemeral',?,?)`).bind(event.spanId,event.traceId,event.mcpName,event.toolName,event.startedAt,event.finishedAt,event.durationMs,event.outcome,event.requestBytes,event.responseBytes,event.errorClass,event.errorMessage,expiresAt,event.finishedAt),
      db.prepare(`INSERT INTO telemetry_action_rollups (mcp_name,tool_name,bucket_date,calls,failures,total_ms,max_ms,request_bytes,response_bytes) VALUES (?,?,?,1,?,?,?,?,?) ON CONFLICT(mcp_name,tool_name,bucket_date) DO UPDATE SET calls=telemetry_action_rollups.calls+1,failures=telemetry_action_rollups.failures+excluded.failures,total_ms=telemetry_action_rollups.total_ms+excluded.total_ms,max_ms=MAX(telemetry_action_rollups.max_ms,excluded.max_ms),request_bytes=telemetry_action_rollups.request_bytes+excluded.request_bytes,response_bytes=telemetry_action_rollups.response_bytes+excluded.response_bytes`).bind(event.mcpName,event.toolName,bucketDate,failed,event.durationMs,event.durationMs,event.requestBytes,event.responseBytes || 0)
    ]);
  }

  return Object.freeze({ identity, traceTool });
}
function normalizeTraceId(value) { if (typeof value !== "string") return null; const t = value.trim(); return t ? t.slice(0, 128) : null; }
function byteLength(value) { try { return new TextEncoder().encode(JSON.stringify(value) || "").byteLength; } catch { return 0; } }
function roundMs(value) { return Math.round(value * 1000) / 1000; }
function attach(value, receipt) { return value && typeof value === "object" && !Array.isArray(value) ? { ...value, _telemetry: receipt } : { result: value, _telemetry: receipt }; }
