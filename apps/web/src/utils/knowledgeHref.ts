import { filesPath, vaultNotePath } from '@/utils/paths';
import { vaultFileUrl } from '@/lib/api/endpoints/knowledge';

// Where a search hit of the vault opens: a note in Docs, a file of a project in the
// Files page at its folder, any other file as a download.
export function knowledgeHref(path: string, kind: 'note' | 'file' | 'folder'): string {
  if (kind === 'note') return vaultNotePath(path);
  const [top, key, ...rest] = path.split('/');
  if (top === 'Projects' && key) {
    const folder = kind === 'folder' ? rest.join('/') : rest.slice(0, -1).join('/');
    return filesPath(key, folder || undefined);
  }
  return vaultFileUrl(path);
}
