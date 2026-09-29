import { useState } from 'react';
import { ListChecks } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import {
  Button,
  Inline,
  MonoLabel,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Stack,
  Text,
  usePageToolbarRoom,
} from '@/design-system';
import { PAGE_CONTROL_ACTIVE_CLASS, PAGE_CONTROL_CLASS } from '@/components/layout/PageToolbar';
import PropertyChip from '@/components/layout/PropertyChip';
import TableProperties from '@/components/layout/TableProperties';
import CustomFieldMenu from '@/components/layout/CustomFieldMenu';
import { cn } from '@/lib/utils';
import { byKey } from '@/utils/messageKey';
import type { CustomField } from '@/lib/api/endpoints/customFields';
import type { FieldDefaults } from '@/lib/api/endpoints/displayDefaults';
import type { IssueType } from '@/lib/api/endpoints/issueTypes';
import type { ProjectDetail } from '@/lib/api/endpoints/projects';
import { usePermissions } from '@/hooks/usePermissions';
import { useProjectFeatures } from '@/hooks/useProjectFeatures';
import {
  effectiveFieldDefaults,
  useDisplayDefaultsQuery,
  useSaveDisplayDefaults,
} from '@/services/displayDefaults.service';
import {
  customFieldKey,
  defaultViewSettings,
  fieldChoices,
  isCustomFieldKey,
  type PropertyKey,
  type ViewSettings,
} from '@/utils/viewSettings';
import type { WorkItemsView } from '@/utils/viewTypes';
import FieldsPreview from './FieldsPreview';

const LAYOUTS_WITH_FIELDS: WorkItemsView[] = ['kanban', 'list', 'table', 'calendar'];

// "Felder" (owner, 29.09.: "auf Projektebene oder direkt in der Ansicht, welche Felder man in
// den Karten und der Liste anzeigen will"): one control in the toolbar of every task view that
// has details to choose — the board, the list, the table, the calendar. The chips are the
// fields, the preview is the card or the columns as they will look, and the two saves make the
// choice the default: of the project (a project admin) or of the member for all projects. A
// view nobody changed starts from those defaults; a saved view keeps what it stored.
export default function FieldsControl({
  view,
  project,
  settings,
  onSettingsChange,
  customFields,
  issueTypes,
  // A saved view shows its own "changed · reset" in the page row.
  savedView = false,
}: {
  view: WorkItemsView;
  project: ProjectDetail;
  settings: ViewSettings;
  onSettingsChange: (settings: ViewSettings) => void;
  customFields: CustomField[];
  issueTypes: IssueType[];
  savedView?: boolean;
}) {
  const t = useTranslations('workItems.fields');
  const tDisplay = useTranslations('display');
  const property = byKey(useTranslations('display.properties'));
  const [open, setOpen] = useState(false);
  // The name shows while the toolbar has room, the icon alone after that.
  const room = usePageToolbarRoom();
  const features = useProjectFeatures();
  const { isAdmin } = usePermissions();
  const projectKey = project.project.key;
  const stored = useDisplayDefaultsQuery(projectKey).data;
  const { defaults, source } = effectiveFieldDefaults(stored);
  const save = useSaveDisplayDefaults(projectKey);

  if (!LAYOUTS_WITH_FIELDS.includes(view)) return null;
  const layout = view as keyof FieldDefaults;
  const choices = fieldChoices(view, features);
  const inForce = defaultViewSettings(view, defaults).properties;
  const differs = JSON.stringify(inForce) !== JSON.stringify(settings.properties);

  const setProperties = (properties: PropertyKey[]) =>
    onSettingsChange({ ...settings, properties });
  const toggle = (key: PropertyKey) =>
    setProperties(
      settings.properties.includes(key)
        ? settings.properties.filter((p) => p !== key)
        : [...settings.properties, key],
    );

  const subtasksChip =
    features.subtasks && (view === 'kanban' || view === 'table') ? (
      <PropertyChip
        label={tDisplay('rows.nestedSubtasks')}
        on={settings.showSubtasks}
        onClick={() => onSettingsChange({ ...settings, showSubtasks: !settings.showSubtasks })}
      />
    ) : null;

  const saveDefault = (scope: 'project' | 'global') => {
    const mutation = scope === 'project' ? save.saveProject : save.saveGlobal;
    const current = (scope === 'project' ? stored?.project : stored?.global) ?? {};
    // A custom field is of one project: the member's default for all projects keeps the
    // built-in fields only.
    const keys =
      scope === 'global'
        ? settings.properties.filter((p) => !isCustomFieldKey(p))
        : settings.properties;
    mutation.mutate(
      { ...current, [layout]: keys },
      { onSuccess: () => toast.success(t(scope === 'project' ? 'savedProject' : 'savedGlobal')) },
    );
  };
  const removeProjectDefault = () => {
    const rest = { ...(stored?.project ?? {}) };
    delete rest[layout];
    save.saveProject.mutate(Object.keys(rest).length ? rest : null, {
      onSuccess: () => toast.success(t('removedProject')),
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t('button')}
          title={t('button')}
          className={cn(
            PAGE_CONTROL_CLASS,
            (open || differs) && PAGE_CONTROL_ACTIVE_CLASS,
            !room.actions && 'ds-icon-only',
          )}
        >
          <ListChecks aria-hidden="true" />
          {room.actions && <span>{t('button')}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="ds-fields-popover">
        <Stack gap={3}>
          <Stack gap={1}>
            <Inline justify="between">
              <MonoLabel>{t('heading')}</MonoLabel>
              <Text size="xs" tone="muted">
                {t(`source.${source(layout)}`)}
              </Text>
            </Inline>
            <Text size="sm" tone="muted">
              {t('hint')}
            </Text>
          </Stack>

          <FieldsPreview view={view} project={project} properties={settings.properties} />

          <Inline gap={1} wrap>
            {view === 'table' ? (
              <TableProperties
                properties={settings.properties}
                customFields={customFields}
                issueTypes={issueTypes}
                onChange={setProperties}
                trailing={subtasksChip}
              />
            ) : (
              <>
                {choices.map((key) => (
                  <PropertyChip
                    key={key}
                    label={property(key)}
                    on={settings.properties.includes(key)}
                    onClick={() => toggle(key)}
                  />
                ))}
                {view === 'kanban' &&
                  customFields
                    .filter((field) => settings.properties.includes(customFieldKey(field.id)))
                    .map((field) => (
                      <PropertyChip
                        key={field.id}
                        label={field.name}
                        on
                        onClick={() => toggle(customFieldKey(field.id))}
                      />
                    ))}
                {subtasksChip}
                {view === 'kanban' && (
                  <CustomFieldMenu
                    customFields={customFields}
                    issueTypes={issueTypes}
                    selected={new Set(settings.properties)}
                    onToggle={toggle}
                  />
                )}
              </>
            )}
          </Inline>
          {view === 'list' && (
            <Text size="xs" tone="muted">
              {t('listFixed')}
            </Text>
          )}
          {view === 'calendar' && (
            <Text size="xs" tone="muted">
              {t('calendarHint')}
            </Text>
          )}

          <Stack gap={2} className="ds-fields-actions">
            {differs && !savedView && (
              <Inline justify="between">
                <Text size="xs" tone="muted">
                  {t('differs')}
                </Text>
                <Button variant="ghost" size="small" onClick={() => setProperties(inForce)}>
                  {t('reset')}
                </Button>
              </Inline>
            )}
            <Inline gap={2} wrap>
              {isAdmin && (
                <Button
                  size="small"
                  disabled={save.saveProject.isPending}
                  onClick={() => saveDefault('project')}
                >
                  {t('saveProject')}
                </Button>
              )}
              <Button
                size="small"
                disabled={save.saveGlobal.isPending}
                onClick={() => saveDefault('global')}
              >
                {t('saveGlobal')}
              </Button>
              {isAdmin && source(layout) === 'project' && (
                <Button
                  variant="ghost"
                  size="small"
                  disabled={save.saveProject.isPending}
                  onClick={removeProjectDefault}
                >
                  {t('removeProject')}
                </Button>
              )}
            </Inline>
          </Stack>
        </Stack>
      </PopoverContent>
    </Popover>
  );
}
