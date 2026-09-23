'use client';

import Link from 'next/link';
import { ExternalLink, FileText, ListTodo } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { filesPath, issuePath } from '@/utils/paths';
import type { ChatSource } from '../../utils/chatSources';

// What the answer drew on or pointed at: the tasks, vault files and links it named. A
// quiet row under the answer, not another block competing with the text for attention.
export default function ChatSourcesFooter({
  sources,
  projectKey,
}: {
  sources: ChatSource[];
  projectKey: string | null;
}) {
  const t = useTranslations('chatWorkspace');

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-t pt-2">
      <span className="text-xs text-muted-foreground">{t('messages.sources')}</span>
      {sources.map((source, index) => {
        if (source.kind === 'task') {
          return (
            <Link
              key={index}
              href={issuePath(source.key, source.seq)}
              className="flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs hover:bg-accent"
            >
              <ListTodo className="size-3" />
              <span dir="ltr">
                {source.key}-{source.seq}
              </span>
            </Link>
          );
        }
        if (source.kind === 'file') {
          const name = source.path.split('/').pop() ?? source.path;
          return projectKey ? (
            <Link
              key={index}
              href={filesPath(projectKey, undefined, { file: source.path })}
              className="flex max-w-40 items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs hover:bg-accent"
            >
              <FileText className="size-3 shrink-0" />
              <span dir="auto" className="truncate">
                {name}
              </span>
            </Link>
          ) : (
            <span
              key={index}
              className="flex max-w-40 items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs"
            >
              <FileText className="size-3 shrink-0" />
              <span dir="auto" className="truncate">
                {name}
              </span>
            </span>
          );
        }
        return (
          <a
            key={index}
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className="flex max-w-48 items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs hover:bg-accent"
          >
            <ExternalLink className="size-3 shrink-0" />
            <span dir="ltr" className="truncate">
              {source.url.replace(/^https?:\/\//, '')}
            </span>
          </a>
        );
      })}
    </div>
  );
}
