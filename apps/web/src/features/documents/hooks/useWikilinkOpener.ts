import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useVaultWikilinkOpener } from '@/hooks/useVaultWikilinkOpener';
import { vaultNotePath } from '@/utils/paths';
import { useCreateNoteAt } from '../services/knowledge.service';
import { joinPath, parentPath } from '../utils/vaultPaths';

// Follows a wikilink of the open note: a task opens by its short link, a note in the
// Docs, any other file in a new tab. A link to no note offers to create it next to
// the open one.
export function useWikilinkOpener(notePath: string, root: string, canCreate: boolean) {
  const t = useTranslations('documents');
  const router = useRouter();
  const { mutate: create } = useCreateNoteAt(root);

  const onMissing = useCallback(
    (target: string) => {
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
    },
    [canCreate, create, notePath, router, t],
  );
  return useVaultWikilinkOpener(notePath, { onMissing });
}
