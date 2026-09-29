'use client';

import { ExternalLink, LoaderCircle, ShieldAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { UpdateAction, UpdateItem, UpdateScope } from '@/lib/api/endpoints/updateCenter';
import { versionStep } from '../utils/updateFormat';
import { UpdateBadges, UpdateSummary, useSourceText } from './UpdateCard';

// A group of components that share one summary (the Debian packages): the group's name
// and counts with "Sicherheitsupdates installieren" and "Alle installieren", the summary,
// then one line per package with its own "Aktualisieren".
export default function UpdateGroupCard({
  items,
  running,
  agentId,
  onApply,
}: {
  items: UpdateItem[];
  running: UpdateAction | null;
  agentId: number | null;
  onApply: (item: UpdateItem, scope: UpdateScope) => void;
}) {
  const t = useTranslations('updates');
  const text = useSourceText();
  const first = items[0]!;
  const security = items.filter((item) => item.security);
  const applicable = items.some((item) => item.applicable);
  // The group's summary and risk are the same on every package; the badges read the first.
  const headline = { ...first, security: security.length > 0 };
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-md border border-sidebar-border bg-card p-3">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="min-w-0 truncate text-sm font-medium">{text(first.sourceLabel)}</span>
        <span className="text-xs text-muted-foreground">
          {t('count', { count: items.length })}
          {security.length > 0 && ` · ${t('securityCount', { count: security.length })}`}
        </span>
        <UpdateBadges item={headline} />
        <span className="ms-auto flex shrink-0 flex-wrap items-center gap-2">
          {running ? (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
              {t('updating')}
            </span>
          ) : applicable ? (
            <>
              {security.length > 0 && security.length < items.length && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onApply(security[0]!, 'security')}
                >
                  {t('applySecurity', { count: security.length })}
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => onApply(first, 'group')}>
                {t('applyGroup', { count: items.length })}
              </Button>
            </>
          ) : null}
        </span>
      </div>
      <UpdateSummary item={first} agentId={agentId} />
      <ul className="flex flex-col gap-px">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex min-h-8 min-w-0 flex-wrap items-center gap-x-2 rounded-md px-1 text-sm"
          >
            {item.security ? (
              <ShieldAlert
                className="size-3.5 shrink-0 text-status-danger"
                aria-label={t('badges.security')}
              />
            ) : (
              <span className="size-3.5 shrink-0" aria-hidden="true" />
            )}
            <span className="min-w-0 truncate" dir="auto">
              {item.name}
            </span>
            <span className="font-mono text-xs text-muted-foreground" dir="ltr">
              {versionStep(item)}
            </span>
            {item.detail && item.detail !== item.name && (
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" dir="auto">
                {item.detail}
              </span>
            )}
            <span className="ms-auto flex shrink-0 items-center gap-1">
              {item.notesUrl && (
                <a
                  href={item.notesUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label={t('notes')}
                  title={t('notes')}
                  className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                >
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                </a>
              )}
              {!running && item.applicable && (
                <Button size="sm" variant="ghost" onClick={() => onApply(item, 'item')}>
                  {t('apply')}
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
