'use client';

import { useState } from 'react';
import { ChevronRight, FileText, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  Button,
  IconButton,
  Inline,
  LimitMeter,
  SettingsGroup,
  SettingsRow,
  Stack,
  Text,
  TextField,
} from '@/design-system';
import MarkdownField from '@/components/helena/MarkdownField';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import type { SizeLimit, SizeLimits } from '@/features/agent-runtime/utils/sizeLimits';
import { useAiAgentsQuery, useResetAiAgentToTemplate } from '@/services/aiAgents.service';
import { useAgentCan, useAgentSection } from '../../context/agentSection';
import type { AgentFormValue } from '../../utils/agentForm';
import {
  extraFiles,
  instructionLabel,
  instructionPath,
  soulOf,
  withSoul,
} from '../../utils/instructionFiles';

// What an agent is told, in the order the model reads it: its identity (SOUL), its own
// instructions, further instruction files, and — read-only here — what it takes over from its
// template and from the projects it works in. Everything is Markdown, edited in the editor of
// Wissen, with the limit of each part beside it. Saved with the agent.
export default function AgentInstructionsBody({
  agent,
  value,
  onChange,
  limits,
}: {
  agent: AiAgent | null;
  value: AgentFormValue;
  onChange: (patch: Partial<AgentFormValue>) => void;
  limits: SizeLimits;
}) {
  const t = useTranslations('agentPages.instructions');
  const canEdit = useAgentCan()('edit');
  const files = value.runtimePolicy.files;
  const setFiles = (next: typeof files) =>
    onChange({ runtimePolicy: { ...value.runtimePolicy, files: next } });

  return (
    <>
      <Inherited agent={agent} limit={limits.projectInstructions} />

      <SettingsGroup title={t('soul.title')} description={t('soul.hint')}>
        <div className="ds-settings-row is-stacked">
          <MarkdownField
            value={soulOf(files)}
            onChange={(content) => setFiles(withSoul(files, content))}
            label={t('soul.title')}
            placeholder={t('soul.placeholder')}
            editable={canEdit}
          />
          <LimitMeter
            used={soulOf(files).length}
            limit={limits.soul?.limit}
            truncated={limits.soul?.truncated}
          />
        </div>
      </SettingsGroup>

      <SettingsGroup title={t('own.title')} description={t('own.hint')}>
        <div className="ds-settings-row is-stacked">
          <MarkdownField
            value={value.instructions}
            onChange={(instructions) => onChange({ instructions })}
            label={t('own.title')}
            placeholder={t('own.placeholder')}
            editable={canEdit}
          />
          <LimitMeter
            used={value.instructions.length}
            limit={limits.agentInstructions?.limit}
            truncated={limits.agentInstructions?.truncated}
          />
        </div>
      </SettingsGroup>

      <ExtraFiles
        files={extraFiles(files)}
        canEdit={canEdit}
        onChange={(next) => setFiles([...soulFile(files), ...next])}
      />
    </>
  );
}

const soulFile = (files: AgentFormValue['runtimePolicy']['files']) =>
  files.filter((file) => file.path === 'SOUL.md');

// The instruction files besides SOUL: one row each, opening into its editor.
function ExtraFiles({
  files,
  canEdit,
  onChange,
}: {
  files: AgentFormValue['runtimePolicy']['files'];
  canEdit: boolean;
  onChange: (files: AgentFormValue['runtimePolicy']['files']) => void;
}) {
  const t = useTranslations('agentPages.instructions.files');
  const [open, setOpen] = useState<string | null>(null);
  const [name, setName] = useState('');
  const path = instructionPath(name);
  const taken = path != null && files.some((file) => file.path === path);

  return (
    <SettingsGroup title={t('title')} description={t('hint')}>
      {files.length === 0 && <SettingsRow label={<Text tone="muted">{t('none')}</Text>} />}
      {files.map((file) => {
        const isOpen = open === file.path;
        return (
          <div key={file.path} className="ds-settings-row is-stacked">
            <Inline gap={2} justify="between">
              <button
                type="button"
                className="ds-file-row-toggle"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : file.path)}
              >
                <ChevronRight aria-hidden="true" data-open={isOpen ? '' : undefined} />
                <FileText aria-hidden="true" />
                <Text mono>{instructionLabel(file.path)}</Text>
              </button>
              {canEdit && (
                <IconButton
                  label={t('remove', { name: instructionLabel(file.path) })}
                  size="small"
                  onClick={() => onChange(files.filter((entry) => entry.path !== file.path))}
                >
                  <Trash2 />
                </IconButton>
              )}
            </Inline>
            {isOpen && (
              <MarkdownField
                value={file.content}
                onChange={(content) =>
                  onChange(
                    files.map((entry) =>
                      entry.path === file.path ? { ...entry, content } : entry,
                    ),
                  )
                }
                label={instructionLabel(file.path)}
                editable={canEdit}
              />
            )}
          </div>
        );
      })}
      {canEdit && (
        <div className="ds-settings-row">
          <Inline gap={2} grow>
            <TextField
              value={name}
              dir="ltr"
              placeholder={t('namePlaceholder')}
              aria-label={t('name')}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && path && !taken) {
                  event.preventDefault();
                  onChange([...files, { kind: 'instructions', path, content: '' }]);
                  setOpen(path);
                  setName('');
                }
              }}
            />
            <Button
              icon={<Plus />}
              disabled={!path || taken}
              onClick={() => {
                if (!path) return;
                onChange([...files, { kind: 'instructions', path, content: '' }]);
                setOpen(path);
                setName('');
              }}
            >
              {t('add')}
            </Button>
          </Inline>
        </div>
      )}
      {name.trim() && !path && (
        <Text size="xs" tone="danger">
          {t('invalid')}
        </Text>
      )}
      {taken && (
        <Text size="xs" tone="danger">
          {t('taken')}
        </Text>
      )}
    </SettingsGroup>
  );
}

// "Erbt von": the template a copy follows and the instructions the projects give the agent.
function Inherited({ agent, limit }: { agent: AiAgent | null; limit?: SizeLimit }) {
  const t = useTranslations('agentPages.instructions.inherited');
  const { teamId } = useAgentSection();
  const canEdit = useAgentCan()('edit');
  const templates = useAiAgentsQuery(agent?.sourceTemplateId != null ? teamId : null).data;
  const reset = useResetAiAgentToTemplate(teamId);
  if (!agent) return null;
  const template =
    agent.sourceTemplateId != null
      ? templates?.find((entry) => entry.id === agent.sourceTemplateId)
      : null;
  const projects = agent.projects.filter((project) => project.instructions.trim());
  if (agent.sourceTemplateId == null && projects.length === 0) return null;
  const differs = agent.templateOverrides.includes('instructions');

  return (
    <SettingsGroup title={t('title')} description={t('hint')}>
      {agent.sourceTemplateId != null && (
        <SettingsRow
          label={template ? t('template', { name: template.name }) : t('templateUnknown')}
          description={differs ? t('differs') : t('follows')}
        >
          {differs && canEdit && (
            <Button
              size="small"
              disabled={reset.isPending}
              onClick={() => reset.mutate({ id: agent.id, group: 'instructions' })}
            >
              {t('reset')}
            </Button>
          )}
        </SettingsRow>
      )}
      {projects.map((project) => (
        <div key={project.id} className="ds-settings-row is-stacked">
          <Stack gap={1}>
            <Text weight="medium">{t('project', { key: project.key, name: project.name })}</Text>
            <p className="ds-inherited-text" dir="auto">
              {project.instructions}
            </p>
          </Stack>
        </div>
      ))}
      {limit && projects.length > 0 && (
        <div className="ds-settings-row is-stacked">
          <LimitMeter used={limit.used} limit={limit.limit} truncated={limit.truncated} />
        </div>
      )}
    </SettingsGroup>
  );
}
