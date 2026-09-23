import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  createProjectBrowserDeprovisioner,
  createProjectBrowserProvisioner,
  createProjectBrowserStatus,
  waitForProjectBrowserCdp,
} from "../project-browser.mjs";

let root;
let calls;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "volition-project-browser-"));
  calls = [];
});

afterEach(async () => fs.rm(root, { recursive: true, force: true }));

function config() {
  return {
    projectBrowserRoot: path.join(root, "projects"),
    projectBrowserPublicUrl: "https://plan.example.test/browser/",
    projectBrowserDisplayBase: 200,
    projectBrowserCdpPortBase: 19200,
    projectBrowserVncPortBase: 15900,
    projectBrowserNoVncPortBase: 16080,
    mcookieBin: "/usr/bin/mcookie",
    xauthBin: "/usr/bin/xauth",
    systemctlBin: "/usr/bin/systemctl",
  };
}

async function execute(file, args) {
  calls.push({ file, args });
  if (file.endsWith("mcookie")) return { stdout: "0123456789abcdef0123456789abcdef\n", stderr: "" };
  if (file.endsWith("xauth")) {
    await fs.writeFile(args[1], "private-xauthority", { mode: 0o600 });
  }
  return { stdout: "", stderr: "" };
}

describe("project browser provisioning", () => {
  it("creates isolated persistent profiles and stable loopback runtime allocations", async () => {
    const ensure = createProjectBrowserProvisioner(config(), {
      execute,
      probeCdp: async () => true,
    });
    const demo = await ensure({ id: 7 }, "demo");
    await fs.writeFile(path.join(root, "projects/demo/profile/login-cookie"), "keep", { mode: 0o600 });
    const retried = await ensure({ id: 7 }, "demo");
    const other = await ensure({ id: 8 }, "other");

    assert.deepEqual(retried, demo);
    assert.equal(await fs.readFile(path.join(root, "projects/demo/profile/login-cookie"), "utf8"), "keep");
    assert.notEqual(
      JSON.parse(await fs.readFile(path.join(root, "projects/demo/runtime.json"))).slot,
      JSON.parse(await fs.readFile(path.join(root, "projects/other/runtime.json"))).slot,
    );
    assert.match(demo.url, /^https:\/\/plan\.example\.test\/browser\/projects\/demo\/vnc\.html\?/);
    assert.ok(!JSON.stringify([demo, other]).includes(root));
    assert.ok(!JSON.stringify([demo, other]).includes("0123456789abcdef"));
    assert.equal((await fs.lstat(path.join(root, "projects/demo/runtime.env"))).mode & 0o077, 0);
    assert.equal((await fs.lstat(path.join(root, "projects/demo/run/Xauthority"))).mode & 0o077, 0);
    assert.ok(
      calls.some(
        ({ args }) =>
          args.includes("volition-project-browser-kasm@demo.service") &&
          args.includes("volition-project-browser-chromium@demo.service"),
      ),
    );
    const xauthCall = calls.find(({ file }) => file.endsWith("xauth"));
    assert.ok(xauthCall);
    assert.ok(!JSON.stringify(xauthCall).includes("0123456789abcdef"));
    assert.equal(await fs.readdir(path.join(root, "projects/demo/run")).then((items) => items.some((name) => name.startsWith(".xauth."))), false);
  });

  it("validates loopback CDP discovery and restarts a failed project browser once", async () => {
    assert.equal(
      await waitForProjectBrowserCdp(19201, {
        attempts: 1,
        fetchImpl: async () => ({
          ok: true,
          json: async () => ({
            webSocketDebuggerUrl: "ws://127.0.0.1:19201/devtools/browser/browser-id",
          }),
        }),
      }),
      true,
    );
    assert.equal(
      await waitForProjectBrowserCdp(19201, {
        attempts: 1,
        fetchImpl: async () => ({
          ok: true,
          json: async () => ({
            webSocketDebuggerUrl: "ws://192.168.1.5:19201/devtools/browser/browser-id",
          }),
        }),
      }),
      false,
    );

    let probes = 0;
    const ensure = createProjectBrowserProvisioner(config(), {
      execute,
      probeCdp: async () => (probes += 1) > 1,
    });
    await ensure({ id: 7 }, "demo");
    assert.equal(probes, 2);
    assert.ok(
      calls.some(({ args }) =>
        args.join(" ").includes(
          "restart volition-project-browser-kasm@demo.service volition-project-browser-chromium@demo.service",
        ),
      ),
    );
  });

  it("rejects conflicting identities and symlinked profile storage", async () => {
    const ensure = createProjectBrowserProvisioner(config(), {
      execute,
      probeCdp: async () => true,
    });
    await ensure({ id: 7 }, "demo");
    await assert.rejects(ensure({ id: 9 }, "demo"), /conflicts/);

    await fs.rm(path.join(root, "projects/demo/profile"), { recursive: true });
    await fs.symlink(root, path.join(root, "projects/demo/profile"));
    await assert.rejects(ensure({ id: 7 }, "demo"), /private directory/);
  });

  it("stops and quarantines a project browser without deleting its profile", async () => {
    const browserConfig = config();
    const ensure = createProjectBrowserProvisioner(browserConfig, {
      execute,
      probeCdp: async () => true,
    });
    await ensure({ id: 7 }, "demo");
    await fs.writeFile(path.join(root, "projects/demo/profile/login-cookie"), "keep", {
      mode: 0o600,
    });
    const quarantineRoot = path.join(root, "trash/event-id");
    const deprovision = createProjectBrowserDeprovisioner(browserConfig, { execute });
    const destination = await deprovision({ id: 7 }, "demo", quarantineRoot);
    assert.equal(destination, path.join(quarantineRoot, "browser"));
    assert.equal(
      await fs.readFile(path.join(destination, "profile/login-cookie"), "utf8"),
      "keep",
    );
    assert.ok(
      calls.some(
        ({ args }) =>
          args.join(" ").includes("stop volition-project-browser-kasm@demo.service"),
      ),
    );
    assert.ok(
      calls.some(
        ({ args }) =>
          args.join(" ").includes("stop volition-project-browser-chromium@demo.service"),
      ),
    );
    for (const legacyUnit of ["xvfb", "vnc", "novnc"]) {
      assert.ok(
        calls.some(({ args }) =>
          args.join(" ").includes(`stop volition-project-browser-${legacyUnit}@demo.service`),
        ),
      );
    }
    assert.equal(await deprovision({ id: 7 }, "demo", quarantineRoot), destination);
  });

  it("tolerates absent legacy units but surfaces actual systemd failures", async () => {
    const browserConfig = config();
    const ensure = createProjectBrowserProvisioner(browserConfig, {
      execute,
      probeCdp: async () => true,
    });
    await ensure({ id: 7 }, "demo");
    const deprovision = createProjectBrowserDeprovisioner(browserConfig, {
      execute: async (file, args) => {
        if (args.at(-1).includes("-xvfb@")) {
          const error = new Error("Unit could not be found");
          error.stderr = "Unit not found";
          throw error;
        }
        return execute(file, args);
      },
    });
    await deprovision({ id: 7 }, "demo", path.join(root, "trash/event-id"));

    const ensureOther = createProjectBrowserProvisioner(browserConfig, {
      execute,
      probeCdp: async () => true,
    });
    await ensureOther({ id: 8 }, "other");
    const broken = createProjectBrowserDeprovisioner(browserConfig, {
      execute: async (file, args) => {
        if (args.at(-1).includes("-kasm@")) throw new Error("systemd bus unavailable");
        return execute(file, args);
      },
    });
    await assert.rejects(
      broken({ id: 8 }, "other", path.join(root, "trash/other-event")),
      /systemd bus unavailable/,
    );
    assert.equal(
      await fs.readFile(path.join(root, "projects/other/runtime.json"), "utf8").then(Boolean),
      true,
    );
  });
});

describe("project browser status", () => {
  it("is active only while both project units are active", async () => {
    const answers = [
      { stdout: "active\nactive\n" },
      Object.assign(new Error("Command failed"), { stdout: "active\ninactive\n", code: 3 }),
    ];
    const seen = [];
    const active = createProjectBrowserStatus(config(), {
      execute: async (file, args) => {
        seen.push(args);
        const answer = answers.shift();
        if (answer instanceof Error) throw answer;
        return { ...answer, stderr: "" };
      },
    });
    assert.equal(await active("demo"), true);
    assert.equal(await active("demo"), false);
    assert.equal(await active("../demo"), false);
    assert.deepEqual(seen[0], [
      "--user",
      "is-active",
      "volition-project-browser-kasm@demo.service",
      "volition-project-browser-chromium@demo.service",
    ]);
    assert.equal(seen.length, 2);
  });
});
