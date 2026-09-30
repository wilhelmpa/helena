'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useDisplayName } from '@/context/displayName';
import type {
  MatrixColumn,
  MatrixCellValue,
  MatrixDecision,
  MatrixValues,
} from '@/lib/api/endpoints/modelMatrix';
import { escalationOff, escalationTriggers, readEscalation } from './escalation';
import { modelLabel } from './modelLabels';

// The words of the matrix: every value a cell can hold, said the way people say it.
export function useMatrixLabels(names?: ReadonlyMap<string, string>) {
  const t = useTranslations('localAi.modelMatrix');
  const appName = useDisplayName();
  return useMemo(() => {
    const model = (id: string) =>
      modelLabel(id, { localDefault: t('model.localDefault'), local: t('model.local') }, names);
    const decision = (value: MatrixDecision) =>
      `${t(`decision.backends.${value.backend}`)} · ${t('decision.from', {
        percent: Math.round(value.threshold * 100),
      })}`;
    const escalation = (raw: unknown) => {
      const view = readEscalation(raw);
      if (escalationOff(view)) return t('escalation.off');
      const target = view.toAgent
        ? t('escalation.toAgent')
        : t('escalation.to', { target: t(`escalation.targets.${view.target ?? 'codex'}`) });
      const triggers = escalationTriggers(view).map((trigger) =>
        trigger === 'failures'
          ? t('escalation.triggers.failures', { count: view.afterFailures })
          : t(`escalation.triggers.${trigger}`),
      );
      return [target, ...triggers].join(' · ');
    };
    const value = (column: MatrixColumn, raw: unknown): string => {
      switch (column) {
        case 'runtime':
          return t(`runtime.${raw as MatrixValues['runtime']}`, { appName });
        case 'model':
          return model(raw as string);
        case 'reasoning':
          return t(`reasoning.${raw as MatrixValues['reasoning']}`);
        case 'escalation':
          return escalation(raw);
        case 'browser':
          return t(`browser.${raw as MatrixValues['browser']}`);
        case 'decision':
          return decision(raw as MatrixDecision);
        case 'device':
          return t(`device.${raw as MatrixValues['device']}`);
      }
      return '';
    };
    const cell = (column: MatrixColumn, entry: MatrixCellValue) => value(column, entry.value);
    return { t, model, decision, escalation, value, cell, appName };
  }, [t, names, appName]);
}
export type MatrixLabels = ReturnType<typeof useMatrixLabels>;
