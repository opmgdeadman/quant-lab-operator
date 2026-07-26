import { spawnSync } from "node:child_process";

const isDryRun = process.argv.includes("--dry-run");
const explicitSha = process.env.DEPLOYMENT_SHA || process.env.GITHUB_SHA || "";
const gitSha = explicitSha || git("rev-parse", "HEAD");
const phase = process.env.CURRENT_PHASE || "operator-control-plane";

if (!gitSha || gitSha === "unknown") {
  throw new Error("Unable to resolve deployment SHA from DEPLOYMENT_SHA, GITHUB_SHA, or git rev-parse HEAD");
}

const command = process.platform === "win32" ? "node_modules\\.bin\\wrangler.cmd" : "node_modules/.bin/wrangler";
const args = [
  "deploy",
  "--config",
  "wrangler.jsonc",
  "--var",
  `DEPLOYMENT_SHA:${gitSha}`,
  "--var",
  `REPOSITORY_SHA:${gitSha}`,
  "--var",
  `CURRENT_PHASE:${phase}`,
];

if (isDryRun) {
  args.push("--dry-run");
}

const result = spawnSync(command, args, {
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);

function git(...args) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    return "";
  }
  return result.stdout.trim();
}
