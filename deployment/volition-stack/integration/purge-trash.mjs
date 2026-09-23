import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readJson } from "./atomic-json.mjs";
import { loadConfig } from "./config.mjs";

const EVENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Deletes the trash entries whose receipt says they may go. An entry without a
// valid receipt is kept: its deprovisioning run has not finished.
export async function purgeTrash(root, now = Date.now()) {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return { purged: [], failed: [] };
    throw error;
  }
  const purged = [];
  const failed = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !EVENT_ID.test(entry.name)) continue;
    const directory = path.join(root, entry.name);
    try {
      const receipt = await readJson(path.join(directory, "receipt.json"), null);
      const purgeAfter = Date.parse(receipt?.purgeAfter);
      if (receipt?.eventId !== entry.name || !(purgeAfter <= now)) continue;
      await fs.rm(directory, { recursive: true, force: true });
      purged.push(entry.name);
    } catch (error) {
      failed.push(entry.name);
      console.error(`Purging trash entry ${entry.name} failed: ${error.message}`);
    }
  }
  return { purged, failed };
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const { purged, failed } = await purgeTrash(loadConfig().projectTrashRoot);
  console.log(`Purged ${purged.length} project trash entries, ${failed.length} failed`);
  if (failed.length) process.exitCode = 1;
}
