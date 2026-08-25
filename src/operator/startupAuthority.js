import { readRepoContent } from "./githubApi.js";
import { repoSnapshots } from "./repoSnapshots.js";

export const STARTUP_AUTHORITY_PATH = "docs/QUANT_LAB_STARTUP_AUTHORITY.md";
export const REQUIRED_GOVERNING_AUTHORITY_ACK = "Quant Lab Startup Authority acknowledged. Execute only the M-BRAIN-authorized active Work Unit while preserving permanent Quant safety boundaries.";

export async function loadQuantStartupContext(env) {
  const authority = await loadCanonicalDocument(env, STARTUP_AUTHORITY_PATH);

  const errors = [];
  if (!authority.ok) errors.push(`${STARTUP_AUTHORITY_PATH}:${authority.error}`);
  if (authority.ok && !authority.content.includes("# Quant Lab Startup Authority")) {
    errors.push(`${STARTUP_AUTHORITY_PATH}:invalid_document_identity`);
  }
  if (authority.ok && !authority.content.includes("## M-BRAIN Operational Authority")) {
    errors.push(`${STARTUP_AUTHORITY_PATH}:missing_m_brain_operational_authority`);
  }

  return {
    ok: errors.length === 0,
    required_governing_authority_ack: REQUIRED_GOVERNING_AUTHORITY_ACK,
    startup_authority: authority.ok ? authority : null,
    operational_authority: {
      type: "m_brain_owner_approved_work_unit",
      required_router: "M-BRAIN_Gateway.routeTurn",
      fail_closed_without_authorized_work_unit: true,
      proof_contract_grants_execution_authority: false,
    },
    errors,
  };
}

async function loadCanonicalDocument(env, path) {
  if (env.ENVIRONMENT === "test" && typeof repoSnapshots[path] === "string") {
    return {
      ok: true,
      path,
      sha: `test-snapshot-${path}`,
      source: "bundled_test_snapshot",
      content: repoSnapshots[path],
    };
  }

  if (env.GITHUB_TOKEN) {
    const remote = await readRepoContent(env, path);
    if (!remote.ok) {
      return { ok: false, error: remote.status || `github_status_${remote.status_code || "unknown"}` };
    }
    const content = remote.body?.decoded_content;
    const sha = remote.body?.sha;
    if (typeof content !== "string" || !content || typeof sha !== "string" || !sha) {
      return { ok: false, error: "invalid_github_document" };
    }
    return { ok: true, path, sha, source: "github", content };
  }

  return { ok: false, error: "github_token_not_configured" };
}
