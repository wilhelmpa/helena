'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { AiAgent, AgentRuntimeKind } from '@/lib/api/endpoints/agents';
import RuntimePicker, { runtimeChoice } from '@/components/helena/RuntimePicker';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useChatCatalog } from '../../hooks/useChatCatalog';
import { useUpdateAiAgent } from '@/services/aiAgents.service';

export default function ChatRuntimeDialog({
  scopeKey,
  agent,
  onClose,
  onConfirmed,
}: {
  scopeKey: string;
  agent: AiAgent;
  onClose: () => void;
  onConfirmed: () => void;
}) {
  const t = useTranslations('chatWorkspace.runtimePicker');
  const [runtime, setRuntime] = useState<AgentRuntimeKind>(agent.runtimePolicy.runtime ?? 'hermes');
  const [model, setModel] = useState<string | null>(agent.model);
  const [reasoning, setReasoning] = useState<string | null>(agent.runtimePolicy.reasoningEffort);
  const catalog = useChatCatalog(scopeKey, agent.id);
  const update = useUpdateAiAgent(agent.teamId);
  const changed =
    runtimeChoice(runtime, model) !==
    runtimeChoice(agent.runtimePolicy.runtime ?? 'hermes', agent.model);

  async function confirm() {
    if (!changed) return;
    await update.mutateAsync({
      id: agent.id,
      patch: {
        model,
        runtimePolicy: {
          ...agent.runtimePolicy,
          runtime: runtime === 'hermes' ? undefined : runtime,
          reasoningEffort: reasoning,
        },
      },
    });
    onClose();
    onConfirmed();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('scope')}</DialogDescription>
        </DialogHeader>
        <RuntimePicker
          runtime={runtime}
          model={model}
          reasoning={reasoning}
          models={[
            ...(runtime === (agent.runtimePolicy.runtime ?? 'hermes')
              ? (catalog.data?.models ?? [])
              : []),
            ...(catalog.data?.localModels ?? []),
          ]}
          onChange={(nextRuntime, nextModel, nextReasoning) => {
            setRuntime(nextRuntime);
            setModel(nextModel);
            setReasoning(nextReasoning);
          }}
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            disabled={!changed || update.isPending}
            onClick={() => void confirm()}
          >
            {t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
