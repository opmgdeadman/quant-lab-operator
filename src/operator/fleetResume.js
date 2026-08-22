const CANONICAL_RESUME_PATH = "/M-BRAIN/PROJECTS/QUANT_LAB/06_RESUME.md";
const DETAILED_STATE_PATH = "/M-BRAIN/PROJECTS/QUANT_LAB/01_STATE.md";

export const quantResumeContract = Object.freeze({
  standard: "fleet-persistent-continuation-standard-v1",
  version: "1.0.0",
  canonical_resume_path: CANONICAL_RESUME_PATH,
  detailed_state_path: DETAILED_STATE_PATH,
  transport: "cloudflare_service_binding",
  service: "m-brain-quant-resume-ingress",
  caller_selected_path: false,
  automatic_writes: false,
  canonical_git_authority_unchanged: true,
});

export async function syncQuantResumeCheckpoint(env, checkpoint) {
  if (!env.RESUME_SYNC_SERVICE || typeof env.RESUME_SYNC_SERVICE.fetch !== "function") {
    throw new Error("quant_resume_service_binding_missing");
  }
  const payload = normalizeCheckpoint(checkpoint);
  const response = await env.RESUME_SYNC_SERVICE.fetch("https://m-brain-quant-resume-ingress/quant-lab", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-quant-resume-service": "quant-lab-native-v1",
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok !== true) {
    throw new Error(`quant_resume_sync_failed:${body?.error || response.status}`);
  }
  if (body.canonical_path !== CANONICAL_RESUME_PATH) {
    throw new Error("quant_resume_path_mismatch");
  }
  return {
    ...body,
    standard: quantResumeContract.standard,
    canonical_resume_path: CANONICAL_RESUME_PATH,
    detailed_state_path: DETAILED_STATE_PATH,
    canonical_git_authority_unchanged: true,
  };
}

function normalizeCheckpoint(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("checkpoint_must_be_object");
  const output = {};
  for (const name of ["workstream", "current_status", "last_completed", "stop_boundary", "exact_next_action", "blocker_or_approval_boundary"]) {
    const value = input[name];
    if (typeof value !== "string" || !value.trim() || value.trim().length > 1200) throw new Error(`invalid_${name}`);
    output[name] = value.trim().replace(/[\r\n]+/g, " ");
  }
  if (input.detailed_state_version !== undefined) {
    if (!Number.isInteger(input.detailed_state_version) || input.detailed_state_version < 1) throw new Error("invalid_detailed_state_version");
    output.detailed_state_version = input.detailed_state_version;
  }
  if (typeof input.trace_id === "string" && input.trace_id.trim()) output.trace_id = input.trace_id.trim().slice(0, 128);
  output.source_action = "checkpoint_quant_lab_resume";
  return output;
}
