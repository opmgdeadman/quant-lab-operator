import { redactValue } from "./clientSafeRequests.js";

export async function fingerprintIntent(intent, inputs) {
  const encoded = new TextEncoder().encode(stableJson({ intent, inputs }));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return `sha256:${base64UrlEncode(new Uint8Array(digest))}`;
}

export function operationLeaseMs(intent) {
  if (/^(run_|deploy_|apply_d1_migrations|trigger_github_workflow)/.test(intent)) return 30 * 60 * 1000;
  if (intent === "monitor_github_workflow") return 5 * 60 * 1000;
  return 15 * 60 * 1000;
}

export async function readReceipt(env, operationId) {
  return env.DB.prepare(
    "SELECT operation_id, tool_name, intent, request_fingerprint, status, result_json, created_at, updated_at FROM operator_operation_receipts WHERE operation_id = ?",
  ).bind(operationId).first();
}

export async function beginOperationReceipt(env, input) {
  const inserted = await env.DB.prepare(
    `INSERT OR IGNORE INTO operator_operation_receipts (
      operation_id, tool_name, intent, request_fingerprint, status, result_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'started', '{}', ?, ?)`,
  ).bind(
    input.operation_id,
    input.intent,
    input.intent,
    input.request_fingerprint,
    input.created_at,
    input.created_at,
  ).run();
  if (Number(inserted.meta?.changes || 0) > 0) {
    return { state: "acquired", stale_recovered: false };
  }

  let existing = await readReceipt(env, input.operation_id);
  if (!existing) {
    throw new Error("operation_receipt_race_unresolved");
  }
  if (existing.request_fingerprint !== input.request_fingerprint || existing.intent !== input.intent) {
    return { state: "mismatch", receipt: existing };
  }
  if (existing.status === "completed" || existing.status === "failed") {
    return { state: "replay", receipt: existing };
  }

  const updatedAt = Date.parse(existing.updated_at || existing.created_at || "");
  const ageMs = Number.isFinite(updatedAt) ? Math.max(0, Date.now() - updatedAt) : 0;
  if (existing.status === "started" && ageMs < input.lease_ms) {
    return {
      state: "in_progress",
      receipt: existing,
      retryable_after_seconds: Math.max(1, Math.ceil((input.lease_ms - ageMs) / 1000)),
    };
  }

  const takeover = await env.DB.prepare(
    `UPDATE operator_operation_receipts
     SET status = 'started', result_json = '{}', created_at = ?, updated_at = ?
     WHERE operation_id = ? AND status = 'started' AND updated_at = ?`,
  ).bind(input.created_at, input.created_at, input.operation_id, existing.updated_at).run();
  if (Number(takeover.meta?.changes || 0) > 0) {
    return { state: "acquired", stale_recovered: true };
  }

  existing = await readReceipt(env, input.operation_id);
  if (!existing) throw new Error("operation_receipt_race_unresolved");
  if (existing.request_fingerprint !== input.request_fingerprint || existing.intent !== input.intent) {
    return { state: "mismatch", receipt: existing };
  }
  if (existing.status === "completed" || existing.status === "failed") {
    return { state: "replay", receipt: existing };
  }
  return { state: "in_progress", receipt: existing, retryable_after_seconds: 1 };
}

export async function writeReceipt(env, receipt) {
  await env.DB.prepare(
    `INSERT INTO operator_operation_receipts (
      operation_id, tool_name, intent, request_fingerprint, status, result_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(operation_id) DO UPDATE SET
      tool_name = excluded.tool_name,
      intent = excluded.intent,
      request_fingerprint = excluded.request_fingerprint,
      status = excluded.status,
      result_json = excluded.result_json,
      updated_at = excluded.updated_at`,
  ).bind(
    receipt.operation_id,
    receipt.intent,
    receipt.intent,
    receipt.request_fingerprint,
    receipt.status,
    JSON.stringify(redactValue(receipt.result)),
    receipt.created_at,
    receipt.updated_at,
  ).run();
}

export async function recordIncident(env, input) {
  const signature = await fingerprintIntent("hardening_incident", {
    intent: input.intent,
    error: input.error,
  });
  const id = `operator_hardening_${signature.slice(7, 31)}`;
  const summary = String(redactValue(`Unexpected ${input.intent} failure: ${input.error}`)).slice(0, 1000);
  const observed = redactValue({ error: input.error, operation_id: input.operation_id, intent: input.intent });
  const resumeCapsule = { operation_id: input.operation_id, intent: input.intent };
  await env.DB.prepare(
    `INSERT INTO operator_hardening_incidents (
      id, signature, operation_id, intent, severity, state, summary, observed_json,
      resume_capsule_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'P1', 'open', ?, ?, ?, ?, ?)
    ON CONFLICT(signature) DO UPDATE SET
      operation_id = excluded.operation_id,
      summary = excluded.summary,
      observed_json = excluded.observed_json,
      resume_capsule_json = excluded.resume_capsule_json,
      updated_at = excluded.updated_at`,
  ).bind(
    id,
    signature,
    input.operation_id,
    input.intent,
    summary,
    JSON.stringify(observed),
    JSON.stringify(resumeCapsule),
    input.created_at,
    input.created_at,
  ).run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO operator_hardening_incident_events (
      id, incident_id, from_state, to_state, evidence_json, created_at
    ) VALUES (?, ?, NULL, 'open', ?, ?)`,
  ).bind(`operator_hardening_event_${id}_open`, id, JSON.stringify(observed), input.created_at).run();
  return {
    id,
    signature,
    severity: "P1",
    state: "open",
    next_action: "diagnose_root_cause_and_generalize_prevention",
  };
}

export async function writeAuditLog(env, entry) {
  await env.DB.prepare(
    "INSERT INTO operator_audit_log (id, operation_id, intent, status, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(entry.id, entry.operation_id, entry.intent, entry.status, entry.summary, entry.created_at).run();
}

export function receiptSummary(row, replayed = false) {
  return {
    receipt_id: `operator_receipt_${row.operation_id}`,
    replayed,
    request_fingerprint: row.request_fingerprint,
    created_at: row.created_at,
  };
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
