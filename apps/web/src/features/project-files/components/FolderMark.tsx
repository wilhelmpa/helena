'use client';

import { useTranslations } from 'next-intl';
import { describeFolder } from '@/utils/knowledgeFolders';
import type { KnowledgeEntry } from './KnowledgeListView';

// The symbol of the kind of folder a file lives in — the same one the sidebar tree shows for
// it (system folder, a task's, the owner's own; O78) — in the list and in the overlay. A file
// at the top level, or outside a project's folder, has none.
export default function FolderMark({ entry }: { entry: Pick<KnowledgeEntry, 'folder' | 'scope'> }) {
  const fixed = useTranslations('files.fixedFolders');
  const kinds = useTranslations('files.folderKinds');
  if (!entry.folder || entry.scope.kind !== 'project') return null;
  const info = describeFolder(entry.folder, fixed);
  const Icon = info.Icon;
  return (
    <span
      className="ds-folder-mark"
      data-kind={info.kind}
      title={`${info.label} · ${kinds(info.kind)}`}
    >
      <Icon size={13} aria-hidden="true" />
    </span>
  );
}
