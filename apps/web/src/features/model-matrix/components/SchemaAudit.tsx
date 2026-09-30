'use client';

import { useFormatter } from 'next-intl';
import { ListBox, ListRow, Notice, Section, Text } from '@/design-system';
import type { MatrixSchema } from '@/lib/api/endpoints/modelMatrix';
import { useSchemaAudit } from '../services/modelMatrix.service';
import type { MatrixLabels } from '../utils/labels';

export function SchemaAudit({
  labels,
  schemas,
}: {
  labels: MatrixLabels;
  schemas: Record<string, MatrixSchema>;
}) {
  const { t } = labels;
  const audit = useSchemaAudit();
  const format = useFormatter();
  if (audit.isPending) return null;
  return (
    <Section title={t('schemaEditor.audit.title')}>
      {audit.isError ? (
        <Notice tone="warning" title={t('schemaEditor.audit.failed')} />
      ) : (
        <ListBox>
          {audit.data.entries.length === 0 ? (
            <ListRow title={t('schemaEditor.audit.empty')} />
          ) : (
            audit.data.entries.map((entry) => (
              <ListRow
                key={entry.revision}
                title={t('schemaEditor.audit.entry', {
                  revision: entry.revision,
                  action: t(`schemaEditor.audit.actions.${entry.action}` as never),
                })}
                subtitle={entry.schemaIds.map((id) => schemas[id]?.name ?? id).join(', ')}
                meta={
                  <Text size="xs" tone="muted">
                    {format.dateTime(new Date(entry.at), {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </Text>
                }
              />
            ))
          )}
        </ListBox>
      )}
    </Section>
  );
}
