'use client';

import { useState } from 'react';
import { ChevronDown, FlaskConical, Loader2, Square } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { resolveText, type LocalizedText } from '@helena/sdk/web';
import SettingsCard from '@/components/common/page/SettingsCard';
import SettingsRow from '@/components/common/page/SettingsRow';
import SettingsSection from '@/components/common/page/SettingsSection';
import StatusBadge, { type Status } from '@/components/common/page/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type {
  DecisionClassPatch,
  DecisionClassView,
  DecisionConnectionOption,
  DecisionEval,
} from '@/lib/api/endpoints/decisions';
import {
  useCancelDecisionEval,
  useDecisionReason,
  useStartDecisionEval,
  useUpdateDecisionClass,
} from '@/services/decisions.service';
import { classKey, euros, milliseconds, percent } from '../utils/format';
import { MailTriageConfig } from './MailTriageConfig';
import { Table, Th, Tr, Td } from '@/design-system';

const NONE = 'none';

function useText() {
  const locale = useLocale();
  const t = useTranslations();
  return (value: LocalizedText | null | undefined) =>
    value ? resolveText(value, locale, (key) => t(key as never)) : '';
}

function connectionName(
  connection: DecisionConnectionOption,
  words: { local: string; cloud: string },
) {
  return `${connection.label} · ${connection.model} · ${connection.local ? words.local : words.cloud}`;
}

// A number field that saves on blur or Enter: a percentage (threshold) or milliseconds.
function NumberField({
  value,
  placeholder,
  min,
  max,
  suffix,
  label,
  onSave,
}: {
  value: number | null;
  placeholder: string;
  min: number;
  max: number;
  suffix: string;
  label: string;
  onSave: (value: number | null) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value === null ? '' : String(value));
  const commit = () => {
    if (draft === null) return;
    const trimmed = draft.trim();
    setDraft(null);
    if (trimmed === '') return onSave(null);
    const number = Number(trimmed.replace(',', '.'));
    if (Number.isFinite(number) && number >= min && number <= max) onSave(number);
  };
  return (
    <div className="flex items-center gap-2">
      <Input
        aria-label={label}
        inputMode="decimal"
        className="w-24 text-end"
        value={shown}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
        }}
      />
      <span className="text-xs text-muted-foreground">{suffix}</span>
    </div>
  );
}

function evalStatus(evaluation: DecisionEval | null): Status {
  if (!evaluation) return 'idle';
  if (evaluation.status === 'running') return 'running';
  if (evaluation.status !== 'done') return 'danger';
  return evaluation.passed ? 'success' : 'waiting';
}

function EvalSummary({ evaluation, teamId }: { evaluation: DecisionEval; teamId: number }) {
  const t = useTranslations('decisions.eval');
  const locale = useLocale();
  const cancel = useCancelDecisionEval(teamId);
  const [open, setOpen] = useState(false);
  const details = evaluation.details;
  if (evaluation.status === 'running') {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
        <StatusBadge status="running">{t('running')}</StatusBadge>
        <Button
          variant="ghost"
          size="sm"
          disabled={cancel.isPending}
          onClick={() => cancel.mutate(evaluation.id)}
        >
          <Square />
          {t('cancel')}
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-3 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <StatusBadge status={evalStatus(evaluation)}>
          {evaluation.status !== 'done'
            ? t('failedRun', { error: evaluation.error ?? '' })
            : evaluation.passed
              ? t('passed')
              : t('notPassed')}
        </StatusBadge>
        <span className="text-xs text-muted-foreground">
          {evaluation.backendLabel}
          {evaluation.model ? ` · ${evaluation.model}` : ''} ·{' '}
          {new Date(evaluation.createdAt).toLocaleString(locale)}
        </span>
      </div>
      {evaluation.status === 'done' && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">{t('precision')}</dt>
            <dd className="text-sm">
              {percent(evaluation.precision)}{' '}
              <span className="text-xs text-muted-foreground">
                ({t('needed', { value: percent(details.minPrecision) })})
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('coverage')}</dt>
            <dd className="text-sm">
              {percent(evaluation.coverage)}{' '}
              <span className="text-xs text-muted-foreground">
                ({t('needed', { value: percent(details.minCoverage) })})
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('accuracy')}</dt>
            <dd className="text-sm">{percent(evaluation.accuracy)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('latency')}</dt>
            <dd className="text-sm">
              {milliseconds(evaluation.latencyP50Ms)} / {milliseconds(evaluation.latencyP95Ms)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('questions')}</dt>
            <dd className="text-sm">
              {evaluation.answered} / {evaluation.questions}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('threshold')}</dt>
            <dd className="text-sm">{percent(evaluation.threshold)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('tokens')}</dt>
            <dd className="text-sm">{evaluation.inputTokens.toLocaleString(locale)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('cost')}</dt>
            <dd className="text-sm">{euros(evaluation.costEur, locale)}</dd>
          </div>
        </dl>
      )}
      {evaluation.status === 'done' && (
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <ChevronDown className={open ? 'size-3.5 rotate-180' : 'size-3.5'} />
          {t('details')}
        </button>
      )}
      {open && (
        <div className="grid gap-4 md:grid-cols-2">
          <Table stack={false}>
            <caption className="pb-1 text-start text-muted-foreground">{t('byQuestion')}</caption>
            <thead>
              <Tr>
                <Th>{t('question')}</Th>
                <Th alignment="end">{t('accuracy')}</Th>
                <Th alignment="end">{t('answeredShort')}</Th>
                <Th alignment="end">{t('precision')}</Th>
              </Tr>
            </thead>
            <tbody>
              {Object.entries(details.byQuestion ?? {}).map(([question, score]) => (
                <Tr key={question}>
                  <Td>{question}</Td>
                  <Td alignment="end">{percent(score.correct / score.questions)}</Td>
                  <Td alignment="end">
                    {score.answered}/{score.questions}
                  </Td>
                  <Td alignment="end">
                    {percent(score.answered ? score.correctAnswered / score.answered : null)}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <Table stack={false}>
            <caption className="pb-1 text-start text-muted-foreground">{t('sweep')}</caption>
            <thead>
              <Tr>
                <Th>{t('threshold')}</Th>
                <Th alignment="end">{t('precision')}</Th>
                <Th alignment="end">{t('coverage')}</Th>
              </Tr>
            </thead>
            <tbody>
              {(details.sweep ?? []).map((point) => (
                <Tr key={point.threshold}>
                  <Td>{percent(point.threshold)}</Td>
                  <Td alignment="end">{percent(point.precision)}</Td>
                  <Td alignment="end">{percent(point.coverage)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </div>
  );
}

// One decision class (Einstellungen → Entscheidungen): its connection, fallback, threshold,
// failsafe, input storage, its own options, the eval that gates switching it on, and the last
// seven days in numbers.
export function DecisionClassCard({
  teamId,
  cls,
  connections,
}: {
  teamId: number;
  cls: DecisionClassView;
  connections: DecisionConnectionOption[];
}) {
  const t = useTranslations('decisions.class');
  const tc = useTranslations('decisions');
  const where = { local: tc('local'), cloud: tc('cloud') };
  const text = useText();
  const locale = useLocale();
  const reason = useDecisionReason();
  const update = useUpdateDecisionClass(teamId);
  const startEval = useStartDecisionEval(teamId);
  const save = (patch: DecisionClassPatch) => update.mutate({ classId: cls.id, patch });
  const setting = cls.setting;
  const usable = connections.filter(
    (connection) =>
      connection.projectKey === null && (cls.input.cloud === 'allowed' || connection.local),
  );
  const running = cls.latestEval?.status === 'running';
  const key = classKey(cls.id);

  return (
    <SettingsSection
      title={text(cls.label)}
      description={text(cls.description)}
      action={
        <StatusBadge status={setting.enabled ? 'success' : 'idle'}>
          {setting.enabled ? t('on') : t('off')}
        </StatusBadge>
      }
    >
      <SettingsCard className="divide-y divide-border/60">
        <SettingsRow
          title={t('connection')}
          description={cls.input.cloud === 'never' ? t('connectionLocalOnly') : t('connectionHint')}
          control={
            <Select
              value={setting.credentialId === null ? NONE : String(setting.credentialId)}
              onValueChange={(value) =>
                save({ credentialId: value === NONE ? null : Number(value) })
              }
            >
              <SelectTrigger className="w-40 shrink-0 sm:w-72" aria-label={t('connection')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t('noConnection')}</SelectItem>
                {usable.map((connection) => (
                  <SelectItem key={connection.id} value={String(connection.id)}>
                    {connectionName(connection, where)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        <SettingsRow
          title={t('fallback')}
          description={t('fallbackHint')}
          control={
            <Select
              value={
                setting.fallbackCredentialId === null ? NONE : String(setting.fallbackCredentialId)
              }
              onValueChange={(value) =>
                save({ fallbackCredentialId: value === NONE ? null : Number(value) })
              }
            >
              <SelectTrigger className="w-40 shrink-0 sm:w-72" aria-label={t('fallback')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t('noFallback')}</SelectItem>
                {usable
                  .filter((connection) => connection.id !== setting.credentialId)
                  .map((connection) => (
                    <SelectItem key={connection.id} value={String(connection.id)}>
                      {connectionName(connection, where)}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          }
        />
        <SettingsRow
          title={t('threshold')}
          description={t('thresholdHint', { value: percent(cls.defaults.threshold) })}
          control={
            <NumberField
              label={t('threshold')}
              value={
                setting.thresholdCustom === null ? null : Math.round(setting.thresholdCustom * 100)
              }
              placeholder={String(Math.round(cls.defaults.threshold * 100))}
              min={0}
              max={100}
              suffix="%"
              onSave={(value) => save({ threshold: value === null ? null : value / 100 })}
            />
          }
        />
        <SettingsRow
          title={t('timeout')}
          description={t('timeoutHint', { value: milliseconds(cls.defaults.timeoutMs) })}
          control={
            <NumberField
              label={t('timeout')}
              value={setting.timeoutCustom}
              placeholder={String(cls.defaults.timeoutMs)}
              min={200}
              max={30000}
              suffix="ms"
              onSave={(value) => save({ timeoutMs: value === null ? null : Math.round(value) })}
            />
          }
        />
        <SettingsRow
          title={t('storeInput')}
          description={cls.input.store === 'never' ? t('storeInputNever') : t('storeInputHint')}
          control={
            <Switch
              checked={setting.storeInput}
              disabled={cls.input.store === 'never'}
              onCheckedChange={(storeInput) => save({ storeInput })}
            />
          }
        />
        {key === 'router' && (
          <SettingsRow
            title={t('contextThreshold')}
            description={t('contextThresholdHint')}
            control={
              <NumberField
                label={t('contextThreshold')}
                value={
                  typeof setting.config.contextThreshold === 'number'
                    ? Math.round(setting.config.contextThreshold * 100)
                    : null
                }
                placeholder="50"
                min={1}
                max={100}
                suffix="%"
                onSave={(value) =>
                  save({
                    config:
                      value === null ? {} : { ...setting.config, contextThreshold: value / 100 },
                  })
                }
              />
            }
          />
        )}
      </SettingsCard>

      {key === 'mail' && (
        <MailTriageConfig
          teamId={teamId}
          config={setting.config}
          onSave={(config) => save({ config })}
        />
      )}

      <SettingsCard className="divide-y divide-border/60">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="space-y-0.5">
            <div className="text-sm font-medium">{t('evalTitle')}</div>
            <p className="text-xs text-muted-foreground">
              {cls.eval
                ? t('evalHint', {
                    cases: cls.eval.cases,
                    precision: percent(cls.eval.minPrecision),
                    coverage: percent(cls.eval.minCoverage),
                  })
                : t('noEval')}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={!cls.eval || setting.credentialId === null || running || startEval.isPending}
            onClick={() =>
              startEval.mutate({ classId: cls.id, credentialId: setting.credentialId })
            }
          >
            {running || startEval.isPending ? (
              <Loader2 className="animate-spin" />
            ) : (
              <FlaskConical />
            )}
            {t('runEval')}
          </Button>
        </div>
        {cls.latestEval && <EvalSummary evaluation={cls.latestEval} teamId={teamId} />}
        <SettingsRow
          title={t('enabled')}
          description={t('enabledHint')}
          note={!setting.enabled && !cls.canEnable.ok ? reason(cls.canEnable.reason) : undefined}
          control={
            <Switch
              checked={setting.enabled}
              disabled={!setting.enabled && !cls.canEnable.ok}
              onCheckedChange={(enabled) => save({ enabled })}
            />
          }
        />
      </SettingsCard>

      <p className="text-xs text-muted-foreground">
        {t('stats', {
          total: cls.stats.total,
          decided: cls.stats.decided,
          unsure: cls.stats.unsure,
          failed: cls.stats.failed,
          wrong: cls.stats.wrong,
          corrected: cls.stats.corrected,
          latency: milliseconds(cls.stats.latencyP50Ms),
          cost: euros(cls.stats.costEur, locale),
        })}
      </p>
    </SettingsSection>
  );
}
