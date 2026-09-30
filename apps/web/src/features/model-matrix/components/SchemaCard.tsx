'use client';

import { Copy, Pencil, Trash2 } from 'lucide-react';
import { ActionMenu, Button, Card, Inline, Pill, Stack, Text } from '@/design-system';
import type { MatrixRuntime, MatrixSchema } from '@/lib/api/endpoints/modelMatrix';
import type { MatrixLabels } from '../utils/labels';

// A schema as a card: its name and how it is used, what it is for, which runtimes its roles
// run on, and what can be done with it. The card of the schema shown below is marked.
export function SchemaCard({
  schema,
  labels,
  active,
  activating,
  projects,
  selected,
  onSelect,
  onActivate,
  onCopy,
  onEdit,
  onDelete,
}: {
  schema: MatrixSchema;
  labels: MatrixLabels;
  // The schema all agents follow now.
  active: boolean;
  // Chosen to become the active one, not applied yet.
  activating: boolean;
  // The names of the projects that follow this schema instead of the active one.
  projects: string[];
  selected: boolean;
  onSelect: () => void;
  onActivate: () => void;
  onCopy: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = labels;
  const builtIn = schema.builtIn === true;
  const runtimes = [...new Set(Object.values(schema.roles).map((values) => values.runtime))];
  const inUse = active || projects.length > 0;
  return (
    <Card
      title={schema.name}
      selected={selected}
      data-schema={schema.id}
      actions={
        <ActionMenu
          label={t('schemaEditor.menu.label', { name: schema.name })}
          items={[
            {
              id: 'copy',
              label: t('schemaEditor.menu.copy'),
              icon: <Copy />,
              onSelect: onCopy,
            },
            ...(builtIn
              ? []
              : [
                  {
                    id: 'edit',
                    label: t('schemaEditor.menu.edit'),
                    icon: <Pencil />,
                    onSelect: onEdit,
                  },
                  {
                    id: 'delete',
                    label: inUse
                      ? t('schemaEditor.menu.deleteInUse')
                      : t('schemaEditor.menu.delete'),
                    icon: <Trash2 />,
                    danger: true,
                    disabled: inUse,
                    onSelect: onDelete,
                  },
                ]),
          ]}
        />
      }
    >
      <Stack gap={3} grow>
        <Inline gap={1} wrap>
          {active && <Pill tone="success">{t('schemaEditor.badge.active')}</Pill>}
          {activating && !active && (
            <Pill tone="warning">{t('schemaEditor.badge.activating')}</Pill>
          )}
          <Pill>{builtIn ? t('schemaEditor.badge.builtIn') : t('schemaEditor.badge.custom')}</Pill>
          {projects.length > 0 && (
            <Pill title={projects.join(', ')}>
              {t('schemaEditor.badge.projects', { count: projects.length })}
            </Pill>
          )}
        </Inline>
        <Text tone="muted">{labels.schemaText(schema)}</Text>
        <Text size="xs" tone="faint">
          {t('schemaEditor.roleCount', { count: Object.keys(schema.roles).length })}
          {runtimes.length > 0
            ? ` · ${runtimes.map((runtime) => labels.value('runtime', runtime as MatrixRuntime)).join(', ')}`
            : ''}
        </Text>
      </Stack>
      <Inline gap={2} wrap>
        <Button size="small" variant={selected ? 'quiet' : 'ghost'} onClick={onSelect}>
          {builtIn ? t('schemaEditor.view') : t('schemaEditor.editRoles')}
        </Button>
        {!active && (
          <Button size="small" variant="ghost" onClick={onActivate}>
            {activating ? t('schemaEditor.activateUndo') : t('schemaEditor.activate')}
          </Button>
        )}
      </Inline>
    </Card>
  );
}
