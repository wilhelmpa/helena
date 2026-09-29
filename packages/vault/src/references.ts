import path from 'node:path';
import { baseName, isNotePath, isWithin } from './paths';

function nameOf(relative: string): string {
  return isNotePath(relative) ? relative.replace(/\.md$/i, '') : relative;
}

function replaceTarget(
  value: string,
  from: string,
  to: string,
  shortName: boolean,
  allowRelative: boolean,
): string {
  const oldName = nameOf(from);
  const newName = nameOf(to);
  if (value === oldName || value.startsWith(`${oldName}/`)) {
    return newName + value.slice(oldName.length);
  }
  if (value === from || value.startsWith(`${from}/`)) return to + value.slice(from.length);
  if (allowRelative) {
    const parts = oldName.split('/');
    for (let index = 1; index < parts.length - 1; index += 1) {
      const suffix = parts.slice(index).join('/');
      if (value === suffix || value.startsWith(`${suffix}/`))
        return newName + value.slice(suffix.length);
    }
  }
  const oldShort = baseName(oldName);
  if (shortName && value === oldShort) return baseName(newName);
  return value;
}

export function rewriteVaultReferences(
  content: string,
  kind: 'note' | 'canvas',
  from: string,
  to: string,
  shortName: boolean,
  allowRelative = false,
  documentPath?: string,
): string {
  const markdown = content.replace(
    /\[\[([^\]|#]+)(#[^\]|]*)?(\|[^\]]*)?\]\]/g,
    (whole, target: string, heading = '', label = '') => {
      const replaced = replaceTarget(target, from, to, shortName, allowRelative);
      return replaced === target ? whole : `[[${replaced}${heading}${label}]]`;
    },
  );
  if (kind !== 'canvas') return markdown;
  let canvas: { nodes?: { type?: string; file?: string }[] };
  try {
    canvas = JSON.parse(markdown) as typeof canvas;
  } catch {
    return markdown;
  }
  let changed = markdown !== content;
  for (const node of canvas.nodes ?? []) {
    if (node.type !== 'file' || typeof node.file !== 'string') continue;
    const replaced = replaceTarget(node.file, from, to, false, allowRelative);
    const oldAbsolute =
      documentPath && /^\.\.?(?:\/|$)/.test(node.file)
        ? path.posix.normalize(path.posix.join(path.posix.dirname(documentPath), node.file))
        : null;
    const newAbsolute =
      oldAbsolute && isWithin(oldAbsolute, from) ? to + oldAbsolute.slice(from.length) : null;
    const newRelative =
      newAbsolute && documentPath
        ? path.posix.relative(
            path.posix.dirname(movedReferencePath(documentPath, from, to)),
            newAbsolute,
          )
        : null;
    if (replaced !== node.file || newRelative !== null) {
      node.file = newRelative ?? replaced;
      changed = true;
    }
  }
  return changed ? `${JSON.stringify(canvas, null, 2)}\n` : content;
}

export function movedReferencePath(relative: string, from: string, to: string): string {
  return isWithin(relative, from) ? to + relative.slice(from.length) : relative;
}
