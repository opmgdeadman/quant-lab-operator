const DEFAULT_OWNER = "opmgdeadman";
const DEFAULT_REPO = "quant-lab-operator";
const DEFAULT_BRANCH = "main";
const DEFAULT_DEPLOY_WORKFLOW = "quant-lab-deploy.yml";
const RECOVERY_DEPLOY_WORKFLOW = "quant-lab-recovery-deploy.yml";

export const allowedWorkflowIds = ["ci.yml", DEFAULT_DEPLOY_WORKFLOW, RECOVERY_DEPLOY_WORKFLOW];

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

export async function readRepoContent(env, path, ref) {
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const remote = await githubRequest(env, repoApiPath(env, `/contents/${encodeURIComponentPath(path)}${query}`));
  if (!remote.ok) {
    return remote;
  }
  if (Array.isArray(remote.body)) {
    return { ok: true, body: remote.body, config: remote.config };
  }
  return {
    ok: true,
    body: {
      ...remote.body,
      decoded_content: decodeBase64Content(remote.body.content || ""),
    },
    config: remote.config,
  };
}

export async function commitRepoChanges(env, { message, changes, expectedHeadSha }) {
  const config = githubConfig(env);
  const refPath = repoApiPath(env, `/git/ref/heads/${encodeURIComponent(config.branch)}`);
  const updateRefPath = repoApiPath(env, `/git/refs/heads/${encodeURIComponent(config.branch)}`);
  const ref = await githubRequest(env, refPath);
  if (!ref.ok) {
    return { ok: false, status: ref.status || "github_ref_lookup_failed", status_code: ref.status_code, config: ref.config };
  }

  const headSha = ref.body.object.sha;
  if (expectedHeadSha && expectedHeadSha !== headSha) {
    return {
      ok: false,
      status: "head_sha_mismatch",
      expected_head_sha: expectedHeadSha,
      actual_head_sha: headSha,
      config: ref.config,
    };
  }

  const headCommit = await githubRequest(env, repoApiPath(env, `/git/commits/${encodeURIComponent(headSha)}`));
  if (!headCommit.ok) {
    return { ok: false, status: headCommit.status || "github_head_commit_lookup_failed", status_code: headCommit.status_code, config: headCommit.config };
  }

  const tree = [];
  for (const change of changes) {
    if (change.type === "delete") {
      tree.push({ path: change.path, mode: "100644", type: "blob", sha: null });
      continue;
    }
    const blob = await githubRequest(env, repoApiPath(env, "/git/blobs"), {
      method: "POST",
      body: { content: change.content, encoding: "utf-8" },
    });
    if (!blob.ok) {
      return { ok: false, status: blob.status || "github_blob_create_failed", status_code: blob.status_code, path: change.path, config: blob.config };
    }
    tree.push({ path: change.path, mode: "100644", type: "blob", sha: blob.body.sha });
  }

  const newTree = await githubRequest(env, repoApiPath(env, "/git/trees"), {
    method: "POST",
    body: { base_tree: headCommit.body.tree.sha, tree },
  });
  if (!newTree.ok) {
    return { ok: false, status: newTree.status || "github_tree_create_failed", status_code: newTree.status_code, config: newTree.config };
  }

  const commit = await githubRequest(env, repoApiPath(env, "/git/commits"), {
    method: "POST",
    body: { message, tree: newTree.body.sha, parents: [headSha] },
  });
  if (!commit.ok) {
    return { ok: false, status: commit.status || "github_commit_create_failed", status_code: commit.status_code, config: commit.config };
  }

  const update = await githubRequest(env, updateRefPath, {
    method: "PATCH",
    body: { sha: commit.body.sha, force: false },
  });
  if (!update.ok) {
    return { ok: false, status: update.status || "github_ref_update_failed", status_code: update.status_code, commit_sha: commit.body.sha, config: update.config };
  }

  return {
    ok: true,
    status: "committed",
    branch: config.branch,
    previous_head_sha: headSha,
    commit_sha: commit.body.sha,
    changed_paths: changes.map((change) => change.path),
    config: update.config,
  };
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

function encodeURIComponentPath(path) {
  return path.split("/").map((part) => encodeURIComponent(part)).join("/");
}

function decodeBase64Content(content) {
  const compact = content.replace(/\s/g, "");
  if (typeof atob === "function") {
    const binary = atob(compact);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new TextDecoder().decode(bytes);
  }
  return Buffer.from(compact, "base64").toString("utf8");
}
