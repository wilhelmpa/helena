'use client';

import { Trash2 } from 'lucide-react';
import { ActionMenu, Button, Card, Pill, Property, PropertyGrid } from '@/design-system';
import type {
  MatrixColumn,
  MatrixValues,
  SchemaCatalogModel,
} from '@/lib/api/endpoints/modelMatrix';
import { COLUMN_ORDER } from '../utils/columns';
import type { MatrixLabels } from '../utils/labels';
import { SchemaRoleCell } from './SchemaRoleCell';

// One role of a schema as a card: the role's name, and every value it gets under the schema.
export function SchemaRoleCard({
  roleId,
  values,
  staged,
  added,
  editable,
  catalog,
  labels,
  onChange,
  onReset,
  onDiscard,
  onRemove,
}: {
  roleId: string;
  values: MatrixValues;
  // The columns changed and not applied yet.
  staged: ReadonlySet<MatrixColumn>;
  // The role is new to the schema and not applied yet.
  added: boolean;
  editable: boolean;
  catalog: SchemaCatalogModel[];
  labels: MatrixLabels;
  onChange: (column: MatrixColumn, value: MatrixValues[MatrixColumn]) => void;
  onReset: (column: MatrixColumn) => void;
  onDiscard: () => void;
  onRemove?: () => void;
}) {
  const { t } = labels;
  return (
    <Card
      title={t(`roles.${roleId}` as never)}
      actions={
        <>
          {added ? (
            <>
              <Pill tone="warning">{t('schemaEditor.roles.new')}</Pill>
              <Button size="small" variant="ghost" onClick={onDiscard}>
                {t('schemaEditor.roles.discard')}
              </Button>
            </>
          ) : staged.size > 0 ? (
            <Pill tone="warning">{t('schemaEditor.roles.changed')}</Pill>
          ) : null}
          {onRemove && !added && roleId !== 'general' && (
            <ActionMenu
              label={t('schemaEditor.roleDelete.menu', { name: t(`roles.${roleId}` as never) })}
              items={[
                {
                  id: 'remove',
                  label: t('schemaEditor.roleDelete.confirm'),
                  icon: <Trash2 />,
                  danger: true,
                  onSelect: onRemove,
                },
              ]}
            />
          )}
        </>
      }
      data-role={roleId}
    >
      <PropertyGrid columns={1}>
        {COLUMN_ORDER.map((column) => (
          <Property key={column} label={t(`columns.${column}`)}>
            <SchemaRoleCell
              column={column}
              values={values}
              staged={staged.has(column)}
              editable={editable}
              catalog={catalog}
              labels={labels}
              onChange={(value) => onChange(column, value)}
              onReset={() => onReset(column)}
            />
          </Property>
        ))}
      </PropertyGrid>
    </Card>
  );
}
