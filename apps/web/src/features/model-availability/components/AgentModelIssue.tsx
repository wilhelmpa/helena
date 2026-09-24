'use client';

import { AlertTriangle, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import CopyableCommand from '@/components/common/page/CopyableCommand';
import { Button } from '@/components/ui/button';
import type { UnavailableChatModel } from '@/lib/api/endpoints/agentChat';
import { formatDateTime } from '@/utils/dates';
import { useClearModelAvailability } from '../services/modelAvailability.service';
import { accountOf } from '../utils/modelFailure';

// Under the agent editor's model: the agent is set to a model its provider refused this
// account ("Modell nicht verfügbar für dein Konto – wähle ein anderes"), with the provider's
// words, the way back to the agent default, and "Erneut prüfen" for a model that may be
// offered again. For a template copy that fell back to the default, why it did.
export default function AgentModelIssue({
  teamId,
  refusal,
  runtime,
  templateModel,
  deadLogin,
  model,
  canEdit,
  onUseDefault,
}: {
  teamId: number;
  refusal: UnavailableChatModel | undefined;
  runtime: string;
  templateModel: string | null;
  // The Hermes login the agent's model runs through, when the provider rejected it.
  deadLogin?: { provider: string; state: string; command: string | null };
  model: string | null;
  canEdit: boolean;
  onUseDefault: () => void;
}) {
  const t = useTranslations('modelAvailability');
  const tSync = useTranslations('teams.agents.profileSync');
  const clear = useClearModelAvailability();
  if (!refusal && deadLogin)
    return (
      <div
        role="alert"
        className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
      >
        <p className="flex items-start gap-2 text-destructive" dir="auto">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            {model
              ? t('deadLogin', {
                  model,
                  account: accountOf(deadLogin.provider),
                  state: deadLogin.state,
                })
              : t('deadLoginDefault', {
                  account: accountOf(deadLogin.provider),
                  state: deadLogin.state,
                })}
          </span>
        </p>
        {canEdit && deadLogin.command && (
          <CopyableCommand
            command={deadLogin.command}
            copyLabel={tSync('copyCommand')}
            copiedLabel={tSync('copied')}
          />
        )}
      </div>
    );
  if (!refusal && !templateModel) return null;
  if (!refusal)
    return (
      <p className="text-xs text-muted-foreground" dir="auto">
        {t('templateFallback', { model: templateModel ?? '' })}
      </p>
    );
  return (
    <div
      role="alert"
      className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
    >
      <p className="flex items-start gap-2 text-destructive" dir="auto">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <span>
          {t('refused', {
            model: refusal.id,
            account: accountOf(refusal.provider, runtime, refusal.id),
          })}
        </span>
      </p>
      <p className="text-xs text-muted-foreground" dir="auto">
        {refusal.detail ? `${t('providerSaid', { detail: refusal.detail })} · ` : ''}
        {t('since', { time: formatDateTime(refusal.since) })}
      </p>
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={onUseDefault}>
            {t('useDefault')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            title={t('retryHint')}
            disabled={clear.isPending}
            onClick={() =>
              clear.mutate(
                { teamId, entryId: refusal.findingId },
                { onSuccess: () => toast.success(t('retried', { model: refusal.id })) },
              )
            }
          >
            <RotateCcw className="size-3.5" />
            {t('retry')}
          </Button>
        </div>
      )}
    </div>
  );
}
