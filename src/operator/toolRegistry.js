import { objectSchema } from "./schemas.js";
import { REQUIRED_GOVERNING_AUTHORITY_ACK } from "./startupAuthority.js";

const capabilitySelectorSchema = { type: "string", minLength: 1, maxLength: 120 };
const dynamicArgumentsSchema = { type: "object", additionalProperties: true };
const dynamicDefinitionOutputSchema = { type: "object", additionalProperties: true };

export function publicTools(publicStatusSchema, startupContextSchema, executeIntentOutputSchema) {
  return [
    {
      name: "get_quant_lab_startup_context",
      title: "Get Quant Lab Startup Context",
      description: "Load the mandatory Quant Lab Startup Authority and sole canonical Git Engineering Continuation Ledger before any operator execution.",
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
      name: "get_quant_lab_capability_definition",
      title: "Get Quant Lab Capability Definition",
      description: "List bounded server-side Quant Lab capabilities or return one exact source-controlled capability definition. Capability and strategy evolution is data here, not public MCP schema.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: objectSchema({ capability: capabilitySelectorSchema }),
      outputSchema: dynamicDefinitionOutputSchema,
    },
    {
      name: "execute_quant_lab_read_action",
      title: "Execute Quant Lab Read Action",
      description: "Execute one source-defined read-only Quant Lab capability through the stable gateway. The server resolves the capability and validates its exact current schema before execution.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: gatewayInputSchema(),
      outputSchema: executeIntentOutputSchema,
    },
    {
      name: "execute_quant_lab_mutation_action",
      title: "Execute Quant Lab Mutation Action",
      description: "Execute one source-defined mutating Quant Lab capability through the stable gateway. The server resolves effect class and validates the exact current capability schema before execution.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: gatewayInputSchema(),
      outputSchema: executeIntentOutputSchema,
    },
  ];
}

function gatewayInputSchema() {
  return objectSchema({
    operation_id: { type: "string", minLength: 1, maxLength: 120 },
    governing_authority_ack: {
      type: "string",
      const: REQUIRED_GOVERNING_AUTHORITY_ACK,
    },
    canonical_continuation_sha: { type: "string", minLength: 1, maxLength: 80 },
    capability: capabilitySelectorSchema,
    arguments: dynamicArgumentsSchema,
  }, ["operation_id", "governing_authority_ack", "canonical_continuation_sha", "capability", "arguments"]);
}

