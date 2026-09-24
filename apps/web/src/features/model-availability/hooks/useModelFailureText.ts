'use client';

import { useTranslations } from 'next-intl';
import type { RunFailureRef } from '@/lib/api/endpoints/modelAvailability';
import { accountOf, knownFailure } from '../utils/modelFailure';

// A failure the runtime explained, in the reader's language: "Modell gpt-6-terra ist für dein
// ChatGPT-Konto nicht verfügbar – wähle für den Agenten ein anderes Modell." Null for a
// failure Helena does not word itself; the view then shows the error as it came.
export function useModelFailureText() {
  const t = useTranslations('modelAvailability');
  return (
    failure: RunFailureRef | null | undefined,
    where: { provider?: string | null; runtime?: string | null } = {},
  ): string | null => {
    const known = knownFailure(failure);
    if (!known) return null;
    if (known === 'providerRejected') return t('failure.providerRejected');
    return t('failure.modelUnavailable', {
      model: failure?.model ?? '?',
      account: accountOf(where.provider, where.runtime, failure?.model),
    });
  };
}
