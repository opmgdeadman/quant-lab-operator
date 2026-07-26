import { resolveCapability, supportedIntents } from "./capabilityDirectory.js";
import { assertClientSafeInputs, boundResultBytes, ClientSafetyError } from "./clientSafeRequests.js";
import { handlers } from "./handlers/controlPlane.js";
import { fingerprintIntent, readReceipt, receiptSummary, writeAuditLog, writeReceipt } from "./receipts.js";

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

  const requestFingerprint = await fingerprintIntent(envelope.intent, envelope.inputs);
  const existing = await readReceipt(context.env, envelope.operation_id);
  if (existing) {
    if (existing.request_fingerprint !== requestFingerprint || existing.intent !== envelope.intent) {
      throw new ExecutionKernelError("idempotency_key_payload_mismatch");
    }
    const replayed = JSON.parse(existing.result_json);
    return {
      ...replayed,
      receipt: receiptSummary(existing, true),
    };
  }

  const now = new Date().toISOString();
  let response;
  let status = "completed";
  try {
    assertClientSafeInputs(envelope.inputs);
    validateAgainstSchema(envelope.inputs, capability.input_schema);
    const handler = handlers[capability.handler_id];
    if (!handler) {
      throw new ExecutionKernelError("handler_not_found");
    }
    const rawResult = await handler(envelope.inputs, context);
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
    });
    status = rawResult.ok === false ? "failed" : "completed";
  } catch (error) {
    status = "failed";
    response = buildResponse({
      ok: false,
      error: error instanceof ClientSafetyError || error instanceof ExecutionKernelError ? error.message : "execution_failed",
      intent: envelope.intent,
      operationId: envelope.operation_id,
      requestFingerprint,
      createdAt: now,
      capability,
      result: {},
      status: "blocked",
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

function buildResponse({ ok, error, intent, operationId, requestFingerprint, createdAt, capability, result, status }) {
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
    operator_action_closure: {
      status,
      evidence: [`capability:${capability.id}`, `handler:${capability.handler_id}`, `receipt:operator_receipt_${operationId}`],
      next_action: status === "completed" ? "continue_with_next_bounded_intent" : "repair_or_adjust_inputs",
    },
    result,
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
