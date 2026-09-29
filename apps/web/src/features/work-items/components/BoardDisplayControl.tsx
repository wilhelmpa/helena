import { SlidersHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { CustomField } from '@/lib/api/endpoints/customFields';
import type { IssueType } from '@/lib/api/endpoints/issueTypes';
import type { ViewSettings } from '@/utils/viewSettings';
import type { WorkItemsView } from '@/utils/viewTypes';
import { ToolbarPopover } from '@/design-system';
import DisplaySettingsBody from '@/components/layout/DisplaySettingsBody';

// A board's display settings (layout switcher plus the layout's options) as one
// control of the page's header row, next to the filter: the same 32px control as
// every other one in the row, the icon alone (the layout itself is the switch next to it).
export default function BoardDisplayControl({
  view,
  onViewChange,
  settings,
  onSettingsChange,
  customFields,
  issueTypes,
  showLabel = false,
}: {
  view: WorkItemsView;
  onViewChange: (view: WorkItemsView) => void;
  settings: ViewSettings;
  onSettingsChange: (settings: ViewSettings) => void;
  customFields: CustomField[];
  issueTypes: IssueType[];
  // In a form (the view overlay) the trigger names itself instead of being an icon.
  showLabel?: boolean;
}) {
  const t = useTranslations('display');
  return (
    <ToolbarPopover
      icon={SlidersHorizontal}
      label={t('title')}
      labelWhen={showLabel ? 'always' : 'never'}
      contentClassName="ds-display-popover"
    >
      <DisplaySettingsBody
        view={view}
        onViewChange={onViewChange}
        settings={settings}
        onSettingsChange={onSettingsChange}
        customFields={customFields}
        issueTypes={issueTypes}
        showLayout={false}
        // On the page the fields are the "Felder" control next to this one; the form of a
        // saved view (which names itself) holds them, since it has no such control.
        showFields={showLabel}
      />
    </ToolbarPopover>
  );
}
