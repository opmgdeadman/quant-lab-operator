import { resolveCapability, supportedIntents } from "./capabilityDirectory.js";
import { assertClientSafeInputs, boundResultBytes, ClientSafetyError } from "./clientSafeRequests.js";
import { handlers } from "./handlers/controlPlane.js";
import {
  beginOperationReceipt,
  fingerprintIntent,
  operationLeaseMs,
  recordIncident,
  receiptSummary,
  writeAuditLog,
  writeReceipt,
} from "./receipts.js";
import { REQUIRED_GOVERNING_AUTHORITY_ACK } from "./startupAuthority.js";

export const executionKernelInfo = {
  name: "Quant Lab Execution Kernel",
  version: "quant-lab-execution-kernel-v1",
};

export async function executeQuantLabIntent(args, context) {
  const envelope = validateEnvelope(args);
  const capability = resolveCapability(envelope.intent);
  if (!capability) {
    throw new ExecutionKernelError("unknown_intent");
  }

  const capabilityInputs = validateStartupAuthority(envelope.inputs, context.startupContext);
  const requestFingerprint = await fingerprintIntent(envelope.intent, envelope.inputs);
  const now = new Date().toISOString();
  const receiptState = await beginOperationReceipt(context.env, {
    operation_id: envelope.operation_id,
    intent: envelope.intent,
    request_fingerprint: requestFingerprint,
    created_at: now,
    lease_ms: operationLeaseMs(envelope.intent),
  });

  if (receiptState.state === "mismatch") {
    throw new ExecutionKernelError("idempotency_key_payload_mismatch");
  }
  if (receiptState.state === "replay") {
    const replayed = JSON.parse(receiptState.receipt.result_json);
    return {
      ...replayed,
      receipt: receiptSummary(receiptState.receipt, true),
    };
  }
  if (receiptState.state === "in_progress") {
    return buildResponse({
      ok: false,
      error: "operation_already_in_progress",
      intent: envelope.intent,
      operationId: envelope.operation_id,
      requestFingerprint,
      createdAt: receiptState.receipt.created_at,
      capability,
      result: { retryable_after_seconds: receiptState.retryable_after_seconds },
      status: "blocked",
      startupContext: context.startupContext,
    });
  }

  let response;
  let status = "completed";
  let incident = null;
  try {
    assertClientSafeInputs(capabilityInputs);
    validateAgainstSchema(capabilityInputs, capability.input_schema);
    const handler = handlers[capability.handler_id];
    if (!handler) {
      throw new ExecutionKernelError("handler_not_found");
    }
    const rawResult = await handler(capabilityInputs, context);
    const structuredFailure = classifyStructuredFailure(rawResult);
    if (structuredFailure.incident_required) {
      incident = await safeRecordIncident(context.env, {
        operation_id: envelope.operation_id,
        intent: envelope.intent,
        error: structuredFailure.code,
        created_at: now,
      });
    }
    const boundedResult = boundResultBytes(rawResult, capability.max_response_bytes);
    response = buildResponse({
      ok: rawResult.ok !== false,
      intent: envelope.intent,
      operationId: envelope.operation_id,
      requestFingerprint,
      createdAt: now,
      capability,
      result: boundedResult,
      status: rawResult.ok === false ? "blocked" : "completed",
      startupContext: context.startupContext,
      incident,
    });
    status = rawResult.ok === false ? "failed" : "completed";
  } catch (error) {
    status = "failed";
    const controlledFailure = error instanceof ClientSafetyError || error instanceof ExecutionKernelError;
    if (!controlledFailure) {
      incident = await safeRecordIncident(context.env, {
        operation_id: envelope.operation_id,
        intent: envelope.intent,
        error: error instanceof Error ? error.message : String(error),
        created_at: now,
      });
    }
    response = buildResponse({
      ok: false,
      error: controlledFailure ? error.message : "execution_failed",
      intent: envelope.intent,
      operationId: envelope.operation_id,
      requestFingerprint,
      createdAt: now,
      capability,
      result: {},
      status: "blocked",
      startupContext: context.startupContext,
      incident,
    });
  }

  await writeReceipt(context.env, {
    operation_id: envelope.operation_id,
    intent: envelope.intent,
    request_fingerprint: requestFingerprint,
    status,
    result: response,
    created_at: now,
    updated_at: now,
  });
  await writeAuditLog(context.env, {
    id: `operator_audit_${envelope.operation_id}`,
    operation_id: envelope.operation_id,
    intent: envelope.intent,
    status,
    summary: response.operator_action_closure.status,
    created_at: now,
  });

  return response;
}

function validateStartupAuthority(inputs, startupContext) {
  if (!startupContext?.ok) {
    throw new ExecutionKernelError("quant_startup_context_unavailable");
  }
  if (inputs.governing_authority_ack !== REQUIRED_GOVERNING_AUTHORITY_ACK) {
    throw new ExecutionKernelError("governing_authority_ack_required");
  }
  if (typeof inputs.mbrain_work_unit_id !== "string" || inputs.mbrain_work_unit_id.length < 1 || inputs.mbrain_work_unit_id.length > 120) {
    throw new ExecutionKernelError("mbrain_work_unit_id_required");
  }
  startupContext.operational_authority = {
    ...(startupContext.operational_authority || {}),
    active_work_unit_id: inputs.mbrain_work_unit_id,
  };
  const capabilityInputs = { ...inputs };
  delete capabilityInputs.governing_authority_ack;
  delete capabilityInputs.mbrain_work_unit_id;
  return capabilityInputs;
}

function buildResponse({ ok, error, intent, operationId, requestFingerprint, createdAt, capability, result, status, startupContext, incident = null }) {
  return {
    ok,
    ...(error ? { error } : {}),
    intent,
    operation_id: operationId,
    receipt: {
      receipt_id: `operator_receipt_${operationId}`,
      replayed: false,
      request_fingerprint: requestFingerprint,
      created_at: createdAt,
    },
    execution_kernel: {
      ...executionKernelInfo,
      capability_id: capability.id,
      handler_id: capability.handler_id,
      model_tool_choice_allowed: false,
      arbitrary_shell_allowed: false,
      arbitrary_sql_allowed: false,
    },
    operator_action_closure: buildActionClosure({
      status,
      capability,
      operationId,
      startupContext,
      incident,
    }),
    result,
  };
}

const EXPECTED_CONTROL_CODES = new Set([
  "forbidden_path",
  "invalid_exact_sha",
  "unsupported_workflow_id",
  "exact_match_count_not_one",
  "head_sha_mismatch",
  "not_available_in_worker_runtime",
  "github_token_not_configured",
  "operation_already_in_progress",
]);

export function classifyStructuredFailure(result) {
  if (result?.ok !== false) return { incident_required: false, code: null };
  const code = String(result.error || result.status || result.error_code || "").trim();
  if (!code) return { incident_required: false, code: "expected_empty_or_blocked_state" };
  if (EXPECTED_CONTROL_CODES.has(code) || code.startsWith("hardening_")) {
    return { incident_required: false, code };
  }
  return { incident_required: true, code };
}

async function safeRecordIncident(env, input) {
  try {
    return await recordIncident(env, input);
  } catch (error) {
    return {
      id: null,
      state: "recording_failed",
      error: error instanceof Error ? error.message : String(error),
      original_failure: input.error,
    };
  }
}

export function buildActionClosure({ status, capability, operationId, startupContext, incident = null }) {
  const workUnitId = startupContext?.operational_authority?.active_work_unit_id || null;
  return {
    status,
    authority: "m_brain_owner_approved_work_unit",
    mbrain_work_unit_id: workUnitId,
    startup_authority_path: startupContext?.startup_authority?.path || "docs/QUANT_LAB_STARTUP_AUTHORITY.md",
    startup_authority_sha: startupContext?.startup_authority?.sha || null,
    evidence: [`capability:${capability.id}`, `handler:${capability.handler_id}`, `receipt:operator_receipt_${operationId}`, `work_unit:${workUnitId || "missing"}`],
    hardening_incident_id: incident?.id || null,
    next_action: status === "completed"
      ? "continue_active_m_brain_work_unit"
      : "repair_root_cause_add_regression_validate_exact_sha_deploy_then_resume_active_m_brain_work_unit",
    owner_action_required: false,
  };
}

function validateEnvelope(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new ExecutionKernelError("invalid_envelope");
  }
  const allowed = new Set(["operation_id", "intent", "inputs"]);
  for (const key of Object.keys(args)) {
    if (!allowed.has(key)) {
      throw new ExecutionKernelError("unknown_envelope_field");
    }
  }
  if (typeof args.operation_id !== "string" || args.operation_id.length < 1 || args.operation_id.length > 120) {
    throw new ExecutionKernelError("invalid_operation_id");
  }
  if (!supportedIntents.includes(args.intent)) {
    throw new ExecutionKernelError("unknown_intent");
  }
  if (!args.inputs || typeof args.inputs !== "object" || Array.isArray(args.inputs)) {
    throw new ExecutionKernelError("invalid_inputs");
  }
  return args;
}

function validateAgainstSchema(value, schema) {
  const allowed = new Set(Object.keys(schema.properties || {}));
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new ExecutionKernelError("unsupported_input_key");
    }
  }
  for (const key of schema.required || []) {
    if (!Object.hasOwn(value, key)) {
      throw new ExecutionKernelError(`missing_${key}`);
    }
  }
}

export class ExecutionKernelError extends Error {}
