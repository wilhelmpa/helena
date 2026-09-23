import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { resolveWikilink, vaultFileUrl } from '@/lib/api/endpoints/knowledge';
import { vaultNotePath } from '@/utils/paths';
import { useCreateNoteAt } from '../services/knowledge.service';
import { isNotePath, joinPath, parentPath } from '../utils/vaultPaths';
import { parseWikilink, wikilinkTask } from '../utils/wikilink';

// Follows a wikilink of the open note: a task opens by its short link, a note in the
// Docs, any other file in a new tab. A link to no note offers to create it next to
// the open one.
export function useWikilinkOpener(notePath: string, root: string, canCreate: boolean) {
  const t = useTranslations('documents');
  const router = useRouter();
  const { mutate: create } = useCreateNoteAt(root);

  return useCallback(
    async (inner: string) => {
      const task = wikilinkTask(inner);
      if (task) {
        router.push(`/${task}`);
        return;
      }
      const { target } = parseWikilink(inner);
      if (!target) return;
      let path: string | null;
      try {
        ({ path } = await resolveWikilink(notePath, target));
      } catch {
        toast.error(t('linkFailed'));
        return;
      }
      if (path && isNotePath(path)) router.push(vaultNotePath(path));
      else if (path) window.open(vaultFileUrl(path), '_blank', 'noopener');
      else {
        const newPath = joinPath(parentPath(notePath), `${target.replace(/\.md$/i, '')}.md`);
        toast(t('linkNotFound', { name: target }), {
          action: canCreate
            ? {
                label: t('createLinkedNote'),
                onClick: () =>
                  create(newPath, { onSuccess: (created) => router.push(vaultNotePath(created)) }),
              }
            : undefined,
        });
      }
    },
    [canCreate, create, notePath, router, t],
  );
}
