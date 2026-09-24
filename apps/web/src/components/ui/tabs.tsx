'use client';

import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';

import { cn } from '@/lib/utils';
import { WORKSPACE_TOOLBAR_TRIGGER_CLASS } from '@/components/layout/WorkspaceToolbarButton';

type TabsVariant = 'default' | 'line' | 'toolbar';

const TabsListContext = React.createContext<TabsVariant>('default');

// Every tab is a sidebar row laid on its side (docs/volition/ui-standard.md): 13px,
// 28px high, rounded-md, the sidebar's hover fill, and the selected one filled with the
// sidebar accent — the same look as PageTabs in the header row, with no pill track and
// no shadow. `line` and `default` differ only in how the list lays them out.
const TAB_ROW_CLASS =
  "inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-2 text-sm whitespace-nowrap text-muted-foreground transition-colors outline-none hover:bg-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-accent data-[state=active]:font-medium data-[state=active]:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn('flex flex-col gap-2', className)}
      {...props}
    />
  );
}

function TabsList({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & {
  variant?: TabsVariant;
}) {
  return (
    <TabsListContext.Provider value={variant}>
      <TabsPrimitive.List
        data-slot="tabs-list"
        data-variant={variant}
        className={cn(
          variant === 'line'
            ? 'inline-flex h-8 w-full items-center justify-start gap-0.5 text-muted-foreground'
            : variant === 'toolbar'
              ? 'inline-flex w-fit items-center justify-start gap-1'
              : 'inline-flex h-8 w-fit items-center justify-center gap-0.5 text-muted-foreground',
          className,
        )}
        {...props}
      />
    </TabsListContext.Provider>
  );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const variant = React.useContext(TabsListContext);
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        variant === 'toolbar'
          ? `${WORKSPACE_TOOLBAR_TRIGGER_CLASS} disabled:pointer-events-none disabled:opacity-50`
          : TAB_ROW_CLASS,
        // The default list spreads its tabs evenly (a list given w-full or a grid);
        // the line list sets them side by side at their own width.
        variant === 'default' && 'flex-1',
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('flex-1 outline-none', className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
