'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import SettingsCard from '@/components/common/page/SettingsCard';
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
import type { JudgeKind, LocalAiJudge } from '@/lib/api/endpoints/localAi';
import { useLocalAiJudge, useUpdateLocalAiJudge } from '../services/localAi.service';

const KINDS: JudgeKind[] = ['run', 'endpoint', 'off'];
const REASONING = ['low', 'medium', 'high'] as const;
const AUTO = '__auto__';

// The judge of the evals a program cannot check (Deutsch-Texte): which model scores the texts.
// By default a text-only run on a subscription model the owner already has.
export default function LocalAiJudgeSection() {
  const t = useTranslations('localAi.judge');
  const judge = useLocalAiJudge();
  if (!judge.data) return null;
  return (
    <SettingsSection title={t('title')} description={t('description')}>
      <SettingsCard className="p-4">
        <JudgeForm judge={judge.data} />
      </SettingsCard>
    </SettingsSection>
  );
}

function JudgeForm({ judge }: { judge: LocalAiJudge }) {
  const t = useTranslations('localAi.judge');
  const update = useUpdateLocalAiJudge();
  const [model, setModel] = useState(judge.model ?? '');
  const [baseUrl, setBaseUrl] = useState(judge.baseUrl ?? '');
  const [key, setKey] = useState('');
  const onError = (error: Error) => toast.error(error.message);
  return (
    <div className="grid gap-3 text-sm sm:grid-cols-2">
      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">{t('kind')}</span>
        <Select
          value={judge.kind}
          onValueChange={(kind) => update.mutate({ kind: kind as JudgeKind }, { onError })}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {KINDS.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {t(`kinds.${kind}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      {judge.kind !== 'off' && (
        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">{t('model')}</span>
          <Input
            dir="ltr"
            value={model}
            placeholder="gpt-6-sol"
            onChange={(e) => setModel(e.target.value)}
            onBlur={() =>
              model.trim() !== (judge.model ?? '') &&
              update.mutate({ model: model.trim() || null }, { onError })
            }
          />
        </label>
      )}
      {judge.kind === 'run' && (
        <>
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">{t('agent')}</span>
            <Select
              value={judge.agentId === null ? AUTO : String(judge.agentId)}
              onValueChange={(value) =>
                update.mutate({ agentId: value === AUTO ? null : Number(value) }, { onError })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AUTO}>{t('agentAuto')}</SelectItem>
                {judge.agents.map((agent) => (
                  <SelectItem key={agent.id} value={String(agent.id)}>
                    {`${agent.name} (@${agent.username})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">{t('reasoning')}</span>
            <Select
              value={judge.reasoning ?? 'medium'}
              onValueChange={(reasoning) => update.mutate({ reasoning }, { onError })}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REASONING.map((level) => (
                  <SelectItem key={level} value={level}>
                    {t(`reasoningLevels.${level}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </>
      )}
      {judge.kind === 'endpoint' && (
        <>
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">{t('baseUrl')}</span>
            <Input dir="ltr" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">{t('key')}</span>
            <Input
              type="password"
              autoComplete="off"
              placeholder={judge.hasKey ? t('keyKept') : undefined}
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          </label>
          <div className="sm:col-span-2">
            <Button
              variant="outline"
              size="sm"
              disabled={update.isPending}
              onClick={() =>
                update.mutate(
                  {
                    baseUrl: baseUrl.trim() || null,
                    model: model.trim() || null,
                    ...(key.trim() ? { key: key.trim() } : {}),
                  },
                  { onSuccess: () => setKey(''), onError },
                )
              }
            >
              {t('save')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
