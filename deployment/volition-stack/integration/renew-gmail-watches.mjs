import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";

const execute = promisify(execFile);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function privateSecret(filePath) {
  const stat = await fs.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error("The keyring credential must be a private regular file");
  }
  const value = (await fs.readFile(filePath, "utf8")).replace(/[\r\n]+$/, "");
  if (!value) throw new Error("The keyring credential is empty");
  return value;
}

function accounts(value) {
  const result = [...new Set((value ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean))];
  if (result.length === 0 || result.length > 10 || result.some((item) => !EMAIL.test(item))) {
    throw new Error("INBOX_ACCOUNTS must contain a valid, bounded account allowlist");
  }
  return result;
}

const gogBin = process.env.GOG_BIN || "/home/pw/.local/bin/gog";
const gogHome = process.env.GOG_HOME || "/home/pw/.local/share/volition-gog";
const keyringPassword = await privateSecret(process.env.GOG_KEYRING_PASSWORD_FILE);
const dryRun = process.env.WATCH_DRY_RUN === "1";

for (const account of accounts(process.env.INBOX_ACCOUNTS)) {
  try {
    await execute(
      gogBin,
      [
        `--home=${gogHome}`,
        "--enable-commands-exact=gmail.watch.renew",
        `--account=${account}`,
        "--gmail-no-send",
        "--no-input",
        "--json",
        ...(dryRun ? ["--dry-run"] : []),
        "gmail",
        "watch",
        "renew",
      ],
      {
        timeout: 60_000,
        maxBuffer: 1024 * 1024,
        encoding: "utf8",
        env: {
          HOME: "/home/pw",
          PATH: "/home/pw/.local/bin:/usr/local/bin:/usr/bin:/bin",
          GOG_KEYRING_PASSWORD: keyringPassword,
        },
      },
    );
    console.log(`Gmail watch ${dryRun ? "dry run" : "renewed"}: ${account}`);
  } catch (error) {
    console.error("Gmail watch renewal failed", {
      account,
      code: error?.code ?? null,
      signal: error?.signal ?? null,
      killed: error?.killed === true,
    });
    process.exitCode = 1;
  }
}
