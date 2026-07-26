const DEFAULT_OWNER = "opmgdeadman";
const DEFAULT_REPO = "quant-lab-operator";
const DEFAULT_BRANCH = "main";
const DEFAULT_DEPLOY_WORKFLOW = "quant-lab-deploy.yml";

export const allowedWorkflowIds = ["ci.yml", DEFAULT_DEPLOY_WORKFLOW];

export function githubConfig(env) {
  return {
    owner: env.GITHUB_OWNER || DEFAULT_OWNER,
    repo: env.GITHUB_REPO || DEFAULT_REPO,
    branch: env.GITHUB_BRANCH || DEFAULT_BRANCH,
    deployWorkflowId: env.GITHUB_DEPLOY_WORKFLOW_ID || DEFAULT_DEPLOY_WORKFLOW,
    tokenConfigured: Boolean(env.GITHUB_TOKEN),
  };
}

export async function githubRequest(env, path, options = {}) {
  const config = githubConfig(env);
  if (!env.GITHUB_TOKEN) {
    return {
      ok: false,
      status: "github_token_not_configured",
      config: safeConfig(config),
    };
  }

  const response = await fetch(`https://api.github.com${path}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "quant-lab-operator",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (response.status === 204) {
    return { ok: true, status_code: response.status, body: null, config: safeConfig(config) };
  }

  let body;
  try {
    body = await response.json();
  } catch {
    body = { message: await response.text() };
  }

  return {
    ok: response.ok,
    status_code: response.status,
    body,
    config: safeConfig(config),
  };
}

export function repoApiPath(env, suffix) {
  const { owner, repo } = githubConfig(env);
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${suffix}`;
}

export function isAllowedWorkflowId(workflowId) {
  return allowedWorkflowIds.includes(workflowId);
}

export function isExactSha(value) {
  return typeof value === "string" && /^[0-9a-f]{40}$/i.test(value);
}

function safeConfig(config) {
  return {
    owner: config.owner,
    repo: config.repo,
    branch: config.branch,
    deploy_workflow_id: config.deployWorkflowId,
    token_configured: config.tokenConfigured,
  };
}
