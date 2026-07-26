import { redactValue } from "./clientSafeRequests.js";

export async function fingerprintIntent(intent, inputs) {
  const encoded = new TextEncoder().encode(stableJson({ intent, inputs }));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return `sha256:${base64UrlEncode(new Uint8Array(digest))}`;
}

export async function readReceipt(env, operationId) {
  return env.DB.prepare(
    "SELECT operation_id, intent, request_fingerprint, status, result_json, created_at, updated_at FROM operator_operation_receipts WHERE operation_id = ?",
  ).bind(operationId).first();
}

export async function writeReceipt(env, receipt) {
  await env.DB.prepare(
    `INSERT INTO operator_operation_receipts (
      operation_id, tool_name, intent, request_fingerprint, status, result_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(operation_id) DO UPDATE SET updated_at = excluded.updated_at`,
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
