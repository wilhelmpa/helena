import { useState } from 'react';
import { Loader2, Play } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { BrowserControlPolicy, LabOptions } from '@/lib/api/endpoints/browserTask';
import { connectionLabel, toStartRun, type LabDraft } from '../utils/lab';

// The test's task: what to reach, the texts it may type, where to start, how far it may go, as
// which agent, and with which backend.
export function LabForm({
  options,
  draft,
  onChange,
  onRun,
  running,
  canStandard,
}: {
  options: LabOptions;
  draft: LabDraft;
  onChange: (patch: Partial<LabDraft>) => void;
  onRun: () => void;
  running: boolean;
  canStandard: boolean;
}) {
  const t = useTranslations('browserLab.form');
  const [kind] = draft.backend.split(':');
  const ready = toStartRun(draft) !== null;
  const [advanced, setAdvanced] = useState(false);

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready && !running) onRun();
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="lab-goal">{t('goal')}</Label>
        <Textarea
          id="lab-goal"
          rows={3}
          value={draft.goal}
          placeholder={t('goalPlaceholder')}
          onChange={(e) => onChange({ goal: e.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="lab-values">{t('values')}</Label>
        <Textarea
          id="lab-values"
          rows={2}
          dir="ltr"
          className="font-mono text-xs"
          value={draft.values}
          placeholder={t('valuesPlaceholder')}
          onChange={(e) => onChange({ values: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">{t('valuesHint')}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>{t('backend')}</Label>
          <Select value={draft.backend} onValueChange={(backend) => onChange({ backend })}>
            <SelectTrigger className="w-full" aria-label={t('backend')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {canStandard && <SelectItem value="standard">{t('standard')}</SelectItem>}
              {options.connections.map((connection) => (
                <SelectItem key={`d${connection.id}`} value={`decision:${connection.id}`}>
                  {connectionLabel(connection)}
                </SelectItem>
              ))}
              {options.connections.map((connection) => (
                <SelectItem key={`j${connection.id}`} value={`jev-browser:${connection.id}`}>
                  {t('jevBrowser', { name: connection.label })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>{t('agent')}</Label>
          <Select
            value={draft.agentId === null ? undefined : String(draft.agentId)}
            onValueChange={(id) => onChange({ agentId: Number(id) })}
          >
            <SelectTrigger className="w-full" aria-label={t('agent')}>
              <SelectValue placeholder={t('noAgent')} />
            </SelectTrigger>
            <SelectContent>
              {options.agents.map((agent) => (
                <SelectItem key={agent.id} value={String(agent.id)}>
                  {agent.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {advanced || kind === 'jev-browser' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="lab-start">{t('startUrl')}</Label>
            <Input
              id="lab-start"
              dir="ltr"
              value={draft.startUrl}
              placeholder={kind === 'jev-browser' ? 'https://…' : t('startUrlPlaceholder')}
              onChange={(e) => onChange({ startUrl: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t('mode')}</Label>
            <Select
              value={draft.mode}
              onValueChange={(mode) => onChange({ mode: mode as 'act' | 'read' })}
            >
              <SelectTrigger className="w-full" aria-label={t('mode')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="act">{t('modeAct')}</SelectItem>
                <SelectItem value="read">{t('modeRead')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lab-steps">{t('maxSteps')}</Label>
            <Input
              id="lab-steps"
              type="number"
              min={1}
              max={60}
              value={draft.maxSteps}
              onChange={(e) => onChange({ maxSteps: e.target.value })}
            />
          </div>
          {kind === 'decision' && (
            <div className="space-y-1.5">
              <Label>{t('policy')}</Label>
              <Select
                value={draft.policy}
                onValueChange={(policy) => onChange({ policy: policy as BrowserControlPolicy })}
              >
                <SelectTrigger className="w-full" aria-label={t('policy')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">{t('policyAuto')}</SelectItem>
                  <SelectItem value="jev">{t('policyJev')}</SelectItem>
                  <SelectItem value="laya">{t('policyLaya')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      ) : (
        <button
          type="button"
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => setAdvanced(true)}
        >
          {t('more')}
        </button>
      )}
      {kind === 'jev-browser' && (
        <p className="text-xs text-muted-foreground">{t('jevBrowserNote')}</p>
      )}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={!ready || running}>
          {running ? <Loader2 className="animate-spin" /> : <Play />}
          {t('run')}
        </Button>
      </div>
    </form>
  );
}
