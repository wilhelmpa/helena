'use client';

import type { ReactNode } from 'react';
import {
  Button,
  Inline,
  MatrixCell,
  MatrixCellButton,
  MatrixNote,
  PillButton,
  PopoverPick,
  Segmented,
  Stack,
  Switch,
  Text,
  type PickItem,
} from '@/design-system';
import type {
  CellSource,
  MatrixColumn,
  MatrixDecision,
  MatrixDecisionBackend,
  MatrixRuntime,
  MatrixValues,
} from '@/lib/api/endpoints/modelMatrix';
import {
  BROWSERS,
  DECISION_BACKENDS,
  DEVICES,
  REASONING,
  RUNTIMES,
  modelless,
  modelsOfRuntime,
} from '../utils/columns';
import {
  DEFAULT_ESCALATION_MODEL,
  escalationOff,
  escalationOn,
  readEscalation,
  writeEscalation,
  type EscalationTarget,
} from '../utils/escalation';
import type { MatrixLabels } from '../utils/labels';

export interface CatalogModel {
  id: string;
  name: string;
}

// One cell of the agent matrix: the value as a button, the picker under it, and at the
// foot where the value comes from with the way back. The same cell serves a single agent
// and a selection of several (`bulk`): then the picker sets the value for all of them.
export function ColumnCell({
  column,
  value,
  source,
  staged,
  runtime,
  origin,
  bulk,
  models,
  labels,
  onChange,
  onReset,
  disabled = false,
}: {
  column: MatrixColumn;
  value: MatrixValues[MatrixColumn];
  source: CellSource;
  // Set in the matrix and not applied yet.
  staged: boolean;
  // The runtime the row has (or is about to have): the model list follows it.
  runtime: MatrixRuntime | null;
  // "Schema „Gemischt“" or "Projekt-Schema …": what the value follows when it is not own.
  origin: string;
  // A change for a selection: how many agents it reaches, and whether they differ in this column.
  bulk?: { count: number; mixed: boolean };
  models: CatalogModel[];
  labels: MatrixLabels;
  onChange: (value: MatrixValues[MatrixColumn]) => void;
  onReset: () => void;
  disabled?: boolean;
}) {
  const { t } = labels;
  const own = staged || source === 'own';
  const mark = staged ? 'changed' : source === 'own' ? 'own' : null;
  const markLabel = staged ? t('mark.changed') : source === 'own' ? t('mark.own') : undefined;
  const heading = t(`columns.${column}`);
  const name = heading;
  const shown = bulk ? t('bulk.set', { column: heading }) : null;
  const footer = (
    <MatrixNote
      action={
        bulk || own ? (
          <Button size="small" variant="ghost" onClick={onReset}>
            {bulk ? t('bulk.reset') : t('reset')}
          </Button>
        ) : undefined
      }
    >
      {bulk
        ? t('bulk.note', { count: bulk.count })
        : own
          ? staged
            ? t('note.staged')
            : t('note.own')
          : source === 'project'
            ? t('note.project', { schema: origin })
            : t('note.schema', { schema: origin })}
    </MatrixNote>
  );

  if (column === 'escalation')
    return (
      <MatrixCell
        aria-label={shown ?? `${name}: ${labels.value(column, value)}`}
        label={shown ?? labels.parts(column, value).label}
        detail={shown ? undefined : labels.parts(column, value).detail}
        mark={bulk ? null : mark}
        markLabel={markLabel}
        disabled={disabled}
      >
        <EscalationEditor
          value={value}
          models={models}
          labels={labels}
          onChange={(next) => onChange(next as MatrixValues[MatrixColumn])}
        />
        {footer}
      </MatrixCell>
    );
  if (column === 'decision')
    return (
      <MatrixCell
        aria-label={shown ?? `${name}: ${labels.value(column, value)}`}
        label={shown ?? labels.parts(column, value).label}
        detail={shown ? undefined : labels.parts(column, value).detail}
        mark={bulk ? null : mark}
        markLabel={markLabel}
        disabled={disabled}
      >
        <DecisionEditor
          value={value as MatrixDecision}
          labels={labels}
          onChange={(next) => onChange(next)}
        />
        {footer}
      </MatrixCell>
    );

  const items = pickItems(
    column,
    bulk?.mixed ? undefined : value,
    runtime,
    models,
    labels,
    onChange,
  );
  if (column === 'model' && runtime !== null && modelless(runtime) && !bulk)
    return (
      <MatrixCellButton
        label={<Text tone="faint">{t('model.none')}</Text>}
        chevron={false}
        disabled
        aria-label={`${name}: ${t('model.none')}`}
      />
    );
  return (
    <PopoverPick
      trigger={
        <MatrixCellButton
          aria-label={shown ?? `${name}: ${labels.value(column, value)}`}
          label={shown ?? labels.value(column, value)}
          mark={bulk ? null : mark}
          markLabel={markLabel}
          disabled={disabled}
        />
      }
      inputPlaceholder={t('search')}
      emptyText={t('noResults')}
      search={column === 'model'}
      width="wide"
      items={items}
      footer={footer}
    />
  );
}

function pickItems(
  column: MatrixColumn,
  value: MatrixValues[MatrixColumn] | undefined,
  runtime: MatrixRuntime | null,
  models: CatalogModel[],
  labels: MatrixLabels,
  onChange: (value: MatrixValues[MatrixColumn]) => void,
): PickItem[] {
  const item = (
    key: string,
    label: string,
    selected: boolean,
    next: unknown,
    extra?: Partial<PickItem>,
  ) => ({
    key,
    search: label,
    icon: null,
    label,
    selected,
    onSelect: () => onChange(next as MatrixValues[MatrixColumn]),
    ...extra,
  });
  const { t } = labels;
  if (column === 'runtime')
    return RUNTIMES.map((entry) => item(entry, t(`runtime.${entry}`), value === entry, entry));
  if (column === 'reasoning')
    return REASONING.map((entry) => item(entry, t(`reasoning.${entry}`), value === entry, entry));
  if (column === 'browser')
    return BROWSERS.map((entry) =>
      item(entry, t(`browser.${entry}`), value === entry, entry, {
        trailing: (
          <Text tone="faint">{t(`browserHint.${entry}`, { appName: labels.appName })}</Text>
        ),
      }),
    );
  if (column === 'device')
    return DEVICES.map((entry) =>
      item(entry, t(`device.${entry}`), value === entry, entry, {
        disabled: entry === 'npu',
        tooltip: entry === 'npu' ? t('device.npuNote') : undefined,
      }),
    );
  // model
  const available = modelsOfRuntime(runtime, models, []);
  const ids = new Set(available.map((entry) => entry.id));
  const list = [
    ...((runtime === 'helena' || runtime === null) && !ids.has('volition-local-default')
      ? [{ id: 'volition-local-default', name: '' }]
      : []),
    ...available,
    ...(typeof value === 'string' && !ids.has(value) && value !== 'volition-local-default'
      ? [{ id: value, name: '' }]
      : []),
  ];
  return list.map((entry) => item(entry.id, labels.model(entry.id), value === entry.id, entry.id));
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Inline justify="between" gap={3}>
      <Text tone="muted">{label}</Text>
      {children}
    </Inline>
  );
}

function EscalationEditor({
  value,
  models,
  labels,
  onChange,
}: {
  value: unknown;
  models: CatalogModel[];
  labels: MatrixLabels;
  onChange: (value: unknown) => void;
}) {
  const { t } = labels;
  const view = readEscalation(value);
  const on = !escalationOff(view);
  const change = (patch: Partial<typeof view>) => onChange(writeEscalation({ ...view, ...patch }));
  const target: EscalationTarget = view.target ?? 'codex';
  const targetModels = models.filter((entry) =>
    (target === 'codex' ? /^gpt-/ : /^claude-/).test(entry.id),
  );
  const ids = new Set(targetModels.map((entry) => entry.id));
  const selected = view.model ?? DEFAULT_ESCALATION_MODEL[target];
  const modelItems: PickItem[] = [
    ...targetModels.map((entry) => entry.id),
    ...(ids.has(selected) ? [] : [selected]),
  ].map((id) => ({
    key: id,
    search: labels.model(id),
    icon: null,
    label: labels.model(id),
    selected: id === selected,
    onSelect: () => change({ model: id }),
  }));
  return (
    <div className="ds-matrix-panel-body">
      <Row label={t('escalation.enable')}>
        <Switch
          aria-label={t('escalation.enable')}
          checked={on}
          onCheckedChange={(checked) => onChange(writeEscalation(escalationOn(view, checked)))}
        />
      </Row>
      {view.toAgent && <Text tone="faint">{t('escalation.toAgentNote')}</Text>}
      {on && !view.toAgent && (
        <>
          <Stack gap={1}>
            <Text tone="muted">{t('escalation.target')}</Text>
            <Segmented
              label={t('escalation.target')}
              value={target}
              options={[
                { value: 'codex' as const, label: t('escalation.targets.codex') },
                { value: 'claude' as const, label: t('escalation.targets.claude') },
              ]}
              onChange={(next) => change({ target: next, model: DEFAULT_ESCALATION_MODEL[next] })}
            />
          </Stack>
          <Row label={t('escalation.model')}>
            <PopoverPick
              trigger={<PillButton>{labels.model(selected)}</PillButton>}
              inputPlaceholder={t('search')}
              search={modelItems.length > 7}
              align="end"
              items={modelItems}
            />
          </Row>
          <Stack gap={1}>
            <Text tone="muted">{t('escalation.afterFailures')}</Text>
            <Segmented
              label={t('escalation.afterFailures')}
              value={String(view.afterFailures)}
              options={['0', '1', '2', '3', '4', '5'].map((count) => ({
                value: count,
                label: count === '0' ? t('escalation.never') : count,
              }))}
              onChange={(next) => change({ afterFailures: Number(next) })}
            />
          </Stack>
          <Row label={t('escalation.onResumeLimit')}>
            <Switch
              aria-label={t('escalation.onResumeLimit')}
              checked={view.onResumeLimit}
              onCheckedChange={(checked) => change({ onResumeLimit: checked })}
            />
          </Row>
          <Row label={t('escalation.onRequest')}>
            <Switch
              aria-label={t('escalation.onRequest')}
              checked={view.onRequest}
              onCheckedChange={(checked) => change({ onRequest: checked })}
            />
          </Row>
        </>
      )}
    </div>
  );
}

const THRESHOLDS = [0.6, 0.7, 0.8, 0.85, 0.9, 0.95];

function DecisionEditor({
  value,
  labels,
  onChange,
}: {
  value: MatrixDecision;
  labels: MatrixLabels;
  onChange: (value: MatrixDecision) => void;
}) {
  const { t } = labels;
  const thresholds = THRESHOLDS.includes(value.threshold)
    ? THRESHOLDS
    : [...THRESHOLDS, value.threshold].sort((a, b) => a - b);
  const backendItems: PickItem[] = DECISION_BACKENDS.map((backend: MatrixDecisionBackend) => ({
    key: backend,
    search: t(`decision.backends.${backend}`),
    icon: null,
    label: t(`decision.backends.${backend}`),
    selected: value.backend === backend,
    disabled: backend === 'npu',
    tooltip: backend === 'npu' ? t('decision.npuNote') : undefined,
    onSelect: () => onChange({ ...value, backend }),
  }));
  return (
    <div className="ds-matrix-panel-body">
      <Row label={t('decision.backend')}>
        <PopoverPick
          trigger={<PillButton>{t(`decision.backends.${value.backend}`)}</PillButton>}
          inputPlaceholder={t('search')}
          search={false}
          align="end"
          width="wide"
          items={backendItems}
        />
      </Row>
      <Stack gap={1}>
        <Text tone="muted">{t('decision.threshold')}</Text>
        <Segmented
          label={t('decision.threshold')}
          value={String(value.threshold)}
          options={thresholds.map((threshold) => ({
            value: String(threshold),
            label: `${Math.round(threshold * 100)}`,
          }))}
          onChange={(next) => onChange({ ...value, threshold: Number(next) })}
        />
        <Text size="xs" tone="faint">
          {t('decision.thresholdHint')}
        </Text>
      </Stack>
      <Stack gap={1}>
        <Text tone="muted">{t('decision.fallback')}</Text>
        <Segmented
          label={t('decision.fallback')}
          value={value.fallback}
          options={(['gpu', 'coordinator', 'none'] as const).map((fallback) => ({
            value: fallback,
            label: t(`decision.fallbacks.${fallback}`),
          }))}
          onChange={(next) => onChange({ ...value, fallback: next })}
        />
      </Stack>
      <Row label={t('decision.privateData')}>
        <Switch
          aria-label={t('decision.privateData')}
          checked={value.privateData}
          onCheckedChange={(checked) => onChange({ ...value, privateData: checked })}
        />
      </Row>
    </div>
  );
}
