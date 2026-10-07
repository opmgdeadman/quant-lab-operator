import { objectSchema } from "./schemas.js";
import { REQUIRED_GOVERNING_AUTHORITY_ACK } from "./startupAuthority.js";

const capabilitySelectorSchema = {
  type: "string",
  minLength: 1,
  maxLength: 120,
  description: "Exact Quant Lab capability id or intent from get_quant_lab_capability_definition. Omit only when requesting the capability catalog rather than one exact capability definition.",
};
const traceIdSchema = {
  type: "string",
  minLength: 1,
  maxLength: 128,
  description: "Optional correlation id for one Quant Lab tool call. Reuse the same id across related calls in one owner turn when trace continuity is required.",
};
const dynamicArgumentsSchema = {
  type: "object",
  additionalProperties: true,
  description: "Capability-specific argument object. Populate only fields declared by the exact source-controlled input_schema returned for the selected capability; the server validates the current schema again before execution.",
};
const dynamicDefinitionOutputSchema = {
  type: "object",
  additionalProperties: true,
  description: "Descriptor-complete capability catalog or one exact capability definition, including operation class, canonical handler, input schema, output schema, risk gates, and server-owned execution metadata.",
};
const telemetryReceiptSchema = objectSchema({
  trace_id: { type: "string", minLength: 1, maxLength: 128, description: "Correlation id attached to this executed Quant Lab call." },
  span_id: { type: "string", minLength: 1, maxLength: 128, description: "Unique server-generated span identifier for this execution." },
  duration_ms: { type: "number", minimum: 0, description: "Measured server execution duration in milliseconds." },
  capture_mode: { type: "string", enum: ["async"], description: "Telemetry capture mode. Quant Lab currently emits asynchronous execution telemetry.", x_value_descriptions: { async: "Asynchronous telemetry capture that does not change the business operation result." } },
});

export function publicTools(publicStatusSchema, startupContextSchema, executeIntentOutputSchema) {
  return [
    {
      name: "get_quant_lab_startup_context",
      title: "Get Quant Lab Startup Context",
      description: "Load the permanent Quant Lab Startup Authority and M-BRAIN Work Unit routing contract before any material operator execution. Use this first to obtain the exact governing acknowledgment and operational-authority rules; it is read-only and does not execute a Quant capability.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: objectSchema({ trace_id: traceIdSchema }, []),
      outputSchema: withTelemetry(startupContextSchema),
    },
    {
      name: "get_quant_lab_status",
      title: "Get Quant Lab Status",
      description: "Return authenticated Quant Lab infrastructure and operator status without executing research, paper decisions, deployments, or trading actions. Use this for health/current-phase inspection; no private strategy data or live-capital controls are exposed.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: objectSchema({ trace_id: traceIdSchema }, []),
      outputSchema: withTelemetry(publicStatusSchema),
    },
    {
      name: "get_quant_lab_capability_definition",
      title: "Get Quant Lab Capability Definition",
      description: "List the bounded server-side Quant Lab capability catalog when capability is omitted, or return one exact source-controlled capability definition when capability is supplied. Use this before gateway execution to learn the exact operation class, handler, arguments, constraints, and risk gates; capability evolution remains server-side data rather than public MCP tool drift.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: objectSchema({ capability: capabilitySelectorSchema, trace_id: traceIdSchema }, []),
      outputSchema: withTelemetry(dynamicDefinitionOutputSchema),
    },
    {
      name: "execute_quant_lab_read_action",
      title: "Execute Quant Lab Read Action",
      description: "Execute one exact source-defined READ capability through the stable Quant Lab gateway after its definition has been inspected. The server resolves the capability, verifies that its operation_class is read, validates the current source-controlled argument schema, applies the bound M-BRAIN Work Unit authority, and executes the canonical handler. Do not use this gateway for mutation-class capabilities.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: gatewayInputSchema(),
      outputSchema: withTelemetry(executeIntentOutputSchema),
    },
    {
      name: "execute_quant_lab_mutation_action",
      title: "Execute Quant Lab Mutation Action",
      description: "Reserved mutation gateway for source-defined mutation-class Quant Lab capabilities. The current production operator is intentionally read-only/dormant and this tool fails with quant_lab_read_only_dormant_mode rather than executing a mutation. Do not select it expecting a write until the production authority explicitly re-enables mutation execution.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: gatewayInputSchema(),
      outputSchema: withTelemetry(executeIntentOutputSchema),
    },
  ];
}

function gatewayInputSchema() {
  return objectSchema({
    trace_id: traceIdSchema,
    operation_id: {
      type: "string",
      minLength: 1,
      maxLength: 120,
      description: "Unique idempotency key for this exact Quant Lab execution. Reusing an operation_id with different payload data is rejected; replaying the identical request returns the existing receipt.",
    },
    governing_authority_ack: {
      type: "string",
      const: REQUIRED_GOVERNING_AUTHORITY_ACK,
      description: "Exact acknowledgment string returned by get_quant_lab_startup_context. Copy it exactly; this field proves the current startup authority was loaded and must not be paraphrased.",
      x_const_description: "The one server-required governing-authority acknowledgment accepted for material Quant Lab execution.",
    },
    mbrain_work_unit_id: {
      type: "string",
      minLength: 1,
      maxLength: 120,
      description: "Exact active owner-approved M-BRAIN Work Unit id that authorizes this operator action. Do not invent, reuse from unrelated work, or substitute a Git issue/commit identifier.",
    },
    capability: {
      ...capabilitySelectorSchema,
      description: "Exact capability id or intent whose current definition was inspected with get_quant_lab_capability_definition. The server rejects unknown capabilities and effect-class mismatches.",
    },
    arguments: dynamicArgumentsSchema,
  }, ["operation_id", "governing_authority_ack", "mbrain_work_unit_id", "capability", "arguments"]);
}

function withTelemetry(schema) {
  return {
    ...schema,
    properties: {
      ...(schema?.properties || {}),
      _telemetry: telemetryReceiptSchema,
    },
    required: [...new Set([...(schema?.required || []), "_telemetry"])],
  };
}
