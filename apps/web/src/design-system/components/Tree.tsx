'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type AnchorHTMLAttributes,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useLocalValue } from '@/hooks/useLocalValue';
import { StatusDot, type StatusDotTone } from './StatusDot';

// One tree for the sidebar and every other tree (docs/design-system.md §4, §7): rows of
// one height, 16px indent per level from one text edge, exactly one marked row (the
// caller decides which, see nav/activeMatch), no headings. Every row with children has a
// small arrow after its label (so nothing moves). On level 1 the tree is an accordion:
// exactly one area is open — the one holding the current page — until another is opened,
// which closes the rest. Deeper groups fold one by one and remember it per user. A
// status dot and a count stand at the end of the row.

const LevelCtx = createContext(0);
type Accordion = { openId: string | null; setOpenId: (id: string | null) => void } | null;
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
  // The level-1 area holding the current page: the one open area of the accordion.
  activeSection?: string | null;
}) {
  const [state, setState] = useState<{ forActive: string | null; openId: string | null }>({
    forActive: activeSection ?? null,
    openId: activeSection ?? null,
  });
  // A new page resets the accordion to the area that holds it.
  const openId =
    state.forActive === (activeSection ?? null) ? state.openId : (activeSection ?? null);
  const accordion = useMemo(
    () => ({
      openId,
      setOpenId: (id: string | null) => setState({ forActive: activeSection ?? null, openId: id }),
    }),
    [activeSection, openId],
  );
  return (
    <div role="tree" aria-label={label} className={`ds-tree ${className ?? ''}`}>
      <AccordionCtx.Provider value={accordion}>
        <LevelCtx.Provider value={0}>{children}</LevelCtx.Provider>
      </AccordionCtx.Provider>
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
  const hasChildren = Boolean(children);
  const collapsible = hasChildren && !fixed;
  const inAccordion = collapsible && level === 0 && accordion != null && id != null;
  const [stored, setStored] = useLocalValue(
    collapsible && !inAccordion && storageKey ? `helena:tree:${storageKey}` : '',
  );
  const open = !collapsible
    ? true
    : inAccordion
      ? accordion.openId === id
      : stored === null
        ? defaultOpen || containsActive
        : stored === '1';
  // An active descendant opens a deeper group, and it stays open.
  useEffect(() => {
    if (collapsible && !inAccordion && containsActive && storageKey && stored === '0')
      setStored('1');
  }, [collapsible, inAccordion, containsActive, storageKey, stored, setStored]);
  const toggle = () => {
    if (inAccordion) accordion.setOpenId(open ? null : id);
    else if (storageKey) setStored(open ? '0' : '1');
  };

  const inner = (
    <>
      {icon && <span className="ds-tree-icon">{icon}</span>}
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
      <div className="ds-tree-line">
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
