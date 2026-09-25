'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import SettingsCard from '@/components/common/page/SettingsCard';
import StatusBadge, { type Status } from '@/components/common/page/StatusBadge';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/utils/dates';
import type { AuditCheck, AuditState, SecurityStatus } from '@/lib/api/endpoints/security';
import { checkKey, groupKey, sortChecks } from '../checks';

const STATE_STATUS: Record<AuditState, Status> = {
  pass: 'success',
  fail: 'danger',
  warn: 'waiting',
  skip: 'idle',
};

// Placeholders a finding's sentence may use; a report from before the audit sent params
// leaves them visibly open instead of failing to format (a select falls to its `other` case).
const EMPTY_PARAMS = { ports: '…', value: '…', count: '…', why: 'other', problem: 'other' };

// The host audit (deployment/volition-stack/native/hardening/audit.sh) as a list: the
// findings first, the checks that passed behind a toggle. A finding is worded in the
// reader's language from its code (check and state) and params; the audit's English
// detail is only the tooltip, and shows as it is only for a check this build cannot word.
// The audit writes no secret into its report. Exported for hub/server-admin's
// Server → Sicherheit tab, which mounts it as it is.
export default function SecurityAuditPanel({
  audit,
  isPending,
}: {
  audit: SecurityStatus['audit'] | undefined;
  isPending: boolean;
}) {
  const t = useTranslations('serverSecurity');
  const [showPassed, setShowPassed] = useState(false);

  // The sentence under a check: its finding in words, "Nicht geprüft" for a skipped one,
  // the raw detail for a failing check this build has no words for, nothing for a pass.
  const findingText = (check: AuditCheck): string | null => {
    const key = checkKey(check.id);
    if (check.state === 'skip') return t('finding.skipped');
    if (check.state !== 'fail' && check.state !== 'warn') return null;
    const id = `finding.${key}.${check.state}` as Parameters<typeof t.has>[0];
    if (key && t.has(id)) {
      return t(id as Parameters<typeof t>[0], { ...EMPTY_PARAMS, ...check.params });
    }
    return check.detail || null;
  };

  if (isPending) return <ListSkeleton rows={6} rowClassName="h-8" />;
  if (!audit) {
    return (
      <SettingsCard className="space-y-2 p-4 text-sm">
        <p className="text-muted-foreground">{t('noReport')}</p>
        <p className="font-mono text-xs break-all">{t('noReportCommand')}</p>
      </SettingsCard>
    );
  }

  const checks = sortChecks(audit.checks);
  const findings = checks.filter((check) => check.state === 'fail' || check.state === 'warn');
  const rest = checks.filter((check) => check.state !== 'fail' && check.state !== 'warn');
  const visible = showPassed ? checks : findings;
  const summaryStatus: Status =
    audit.summary.fail > 0
      ? 'danger'
      : audit.summary.warn > 0 || audit.stale
        ? 'waiting'
        : 'success';

  return (
    <SettingsCard className="divide-y p-0">
      <div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
        <StatusBadge status={summaryStatus}>
          {t('summary', {
            failed: audit.summary.fail,
            warnings: audit.summary.warn,
            passed: audit.summary.pass,
          })}
        </StatusBadge>
        <span className="text-xs text-muted-foreground">
          {t('ranAt', { time: formatDateTime(audit.ranAt), host: audit.host || '—' })}
        </span>
        {audit.stale && <span className="text-xs text-muted-foreground">{t('stale')}</span>}
      </div>
      {visible.length === 0 ? (
        <p className="px-3 py-2 text-sm text-muted-foreground">{t('noFindings')}</p>
      ) : (
        <ul className="divide-y">
          {visible.map((check) => {
            const key = checkKey(check.id);
            const group = groupKey(check.group);
            const finding = findingText(check);
            return (
              <li
                key={check.id}
                className="flex min-h-8 min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-1.5 text-sm"
              >
                <StatusBadge status={STATE_STATUS[check.state]} dotOnly />
                <span
                  className="min-w-0 flex-1 max-sm:basis-[calc(100%-1rem)] sm:truncate"
                  title={check.detail ? `${check.id}: ${check.detail}` : check.id}
                >
                  {key ? t(`check.${key}`) : check.id}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground max-sm:ms-3.5">
                  {group ? t(`group.${group}`) : check.group}
                  {' · '}
                  {t(`severity.${check.severity}`)}
                </span>
                {finding && (
                  <span
                    className="w-full truncate text-xs text-muted-foreground"
                    title={check.detail || undefined}
                  >
                    {finding}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {rest.length > 0 && (
        <div className="px-3 py-1.5">
          <Button variant="ghost" size="sm" onClick={() => setShowPassed((value) => !value)}>
            {showPassed ? t('hidePassed') : t('showPassed', { count: rest.length })}
          </Button>
        </div>
      )}
    </SettingsCard>
  );
}
