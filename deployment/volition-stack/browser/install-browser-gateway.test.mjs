// native/install-browser-gateway.sh against a scratch tree (GATEWAY_TEST=1 and the GATEWAY_*
// paths), kept with the router's tests so the full test runs it. What matters most: the
// installer never changes a directory that exists. On 2026-09-24 it set /etc/volition to
// 0750 while creating the token; the runner and the API could no longer reach their own files
// there, and the runner went into a restart loop.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const installer = path.join(here, "../native/install-browser-gateway.sh");
const bun = spawnSync("bash", ["-c", "command -v bun"], { encoding: "utf8" }).stdout.trim();
const scratch = [];

after(async () => {
  for (const dir of scratch) await fs.rm(dir, { recursive: true, force: true });
});

async function tree({ etc = 0o751, withEtc = true, dropinDir = null, state = false } = {}) {
  const root = await fs.mkdtemp(path.join(process.env.TMPDIR || os.tmpdir(), "gw-install-"));
  scratch.push(root);
  const etcDir = path.join(root, "etc/volition");
  await fs.mkdir(path.join(root, "etc"), { recursive: true });
  if (withEtc) {
    await fs.mkdir(etcDir);
    await fs.chmod(etcDir, etc);
    await fs.writeFile(path.join(etcDir, "plan.env"), "KEEP=1\n");
  }
  const units = path.join(root, "systemd");
  await fs.mkdir(units);
  if (dropinDir !== null) {
    const dir = path.join(units, "volition-plan-api.service.d");
    await fs.mkdir(dir);
    await fs.chmod(dir, dropinDir);
  }
  if (state) await fs.mkdir(path.join(root, "project-browser"));
  const log = path.join(root, "systemctl.log");
  const systemctl = path.join(root, "systemctl");
  await fs.writeFile(systemctl, `#!/bin/sh\necho "$*" >> "${log}"\n`, { mode: 0o755 });
  return {
    root,
    etcDir,
    token: path.join(etcDir, "browser-gateway.token"),
    units,
    log,
    env: {
      ...process.env,
      GATEWAY_TEST: "1",
      GATEWAY_SHIM: path.join(root, "libexec/helena-browser-mcp"),
      GATEWAY_TOKEN: path.join(etcDir, "browser-gateway.token"),
      GATEWAY_UNITS: units,
      GATEWAY_BROWSER_STATE: path.join(root, "project-browser"),
      GATEWAY_SYSTEMCTL: systemctl,
      GATEWAY_BUN: bun,
    },
  };
}

function install(target, ...args) {
  const result = spawnSync(installer, ["install", ...args], { env: target.env, encoding: "utf8" });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

const mode = async (file) => (await fs.stat(file)).mode & 0o777;
const exists = (file) => fs.access(file).then(() => true, () => false);

describe("install-browser-gateway.sh", { skip: !bun && "bun is not installed" }, () => {
  it("never changes an existing /etc/volition, and writes the token 0600 into it", async () => {
    for (const etc of [0o751, 0o755]) {
      const target = await tree({ etc });
      install(target);
      assert.equal(await mode(target.etcDir), etc, `mode of /etc/volition (${etc.toString(8)})`);
      assert.equal(await mode(target.token), 0o600);
      assert.match(await fs.readFile(target.token, "utf8"), /^[A-Za-z0-9+/]{40,}$/);
      assert.equal(await fs.readFile(path.join(target.etcDir, "plan.env"), "utf8"), "KEEP=1\n");
    }
  });

  it("creates a missing /etc/volition as 0751, traversable for the services", async () => {
    const target = await tree({ withEtc: false });
    install(target);
    assert.equal(await mode(target.etcDir), 0o751);
    assert.equal(await mode(target.token), 0o600);
  });

  it("leaves an existing drop-in directory as it is, and adds the token drop-ins", async () => {
    const target = await tree({ dropinDir: 0o750 });
    install(target);
    assert.equal(await mode(path.join(target.units, "volition-plan-api.service.d")), 0o750);
    for (const unit of ["volition-plan-api.service", "volition-project-browser-router.service"]) {
      const dropin = await fs.readFile(path.join(target.units, `${unit}.d/browser-gateway.conf`), "utf8");
      assert.match(dropin, /LoadCredential=browser_gateway_token:/);
      assert.match(dropin, /BROWSER_GATEWAY_TOKEN_FILE=%d\/browser_gateway_token/);
    }
    assert.equal((await fs.readFile(target.log, "utf8")).trim(), "daemon-reload");
  });

  it("is idempotent: a second run keeps the token and reloads nothing", async () => {
    const target = await tree({ state: true });
    install(target);
    const token = await fs.readFile(target.token, "utf8");
    await fs.rm(target.log);
    install(target);
    assert.equal(await fs.readFile(target.token, "utf8"), token);
    assert.equal(await exists(target.log), false);
    assert.equal(await mode(path.join(target.root, "project-browser/downloads")), 0o700);
  });

  it("changes nothing with --dry-run", async () => {
    const target = await tree({ withEtc: false });
    const out = install(target, "--dry-run");
    assert.match(out, /would create the browser gateway's service token/);
    assert.equal(await exists(target.etcDir), false);
    assert.equal(await exists(path.join(target.units, "volition-plan-api.service.d")), false);
    assert.equal(await exists(target.env.GATEWAY_SHIM), false);
  });
});
