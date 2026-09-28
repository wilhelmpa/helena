'use client';

import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { HelenaRuntimeSettings, HelenaToolProfile } from '@/lib/api/endpoints/agents';

// The settings of Helena's own loop for one agent (docs/helena-decisions/zentrale-laufzeit.md):
// the tools of its role, and when it hands a task to a bigger model (Claude Code or Codex with
// the owner's subscriptions, which run it as a follow-up on the task).

const PROFILES: HelenaToolProfile[] = ['assistent', 'recherche', 'coder-lite', 'voll'];
const TARGETS = ['none', 'runtime:claude', 'runtime:codex'] as const;
const TASK_KINDS = [
  'programmierung-gross',
  'architektur',
  'sicherheit',
  'recht',
  'aussenkommunikation',
] as const;
const TARGET_LABEL = {
  none: 'none',
  'runtime:claude': 'claude',
  'runtime:codex': 'codex',
} as const;

export default function AgentHelenaRuntimeFields({
  value,
  onChange,
}: {
  value: HelenaRuntimeSettings | undefined;
  onChange: (next: HelenaRuntimeSettings) => void;
}) {
  const t = useTranslations('teams.agents.helenaRuntime');
  const settings = value ?? {};
  const escalation = settings.escalation ?? {};
  const target = escalation.target ?? 'none';
  const kinds = new Set<string>(escalation.taskKinds ?? []);
  const setEscalation = (next: NonNullable<HelenaRuntimeSettings['escalation']>) =>
    onChange({ ...settings, escalation: { ...escalation, ...next } });

  return (
    <div className="mt-3 space-y-4" data-testid="helena-runtime-fields">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">{t('toolProfile')}</span>
          <Select
            value={settings.toolProfile ?? 'assistent'}
            onValueChange={(next) =>
              onChange({ ...settings, toolProfile: next as HelenaToolProfile })
            }
          >
            <SelectTrigger aria-label={t('toolProfile')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROFILES.map((profile) => (
                <SelectItem key={profile} value={profile}>
                  {t(`profile.${profile}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="block text-xs text-muted-foreground">
            {t(`profileHint.${settings.toolProfile ?? 'assistent'}`)}
          </span>
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">{t('browserBudget')}</span>
          <Input
            type="number"
            min={30}
            max={3600}
            step={30}
            value={settings.browserBudgetSeconds ?? 240}
            onChange={(event) => {
              const seconds = Number(event.target.value);
              onChange({
                ...settings,
                browserBudgetSeconds: Number.isFinite(seconds) && seconds >= 30 ? seconds : 240,
              });
            }}
          />
          <span className="block text-xs text-muted-foreground">{t('browserBudgetHint')}</span>
        </label>
      </div>

      <div className="space-y-3">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">{t('escalationTarget')}</span>
          <Select
            value={TARGETS.includes(target as (typeof TARGETS)[number]) ? target : 'none'}
            onValueChange={(next) => setEscalation({ target: next === 'none' ? null : next })}
          >
            <SelectTrigger aria-label={t('escalationTarget')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TARGETS.map((option) => (
                <SelectItem key={option} value={option}>
                  {t(`target.${TARGET_LABEL[option]}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="block text-xs text-muted-foreground">{t('escalationHint')}</span>
        </label>

        {target !== 'none' && (
          <>
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">{t('taskKinds')}</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {TASK_KINDS.map((kind) => (
                  <label key={kind} className="flex items-center gap-2 text-sm">
                    <Switch
                      checked={kinds.has(kind)}
                      onCheckedChange={(checked) => {
                        const next = new Set(kinds);
                        if (checked) next.add(kind);
                        else next.delete(kind);
                        setEscalation({ taskKinds: [...next] });
                      }}
                      aria-label={t(`kind.${kind}`)}
                    />
                    {t(`kind.${kind}`)}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>{t('onFailure')}</span>
                <Switch
                  checked={escalation.onFailure !== false}
                  onCheckedChange={(checked) => setEscalation({ onFailure: checked })}
                  aria-label={t('onFailure')}
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">{t('confidence')}</span>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={5}
                  placeholder={t('confidenceOff')}
                  value={
                    escalation.confidenceBelow === undefined
                      ? ''
                      : Math.round(escalation.confidenceBelow * 100)
                  }
                  onChange={(event) => {
                    const raw = event.target.value.trim();
                    const percent = Number(raw);
                    setEscalation({
                      confidenceBelow:
                        raw === '' || !Number.isFinite(percent)
                          ? undefined
                          : Math.max(0, Math.min(100, percent)) / 100,
                    });
                  }}
                />
                <span className="block text-xs text-muted-foreground">{t('confidenceHint')}</span>
              </label>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
