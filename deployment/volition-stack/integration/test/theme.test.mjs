import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { parse } from "jsonc-parser";
import { createThemeService, ThemeValidationError } from "../theme.mjs";

const directories = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true })));
});

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "volition-theme-"));
  directories.push(directory);
  const codeSettingsPath = path.join(directory, "settings.json");
  await fs.writeFile(
    codeSettingsPath,
    '{\n  // Keep human settings and comments.\n  "editor.fontSize": 15,\n}\n',
    { mode: 0o600 },
  );
  return {
    codeSettingsPath,
    nextcloudInternalUrl: "http://127.0.0.1:8092",
    nextcloudHost: "cloud.volition.one",
    nextcloudUser: "owner@example.com",
    nextcloudPassword: "private-nextcloud-password",
  };
}

describe("theme synchronization", () => {
  it("preserves native settings and updates all configured services", async () => {
    const config = await fixture();
    const calls = [];
    const openClaw = { setTheme: async (theme) => calls.push({ service: "openclaw", theme }) };
    const request = async (url, init) => {
      calls.push({ service: "nextcloud", url: String(url), init });
      return new Response(null, { status: 200 });
    };
    const result = await createThemeService(config, { fetch: request, openClaw }).apply({ theme: "dark" });
    assert.deepEqual(result.results.map(({ service, status, attempts }) => ({ service, status, attempts })), [
      { service: "openclaw", status: "updated", attempts: 1 },
      { service: "code", status: "updated", attempts: 1 },
      { service: "nextcloud", status: "updated", attempts: 1 },
    ]);
    const source = await fs.readFile(config.codeSettingsPath, "utf8");
    const settings = parse(source);
    assert.equal(settings["editor.fontSize"], 15);
    assert.equal(settings["window.autoDetectColorScheme"], false);
    assert.equal(settings["workbench.colorTheme"], "Default Dark Modern");
    assert.match(source, /Keep human settings and comments/);
    const nextcloud = calls.find((call) => call.service === "nextcloud");
    assert.match(nextcloud.url, /\/theme\/dark\/enable\?format=json$/);
    assert.equal(nextcloud.init.headers.Host, "cloud.volition.one");
  });

  it("retries once, reports a bounded partial failure, and rejects other values", async () => {
    const config = await fixture();
    let openClawCalls = 0;
    const openClaw = {
      setTheme: async () => {
        openClawCalls += 1;
        throw new Error("profile unavailable");
      },
    };
    const request = async (_url, init) =>
      init.method === "GET"
        ? new Response(JSON.stringify({ settings: {} }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        : new Response(null, { status: 200 });
    const result = await createThemeService(config, { fetch: request, openClaw }).apply({ theme: "light" });
    assert.equal(openClawCalls, 2);
    assert.deepEqual(result.results[0], {
      service: "openclaw",
      status: "failed",
      attempts: 2,
      error: "profile unavailable",
    });
    await assert.rejects(
      () => createThemeService(config, { fetch: request, openClaw }).apply({ theme: "system" }),
      ThemeValidationError,
    );
  });
});
