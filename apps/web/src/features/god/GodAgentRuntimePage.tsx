'use client';

import { useState } from 'react';
import Link from 'next/link';
import { PackageCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import SettingsCard from '@/components/common/page/SettingsCard';
import SettingsRow from '@/components/common/page/SettingsRow';
import SettingsSection from '@/components/common/page/SettingsSection';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { FallbackModel } from '@/lib/api/endpoints/agents';
import type { HermesUpdateState, RuntimeDefaults } from '@/lib/api/endpoints/agentRuntime';
import { formatDateTime } from '@/utils/dates';
import { approvalsPath } from '@/utils/paths';
import { useTeamsQuery } from '@/services/teams.service';
import { EmergencyStopControl } from '@/features/agent-runtime/components/EmergencyStop';
import FallbackModelsEditor from '@/features/agent-runtime/components/FallbackModelsEditor';
import { cleanFallbackModels } from '@/features/agent-runtime/utils/fallback';
import UsageReport from '@/features/agent-runtime/components/UsageReport';
import ProviderLimitsSection from '@/features/provider-limits/components/ProviderLimitsSection';
import ModelAvailabilitySection from '@/features/model-availability/components/ModelAvailabilitySection';
import { InstanceBrowserControlSection } from '@/features/browser-lab/components/InstanceBrowserControlSection';
import {
  useHermesUpdate,
  useRuntimeDefaults,
  useSetRuntimeDefaults,
} from '@/features/agent-runtime/services/agentRuntime.service';
import GodSectionPage from './components/GodSectionPage';

// Administrator → Agenten-Laufzeit: what used to need the Hermes dashboard, for the whole
// instance. The emergency stop, the Hermes installation (version, what an update brings,
// requesting one), the plan limits of the subscriptions the agents work on, which models
// they really offer (model availability), the defaults
// every agent's runtime gets (fallback models, how long sessions are kept) and what the
// agents of a team spent.
export default function GodAgentRuntimePage() {
  const t = useTranslations('agentRuntime.admin');
  const defaults = useRuntimeDefaults(true);

  return (
    <GodSectionPage slug="agent-runtime">
      <SettingsSection title={t('stopTitle')} description={t('stopDescription')}>
        <SettingsCard className="p-4">
          <EmergencyStopControl />
        </SettingsCard>
      </SettingsSection>

      <ProviderLimitsSection />

      <ModelAvailabilitySection />

      <HermesSection />

      {defaults.data ? (
        <DefaultsSections defaults={defaults.data} />
      ) : (
        <ListSkeleton rows={2} rowClassName="h-12" />
      )}

      <InstanceBrowserControlSection />

      <TeamUsageSection />
    </GodSectionPage>
  );
}

function HermesSection() {
  const t = useTranslations('agentRuntime.admin');
  const state = useHermesUpdate();
  const data: HermesUpdateState | undefined = state.data;
  const current = data?.check?.current;
  const latest = data?.check?.latest;
  const behind = data?.check ? data.check.commits.length : 0;
  const proposal = data?.proposal;
  const label = (ref: { version: string | null; describe: string | null; commit: string }) =>
    ref.version ?? ref.describe ?? ref.commit.slice(0, 8);

  return (
    <SettingsSection title={t('hermesTitle')} description={t('hermesDescription')}>
      <SettingsCard className="space-y-3 p-4 text-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1 space-y-0.5">
            <p>{current ? t('installed', { version: label(current) }) : t('notChecked')}</p>
            {data?.checkedAt && (
              <p className="text-xs text-muted-foreground">
                {behind > 0 && latest
                  ? t('behind', { count: behind, version: label(latest) })
                  : t('upToDate')}
                {' · '}
                {t('checkedAt', { at: formatDateTime(data.checkedAt) })}
              </p>
            )}
          </div>
          {/* Checking and updating Hermes happen in the update center, with everything else
              Helena runs on (Administrator → Updates). */}
          <Button variant="outline" size="sm" asChild>
            <Link href="/god/server/updates">
              <PackageCheck />
              {t('openUpdates')}
            </Link>
          </Button>
        </div>

        {data?.check && data.check.commits.length > 0 && (
          <details>
            <summary className="cursor-pointer text-sm">
              {t('changelog', { count: data.check.commits.length })}
            </summary>
            <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto text-xs">
              {data.check.commits.map((commit) => (
                <li key={commit.commit} className="flex gap-2">
                  <span className="shrink-0 font-mono text-muted-foreground" dir="ltr">
                    {commit.commit.slice(0, 8)}
                  </span>
                  <span className="shrink-0 text-muted-foreground">{commit.date.slice(0, 10)}</span>
                  <span className="min-w-0" dir="auto">
                    {commit.subject}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
        {data?.check && data.check.localPatches.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {t('localPatches', {
              count: data.check.localPatches.length,
              list: data.check.localPatches.map((patch) => patch.subject).join('; '),
            })}
          </p>
        )}

        {proposal && (
          <div className="space-y-1 border-t border-border/60 pt-3">
            <p className="text-xs">
              <span className="font-medium">{proposal.title}</span>
              {' · '}
              {t(`proposalStatus.${proposal.status}`)}
              {' · '}
              {formatDateTime(proposal.decidedAt ?? proposal.createdAt)}
              {proposal.status === 'pending' && (
                <>
                  {' · '}
                  <Link href={approvalsPath()} className="underline underline-offset-2">
                    {t('toApprovals')}
                  </Link>
                </>
              )}
            </p>
            {proposal.error && <p className="text-xs text-destructive">{proposal.error}</p>}
            {proposal.log && (
              <details>
                <summary className="cursor-pointer text-xs text-muted-foreground">
                  {t('log')}
                </summary>
                <pre
                  className="mt-1 max-h-72 overflow-auto rounded-md bg-muted/50 p-2 text-xs whitespace-pre-wrap"
                  dir="ltr"
                >
                  {proposal.log}
                </pre>
              </details>
            )}
          </div>
        )}
      </SettingsCard>
    </SettingsSection>
  );
}

function DefaultsSections({ defaults }: { defaults: RuntimeDefaults }) {
  const t = useTranslations('agentRuntime.admin');
  const tCommon = useTranslations('common');
  const save = useSetRuntimeDefaults();
  const [fallback, setFallback] = useState<FallbackModel[]>(defaults.fallbackModels);
  const [retention, setRetention] = useState(
    defaults.sessionRetentionDays == null ? '' : String(defaults.sessionRetentionDays),
  );
  const cleaned = cleanFallbackModels(fallback);
  const fallbackChanged = JSON.stringify(cleaned) !== JSON.stringify(defaults.fallbackModels);
  const retentionValue = retention.trim() === '' ? null : Number(retention);
  const retentionValid =
    retentionValue === null ||
    (Number.isInteger(retentionValue) && retentionValue >= 1 && retentionValue <= 3650);

  async function saveDefaults(patch: Partial<RuntimeDefaults>, message: string) {
    try {
      const next = await save.mutateAsync(patch);
      setFallback(next.fallbackModels);
      toast.success(message);
    } catch {
      // The failure already surfaced through the global mutation error toast.
    }
  }

  return (
    <>
      <SettingsSection title={t('fallbackTitle')} description={t('fallbackDescription')}>
        <SettingsCard className="space-y-3 p-4">
          <FallbackModelsEditor value={fallback} onChange={setFallback} disabled={save.isPending} />
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={!fallbackChanged || save.isPending}
              onClick={() => void saveDefaults({ fallbackModels: cleaned }, t('saved'))}
            >
              {save.isPending ? tCommon('saving') : tCommon('save')}
            </Button>
          </div>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('sessionsTitle')}>
        <SettingsCard>
          <SettingsRow
            title={t('retention')}
            description={t('retentionHint')}
            control={
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  max={3650}
                  className="w-24"
                  value={retention}
                  placeholder="90"
                  disabled={save.isPending}
                  aria-invalid={!retentionValid}
                  aria-label={t('retention')}
                  onChange={(event) => setRetention(event.target.value)}
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={
                    !retentionValid ||
                    save.isPending ||
                    retentionValue === defaults.sessionRetentionDays
                  }
                  onClick={() =>
                    void saveDefaults({ sessionRetentionDays: retentionValue }, t('saved'))
                  }
                >
                  {tCommon('save')}
                </Button>
              </div>
            }
          />
        </SettingsCard>
      </SettingsSection>
    </>
  );
}

function TeamUsageSection() {
  const t = useTranslations('agentRuntime.admin');
  const teams = useTeamsQuery().data ?? [];
  const [chosen, setChosen] = useState<number | null>(null);
  const teamId = chosen ?? teams[0]?.id ?? null;

  return (
    <SettingsSection title={t('usageTitle')} description={t('usageDescription')}>
      <SettingsCard className="space-y-3 p-4">
        {teams.length > 1 && (
          <Select
            value={teamId == null ? '' : String(teamId)}
            onValueChange={(v) => setChosen(Number(v))}
          >
            <SelectTrigger className="h-8 w-56" aria-label={t('team')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {teams.map((team) => (
                <SelectItem key={team.id} value={String(team.id)}>
                  {team.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {teamId != null ? (
          <UsageReport
            key={teamId}
            teamId={teamId}
            groupings={[
              { id: 'agent', by: ['agent', 'model'] },
              { id: 'model', by: ['model'] },
              { id: 'project', by: ['project'] },
              { id: 'day', by: ['day'] },
            ]}
          />
        ) : (
          <p className="text-sm text-muted-foreground">{t('noTeam')}</p>
        )}
      </SettingsCard>
    </SettingsSection>
  );
}
