'use client';

import {
  useEffect,
  useRef,
  type ComponentType,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import KnowledgeRowName from './KnowledgeRowName';
import { Page, PageToolbarSpacer } from '@/design-system';

// One page pattern for Wissen and Belege (docs/ui-system.md §8, WissenOrdner.dc.html):
// the sidebar tree picks the place, the page shows a header (mono eyebrow with the path,
// title, search, "+ Neu"), the list, and nothing on the right: a file opens in the main
// area or in the overlay (owner 28.09.).

export interface KnowledgeCrumb {
  label: string;
  href?: string;
  onSelect?: () => void;
}

export function KnowledgeSearch({
  value,
  onChange,
  placeholder,
  inputRef,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  const own = useRef<HTMLInputElement>(null);
  const input = inputRef ?? own;
  useEffect(() => {
    const focus = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        event.stopImmediatePropagation();
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', focus, true);
    return () => window.removeEventListener('keydown', focus, true);
  }, [input]);
  return (
    <label className="ds-search ds-knowledge-search">
      <Search size={13} aria-hidden="true" />
      <input
        ref={input}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
      />
      <kbd className="font-mono text-[10px] text-muted-foreground/80 max-sm:hidden">{'⌘K'}</kbd>
    </label>
  );
}

// The column heads over a list (NAME · ART · GEÄNDERT).
export function KnowledgeListHead({
  name,
  kind,
  trailing,
}: {
  name: string;
  kind: string;
  trailing: string;
}) {
  return (
    <div className="ds-column-heads grid grid-cols-[28px_minmax(0,1fr)_minmax(0,190px)_120px] gap-3 px-3.5 font-mono uppercase max-sm:grid-cols-[22px_minmax(0,1fr)_auto]">
      <span />
      <span>{name}</span>
      <span className="max-sm:hidden">{kind}</span>
      <span className="text-end max-sm:hidden">{trailing}</span>
    </div>
  );
}

// One entry of a list: icon, name, kind/detail, and a trailing value (date or amount).
// The whole row is one button; the menu sits over the trailing value on hover/focus.
export function KnowledgeRow({
  index,
  icon: Icon,
  name,
  detail,
  trailing,
  selected,
  onClick,
  onDoubleClick,
  menu,
  rowProps,
  title,
  renaming,
}: {
  index?: number;
  icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  name: ReactNode;
  detail?: ReactNode;
  trailing?: ReactNode;
  selected?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
  menu?: ReactNode;
  rowProps?: Record<string, unknown>;
  title?: string;
  // Renamed in place (F2 or the menu, Auftrag 117): the name is a field; Enter keeps it,
  // Esc or leaving it without a change drops it.
  renaming?: {
    initial: string;
    label: string;
    onSubmit: (name: string) => void;
    onCancel: () => void;
  };
}) {
  return (
    <div
      {...rowProps}
      data-knowledge-row={index}
      data-selected={selected ? '' : undefined}
      className={cn(
        'group relative grid min-h-11 shrink-0 grid-cols-[28px_minmax(0,1fr)_minmax(0,190px)_120px] items-center gap-3 rounded-lg px-3.5 max-sm:grid-cols-[22px_minmax(0,1fr)_auto]',
        selected
          ? 'bg-accent text-accent-foreground shadow-[0_2px_6px_#0003,inset_0_1px_#ffffff0c]'
          : onClick && 'hover:bg-muted',
      )}
    >
      <Icon size={18} strokeWidth={1.6} className="text-muted-foreground" />
      {renaming ? (
        <KnowledgeRowName {...renaming} />
      ) : onClick ? (
        <button
          type="button"
          data-row-button=""
          aria-current={selected ? 'true' : undefined}
          title={title}
          onClick={onClick}
          onDoubleClick={onDoubleClick}
          className="min-w-0 truncate rounded-md text-start text-[13px] outline-none after:absolute after:inset-0 after:rounded-lg after:content-[''] focus-visible:after:bg-foreground/5"
          dir="auto"
        >
          {name}
        </button>
      ) : (
        <span className="min-w-0 truncate text-[13px]" dir="auto" title={title}>
          {name}
        </span>
      )}
      <span className="min-w-0 truncate text-xs text-muted-foreground max-sm:hidden" dir="auto">
        {detail}
      </span>
      <span className="relative z-[1] flex min-w-0 items-center justify-end gap-1 text-end font-mono text-[11px] text-muted-foreground tabular-nums">
        {trailing}
      </span>
      {menu && (
        <span className="absolute inset-e-2 top-1/2 z-[2] -translate-y-1/2 rounded-full bg-inherit opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 has-[[data-state=open]]:opacity-100">
          {menu}
        </span>
      )}
    </div>
  );
}

// ↑/↓ move the selection (and focus), Home/End jump, Enter opens the selected entry.
export function useListKeyboard({
  count,
  selected,
  onSelect,
  onOpen,
}: {
  count: number;
  selected: number;
  onSelect: (index: number) => void;
  onOpen: (index: number) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const focusRow = (index: number) =>
    requestAnimationFrame(() =>
      list.current
        ?.querySelector<HTMLElement>(`[data-knowledge-row="${index}"] [data-row-button]`)
        ?.focus(),
    );
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!count) return;
    const target = event.target as HTMLElement;
    if (target.closest('[role="menu"], input, textarea, [contenteditable="true"]')) return;
    let next: number | null = null;
    if (event.key === 'ArrowDown') next = Math.min(count - 1, selected < 0 ? 0 : selected + 1);
    else if (event.key === 'ArrowUp') next = Math.max(0, selected < 0 ? 0 : selected - 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = count - 1;
    else if (event.key === 'Enter' && selected >= 0 && target.closest('[data-row-button]')) {
      event.preventDefault();
      onOpen(selected);
      return;
    }
    if (next === null) return;
    event.preventDefault();
    onSelect(next);
    focusRow(next);
  };
  return { ref: list, onKeyDown };
}

export default function KnowledgeFrame({
  title,
  search,
  actions,
  pills,
  children,
  footer,
  frameProps,
}: {
  // The place of the list; the shell's breadcrumb shows it, the page does not repeat it.
  crumbs?: KnowledgeCrumb[];
  title: ReactNode;
  search?: ReactNode;
  actions?: ReactNode;
  pills?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  frameProps?: Record<string, unknown>;
}) {
  // The page template: the header (the shell) names the place — its breadcrumb is the whole
  // path, so the page repeats none of it (O16) — and carries "+ Neu" on the right; search
  // and filters sit in the toolbar row like on every page.
  return (
    <Page
      variant="fill"
      toolbar={
        pills || search ? (
          <>
            {pills}
            <PageToolbarSpacer />
            {search}
          </>
        ) : undefined
      }
      actions={actions}
    >
      <div {...frameProps} data-project-knowledge className="ds-knowledge">
        <section className="ds-knowledge-main">
          <h1 className="sr-only" dir="auto">
            {title}
          </h1>
          {children}
          {footer}
        </section>
      </div>
    </Page>
  );
}
