import { supportedIntents } from "./capabilityDirectory.js";
import { objectSchema } from "./schemas.js";

export function publicTools(publicStatusSchema, executeIntentOutputSchema) {
  return [
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
      description: "Execute one bounded source-defined Quant Lab operator intent through the execution kernel.",
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

