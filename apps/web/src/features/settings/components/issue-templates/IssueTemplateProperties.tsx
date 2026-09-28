import { useTranslations } from 'next-intl';
import type { ProjectDetail } from '@/lib/api/endpoints/projects';
import AssigneeSelect from '@/components/common/fields/AssigneeSelect';
import LabelsSelect from '@/components/common/fields/LabelsSelect';
import PrioritySelect from '@/components/common/fields/PrioritySelect';
import StatusSelect from '@/components/common/fields/StatusSelect';
import TypeSelect from '@/components/common/fields/TypeSelect';
import type { IssueTemplateFormValues } from '../../utils/issueTemplateForm';

import { Stack, Text, Inline } from '@/design-system';

// The properties a template presets, as the same pills the create dialog shows.
// One left unset presets nothing, and the create dialog keeps its own default for
// it — which is why every pill can be cleared.
export default function IssueTemplateProperties({
  project,
  values,
  onChange,
}: {
  project: ProjectDetail;
  values: IssueTemplateFormValues;
  onChange: (patch: Partial<IssueTemplateFormValues>) => void;
}) {
  const t = useTranslations('settings.issueTemplates');
  const tFields = useTranslations('issue.fields');
  return (
    <Stack gap={2}>
      <Text as="p" size="sm">
        {t('properties')}
      </Text>
      <Text as="p" size="xs" tone="muted">
        {t('propertiesHint')}
      </Text>
      <Inline gap={2} wrap padTop={2} className="flex flex-wrap items-center">
        <StatusSelect
          columns={project.columns}
          value={values.columnId}
          onChange={(columnId) => onChange({ columnId })}
          onClear={() => onChange({ columnId: null })}
        />

        {project.issueTypes.length > 0 && (
          <TypeSelect
            issueTypes={project.issueTypes}
            value={values.typeId}
            onChange={(typeId) => onChange({ typeId })}
          />
        )}

        {project.assignees.some((a) => a.kind === 'member') && (
          <AssigneeSelect
            assignees={project.assignees}
            value={values.assigneeUserId}
            onChange={(assigneeUserId) => onChange({ assigneeUserId })}
            placeholder={tFields('assignee')}
          />
        )}

        <PrioritySelect value={values.priority} onChange={(priority) => onChange({ priority })} />

        {project.labels.length > 0 && (
          <LabelsSelect
            labels={project.labels}
            groups={project.labelGroups}
            value={values.labelIds}
            onToggle={(id) =>
              onChange({
                labelIds: values.labelIds.includes(id)
                  ? values.labelIds.filter((x) => x !== id)
                  : [...values.labelIds, id],
              })
            }
          />
        )}
      </Inline>
    </Stack>
  );
}
