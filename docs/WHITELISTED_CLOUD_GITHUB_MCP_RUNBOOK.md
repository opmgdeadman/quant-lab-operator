# Quant Lab Public Operations Runbook

Last updated: 2026-08-06

This runbook describes the remote-first operating path for Quant Lab without recording personal machine details, connector identifiers, credentials, temporary files, private account data, or local project state.

## Architecture

Quant Lab uses one public GitHub repository for source, tests, migrations, documentation, and GitHub Actions. Cloudflare hosts the Worker, D1 database binding, public operating console, authenticated MCP, and independent Recovery Worker.

Public source does not make secrets or runtime state public. Credentials remain in GitHub Actions secrets or Cloudflare encrypted secrets. Market data, research evidence, paper positions, decisions, receipts, incidents, and other operational records remain in D1 or bounded runtime storage.

## Public Repository Boundary

Allowed in Git:

- deterministic research and backtest source;
- Worker and Recovery source;
- D1 migrations;
- public website source and assets;
- tests and validation scripts;
- GitHub Actions workflows;
- public-safe architecture and operating documentation.

Forbidden in Git:

- access tokens, API keys, OAuth client secrets, private keys, or credentialed URLs;
- `.env`, `.dev.vars`, key files, credential bundles, or temporary secret files;
- personal filesystem paths, local usernames, local project identifiers, or private connector identifiers;
- private research state, paper positions, decision records, D1 exports, logs, databases, or generated runtime artifacts;
- copied workflow logs or error payloads that may contain headers, tokens, or private account data.

Every CI and deployment path must run `npm run audit:public` against the complete Git history before tests, migrations, or deployment.

## Secret Storage

Worker secrets include only values required by active authenticated paths. Secret names may be documented; secret values may not.

Main Worker secrets may include:

- `INTERNAL_API_TOKEN`
- `MCP_CLIENT_SECRET`
- `GITHUB_TOKEN`

Recovery Worker secrets may include:

- `RECOVERY_API_TOKEN`
- `GITHUB_TOKEN`

GitHub Actions secrets may include:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Cloudflare credentials remain in GitHub Actions. GitHub credentials remain server-side in Cloudflare. The model never receives raw secret values.

## Canonical Authority

- Permanent startup authority: `docs/QUANT_LAB_STARTUP_AUTHORITY.md`
- Live continuation, approvals, queue position, blockers, and exact next action: owner-approved Quant Work Units in M-BRAIN
- Reusable operating rules: `OPERATING_MEMORY.md`
- Capability contract: `src/operator/capabilityDirectory.js`
- Capability lifecycle: `src/operator/capabilityLifecycle.json`
- Historical continuation ledgers: archival evidence only; never live authority

Chat context, workflow narration, Git ledgers, D1 continuation summaries, and runtime receipts cannot override the active M-BRAIN Work Unit.

## MCP Contract

The public MCP surface consists of:

- mandatory startup context;
- bounded authenticated infrastructure status;
- one direct typed tool for each capability-directory entry.

All capability schemas are closed. Every operation requires the exact Startup Authority acknowledgment and `mbrain_work_unit_id` for the active M-BRAIN Work Unit. Sessions are deployment-scoped and must be reinitialized after a deployment changes the MCP contract.

The MCP exposes no arbitrary shell, arbitrary SQL, unrestricted GitHub API, unrestricted Cloudflare API, generic code execution, or raw credential access.

## Repository Mutation

Repository changes must:

1. read the current Git head;
2. use an allowlisted path;
3. use an exact find/replace patch or bounded create/delete operation;
4. enforce expected-head protection;
5. create one non-forced Git commit;
6. run the public-repository audit and required regressions;
7. deploy only an exact validated SHA;
8. verify production reports that exact SHA.

A stale head, non-unique replacement, ambiguous external response, or failed validation must stop the operation. Do not bypass a guard.

## Validation

The canonical validation sequence is:

1. public repository history audit;
2. Worker tests;
3. deterministic Python quant-core tests;
4. Main and Recovery Wrangler dry-run validation;
5. capability lifecycle and client-safety regressions embedded in the test suite.

CI uses one branch-wide job with superseded-run cancellation. Manual and push validation share the same concurrency authority.

## Deployment

Main deployment:

1. validate a 40-character exact SHA;
2. check out that exact SHA;
3. run the public repository audit;
4. reuse successful exact-SHA CI evidence when available;
5. otherwise run the complete validation fallback;
6. apply D1 migrations;
7. deploy the Worker with exact repository and deployment SHA metadata;
8. verify the public console, branding, health, and production SHA;
9. dispatch independent Recovery deployment for the same exact SHA.

Recovery deployment is separate from Main, contains no D1 or trading/account binding, and verifies either a locked or ready authenticated state.

## Workflow Safety

- Pull requests run only no-secret CI validation.
- Main and Recovery deployments require explicit workflow dispatch.
- Deployment workflows use repository contents read permission; Main receives Actions write only to dispatch Recovery after successful verification.
- Secrets are referenced only through GitHub’s encrypted secret context.
- Workflow logs must never print token values or credential-bearing headers.

## Public Endpoint Safety

The public console and public status surface expose deliberately selected paper-only operating data. Authentication, internal status, repository mutation, deployment, incident control, and MCP discovery remain protected.

Public code may include non-secret infrastructure identifiers required for deployment, such as Worker names, D1 binding names, database IDs, routes, and repository names. These identifiers grant no access and must never be treated as credentials.

## Incident Response

If the public audit detects a credential-shaped value:

1. stop CI and deployment;
2. revoke or rotate the affected credential immediately;
3. remove it from the current tree;
4. determine whether Git history requires rewriting;
5. record a durable hardening incident;
6. add a regression that detects the exposure class;
7. resume only after exact-SHA validation and live verification.

If only non-secret personal metadata is found, remove it from the current branch and assess whether the residual history justifies a coordinated history rewrite. Do not rewrite history casually because Quant Lab relies on immutable SHAs and durable lineage.

## Operating Rule

Public repository status is an infrastructure choice, not permission to weaken privacy, authentication, trading boundaries, evidence gates, or release discipline. Quant Lab remains paper-only until explicit owner approval after evidence eligibility.
