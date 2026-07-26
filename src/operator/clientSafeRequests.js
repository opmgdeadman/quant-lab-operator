export const forbiddenPublicInputKeys = [
  "command",
  "sql",
  "script",
  "shell",
  "token",
  "secret",
  "private_key",
  "password",
  "raw_patch",
  "arbitrary_url",
];

export const allowedRepoPaths = [
  "README.md",
  "OPERATING_MEMORY.md",
  "docs/WHITELISTED_CLOUD_GITHUB_MCP_RUNBOOK.md",
  "docs/MCP_OPERATOR_CONTROL_PLANE_HANDOFF.md",
  "src/index.js",
  "test/worker.test.js",
  "wrangler.jsonc",
  "package.json",
];

const redactionPatterns = [
  /Bearer\s+[A-Za-z0-9._~+/=-]{16,}/gi,
  /ghp_[A-Za-z0-9_]{16,}/g,
  /github_pat_[A-Za-z0-9_]{16,}/g,
  /cfpat-[A-Za-z0-9_-]{16,}/gi,
  /sk-[A-Za-z0-9_-]{16,}/gi,
  /(?<="(?:token|secret|password|private_key|client_secret)"\s*:\s*")[^"]+/gi,
  /\b[A-Za-z0-9_-]{48,}\b/g,
];

export function assertClientSafeInputs(value) {
  visit(value, []);
}

export function assertAllowedRepoPath(path) {
  if (typeof path !== "string" || path.includes("..") || path.startsWith("/") || path.includes("\\")
    || !allowedRepoPaths.includes(path)) {
    throw new ClientSafetyError("forbidden_path");
  }
}

export function redactSecrets(value) {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  return redactionPatterns.reduce((text, pattern) => text.replace(pattern, "[REDACTED]"), serialized);
}

export function redactValue(value) {
  return JSON.parse(redactSecrets(value));
}

export function boundResultBytes(value, maxBytes) {
  const text = redactSecrets(value);
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= maxBytes) {
    return JSON.parse(text);
  }
  return {
    truncated: true,
    max_response_bytes: maxBytes,
    preview: new TextDecoder().decode(bytes.slice(0, maxBytes)),
  };
}

function visit(value, path) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => visit(item, [...path, String(index)]));
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenPublicInputKeys.includes(key.toLowerCase())) {
      throw new ClientSafetyError("forbidden_public_input_key");
    }
    visit(child, [...path, key]);
  }
}

export class ClientSafetyError extends Error {}

