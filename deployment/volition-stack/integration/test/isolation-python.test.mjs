import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// The agent isolation's own unit tests, the Hermes catalog's, the CLI runtime installer's and
// the token keeper's are Python; this runs them
// with the integration suite, so they are part of every full test.
const here = path.dirname(fileURLToPath(import.meta.url));

for (const [name, args] of [
  ["agent isolation", ["-m", "unittest", "discover", "-s", path.join(here, "../../isolation/tests"), "-q"]],
  ["Hermes runner catalog", [path.join(here, "hermes-model-catalog.test.py")]],
  ["CLI runtime installer", [path.join(here, "../../native/runtimes/test_install_cli_runtimes.py")]],
  // The Hermes half (test_token_keeper_hermes.py) needs Hermes' interpreter and skips here.
  ["token keeper", [path.join(here, "../../native/token-keeper/test_helena_token_keeper.py")]],
  ["token keeper with Hermes", [path.join(here, "../../native/token-keeper/test_token_keeper_hermes.py")]],
]) {
  test(`${name} (python unittest)`, () => {
    const run = spawnSync("python3", args, { encoding: "utf8", timeout: 120_000 });
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`.slice(-3000));
  });
}
