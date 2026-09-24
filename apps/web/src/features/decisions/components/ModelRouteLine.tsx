'use client';

import { Route } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ModelRoute } from '@/lib/api/endpoints/decisions';
import { percent } from '../utils/format';

const REASONS = [
  'cheaper_tier',
  'upgrade',
  'same_tier',
  'needs_context',
  'unsure',
  'no_candidates',
  'off',
  'timeout',
  'error',
  'no_backend',
] as const;

// Why the router kept or changed the model, in the reader's words.
export function useRouteReason() {
  const t = useTranslations('decisions.routeReasons');
  return (reason: string) =>
    (REASONS as readonly string[]).includes(reason)
      ? t(reason as (typeof REASONS)[number])
      : reason;
}

// What the model router did for a run or a chat answer (docs/helena-decisions/decisions.md §4):
// "Modellwahl: gpt-6-sol → gpt-6-luna · leichte Aufgabe (82 %)", or that the model stayed.
export function ModelRouteLine({ route, className }: { route: ModelRoute; className?: string }) {
  const t = useTranslations('decisions.routeLine');
  const reason = useRouteReason();
  return (
    <span className={className ?? 'inline-flex items-center gap-1 text-xs text-muted-foreground'}>
      <Route className="size-3.5 shrink-0" aria-hidden />
      <span>
        {route.routed
          ? t('routed', { from: route.fromModel, to: route.toModel })
          : t('stayed', { model: route.fromModel })}
        {' · '}
        {reason(route.reason)}
        {route.confidence !== null ? ` (${percent(route.confidence)})` : ''}
      </span>
    </span>
  );
}
