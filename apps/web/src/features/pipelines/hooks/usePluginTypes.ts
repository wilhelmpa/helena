'use client';

import { resolveText } from '@helena/sdk/web';
import { useLocale, useTranslations } from 'next-intl';
import type { PluginTypeInfo } from '@/lib/api/endpoints/engine';
import { isPluginTypeName } from '@/lib/api/endpoints/pipelines';
import { useEngineTypes } from '@/services/engine.service';

export interface PluginType {
  type: string;
  info: PluginTypeInfo;
}

// The step and trigger types plugins add to the engine, with their names in the reader's
// language, and one way to name any step or trigger type, Helena's own or a plugin's.
export function usePluginTypes() {
  const t = useTranslations('pipelines');
  const locale = useLocale();
  const types = useEngineTypes().data;
  const steps: PluginType[] = (types?.steps ?? []).flatMap((entry) =>
    entry.plugin && entry.builder ? [{ type: entry.type, info: entry.plugin }] : [],
  );
  // A trigger that fires on a schedule of its own is not run yet (no events).
  const triggers: PluginType[] = (types?.triggers ?? []).flatMap((entry) =>
    entry.plugin && entry.events.length > 0 ? [{ type: entry.type, info: entry.plugin }] : [],
  );
  const text = (value: PluginTypeInfo['label'] | null): string =>
    value ? resolveText(value, locale) : '';
  const stepInfo = (type: string) => steps.find((entry) => entry.type === type)?.info ?? null;
  const triggerInfo = (type: string) => triggers.find((entry) => entry.type === type)?.info ?? null;

  // A step type's name: Helena's from the translations, a plugin's from the plugin, or its
  // id while the plugin is not installed.
  const stepLabel = (type: string): string => {
    if (!isPluginTypeName(type)) return t(`kinds.${type}` as Parameters<typeof t>[0]);
    return text(stepInfo(type)?.label ?? null) || type;
  };
  const triggerLabel = (type: string): string => {
    if (!isPluginTypeName(type)) return t(`triggers.${type}` as Parameters<typeof t>[0]);
    return text(triggerInfo(type)?.label ?? null) || type;
  };

  return { steps, triggers, stepInfo, triggerInfo, text, stepLabel, triggerLabel };
}
