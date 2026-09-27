import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { compare, compareTask, compareUnchanged, fixtureUrl, selectFixture } from "./observe.mjs";

const fixture = "http://127.0.0.1:46001/fixture.html";
const before = {
  schema: 1, slug: "bproof-a", fixture, targetId: "A".repeat(32), pageCount: 1,
  observedAt: 1000, documentId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", timeOrigin: 500,
  counter: 1, heartbeat: 10, nameMatches: false, accepted: false,
};

test("only the single exact synthetic fixture may be observed", () => {
  const target = { type: "page", id: before.targetId, url: fixture };
  assert.equal(selectFixture([target], fixture), target);
  for (const pages of [[], [target, target], [{ ...target, url: "https://private.example/" }], [{ ...target, id: undefined }]])
    assert.throws(() => selectFixture(pages, fixture));
  for (const url of ["file:///fixture.html", "https://private.example/fixture.html", "http://user:password@localhost/fixture.html", `${fixture}?key=x`, `${fixture}#x`])
    assert.throws(() => fixtureUrl(url));
});

test("a new target, navigation, other project or reverse timestamps cannot pass reconnect", () => {
  const after = { ...before, observedAt: 2000, counter: 2, heartbeat: 11 };
  assert.deepEqual(compare(before, after), {
    sameProject: true, sameTarget: true, sameDocument: true, inputCounterAdvanced: true, pageCount: 1,
    elapsedMs: 1000, counterBefore: 1, counterAfter: 2, heartbeatDelta: 1,
  });
  for (const change of [
    { slug: "bproof-b" }, { targetId: "B".repeat(32) }, { pageCount: 2 },
    { documentId: "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee" }, { timeOrigin: 600 },
    { fixture: "http://127.0.0.1:46002/fixture.html" }, { observedAt: 999 },
    { counter: 1 }, { counter: 3 }, { heartbeat: 9 },
  ]) assert.throws(() => compare(before, { ...after, ...change }));
});

test("malformed or incomplete evidence cannot produce a pass", () => {
  for (const change of [
    { timeOrigin: undefined }, { timeOrigin: NaN }, { observedAt: NaN },
    { counter: -1 }, { heartbeat: undefined }, { heartbeat: 1.5 },
    { documentId: "-".repeat(36) }, { slug: undefined }, { slug: 123 }, { targetId: undefined },
  ]) {
    const invalid = { ...before, ...change };
    assert.throws(() => compare(invalid, { ...invalid, observedAt: 2000, counter: 2 }));
  }
});

test("a task needs fresh field and result success in the same untouched document", () => {
  const after = { ...before, observedAt: 2000, heartbeat: 11, nameMatches: true, accepted: true };
  assert.equal(compareTask(before, after).fixtureSuccessObserved, true);
  for (const change of [
    { accepted: false }, { nameMatches: false }, { accepted: "true" }, { nameMatches: undefined },
    { counter: 2 }, { slug: "bproof-b" }, { targetId: "B".repeat(32) }, { timeOrigin: 600 },
    { pageCount: 2 }, { documentId: "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee" },
    { observedAt: 1000 }, { fixture: "http://127.0.0.1:46002/fixture.html" },
  ]) assert.throws(() => compareTask(before, { ...after, ...change }));
  assert.throws(() => compareTask({ ...before, accepted: true }, after));
  assert.throws(() => compareTask({ ...before, nameMatches: true }, after));
  assert.throws(() => compareTask({ ...before, accepted: undefined }, after));
  assert.throws(() => compare(before, after));
});

test("unchanged evidence reports only the monitored fixture outcome", () => {
  const after = { ...before, observedAt: 2000, heartbeat: 11 };
  const evidence = compareUnchanged(before, after);
  assert.equal(evidence.fixtureOutcomeUnchanged, true);
  assert.equal("noActions" in evidence, false);
  for (const change of [
    { nameMatches: true }, { accepted: true }, { counter: 2 }, { nameMatches: null },
    { accepted: undefined }, { slug: "bproof-b" }, { timeOrigin: 600 }, { heartbeat: 9 },
  ]) assert.throws(() => compareUnchanged(before, { ...after, ...change }));
  assert.throws(() => compareTask(before, after));
});

test("the CLI refuses an unprivileged invocation before opening browser state", {
  skip: process.getuid?.() === 0,
}, () => {
  const result = spawnSync(process.execPath, [
    fileURLToPath(new URL("./observe.mjs", import.meta.url)), "snapshot", "bproof-a", fixture,
  ], { encoding: "utf8", timeout: 2000 });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr,
    "Browser proof observer refused or failed. Check the runbook preconditions; no pass was recorded.\n");
});
