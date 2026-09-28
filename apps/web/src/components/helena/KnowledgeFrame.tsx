'use client';

import {
  Fragment,
  useEffect,
  useRef,
  type ComponentType,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { MonoLabel } from '@/components/helena/DashboardPrimitives';
import ResizableSidePanel from '@/components/helena/ResizableSidePanel';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/utils';
import { PageToolbar, PageToolbarSpacer } from '@/components/layout/PageToolbar';

// One page pattern for Wissen and Belege (docs/ui-system.md §8, WissenOrdner.dc.html):
// the sidebar tree picks the place, the page shows a header (mono eyebrow with the path,
// title, search, "+ Neu"), filter pills, the list, and the preview of the selected entry
// in a resizable panel on the right (under the list on narrow screens).

export interface KnowledgeCrumb {
  label: string;
  href?: string;
  onSelect?: () => void;
}

export function KnowledgeEyebrow({
  crumbs,
  className,
}: {
  crumbs: KnowledgeCrumb[];
  className?: string;
}) {
  return (
    <nav
      aria-label={crumbs.map((crumb) => crumb.label).join(' / ')}
      className={cn('ds-knowledge-path', className)}
    >
      {crumbs.map((crumb, index) => (
        <Fragment key={`${index}:${crumb.label}`}>
          {index > 0 && (
            <span aria-hidden="true" className="opacity-60">
              {index === 1 ? '·' : '/'}
            </span>
          )}
          {crumb.href ? (
            <Link href={crumb.href} className="truncate rounded-sm hover:underline">
              {crumb.label}
            </Link>
          ) : crumb.onSelect ? (
            <button
              type="button"
              onClick={crumb.onSelect}
              className="truncate rounded-sm uppercase hover:underline"
            >
              {crumb.label}
            </button>
          ) : (
            <span className="truncate">{crumb.label}</span>
          )}
        </Fragment>
      ))}
    </nav>
  );
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

export function KnowledgePill({
  active,
  children,
  count,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className="ds-pill ds-pill-button"
      data-tone={active ? 'active' : 'neutral'}
    >
      {children}
      {count !== undefined && count > 0 && <span className="ds-pill-count">{count}</span>}
    </button>
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
    <div className="grid grid-cols-[28px_minmax(0,1fr)_minmax(0,190px)_120px] gap-3 px-3.5 font-mono text-[10px] font-medium tracking-[.23em] text-muted-foreground/80 uppercase max-sm:grid-cols-[22px_minmax(0,1fr)_auto]">
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
}) {
  return (
    <div
      {...rowProps}
      data-knowledge-row={index}
      data-selected={selected ? '' : undefined}
      className={cn(
        'group relative grid min-h-11 shrink-0 grid-cols-[28px_minmax(0,1fr)_minmax(0,190px)_120px] items-center gap-3 rounded-xl px-3.5 max-sm:grid-cols-[22px_minmax(0,1fr)_auto]',
        selected
          ? 'bg-accent text-accent-foreground shadow-[0_2px_6px_#0003,inset_0_1px_#ffffff0c]'
          : onClick && 'hover:bg-muted',
      )}
    >
      <Icon size={18} strokeWidth={1.6} className="text-muted-foreground" />
      {onClick ? (
        <button
          type="button"
          data-row-button=""
          aria-current={selected ? 'true' : undefined}
          title={title}
          onClick={onClick}
          onDoubleClick={onDoubleClick}
          className="min-w-0 truncate rounded-md text-start text-[13px] outline-none after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:after:bg-foreground/5"
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
  crumbs,
  title,
  search,
  actions,
  pills,
  children,
  footer,
  preview,
  previewLabel,
  frameProps,
}: {
  crumbs: KnowledgeCrumb[];
  title: ReactNode;
  search?: ReactNode;
  actions?: ReactNode;
  pills?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  preview?: ReactNode;
  previewLabel?: string;
  frameProps?: Record<string, unknown>;
}) {
  const t = useTranslations('files.knowledge');
  const wide = useMediaQuery('(min-width: 1024px)');
  const label = previewLabel ?? t('preview');
  const previewBody = preview ? (
    <div className="flex min-h-0 flex-1 flex-col gap-3.5">
      <MonoLabel>{label}</MonoLabel>
      {preview}
    </div>
  ) : null;
  // The page's header (the shell) names the place; its search, filters and "+ Neu" sit in
  // the toolbar row like on every page, and a deeper folder shows its path over the list.
  return (
    <div {...frameProps} data-project-knowledge className="ds-knowledge">
      <PageToolbar>
        {pills}
        <PageToolbarSpacer />
        {search}
        {actions}
      </PageToolbar>
      <section className="ds-knowledge-main">
        <h1 className="sr-only" dir="auto">
          {title}
        </h1>
        {crumbs.length > 2 && <KnowledgeEyebrow crumbs={crumbs.slice(1)} />}
        {children}
        {footer}
      </section>
      {previewBody &&
        (wide ? (
          <ResizableSidePanel label={label} reserve={480}>
            <div className="ds-knowledge-preview">{previewBody}</div>
          </ResizableSidePanel>
        ) : (
          <aside aria-label={label} className="ds-knowledge-preview is-stacked">
            {previewBody}
          </aside>
        ))}
    </div>
  );
}
