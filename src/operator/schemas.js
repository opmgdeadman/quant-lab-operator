export function objectSchema(properties, required = Object.keys(properties)) {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required,
  };
}

export const stringSchema = { type: "string" };
export const booleanSchema = { type: "boolean" };
export const numberSchema = { type: "number" };

