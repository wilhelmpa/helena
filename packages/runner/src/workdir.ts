import { realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

function within(root: string, candidate: string): boolean {
  const inside = relative(root, candidate);
  return inside !== '' && inside !== '..' && !inside.startsWith(`..${sep}`) && !isAbsolute(inside);
}

// The directory a queued run starts in: `workdir`, the folder of the issue's area, below
// the configured working directory. A folder that does not exist yet (its provisioning
// is still queued) leaves the run in the working directory itself.
export function runCwd(
  cwd: string | undefined,
  workdir: string | null | undefined,
): string | undefined {
  if (!workdir) return cwd;
  const base = resolve(cwd ?? process.cwd());
  const outside = new Error(
    `The run's working directory ${JSON.stringify(workdir)} is outside ${base}`,
  );
  if (isAbsolute(workdir) || !within(base, resolve(base, workdir))) throw outside;
  let target: string;
  try {
    target = realpathSync(resolve(base, workdir));
  } catch {
    return cwd;
  }
  if (!within(realpathSync(base), target)) throw outside;
  return statSync(target).isDirectory() ? target : cwd;
}
