import Link from 'next/link';
import {
  Bot,
  FileText,
  LayoutDashboard,
  Mail,
  MessageSquare,
  MessagesSquare,
  SquareCheck,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMentionsQuery } from '@/services/everything.service';

const ICONS: Record<string, LucideIcon> = {
  issue: SquareCheck,
  comment: MessageSquare,
  mail: Mail,
  chat: MessagesSquare,
  run: Bot,
  vault: LayoutDashboard,
};

// Everything else that names this task: mails, chats, agent runs, other tasks' comments
// and boards, from the one knowledge index. Notes are listed above it already.
export default function IssueMentionsList({ identifier }: { identifier: string }) {
  const t = useTranslations('knowledge.mentions');
  const tSource = useTranslations('knowledge.source');
  const mentions = useMentionsQuery(`task:${identifier}`);
  const items = (mentions.data ?? []).filter(
    (item) => !(item.source === 'vault' && item.id.toLowerCase().endsWith('.md')),
  );
  if (items.length === 0) return null;

  return (
    <div className="mt-3 space-y-1">
      <p className="px-2 text-xs text-muted-foreground">{t('title')}</p>
      {items.map((item) => {
        const Icon = ICONS[item.source] ?? FileText;
        const label = ICONS[item.source] ? tSource(item.source as 'issue') : item.source;
        return (
          <Link
            key={item.ref}
            href={item.href}
            className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-label={label} />
            <span className="min-w-0 flex-1 truncate" dir="auto">
              {item.title || label}
            </span>
            {item.projectKey && (
              <span className="shrink-0 font-mono text-xs text-muted-foreground">
                {item.projectKey}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
