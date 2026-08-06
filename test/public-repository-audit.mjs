import { execFileSync } from "node:child_process";
import path from "node:path";

const MAX_TEXT_BLOB_BYTES = 2 * 1024 * 1024;
const MAX_BUFFER_BYTES = 64 * 1024 * 1024;

function git(args, options = {}) {
  return execFileSync("git", args, {
    cwd: process.cwd(),
    encoding: options.binary ? null : "utf8",
    maxBuffer: MAX_BUFFER_BYTES,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function joined(...parts) {
  return parts.join("");
}

const secretPatterns = [
  {
    id: "github_legacy_token",
    expression: new RegExp(joined("gh", "[pousr]_[A-Za-z0-9_]{20,}"), "g"),
  },
  {
    id: "github_fine_grained_token",
    expression: new RegExp(joined("github_", "pat_[A-Za-z0-9_]{20,}"), "g"),
  },
  {
    id: "openai_secret_key",
    expression: new RegExp(joined("sk", "-(?:proj-)?[A-Za-z0-9_-]{20,}"), "g"),
  },
  {
    id: "stripe_live_secret",
    expression: new RegExp(joined("sk_", "live_[A-Za-z0-9]{16,}"), "g"),
  },
  {
    id: "aws_access_key",
    expression: new RegExp(joined("AK", "IA[0-9A-Z]{16}"), "g"),
  },
  {
    id: "slack_token",
    expression: new RegExp(joined("xo", "x[baprs]-[A-Za-z0-9-]{10,}"), "g"),
  },
  {
    id: "private_key",
    expression: new RegExp(joined("-----BEGIN ", "(?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----"), "g"),
  },
  {
    id: "credentialed_url",
    expression: /https?:\/\/[^/\s:@]+:[^/\s@]+@/g,
  },
];

const sensitiveVariableNames = [
  joined("GITHUB_", "TOKEN"),
  joined("CLOUDFLARE_API_", "TOKEN"),
  joined("RECOVERY_API_", "TOKEN"),
  joined("MCP_CLIENT_", "SECRET"),
  joined("CLIENT_", "SECRET"),
  joined("PRIVATE_", "KEY"),
  joined("API_", "KEY"),
];

secretPatterns.push({
  id: "literal_secret_assignment",
  blocking: false,
  expression: new RegExp(
    `(?:${sensitiveVariableNames.join("|")})\\s*[:=]\\s*["'\\x60](?!(?:test|example|fake|dummy|placeholder|synthetic|development|set-by)-)[A-Za-z0-9_./+=-]{16,}["'\\x60]`,
    "g",
  ),
});

secretPatterns.push(
  {
    id: "personal_windows_home_path",
    blocking: false,
    expression: new RegExp(joined("[A-Za-z]:\\\\", "Users\\\\[^\\\\\\r\\n]+\\\\"), "g"),
  },
  {
    id: "private_chatgpt_connector_id",
    blocking: false,
    expression: new RegExp(joined("asdk_", "app(?:_v)?_[A-Za-z0-9]{16,}"), "g"),
  },
  {
    id: "local_codex_project_id",
    blocking: false,
    expression: new RegExp(joined("local-", "[a-f0-9]{16,}"), "gi"),
  },
  {
    id: "local_codex_profile_path",
    blocking: false,
    expression: new RegExp(joined("\\.co", "dex[\\\\/]profiles[\\\\/]"), "gi"),
  },
);

const suspiciousFileMatchers = [
  { id: "dotenv_file", test: (value) => /(^|\/)\.env(?:\.|$)/i.test(value) && !/\.env\.(?:example|sample|template)$/i.test(value) },
  { id: "cloudflare_local_secrets", test: (value) => /(^|\/)\.dev\.vars(?:\.|$)/i.test(value) && !/\.dev\.vars\.(?:example|sample|template)$/i.test(value) },
  { id: "private_key_file", test: (value) => /\.(?:pem|p12|pfx|key)$/i.test(value) },
  { id: "ssh_private_key", test: (value) => /(^|\/)(?:id_rsa|id_ed25519)$/i.test(value) },
  { id: "credential_bundle", test: (value) => /(^|\/)(?:credentials|secrets)\.json$/i.test(value) },
];

const syntheticSecretFixturePaths = new Set([
  "test/operator-client-safety.test.js",
]);

const findings = [];
const currentBlobIds = new Set(
  git(["ls-tree", "-r", "HEAD"])
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split(/\s+/)[2])
    .filter(Boolean),
);
const objects = git(["rev-list", "--objects", "--all"]).trim().split("\n").filter(Boolean);
const seenBlobs = new Set();

for (const line of objects) {
  const separator = line.indexOf(" ");
  if (separator === -1) {
    continue;
  }
  const objectId = line.slice(0, separator);
  const objectPath = line.slice(separator + 1);

  for (const matcher of suspiciousFileMatchers) {
    if (matcher.test(objectPath)) {
      findings.push({ category: matcher.id, location: objectPath, objectId, blocking: true });
    }
  }

  if (seenBlobs.has(objectId)) {
    continue;
  }
  seenBlobs.add(objectId);

  if (git(["cat-file", "-t", objectId]).trim() !== "blob") {
    continue;
  }
  const size = Number(git(["cat-file", "-s", objectId]).trim());
  if (!Number.isFinite(size) || size > MAX_TEXT_BLOB_BYTES) {
    continue;
  }

  const data = git(["cat-file", "-p", objectId], { binary: true });
  if (data.includes(0)) {
    continue;
  }
  const text = data.toString("utf8");
  for (const pattern of secretPatterns) {
    if (pattern.id === "github_legacy_token" && syntheticSecretFixturePaths.has(objectPath)) {
      continue;
    }
    pattern.expression.lastIndex = 0;
    if (pattern.expression.test(text)) {
      findings.push({
        category: pattern.id,
        location: objectPath,
        objectId,
        blocking: pattern.blocking !== false || currentBlobIds.has(objectId),
      });
    }
  }
}

const emailAllowlist = new Set(["example.com", "users.noreply.github.com"]);
const commitIdentityRows = git(["log", "--all", "--format=%H%x09%ae%x09%ce"]).trim().split("\n").filter(Boolean);
for (const row of commitIdentityRows) {
  const [commitId, authorEmail = "", committerEmail = ""] = row.split("\t");
  for (const email of new Set([authorEmail, committerEmail])) {
    const domain = email.toLowerCase().split("@").at(-1) || "";
    if (email && !emailAllowlist.has(domain)) {
      findings.push({ category: "non_noreply_commit_email", location: `commit:${commitId}`, objectId: commitId, blocking: false });
    }
  }
}

const uniqueFindings = Array.from(
  new Map(findings.map((finding) => [`${finding.category}:${finding.location}:${finding.objectId}`, finding])).values(),
);

const selectedCategories = new Set(
  String(process.env.AUDIT_CATEGORIES || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const selectedPathPrefixes = String(process.env.AUDIT_PATH_PREFIXES || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const scopedFindings = uniqueFindings.filter((finding) => {
  if (selectedCategories.size > 0 && !selectedCategories.has(finding.category)) {
    return false;
  }
  if (selectedPathPrefixes.length > 0 && !selectedPathPrefixes.some((prefix) => finding.location.startsWith(prefix))) {
    return false;
  }
  return true;
});

const blockingFindings = scopedFindings.filter((finding) => finding.blocking !== false);
const warningFindings = scopedFindings.filter((finding) => finding.blocking === false);

if (warningFindings.length > 0) {
  console.warn(`Public repository audit recorded ${warningFindings.length} historical privacy warning(s).`);
  for (const finding of warningFindings) {
    console.warn(`- ${finding.category} at ${finding.location} (${finding.objectId.slice(0, 12)})`);
  }
}

if (blockingFindings.length > 0) {
  console.error(`Public repository audit failed with ${blockingFindings.length} blocking finding(s).`);
  for (const finding of blockingFindings) {
    console.error(`- ${finding.category} at ${finding.location} (${finding.objectId.slice(0, 12)})`);
  }
  process.exit(1);
}

const currentHead = git(["rev-parse", "HEAD"]).trim();
const trackedFileCount = git(["ls-files"]).trim().split("\n").filter(Boolean).length;
console.log(`Public repository audit passed for ${currentHead}: ${seenBlobs.size} historical blobs and ${trackedFileCount} tracked files checked.`);
