import { supportedIntents } from "./capabilityDirectory.js";
import { objectSchema } from "./schemas.js";

export function publicTools(publicStatusSchema, startupContextSchema, executeIntentOutputSchema) {
  return [
    {
      name: "get_quant_lab_startup_context",
      title: "Get Quant Lab Startup Context",
      description: "Load the mandatory Quant Lab Startup Authority and sole canonical Git Engineering Continuation Ledger before any operator intent.",
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
    {
      name: "execute_quant_lab_intent",
      title: "Execute Quant Lab Intent",
      description: "Execute one bounded source-defined Quant Lab operator intent. First call get_quant_lab_startup_context, then include its exact required_governing_authority_ack and canonical_continuation.sha inside inputs as governing_authority_ack and canonical_continuation_sha. Calls fail closed when authority is skipped or the Git ECL SHA is stale.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: objectSchema({
        operation_id: { type: "string", minLength: 1, maxLength: 120 },
        intent: { type: "string", enum: supportedIntents },
        inputs: { type: "object", additionalProperties: true },
      }, ["operation_id", "intent", "inputs"]),
      outputSchema: executeIntentOutputSchema,
    },
  ];
}

