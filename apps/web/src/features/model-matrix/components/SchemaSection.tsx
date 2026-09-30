'use client';

import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import { Button, Grid, Section } from '@/design-system';
import type {
  MatrixColumn,
  MatrixSchema,
  MatrixValues,
  ModelMatrix,
  SchemaCatalogModel,
} from '@/lib/api/endpoints/modelMatrix';
import { useCreateSchema, useDeleteSchema, useUpdateSchema } from '../services/modelMatrix.service';
import { BUILT_IN_SCHEMAS } from '../utils/columns';
import type { MatrixLabels } from '../utils/labels';
import {
  clearSchemaCell,
  discardSchema,
  discardSchemaRole,
  pruneSchemaRole,
  schemaRoleValues,
  setSchemaCells,
  type Pending,
} from '../utils/pending';
import { changeRoleCell, schemaIdFor, schemaUse } from '../utils/schemaEdit';
import { SchemaCard } from './SchemaCard';
import { SchemaDialog, type SchemaDialogMode } from './SchemaDialog';
import { SchemaRoles } from './SchemaRoles';

// The schemas: a card each with what can be done to it, and under them the roles of the one
// that is shown. Creating, copying, renaming and deleting are written at once; the values of a
// role wait in `pending` with every other change until the preview.
export function SchemaSection({
  matrix,
  pending,
  setPending,
  catalog,
  catalogFailed,
  labels,
  projectName,
  onActivate,
  onReload,
}: {
  matrix: ModelMatrix;
  pending: Pending;
  setPending: Dispatch<SetStateAction<Pending>>;
  catalog: SchemaCatalogModel[];
  catalogFailed: boolean;
  labels: MatrixLabels;
  projectName: (projectId: number) => string;
  onActivate: (schemaId: string) => void;
  onReload: () => void;
}) {
  const { t } = labels;
  const [viewed, setViewed] = useState<string | null>(null);
  const [dialog, setDialog] = useState<SchemaDialogMode | null>(null);
  const [removing, setRemoving] = useState<MatrixSchema | null>(null);
  const create = useCreateSchema();
  const update = useUpdateSchema();
  const remove = useDeleteSchema();

  const schemas = useMemo(
    () =>
      Object.values(matrix.schemas).sort((a, b) => {
        const ia = BUILT_IN_SCHEMAS.indexOf(a.id);
        const ib = BUILT_IN_SCHEMAS.indexOf(b.id);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.name.localeCompare(b.name);
      }),
    [matrix.schemas],
  );
  const shownId = viewed && matrix.schemas[viewed] ? viewed : matrix.active;
  const shown = matrix.schemas[shownId];

  const stageCell = (role: string, column: MatrixColumn, value: MatrixValues[MatrixColumn]) =>
    setPending((current) => {
      const entry = schemaRoleValues(matrix, current, shownId, role);
      if (!entry) return current;
      const changes = changeRoleCell(entry.values, column, value, catalog);
      return pruneSchemaRole(
        setSchemaCells(current, shownId, role, changes),
        matrix,
        shownId,
        role,
      );
    });
  // Taking a runtime or a model back takes back what it brought along.
  const resetCell = (role: string, column: MatrixColumn) =>
    setPending((current) => {
      const columns: MatrixColumn[] =
        column === 'runtime'
          ? ['runtime', 'model', 'reasoning', 'device']
          : column === 'model'
            ? ['model', 'reasoning']
            : [column];
      return columns.reduce((next, entry) => clearSchemaCell(next, shownId, role, entry), current);
    });

  const submit = async (input: { name: string; description: string }) => {
    if (!dialog) return;
    if (dialog.kind === 'edit') {
      const { schema } = dialog;
      const body = {
        ...(input.name !== schema.name ? { name: input.name } : {}),
        ...(input.description !== schema.description ? { description: input.description } : {}),
      };
      if (Object.keys(body).length > 0)
        await update.mutateAsync({ id: schema.id, expectedRevision: matrix.revision, ...body });
      toast.success(t('schemaEditor.toast.updated'));
      return;
    }
    const id = schemaIdFor(input.name, Object.keys(matrix.schemas));
    await create.mutateAsync({
      expectedRevision: matrix.revision,
      id,
      name: input.name,
      description: input.description,
      ...(dialog.kind === 'copy' ? { copyFrom: dialog.from.id } : {}),
    });
    setViewed(id);
    toast.success(t('schemaEditor.toast.created'));
  };

  const confirmRemove = async () => {
    if (!removing) return;
    try {
      await remove.mutateAsync({ id: removing.id, expectedRevision: matrix.revision });
    } catch (error) {
      toast.error(t('schemaEditor.delete.failed'));
      throw error;
    }
    setPending((current) => discardSchema(current, removing.id));
    if (viewed === removing.id) setViewed(null);
    toast.success(t('schemaEditor.toast.deleted'));
  };

  return (
    <>
      <Section
        title={t('schemaEditor.title')}
        description={t('schemaEditor.description')}
        actions={
          <Button icon={<Plus size={14} />} onClick={() => setDialog({ kind: 'create' })}>
            {t('schemaEditor.new')}
          </Button>
        }
      >
        <Grid min="card" gap={3}>
          {schemas.map((schema) => {
            const use = schemaUse(matrix, schema.id);
            return (
              <SchemaCard
                key={schema.id}
                schema={schema}
                labels={labels}
                active={use.active}
                activating={pending.active === schema.id}
                projects={use.projects.map(projectName)}
                selected={schema.id === shownId}
                onSelect={() => setViewed(schema.id)}
                onActivate={() => onActivate(schema.id)}
                onCopy={() => setDialog({ kind: 'copy', from: schema })}
                onEdit={() => setDialog({ kind: 'edit', schema })}
                onDelete={() => setRemoving(schema)}
              />
            );
          })}
        </Grid>
      </Section>

      {shown && (
        <SchemaRoles
          matrix={matrix}
          pending={pending}
          schema={shown}
          catalog={catalog}
          catalogFailed={catalogFailed}
          labels={labels}
          onCell={stageCell}
          onReset={resetCell}
          onAdd={(role) =>
            setPending((current) => setSchemaCells(current, shownId, role, {}, true))
          }
          onDiscard={(role) => setPending((current) => discardSchemaRole(current, shownId, role))}
          onCopy={() => setDialog({ kind: 'copy', from: shown })}
        />
      )}

      {dialog && (
        <SchemaDialog
          mode={dialog}
          initialDescription={
            dialog.kind === 'edit'
              ? dialog.schema.description
              : dialog.kind === 'copy'
                ? dialog.from.builtIn
                  ? labels.schemaText(dialog.from)
                  : dialog.from.description
                : ''
          }
          labels={labels}
          onSubmit={submit}
          onReload={() => {
            setDialog(null);
            onReload();
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {removing && (
        <ConfirmDialog
          title={t('schemaEditor.delete.title', { name: removing.name })}
          confirmLabel={t('schemaEditor.delete.confirm')}
          onConfirm={confirmRemove}
          onClose={() => setRemoving(null)}
        >
          <p>{t('schemaEditor.delete.text')}</p>
        </ConfirmDialog>
      )}
    </>
  );
}
