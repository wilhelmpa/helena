'use client';

import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import SettingsCard from '@/components/common/page/SettingsCard';
import SettingsSection from '@/components/common/page/SettingsSection';
import StatusBadge from '@/components/common/page/StatusBadge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ModelAvailabilityEntry } from '@/lib/api/endpoints/modelAvailability';
import { useAgentChatCatalogQuery } from '@/services/aiAgents.service';
import { formatDateTime, formatDurationShort } from '@/utils/dates';
import {
  useClearModelAvailability,
  useModelAvailability,
  useReplaceModel,
} from '../services/modelAvailability.service';
import { NameList } from '@/design-system';

const AGENT_DEFAULT = '__agent_default__';

// Administrator → Agenten-Laufzeit → Modelle: which models the providers refused this
// installation (left out of every picker) and which a run confirmed, each refusal with the
// agents still set to it, the move of all of them onto another model, and "Erneut prüfen".
export default function ModelAvailabilitySection() {
  const t = useTranslations('modelAvailability.admin');
  const findings = useModelAvailability(true);
  const entries = findings.data?.entries ?? [];

  return (
    <div id="models" className="scroll-mt-4">
      <SettingsSection title={t('title')} description={t('description')}>
        {!findings.data ? (
          <ListSkeleton rows={2} rowClassName="h-12" />
        ) : entries.length === 0 ? (
          <SettingsCard className="p-4 text-sm text-muted-foreground">{t('empty')}</SettingsCard>
        ) : (
          <SettingsCard className="divide-y">
            {entries.map((entry) => (
              <FindingRow key={entry.id} entry={entry} />
            ))}
          </SettingsCard>
        )}
      </SettingsSection>
    </div>
  );
}

function FindingRow({ entry }: { entry: ModelAvailabilityEntry }) {
  const t = useTranslations('modelAvailability');
  const clear = useClearModelAvailability();
  const refused = entry.state === 'unavailable';
  return (
    <div className="space-y-2 p-3 text-sm">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <span className="min-w-0 truncate font-medium" dir="ltr">
          {entry.model}
        </span>
        <span className="text-xs text-muted-foreground" dir="ltr">
          {[entry.runtime, entry.provider].filter(Boolean).join(' · ')}
        </span>
        <StatusBadge status={refused ? 'danger' : 'success'}>
          {refused ? t('admin.unavailable') : t('admin.works')}
        </StatusBadge>
        <span
          className="ms-auto text-xs text-muted-foreground"
          title={formatDateTime(entry.observedAt)}
        >
          {t('admin.seen', { time: formatDurationShort(entry.observedAt) })}
        </span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 gap-1 px-2 text-xs"
          title={t('retryHint')}
          disabled={clear.isPending}
          onClick={() =>
            clear.mutate(
              { teamId: null, entryId: entry.id },
              { onSuccess: () => toast.success(t('retried', { model: entry.model })) },
            )
          }
        >
          <RotateCcw className="size-3" />
          {t('retry')}
        </Button>
      </div>
      {entry.detail && (
        <p className="text-xs text-muted-foreground" dir="auto">
          {t('providerSaid', { detail: entry.detail })}
        </p>
      )}
      {refused &&
        (entry.agents.length > 0 ? (
          <>
            <p className="text-xs" dir="auto">
              {t('admin.usedByLabel')}{' '}
              <NameList names={entry.agents.map((agent) => `@${agent.username}`)} />
            </p>
            <ReplaceControl entry={entry} />
          </>
        ) : (
          <p className="text-xs text-muted-foreground">{t('admin.unused')}</p>
        ))}
    </div>
  );
}

// "Alle umstellen auf": the models the first agent's runner offers (the refused one is not
// among them) or the agent default, for every team whose agents run the refused model.
function ReplaceControl({ entry }: { entry: ModelAvailabilityEntry }) {
  const t = useTranslations('modelAvailability.admin');
  const [target, setTarget] = useState<string>(AGENT_DEFAULT);
  const first = entry.agents.find((agent) => !agent.template) ?? entry.agents[0]!;
  const catalog = useAgentChatCatalogQuery(first.teamId, first.id);
  const replace = useReplaceModel();
  const teams = [...new Set(entry.agents.map((agent) => agent.teamId))];

  async function run() {
    const to = target === AGENT_DEFAULT ? null : target;
    let count = 0;
    for (const teamId of teams) {
      const result = await replace.mutateAsync({ teamId, from: entry.model, to });
      count += result.changed.length + result.followTemplate.length;
    }
    toast.success(t('replaced', { count }));
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">{t('replaceWith')}</span>
      <Select value={target} onValueChange={setTarget}>
        <SelectTrigger className="h-8 w-56" aria-label={t('replaceWith')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AGENT_DEFAULT}>{t('agentDefault')}</SelectItem>
          {(catalog.data?.models ?? []).map((model) => (
            <SelectItem key={model.id} value={model.id}>
              {model.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={replace.isPending}
        onClick={() => void run().catch(() => undefined)}
      >
        {t('replace')}
      </Button>
    </div>
  );
}
