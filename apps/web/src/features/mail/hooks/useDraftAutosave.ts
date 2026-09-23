import { useCallback, useEffect, useRef } from 'react';
import type { MailAddress } from '@/lib/api/endpoints/mail';
import { useSaveDraft } from '../services/drafts.service';

interface DraftValues {
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  subject: string;
  bodyText: string;
}

const DELAY_MS = 1000;

// Saves the draft a second after the last change, and on flush() (before sending or
// closing) and when the form goes away. Only what changed since the last save is sent.
export function useDraftAutosave(
  draftId: number,
  values: DraftValues,
  html: () => string,
  enabled: boolean,
) {
  const save = useSaveDraft(draftId);
  const serialized = JSON.stringify(values);
  const saved = useRef(serialized);
  const latest = useRef({ values, html, enabled, mutate: save.mutateAsync });
  latest.current = { values, html, enabled, mutate: save.mutateAsync };
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    const current = latest.current;
    const key = JSON.stringify(current.values);
    if (!current.enabled || key === saved.current) return;
    saved.current = key;
    await current.mutate({ ...current.values, bodyHtml: current.html() });
  }, []);

  useEffect(() => {
    if (serialized === saved.current) return;
    timer.current = setTimeout(() => void flush(), DELAY_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [serialized, flush]);

  useEffect(() => () => void flush(), [flush]);

  return { flush, saving: save.isPending };
}
