'use client';

import { useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import {
  Button,
  EmptyState,
  Inline,
  MatrixBar,
  Notice,
  PillButton,
  PopoverPick,
  Section,
  Stack,
  Text,
  type PickItem,
  Sections,
} from '@/design-system';
import { ApiError } from '@/lib/api/core/client';
import type {
  MatrixColumn,
  MatrixPatch,
  MatrixPreview,
  MatrixRuntime,
  MatrixValues,
  ModelMatrix,
} from '@/lib/api/endpoints/modelMatrix';
import { useOrganizationQuery } from '@/features/organization/services/organization.service';
import {
  useApplyMatrix,
  useModelCatalog,
  useModelMatrix,
  usePreviewMatrix,
} from '../services/modelMatrix.service';
import { COLUMN_ORDER, modelsOfRuntime } from '../utils/columns';
import { useMatrixLabels } from '../utils/labels';
import {
  EMPTY_PENDING,
  buildPatch,
  clearAgentColumn,
  isEmpty,
  pendingAgentCount,
  pendingCount,
  setAgentRole,
  setAgentValue,
  targetSchemaId,
  type Pending,
} from '../utils/pending';
import { AgentMatrix, effectiveCell, modelForRuntime } from './AgentMatrix';
import { ChangePreviewDialog, type PreviewState } from './ChangePreviewDialog';
import { ClassMatrix } from './ClassMatrix';
import { ColumnCell } from './ColumnCell';
import { MatrixHeader } from './MatrixHeader';

type Plan = { kind: 'apply' | 'undo'; steps: Omit<MatrixPatch, 'expectedRevision'>[] };

// Administrator › Agenten und Modelle: the matrix of every agent's runtime, model, thinking
// depth, escalation, browser control, decider and device, under one schema and one local
// profile (Auftrag 121c, owner O85). A change is staged here, checked by the server
// ("wirkt auf N Agenten") and only then written; the last one can be taken back.
export default function ModelMatrixPage({ teamId }: { teamId: number }) {
  const [projectId, setProjectId] = useState<number | undefined>();
  const matrixQuery = useModelMatrix(teamId, projectId);
  const organization = useOrganizationQuery(teamId).data;
  const matrix = matrixQuery.data;
  const catalog = useModelCatalog(teamId, matrix?.agents[0]?.id);
  // The catalog of the pickers, plus every model the schemas and agents already use, so a
  // picker offers something even where the catalog could not be read.
  const models = useMemo(() => {
    const byId = new Map<string, { id: string; name: string }>();
    for (const entry of [...(catalog.data?.models ?? []), ...(catalog.data?.localModels ?? [])])
      byId.set(entry.id, { id: entry.id, name: entry.name });
    const known = [
      ...Object.values(matrix?.schemas ?? {}).flatMap((schema) =>
        Object.values(schema.roles).map((values) => values.model),
      ),
      ...(matrix?.agents.map((row) => row.cells.model.value) ?? []),
    ];
    for (const id of known) if (!byId.has(id)) byId.set(id, { id, name: '' });
    return [...byId.values()];
  }, [catalog.data, matrix]);
  const names = useMemo(
    () => new Map(models.filter((entry) => entry.name).map((entry) => [entry.id, entry.name])),
    [models],
  );
  const labels = useMatrixLabels(names);
  const { t } = labels;
  const client = useQueryClient();
  const preview = usePreviewMatrix();
  const apply = useApplyMatrix();

  const [pending, setPending] = useState<Pending>(EMPTY_PENDING);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [dialog, setDialog] = useState<{ plan: Plan; state: PreviewState } | null>(null);

  const agentNames = useMemo(
    () => new Map((organization?.agents ?? []).map((agent) => [agent.id, agent.name])),
    [organization],
  );
  const project = projectId
    ? (organization?.projects.find((entry) => entry.id === projectId) ?? null)
    : null;

  const rowOf = useCallback(
    (id: number) => matrix?.agents.find((entry) => entry.id === id),
    [matrix],
  );

  const stage = useCallback(
    (ids: number[], column: MatrixColumn, value: MatrixValues[MatrixColumn]) => {
      if (!matrix) return;
      setPending((current) => {
        let next = current;
        for (const id of ids) {
          const row = rowOf(id);
          if (!row) continue;
          next = setAgentValue(next, id, column, value);
          // A new runtime brings a model and a device that fit it; the person can still
          // change both, and they are shown as staged like the runtime itself.
          if (column === 'runtime') {
            const runtime = value as MatrixRuntime;
            const role = next.agents[id]?.role ?? row.role;
            const model = effectiveCell(matrix, row, 'model', next).value;
            if (
              !modelsOfRuntime(runtime, models, []).some((entry) => entry.id === model) &&
              !(runtime === 'helena' && model === 'volition-local-default')
            ) {
              const fitting = modelForRuntime(runtime, matrix, row.schemaId, role, models);
              if (fitting && runtime !== 'command' && runtime !== 'webhook')
                next = setAgentValue(next, id, 'model', fitting);
            }
            const device = effectiveCell(matrix, row, 'device', next).value;
            if (runtime === 'helena' && device === 'cloud')
              next = setAgentValue(next, id, 'device', 'gpu');
            if (runtime !== 'helena' && device === 'gpu')
              next = setAgentValue(next, id, 'device', 'cloud');
          }
        }
        return next;
      });
    },
    [matrix, models, rowOf],
  );

  const reset = useCallback(
    (ids: number[], column: MatrixColumn) => {
      setPending((current) => {
        let next = current;
        for (const id of ids) {
          const row = rowOf(id);
          if (!row) continue;
          next =
            row.cells[column].source === 'own'
              ? setAgentValue(next, id, column, null)
              : clearAgentColumn(next, id, column);
        }
        return next;
      });
    },
    [rowOf],
  );

  const setRole = useCallback(
    (id: number, role: string) => {
      const row = rowOf(id);
      if (row)
        setPending((current) => setAgentRole(current, id, role === row.role ? undefined : role));
    },
    [rowOf],
  );

  const select = useCallback((ids: number[], on: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const header = matrix && {
    onSchema: (id: string) =>
      setPending((current) => ({
        ...current,
        active: id === matrix.active ? undefined : id,
        profile: undefined,
      })),
    onProfile: (id: string) =>
      setPending((current) => {
        const target = matrix.schemas[targetSchemaId(matrix, current)];
        return { ...current, profile: target?.profile === id ? undefined : id };
      }),
    onProjectSchema: (schemaId: string | null) => {
      if (!project) return;
      setPending((current) => {
        const stored = matrix.projects[String(project.id)] ?? null;
        const projects = { ...current.projects };
        if (schemaId === stored) delete projects[project.id];
        else projects[project.id] = schemaId;
        return { ...current, projects };
      });
    },
  };

  const preflight = useCallback(
    async (plan: Plan) => {
      if (!matrix) return;
      setDialog({ plan, state: { status: 'loading' } });
      try {
        const previews: MatrixPreview[] = [];
        for (const step of plan.steps)
          previews.push(await preview.mutateAsync({ ...step, expectedRevision: matrix.revision }));
        setDialog({ plan, state: { status: 'ready', previews } });
      } catch (error) {
        setDialog({ plan, state: failure(error) });
      }
    },
    [matrix, preview],
  );

  const openApply = () => {
    if (!matrix || isEmpty(pending)) return;
    const { expectedRevision: _revision, ...patch } = buildPatch(matrix, pending);
    void preflight({ kind: 'apply', steps: [patch] });
  };
  // The server keeps the last applies (schema, profile, project schemas and the values of
  // the agents each changed), so this works after a reload as well, one step at a time.
  const openUndo = () => {
    if (matrix && matrix.undo.depth > 0) void preflight({ kind: 'undo', steps: [{ undo: true }] });
  };

  const applyPlan = async () => {
    if (!matrix || !dialog) return;
    const { plan } = dialog;
    const before = matrix;
    let done = 0;
    try {
      for (const [index, step] of plan.steps.entries()) {
        await apply.mutateAsync({ ...step, expectedRevision: before.revision + index });
        done += 1;
      }
    } catch (error) {
      if (done > 0) toast.error(t('apply.partial'));
      setDialog({ plan, state: failure(error) });
      return;
    }
    setDialog(null);
    void client.invalidateQueries({ queryKey: ['organization'] });
    if (plan.kind === 'apply') {
      setPending(EMPTY_PENDING);
      setSelected(new Set());
      toast.success(t('apply.done'));
    } else toast.success(t('undo.done'));
  };

  const reload = () => {
    setDialog(null);
    void matrixQuery.refetch();
  };

  if (matrixQuery.isPending) return <ListSkeleton rows={8} rowClassName="h-10" />;
  if (matrixQuery.isError || !matrix || !header)
    return (
      <Notice tone="danger" title={t('loadFailed')}>
        {matrixQuery.error instanceof Error ? matrixQuery.error.message : ''}
      </Notice>
    );

  const projects = organization?.projects ?? [];
  const projectItems: PickItem[] = [
    {
      key: 'all',
      search: t('agents.allProjects'),
      icon: null,
      label: t('agents.allProjects'),
      selected: projectId === undefined,
      onSelect: () => {
        setProjectId(undefined);
        setSelected(new Set());
      },
    },
    ...projects.map((entry) => ({
      key: String(entry.id),
      search: `${entry.name} ${entry.key}`,
      icon: null,
      label: entry.name,
      trailing: <Text tone="faint">{entry.key}</Text>,
      selected: projectId === entry.id,
      onSelect: () => {
        setProjectId(entry.id);
        setSelected(new Set());
      },
    })),
  ];

  const selectedRows = matrix.agents.filter((row) => selected.has(row.id));
  const bulkFirst = selectedRows[0];
  const changedAgents = pendingAgentCount(pending);
  const schemaChanges =
    pendingCount(pending) -
    Object.values(pending.agents).reduce(
      (sum, entry) => sum + Object.keys(entry.values).length + (entry.role !== undefined ? 1 : 0),
      0,
    );

  return (
    <Sections>
      <MatrixHeader
        matrix={matrix}
        pending={pending}
        project={project ? { id: project.id, name: project.name } : null}
        labels={labels}
        onProfile={header.onProfile}
        onSchema={header.onSchema}
        onProjectSchema={header.onProjectSchema}
        onUndo={openUndo}
        undoSteps={matrix.undo.depth}
      />

      <Section
        title={t('agents.title')}
        description={t('agents.description')}
        actions={
          <PopoverPick
            trigger={
              <PillButton tone={project ? 'accent' : 'neutral'}>
                {project ? project.name : t('agents.allProjects')}
              </PillButton>
            }
            inputPlaceholder={t('search')}
            emptyText={t('noResults')}
            align="end"
            items={projectItems}
          />
        }
      >
        <Stack gap={3}>
          <Inline gap={4} wrap>
            <Inline gap={1}>
              <span className="ds-matrix-mark" data-kind="own" aria-hidden="true" />
              <Text size="xs" tone="faint">
                {t('legend.own')}
              </Text>
            </Inline>
            <Inline gap={1}>
              <span className="ds-matrix-mark" data-kind="changed" aria-hidden="true" />
              <Text size="xs" tone="faint">
                {t('legend.changed')}
              </Text>
            </Inline>
            <Text size="xs" tone="faint">
              {t('legend.inherited')}
            </Text>
          </Inline>

          {selectedRows.length > 0 && bulkFirst && (
            <div className="ds-matrix-selection" role="group" aria-label={t('bulk.title')}>
              <Text weight="medium">{t('bulk.selected', { count: selectedRows.length })}</Text>
              <Inline gap={1} wrap>
                {COLUMN_ORDER.map((column) => {
                  const values = selectedRows.map((row) =>
                    effectiveCell(matrix, row, column, pending),
                  );
                  const first = values[0]!;
                  const runtimes = new Set(
                    selectedRows.map((row) => effectiveCell(matrix, row, 'runtime', pending).value),
                  );
                  const ids = selectedRows.map((row) => row.id);
                  return (
                    <ColumnCell
                      key={column}
                      column={column}
                      value={first.value}
                      source={first.source}
                      staged={false}
                      runtime={runtimes.size === 1 ? ([...runtimes][0] as MatrixRuntime) : null}
                      origin=""
                      bulk={{
                        count: selectedRows.length,
                        mixed: new Set(values.map((entry) => JSON.stringify(entry.value))).size > 1,
                      }}
                      models={models}
                      labels={labels}
                      onChange={(value) => stage(ids, column, value)}
                      onReset={() => reset(ids, column)}
                    />
                  );
                })}
              </Inline>
              <Button variant="ghost" size="small" onClick={() => setSelected(new Set())}>
                {t('bulk.clear')}
              </Button>
            </div>
          )}

          {matrix.agents.length === 0 ? (
            <EmptyState title={t('agents.emptyTitle')}>{t('agents.empty')}</EmptyState>
          ) : (
            <AgentMatrix
              matrix={matrix}
              agents={organization?.agents ?? []}
              pending={pending}
              selected={selected}
              models={models}
              labels={labels}
              onSelect={select}
              onCell={stage}
              onReset={reset}
              onRole={setRole}
            />
          )}

          {!isEmpty(pending) && (
            <MatrixBar>
              <Text>
                {t('bar.changes', { count: pendingCount(pending) })}
                {changedAgents > 0 ? ` · ${t('bar.agents', { count: changedAgents })}` : ''}
                {schemaChanges > 0 ? ` · ${t('bar.schema')}` : ''}
              </Text>
              <Inline gap={2}>
                <Button variant="ghost" onClick={() => setPending(EMPTY_PENDING)}>
                  {t('bar.discard')}
                </Button>
                <Button variant="primary" onClick={openApply}>
                  {t('bar.review')}
                </Button>
              </Inline>
            </MatrixBar>
          )}
        </Stack>
      </Section>

      <Section title={t('classes.title')} description={t('classes.description')}>
        <Stack gap={3}>
          <ClassMatrix classes={matrix.classes} labels={labels} />
        </Stack>
      </Section>

      {dialog && (
        <ChangePreviewDialog
          state={dialog.state}
          title={dialog.plan.kind === 'undo' ? t('undo.title') : t('preview.title')}
          note={
            dialog.plan.kind === 'undo'
              ? matrix.undo.steps.at(-1)?.agents === null
                ? t('undo.legacy')
                : t('undo.note', { depth: matrix.undo.depth })
              : undefined
          }
          labels={labels}
          names={agentNames}
          applying={apply.isPending}
          onApply={() => void applyPlan()}
          onReload={reload}
          onClose={() => setDialog(null)}
        />
      )}
    </Sections>
  );
}

function failure(error: unknown): PreviewState {
  if (
    error instanceof ApiError &&
    error.status === 409 &&
    /revision changed|changed during apply/i.test(error.message)
  )
    return { status: 'conflict' };
  return { status: 'error', message: error instanceof Error ? error.message : String(error) };
}

export type { ModelMatrix };
