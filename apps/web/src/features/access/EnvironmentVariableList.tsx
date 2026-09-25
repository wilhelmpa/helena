import Link from 'next/link';
import { KeyRound, Lock, Variable } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { EnvironmentVariable } from '@/lib/api/endpoints/credentials';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAgentEnvironmentQuery } from '@/services/credentials.service';
import { accessPath } from '@/utils/paths';

// The environment variables from Zugänge that reach an agent's runs, or those of a project's
// agents (docs/helena-decisions/agent-env.md): names and where they come from, never a
// value. They are changed in Zugänge, where the link leads.
export function EnvironmentVariableList({
  teamId,
  target,
}: {
  teamId: number;
  target: { agentId: number } | { projectId: number };
}) {
  const t = useTranslations('credentials.environment');
  const { data, isLoading, isError } = useAgentEnvironmentQuery(teamId, target);
  const variables = data?.variables ?? [];

  function source(variable: EnvironmentVariable): string {
    const receivers = variable.grants.map((grant) =>
      grant.agentName
        ? grant.agentName
        : t('allAgentsOf', { project: grant.projectKey ?? '' }),
    );
    return [variable.label, ...new Set(receivers)].join(' · ');
  }

  return (
    <div className="space-y-2">
      {isLoading ? (
        <ListSkeleton rows={2} rowClassName="h-9" />
      ) : isError ? (
        <p className="text-sm text-muted-foreground">{t('noAccess')}</p>
      ) : variables.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="divide-y divide-sidebar-border overflow-hidden rounded-md border border-sidebar-border bg-card">
          {variables.map((variable) => (
            <li key={variable.credentialId} className="flex items-center gap-3 px-3 py-2">
              {variable.secret ? (
                <Lock className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              ) : (
                <Variable className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              )}
              <div className="min-w-0 flex-1">
                <div dir="ltr" className="truncate font-mono text-[13px]">
                  {variable.name}
                </div>
                <div className="truncate text-xs text-muted-foreground">{source(variable)}</div>
              </div>
              <Badge variant="outline" className="shrink-0 text-xs font-normal">
                {variable.secret ? t('secret') : t('plain')}
              </Badge>
              {variable.projectKey && (
                <Badge variant="secondary" className="shrink-0 text-xs font-normal">
                  {variable.projectKey}
                </Badge>
              )}
            </li>
          ))}
        </ul>
      )}
      <Button asChild variant="outline" size="sm">
        <Link href={accessPath('credentials')}>
          <KeyRound />
          {t('manage')}
        </Link>
      </Button>
    </div>
  );
}
