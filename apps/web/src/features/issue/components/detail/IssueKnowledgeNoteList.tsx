import Link from 'next/link';
import { FileText, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { LinkedNote } from '@/lib/api/endpoints/knowledge';
import { vaultNotePath } from '@/utils/paths';

// The notes linking to a task, with the loading, error and empty states around them.
export default function IssueKnowledgeNoteList({
  identifier,
  notes,
}: {
  identifier: string;
  notes: { isLoading: boolean; isError: boolean; data?: LinkedNote[]; refetch: () => unknown };
}) {
  const t = useTranslations('issue.knowledge');

  if (notes.isLoading) {
    return (
      <div className="flex h-12 items-center justify-center text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
      </div>
    );
  }

  if (notes.isError) {
    return (
      <button
        type="button"
        className="w-full rounded-md border border-dashed px-3 py-4 text-xs text-muted-foreground hover:text-foreground"
        onClick={() => void notes.refetch()}
      >
        {t('loadFailed')}
      </button>
    );
  }

  if (!notes.data?.length) {
    return (
      <p className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
        {t('empty', { link: `[[${identifier}]]` })}
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {notes.data.map((note) => (
        <Link
          key={note.path}
          href={vaultNotePath(note.path)}
          className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          title={note.path}
        >
          <FileText className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate" dir="auto">
            {note.title}
          </span>
        </Link>
      ))}
    </div>
  );
}
