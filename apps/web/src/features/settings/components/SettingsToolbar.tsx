'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, Settings } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useShellRoute } from '@/hooks/useShellRoute';
import { useProjectSettingsNavGroups } from '@/hooks/useProjectSettingsNavGroups';
import {
  PAGE_CONTROL_CLASS,
  PageActions,
  PageToolbar,
  PageToolbarSpacer,
  type PageAction,
} from '@/components/layout/PageToolbar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// The trigger of a settings page's own "…" menu in the header row (copy/paste of
// states, labels, types, fields).
export const SETTINGS_MENU_TRIGGER_CLASS = cn(PAGE_CONTROL_CLASS, 'w-8 justify-center px-0');

// A project settings page's one header row (PageToolbar, docs/volition/ui-standard.md):
// below 1024px, where the settings rail is hidden, the section switcher comes first;
// then the page's own controls (`children`) and its one primary action.
export default function SettingsToolbar({
  children,
  primary,
}: {
  children?: ReactNode;
  primary?: Omit<PageAction, 'menuOnly'>;
}) {
  const narrow = useMediaQuery('(max-width: 1023px)');
  return (
    <PageToolbar>
      {narrow ? <SettingsSectionMenu /> : null}
      <PageToolbarSpacer />
      {children}
      {primary ? <PageActions primary={primary} /> : null}
    </PageToolbar>
  );
}

// The settings sections as one dropdown: the open one with its icon, the others
// grouped like the rail.
function SettingsSectionMenu() {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const { projectKey } = useShellRoute();
  const groups = useProjectSettingsNavGroups(projectKey ?? '').filter((g) => g.items.length);
  const active = groups.flatMap((g) => g.items).find((item) => item.href === pathname);
  const Icon = active?.icon ?? Settings;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('projectSettings')}
          className={cn(PAGE_CONTROL_CLASS, 'min-w-0 text-foreground')}
        >
          <Icon aria-hidden="true" />
          <span className="truncate">{active?.label ?? t('projectSettings')}</span>
          <ChevronDown className="!size-3.5 text-muted-foreground" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[70vh] min-w-56 overflow-y-auto">
        {groups.map((group, index) => (
          <DropdownMenuGroup key={group.key}>
            {index > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              {group.label}
            </DropdownMenuLabel>
            {group.items.map((item) => (
              <DropdownMenuItem key={item.key} asChild>
                <Link href={item.href} aria-current={item.href === pathname ? 'page' : undefined}>
                  <item.icon />
                  {item.label}
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
