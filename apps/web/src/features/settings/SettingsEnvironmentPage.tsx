'use client';

import { useState } from 'react';
import { KeyRound, Plus, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useShell } from '@/context/shellContext';
import { usePermissions } from '@/hooks/usePermissions';
import { useTeam } from '@/services/teams.service';
import { useCredentialsPageQuery } from '@/services/credentials.service';
import type { CredentialEntry as Credential } from '@/lib/api/endpoints/credentials';
import { EnvironmentVariableList } from '@/features/access/EnvironmentVariableList';
import { GrantsDialog } from '@/features/access/GrantsDialog';
import {
  Badge,
  Button,
  EmptyState,
  List,
  ListRow,
  Page,
  PageActions,
  Section,
  Stack,
} from '@/design-system';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { helenaSettingsPath } from './settingsModalCatalog';

// Projekt › Einstellungen › Zugänge verwalten (owner, O59/O42): the logins, keys and
// variables this project's agents may use — the project's own and the team's granted to
// it — with who may use them, and the environment variables its agents get from them.
// Zugänge are created in Helena's Zugänge & Verbindungen; here they are granted.
export default function SettingsEnvironmentPage() {
  const t = useTranslations('settings.projectAccess');
  const tKinds = useTranslations('credentials.kinds');
  const { project } = useShell();
  const { isAdmin } = usePermissions();
  const teamId = project?.project.teamId ?? 0;
  const projectId = project?.project.id ?? 0;
  const team = useTeam(teamId);
  const canManage = team != null && team.role !== 'member';
  const credentials = useCredentialsPageQuery(teamId, { page: 1, pageSize: 100 });
  const [granting, setGranting] = useState<Credential | null>(null);

  if (!project) return null;
  const mine = (credentials.data?.items ?? []).filter(
    (entry) =>
      entry.projectId === projectId || entry.grants.some((grant) => grant.projectId === projectId),
  );
  const whoOf = (entry: Credential) => {
    const here = entry.grants.filter((grant) => grant.projectId === projectId);
    if (here.some((grant) => grant.agentId === null)) return t('allAgents');
    const names = here.map((grant) => grant.agentName).filter(Boolean);
    return names.length > 0 ? names.join(', ') : t('notGranted');
  };

  return (
    <Page
      actions={
        isAdmin ? (
          <PageActions
            primary={{
              id: 'new',
              label: t('create'),
              icon: Plus,
              href: helenaSettingsPath('access', 'credentials'),
            }}
          />
        ) : undefined
      }
    >
      <Stack gap={6}>
        <Section title={t('credentialsTitle')}>
          {credentials.isPending ? (
            <ListSkeleton rows={3} rowClassName="h-10" />
          ) : mine.length === 0 ? (
            <EmptyState icon={<KeyRound />} fill={false}>
              {t('empty')}
            </EmptyState>
          ) : (
            <List label={t('credentialsTitle')}>
              {mine.map((entry) => (
                <ListRow
                  key={entry.id}
                  icon={<KeyRound size={16} />}
                  title={entry.label}
                  subtitle={whoOf(entry)}
                  meta={
                    <Badge tone={entry.projectId === projectId ? 'accent' : 'neutral'}>
                      {entry.projectId === projectId
                        ? t('ownProject')
                        : tKinds(entry.kind as never)}
                    </Badge>
                  }
                  actions={
                    canManage ? (
                      <Button
                        size="small"
                        variant="quiet"
                        icon={<ShieldCheck size={14} />}
                        onClick={() => setGranting(entry)}
                      >
                        {t('grants')}
                      </Button>
                    ) : undefined
                  }
                />
              ))}
            </List>
          )}
        </Section>
        <Section title={t('environmentTitle')} description={t('environmentHint')}>
          <EnvironmentVariableList teamId={teamId} target={{ projectId }} />
        </Section>
      </Stack>
      {granting && (
        <GrantsDialog
          teamId={teamId}
          target={{
            id: granting.id,
            label: granting.label,
            projectId: granting.projectId,
            grants: granting.grants,
            runtime: granting.kind === 'runtime_login' ? granting.runtime : null,
          }}
          services={[]}
          onClose={() => setGranting(null)}
        />
      )}
    </Page>
  );
}
