'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import { useDeleteSchemaRole } from '../services/modelMatrix.service';
import { Copy, Plus } from 'lucide-react';
import {
  Button,
  EmptyState,
  Grid,
  Notice,
  PillButton,
  PopoverPick,
  Section,
  type PickItem,
} from '@/design-system';
import type {
  MatrixColumn,
  MatrixSchema,
  MatrixValues,
  ModelMatrix,
  SchemaCatalogModel,
} from '@/lib/api/endpoints/modelMatrix';
import { ROLES } from '../utils/columns';
import type { MatrixLabels } from '../utils/labels';
import { schemaRoleValues, type Pending } from '../utils/pending';
import { SchemaRoleCard } from './SchemaRoleCard';

// The roles of the schema that is shown, one card each. A built-in schema is only shown, with
// the way to a copy; a custom one is edited in place, and every change waits for the preview.
export function SchemaRoles({
  matrix,
  pending,
  schema,
  catalog,
  catalogFailed,
  labels,
  onCell,
  onReset,
  onAdd,
  onDiscard,
  onCopy,
}: {
  matrix: ModelMatrix;
  pending: Pending;
  schema: MatrixSchema;
  catalog: SchemaCatalogModel[];
  catalogFailed: boolean;
  labels: MatrixLabels;
  onCell: (role: string, column: MatrixColumn, value: MatrixValues[MatrixColumn]) => void;
  onReset: (role: string, column: MatrixColumn) => void;
  onAdd: (role: string) => void;
  onDiscard: (role: string) => void;
  onCopy: () => void;
}) {
  const { t } = labels;
  const [removing, setRemoving] = useState<string | null>(null);
  const remove = useDeleteSchemaRole();
  const builtIn = schema.builtIn === true;
  const editable = !builtIn && catalog.length > 0;
  const present = ROLES.filter(
    (role) => role in schema.roles || pending.schemas[schema.id]?.[role]?.added,
  );
  const missing = ROLES.filter((role) => !present.includes(role));
  const general = schemaRoleValues(matrix, pending, schema.id, 'general');
  const addItems: PickItem[] = missing.map((role) => ({
    key: role,
    search: t(`roles.${role}`),
    icon: null,
    label: t(`roles.${role}`),
    selected: false,
    onSelect: () => onAdd(role),
  }));
  return (
    <>
      <Section
        title={t('schemaEditor.roles.title', { name: schema.name })}
        description={builtIn ? t('schemaEditor.roles.builtIn') : t('schemaEditor.roles.custom')}
        actions={
          builtIn ? (
            <Button icon={<Copy size={14} />} onClick={onCopy}>
              {t('schemaEditor.roles.copyToEdit')}
            </Button>
          ) : (
            missing.length > 0 && (
              <PopoverPick
                trigger={
                  <PillButton icon={<Plus size={14} />} disabled={!editable}>
                    {t('schemaEditor.roles.add')}
                  </PillButton>
                }
                inputPlaceholder={t('search')}
                emptyText={t('noResults')}
                align="end"
                items={addItems}
              />
            )
          )
        }
      >
        {catalogFailed && !builtIn && (
          <Notice tone="warning" title={t('schemaEditor.roles.catalogFailed')}>
            {t('schemaEditor.roles.catalogFailedText')}
          </Notice>
        )}
        {!builtIn && !general && (
          <Notice tone="warning" title={t('schemaEditor.roles.needsGeneral')}>
            {t('schemaEditor.roles.needsGeneralText')}
          </Notice>
        )}
        {present.length === 0 ? (
          <EmptyState fill={false} title={t('schemaEditor.roles.emptyTitle')}>
            {t('schemaEditor.roles.emptyText')}
          </EmptyState>
        ) : (
          <Grid min="wide" gap={3}>
            {present.map((role) => {
              const entry = schemaRoleValues(matrix, pending, schema.id, role);
              if (!entry) return null;
              return (
                <SchemaRoleCard
                  key={role}
                  roleId={role}
                  values={entry.values}
                  staged={entry.staged as ReadonlySet<MatrixColumn>}
                  added={entry.added}
                  editable={editable}
                  catalog={catalog}
                  labels={labels}
                  onChange={(column, value) => onCell(role, column, value)}
                  onReset={(column) => onReset(role, column)}
                  onDiscard={() => onDiscard(role)}
                  onRemove={
                    !builtIn && !entry.added && role !== 'general'
                      ? () => setRemoving(role)
                      : undefined
                  }
                />
              );
            })}
          </Grid>
        )}
      </Section>
      {removing && (
        <ConfirmDialog
          title={t('schemaEditor.roleDelete.title', { name: t(`roles.${removing}` as never) })}
          confirmLabel={t('schemaEditor.roleDelete.confirm')}
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            try {
              await remove.mutateAsync({
                id: schema.id,
                role: removing,
                expectedRevision: matrix.revision,
              });
            } catch (error) {
              toast.error(t('schemaEditor.roleDelete.failed'));
              throw error;
            }
            onDiscard(removing);
            setRemoving(null);
          }}
        >
          <p>{t('schemaEditor.roleDelete.text')}</p>
        </ConfirmDialog>
      )}
    </>
  );
}
