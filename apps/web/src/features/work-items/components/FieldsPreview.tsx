import { useTranslations } from 'next-intl';
import { Text } from '@/design-system';
import type { BoardIssue } from '@/lib/api/endpoints/issues';
import type { ProjectDetail } from '@/lib/api/endpoints/projects';
import { buildMaps } from '@/utils/project';
import { isCustomFieldKey, type PropertyKey } from '@/utils/viewSettings';
import type { WorkItemsView } from '@/utils/viewTypes';
import { byKey } from '@/utils/messageKey';
import { IssueCardBody } from './kanban/IssueCardBody';

// How many of the chosen properties a task has a value for: the sample is the task that
// shows the most of them, so the preview says something about the choice.
function filled(issue: BoardIssue, properties: PropertyKey[]): number {
  return properties.filter((property) => {
    if (isCustomFieldKey(property))
      return issue.fieldValues.some((v) => `cf:${v.fieldId}` === property);
    switch (property) {
      case 'priority':
        return issue.priority != null;
      case 'type':
        return issue.typeId != null;
      case 'assignee':
        return issue.assigneeUserId != null;
      case 'delegate':
        return issue.delegateUserId != null;
      case 'goal':
        return issue.goal != null;
      case 'cycle':
        return issue.cycle != null;
      case 'labels':
        return issue.labelIds.length > 0;
      case 'estimatePoints':
        return issue.estimatePoints != null;
      case 'estimateTime':
        return issue.estimateMinutes != null;
      case 'startDate':
        return issue.startDate != null;
      case 'dueDate':
        return issue.dueDate != null;
      default:
        return true;
    }
  }).length;
}

// What a task will look like with the chosen fields, before they are applied: a card for the
// board (the very card the board draws), the names of the columns for the list and the table,
// the chip of a day for the calendar. Read-only, taken from a real task of the project.
export default function FieldsPreview({
  view,
  project,
  properties,
}: {
  view: WorkItemsView;
  project: ProjectDetail;
  properties: PropertyKey[];
}) {
  const t = useTranslations('workItems.fields');
  const property = byKey(useTranslations('display.properties'));
  const sample = [...project.issues]
    .filter((issue) => issue.parentId == null)
    .sort((a, b) => filled(b, properties) - filled(a, properties))[0];

  if (view === 'table' || view === 'list') {
    return (
      <div className="ds-fields-preview" data-kind="columns" aria-label={t('preview')}>
        <span className="ds-fields-preview-col is-title">{t('title')}</span>
        {properties.map((key) => (
          <span key={key} className="ds-fields-preview-col">
            {isCustomFieldKey(key)
              ? (project.customFields.find((field) => `cf:${field.id}` === key)?.name ?? '')
              : property(key)}
          </span>
        ))}
      </div>
    );
  }
  if (!sample) {
    return (
      <div className="ds-fields-preview" data-kind="empty">
        <Text tone="muted">{t('previewEmpty')}</Text>
      </div>
    );
  }
  return (
    <div className="ds-fields-preview" data-kind={view} aria-label={t('preview')}>
      <div className="kanban-card board-card ds-fields-preview-card" aria-hidden="true">
        <IssueCardBody
          issue={sample}
          project={project}
          maps={buildMaps(project)}
          properties={properties}
          readOnly
        />
      </div>
    </div>
  );
}
