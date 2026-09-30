'use client';

import { useState } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import KnowledgeFrame, {
  KnowledgeListHead,
  KnowledgeRow,
  KnowledgeSearch,
} from '@/components/helena/KnowledgeFrame';
import { EmptyState, IconButton } from '@/design-system';
import { useRelativeTime } from '@/context/relativeTimeContext';
import {
  useRestoreVaultPath,
  useVaultTrashQuery,
} from '@/features/documents/services/knowledge.service';
import { knowledgeIcons, knowledgeKind } from '../utils/knowledgeKinds';

// Wissen › Papierkorb (Auftrag 117): what was moved to the trash below this place, newest
// first, each with the folder it came from and "Wiederherstellen". Nothing is deleted for
// good from here; that stays with the owner.
export default function KnowledgeTrashView({
  root,
  title,
  canRestore,
}: {
  // The vault folder of the place (Projects/VOL, Home, Private, Templates).
  root: string;
  title: string;
  canRestore: boolean;
}) {
  const t = useTranslations('files.trashView');
  const relativeTime = useRelativeTime();
  const trash = useVaultTrashQuery(root, true);
  const restore = useRestoreVaultPath(root);
  const [query, setQuery] = useState('');
  const items = (trash.data ?? [])
    .map((item) => {
      const relative = item.path.slice(root.length + 1);
      const parts = relative.split('/');
      return {
        ...item,
        relative,
        name: parts.at(-1) ?? relative,
        folder: parts.slice(0, -1).join('/'),
      };
    })
    .filter(
      (item) => !query.trim() || item.relative.toLowerCase().includes(query.trim().toLowerCase()),
    );

  return (
    <KnowledgeFrame
      title={title}
      boxed={!trash.isPending && !trash.isError && items.length > 0}
      search={<KnowledgeSearch value={query} onChange={setQuery} placeholder={t('search')} />}
    >
      {!trash.isPending && items.length > 0 && (
        <KnowledgeListHead name={t('name')} kind={t('from')} trailing="" />
      )}
      <div className="ds-knowledge-rows">
        {trash.isPending ? (
          <EmptyState fill={false}>{t('loading')}</EmptyState>
        ) : trash.isError ? (
          <EmptyState icon={<Trash2 />}>{t('loadFailed')}</EmptyState>
        ) : items.length === 0 ? (
          <EmptyState icon={<Trash2 />} title={query ? undefined : t('emptyTitle')}>
            {query ? t('noMatch') : t('empty')}
          </EmptyState>
        ) : (
          items.map((item) => {
            const kind = knowledgeKind({ name: item.name, kind: 'file' });
            return (
              <KnowledgeRow
                key={item.path}
                icon={knowledgeIcons[kind]}
                name={item.name}
                title={item.relative}
                detail={`${item.folder || t('topLevel')} · ${relativeTime(item.trashedAt)}`}
                trailing={
                  canRestore ? (
                    <IconButton
                      size="small"
                      label={t('restoreTo', { path: item.relative })}
                      disabled={restore.isPending}
                      onClick={() =>
                        restore.mutate(item.path, {
                          onSuccess: () => toast.success(t('restored', { name: item.name })),
                        })
                      }
                    >
                      <RotateCcw size={14} />
                    </IconButton>
                  ) : (
                    relativeTime(item.trashedAt)
                  )
                }
              />
            );
          })
        )}
      </div>
    </KnowledgeFrame>
  );
}
