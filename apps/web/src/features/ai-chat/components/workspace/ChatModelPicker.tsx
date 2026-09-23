'use client';

import { useTranslations } from 'next-intl';
import { Check, ChevronDown, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useChatCatalog } from '../../hooks/useChatCatalog';

export interface ChatModelPickerProps {
  scopeKey: string;
  agentId: number;
  model: string | null;
  thinkingLevel: string | null;
  onChange: (model: string | null, thinkingLevel: string | null) => void;
  // Lets the `/model` and `/reasoning` commands open the same menu instead of setting
  // up a second way to pick a model. Uncontrolled (Radix's own open state) when left
  // out, which is what the composer's own trigger click still uses.
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

// Picks the model and, when the model supports it, its reasoning effort — or leaves
// both null, "Agent default", which is the agent's own configured model. The catalog
// comes from what the runner last published (see /agent-chats/catalog); a runner that
// has not reported one yet offers only the default.
export default function ChatModelPicker({
  scopeKey,
  agentId,
  model,
  thinkingLevel,
  onChange,
  open,
  onOpenChange,
}: ChatModelPickerProps) {
  const t = useTranslations('chatWorkspace');
  const catalog = useChatCatalog(scopeKey, agentId);
  const models = catalog.data?.models ?? [];
  const selected = models.find((entry) => entry.id === model);
  const label = model == null ? t('composer.modelDefault') : (selected?.name ?? model);

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Sparkles className="size-3.5" />
          <span className="max-w-32 truncate">{label}</span>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>{t('composer.model')}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => onChange(null, null)}>
          {model == null && <Check className="size-4" />}
          <span className={model == null ? '' : 'ps-6'}>{t('composer.modelDefault')}</span>
        </DropdownMenuItem>
        {models.length > 0 && <DropdownMenuSeparator />}
        {models.map((entry) =>
          entry.reasoning && entry.thinkingLevels.length > 0 ? (
            <DropdownMenuSub key={entry.id}>
              <DropdownMenuSubTrigger>
                {entry.id === model && <Check className="size-4" />}
                <span className={entry.id === model ? '' : 'ps-6'}>{entry.name}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {entry.thinkingLevels.map((level) => (
                  <DropdownMenuItem key={level} onSelect={() => onChange(entry.id, level)}>
                    {entry.id === model && thinkingLevel === level && <Check className="size-4" />}
                    <span className={entry.id === model && thinkingLevel === level ? '' : 'ps-6'}>
                      {level}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : (
            <DropdownMenuItem key={entry.id} onSelect={() => onChange(entry.id, null)}>
              {entry.id === model && <Check className="size-4" />}
              <span className={entry.id === model ? '' : 'ps-6'}>{entry.name}</span>
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
