'use client';

import { useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useVaultTreeQuery } from '../services/knowledge.service';
import { foldersBetween } from '../utils/vaultPaths';
import { buildVaultTree } from '../utils/vaultTree';
import type { DocumentTreeAction } from './DocumentTreeDialog';
import DocumentTreeRow from './DocumentTreeRow';

export default function DocumentTree({
  root,
  openPath,
  canEdit,
  onNewNote,
  onAction,
}: {
  root: string;
  openPath: string | null;
  canEdit: boolean;
  onNewNote: (folder: string) => void;
  onAction: (action: DocumentTreeAction) => void;
}) {
  const t = useTranslations('documents');
  const tree = useVaultTreeQuery(root);
  const nodes = useMemo(() => buildVaultTree(tree.data?.items ?? [], root), [tree.data, root]);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(openPath ? foldersBetween(root, openPath) : []),
  );

  // The folders of a note opened by a link unfold to show it.
  useEffect(() => {
    if (!openPath) return;
    setExpanded((current) => {
      const closed = foldersBetween(root, openPath).filter((folder) => !current.has(folder));
      return closed.length > 0 ? new Set([...current, ...closed]) : current;
    });
  }, [openPath, root]);

  const toggle = (folder: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(folder)) next.add(folder);
      return next;
    });

  if (tree.isPending) {
    return (
      <div className="space-y-1 p-1" aria-hidden>
        <Skeleton className="h-7 w-full" />
        <Skeleton className="h-7 w-4/5" />
        <Skeleton className="h-7 w-2/3" />
      </div>
    );
  }
  if (tree.isError) {
    return (
      <div className="px-3 py-8 text-center">
        <p className="text-sm text-muted-foreground">{t('loadFailed')}</p>
        <Button className="mt-3" variant="outline" size="sm" onClick={() => void tree.refetch()}>
          <RefreshCw />
          {t('reload')}
        </Button>
      </div>
    );
  }
  if (nodes.length === 0) {
    return <p className="px-3 py-8 text-center text-sm text-muted-foreground">{t('noNotes')}</p>;
  }

  return (
    <ul role="tree" aria-label={t('treeLabel')} className="space-y-px">
      {nodes.map((node) => (
        <DocumentTreeRow
          key={node.item.path}
          node={node}
          depth={0}
          openPath={openPath}
          expanded={expanded}
          canEdit={canEdit}
          onToggle={toggle}
          onNewNote={onNewNote}
          onAction={onAction}
        />
      ))}
    </ul>
  );
}
