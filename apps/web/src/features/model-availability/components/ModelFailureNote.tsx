'use client';

import type { RunFailureRef } from '@/lib/api/endpoints/modelAvailability';
import { useModelFailureText } from '../hooks/useModelFailureText';

// The line a run, stage or chat answer shows for a failure the runtime explained, in the
// reader's language, with the error as it came as the tooltip. Nothing for any other
// failure: the view shows its error itself.
export default function ModelFailureNote({
  failure,
  error,
  provider,
  className = 'text-destructive',
}: {
  failure: RunFailureRef | null | undefined;
  error?: string | null;
  provider?: string | null;
  className?: string;
}) {
  const text = useModelFailureText()(failure, { provider });
  if (!text) return null;
  return (
    <p className={className} dir="auto" title={error ?? undefined}>
      {text}
    </p>
  );
}
