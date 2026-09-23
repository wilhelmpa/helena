import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

// Private by default; a file the project's agents read (PROJECT.json) passes a mode with
// group bits, which the workspace's ACL then narrows to the users it names.
export async function writeJsonAtomic(filePath, value, { mode = 0o600 } = {}) {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  const handle = await fs.open(temporaryPath, "wx", mode);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temporaryPath, filePath);
  const directoryHandle = await fs.open(directory, "r");
  try {
    await directoryHandle.sync();
  } finally {
    await directoryHandle.close();
  }
}
