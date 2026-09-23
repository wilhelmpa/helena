import { joinPath } from './vaultPaths';

// The first of "Untitled.md", "Untitled 2.md", "Untitled 3.md", … in a folder that is
// not taken yet.
export function untitledNotePath(folder: string, name: string, taken: ReadonlySet<string>): string {
  for (let number = 1; ; number += 1) {
    const path = joinPath(folder, number === 1 ? `${name}.md` : `${name} ${number}.md`);
    if (!taken.has(path)) return path;
  }
}
