import { useFormatter, useTranslations } from 'next-intl';
import type { CredentialUse } from '@/lib/api/endpoints/credentials';
import { Badge } from '@/components/ui/badge';

// One audit entry: when, which agent, in which run or chat, and what for.
export function CredentialUseRow({ use }: { use: CredentialUse }) {
  const t = useTranslations('credentials');
  const format = useFormatter();
  const work =
    use.runId !== null
      ? [t('run', { id: use.runId }), use.issueIdentifier].filter(Boolean).join(' · ')
      : use.chatMessageId !== null
        ? t('chat')
        : null;

  return (
    <li className="flex items-start gap-3 py-2.5">
      <Badge
        variant={use.action === 'used' ? 'default' : 'secondary'}
        className="mt-0.5 shrink-0 text-xs font-normal"
      >
        {t(`actions.${use.action}`)}
      </Badge>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="text-sm">
          {use.agentName}
          {work && <span className="text-muted-foreground"> · {work}</span>}
        </div>
        <p dir="ltr" className="truncate font-mono text-xs text-muted-foreground">
          {use.purpose}
        </p>
      </div>
      <time className="shrink-0 text-xs text-muted-foreground" dateTime={use.createdAt}>
        {format.dateTime(new Date(use.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}
      </time>
    </li>
  );
}
