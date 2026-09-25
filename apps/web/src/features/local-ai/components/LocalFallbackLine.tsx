'use client';

import { Cpu } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { LocalFallback } from '@/lib/api/endpoints/agentRuntimeSync';
import { shortModel } from '../utils/localAi';

// A run or chat answer asked for a local model and the configured one answered: local AI was
// off, its server did not answer when it started, or it failed during the answer and Hermes
// moved to the fallback (docs/helena-decisions/local-ai-platform.md §6.3). `model` is the one
// that answered; null for the runtime's default.
export function LocalFallbackLine({
  fallback,
  model,
  className,
}: {
  fallback: LocalFallback;
  model: string | null | undefined;
  className?: string;
}) {
  const t = useTranslations('localAi.fallback');
  return (
    <span className={className ?? 'inline-flex items-center gap-1 text-xs text-muted-foreground'}>
      <Cpu className="size-3.5 shrink-0" aria-hidden />
      <span>
        {t('line', { to: model || t('defaultModel'), from: shortModel(fallback.from) })}
        {' · '}
        {t(`reasons.${fallback.reason}`)}
      </span>
    </span>
  );
}
