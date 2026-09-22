import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { discoverProjects, pruneRemovedProjectState } from "../artifact-sync-run.mjs";

describe("artifact sync project discovery", () => {
  it("discovers and deduplicates safe projects with the private API key", async () => {
    const calls = [];
    const projects = await discoverProjects(
      { planInternalUrl: "http://127.0.0.1:3000", planApiKey: "private-plan-key" },
      async (url, init) => {
        calls.push({ url: new URL(url), init });
        return new Response(JSON.stringify([{ key: "VERV" }, { key: "PRIV" }, { key: "VERV" }]), { status: 200 });
      },
    );
    assert.deepEqual(projects, ["verv", "priv"]);
    assert.equal(calls[0].url.toString(), "http://127.0.0.1:3000/projects");
    assert.equal(calls[0].init.headers["x-api-key"], "private-plan-key");
    assert.equal(calls[0].init.headers.Authorization, undefined);
  });

  it("rejects project keys that could escape the destination namespace", async () => {
    await assert.rejects(
      () => discoverProjects(
        { planInternalUrl: "http://127.0.0.1:3000", planApiKey: "private-plan-key" },
        async () => new Response(JSON.stringify([{ key: "../escape" }]), { status: 200 }),
      ),
      /invalid project key/,
    );
  });

  it("prunes only state for projects no longer returned by Plan", async () => {
    let saved;
    const removed = await pruneRemovedProjectState(
      { artifactSyncStatePath: "/private/artifact-sync.json" },
      ["priv", "verv"],
      {
        readJson: async () => ({
          schemaVersion: 1,
          projects: {
            priv: { artifacts: { keep: true } },
            sysqa: { artifacts: { stale: true } },
            sysnew: { artifacts: { stale: true } },
            verv: { artifacts: { keep: true } },
          },
        }),
        writeJsonAtomic: async (_path, value) => { saved = value; },
      },
    );
    assert.deepEqual(removed, ["sysnew", "sysqa"]);
    assert.deepEqual(Object.keys(saved.projects).sort(), ["priv", "verv"]);
    assert.equal(saved.projects.priv.artifacts.keep, true);
    assert.equal(saved.projects.verv.artifacts.keep, true);
  });
});
