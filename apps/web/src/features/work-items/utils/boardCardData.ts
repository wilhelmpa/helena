import type { BoardIssue, IssueFieldValueEntry } from '@/lib/api/endpoints/issues';
import type { ProjectDetail } from '@/lib/api/endpoints/projects';
import type { CustomField } from '@/lib/api/endpoints/customFields';
import type { Maps } from '@/utils/project';
import { formatDateTimeRange, formatDurationShort, formatShortDate } from '@/utils/dates';
import { formatMinutes } from '@/utils/estimate';
import { customFieldId, isCustomFieldKey, type PropertyKey } from '@/utils/viewSettings';

const numberFormat = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });

function shownValue(field: CustomField, entry: IssueFieldValueEntry, maps: Maps): string | null {
  if (field.fieldType === 'select' || field.fieldType === 'multi_select') {
    return (
      entry.optionIds
        .flatMap((id) => field.options.find((option) => option.id === id)?.value ?? [])
        .join(', ') || null
    );
  }
  const value = entry.value;
  if (value == null || value === '') return null;
  if (typeof value === 'number') return numberFormat.format(value);
  if (typeof value === 'boolean') return value ? 'Ja' : 'Nein';
  if (field.fieldType === 'date') return formatShortDate(value);
  if (field.fieldType === 'datetime' || field.fieldType === 'datetime_range') {
    return formatDateTimeRange(value, entry.valueEnd);
  }
  if (field.fieldType === 'member') return maps.assigneeById.get(value)?.name ?? value;
  return value.replace(/\s+/g, ' ').trim().slice(0, 80);
}

export function boardCardData(
  issue: BoardIssue,
  project: ProjectDetail,
  maps: Maps,
  properties: PropertyKey[],
  priorityLabel: (priority: string | null) => string,
  statusAgeLabel: string,
) {
  const fields = properties.flatMap((key) => {
    if (!isCustomFieldKey(key)) return [];
    const field = project.customFields.find((item) => item.id === customFieldId(key));
    const entry = issue.fieldValues.find((item) => item.fieldId === field?.id);
    if (!field || !entry) return [];
    const value = shownValue(field, entry, maps);
    return value ? [{ field, value }] : [];
  });
  const price = fields.find(({ field }) => field.name.toLocaleLowerCase('de') === 'preis');
  const firstNumber = properties.find((property) =>
    isCustomFieldKey(property)
      ? fields.some(
          ({ field }) => field.id === customFieldId(property) && field.fieldType === 'number',
        )
      : (property === 'estimatePoints' && issue.estimatePoints != null) ||
        (property === 'estimateTime' && issue.estimateMinutes != null),
  );
  const important =
    price ??
    (firstNumber && isCustomFieldKey(firstNumber)
      ? fields.find(({ field }) => field.id === customFieldId(firstNumber))
      : undefined);
  const builtinImportant =
    price || important || !firstNumber || isCustomFieldKey(firstNumber) ? null : firstNumber;
  const importantValue =
    important?.value ??
    (builtinImportant === 'estimatePoints'
      ? String(issue.estimatePoints)
      : builtinImportant === 'estimateTime'
        ? formatMinutes(issue.estimateMinutes!)
        : issue.dueDate
          ? formatShortDate(issue.dueDate)
          : null);
  const meta = properties.flatMap((property) => {
    if (isCustomFieldKey(property)) {
      const item = fields.find(({ field }) => field.id === customFieldId(property));
      return item && item !== important ? [`${item.field.name} ${item.value}`] : [];
    }
    switch (property) {
      case 'status':
        return [`Status ${maps.columnById.get(issue.columnId)?.name ?? ''}`];
      case 'priority':
        return issue.priority ? [`Priorität ${priorityLabel(issue.priority)}`] : [];
      case 'type': {
        const type = issue.typeId ? maps.typeById.get(issue.typeId) : null;
        return type ? [`Typ ${type.name}`] : [];
      }
      case 'initiative':
        return issue.initiative ? [`Ziel ${issue.initiative.title}`] : [];
      case 'cycle':
        return issue.cycle ? [`Zyklus ${issue.cycle.name}`] : [];
      case 'estimatePoints':
        return issue.estimatePoints != null && builtinImportant !== property
          ? [`Punkte ${issue.estimatePoints}`]
          : [];
      case 'estimateTime':
        return issue.estimateMinutes != null && builtinImportant !== property
          ? [`Aufwand ${formatMinutes(issue.estimateMinutes)}`]
          : [];
      case 'startDate':
        return issue.startDate ? [`Start ${formatShortDate(issue.startDate)}`] : [];
      case 'dueDate':
        return issue.dueDate && (important || builtinImportant)
          ? [`Fällig ${formatShortDate(issue.dueDate)}`]
          : [];
      case 'statusAge':
        return [`${statusAgeLabel} ${formatDurationShort(issue.statusSince)}`];
      default:
        return [];
    }
  });
  const labels = properties.includes('labels')
    ? issue.labelIds.flatMap((id) => maps.labelById.get(id) ?? [])
    : [];
  return { importantValue, meta, labels };
}
