'use client';

import { Fragment, useMemo } from 'react';
import {
  Checkbox,
  Inline,
  PopoverPick,
  Table,
  Td,
  Text,
  Th,
  Tr,
  type PickItem,
} from '@/design-system';
import type { OrganizationAgent } from '@/lib/api/endpoints/organization';
import type {
  MatrixAgentRow,
  MatrixColumn,
  MatrixRuntime,
  MatrixValues,
  ModelMatrix,
} from '@/lib/api/endpoints/modelMatrix';
import { COLUMN_ORDER, ROLES, modelsOfRuntime } from '../utils/columns';
import type { MatrixLabels } from '../utils/labels';
import { agentGroup, type AgentGroup, type Pending } from '../utils/pending';
import { ColumnCell, type CatalogModel } from './ColumnCell';

export interface MatrixRowView {
  row: MatrixAgentRow;
  name: string;
  group: AgentGroup;
}

// What a cell shows once the staged changes are counted: a value set in the matrix wins,
// a reset shows what the schema gives, an inherited value follows a staged role change.
export function effectiveCell<K extends MatrixColumn>(
  matrix: ModelMatrix,
  row: MatrixAgentRow,
  column: K,
  pending: Pending,
): { value: MatrixValues[K]; source: 'schema' | 'project' | 'own'; staged: boolean } {
  const entry = pending.agents[row.id];
  const role = entry?.role ?? row.role;
  const schema = matrix.schemas[row.schemaId];
  const base = (schema?.roles[role] ?? schema?.roles.general)?.[column] as MatrixValues[K];
  const inherited = row.cells[column].source === 'project' ? 'project' : 'schema';
  if (entry && column in entry.values) {
    const staged = entry.values[column];
    return staged === null
      ? { value: base, source: inherited, staged: true }
      : { value: staged as MatrixValues[K], source: 'own', staged: true };
  }
  const cell = row.cells[column];
  if (entry?.role !== undefined && cell.source !== 'own')
    return { value: base, source: cell.source, staged: true };
  return { value: cell.value as MatrixValues[K], source: cell.source, staged: false };
}

export function AgentMatrix({
  matrix,
  agents,
  pending,
  selected,
  models,
  labels,
  onSelect,
  onCell,
  onReset,
  onRole,
}: {
  matrix: ModelMatrix;
  agents: OrganizationAgent[];
  pending: Pending;
  selected: Set<number>;
  models: CatalogModel[];
  labels: MatrixLabels;
  onSelect: (ids: number[], on: boolean) => void;
  onCell: (ids: number[], column: MatrixColumn, value: MatrixValues[MatrixColumn]) => void;
  onReset: (ids: number[], column: MatrixColumn) => void;
  onRole: (id: number, role: string) => void;
}) {
  const { t } = labels;
  const rows: MatrixRowView[] = useMemo(() => {
    const byId = new Map(agents.map((agent) => [agent.id, agent]));
    return matrix.agents
      .map((row) => {
        const agent = byId.get(row.id);
        return {
          row,
          name: agent?.name ?? row.username,
          group: agentGroup(row.role, agent?.role ?? null, agent?.isHome),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [matrix.agents, agents]);
  const groups: AgentGroup[] = ['home', 'coordinator', 'specialist'];
  const allIds = rows.map((entry) => entry.row.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const someSelected = allIds.some((id) => selected.has(id));
  const schemaName = (id: string) => matrix.schemas[id]?.name ?? id;

  const roleItems = (row: MatrixAgentRow): PickItem[] =>
    ROLES.map((role) => ({
      key: role,
      search: t(`roles.${role}`),
      icon: null,
      label: t(`roles.${role}`),
      selected: (pending.agents[row.id]?.role ?? row.role) === role,
      onSelect: () => onRole(row.id, role),
    }));

  return (
    <Table label={t('agents.title')} className="ds-matrix">
      <thead>
        <tr>
          <Th className="ds-matrix-check">
            <Checkbox
              aria-label={t('select.all')}
              checked={allSelected ? true : someSelected ? 'indeterminate' : false}
              onCheckedChange={(on) => onSelect(allIds, on === true)}
            />
          </Th>
          <Th>{t('agents.agent')}</Th>
          {COLUMN_ORDER.map((column) => (
            <Th key={column}>{t(`columns.${column}`)}</Th>
          ))}
        </tr>
      </thead>
      <tbody>
        {groups.map((group) => {
          const inGroup = rows.filter((entry) => entry.group === group);
          if (!inGroup.length) return null;
          return (
            <Fragment key={group}>
              <Tr className="ds-matrix-group-row">
                <Td colSpan={COLUMN_ORDER.length + 2}>
                  {t(`groups.${group}`)} · {inGroup.length}
                </Td>
              </Tr>
              {inGroup.map(({ row, name }) => {
                const runtime = effectiveCell(matrix, row, 'runtime', pending)
                  .value as MatrixRuntime;
                const staged = pending.agents[row.id];
                return (
                  <Tr key={row.id} selected={selected.has(row.id)}>
                    <Td className="ds-matrix-check">
                      <Checkbox
                        aria-label={t('select.agent', { name })}
                        checked={selected.has(row.id)}
                        onCheckedChange={(on) => onSelect([row.id], on === true)}
                      />
                    </Td>
                    <Td>
                      <div className="ds-matrix-agent">
                        <Text weight="medium" truncate>
                          {name}
                        </Text>
                        <Inline gap={1}>
                          <PopoverPick
                            trigger={
                              <button
                                type="button"
                                className="ds-matrix-role"
                                data-staged={staged?.role !== undefined ? '' : undefined}
                                aria-label={t('agents.roleOf', { name })}
                              >
                                {t(`roles.${staged?.role ?? row.role}` as never)}
                              </button>
                            }
                            inputPlaceholder={t('search')}
                            emptyText={t('noResults')}
                            items={roleItems(row)}
                          />
                          {row.project && (
                            <Text size="xs" tone="faint">
                              · {row.project.key}
                            </Text>
                          )}
                        </Inline>
                      </div>
                    </Td>
                    {COLUMN_ORDER.map((column) => {
                      const cell = effectiveCell(matrix, row, column, pending);
                      return (
                        <Td
                          key={column}
                          label={t(`columns.${column}`)}
                          className={
                            column === 'escalation' || column === 'decision'
                              ? 'ds-matrix-wide'
                              : 'ds-matrix-nowrap'
                          }
                        >
                          <ColumnCell
                            column={column}
                            value={cell.value}
                            source={cell.source}
                            staged={cell.staged}
                            runtime={runtime}
                            origin={schemaName(
                              cell.source === 'project'
                                ? (matrix.projects[String(row.project?.id)] ?? row.schemaId)
                                : row.schemaId,
                            )}
                            models={models}
                            labels={labels}
                            onChange={(value) => onCell([row.id], column, value)}
                            onReset={() => onReset([row.id], column)}
                          />
                        </Td>
                      );
                    })}
                  </Tr>
                );
              })}
            </Fragment>
          );
        })}
      </tbody>
    </Table>
  );
}

// A model that fits the runtime a row is about to have: the schema's choice for a role that
// already uses that runtime, else the first catalog model of the runtime.
export function modelForRuntime(
  runtime: MatrixRuntime,
  matrix: ModelMatrix,
  schemaId: string,
  role: string,
  models: CatalogModel[],
): string | null {
  const roles = matrix.schemas[schemaId]?.roles ?? {};
  const own = roles[role];
  if (own?.runtime === runtime) return own.model;
  const other = Object.values(roles).find((entry) => entry.runtime === runtime);
  if (other) return other.model;
  if (runtime === 'helena') return 'volition-local-default';
  return modelsOfRuntime(runtime, models, [])[0]?.id ?? null;
}
