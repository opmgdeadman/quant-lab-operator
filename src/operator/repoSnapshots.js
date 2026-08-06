export const repoSnapshots = {
  "README.md": `# Quant Lab

Single public repository for the Quant Lab paper-trading laboratory, deployed as a GitHub plus Cloudflare system.

The operating model is not localhost or a required local runtime. Changes are pushed to GitHub, validated by GitHub Actions, deployed to Cloudflare, and verified against the live Worker, D1 binding, website, and authenticated MCP.

The authenticated MCP exposes get_quant_lab_status and execute_quant_lab_intent. Domain trading functionality must sit behind source-defined bounded intents and tests.`,
  "OPERATING_MEMORY.md": `# Quant Lab Operating Memory

Quant Lab is a public GitHub plus Cloudflare Worker system with an authenticated MCP boundary. Current milestone is the Lensically-style operator control plane with durable receipts.`,
  "docs/WHITELISTED_CLOUD_GITHUB_MCP_RUNBOOK.md": `# Whitelisted Cloud, GitHub, Cloudflare, Website, and MCP Runbook

Use one public repo. Keep secrets in GitHub/Cloudflare secret storage. Keep MCP/control routes authenticated. Use direct typed tools and closed schemas.`,
  "docs/MCP_OPERATOR_CONTROL_PLANE_HANDOFF.md": `# MCP Operator Control Plane Handoff

Implement get_quant_lab_status plus execute_quant_lab_intent. Intents must be source-defined, audited, idempotent, bounded, and fail closed.`,
  "docs/QUANT_LAB_STARTUP_AUTHORITY.md": `# Quant Lab Startup Authority

State: ACTIVE

## Read First

This document governs Quant Lab operating behavior. It is separate from the Engineering Continuation Ledger.

## Mission

Build and operate an autonomous paper-trading laboratory that earns a tightly controlled live-capital trial through reproducible forward evidence.

## Startup Contract

Every fresh Quant Lab operating session must load and acknowledge this authority before engineering, research, deployment, or trading actions. Paper trading only until the live-capital gate is satisfied and owner approval is explicit. After startup authority is loaded, read the sole canonical Engineering Continuation Ledger and execute only its active job and current action. D1, receipts, website state, chat context, and model memory may not override the Git ledger.`,
  "docs/ENGINEERING_CONTINUATION_LEDGER.md": `# Quant Lab Engineering Continuation Ledger

Status: ACTIVE
Authority: Sole canonical engineering continuation ledger

## Active Job

Job ID: `stage-13-directional-shadow-paper-research`
State: ACTIVE

## Current Action

Complete the engineering-control prerequisite, deploy MCP version 0.4.0, then resume the institutional directional-authority transition without weakening evidence gates.

No chat context, model memory, D1 continuation summary, runtime receipt, website state, or other document may override this ledger.`,
  "src/index.js": `src/index.js routes HTTP/OAuth/MCP requests and delegates public tool execution to the operator registry and execution kernel.`,
  "test/worker.test.js": `Worker tests cover auth, removed public proof routes, MCP sessions, and operator tool dispatch.`,
  "wrangler.jsonc": `Cloudflare Worker config binds D1 database quant_lab_operator and exposes production environment variables without secret values.`,
  "package.json": `package scripts include node test and wrangler deploy dry-run diagnostics. Official validation is GitHub Actions.`,
};

