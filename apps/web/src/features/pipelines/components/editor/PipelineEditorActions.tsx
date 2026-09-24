'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, FlaskConical, History, ListChecks, Save, Workflow } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import {
  PAGE_CONTROL_CLASS,
  PageActions,
  PageTabs,
  PageToolbar,
  PageToolbarSpacer,
  usePageToolbarRoom,
  type PageAction,
} from '@/components/layout/PageToolbar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Pipeline } from '@/lib/api/endpoints/pipelines';
import { pipelinesPath, workflowsPath } from '@/utils/paths';
import PipelineRunsFilter from './PipelineRunsFilter';
import PipelineTestRunDialog from './PipelineTestRunDialog';

export type PipelineEditorTab = 'build' | 'runs' | 'versions';

// The editor's header row: back to the workflows, the views (Aufbau, Läufe,
// Versionen), what is being edited (template or project workflow, version, unsaved),
// the test run and Save, the page's one primary action. A test run runs the saved
// version, so it waits for a save; a draft with problems of its definition cannot be
// saved, and the row says why.
export default function PipelineEditorActions({
  pipeline,
  editable,
  dirty,
  blocked,
  busy,
  tab,
  onTab,
  onSave,
}: {
  pipeline: Pipeline;
  editable: boolean;
  dirty: boolean;
  blocked: boolean;
  busy: boolean;
  tab: PipelineEditorTab;
  onTab: (tab: PipelineEditorTab) => void;
  onSave: () => void;
}) {
  const t = useTranslations('pipelines');
  const [testing, setTesting] = useState(false);
  const back = pipeline.projectKey ? workflowsPath(pipeline.projectKey) : pipelinesPath();

  const actions: PageAction[] = editable
    ? [
        {
          id: 'test',
          label: dirty ? t('testRun.saveFirst') : t('testRun.button'),
          icon: FlaskConical,
          disabled: dirty,
          onClick: () => setTesting(true),
        },
      ]
    : [];

  return (
    <>
      <PageToolbar>
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              href={back}
              aria-label={t('editor.back')}
              className={cn(PAGE_CONTROL_CLASS, 'w-8 justify-center px-0')}
            >
              <ArrowLeft aria-hidden="true" />
            </Link>
          </TooltipTrigger>
          <TooltipContent>{t('editor.back')}</TooltipContent>
        </Tooltip>
        <PageTabs
          label={t('editor.name')}
          value={tab}
          onChange={onTab}
          items={[
            { value: 'build', label: t('editor.tabs.build'), icon: Workflow },
            { value: 'runs', label: t('editor.tabs.runs'), icon: ListChecks },
            { value: 'versions', label: t('editor.tabs.versions'), icon: History },
          ]}
        />
        <PageToolbarSpacer />
        {tab === 'runs' ? <PipelineRunsFilter pipeline={pipeline} /> : null}
        <EditorState pipeline={pipeline} dirty={dirty} blocked={dirty && blocked} />
        <PageActions
          actions={actions}
          primary={
            editable
              ? {
                  id: 'save',
                  label: t('editor.save'),
                  icon: Save,
                  disabled: !dirty || blocked || busy,
                  onClick: onSave,
                }
              : undefined
          }
        />
      </PageToolbar>
      {testing && <PipelineTestRunDialog pipeline={pipeline} onClose={() => setTesting(false)} />}
    </>
  );
}

// "Vorlage · Version 3", or what keeps the draft from being saved. Left out when the
// row runs short of room, except the unsaved state, which then shows as a dot.
function EditorState({
  pipeline,
  dirty,
  blocked,
}: {
  pipeline: Pipeline;
  dirty: boolean;
  blocked: boolean;
}) {
  const t = useTranslations('pipelines.editor');
  const room = usePageToolbarRoom();
  if (!room.actions) {
    return dirty ? (
      <span
        role="status"
        aria-label={t('unsaved')}
        className={cn(
          'mx-1 size-2 shrink-0 rounded-full',
          blocked ? 'bg-status-danger' : 'bg-status-waiting',
        )}
      />
    ) : null;
  }
  return (
    <span
      role="status"
      className={cn(
        'me-1 shrink-0 truncate text-xs',
        blocked ? 'text-status-danger' : dirty ? 'text-foreground' : 'text-muted-foreground',
      )}
    >
      {blocked
        ? t('blocked')
        : dirty
          ? t('unsaved')
          : `${pipeline.projectId === null ? t('template') : t('projectWorkflow')} · ${t('version', { version: pipeline.version })}`}
    </span>
  );
}
