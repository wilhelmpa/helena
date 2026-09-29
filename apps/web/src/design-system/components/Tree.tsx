'use client';

import {
  Children,
  Fragment,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type AnchorHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { useLocalValue } from '@/hooks/useLocalValue';
import { SearchField } from './Field';
import { StatusDot, type StatusDotTone } from './StatusDot';

// One tree for the sidebar and every other tree (docs/design-system.md §4, §7): rows of
// one height, 16px indent per level from one text edge, exactly one marked row (the
// caller decides which, see nav/activeMatch), no headings. Every row with children has a
// small arrow after its label (so nothing moves). On level 1 any number of areas can be
// open at once (owner, 28.09.): the area holding the current page opens when you get
// there, and an area only closes when you close it. Deeper groups fold one by one and
// remember it per user. A status dot and a count stand at the end of the row.

// The elements a row's children really render: fragments are opened, null and false are
// dropped (an empty list is no list, so it gets no arrow).
function childElements(children: ReactNode): ReactElement[] {
  const found: ReactElement[] = [];
  for (const child of Children.toArray(children)) {
    if (!isValidElement<{ children?: ReactNode }>(child)) continue;
    if (child.type === Fragment) found.push(...childElements(child.props.children));
    else found.push(child);
  }
  return found;
}

const LevelCtx = createContext(0);
type Accordion = { isOpen: (id: string) => boolean; toggle: (id: string) => void } | null;
const AccordionCtx = createContext<Accordion>(null);

export function Tree({
  children,
  label,
  className,
  activeSection,
}: {
  children: ReactNode;
  label: string;
  className?: string;
  // The level-1 area holding the current page: it opens when the page changes.
  activeSection?: string | null;
}) {
  const active = activeSection ?? null;
  const [state, setState] = useState<{ forActive: string | null; openIds: string[] }>({
    forActive: active,
    openIds: active ? [active] : [],
  });
  // A new page opens the area that holds it and leaves the other open areas open.
  const openIds = useMemo(
    () =>
      state.forActive === active || !active || state.openIds.includes(active)
        ? state.openIds
        : [...state.openIds, active],
    [state, active],
  );
  const accordion = useMemo(
    () => ({
      isOpen: (id: string) => openIds.includes(id),
      toggle: (id: string) =>
        setState({
          forActive: active,
          openIds: openIds.includes(id) ? openIds.filter((item) => item !== id) : [...openIds, id],
        }),
    }),
    [active, openIds],
  );
  return (
    <div role="tree" aria-label={label} className={`ds-tree ${className ?? ''}`}>
      <AccordionCtx.Provider value={accordion}>
        <LevelCtx.Provider value={0}>{children}</LevelCtx.Provider>
      </AccordionCtx.Provider>
    </div>
  );
}

// A quiet line of text in the tree ("no chats yet"), at the indent of the rows around it.
export function TreeNote({ children }: { children: ReactNode }) {
  const level = useContext(LevelCtx);
  return (
    <p className="ds-tree-note" style={{ '--ds-tree-level': level } as React.CSSProperties}>
      {children}
    </p>
  );
}

// The search field of a tree section, at the indent of the rows it filters.
export function TreeSearch({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const level = useContext(LevelCtx);
  return (
    <div className="ds-tree-search" style={{ '--ds-tree-level': level } as React.CSSProperties}>
      <SearchField
        icon={<Search aria-hidden="true" />}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={label}
        aria-label={label}
        dir="auto"
      />
    </div>
  );
}

// The small gap that separates the parts of the sidebar instead of a heading.
export function TreeGap() {
  return <div className="ds-tree-gap" aria-hidden="true" />;
}

export type TreeItemProps = {
  // Needed on level-1 rows with children (the accordion) and on folding groups.
  id?: string;
  label: ReactNode;
  // A link row; without one the row is a button (onSelect) or a plain group row.
  href?: string;
  onSelect?: () => void;
  active?: boolean;
  count?: number | string | null;
  dot?: StatusDotTone | null;
  // Shown in the row: a hover "+" (TreeAction) or an options menu.
  actions?: ReactNode;
  // Leading icon, only shown in the collapsed sidebar rail.
  icon?: ReactNode;
  // A small symbol before the label in every state (the kind of a folder of Wissen), and
  // the kind that colours it.
  mark?: ReactNode;
  markKind?: string;
  // Children do not fold (e.g. a folder tree that folds on its own).
  fixed?: boolean;
  // Deeper groups: key under which the folded state is remembered (per user).
  storageKey?: string;
  defaultOpen?: boolean;
  // A descendant is the marked row: the row opens (and remembers it).
  containsActive?: boolean;
  children?: ReactNode;
  className?: string;
  title?: string;
  // Extra props for the row element (drag & drop, context menu …).
  rowProps?: Omit<AnchorHTMLAttributes<HTMLElement>, 'href' | 'className' | 'children' | 'type'> &
    Record<`data-${string}`, string | undefined>;
};

export function TreeItem({
  id,
  label,
  href,
  onSelect,
  active = false,
  count,
  dot,
  actions,
  icon,
  mark,
  markKind,
  fixed = false,
  storageKey,
  defaultOpen = true,
  containsActive = false,
  children,
  className,
  title,
  rowProps,
}: TreeItemProps) {
  const level = useContext(LevelCtx);
  const accordion = useContext(AccordionCtx);
  // A group of exactly one plain link is that link (owner, O89): no arrow, no list — the
  // row itself goes there and is marked when the link is. A row with a page of its own, with
  // actions or with nothing to fold (`fixed`) keeps its shape.
  const entries = childElements(children);
  const only =
    !href && !actions && !fixed && entries.length === 1 && entries[0]!.type === TreeItem
      ? (entries[0]!.props as TreeItemProps)
      : null;
  const single = only?.href && childElements(only.children).length === 0 ? only : null;
  if (single) {
    href = single.href;
    active = active || Boolean(single.active);
    count ??= single.count;
  }
  const hasChildren = entries.length > 0 && !single;
  const collapsible = hasChildren && !fixed;
  const inAccordion = collapsible && level === 0 && accordion != null && id != null;
  const [stored, setStored] = useLocalValue(
    collapsible && !inAccordion && storageKey ? `helena:tree:${storageKey}` : '',
  );
  const open = !collapsible
    ? true
    : inAccordion
      ? accordion.isOpen(id)
      : stored === null
        ? defaultOpen || containsActive
        : stored === '1';
  // An active descendant opens a deeper group, and it stays open.
  useEffect(() => {
    if (collapsible && !inAccordion && containsActive && storageKey && stored === '0')
      setStored('1');
  }, [collapsible, inAccordion, containsActive, storageKey, stored, setStored]);
  // The marked row stays in sight when the sidebar is longer than the screen.
  const line = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active) line.current?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);
  const toggle = () => {
    if (inAccordion) accordion.toggle(id);
    else if (storageKey) setStored(open ? '0' : '1');
  };

  const inner = (
    <>
      {icon && <span className="ds-tree-icon">{icon}</span>}
      {mark && (
        <span className="ds-tree-mark" data-kind={markKind}>
          {mark}
        </span>
      )}
      <span className="ds-tree-label">{label}</span>
      {collapsible && (
        <span
          className="ds-tree-chevron"
          role="button"
          tabIndex={-1}
          aria-hidden="true"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            toggle();
          }}
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
      )}
      {dot && <StatusDot tone={dot} />}
      <span className="ds-tree-fill" />
      {count != null && count !== '' && count !== 0 && (
        <span className="ds-tree-count">{count}</span>
      )}
    </>
  );

  const common = {
    className: `ds-tree-row ${active ? 'is-active' : ''} ${className ?? ''}`,
    'data-level': level,
    style: { '--ds-tree-level': level } as React.CSSProperties,
    title,
    'aria-current': active ? ('page' as const) : undefined,
    'aria-expanded': collapsible ? open : undefined,
    ...rowProps,
  };

  // A collapsible row without a page of its own folds on click.
  const row = href ? (
    <Link href={href} role="treeitem" aria-selected={active} {...common}>
      {inner}
    </Link>
  ) : (
    <button
      type="button"
      role="treeitem"
      aria-selected={active}
      {...common}
      onClick={() => (onSelect ? onSelect() : collapsible ? toggle() : undefined)}
    >
      {inner}
    </button>
  );

  return (
    <div className="ds-tree-item" role="none">
      <div className="ds-tree-line" ref={line}>
        {row}
        {actions && <span className="ds-tree-actions">{actions}</span>}
      </div>
      {hasChildren && open && (
        <div role="group" className="ds-tree-children">
          <LevelCtx.Provider value={level + 1}>{children}</LevelCtx.Provider>
        </div>
      )}
    </div>
  );
}

// The hover "+" / "…" of a row: same place, same size on every row.
export function TreeAction({
  label,
  onClick,
  href,
  children,
}: {
  label: string;
  onClick?: () => void;
  href?: string;
  children: ReactNode;
}) {
  return href ? (
    <Link href={href} className="ds-tree-action" aria-label={label} title={label}>
      {children}
    </Link>
  ) : (
    <button
      type="button"
      className="ds-tree-action"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function useTreeLevel() {
  return useContext(LevelCtx);
}
