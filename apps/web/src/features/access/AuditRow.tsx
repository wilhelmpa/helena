import { useFormatter, useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import type { AuditEntry } from '@/lib/api/endpoints/access';

// One audit entry: what happened (handed over, used, called, refused, asked for
// approval, changed by the owner), with which credential, by whom, in which run or chat,
// the action category and what for. Never a secret.
export function AuditRow({
  entry,
  showCredential,
}: {
  entry: AuditEntry;
  showCredential: boolean;
}) {
  const t = useTranslations('access.log');
  const format = useFormatter();
  const work =
    entry.runId !== null
      ? [t('run', { id: entry.runId }), entry.issueIdentifier].filter(Boolean).join(' · ')
      : entry.chatMessageId !== null
        ? t('chat')
        : null;
  const who = entry.agentId === null ? `${entry.agentName || t('owner')}` : entry.agentName;

  return (
    <li className="flex items-start gap-3 px-4 py-2.5">
      <Badge
        variant={
          entry.action === 'denied'
            ? 'destructive'
            : entry.action === 'called' || entry.action === 'used'
              ? 'default'
              : 'secondary'
        }
        className="mt-0.5 shrink-0 text-xs font-normal"
      >
        {t(`actions.${entry.action}`)}
      </Badge>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-x-1.5 text-sm">
          {showCredential && <span className="font-medium">{entry.credentialLabel}</span>}
          {showCredential && <span className="text-muted-foreground">·</span>}
          <span>{who}</span>
          {work && <span className="text-muted-foreground">· {work}</span>}
          {entry.category && (
            <Badge variant="outline" className="text-xs font-normal">
              {entry.category}
            </Badge>
          )}
        </div>
        <p dir="ltr" className="truncate font-mono text-xs text-muted-foreground">
          {entry.purpose}
        </p>
      </div>
      <time className="shrink-0 text-xs text-muted-foreground" dateTime={entry.createdAt}>
        {format.dateTime(new Date(entry.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}
      </time>
    </li>
  );
}
