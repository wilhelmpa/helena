'use client';

import {
  Button,
  MatrixCell,
  MatrixCellButton,
  MatrixNote,
  PopoverPick,
  Text,
  type PickItem,
} from '@/design-system';
import type {
  CellSource,
  MatrixColumn,
  MatrixDecision,
  MatrixRuntime,
  MatrixValues,
} from '@/lib/api/endpoints/modelMatrix';
import {
  BROWSERS,
  DEVICES,
  REASONING,
  RUNTIMES,
  modelless,
  modelsOfRuntime,
} from '../utils/columns';
import type { MatrixLabels } from '../utils/labels';
import { DecisionEditor } from './DecisionEditor';
import { EscalationEditor } from './EscalationEditor';

export interface CatalogModel {
  id: string;
  name: string;
}

// What a cell may offer when the list is not the pickers' but the one the server checks a
// schema against: the runtimes it has models for, the models of the row's runtime and the
// thinking levels of its model (null: no explicit level).
export interface CellLimits {
  runtimes?: MatrixRuntime[];
  models?: CatalogModel[];
  reasoning?: (string | null)[];
}

// One cell of the agent matrix: the value as a button, the picker under it, and at the
// foot where the value comes from with the way back. The same cell serves a single agent
// and a selection of several (`bulk`): then the picker sets the value for all of them, and
// the role of a schema (`scope="schema"`): there the value is the schema's own, so only a
// change not yet applied is marked and can be taken back.
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
  scope = 'agent',
  limits,
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
  scope?: 'agent' | 'schema';
  limits?: CellLimits;
}) {
  const { t } = labels;
  const inSchema = scope === 'schema';
  const own = staged || (!inSchema && source === 'own');
  const mark = staged ? 'changed' : !inSchema && source === 'own' ? 'own' : null;
  const markLabel = staged
    ? t('mark.changed')
    : !inSchema && source === 'own'
      ? t('mark.own')
      : undefined;
  const heading = t(`columns.${column}`);
  const name = heading;
  const shown = bulk ? t('bulk.set', { column: heading }) : null;
  const footer = (
    <MatrixNote
      action={
        bulk || own ? (
          <Button size="small" variant="ghost" onClick={onReset}>
            {bulk ? t('bulk.reset') : inSchema ? t('discard') : t('reset')}
          </Button>
        ) : undefined
      }
    >
      {bulk
        ? t('bulk.note', { count: bulk.count })
        : inSchema
          ? staged
            ? t('note.staged')
            : t('note.inSchema')
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
    limits,
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
  limits?: CellLimits,
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
    return (limits?.runtimes ?? RUNTIMES).map((entry) =>
      item(entry, t(`runtime.${entry}`, { appName: labels.appName }), value === entry, entry),
    );
  if (column === 'reasoning')
    return (limits?.reasoning ?? REASONING).map((entry) =>
      item(entry ?? 'default', labels.reasoning(entry), value === entry, entry),
    );
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
  const available = limits?.models ?? modelsOfRuntime(runtime, models, []);
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
