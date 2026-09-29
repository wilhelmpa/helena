import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Issue } from '@/lib/api/endpoints/issues';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Maps } from '@/utils/project';
import type { PropertyKey } from '@/utils/viewSettings';
import { CalendarChipFace } from './CalendarChipFace';

// The "+N more" control for a day cell: a popover listing every issue on that day
// when there are more than the cell shows inline.
export function CalendarDayOverflow({
  issues,
  hidden,
  dot,
  properties,
  maps,
  onOpen,
}: {
  issues: Issue[];
  hidden: number;
  dot: (issue: Issue) => string;
  properties: PropertyKey[];
  maps: Maps;
  onOpen: (id: number) => void;
}) {
  const t = useTranslations('workItems.calendar');
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="px-1.5 text-left text-xs text-muted-foreground hover:text-foreground"
        >
          {t('moreIssues', { count: hidden })}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-1">
        <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
          {t('issueCount', { count: issues.length })}
        </div>
        <div className="flex max-h-72 flex-col overflow-y-auto">
          {issues.map((issue) => (
            <Tooltip key={issue.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    setOpen(false);
                    onOpen(issue.id);
                  }}
                  className="flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-left text-xs hover:bg-accent"
                >
                  <CalendarChipFace
                    issue={issue}
                    color={dot(issue)}
                    properties={['id', ...properties]}
                    maps={maps}
                  />
                </button>
              </TooltipTrigger>
              <TooltipContent>{`${issue.identifier} ${issue.title}`}</TooltipContent>
            </Tooltip>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
