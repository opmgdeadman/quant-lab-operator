import { capabilityDirectory } from "./capabilityDirectory.js";
import { objectSchema } from "./schemas.js";
import { REQUIRED_GOVERNING_AUTHORITY_ACK } from "./startupAuthority.js";

export function publicTools(publicStatusSchema, startupContextSchema, executeIntentOutputSchema) {
  return [
    {
      name: "get_quant_lab_startup_context",
      title: "Get Quant Lab Startup Context",
      description: "Load the mandatory Quant Lab Startup Authority and sole canonical Git Engineering Continuation Ledger before any operator capability.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: objectSchema({}),
      outputSchema: startupContextSchema,
    },
    {
      name: "get_quant_lab_status",
      title: "Get Quant Lab Status",
      description: "Return authenticated Quant Lab infrastructure status. No trading actions or private strategy data.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: objectSchema({}),
      outputSchema: publicStatusSchema,
    },
    ...capabilityDirectory.map((capability) => buildDirectCapabilityTool(capability, executeIntentOutputSchema)),
  ];
}

export function buildDirectCapabilityTool(capability, executeIntentOutputSchema) {
  const publicInputSchema = publicCapabilityInputSchema(capability);
  const capabilityProperties = publicInputSchema?.properties || {};
  const capabilityRequired = publicInputSchema?.required || [];
  return {
    name: capability.intent,
    title: capability.title,
    description: `Execute the bounded source-defined Quant Lab capability ${capability.intent}. Call get_quant_lab_startup_context first and provide its exact acknowledgment and canonical Git ECL SHA.`,
    annotations: {
      readOnlyHint: capability.operation_class === "read",
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: capability.external_systems.some((system) => system !== "d1"),
    },
    inputSchema: objectSchema({
      operation_id: { type: "string", minLength: 1, maxLength: 120 },
      governing_authority_ack: {
        type: "string",
        const: REQUIRED_GOVERNING_AUTHORITY_ACK,
      },
      canonical_continuation_sha: { type: "string", minLength: 1, maxLength: 80 },
      ...capabilityProperties,
    }, [
      "operation_id",
      "governing_authority_ack",
      "canonical_continuation_sha",
      ...capabilityRequired,
    ]),
    outputSchema: executeIntentOutputSchema,
  };
}

export function publicCapabilityInputSchema(capability) {
  if (capability.intent !== "register_institutional_hypothesis") {
    return capability.input_schema;
  }

  const schema = structuredClone(capability.input_schema);
  const parameters = schema?.properties?.hypothesis?.properties?.preregistration?.properties?.strategy?.properties?.parameters;
  if (parameters) {
    parameters.properties = {};
    parameters.required = [];
    parameters.additionalProperties = true;
  }
  return schema;
}

