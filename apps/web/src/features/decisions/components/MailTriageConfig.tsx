'use client';

import { useTranslations } from 'next-intl';
import SettingsCard from '@/components/common/page/SettingsCard';
import SettingsRow from '@/components/common/page/SettingsRow';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAiAgentsQuery } from '@/services/aiAgents.service';

type Mode = 'off' | 'suggest' | 'auto';

const NONE = 'none';

function readMode(value: unknown, fallback: Mode): Mode {
  return value === 'off' || value === 'suggest' || value === 'auto' ? value : fallback;
}

// What the mail classifier does with its answers (docs/helena-decisions/decisions.md §5): every
// action that writes is off or a suggestion the owner confirms until he picks "automatisch".
export function MailTriageConfig({
  teamId,
  config,
  onSave,
}: {
  teamId: number;
  config: Record<string, unknown>;
  onSave: (config: Record<string, unknown>) => void;
}) {
  const t = useTranslations('decisions.mail');
  const agents = (useAiAgentsQuery(teamId).data ?? []).filter((agent) => !agent.template);
  const project = readMode(config.project, 'suggest');
  const task = readMode(config.task, 'suggest');
  const agentMode = readMode(config.agent, 'off');
  const agentId = typeof config.agentId === 'number' ? config.agentId : null;
  const receipts = config.receipts === 'auto' ? 'auto' : 'off';
  const save = (patch: Record<string, unknown>) => onSave({ ...config, ...patch });

  const modeSelect = (
    value: Mode,
    onChange: (mode: Mode) => void,
    label: string,
    modes: Mode[],
  ) => (
    <Select value={value} onValueChange={(next) => onChange(next as Mode)}>
      <SelectTrigger className="w-48" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {modes.map((mode) => (
          <SelectItem key={mode} value={mode}>
            {t(`modes.${mode}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <SettingsCard className="divide-y divide-border/60">
      <SettingsRow
        title={t('project')}
        description={t('projectHint')}
        control={modeSelect(project, (mode) => save({ project: mode }), t('project'), [
          'off',
          'suggest',
          'auto',
        ])}
      />
      <SettingsRow
        title={t('task')}
        description={t('taskHint')}
        control={modeSelect(task, (mode) => save({ task: mode }), t('task'), [
          'off',
          'suggest',
          'auto',
        ])}
      />
      <SettingsRow
        title={t('agent')}
        description={t('agentHint')}
        control={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Select
              value={agentId === null ? NONE : String(agentId)}
              onValueChange={(value) =>
                save(
                  value === NONE
                    ? { agentId: null, agent: 'off' }
                    : {
                        agentId: Number(value),
                        agent: agentMode === 'off' ? 'suggest' : agentMode,
                      },
                )
              }
            >
              <SelectTrigger className="w-48" aria-label={t('agentPick')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t('noAgent')}</SelectItem>
                {agents.map((agent) => (
                  <SelectItem key={agent.id} value={String(agent.id)}>
                    {agent.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {agentId !== null &&
              modeSelect(agentMode, (mode) => save({ agent: mode }), t('agent'), [
                'off',
                'suggest',
                'auto',
              ])}
          </div>
        }
      />
      <SettingsRow
        title={t('receipts')}
        description={t('receiptsHint')}
        control={
          <Select value={receipts} onValueChange={(value) => save({ receipts: value })}>
            <SelectTrigger className="w-48" aria-label={t('receipts')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">{t('modes.off')}</SelectItem>
              <SelectItem value="auto">{t('modes.auto')}</SelectItem>
            </SelectContent>
          </Select>
        }
      />
    </SettingsCard>
  );
}
