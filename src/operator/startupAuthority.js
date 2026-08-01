import { readRepoContent } from "./githubApi.js";
import { repoSnapshots } from "./repoSnapshots.js";

export const STARTUP_AUTHORITY_PATH = "docs/QUANT_LAB_STARTUP_AUTHORITY.md";
export const ENGINEERING_CONTINUATION_PATH = "docs/ENGINEERING_CONTINUATION_LEDGER.md";
export const REQUIRED_GOVERNING_AUTHORITY_ACK = "Quant Lab Startup Authority acknowledged. Paper only; no live capital without explicit owner approval. Execute only the canonical Git ECL current action.";

export async function loadQuantStartupContext(env) {
  const [authority, continuation] = await Promise.all([
    loadCanonicalDocument(env, STARTUP_AUTHORITY_PATH),
    loadCanonicalDocument(env, ENGINEERING_CONTINUATION_PATH),
  ]);

  const errors = [];
  if (!authority.ok) errors.push(`${STARTUP_AUTHORITY_PATH}:${authority.error}`);
  if (!continuation.ok) errors.push(`${ENGINEERING_CONTINUATION_PATH}:${continuation.error}`);
  if (authority.ok && !authority.content.includes("# Quant Lab Startup Authority")) {
    errors.push(`${STARTUP_AUTHORITY_PATH}:invalid_document_identity`);
  }
  if (continuation.ok && !continuation.content.includes("Authority: Sole canonical engineering continuation ledger")) {
    errors.push(`${ENGINEERING_CONTINUATION_PATH}:invalid_continuation_authority`);
  }
  if (continuation.ok && !continuation.content.includes("## Current Action")) {
    errors.push(`${ENGINEERING_CONTINUATION_PATH}:missing_current_action`);
  }

  return {
    ok: errors.length === 0,
    required_governing_authority_ack: REQUIRED_GOVERNING_AUTHORITY_ACK,
    startup_authority: authority.ok ? authority : null,
    canonical_continuation: continuation.ok ? continuation : null,
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
