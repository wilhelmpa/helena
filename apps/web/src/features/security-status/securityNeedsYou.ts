'use client';

import { useTranslations } from 'next-intl';
import { ShieldAlert } from 'lucide-react';
import type { NeedsYouEntry, NeedsYouSourceResult } from '@/extensions/needsYouSources';
import type { AuditCheck } from '@/lib/api/endpoints/security';
import { godPath } from '@/utils/paths';
import { byKey } from '@/utils/messageKey';
import { useSecurityStatusQuery } from './services/security.service';
import { checkKey } from './checks';

// The checks of the host audit that belong in "Braucht dich": failed and critical or high,
// the ones that make the security state red. Warnings and minor findings stay on
// Administrator → Sicherheit.
export function severeFailures(checks: AuditCheck[]): AuditCheck[] {
  return checks.filter(
    (check) =>
      check.state === 'fail' && (check.severity === 'critical' || check.severity === 'high'),
  );
}

// "Braucht dich" ← the host audit (extensions/needsYouSources): one red line while severe
// checks fail — the check itself when it is one, else how many with the first ones named —
// opening Administrator → Sicherheit, which lists each. One line, not one per check, so a
// fresh install with the hardening still to do does not bury the approvals. For the
// Administrator; nothing while no audit ran.
export function useSecurityEntries({ owner }: { owner: boolean }): NeedsYouSourceResult {
  const t = useTranslations('home.problems');
  const tCheck = byKey(useTranslations('serverSecurity.check'));
  const status = useSecurityStatusQuery(owner);
  const audit = status.data?.audit;
  if (!owner || !audit) return { entries: [], isPending: false };
  const severe = severeFailures(audit.checks);
  if (severe.length === 0) return { entries: [], isPending: false };
  const title = (check: AuditCheck) => {
    const key = checkKey(check.id);
    return key ? tCheck(key) : check.id;
  };
  const entry: NeedsYouEntry = {
    key: 'problem:security',
    kind: 'problem',
    at: '',
    href: godPath('security'),
    icon: ShieldAlert,
    title: severe.length === 1 ? title(severe[0]!) : t('securityChecks', { count: severe.length }),
    detail: severe.length === 1 ? t('securityCheck') : severe.slice(0, 2).map(title).join(' · '),
  };
  return { entries: [entry], isPending: false };
}
