'use client';

import Link from 'next/link';
import { ExternalLink, FileText, ListTodo } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { filesPath, issuePath } from '@/utils/paths';
import {
  Sources,
  SourcesContent,
  SourcesTrigger,
  sourceChipClassName,
} from '@/components/ai-elements/sources';
import type { ChatSource } from '../../utils/chatSources';

// What the answer drew on or pointed at — the tasks, vault files and links it named —
// folded into one quiet line under the answer ("3 sources") that opens onto them.
export default function ChatSources({
  sources,
  projectKey,
}: {
  sources: ChatSource[];
  projectKey: string | null;
}) {
  const t = useTranslations('chatWorkspace');

  return (
    <Sources>
      <SourcesTrigger label={t('messages.sourcesCount', { count: sources.length })} />
      <SourcesContent>
        {sources.map((source, index) => {
          if (source.kind === 'task') {
            return (
              <Link
                key={index}
                href={issuePath(source.key, source.seq)}
                className={sourceChipClassName()}
              >
                <ListTodo />
                <span dir="ltr">
                  {source.key}-{source.seq}
                </span>
              </Link>
            );
          }
          if (source.kind === 'file') {
            const name = source.path.split('/').pop() ?? source.path;
            const label = (
              <>
                <FileText />
                <span dir="auto" className="truncate">
                  {name}
                </span>
              </>
            );
            return projectKey ? (
              <Link
                key={index}
                href={filesPath(projectKey, undefined, { file: source.path })}
                className={sourceChipClassName()}
                title={source.path}
              >
                {label}
              </Link>
            ) : (
              <span key={index} className={sourceChipClassName('hover:bg-transparent')}>
                {label}
              </span>
            );
          }
          return (
            <a
              key={index}
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className={sourceChipClassName()}
            >
              <ExternalLink />
              <span dir="ltr" className="truncate">
                {source.url.replace(/^https?:\/\//, '')}
              </span>
            </a>
          );
        })}
      </SourcesContent>
    </Sources>
  );
}
