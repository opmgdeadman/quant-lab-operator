import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const testFiles = readdirSync(new URL(".", import.meta.url))
  .filter((name) => name.endsWith(".test.js"))
  .sort();

if (testFiles.length === 0) {
  throw new Error("no_test_files_found");
}

for (const testFile of testFiles) {
  const result = spawnSync(process.execPath, ["--test", new URL(testFile, import.meta.url).pathname], {
    stdio: "inherit",
    shell: false,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
