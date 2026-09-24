import { useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { CustomField } from '@/lib/api/endpoints/customFields';
import type { IssueType } from '@/lib/api/endpoints/issueTypes';
import type { ViewSettings } from '@/utils/viewSettings';
import type { WorkItemsView } from '@/utils/viewTypes';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  PAGE_CONTROL_ACTIVE_CLASS,
  PAGE_CONTROL_CLASS,
  usePageToolbarRoom,
} from '@/components/layout/PageToolbar';
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
}: {
  view: WorkItemsView;
  onViewChange: (view: WorkItemsView) => void;
  settings: ViewSettings;
  onSettingsChange: (settings: ViewSettings) => void;
  customFields: CustomField[];
  issueTypes: IssueType[];
}) {
  const t = useTranslations('display');
  const room = usePageToolbarRoom();
  const [open, setOpen] = useState(false);
  const trigger = (
    <button
      type="button"
      aria-label={t('title')}
      className={cn(
        PAGE_CONTROL_CLASS,
        open && PAGE_CONTROL_ACTIVE_CLASS,
        !room.actions && 'w-8 justify-center px-0',
      )}
    >
      <SlidersHorizontal aria-hidden="true" />
      {room.actions ? <span>{t('title')}</span> : null}
    </button>
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      {room.actions ? (
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>{trigger}</PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>{t('title')}</TooltipContent>
        </Tooltip>
      )}
      <PopoverContent align="end" className="max-h-[70vh] w-80 overflow-y-auto p-3">
        <DisplaySettingsBody
          view={view}
          onViewChange={onViewChange}
          settings={settings}
          onSettingsChange={onSettingsChange}
          customFields={customFields}
          issueTypes={issueTypes}
        />
      </PopoverContent>
    </Popover>
  );
}
