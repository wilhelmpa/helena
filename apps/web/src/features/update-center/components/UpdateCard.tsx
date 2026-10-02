'use client';

import { Card } from '@/design-system';
import Link from 'next/link';
import { ExternalLink, LoaderCircle, ShieldAlert, TriangleAlert } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { resolveText, type LocalizedText } from '@helena/sdk/web';
import StatusBadge from '@/components/common/page/StatusBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { UpdateAction, UpdateItem, UpdateScope } from '@/lib/api/endpoints/updateCenter';
import { cn } from '@/lib/utils';
import { byKey } from '@/utils/messageKey';
import { agentActivityForAgentPath } from '@/utils/paths';
import { helenaSettingsPath } from '@/features/settings/settingsModalCatalog';
import { RISK_STATUS, versionStep } from '../utils/updateFormat';

// A translator for the texts a source sends: a string, an i18n key or one per locale.
export function useSourceText() {
  const locale = useLocale();
  const t = byKey(useTranslations());
  return (value: LocalizedText | null | undefined) =>
    value ? resolveText(value, locale, (key) => t(key)) : '';
}

// The badges of an update: a security fix, the risk the summary rated, breaking changes.
export function UpdateBadges({ item }: { item: UpdateItem }) {
  const t = useTranslations('updates');
  return (
    <>
      {item.security && (
        <Badge variant="outline" className="border-status-danger/40 text-status-danger">
          <ShieldAlert aria-hidden="true" />
          {t('badges.security')}
        </Badge>
      )}
      {item.risk && (
        <StatusBadge status={RISK_STATUS[item.risk]}>{t(`risk.${item.risk}`)}</StatusBadge>
      )}
      {item.breaking && (
        <Badge variant="outline" className="border-status-waiting/40 text-status-waiting">
          <TriangleAlert aria-hidden="true" />
          {t('badges.breaking')}
        </Badge>
      )}
    </>
  );
}

// What the summary says, or why there is none yet.
export function UpdateSummary({
  item,
  agentId,
  compact = false,
}: {
  item: UpdateItem;
  agentId: number | null;
  compact?: boolean;
}) {
  const t = useTranslations('updates');
  if (!item.updateAvailable) return null;
  if (item.summary) {
    return (
      <div className="space-y-1">
        <p className={cn('text-sm', compact && 'line-clamp-2')} dir="auto">
          {item.summary}
        </p>
        {!compact && item.highlights.length > 0 && (
          <ul className="list-disc space-y-0.5 ps-5 text-xs text-muted-foreground">
            {item.highlights.map((line) => (
              <li key={line} dir="auto">
                {line}
              </li>
            ))}
          </ul>
        )}
        {!compact && item.summaryModel && (
          <p className="text-xs text-muted-foreground">
            {t('summary.by', { model: item.summaryModel })}
            {item.summaryRunId && agentId ? (
              <>
                {' · '}
                <Link
                  href={agentActivityForAgentPath(agentId)}
                  className="underline-offset-2 hover:underline"
                >
                  {t('summary.run')}
                </Link>
              </>
            ) : null}
          </p>
        )}
      </div>
    );
  }
  if (item.summaryPending) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
        {t('summary.pending')}
      </p>
    );
  }
  if (item.summaryError) {
    return (
      <p className="text-xs text-status-waiting" dir="auto">
        {t('summary.failed', {
          error:
            item.summaryError === 'digest_runtime_unavailable'
              ? t('settings.noAgent')
              : item.summaryError,
        })}
      </p>
    );
  }
  return <p className="text-xs text-muted-foreground">{t('summary.none')}</p>;
}

// One component with a new version: name and version step with its badges, the summary,
// the links, and "Aktualisieren" where Helena can do it (or the running update).
export default function UpdateCard({
  item,
  running,
  agentId,
  onApply,
  showApply = true,
}: {
  item: UpdateItem;
  running: UpdateAction | null;
  agentId: number | null;
  onApply: (item: UpdateItem, scope: UpdateScope) => void;
  showApply?: boolean;
}) {
  const t = useTranslations('updates');
  const text = useSourceText();
  return (
    <Card pad="tight" gap={2} className="min-w-0">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="min-w-0 truncate text-sm font-medium" dir="auto">
          {item.name}
        </span>
        <span className="font-mono text-xs text-muted-foreground" dir="ltr">
          {versionStep(item)}
        </span>
        <UpdateBadges item={item} />
        <span className="ms-auto flex shrink-0 items-center gap-2">
          {running ? (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
              {t('updating')}
            </span>
          ) : showApply && item.applicable ? (
            <Button size="sm" variant="outline" onClick={() => onApply(item, 'item')}>
              {t('apply')}
            </Button>
          ) : null}
        </span>
      </div>
      <UpdateSummary item={item} agentId={agentId} />
      <p className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        <span>{text(item.sourceLabel)}</span>
        {item.detail && (
          <span className="min-w-0 truncate" dir="auto">
            {item.detail}
          </span>
        )}
        {item.hint && <span>{text(item.hint)}</span>}
        {item.source === 'volition-catalog' && (
          <Link
            href={helenaSettingsPath('skills', 'updates')}
            className="underline-offset-2 hover:underline"
          >
            {t('openInCatalog')}
          </Link>
        )}
        {item.notesUrl && (
          <a
            href={item.notesUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
          >
            {t('notes')}
            <ExternalLink className="size-3" aria-hidden="true" />
          </a>
        )}
        {item.error && (
          <span className="text-status-waiting" dir="auto">
            {item.error}
          </span>
        )}
      </p>
    </Card>
  );
}
