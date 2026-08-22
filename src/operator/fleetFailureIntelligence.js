import {
  FLEET_FAILURE_INTELLIGENCE_ENFORCEMENT_IMPLEMENTATION,
  createD1FailureIntelligenceStorage,
  registerFailurePrevention,
  checkFailureIntelligence,
  recordFailureExecution,
  readFailurePrevention,
  runFailureIntelligenceCertification,
} from "../../standards/fleet-failure-intelligence-enforcement-v1.js";

function storage(env) {
  return createD1FailureIntelligenceStorage(env.DB);
}

function runtimeContext(toolName, args) {
  return { recipient: toolName, arguments: args };
}

export function failureIntelligenceMetadata() {
  return FLEET_FAILURE_INTELLIGENCE_ENFORCEMENT_IMPLEMENTATION;
}

export async function enforceQuantToolCall(env, toolName, args) {
  return checkFailureIntelligence(storage(env), {
    proposed_action: toolName,
    context: runtimeContext(toolName, args),
  });
}

export async function recordQuantToolSuccess(env, toolName, args, gate) {
  if (!gate?.prevention_id) return null;
  return recordFailureExecution(storage(env), {
    prevention_id: gate.prevention_id,
    family: gate.family ?? undefined,
    proposed_action: toolName,
    context: runtimeContext(toolName, args),
    outcome: "SUCCESS",
  });
}

export async function runQuantFailureIntelligenceCertification(env, runId) {
  const db = storage(env);
  try {
    const harness = await runFailureIntelligenceCertification(db, { run_id: runId });
    const preventionId = `cert:${runId}:quant-lab-runtime-probe`;
    await registerFailurePrevention(db, {
      prevention_id: preventionId,
      family: "known_losing_route_recurrence",
      failure_signature: "QUANT_LAB_CERT_KNOWN_LOSING_ROUTE",
      scope: { certification_run_id: runId, target: "quant-lab" },
      losing_action: "execute_quant_lab_mutation_action",
      winning_action: "get_quant_lab_status",
      match_context: {
        recipient: "execute_quant_lab_mutation_action",
        arguments: { certification_run_id: runId, route_class: "unsafe_unbounded" },
      },
      winning_requirements: {
        recipient: "get_quant_lab_status",
        arguments: { certification_run_id: runId, route_class: "bounded_verified" },
      },
      source_evidence: { kind: "bounded_target_native_certification", run_id: runId, target: "quant-lab" },
      status: "ACTIVE",
    });

    const losingArgs = { certification_run_id: runId, route_class: "unsafe_unbounded" };
    const knownRecurrence = await enforceQuantToolCall(env, "execute_quant_lab_mutation_action", losingArgs);
    const winningArgs = { certification_run_id: runId, route_class: "bounded_verified" };
    const correctedGate = await enforceQuantToolCall(env, "get_quant_lab_status", winningArgs);
    let correctedExecution = null;
    if (correctedGate.allowed) {
      const probe = await env.DB.prepare("SELECT 1 AS ok").first();
      const attempt = await recordQuantToolSuccess(env, "get_quant_lab_status", winningArgs, correctedGate);
      correctedExecution = { executed: true, outcome: probe?.ok === 1 ? "SUCCESS" : "FAILURE", attempt };
    }
    const readback = await readFailurePrevention(db, { prevention_id: preventionId });
    const runtimeProbePass = knownRecurrence.decision === "DENY_KNOWN_RECURRENCE"
      && knownRecurrence.executed === false
      && correctedGate.decision === "ALLOW"
      && correctedExecution?.executed === true
      && correctedExecution?.outcome === "SUCCESS";

    return {
      ok: harness?.ok === true && runtimeProbePass,
      standard: FLEET_FAILURE_INTELLIGENCE_ENFORCEMENT_IMPLEMENTATION,
      run_id: runId,
      harness,
      runtime_probe: {
        known_recurrence: knownRecurrence,
        corrected_gate: correctedGate,
        corrected_execution: correctedExecution,
        readback_attempt_count: Array.isArray(readback?.attempts) ? readback.attempts.length : 0,
        pass: runtimeProbePass,
      },
      production_safety: {
        certification_mode: true,
        production_novel_loss_execution: false,
        certification_fixtures_retired_on_exit: true,
      },
    };
  } finally {
    await retireCertificationFixtures(env, runId);
  }
}

async function retireCertificationFixtures(env, runId) {
  const now = new Date().toISOString();
  await env.DB.prepare("UPDATE failure_intelligence_preventions SET status = 'RETIRED', updated_at = ? WHERE prevention_id LIKE ? AND status = 'ACTIVE'")
    .bind(now, `cert:${runId}:%`).run();
}
