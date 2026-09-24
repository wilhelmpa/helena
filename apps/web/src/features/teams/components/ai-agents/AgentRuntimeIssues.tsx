'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import CopyableCommand from '@/components/common/page/CopyableCommand';
import { Button } from '@/components/ui/button';
import type { RuntimeIssue } from '@/lib/api/endpoints/agentRuntimeSync';
import { credentialsPath } from '@/utils/paths';

// What keeps a Claude Code or Codex agent's runtime from its work, with what the owner does
// about it: sign it in (a runtime login in Zugänge, or the command the runner names for
// the owner terminal), install it, or switch agent isolation on for Codex.
export default function AgentRuntimeIssues({
  adapter,
  issues,
}: {
  adapter: string | null;
  issues: RuntimeIssue[];
}) {
  const t = useTranslations('teams.agents.profileSync');
  if (issues.length === 0) return null;
  const runtime = adapter === 'codex' ? 'codex' : 'claude';
  return (
    <ul className="space-y-2">
      {issues.map((issue) => (
        <li key={issue.code} className="space-y-1.5 text-sm">
          <p className={issue.code === 'sandbox-unavailable' ? undefined : 'text-destructive'}>
            {issue.code === 'not-signed-in'
              ? t(issue.detail === 'rejected' ? 'issues.rejected' : 'issues.notSignedIn')
              : issue.code === 'runtime-missing'
                ? t('issues.runtimeMissing', { runtime: t(`runtimes.${runtime}`) })
                : t('issues.sandboxUnavailable')}
          </p>
          {issue.code === 'not-signed-in' && (
            <>
              <p className="text-xs text-muted-foreground">{t(`signIn.${runtime}`)}</p>
              {issue.command && (
                <CopyableCommand
                  command={issue.command}
                  copyLabel={t('copyCommand')}
                  copiedLabel={t('copied')}
                />
              )}
              <Button asChild size="sm" variant="outline">
                <Link href={credentialsPath()}>{t('openAccess')}</Link>
              </Button>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
