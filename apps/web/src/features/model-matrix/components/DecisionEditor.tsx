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
import type { MatrixDecision, MatrixDecisionBackend } from '@/lib/api/endpoints/modelMatrix';
import { DECISION_BACKENDS } from '../utils/columns';
import type { MatrixLabels } from '../utils/labels';
import { EditorRow } from './EditorRow';

// The panel of a decider cell: the backend, from which certainty it decides, what happens
// below that and whether private content is involved.
const THRESHOLDS = [0.6, 0.7, 0.8, 0.85, 0.9, 0.95];

export function DecisionEditor({
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
      <EditorRow label={t('decision.backend')}>
        <PopoverPick
          trigger={<PillButton>{t(`decision.backends.${value.backend}`)}</PillButton>}
          inputPlaceholder={t('search')}
          search={false}
          align="end"
          width="wide"
          items={backendItems}
        />
      </EditorRow>
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
      <EditorRow label={t('decision.privateData')}>
        <Switch
          aria-label={t('decision.privateData')}
          checked={value.privateData}
          onCheckedChange={(checked) => onChange({ ...value, privateData: checked })}
        />
      </EditorRow>
    </div>
  );
}
