let activeCtx;
const pendingWrites = new Set();

export function setFleetTelemetryContext(ctx) {
  activeCtx = ctx;
}

export async function traceQuantTool(runtimeEnv, toolName, suppliedTraceId, args, operation) {
  const startedAt = new Date().toISOString();
  const startedPerf = performance.now();
  const traceId = normalizeTraceId(suppliedTraceId) ?? `quant-lab:${crypto.randomUUID()}`;
  const spanId = crypto.randomUUID();
  const requestBytes = byteLength(args);

  try {
    const result = await operation();
    const durationMs = roundMs(performance.now() - startedPerf);
    const finishedAt = new Date().toISOString();
    scheduleTelemetry(runtimeEnv.TELEMETRY_DB, {
      traceId, spanId, mcpName: "quant-lab", toolName, startedAt, finishedAt,
      durationMs, outcome: "SUCCESS", requestBytes, responseBytes: byteLength(result),
      errorClass: null, errorMessage: null,
    });
    return attachReceipt(result, { trace_id: traceId, span_id: spanId, duration_ms: durationMs, capture_mode: "async" });
  } catch (error) {
    const durationMs = roundMs(performance.now() - startedPerf);
    scheduleTelemetry(runtimeEnv.TELEMETRY_DB, {
      traceId, spanId, mcpName: "quant-lab", toolName, startedAt, finishedAt: new Date().toISOString(),
      durationMs, outcome: "FAILURE", requestBytes, responseBytes: null,
      errorClass: error instanceof Error ? error.name : "Error", errorMessage: toErrorMessage(error).slice(0, 400),
    });
    throw error;
  }
}

export async function flushFleetTelemetryWrites() {
  await Promise.allSettled([...pendingWrites]);
}

export async function runQuantTimingTelemetryCertification(runtimeEnv, runId) {
  if (!runtimeEnv?.TELEMETRY_DB) throw new Error("telemetry_db_binding_missing");
  if (typeof runId !== "string" || !runId.trim() || runId.trim().length > 120) throw new Error("invalid_timing_cert_run_id");
  const traceId = `quant-lab-timing-cert:${runId.trim()}`.slice(0, 128);
  const first = await traceQuantTool(runtimeEnv, "fleet_timing_cert_a", traceId, { certification_run_id: runId.trim() }, async () => ({ ok: true, probe: "a" }));
  const second = await traceQuantTool(runtimeEnv, "fleet_timing_cert_b", traceId, { certification_run_id: runId.trim() }, async () => ({ ok: true, probe: "b" }));
  await flushFleetTelemetryWrites();

  const trace = await runtimeEnv.TELEMETRY_DB.prepare("SELECT trace_id, call_count, total_tool_ms, failure_count, retain_class, expires_at FROM telemetry_traces WHERE trace_id = ?")
    .bind(traceId).first();
  const spanRows = await runtimeEnv.TELEMETRY_DB.prepare("SELECT span_id, trace_id, mcp_name, tool_name, duration_ms, outcome, request_bytes, response_bytes, error_class, error_message FROM telemetry_spans WHERE trace_id = ? ORDER BY started_at, span_id")
    .bind(traceId).all();
  const spans = Array.isArray(spanRows?.results) ? spanRows.results : [];
  const matching = spans.filter((row) => row.trace_id === traceId && row.mcp_name === "quant-lab" && ["fleet_timing_cert_a", "fleet_timing_cert_b"].includes(row.tool_name));
  const receiptA = first?._telemetry;
  const receiptB = second?._telemetry;
  const pass = receiptA?.trace_id === traceId
    && receiptB?.trace_id === traceId
    && receiptA?.span_id
    && receiptB?.span_id
    && receiptA.span_id !== receiptB.span_id
    && Number(trace?.call_count ?? 0) >= 2
    && Number(trace?.failure_count ?? 0) === 0
    && matching.length >= 2
    && matching.every((row) => row.outcome === "SUCCESS" && Number.isFinite(Number(row.duration_ms)) && Number(row.request_bytes) >= 0 && Number(row.response_bytes) >= 0);

  return {
    ok: Boolean(pass),
    standard: "fleet-timing-telemetry-standard-v1",
    run_id: runId.trim(),
    trace_id: traceId,
    receipts: [receiptA, receiptB],
    persisted_trace: trace ?? null,
    persisted_span_count: matching.length,
    persisted_spans: matching,
    raw_arguments_stored: false,
    raw_results_stored: false,
    result: pass ? "CERTIFICATION_PASS" : "CERTIFICATION_FAIL",
  };
}

function scheduleTelemetry(db, event) {
  const task = persistTelemetry(db, event).catch((error) => {
    console.error("quant_lab_telemetry_write_failed", toErrorMessage(error).slice(0, 300));
  }).finally(() => pendingWrites.delete(task));
  pendingWrites.add(task);
  if (activeCtx) activeCtx.waitUntil(task);
}

async function persistTelemetry(db, event) {
  if (!db) throw new Error("telemetry_db_binding_missing");
  const expiresAt = new Date(Date.parse(event.finishedAt) + 7 * 86400000).toISOString();
  const bucketDate = event.startedAt.slice(0, 10);
  const failed = event.outcome === "FAILURE" ? 1 : 0;
  await db.batch([
    db.prepare(`INSERT INTO telemetry_traces (trace_id, first_seen_at, last_seen_at, source_client, call_count, total_tool_ms, failure_count, retain_class, expires_at)
      VALUES (?, ?, ?, 'chatgpt', 1, ?, ?, 'ephemeral', ?)
      ON CONFLICT(trace_id) DO UPDATE SET last_seen_at = excluded.last_seen_at, call_count = telemetry_traces.call_count + 1,
      total_tool_ms = telemetry_traces.total_tool_ms + excluded.total_tool_ms, failure_count = telemetry_traces.failure_count + excluded.failure_count,
      expires_at = CASE WHEN telemetry_traces.retain_class = 'promoted' THEN NULL ELSE excluded.expires_at END`)
      .bind(event.traceId, event.startedAt, event.finishedAt, event.durationMs, failed, expiresAt),
    db.prepare(`INSERT INTO telemetry_spans (span_id, trace_id, mcp_name, tool_name, started_at, finished_at, duration_ms, outcome, request_bytes, response_bytes, error_class, error_message, retain_class, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ephemeral', ?, ?)`)
      .bind(event.spanId, event.traceId, event.mcpName, event.toolName, event.startedAt, event.finishedAt, event.durationMs, event.outcome, event.requestBytes, event.responseBytes, event.errorClass, event.errorMessage, expiresAt, event.finishedAt),
    db.prepare(`INSERT INTO telemetry_action_rollups (mcp_name, tool_name, bucket_date, calls, failures, total_ms, max_ms, request_bytes, response_bytes)
      VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)
      ON CONFLICT(mcp_name, tool_name, bucket_date) DO UPDATE SET calls = telemetry_action_rollups.calls + 1,
      failures = telemetry_action_rollups.failures + excluded.failures, total_ms = telemetry_action_rollups.total_ms + excluded.total_ms,
      max_ms = MAX(telemetry_action_rollups.max_ms, excluded.max_ms), request_bytes = telemetry_action_rollups.request_bytes + excluded.request_bytes,
      response_bytes = telemetry_action_rollups.response_bytes + excluded.response_bytes`)
      .bind(event.mcpName, event.toolName, bucketDate, failed, event.durationMs, event.durationMs, event.requestBytes, event.responseBytes ?? 0),
  ]);
}

function attachReceipt(value, receipt) {
  if (value && typeof value === "object" && !Array.isArray(value)) return { ...value, _telemetry: receipt };
  return { result: value, _telemetry: receipt };
}
function normalizeTraceId(value) { if (typeof value !== "string") return null; const trimmed = value.trim(); return trimmed ? trimmed.slice(0, 128) : null; }
function byteLength(value) { try { return new TextEncoder().encode(JSON.stringify(value) ?? "").byteLength; } catch { return 0; } }
function roundMs(value) { return Math.round(value * 1000) / 1000; }
function toErrorMessage(error) { return error instanceof Error ? error.message : String(error); }
