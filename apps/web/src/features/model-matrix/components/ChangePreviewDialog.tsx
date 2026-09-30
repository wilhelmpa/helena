'use client';

import { LoaderCircle } from 'lucide-react';
import { Button, Dialog, Inline, Notice, Stack, Text } from '@/design-system';
import type { MatrixColumn, MatrixPreview } from '@/lib/api/endpoints/modelMatrix';
import type { MatrixLabels } from '../utils/labels';

export type PreviewState =
  | { status: 'loading' }
  | { status: 'ready'; previews: MatrixPreview[] }
  | { status: 'conflict' }
  | { status: 'error'; message: string };

// What a set of changes would do, before it is written: how many agents it reaches and, per
// agent, each value before and after — with where it comes from. Nothing is applied until
// "Anwenden"; a change made by someone else in the meantime is said in plain words.
export function ChangePreviewDialog({
  state,
  title,
  note,
  labels,
  names,
  applying,
  onApply,
  onReload,
  onClose,
}: {
  state: PreviewState;
  title: string;
  // What the change does in general (an undo: which steps it takes back).
  note?: string;
  labels: MatrixLabels;
  names: ReadonlyMap<number, string>;
  applying: boolean;
  onApply: () => void;
  onReload: () => void;
  onClose: () => void;
}) {
  const { t } = labels;
  const merged = new Map<
    number,
    { name: string; role: string; changes: MatrixPreview['changes'][number]['changes'] }
  >();
  if (state.status === 'ready')
    for (const preview of state.previews)
      for (const entry of preview.changes) {
        if (!entry.changes.length) continue;
        const known = merged.get(entry.agentId);
        merged.set(entry.agentId, {
          name: names.get(entry.agentId) ?? entry.username,
          role: entry.role,
          changes: [...(known?.changes ?? []), ...entry.changes],
        });
      }
  const source = (value: string) => t(`preview.source.${value}` as never);
  return (
    <Dialog title={title} onClose={onClose} wide>
      <Stack gap={4}>
        {note && <Text tone="muted">{note}</Text>}
        {state.status === 'loading' && (
          <Inline gap={2}>
            <LoaderCircle className="animate-spin" size={16} />
            <Text tone="muted">{t('preview.loading')}</Text>
          </Inline>
        )}
        {state.status === 'conflict' && (
          <Notice
            tone="warning"
            title={t('conflict.title')}
            action={
              <Button size="small" onClick={onReload}>
                {t('conflict.reload')}
              </Button>
            }
          >
            {t('conflict.text')}
          </Notice>
        )}
        {state.status === 'error' && (
          <Notice tone="danger" title={t('preview.failed')}>
            {friendlyError(state.message, t)}
          </Notice>
        )}
        {state.status === 'ready' && (
          <>
            <Text weight="medium">{t('preview.affects', { count: merged.size })}</Text>
            {merged.size === 0 ? (
              <Text tone="muted">{t('preview.nobody')}</Text>
            ) : (
              <div className="ds-matrix-preview">
                {[...merged.entries()].map(([id, entry]) => (
                  <div key={id} className="ds-matrix-preview-agent">
                    <Inline gap={2} justify="between">
                      <Text weight="medium">{entry.name}</Text>
                      <Text size="xs" tone="faint">
                        {t(`roles.${entry.role}` as never)}
                      </Text>
                    </Inline>
                    <ul>
                      {entry.changes.map((change, index) => (
                        <li key={`${change.column}-${index}`}>
                          <Text tone="muted">{t(`columns.${change.column as MatrixColumn}`)}</Text>
                          <span>
                            {labels.cell(change.column, change.before)}
                            <Text tone="faint"> ({source(change.before.source)})</Text>
                            {' → '}
                            <Text weight="medium">{labels.cell(change.column, change.after)}</Text>
                            <Text tone="faint"> ({source(change.after.source)})</Text>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        <Inline gap={2} justify="end">
          <Button variant="ghost" onClick={onClose}>
            {t('preview.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={state.status !== 'ready' || applying}
            icon={applying ? <LoaderCircle className="animate-spin" size={14} /> : undefined}
            onClick={onApply}
          >
            {t('preview.apply')}
          </Button>
        </Inline>
      </Stack>
    </Dialog>
  );
}

// The server answers in English; the reasons a change is refused that a person can act on
// are said in plain words, the rest as a general sentence.
function friendlyError(message: string, t: MatrixLabels['t']): string {
  if (/npu class .* needs a passed eval/i.test(message)) return t('errors.npuClass');
  if (/npu decision eval/i.test(message)) return t('errors.npuDecision');
  if (/unknown agent|unknown project|unknown schema/i.test(message)) return t('errors.unknown');
  if (/^invalid /i.test(message)) return t('errors.invalid');
  return t('errors.rejected');
}
