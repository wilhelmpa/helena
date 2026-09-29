'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LayoutGrid, List as ListIcon, Search, Table2, TableProperties } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  Card,
  EmptyState,
  Grid,
  Inline,
  List,
  ListRow,
  SearchField,
  Segmented,
  Stack,
  Table,
  Td,
  Text,
  Th,
  Tr,
} from '@/design-system';
import { ApiError } from '@/lib/api/core/client';
import { getBase, getBaseRows, type BaseRow } from '@/lib/api/endpoints/knowledge';

// A column of a view: `note.status` → "status", `file.name` → "name", unless the .base names
// it (`properties: { note.status: { displayName: Status } }`).
function columnLabel(column: string, properties: Record<string, unknown> | undefined): string {
  const named = properties?.[column] as { displayName?: unknown } | undefined;
  if (typeof named?.displayName === 'string' && named.displayName) return named.displayName;
  return column.replace(/^(note|file|formula)\./, '');
}

function cellText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '–';
  if (Array.isArray(value)) return value.map(cellText).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function rowText(row: BaseRow): string {
  return [row.file.basename, ...Object.values(row.values).map(cellText)].join(' ').toLowerCase();
}

// An Obsidian Base (.base) of Wissen as Helena shows it (docs/second-brain-backend-api.md):
// its views (table, cards, list) over the notes the reader may see, a filter over the rows,
// and a click on a row opens its note. Formulas Helena does not evaluate yet say so plainly
// instead of showing wrong values.
export default function KnowledgeBaseView({
  path,
  compact = false,
  onOpenNote,
}: {
  path: string;
  compact?: boolean;
  onOpenNote?: (vaultPath: string) => void;
}) {
  const t = useTranslations('files.base');
  const base = useQuery({ queryKey: ['knowledge-base', path], queryFn: () => getBase(path) });
  const views = (base.data?.definition.views ?? []).filter(
    (view): view is { name: string; type?: string } => typeof view.name === 'string',
  );
  const [chosen, setChosen] = useState<string | null>(null);
  const view = chosen ?? views[0]?.name ?? undefined;
  const rows = useQuery({
    queryKey: ['knowledge-base-rows', path, view ?? ''],
    queryFn: () => getBaseRows(path, view),
    enabled: base.isSuccess,
    retry: false,
  });
  const [filter, setFilter] = useState('');
  const properties = base.data?.definition.properties as Record<string, unknown> | undefined;
  const shown = useMemo(() => {
    const words = filter.trim().toLowerCase();
    const all = rows.data?.rows ?? [];
    return words ? all.filter((row) => rowText(row).includes(words)) : all;
  }, [rows.data, filter]);

  if (base.isPending || (base.isSuccess && rows.isPending))
    return <EmptyState fill={false}>{t('loading')}</EmptyState>;
  if (base.isError)
    return (
      <EmptyState icon={<TableProperties />} fill={false}>
        {t('readFailed')}
      </EmptyState>
    );
  if (rows.isError) {
    const unsupported = rows.error instanceof ApiError && rows.error.status === 422;
    return (
      <EmptyState icon={<TableProperties />} title={t(unsupported ? 'unsupported' : 'rowsFailed')}>
        {unsupported ? rows.error.message : null}
      </EmptyState>
    );
  }
  const data = rows.data!;
  const columns = data.view.order.length ? data.view.order : ['file.name'];
  const type = data.view.type === 'cards' || data.view.type === 'list' ? data.view.type : 'table';
  const title = (row: BaseRow) => row.file.basename.replace(/\.md$/i, '');
  // The note's name opens it (a button, so the keyboard reaches it too).
  const opener = (row: BaseRow) =>
    onOpenNote ? (
      <button type="button" className="ds-base-open" onClick={() => onOpenNote(row.path)}>
        {title(row)}
      </button>
    ) : (
      title(row)
    );

  return (
    <Stack gap={3} className="ds-knowledge-base" data-knowledge-base={path}>
      <Inline gap={2} wrap justify="between">
        {views.length > 1 ? (
          <Segmented
            label={t('views')}
            value={view ?? ''}
            onChange={(next) => setChosen(next)}
            options={views.map((item) => ({
              value: item.name,
              label: item.name,
              icon:
                item.type === 'cards' ? (
                  <LayoutGrid size={13} />
                ) : item.type === 'list' ? (
                  <ListIcon size={13} />
                ) : (
                  <Table2 size={13} />
                ),
            }))}
          />
        ) : (
          <Text size="xs" tone="muted">
            {data.view.name}
          </Text>
        )}
        <SearchField
          icon={<Search size={13} aria-hidden="true" />}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={t('filter')}
          aria-label={t('filter')}
        />
      </Inline>
      <Text size="xs" tone="muted">
        {filter.trim()
          ? t('countFiltered', { shown: shown.length, total: data.total })
          : t('count', { count: data.total })}
      </Text>
      {shown.length === 0 ? (
        <EmptyState icon={<TableProperties />} fill={false}>
          {filter.trim() ? t('noMatch') : t('empty')}
        </EmptyState>
      ) : type === 'cards' ? (
        <Grid min={compact ? undefined : 'card'} columns={compact ? 1 : undefined}>
          {shown.map((row) => (
            <Card key={row.path} title={opener(row)} data-base-row={row.path}>
              <Stack gap={1}>
                {columns
                  .filter((column) => column !== 'file.name' && column !== 'file.basename')
                  .map((column) => (
                    <Text key={column} size="xs" tone="muted">
                      {`${columnLabel(column, properties)}: ${cellText(row.values[column])}`}
                    </Text>
                  ))}
              </Stack>
            </Card>
          ))}
        </Grid>
      ) : type === 'list' ? (
        <List label={data.view.name}>
          {shown.map((row) => (
            <ListRow
              key={row.path}
              title={title(row)}
              subtitle={columns
                .filter((column) => column !== 'file.name' && column !== 'file.basename')
                .map((column) => cellText(row.values[column]))
                .filter((value) => value !== '–')
                .join(' · ')}
              onSelect={onOpenNote ? () => onOpenNote(row.path) : undefined}
              data-base-row={row.path}
            />
          ))}
        </List>
      ) : (
        <Table label={data.view.name}>
          <thead>
            <tr>
              {columns.map((column) => (
                <Th key={column}>{columnLabel(column, properties)}</Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <Tr key={row.path} data-base-row={row.path}>
                {columns.map((column, index) => (
                  <Td key={column} label={columnLabel(column, properties)}>
                    {index === 0 ? opener(row) : cellText(row.values[column])}
                  </Td>
                ))}
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      {data.total > data.rows.length && (
        <Text size="xs" tone="muted">
          {t('truncated', { count: data.rows.length })}
        </Text>
      )}
    </Stack>
  );
}
