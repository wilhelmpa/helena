'use client';

import { Plus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { OWNER_TERMINAL_KINDS, type OwnerTerminalKind } from '@/lib/api/endpoints/owner-terminal';
import type { OpenTerminalTab } from '../OwnerTerminalPanel';

// Fixed startable kinds, in the order the "+" menu offers them (design's
// Nachtrag: "Shell, Claude Code, Codex, Helena weiterentwickeln"). Helena
// weiterentwickeln covers both agents in the dev clone, listed as two rows here
// rather than a submenu -- there is no third choice to hide behind one.
const ADD_ORDER: OwnerTerminalKind[] = [...OWNER_TERMINAL_KINDS];

export default function TerminalTabBar({
  tabs,
  activeKey,
  onSelect,
  onClose,
  onAdd,
}: {
  tabs: OpenTerminalTab[];
  activeKey: string;
  onSelect: (key: string) => void;
  onClose: (key: string) => void;
  onAdd: (kind: OwnerTerminalKind) => void;
}) {
  const t = useTranslations('ownerTerminal.kinds');

  return (
    <div className="flex h-8 shrink-0 items-center gap-1 overflow-x-auto border-b px-1">
      {tabs.map((tab) => {
        const key = `${tab.kind}:${tab.name}`;
        const active = key === activeKey;
        return (
          <div
            key={key}
            className={cn(
              'group flex h-6 shrink-0 items-center gap-1 rounded-md px-2 text-xs',
              active
                ? 'bg-sidebar-accent font-medium'
                : 'text-muted-foreground hover:bg-sidebar-accent',
            )}
          >
            <button type="button" className="max-w-32 truncate" onClick={() => onSelect(key)}>
              {t(tab.kind)}
              {tab.name !== 'main' && (
                <span className="ms-1 font-mono text-xs opacity-70">{tab.name}</span>
              )}
            </button>
            <button
              type="button"
              aria-label={t('close')}
              className="opacity-0 group-hover:opacity-100"
              onClick={() => onClose(key)}
            >
              <X className="size-3" />
            </button>
          </div>
        );
      })}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-6">
            <Plus className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {ADD_ORDER.map((kind) => (
            <DropdownMenuItem key={kind} onClick={() => onAdd(kind)}>
              {t(kind)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
