import { spawnSync } from "node:child_process";

const isDryRun = process.argv.includes("--dry-run");
const explicitSha = process.env.DEPLOYMENT_SHA || process.env.GITHUB_SHA || "";
const gitSha = explicitSha || git("rev-parse", "HEAD");
const phase = "dormant-read-only";

if (!gitSha || gitSha === "unknown") {
  throw new Error("Unable to resolve deployment SHA from DEPLOYMENT_SHA, GITHUB_SHA, or git rev-parse HEAD");
}

const command = process.platform === "win32" ? "node_modules\\.bin\\wrangler.cmd" : "node_modules/.bin/wrangler";

if (!isDryRun) {
  runWrangler([
    "d1",
    "migrations",
    "apply",
    "quant_lab_operator",
    "--remote",
    "--config",
    "wrangler.jsonc",
  ]);
}

const deployArgs = [
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

if (isDryRun) deployArgs.push("--dry-run");
runWrangler(deployArgs);

function runWrangler(args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);
}

function git(...args) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) return "";
  return result.stdout.trim();
}
