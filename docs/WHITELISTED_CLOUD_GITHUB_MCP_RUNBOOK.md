# Whitelisted Cloud, GitHub, Cloudflare, Website, and MCP Runbook

Last updated: 2026-07-27

This is the replayable operating record for creating the Quant Lab public GitHub repository, Cloudflare Worker, D1 binding, public website, and authenticated ChatGPT MCP connector. It records both the successful path and the mistakes that were corrected so future Codex sessions do not restart from zero.

Do not put secrets in this file. Use only secret names, storage locations, and verification signals.

## Final Architecture

Use one public repository for the whole Quant Lab system:

- GitHub repo: `https://github.com/opmgdeadman/quant-lab-operator`
- Worker: `https://quant-lab-operator.briangriffin355.workers.dev`
- D1 database: `quant_lab_operator`
- D1 database ID: `d9ac1f46-8251-4184-ad35-b87be4755917`
- D1 binding: `DB`
- Public website route: `GET /`
- Authenticated MCP route: `POST /api/operator/mcp`
- OAuth metadata: `GET /.well-known/oauth-authorization-server`
- OAuth authorize: `GET /api/operator/oauth/authorize`
- OAuth token: `POST /api/operator/oauth/token`
- Internal status route: `GET /internal/status`

The repository is public. Secrets remain in GitHub and Cloudflare secret stores. Strategy specs, research state, paper positions, decisions, and operational records must live in D1/private runtime state, not in Git.

## What Was Consolidated

Initial implementation over-split the system into:

- private operator repo: `opmgdeadman/quant-lab-operator`
- public runner repo: `opmgdeadman/quant-core-runner`

Corrected architecture:

- Keep `opmgdeadman/quant-lab-operator`.
- Make it public.
- Move/copy deterministic `quant_core` and tests into it.
- Delete `opmgdeadman/quant-core-runner`.
- Deploy website, Worker, D1 migrations, CI, and authenticated MCP from the single public repo.

Successful GitHub operations:

```powershell
gh repo edit opmgdeadman/quant-lab-operator --visibility public --accept-visibility-change-consequences
gh repo delete opmgdeadman/quant-core-runner --yes
```

Before making a repo public, scan both the working tree and Git history for secrets, private account data, local runtime data, databases, logs, and generated artifacts.

## Current Remote Validation Signals

Latest known good state:

- Current Lensically-style engineering-control commit: `079325d94270b91f432d7a599553e021cdf5eca9`
- Current deployed Worker version: `1baab6e8-a104-4045-aa57-d8f85909bd2b`
- Live `validate_production_sha`: `repository_sha` and `deployment_sha` both `079325d94270b91f432d7a599553e021cdf5eca9`, `aligned: true`
- GitHub CI push run for engineering-control port: `30226108681`, success
- MCP-dispatched CI run: `30226144588`, success
- MCP-dispatched migrations workflow run: `30226147861`, success
- Earlier consolidated authenticated MCP commit: `415a6d6017e22db4e76ba1929b5818bb138e04ae`
- Earlier documentation commit after connector setup: `5050d4e`
- Earlier documentation/assets cleanup commit: `605ef228763ae934f59eabf994e016a069c02a3b`
- Known passing GitHub Actions run after remote-first documentation cleanup: `30222233018`
- Do not treat this section as a live "latest commit" ledger; use GitHub Actions for the current source of truth.
- Earlier Worker deploy version after MCP secret alignment: `f847112c-8f94-444e-873f-3c5f32f39e32`
- Earlier cleanup deploy version: `c0ddbf85-c22c-4a64-a746-813202a9154e`

Official validation path:

- Push to GitHub.
- GitHub Actions installs dependencies on a clean runner.
- CI runs Worker tests, Python `quant_core` tests, and a Wrangler dry-run.
- Cloudflare is the deployment/runtime target.
- Verify the live Worker, website, D1 binding, and authenticated MCP after deploy.

Local commands are diagnostics only. They are useful when debugging a failed CI run or Worker dry-run, but they are not the Quant Lab operating path.

Expected remote results:

- GitHub Actions CI passes on the pushed commit.
- Wrangler dry-run passes in CI.
- Direct MCP OAuth token request succeeds with configured client credentials.
- Authenticated JSON-RPC `initialize` returns `Mcp-Session-Id`.
- Authenticated `tools/list` returns only public typed tools.

Current live MCP proof receipts:

- `operator_receipt_codex-read-readme-engineering-20260726`
- `operator_receipt_codex-patch-dry-run-20260726`
- `operator_receipt_codex-dispatch-ci-engineering-20260726`
- `operator_receipt_codex-monitor-ci-engineering-20260726`
- `operator_receipt_codex-dispatch-migrations-engineering-20260726`
- `operator_receipt_codex-final-sha-engineering-20260726`

## Repository Push Pattern

When pushing from this machine, use the GitHub token from the default profile without printing it:

```powershell
$profile='C:\Users\brian\.codex\profiles\briangriffin355.env'
$token = ((Get-Content $profile | Where-Object { $_ -match '^GITHUB_TOKEN=' }) -split '=',2)[1].Trim().Trim('"').Trim("'")
$basic = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("x-access-token:$token"))
git -c http.https://github.com/.extraheader="AUTHORIZATION: basic $basic" push
```

Never print `$token` or `$basic`.

## Cloudflare Deploy Pattern

Failed path:

```powershell
npm run deploy
```

Why it failed:

- The local shell did not have the Cloudflare token loaded.

Historical local deploy path that worked before the GitHub Actions deploy workflow existed:

```powershell
C:\Users\brian\.codex\scripts\Invoke-CodexDefaultProfile.ps1 'wrangler deploy --config C:\Users\brian\Documents\quant-lab-operator\wrangler.jsonc'
```

Wrangler validation:

- Failed: `wrangler check` or `npx wrangler check`
- Reason: invalid for Wrangler `4.71.0`
- Use: `wrangler deploy --dry-run`
- Repo command: `npm run check`

## Cloudflare Secret Pattern

Required secrets:

- `INTERNAL_API_TOKEN`
- `MCP_CLIENT_SECRET`
- `GITHUB_TOKEN`

Do not create secrets unless they are required by an active auth/control path. The `MCP_CLIENT_SECRET` became necessary only after the authenticated ChatGPT OAuth connector was configured. `GITHUB_TOKEN` became necessary only after the engineering-control MCP needed to read, patch, commit, and dispatch GitHub Actions server-side.

Required Worker vars:

- `GITHUB_OWNER=opmgdeadman`
- `GITHUB_REPO=quant-lab-operator`
- `GITHUB_BRANCH=main`
- `GITHUB_DEPLOY_WORKFLOW_ID=quant-lab-deploy.yml`

Required GitHub Actions secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

The Worker can use `GITHUB_TOKEN`; ChatGPT cannot see the token. GitHub Actions owns Cloudflare credentials; ChatGPT and the Worker do not receive raw Cloudflare API access for deployment.

Failed path:

```powershell
C:\Users\brian\.codex\scripts\Invoke-CodexDefaultProfile.ps1 'wrangler secret put MCP_CLIENT_SECRET ...'
```

Why it failed:

- Piping through the profile helper did not reliably pass stdin to Wrangler even when Wrangler printed a success-looking message.
- Direct OAuth token testing still failed with `invalid_client`.

Working pattern:

1. Load the default Cloudflare profile into the same PowerShell process.
2. Launch local `node_modules\.bin\wrangler.cmd` with redirected stdin.
3. Redeploy the Worker after setting or changing the secret.
4. Verify with a direct OAuth token request.

Do not store the secret value in Git, docs, chat, or memory.

For `GITHUB_TOKEN`, the same redirected-stdin Wrangler pattern worked. The default local profile contains the secret name:

```powershell
C:\Users\brian\.codex\profiles\briangriffin355.env
```

Set GitHub Actions secrets with `gh secret set` using `GH_TOKEN` from the same profile, but never print the token:

```powershell
$env:GH_TOKEN = $vars['GITHUB_TOKEN']
$vars['CLOUDFLARE_API_TOKEN'] | gh secret set CLOUDFLARE_API_TOKEN --repo opmgdeadman/quant-lab-operator
$vars['CLOUDFLARE_ACCOUNT_ID'] | gh secret set CLOUDFLARE_ACCOUNT_ID --repo opmgdeadman/quant-lab-operator
```

Local temp secret note:

- A temp copy existed at `C:\Users\brian\.codex\.tmp\quant-lab-mcp-client-secret.tmp`.
- Use it only to paste into ChatGPT dev connector or upload to Cloudflare.
- Remove it after the connector and Cloudflare secret are confirmed aligned.

## PowerShell Crypto Pattern

Failed path:

```powershell
[System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
```

Reason:

- This failed in the local PowerShell/.NET environment.

Use:

```powershell
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$rng.Dispose()
```

## Historical Local Python Diagnostic Pitfall

Failed path:

```powershell
python -m pytest
python -m pip install pytest
```

Reason:

- `python` on PATH pointed at a Hermes embedded environment without normal `pip`/`pytest`.

Use only when debugging locally on this Windows machine. Do not treat this as project setup or the official operating path:

```powershell
C:\Users\brian\AppData\Local\Programs\Python\Python313\python.exe -m pytest
```

CI uses `actions/setup-python`, so `python` is fine in GitHub Actions. Do not present the Windows Python path as the official project operating path.

## Authenticated MCP Pattern

Build MCP like Lensically, not as an unauthenticated endpoint.

Required behavior:

- MCP endpoint is `POST /api/operator/mcp` only.
- Reject unauthenticated requests before tool parsing or execution.
- Do not expose `tools/list` publicly.
- Support OAuth-style auth:
  - `/.well-known/oauth-authorization-server`
  - `/api/operator/oauth/authorize`
  - `/api/operator/oauth/token`
  - `/api/operator/mcp`
- Store secrets in environment/config, never in code.
- Requests must pass an equivalent of:
  - `isGptRequestAuthorized(request, env)`
  - `isOperatorMcpRequestAuthorized(request, env)`
  - `isInternalRequestAuthorized(request, env)`
- `initialize` requires auth and returns a deployment-scoped signed `Mcp-Session-Id`.
- `tools/list`, `tools/call`, and `ping` require auth and a valid session.
- Unknown or internal tools reject with `public_direct_tool_required`.
- Only registered public typed tools with closed schemas are advertised.

Minimum JSON-RPC methods:

- `initialize`
- `notifications/initialized`
- `tools/list`
- `tools/call`
- `ping`

Tool descriptors should include annotations and output schemas. A bare descriptor made ChatGPT label the status tool as write/destructive. Adding proper annotations changed it to `READ / OPEN WORLD`.

Example descriptor expectations:

- `readOnlyHint: true` for status/read tools.
- `destructiveHint: false` for read tools.
- `idempotentHint: true` when safe.
- `openWorldHint: true` only when the tool reads live external/runtime state.
- `inputSchema.additionalProperties: false`.
- `outputSchema` present.

## Lensically-Style Operator Control Plane

Quant Lab now uses the Lensically-style control-plane shape, but Quant-native and whitelisted. Do not copy Lensically Manifest/account/content/scheduler product logic.

Public MCP tools:

- `get_quant_lab_status`
- `execute_quant_lab_intent`

Everything else is an intent behind `execute_quant_lab_intent`.

Core source files:

- `src/operator/toolRegistry.js`: public MCP descriptors.
- `src/operator/executionKernel.js`: validates the intent envelope, enforces idempotency, dispatches handlers, bounds/redacts output, writes receipts/audit, and returns action closure.
- `src/operator/capabilityDirectory.js`: source of truth for intents, schemas, handlers, risk gates, allowed paths/actions, and tests.
- `src/operator/clientSafeRequests.js`: forbidden keys, path allowlists, blocked artifact paths, result bounds, and redaction.
- `src/operator/capabilityLifecycle.json`: lifecycle declarations for every intent.
- `src/operator/githubApi.js`: server-side GitHub REST/Git data wrapper.
- `src/operator/handlers/controlPlane.js`: Quant-native bounded handlers.
- `src/operator/receipts.js`: D1 operation receipt/audit persistence.

Supported intents:

- `get_engineering_access_state`
- `operator_status`
- `read_continuation`
- `write_continuation`
- `inspect_repository`
- `read_repo_file`
- `list_repo_files`
- `apply_repo_patch_set`
- `create_repo_file`
- `delete_repo_file`
- `run_validation`
- `list_github_actions_runs`
- `trigger_github_workflow`
- `monitor_github_workflow`
- `deploy_cloudflare_worker`
- `apply_d1_migrations`
- `validate_production_sha`

Hard rules enforced:

- No arbitrary shell.
- No arbitrary SQL.
- No raw/unrestricted GitHub API passthrough.
- No raw/unrestricted Cloudflare API passthrough.
- No returned secret values.
- All file paths must pass the source-controlled allowlist.
- Patch sets are exact `find`/`replace` only; each `find` must match exactly once.
- Repo mutations use one GitHub Git data API commit and non-forced branch ref update.
- Mutations require `operation_id` and durable idempotency receipts.
- Deployments and D1 migrations dispatch GitHub Actions using an exact SHA.
- Cloudflare credentials stay in GitHub Actions secrets.

GPT self-update loop:

1. `get_engineering_access_state` to confirm bounded controls and configured server-side access.
2. `inspect_repository` to get branch/head/deployment state.
3. `list_repo_files` and `read_repo_file` to inspect allowlisted source.
4. `apply_repo_patch_set` with `dry_run: true`.
5. `apply_repo_patch_set` with `dry_run: false` after the dry-run passes.
6. `trigger_github_workflow` for `ci.yml`.
7. `monitor_github_workflow` until CI completes.
8. `deploy_cloudflare_worker` with the exact commit SHA, or `apply_d1_migrations` with the exact SHA when only migrations are needed.
9. `monitor_github_workflow` until the deploy/migrations workflow completes.
10. `validate_production_sha` to prove live Worker metadata matches the repository SHA.

Do not add product/trading tools until this control plane is live and verified. Product functionality must be added as additional bounded intents with lifecycle declarations, schemas, tests, receipts, and deployment proof.

## Removed Proof Surfaces

These temporary surfaces were created and then removed:

- public `/mcp`
- public `/status`
- public `/openapi.json`
- no-auth ChatGPT connector
- public status MCP tool as a separate milestone

Why removed:

- Tool discovery must be protected.
- The website can have public selected status, but MCP/control surfaces must be authenticated.
- A fake public status milestone does not advance the autonomous system.

## ChatGPT Dev Connector Setup

Use Chrome, not generic web browsing, because the user already has the right ChatGPT/plugin tab and session open.

Known connector state:

- App ID: `asdk_app_6a667ec3d25c8191920959f517984266`
- Version ID: `asdk_app_v_6a667ec4c9608191b07d4cf48962f3ed`
- Connector OAuth client ID: `quant-lab-dev`
- Server URL: `https://quant-lab-operator.briangriffin355.workers.dev/api/operator/mcp`

Chrome setup path:

1. Open or claim the existing ChatGPT Plugins/Connectors tab.
2. Use `https://chatgpt.com/plugins#settings/Connectors?create-connector=true&redirectAfter=%2Fplugins` for the create-app flow when needed.
3. Upload a valid icon before creation.
4. Use OAuth auth.
5. Use user-defined OAuth client registration.
6. Client ID is `quant-lab-dev`.
7. Client secret is the value stored in Cloudflare as `MCP_CLIENT_SECRET`.
8. Token endpoint auth method is `client_secret_post`.
9. Let the connector discover authorization and token endpoints from metadata.
10. Connect/sign in.
11. Refresh actions after OAuth succeeds.
12. Verify `get_quant_lab_status` appears.
13. Change permissions to `Allow all actions`.

Chrome and Playwright pitfalls:

- If `Tab.url` is not a string/function, use `playwright.evaluate(() => location.href)`.
- Browser `finalize` keep entries must be `{ tab, status: 'handoff' }`.
- Some wrapper methods were unavailable: `locator(...).evaluateAll`, `isChecked`, and `screenshot`.
- Normal DOM `.click()` or `MouseEvent` did not always work on ChatGPT UI.
- Coordinate clicks can hit the wrong `Connect` button. Use dynamic element rects and distinguish the upper header `Connect` from the lower `Sign in with Quant Lab`.
- The acknowledge checkbox sometimes did not toggle when clicking the 16px input. Click the label text block, especially the visible text `I understand and want to continue`.
- Advanced OAuth settings may not open with a first coordinate click. Use a text-targeted click on `Advanced OAuth settings`.
- After connector creation, the page may show `No app actions available yet` until OAuth succeeds and the actions are refreshed.
- After selecting `Allow all actions`, the DOM did not expose a reliable checked radio state, but the visible page showed `Reset`, indicating a non-default setting was applied.

## Icon Pitfall

The user rejected an initial generated icon as poor quality. A simple black upward chart icon was requested. The user then supplied an image directly in the ChatGPT connector UI.

Untracked local artifacts remained in `assets/`:

- `quant-lab-icon.png`
- `quant-lab-icon-v2.png`
- `quant-lab-icon-v3-black.png`

These were not committed. ChatGPT icon upload can reject files over its size limit, so keep the final icon under the UI limit, currently shown as 10 KB during this setup.

## Finding Codex Projects On The PC

Failed interpretation:

- Treating "box" as the Box cloud service.

Correct interpretation:

- The user meant "my box" as in the local PC.
- If the screenshot/sidebar indicates a Codex project, use Codex project/thread tooling or local filesystem search, not the Box connector.

Auto-Threads project found:

- Codex project name: `Auto-Threads-1e52a61ce664`
- Display path: `C:\Auto-Threads`
- Project ID: `local-1e52a61ce664a0ea4dfc686704457363`
- Codex global state file: `C:\Users\brian\.codex\.codex-global-state.json`

## Lensically References

The Quant Lab MCP should follow the Lensically model:

- `C:\Auto-Threads\lensically\CURRENT_STATE.md`
- `C:\Auto-Threads\lensically\lensically-worker\src\index.ts`
- `C:\Auto-Threads\lensically\lensically-worker\test\operatorMode.spec.ts`
- `C:\Auto-Threads\lensically\lensically-worker\src\systemDirectory\clientSafeRequests.ts`
- `C:\Auto-Threads\lensically\lensically-worker\wrangler.jsonc`

Lensically mental model:

- `initialize` returns server metadata, instructions, and `Mcp-Session-Id`.
- `tools/list` returns only public direct typed tools.
- `tools/call` rejects unknown/internal tools.
- Session, policy, idempotency, autonomy, and action-closure handling happen before dispatch.
- Recovery/break-glass infrastructure is separate from the normal MCP route.

## Public Repo Security Boundary

Allowed in public Git:

- `quant_core`
- deterministic judge/backtester code
- Worker source
- D1 migrations
- website source
- tests
- CI workflows
- docs and runbooks without secrets

Not allowed in public Git:

- secret values
- live strategy specs
- private research state
- paper positions
- operational decision records
- generated SQLite databases
- logs
- model files
- local runtime artifacts
- temp secret files
- personal paths unless unavoidable documentation requires them

## Completion State

Completed:

- Single public repo architecture selected.
- Extra public runner repo removed.
- Worker deployed.
- D1 database created and bound.
- Public website live.
- Authenticated MCP route implemented.
- OAuth metadata/authorize/token route implemented.
- ChatGPT dev connector OAuth-connected.
- Actions refreshed.
- Status tool visible as read/open-world.
- Permission mode set to allow all actions.
- CI passed and live remote MCP validation succeeded.
- Lensically-style `execute_quant_lab_intent` control plane implemented.
- Capability directory, client-safety registry, lifecycle manifest, execution kernel, receipts, and audit persistence implemented.
- Bounded GitHub repository read/list/patch/create/delete intents implemented.
- Bounded GitHub Actions list/trigger/monitor intents implemented.
- Exact-SHA Cloudflare deploy and D1 migration dispatch intents implemented.
- Live MCP proof completed for repo read, patch dry-run, CI dispatch/monitor, migration dispatch/monitor, and SHA alignment.

Not yet built:

- candle ingestion tool
- full D1 trading schema
- scheduled trading cycle
- public dashboard metrics
- custom domain
- promotion/autonomous strategy mutation

Exact next functional slice:

Add the first authenticated vertical trading tool to ingest one closed `BTC-USD` hourly candle into D1 and display that stored candle on the public website.
