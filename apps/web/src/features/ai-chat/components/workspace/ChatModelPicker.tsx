'use client';

import { useTranslations } from 'next-intl';
import { Check, ChevronDown, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { AiChatModel } from '@/lib/api/endpoints/agentChat';
import { useChatCatalog } from '../../hooks/useChatCatalog';
import {
  accountOf,
  isUnverified,
  refusalOf,
} from '@/features/model-availability/utils/modelFailure';

// Who makes the models a runner offers, by the provider key its catalog names — product
// names, the same in every language.
const PROVIDER_NAME: Record<string, string> = {
  anthropic: 'Claude · Anthropic',
  'openai-codex': 'Codex · OpenAI',
  openai: 'OpenAI',
  google: 'Gemini · Google',
};

// The catalog's models by provider, in the order the runner listed them.
function groupByProvider(models: AiChatModel[]): [string, AiChatModel[]][] {
  const groups = new Map<string, AiChatModel[]>();
  for (const entry of models) {
    const key = entry.provider ?? '';
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return [...groups];
}

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
  const tModel = useTranslations('modelAvailability');
  const tLocal = useTranslations('localAi');
  const catalog = useChatCatalog(scopeKey, agentId);
  const models = catalog.data?.models ?? [];
  const selected = models.find((entry) => entry.id === model);
  const name = model == null ? t('composer.modelDefault') : (selected?.name ?? model);
  const label = thinkingLevel ? `${name} · ${thinkingLevel}` : name;
  // The thread's model was refused since it was chosen: the next answer would fail.
  const refused = refusalOf(model, catalog.data?.unavailable);
  // An entry only the runtime expects to work carries a quiet mark.
  const entryName = (entry: AiChatModel) =>
    entry.local ? (
      <span>
        {entry.name}
        <span className="ms-1.5 text-xs text-muted-foreground">{tLocal('pickerMark')}</span>
      </span>
    ) : isUnverified(entry) ? (
      <span title={tModel('unverifiedHint')}>
        {entry.name}
        <span className="ms-1.5 text-xs text-muted-foreground">{tModel('unverified')}</span>
      </span>
    ) : (
      entry.name
    );

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            'h-8 min-w-0 gap-1 px-2 text-xs font-normal text-muted-foreground hover:text-foreground data-[state=open]:bg-accent',
            refused && 'text-destructive',
          )}
          title={
            refused
              ? tModel('refused', {
                  model: refused.id,
                  account: accountOf(refused.provider, null, refused.id),
                })
              : t('composer.model')
          }
        >
          <Sparkles className="size-3.5 shrink-0" />
          <span className="hidden max-w-40 truncate @md/composer:inline">{label}</span>
          <ChevronDown className="size-3.5 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-96 w-64 overflow-y-auto">
        <DropdownMenuLabel>{t('composer.model')}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => onChange(null, null)}>
          {model == null && <Check className="size-4" />}
          <span className={model == null ? '' : 'ps-6'}>{t('composer.modelDefault')}</span>
        </DropdownMenuItem>
        {groupByProvider(models).map(([provider, entries]) => (
          <DropdownMenuGroup key={provider}>
            <DropdownMenuSeparator />
            {provider && (
              <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
                {provider.startsWith('helena-')
                  ? tLocal('title')
                  : (PROVIDER_NAME[provider] ?? provider)}
              </DropdownMenuLabel>
            )}
            {entries.map((entry) =>
              entry.reasoning && entry.thinkingLevels.length > 0 ? (
                <DropdownMenuSub key={entry.id}>
                  <DropdownMenuSubTrigger>
                    {entry.id === model && <Check className="size-4" />}
                    <span className={entry.id === model ? '' : 'ps-6'}>{entryName(entry)}</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
                      {t('composer.reasoning')}
                    </DropdownMenuLabel>
                    {entry.thinkingLevels.map((level) => (
                      <DropdownMenuItem key={level} onSelect={() => onChange(entry.id, level)}>
                        {entry.id === model && thinkingLevel === level && (
                          <Check className="size-4" />
                        )}
                        <span
                          className={entry.id === model && thinkingLevel === level ? '' : 'ps-6'}
                        >
                          {level}
                          {level === entry.thinkingDefault && (
                            <span className="ms-1.5 text-xs text-muted-foreground">
                              {t('composer.reasoningDefault')}
                            </span>
                          )}
                        </span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ) : (
                <DropdownMenuItem key={entry.id} onSelect={() => onChange(entry.id, null)}>
                  {entry.id === model && <Check className="size-4" />}
                  <span className={entry.id === model ? '' : 'ps-6'}>{entryName(entry)}</span>
                </DropdownMenuItem>
              ),
            )}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
