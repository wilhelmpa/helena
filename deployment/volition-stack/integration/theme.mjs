import fs from "node:fs/promises";
import path from "node:path";
import { applyEdits, modify, parse } from "jsonc-parser";

const THEMES = new Set(["light", "dark"]);
const MAX_SETTINGS_BYTES = 1024 * 1024;

export class ThemeValidationError extends Error {}

function safeTheme(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !THEMES.has(value.theme)) {
    throw new ThemeValidationError("Theme must be light or dark");
  }
  return value.theme;
}

async function checkedResponse(response, service) {
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`${service} rejected the theme update`);
  }
  return response;
}

async function updateCodeSettings(filePath, theme) {
  const stat = await fs.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error("Code theme settings are not a private regular file");
  }
  if (stat.size > MAX_SETTINGS_BYTES) throw new Error("Code theme settings are too large");
  let source = await fs.readFile(filePath, "utf8");
  const errors = [];
  parse(source, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length) throw new Error("Code theme settings are invalid");
  const formattingOptions = { insertSpaces: true, tabSize: 2, eol: "\n" };
  source = applyEdits(
    source,
    modify(source, ["window.autoDetectColorScheme"], false, { formattingOptions }),
  );
  source = applyEdits(
    source,
    modify(
      source,
      ["workbench.colorTheme"],
      theme === "dark" ? "Default Dark Modern" : "Default Light Modern",
      { formattingOptions },
    ),
  );
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.tmp`);
  const handle = await fs.open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(source, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.rename(temporary, filePath);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

async function updateNextcloud(config, request, theme) {
  const target = new URL(
    `/ocs/v2.php/apps/theming/api/v1/theme/${theme}/enable?format=json`,
    config.nextcloudInternalUrl,
  );
  await checkedResponse(
    await request(target, {
      method: "PUT",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.nextcloudUser}:${config.nextcloudPassword}`).toString("base64")}`,
        Host: config.nextcloudHost,
        "OCS-APIRequest": "true",
      },
    }),
    "Nextcloud",
  );
}

async function withRetry(operation) {
  let lastError;
  for (let attempts = 1; attempts <= 2; attempts += 1) {
    try {
      await operation();
      return { status: "updated", attempts };
    } catch (error) {
      lastError = error;
    }
  }
  return {
    status: "failed",
    attempts: 2,
    error: lastError instanceof Error ? lastError.message.slice(0, 200) : "Theme update failed",
  };
}

export function createThemeService(config, options = {}) {
  const request = options.fetch ?? fetch;
  const openClaw = options.openClaw;
  let mutation = Promise.resolve();

  async function apply(input) {
    const theme = safeTheme(input);
    const operation = mutation.then(async () => {
      const entries = [
        ["openclaw", () => openClaw.setTheme(theme)],
        ["code", () => updateCodeSettings(config.codeSettingsPath, theme)],
        ["nextcloud", () => updateNextcloud(config, request, theme)],
      ];
      const values = await Promise.all(
        entries.map(async ([service, update]) => ({ service, ...(await withRetry(update)) })),
      );
      return { theme, results: values };
    });
    mutation = operation.catch(() => undefined);
    return operation;
  }

  return { apply };
}
