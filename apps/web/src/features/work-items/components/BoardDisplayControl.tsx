import { useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { CustomField } from '@/lib/api/endpoints/customFields';
import type { IssueType } from '@/lib/api/endpoints/issueTypes';
import type { ViewSettings } from '@/utils/viewSettings';
import type { WorkItemsView } from '@/utils/viewTypes';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/design-system';
import { PAGE_CONTROL_ACTIVE_CLASS, PAGE_CONTROL_CLASS } from '@/components/layout/PageToolbar';
import DisplaySettingsBody from '@/components/layout/DisplaySettingsBody';

// A board's display settings (layout switcher plus the layout's options) as one
// control of the page's header row, next to the filter: the same 32px control as
// every other one in the row, "Anzeige" with its icon while there is room, the icon
// alone after that.
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
  const [open, setOpen] = useState(false);
  // An icon beside the layout switch: grouping, shown properties and the layout's own
  // options (the layout itself is the switch next to it).
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t('title')}
          title={t('title')}
          className={cn(
            PAGE_CONTROL_CLASS,
            open && PAGE_CONTROL_ACTIVE_CLASS,
            !showLabel && 'ds-icon-only',
          )}
        >
          <SlidersHorizontal aria-hidden="true" />
          {showLabel && <span>{t('title')}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="ds-display-popover">
        <DisplaySettingsBody
          view={view}
          onViewChange={onViewChange}
          settings={settings}
          onSettingsChange={onSettingsChange}
          customFields={customFields}
          issueTypes={issueTypes}
          showLayout={false}
        />
      </PopoverContent>
    </Popover>
  );
}
