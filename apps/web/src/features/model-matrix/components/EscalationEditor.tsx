'use client';

import {
  PillButton,
  PopoverPick,
  Segmented,
  Stack,
  Switch,
  Text,
  type PickItem,
} from '@/design-system';
import {
  DEFAULT_ESCALATION_MODEL,
  escalationOff,
  escalationOn,
  readEscalation,
  writeEscalation,
  type EscalationTarget,
} from '../utils/escalation';
import type { MatrixLabels } from '../utils/labels';
import type { CatalogModel } from './ColumnCell';
import { EditorRow } from './EditorRow';

// The panel of an escalation cell: whether the work goes on to Codex or Claude, which model,
// and what triggers it.
export function EscalationEditor({
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
      <EditorRow label={t('escalation.enable')}>
        <Switch
          aria-label={t('escalation.enable')}
          checked={on}
          onCheckedChange={(checked) => onChange(writeEscalation(escalationOn(view, checked)))}
        />
      </EditorRow>
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
          <EditorRow label={t('escalation.model')}>
            <PopoverPick
              trigger={<PillButton>{labels.model(selected)}</PillButton>}
              inputPlaceholder={t('search')}
              search={modelItems.length > 7}
              align="end"
              items={modelItems}
            />
          </EditorRow>
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
          <EditorRow label={t('escalation.onResumeLimit')}>
            <Switch
              aria-label={t('escalation.onResumeLimit')}
              checked={view.onResumeLimit}
              onCheckedChange={(checked) => change({ onResumeLimit: checked })}
            />
          </EditorRow>
          <EditorRow label={t('escalation.onRequest')}>
            <Switch
              aria-label={t('escalation.onRequest')}
              checked={view.onRequest}
              onCheckedChange={(checked) => change({ onRequest: checked })}
            />
          </EditorRow>
        </>
      )}
    </div>
  );
}
