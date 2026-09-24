'use client';

import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import SectionPageView from '@/components/common/page/SectionPageView';
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
import PipelineEditorActions, { type PipelineEditorTab } from './PipelineEditorActions';
import PipelineMetaFields from './PipelineMetaFields';
import PipelineRunsTab from './PipelineRunsTab';
import PipelineVersionsTab from './PipelineVersionsTab';

const TABS: PipelineEditorTab[] = ['build', 'runs', 'versions'];

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
  // The open view is in the address (?tab=runs), so a link to a workflow's runs and
  // the back button reach it.
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = TABS.find((value) => value === params.get('tab')) ?? 'build';
  const setTab = (next: PipelineEditorTab) => {
    const query = new URLSearchParams(params.toString());
    if (next === 'build') query.delete('tab');
    else query.set('tab', next);
    const search = query.toString();
    router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
  };
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
      wide
    >
      <PipelineEditorActions
        pipeline={pipeline}
        editable={editable}
        dirty={dirty}
        blocked={blocked}
        busy={checking || update.isPending}
        tab={tab}
        onTab={setTab}
        onSave={save}
      />
      {tab === 'build' ? (
        <PipelineEditorProvider
          value={{
            definition: draft.definition,
            template: pipeline.projectId === null,
            context,
            issues,
            editable,
            selectedId,
            select,
            change: (change) =>
              setDraft((current) => ({ ...current, definition: change(current.definition) })),
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
      ) : tab === 'runs' ? (
        <PipelineRunsTab pipeline={pipeline} canEdit={editable} />
      ) : (
        <PipelineVersionsTab pipeline={pipeline} context={context} />
      )}
    </SectionPageView>
  );
}
