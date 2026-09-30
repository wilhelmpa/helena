'use client';

import { useState, type FormEvent } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Button, Dialog, Field, Inline, Notice, Stack, TextArea, TextField } from '@/design-system';
import { ApiError } from '@/lib/api/core/client';
import type { MatrixSchema } from '@/lib/api/endpoints/modelMatrix';
import type { MatrixLabels } from '../utils/labels';

export type SchemaDialogMode =
  | { kind: 'create' }
  | { kind: 'copy'; from: MatrixSchema }
  | { kind: 'edit'; schema: MatrixSchema };

// Ask for the name and the sentence of a schema: a new empty one, a copy of another, or the
// words of a custom one. What the server refuses is said under the fields; a change made by
// someone else in the meantime asks to reload.
export function SchemaDialog({
  mode,
  initialDescription = '',
  labels,
  onSubmit,
  onReload,
  onClose,
}: {
  mode: SchemaDialogMode;
  // What the sentence starts as: for a copy, the sentence of the schema it is a copy of.
  initialDescription?: string;
  labels: MatrixLabels;
  onSubmit: (input: { name: string; description: string }) => Promise<unknown>;
  onReload: () => void;
  onClose: () => void;
}) {
  const { t } = labels;
  const source = mode.kind === 'create' ? null : mode.kind === 'copy' ? mode.from : mode.schema;
  const [name, setName] = useState(
    mode.kind === 'copy'
      ? t('schemaEditor.dialog.copyName', { name: mode.from.name })
      : (source?.name ?? ''),
  );
  const [description, setDescription] = useState(initialDescription);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<'conflict' | 'error' | null>(null);
  const trimmed = name.trim();
  const ready = trimmed !== '' && trimmed.length <= 120;
  const title =
    mode.kind === 'create'
      ? t('schemaEditor.dialog.createTitle')
      : mode.kind === 'copy'
        ? t('schemaEditor.dialog.copyTitle', { name: mode.from.name })
        : t('schemaEditor.dialog.editTitle');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await onSubmit({ name: trimmed, description: description.trim() });
      onClose();
    } catch (error) {
      setBusy(false);
      setProblem(
        error instanceof ApiError && error.status === 409 && /revision changed/i.test(error.message)
          ? 'conflict'
          : 'error',
      );
    }
  }

  return (
    <Dialog title={title} onClose={busy ? () => {} : onClose}>
      <form onSubmit={submit}>
        <Stack gap={4}>
          {mode.kind === 'copy' && (
            <Notice>{t('schemaEditor.dialog.copyNote', { name: mode.from.name })}</Notice>
          )}
          {mode.kind === 'create' && <Notice>{t('schemaEditor.dialog.emptyNote')}</Notice>}
          <Field label={t('schemaEditor.dialog.name')}>
            <TextField
              value={name}
              maxLength={120}
              placeholder={t('schemaEditor.dialog.namePlaceholder')}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field
            label={t('schemaEditor.dialog.description')}
            hint={t('schemaEditor.dialog.descriptionHint')}
          >
            <TextArea
              rows={3}
              value={description}
              maxLength={2000}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
          {problem === 'conflict' && (
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
          {problem === 'error' && (
            <Notice tone="danger" title={t('schemaEditor.dialog.failed')}>
              {t('errors.rejected')}
            </Notice>
          )}
          <Inline gap={2} justify="end">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              {t('schemaEditor.dialog.cancel')}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={!ready || busy}
              icon={busy ? <LoaderCircle className="animate-spin" size={14} /> : undefined}
            >
              {mode.kind === 'edit'
                ? t('schemaEditor.dialog.save')
                : t('schemaEditor.dialog.create')}
            </Button>
          </Inline>
        </Stack>
      </form>
    </Dialog>
  );
}
