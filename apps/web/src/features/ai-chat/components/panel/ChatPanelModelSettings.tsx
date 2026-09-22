'use client';

import { useQuery } from '@tanstack/react-query';
import { BrainCircuit, Gauge, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getAiAgentChatCatalog } from '@/lib/api/endpoints/agentChat';
import { settingsForModel } from './ChatPanelModelSettings.logic';

export function ChatPanelModelSettings({
  projectKey,
  agentId,
  model,
  thinkingLevel,
  disabled,
  onChange,
}: {
  projectKey: string;
  agentId: number;
  model: string | null;
  thinkingLevel: string | null;
  disabled: boolean;
  onChange: (settings: { model: string | null; thinkingLevel: string | null }) => void;
}) {
  const catalog = useQuery({
    queryKey: ['agent-chat-catalog', projectKey, agentId],
    queryFn: () => getAiAgentChatCatalog(projectKey, agentId),
    staleTime: 60_000,
  });
  const models = catalog.data?.models ?? [];
  const selected = models.find((entry) => entry.id === model);
  const modelLabel = selected?.name ?? 'Agent default';
  const reasoningLabel = thinkingLevel ?? 'Default';

  return (
    <div className="flex min-w-0 items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled || catalog.isLoading || models.length === 0}
            className="h-7 max-w-48 gap-1.5 rounded-full border border-border/70 bg-muted/35 px-2.5 text-xs font-normal shadow-none hover:bg-accent"
            aria-label="Model"
            title={catalog.isError ? 'Model settings are temporarily unavailable' : undefined}
          >
            {catalog.isLoading ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <BrainCircuit className="size-3.5" />
            )}
            <span className="truncate">{modelLabel}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Model</DropdownMenuLabel>
          <DropdownMenuCheckboxItem
            checked={model === null}
            onSelect={() => onChange({ model: null, thinkingLevel: null })}
          >
            Agent default
          </DropdownMenuCheckboxItem>
          {models.map((entry) => (
            <DropdownMenuCheckboxItem
              key={entry.id}
              checked={entry.id === model}
              onSelect={() => onChange(settingsForModel(models, entry.id, thinkingLevel))}
            >
              <span className="truncate">{entry.name}</span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={
              disabled || catalog.isLoading || !selected || selected.thinkingLevels.length === 0
            }
            className="h-7 max-w-28 gap-1.5 rounded-full border border-border/70 bg-muted/35 px-2.5 text-xs font-normal shadow-none hover:bg-accent"
            aria-label="Reasoning"
            title={selected ? undefined : 'Choose a model first'}
          >
            <Gauge className="size-3.5" />
            <span className="truncate capitalize">{reasoningLabel}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuLabel>Reasoning</DropdownMenuLabel>
          <DropdownMenuCheckboxItem
            checked={thinkingLevel === null}
            onSelect={() => onChange({ model, thinkingLevel: null })}
          >
            Model default
            {selected?.thinkingDefault && (
              <span className="ml-auto text-muted-foreground capitalize">
                {selected.thinkingDefault}
              </span>
            )}
          </DropdownMenuCheckboxItem>
          {selected?.thinkingLevels.map((level) => (
            <DropdownMenuCheckboxItem
              key={level}
              checked={level === thinkingLevel}
              onSelect={() => onChange({ model, thinkingLevel: level })}
            >
              <span className="capitalize">{level}</span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
