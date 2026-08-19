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
  "docs/LENSICALLY_STYLE_MCP_ARCHITECTURE.md",
  "docs/MCP_OPERATOR_CONTROL_PLANE_HANDOFF.md",
  "docs/MCP_OPERATOR_TOOL_SURFACE_HANDOFF.md",
  "src/index.js",
  "src/professionalConsole.js",
  "src/professionalConsoleStyles.js",
  "src/directionalShadow.js",
  "src/directionalBacktest.js",
  "src/directionalResearch.js",
  "src/directionalInstitutionalResearch.js",
  "src/institutionalResearchPortfolio.js",
  "migrations/0014_directional_shadow_paper.sql",
  "migrations/0015_directional_institutional_research.sql",
  "migrations/0018_institutional_research_portfolio.sql",
  "test/directional-shadow.test.js",
  "test/directional-institutional-research.test.js",
  "test/institutional-research-portfolio.test.js",
  "src/operator/capabilityDirectory.js",
  "src/operator/capabilityLifecycle.json",
  "src/operator/clientSafeRequests.js",
  "src/operator/executionKernel.js",
  "src/operator/githubApi.js",
  "src/operator/handlers/controlPlane.js",
  "src/operator/receipts.js",
  "src/operator/repoSnapshots.js",
  "src/operator/schemas.js",
  "src/operator/toolRegistry.js",
  "test/worker.test.js",
  "test/operator-capability-directory.test.js",
  "test/operator-client-safety.test.js",
  ".github/workflows/ci.yml",
  ".github/workflows/quant-lab-deploy.yml",
  ".github/workflows/quant-lab-recovery-deploy.yml",
  "recovery-worker/src/index.js",
  "recovery-worker/wrangler.jsonc",
  "test/recovery-worker.test.js",
  "wrangler.jsonc",
  "package.json",
];

export const allowedRepoDirectories = [
  ".github/workflows",
  "docs",
  "migrations",
  "quant_core",
  "recovery-worker",
  "src",
  "test",
  "tests",
];

const blockedPathSegments = [
  ".env",
  ".git",
  ".wrangler",
  "__pycache__",
  "node_modules",
  ".venv",
  "venv",
  "dist",
  "build",
  "coverage",
];

const blockedFileExtensions = [
  ".db",
  ".sqlite",
  ".sqlite3",
  ".log",
  ".pem",
  ".key",
  ".p12",
  ".bin",
  ".zip",
  ".tar",
  ".gz",
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
  if (!isAllowedRepoPath(path)) {
    throw new ClientSafetyError("forbidden_path");
  }
}

export function isAllowedRepoPath(path) {
  if (typeof path !== "string" || !path || path.length > 220 || path.includes("..") || path.startsWith("/") || path.includes("\\")) {
    return false;
  }
  if (path.split("/").some((segment) => blockedPathSegments.includes(segment))) {
    return false;
  }
  if (blockedFileExtensions.some((extension) => path.toLowerCase().endsWith(extension))) {
    return false;
  }
  return allowedRepoPaths.includes(path) || allowedRepoDirectories.some((directory) => path === directory || path.startsWith(`${directory}/`));
}

export function redactSecrets(value) {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  return redactionPatterns.reduce((text, pattern) => text.replace(pattern, "[REDACTED]"), serialized);
}

export function redactValue(value) {
  const redacted = redactSecrets(value);
  return typeof value === "string" ? redacted : JSON.parse(redacted);
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
