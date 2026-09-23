'use client';

import { Brain, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

// What the model reasoned before a stretch of its answer. Closed by default once it is
// done — the answer is what the reader came for — but left open while it is still being
// written, so the reader sees the agent is working rather than a bubble that looks stuck.
export default function ChatReasoningDisclosure({
  text,
  streaming,
}: {
  text: string;
  streaming: boolean;
}) {
  const t = useTranslations('chatWorkspace');

  return (
    <Collapsible defaultOpen={streaming}>
      <CollapsibleTrigger className="group flex min-h-8 w-fit max-w-full items-center gap-1.5 rounded-md text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <ChevronRight className="size-3.5 shrink-0 transition-transform duration-150 group-data-[state=open]:rotate-90 rtl:group-data-[state=closed]:rotate-180" />
        <Brain className="size-3.5 shrink-0" />
        <span className={streaming ? 'shimmer' : undefined}>
          {t(streaming ? 'messages.reasoningLive' : 'messages.reasoning')}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden ps-5 motion-safe:data-[state=closed]:animate-collapsible-up motion-safe:data-[state=open]:animate-collapsible-down">
        <p dir="auto" className="text-sm whitespace-pre-wrap text-muted-foreground">
          {text}
        </p>
      </CollapsibleContent>
    </Collapsible>
  );
}
