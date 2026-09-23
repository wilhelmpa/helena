import fs from "node:fs/promises";

// Sockets and devices of a stopped browser or agent cannot be copied and are not needed.
async function copyable(entry) {
  const stat = await fs.lstat(entry);
  return !stat.isSocket() && !stat.isFIFO() && !stat.isBlockDevice() && !stat.isCharacterDevice();
}

// Every ReadWritePaths= entry of the provisioning unit is a mount of its own, and
// rename(2) fails with EXDEV between two mounts even on one filesystem. The copy is
// made under a temporary name and renamed into place, so an interrupted move leaves
// either no destination or a complete one.
export async function movePath(source, destination, { rename = fs.rename } = {}) {
  try {
    await rename(source, destination);
    return;
  } catch (error) {
    if (error?.code !== "EXDEV") throw error;
  }
  const partial = `${destination}.partial`;
  await fs.rm(partial, { recursive: true, force: true });
  await fs.cp(source, partial, {
    recursive: true,
    preserveTimestamps: true,
    verbatimSymlinks: true,
    errorOnExist: true,
    force: false,
    filter: copyable,
  });
  await rename(partial, destination);
  await fs.rm(source, { recursive: true, force: true });
}
