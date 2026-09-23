'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import SectionPageView from '@/components/common/page/SectionPageView';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import type { Pipeline } from '@/lib/api/endpoints/pipelines';
import {
  usePipelineContext,
  usePipelineValidation,
  useUpdatePipeline,
  type PipelineScope,
} from '@/services/pipelines.service';
import { PipelineEditorProvider } from '../../context/pipelineEditor';
import { usePipelineDraft } from '../../hooks/usePipelineDraft';
import { splitIssues } from '../../utils/issueDisplay';
import PipelineBuilder from './PipelineBuilder';
import PipelineEditorActions from './PipelineEditorActions';
import PipelineEditorMeta from './PipelineEditorMeta';
import PipelineMetaFields from './PipelineMetaFields';
import PipelineRunsTab from './PipelineRunsTab';
import PipelineVersionsTab from './PipelineVersionsTab';

const TABS = ['build', 'runs', 'versions'] as const;

// The editor of one workflow. The draft is validated by the API a moment after every
// change; a draft with problems of its definition cannot be saved.
export default function PipelineEditor({
  pipeline,
  editable,
  projectRoles,
}: {
  pipeline: Pipeline;
  editable: boolean;
  projectRoles?: Record<string, number>;
}) {
  const t = useTranslations('pipelines.editor');
  const linkedTab = useSearchParams().get('tab');
  const [tab, setTab] = useState(
    TABS.find((value) => value === linkedTab) ?? ('build' as (typeof TABS)[number]),
  );
  const [selectedId, select] = useState<string | null>(null);
  const { draft, base, dirty, setDraft, reset } = usePipelineDraft(pipeline);
  const scope: PipelineScope = pipeline.projectKey
    ? { projectKey: pipeline.projectKey }
    : { teamId: pipeline.teamId, projectKey: null };
  const context = usePipelineContext(scope).data;
  const checked = useDebouncedValue(draft.definition, 400);
  const validation = usePipelineValidation(scope, checked, projectRoles);
  const issues = validation.data?.issues ?? [];
  const checking = checked !== draft.definition || validation.isFetching;
  const blocked = splitIssues(issues).blocking.length > 0 || !draft.name.trim();
  const update = useUpdatePipeline(pipeline.id);

  const save = () =>
    update.mutate(
      {
        name: draft.name.trim(),
        description: draft.description.trim(),
        definition: draft.definition,
        baseVersion: base.version,
      },
      {
        onSuccess: (saved) => {
          reset(saved);
          toast.success(t('saved', { name: saved.name }));
        },
      },
    );

  return (
    <SectionPageView
      title={draft.name || pipeline.name}
      description={<PipelineEditorMeta pipeline={pipeline} dirty={dirty} />}
      actions={
        <PipelineEditorActions
          pipeline={pipeline}
          editable={editable}
          dirty={dirty}
          blocked={blocked}
          busy={checking || update.isPending}
          onSave={save}
        />
      }
      wide
    >
      <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)} className="gap-4">
        <TabsList>
          {TABS.map((value) => (
            <TabsTrigger key={value} value={value}>
              {t(`tabs.${value}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="build">
          <PipelineEditorProvider
            value={{
              definition: draft.definition,
              template: pipeline.projectId === null,
              context,
              issues,
              editable,
              selectedId,
              select,
              change: (change) => setDraft((current) => ({ ...current, definition: change(current.definition) })),
            }}
          >
            <PipelineBuilder
              header={
                <PipelineMetaFields
                  draft={draft}
                  editable={editable}
                  onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
                />
              }
            />
          </PipelineEditorProvider>
        </TabsContent>
        <TabsContent value="runs">
          <PipelineRunsTab pipeline={pipeline} canEdit={editable} />
        </TabsContent>
        <TabsContent value="versions">
          <PipelineVersionsTab pipeline={pipeline} context={context} />
        </TabsContent>
      </Tabs>
    </SectionPageView>
  );
}
