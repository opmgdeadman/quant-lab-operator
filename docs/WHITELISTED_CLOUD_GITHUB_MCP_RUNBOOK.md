# Whitelisted Cloud, GitHub, Cloudflare, Website, and MCP Runbook

Last updated: 2026-07-26

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

- Commit with consolidated authenticated MCP: `415a6d6017e22db4e76ba1929b5818bb138e04ae`
- Documentation commit after connector setup: `5050d4e`
- Documentation/assets cleanup commit: `605ef228763ae934f59eabf994e016a069c02a3b`
- Known passing GitHub Actions run after remote-first documentation cleanup: `30222233018`
- Do not treat this section as a live "latest commit" ledger; use GitHub Actions for the current source of truth.
- Worker deploy version after MCP secret alignment: `f847112c-8f94-444e-873f-3c5f32f39e32`
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

Do not create secrets unless they are required by an active auth path. The `MCP_CLIENT_SECRET` became necessary only after the authenticated ChatGPT OAuth connector was configured.

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

Not yet built:

- real operational MCP control tools
- candle ingestion tool
- full D1 trading schema
- scheduled trading cycle
- public dashboard metrics
- custom domain
- promotion/autonomous strategy mutation

Exact next functional slice:

Add the first authenticated vertical trading tool to ingest one closed `BTC-USD` hourly candle into D1 and display that stored candle on the public website.
