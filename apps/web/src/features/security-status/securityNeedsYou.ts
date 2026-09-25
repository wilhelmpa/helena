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

// "Braucht dich" ← the host audit (extensions/needsYouSources): each severe failed check,
// opening Administrator → Sicherheit. For the Administrator; nothing while no audit ran.
export function useSecurityEntries({ owner }: { owner: boolean }): NeedsYouSourceResult {
  const t = useTranslations('home.problems');
  const tCheck = byKey(useTranslations('serverSecurity.check'));
  const status = useSecurityStatusQuery(owner);
  const audit = status.data?.audit;
  if (!owner || !audit) return { entries: [], isPending: false };
  const entries = severeFailures(audit.checks).map((check): NeedsYouEntry => {
    const key = checkKey(check.id);
    return {
      key: `problem:security:${check.id}`,
      kind: 'problem',
      at: audit.ranAt,
      href: godPath('security'),
      icon: ShieldAlert,
      title: key ? tCheck(key) : check.id,
      detail: t('securityCheck'),
    };
  });
  return { entries, isPending: false };
}
