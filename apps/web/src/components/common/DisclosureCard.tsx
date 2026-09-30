'use client';

import { useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { Card } from '@/design-system';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

// A row that states one thing and holds the detail of it behind a toggle.
// `header` is the row itself; `trailing` sits outside the toggle, for a control
// that acts on its own (a link out of the row).
export default function DisclosureCard({
  header,
  trailing,
  children,
}: {
  header: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible asChild open={open} onOpenChange={setOpen}>
      <Card pad="none" gap={0} className="overflow-hidden">
        <div className="flex items-center">
          <CollapsibleTrigger className="flex min-h-10 min-w-0 flex-1 items-center gap-2 px-3 py-2 text-start text-sm transition-colors hover:bg-accent/60">
            <ChevronRight
              className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`}
            />
            {header}
          </CollapsibleTrigger>
          {trailing}
        </div>

        <CollapsibleContent className="border-t border-sidebar-border px-3 py-3">
          {children}
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
