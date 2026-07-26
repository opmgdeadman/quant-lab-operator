import assert from "node:assert/strict";
import test from "node:test";

import {
  assertAllowedRepoPath,
  assertClientSafeInputs,
  boundResultBytes,
  redactSecrets,
} from "../src/operator/clientSafeRequests.js";

test("forbidden public input keys reject", () => {
  assert.throws(() => assertClientSafeInputs({ nested: { token: "not-real" } }), /forbidden_public_input_key/);
  assert.throws(() => assertClientSafeInputs({ sql: "select 1" }), /forbidden_public_input_key/);
});

test("path traversal and unallowlisted files reject", () => {
  assert.doesNotThrow(() => assertAllowedRepoPath("README.md"));
  assert.throws(() => assertAllowedRepoPath("../.env"), /forbidden_path/);
  assert.throws(() => assertAllowedRepoPath("migrations/0001_infrastructure_shell.sql"), /forbidden_path/);
});

test("secret-like outputs are redacted", () => {
  const redacted = redactSecrets({
    authorization: "Bearer abcdefghijklmnopqrstuvwxyz123456",
    token: "ghp_abcdefghijklmnopqrstuvwxyz123456",
  });
  assert.doesNotMatch(redacted, /Bearer abc/);
  assert.doesNotMatch(redacted, /ghp_/);
  assert.match(redacted, /\[REDACTED\]/);
});

test("oversized results are bounded", () => {
  const bounded = boundResultBytes({ text: Array(300).fill("word").join(" ") }, 50);
  assert.equal(bounded.truncated, true);
  assert.equal(bounded.max_response_bytes, 50);
});
