'use client';

import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { Check, ChevronDown, MoreHorizontal, Search, TextSearch, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { useShellHeaderActionsSlot } from '@/context/shellHeaderSlot';
import { ShellHeaderRow } from '@/components/layout/WorkspaceHeader';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { StatusDot, type StatusDotTone } from '../components/StatusDot';

// The one pattern for everything a page offers (owner, 2026-09-24: "alles in eine
// Reihe, ohne Funktionen zu verlieren, für alle Bereiche homogen"). A page puts its
// view tabs, search, filters and actions into ONE <PageToolbar>, which renders inside
// the app header's single row, after the breadcrumb:
//
//   [☰ | Projekt › Seite] [Tabs …] | [Suche] [Filter] [◻ ◻ ◻] [+ Neu]            [Tools]
//
// The page's controls are one group that starts right after the page's name, so they
// read as part of the page (owner, 2026-09-24: "eine Sinneinheit mit dem Inhalt der
// Seite", not pushed against the global tools on the far right).
//
// Every control is a 32px sidebar-style control (13px text, 16px icon, the sidebar's
// hover and selected fill). The toolbar measures the room it actually has (the tool
// panel or a long breadcrumb takes some) and gives way step by step, so the row never
// wraps or runs under the tools: the search becomes an icon that lays its field over
// the row, the secondary actions move into a "…" menu, the primary action keeps only
// its icon, and the tabs become one dropdown. On a phone the toolbar gets its own row
// under the header (see Shell). Outside the shell (and in the 'classic' header layout)
// it is its own 48px row, same content.

// The shared look of a 32px header control; exported for the few page-specific
// controls (a select, a sort menu) that are not one of the pieces below.
export const PAGE_CONTROL_CLASS = 'ds-page-control';
export const PAGE_CONTROL_ACTIVE_CLASS = 'is-active';
// The look of every "New …" of a page (its primary action), the same on every page:
// outlined, a plus, text colour (owner, 28.09.: "behält den Live-Stil").
export const PAGE_PRIMARY_CLASS = 'ds-page-primary';

// How far the toolbar has given way to fit its room: 0 shows everything in full, then
// one piece at a time folds — the search into an icon, the secondary actions into the
// "…" menu, the primary action to its icon, the tabs into a dropdown.
const LEVELS = 4;
// The most actions a page's bar shows as buttons of their own before the rest folds into "…".
const MAX_INLINE_ACTIONS = 7;
const LABELLED_ACTIONS = 3;
type Room = {
  tabs: boolean;
  primaryLabel: boolean;
  actions: boolean;
  search: boolean;
  wideSearch: boolean;
};
const roomFor = (level: number, width: number): Room => ({
  search: level < 1,
  wideSearch: level < 1 && width >= 940,
  actions: level < 2,
  primaryLabel: level < 3,
  tabs: level < 4,
});
const RoomCtx = createContext<Room>(roomFor(0, 0));
const ToolbarScopeCtx = createContext(false);

// For a page's own control in the toolbar (a sort menu, a select): whether it still has
// room for its label (`actions`) or should show its icon alone.
export function usePageToolbarRoom(): Room {
  return useContext(RoomCtx);
}

export function PageToolbar({ children }: { children: ReactNode }) {
  // A callback ref: the row is first rendered in place and then moved into the header's
  // slot once that exists (a new element), so the observer follows whichever element
  // is the row now — observing only the first one missed every later resize.
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [level, setLevel] = useState(0);
  useLayoutEffect(() => {
    if (!node) return;
    setWidth(node.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  // More room: start over from the full toolbar (the step below folds it again as far
  // as it has to). Layout effects run before paint, so no step is ever seen.
  // Only a real gain of room (a wider window, a closed panel) starts over: a few pixels
  // (a scrollbar coming and going, a hover card) must not fold and unfold the row in a
  // loop — that was the hover flicker on Team and Aufgaben (owner, O19).
  const lastWidth = useRef(0);
  useLayoutEffect(() => {
    if (width > lastWidth.current + 24) {
      setLevel(0);
      lastWidth.current = width;
    } else if (width < lastWidth.current) {
      lastWidth.current = width;
    }
  }, [width]);
  // After a render that may have changed the width of what is in the row: still
  // overflowing, fold one more piece. Bounded by LEVELS, so it settles after at most
  // four steps.
  useLayoutEffect(() => {
    if (!node || level >= LEVELS) return;
    if (node.scrollWidth > node.clientWidth + 1) setLevel(level + 1);
  }, [node, level, width, children]);
  return (
    <ShellHeaderRow className="ds-page-toolbar-standalone">
      <div ref={setNode} className="ds-page-toolbar-row">
        <RoomCtx.Provider value={roomFor(level, width)}>
          <ToolbarScopeCtx.Provider value>{children}</ToolbarScopeCtx.Provider>
        </RoomCtx.Provider>
      </div>
    </ShellHeaderRow>
  );
}

// Separates the page's tabs from its search, filters and actions. It no longer pushes
// them to the end of the row: the page's controls stay one group after its name. A
// divider with nothing on one side of it is not drawn.
export function PageToolbarSpacer() {
  return (
    <div aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-border first:hidden last:hidden" />
  );
}

export type PageTab<T extends string> = {
  value: T;
  label: string;
  icon?: LucideIcon;
  count?: number;
  // A status dot after the count (something runs, waits or failed in this tab).
  dot?: StatusDotTone | null;
  href?: string;
};

// A page's views (Wissen/Code, Aktiv/Geplant/…, Tabelle/Zeitachse): sidebar rows laid
// side by side. Below md they collapse into one dropdown showing the current view.
export function PageTabs<T extends string>({
  items,
  value,
  onChange,
  label,
  folded = false,
}: {
  items: PageTab<T>[];
  value: T;
  onChange?: (value: T) => void;
  // Accessible name of the tab group.
  label?: string;
  // Always the dropdown (a phone: five tabs never fit beside the page's other controls).
  folded?: boolean;
}) {
  const room = useContext(RoomCtx);
  const current = items.find((item) => item.value === value) ?? items[0];
  if (room.tabs && !folded) {
    return (
      // The same segment control as every view switch (design-system §9): one look, one
      // height for all tabs in the top bar.
      <nav aria-label={label} className="ds-segmented">
        {items.map((item) => (
          <PageTabButton
            key={item.value}
            item={item}
            active={item.value === value}
            onSelect={() => onChange?.(item.value)}
          />
        ))}
      </nav>
    );
  }
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={label}
            className={cn(PAGE_CONTROL_CLASS, 'min-w-0 text-foreground')}
          >
            {current?.icon ? <current.icon aria-hidden="true" /> : null}
            <span className="truncate">{current?.label}</span>
            <ChevronDown className="!size-3.5 text-muted-foreground" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-44">
          {items.map((item) => {
            const inner = (
              <>
                {item.icon ? <item.icon /> : null}
                <span className="flex-1">{item.label}</span>
                {item.count != null ? (
                  <span className="text-xs text-muted-foreground tabular-nums">{item.count}</span>
                ) : null}
                {item.value === value ? <Check className="text-muted-foreground" /> : null}
              </>
            );
            return item.href ? (
              <DropdownMenuItem key={item.value} asChild>
                <Link href={item.href}>{inner}</Link>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem key={item.value} onSelect={() => onChange?.(item.value)}>
                {inner}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

function PageTabButton<T extends string>({
  item,
  active,
  onSelect,
}: {
  item: PageTab<T>;
  active: boolean;
  onSelect: () => void;
}) {
  const className = cn(active && PAGE_CONTROL_ACTIVE_CLASS);
  const inner = (
    <>
      {item.icon ? <item.icon aria-hidden="true" /> : null}
      <span>{item.label}</span>
      {item.count != null ? (
        <span className="text-xs font-normal text-muted-foreground tabular-nums">{item.count}</span>
      ) : null}
      {item.dot ? <StatusDot tone={item.dot} /> : null}
    </>
  );
  return item.href ? (
    <Link href={item.href} aria-current={active ? 'page' : undefined} className={className}>
      {inner}
    </Link>
  ) : (
    <button type="button" aria-pressed={active} onClick={onSelect} className={className}>
      {inner}
    </button>
  );
}

// The page's filter field. From md a 13px field in the row; below it a search icon
// that lays the field over the whole header row until it is closed or emptied.
export function PageSearch({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
}) {
  const t = useTranslations('common');
  const room = useContext(RoomCtx);
  const [open, setOpen] = useState(false);
  const field = (autoFocus: boolean) => (
    <div className="relative flex min-w-0 items-center">
      <Search
        className="pointer-events-none absolute start-2 size-3.5 text-muted-foreground"
        aria-hidden="true"
      />
      <input
        type="search"
        value={value}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            onChange('');
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="ds-page-search-input"
      />
    </div>
  );
  if (room.search) {
    return (
      <div className={cn('shrink-0', room.wideSearch ? 'w-56' : 'w-40', className)}>
        {field(false)}
      </div>
    );
  }
  return (
    <>
      <button
        type="button"
        aria-label={placeholder}
        onClick={() => setOpen(true)}
        className={cn(
          PAGE_CONTROL_CLASS,
          'w-8 justify-center px-0',
          value && PAGE_CONTROL_ACTIVE_CLASS,
        )}
      >
        <TextSearch aria-hidden="true" />
      </button>
      {open ? (
        <div className="absolute inset-0 z-20 flex items-center gap-1 bg-background px-2">
          <div className="min-w-0 flex-1">{field(true)}</div>
          <button
            type="button"
            aria-label={t('close')}
            onClick={() => setOpen(false)}
            className={cn(PAGE_CONTROL_CLASS, 'w-8 justify-center px-0')}
          >
            <X aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </>
  );
}

export type PageSelectOption<T extends string> = { value: T; label: string; icon?: LucideIcon };

// A filter or grouping in the toolbar ("Alle Projekte", "Alle Arten", "Nach Projekt"):
// a 32px control with its icon and the current choice, a menu of the choices under it.
// A choice other than `defaultValue` is drawn as selected, so a filter that is on stays
// visible even when the toolbar has folded the control to its icon.
export function PageSelect<T extends string>({
  label,
  icon: Icon,
  value,
  onChange,
  options,
  defaultValue,
}: {
  label: string;
  icon: LucideIcon;
  value: T;
  onChange: (value: T) => void;
  options: PageSelectOption<T>[];
  defaultValue?: T;
}) {
  const room = useContext(RoomCtx);
  const current = options.find((option) => option.value === value);
  const active = defaultValue !== undefined && value !== defaultValue;
  const trigger = (
    <button
      type="button"
      aria-label={`${label}: ${current?.label ?? ''}`}
      className={cn(PAGE_CONTROL_CLASS, active && PAGE_CONTROL_ACTIVE_CLASS)}
    >
      <Icon aria-hidden="true" />
      {room.actions ? <span className="max-w-40 truncate">{current?.label}</span> : null}
      {room.actions ? (
        <ChevronDown className="!size-3.5 text-muted-foreground" aria-hidden="true" />
      ) : null}
    </button>
  );
  return (
    <DropdownMenu>
      {room.actions ? (
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{`${label}: ${current?.label ?? ''}`}</TooltipContent>
        </Tooltip>
      )}
      <DropdownMenuContent align="start" className="min-w-48">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {label}
        </DropdownMenuLabel>
        {options.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.value}
            checked={option.value === value}
            onCheckedChange={() => onChange(option.value)}
          >
            {option.icon ? <option.icon /> : null}
            {option.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export type PageAction = {
  id: string;
  label: string;
  icon: LucideIcon;
  onClick?: () => void;
  href?: string;
  // `href` leaves the app (a code-server folder, a download): a plain link in a new tab.
  external?: boolean;
  // A toggle that is on (a details pane shown): drawn selected, announced as pressed.
  active?: boolean;
  disabled?: boolean;
  // Shown after a separator in the "…" menu, and never as a row icon (rare, e.g. a
  // destructive or seldom-used action).
  menuOnly?: boolean;
};

// The page's actions. `primary` is the one filled button a page may have (its "New …"),
// the others are 32px icon buttons with a tooltip. Below md the primary shrinks to its
// icon and every other action moves into a "…" menu.
export function PageActions({
  actions = [],
  primary,
}: {
  actions?: PageAction[];
  primary?: Omit<PageAction, 'menuOnly'>;
}) {
  const t = useTranslations('common');
  const room = useContext(RoomCtx);
  const inToolbar = useContext(ToolbarScopeCtx);
  const actionsSlot = useShellHeaderActionsSlot();
  // The controls of a page stand in its bar, not behind a menu (owner 30.09.: "die Steuerungen
  // nicht hinter ein Submenü verstecken"): with the room for them, every action is an icon button
  // (up to MAX_INLINE_ACTIONS; a lone extra action next to the primary one keeps its label below).
  // Short of room, or with more than that, they fold into the "…" menu as before.
  const inlineAll = room.actions && actions.length >= 2 && actions.length <= MAX_INLINE_ACTIONS;
  const visibleAction =
    inlineAll || primary ? null : room.actions ? actions.find((action) => !action.menuOnly) : null;
  const inRow = inlineAll ? actions : visibleAction ? [visibleAction] : [];
  // A few actions carry their names (while the row has room for words); more are icons.
  const labelled = room.primaryLabel && inRow.length > 0 && inRow.length <= LABELLED_ACTIONS;
  // Rare actions of this page; never a way into the settings (they live in the sidebar).
  const rest: PageAction[] = inlineAll ? [] : actions.filter((action) => action !== visibleAction);
  // A "…" menu with a single entry is not a menu (owner, O36): that entry is a secondary
  // button with its label (its icon alone where the row has no room).
  const single = rest.length === 1 ? rest[0]! : null;
  const inMenu: PageAction[] = single ? [] : rest;
  const controls = (
    <div className="flex shrink-0 items-center gap-0.5">
      {inRow.map((action) =>
        labelled ? (
          <ActionControl
            key={action.id}
            action={action}
            aria-pressed={action.active}
            className={cn(action.active && PAGE_CONTROL_ACTIVE_CLASS)}
          >
            <action.icon aria-hidden="true" />
            <span>{action.label}</span>
          </ActionControl>
        ) : (
          <Tooltip key={action.id}>
            <TooltipTrigger asChild>
              <ActionControl
                action={action}
                aria-pressed={action.active}
                className={cn(
                  'w-8 justify-center px-0',
                  action.active && PAGE_CONTROL_ACTIVE_CLASS,
                )}
              >
                <action.icon aria-hidden="true" />
              </ActionControl>
            </TooltipTrigger>
            <TooltipContent>{action.label}</TooltipContent>
          </Tooltip>
        ),
      )}
      {single ? (
        room.actions ? (
          <ActionControl
            action={single}
            aria-pressed={single.active}
            className={cn(single.active && PAGE_CONTROL_ACTIVE_CLASS)}
          >
            <single.icon aria-hidden="true" />
            <span>{single.label}</span>
          </ActionControl>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <ActionControl
                action={single}
                aria-pressed={single.active}
                className={cn(
                  'w-8 justify-center px-0',
                  single.active && PAGE_CONTROL_ACTIVE_CLASS,
                )}
              >
                <single.icon aria-hidden="true" />
              </ActionControl>
            </TooltipTrigger>
            <TooltipContent>{single.label}</TooltipContent>
          </Tooltip>
        )
      ) : null}
      {inMenu.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t('more')}
              className={cn(PAGE_CONTROL_CLASS, 'w-8 justify-center px-0')}
            >
              <MoreHorizontal aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-48">
            {inMenu.map((action, index) => (
              <MenuEntry
                key={action.id}
                action={action}
                separated={index > 0 && !!action.menuOnly && !inMenu[index - 1]!.menuOnly}
              />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {primary ? (
        <ActionControl
          action={primary}
          className={cn(PAGE_PRIMARY_CLASS, !room.primaryLabel && 'w-8 justify-center px-0')}
        >
          <primary.icon aria-hidden="true" />
          <span className={room.primaryLabel ? undefined : 'sr-only'}>{primary.label}</span>
        </ActionControl>
      ) : null}
    </div>
  );
  return inToolbar && actionsSlot ? createPortal(controls, actionsSlot) : controls;
}

// Also a TooltipTrigger's child: Radix passes its ref and its own handlers through
// `rest` — its onClick (closing the tooltip) is called next to the action's, never
// instead of it.
function ActionControl({
  action,
  className,
  children,
  onClick: triggerClick,
  ...rest
}: {
  action: Omit<PageAction, 'menuOnly'>;
  className?: string;
  children: ReactNode;
} & Omit<ComponentProps<'button'>, 'className' | 'children'>) {
  const classes = cn(PAGE_CONTROL_CLASS, className);
  const linkClick = triggerClick as unknown as ComponentProps<'a'>['onClick'];
  if (action.href && action.external && !action.disabled) {
    return (
      <a
        href={action.href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={action.label}
        className={classes}
        {...(rest as ComponentProps<'a'>)}
        onClick={linkClick}
      >
        {children}
      </a>
    );
  }
  if (action.href && !action.disabled) {
    return (
      <Link
        href={action.href}
        aria-label={action.label}
        className={classes}
        {...(rest as Omit<ComponentProps<typeof Link>, 'href'>)}
        onClick={linkClick}
      >
        {children}
      </Link>
    );
  }
  return (
    <button
      type="button"
      aria-label={action.label}
      disabled={action.disabled}
      className={classes}
      {...rest}
      onClick={(event) => {
        triggerClick?.(event);
        action.onClick?.();
      }}
    >
      {children}
    </button>
  );
}

function MenuEntry({ action, separated }: { action: PageAction; separated: boolean }) {
  return (
    <>
      {separated ? <DropdownMenuSeparator /> : null}
      <ActionMenuItem action={action} />
    </>
  );
}

function ActionMenuItem({ action, className }: { action: PageAction; className?: string }) {
  if (action.href && action.external) {
    return (
      <DropdownMenuItem asChild disabled={action.disabled} className={className}>
        <a href={action.href} target="_blank" rel="noopener noreferrer">
          <action.icon />
          {action.label}
        </a>
      </DropdownMenuItem>
    );
  }
  if (action.href) {
    return (
      <DropdownMenuItem asChild disabled={action.disabled} className={className}>
        <Link href={action.href}>
          <action.icon />
          {action.label}
        </Link>
      </DropdownMenuItem>
    );
  }
  return (
    <DropdownMenuItem
      disabled={action.disabled}
      onSelect={() => action.onClick?.()}
      className={className}
    >
      <action.icon />
      {action.label}
      {action.active ? <Check className="ms-auto text-muted-foreground" /> : null}
    </DropdownMenuItem>
  );
}
