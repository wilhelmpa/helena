import assert from "node:assert/strict";
import { it } from "node:test";
import { createThemeService } from "../theme.mjs";

it("syncs only Code and Nextcloud", async () => {
  const service = createThemeService({ codeSettingsPath: "/tmp/volition-theme-test.json", nextcloudInternalUrl: "http://127.0.0.1:1", nextcloudHost: "cloud.example", nextcloudUser: "owner", nextcloudPassword: "x" }, { fetch: async () => ({ ok: true, status: 200 }) });
  const result = await service.apply({ theme: "dark" });
  assert.deepEqual(result.results.map((item) => item.service).sort(), ["code", "nextcloud"]);
});
