'use client';

import { RotateCcw } from 'lucide-react';
import {
  Button,
  ButtonLink,
  Inline,
  Notice,
  PillButton,
  PopoverPick,
  Segmented,
  SettingsGroup,
  SettingsRow,
  type PickItem,
} from '@/design-system';
import type { ModelMatrix } from '@/lib/api/endpoints/modelMatrix';
import { helenaSettingsPath } from '@/features/settings/settingsModalCatalog';
import type { MatrixLabels } from '../utils/labels';
import { targetSchemaId, type Pending } from '../utils/pending';

const BUILT_IN = ['nur-lokal', 'gemischt', 'nur-codex', 'nur-claude'];

// The head of the page: which local profile and which schema the agents work under, and the
// state of the switch between profiles. A choice here is staged like every other change.
export function MatrixHeader({
  matrix,
  pending,
  project,
  labels,
  onProfile,
  onSchema,
  onProjectSchema,
  onUndo,
  canUndo,
}: {
  matrix: ModelMatrix;
  pending: Pending;
  // The project the matrix is filtered to, if any.
  project: { id: number; name: string } | null;
  labels: MatrixLabels;
  onProfile: (id: string) => void;
  onSchema: (id: string) => void;
  onProjectSchema: (schemaId: string | null) => void;
  onUndo: () => void;
  canUndo: boolean;
}) {
  const { t } = labels;
  const schemaId = targetSchemaId(matrix, pending);
  const schema = matrix.schemas[schemaId];
  const profileId = pending.profile ?? schema?.profile;
  const schemas = Object.values(matrix.schemas).sort((a, b) => {
    const ia = BUILT_IN.indexOf(a.id);
    const ib = BUILT_IN.indexOf(b.id);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.name.localeCompare(b.name);
  });
  const operation = matrix.local.maintenance?.operation ?? null;
  const projectSchema = project
    ? (pending.projects[project.id] ?? matrix.projects[String(project.id)] ?? null)
    : null;
  const projectItems: PickItem[] = project
    ? [
        {
          key: 'inherit',
          search: t('header.inherit'),
          icon: null,
          label: t('header.inherit'),
          selected: projectSchema === null,
          onSelect: () => onProjectSchema(null),
        },
        ...schemas.map((entry) => ({
          key: entry.id,
          search: entry.name,
          icon: null,
          label: entry.name,
          selected: projectSchema === entry.id,
          onSelect: () => onProjectSchema(entry.id),
        })),
      ]
    : [];
  const schemaDescription = (id: string) =>
    BUILT_IN.includes(id) ? t(`schemas.${id}` as never) : (matrix.schemas[id]?.description ?? '');
  return (
    <SettingsGroup title={t('header.title')} description={t('header.description')}>
      <SettingsRow
        label={t('header.profile')}
        description={profileId ? t(`profiles.${profileId}` as never) : undefined}
      >
        <Segmented
          label={t('header.profile')}
          value={profileId ?? ''}
          options={matrix.profiles.map((entry) => ({ value: entry.id, label: entry.name }))}
          onChange={onProfile}
        />
      </SettingsRow>
      <SettingsRow
        label={t('header.status')}
        description={
          operation
            ? operation.error
              ? undefined
              : t('header.switching')
            : t('header.ready', {
                model: matrix.local.model ? labels.model(matrix.local.model) : t('header.noModel'),
              })
        }
      >
        <Inline gap={2}>
          <ButtonLink href={helenaSettingsPath('local-ai')} variant="ghost" size="small">
            {t('header.switchDevices')}
          </ButtonLink>
        </Inline>
      </SettingsRow>
      {operation?.error && (
        <Notice tone="danger" title={t('header.switchFailed')}>
          {t('header.switchFailedText')}
        </Notice>
      )}
      <SettingsRow
        label={t('header.schema')}
        description={schemaDescription(schemaId)}
        stacked={schemas.length > 4}
      >
        <Inline gap={2} wrap>
          <Segmented
            label={t('header.schema')}
            value={schemaId}
            options={schemas.map((entry) => ({ value: entry.id, label: entry.name }))}
            onChange={onSchema}
          />
          <Button
            variant="ghost"
            size="small"
            icon={<RotateCcw size={14} />}
            disabled={!canUndo}
            onClick={onUndo}
          >
            {t('undo.button')}
          </Button>
        </Inline>
      </SettingsRow>
      {project && (
        <SettingsRow
          label={t('header.projectSchema', { project: project.name })}
          description={projectSchema === null ? t('header.projectInherits') : undefined}
        >
          <PopoverPick
            trigger={
              <PillButton tone={projectSchema ? 'accent' : 'neutral'}>
                {projectSchema
                  ? (matrix.schemas[projectSchema]?.name ?? projectSchema)
                  : t('header.inherit')}
              </PillButton>
            }
            inputPlaceholder={t('search')}
            search={false}
            align="end"
            items={projectItems}
          />
        </SettingsRow>
      )}
    </SettingsGroup>
  );
}
