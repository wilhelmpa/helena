import { Fragment, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

// Every page is made of these (docs/design-system.md §3, owner 30.09., O104):
//   PageHeader   ONE 56px bar. At its left a compact breadcrumb whose last part IS the page's
//                title (18px, the earlier parts - project, area, parent page - quiet and
//                clickable, 13px); there is no second title beside it. Right after it, in the
//                bar's own slot (`bar`), every control of the page at fixed places: views ->
//                search/filters/view -> actions (see PageToolbar); the main action ends the bar.
//                Room gets short in steps: the breadcrumb gives up its middle ("VOL > ... >
//                Page"), then the toolbar folds (search to an icon, actions into "...", tabs into
//                a choice). Below 900px the controls fold under the breadcrumb into a 44px row of
//                the same bar.
//   PageBody     24px top, 32px sides, 48px bottom; the full width, no own container.

export type Crumb = { label: string; href?: string };

export function PageHeader({
  crumbs = [],
  title,
  actions,
  actionsRef,
  barRef,
  bar,
  lead,
  titleRef,
}: {
  // Where the page sits, before its own name: project, area, parent page.
  crumbs?: Crumb[];
  // The page's own name: the last part of the breadcrumb.
  title: ReactNode;
  actions?: ReactNode;
  // The element a page's toolbar puts its main action into (see ShellHeaderActionsSlotCtx).
  actionsRef?: Ref<HTMLDivElement>;
  // The element a page's toolbar renders its controls into (see ShellHeaderSlotCtx).
  barRef?: Ref<HTMLDivElement>;
  bar?: ReactNode;
  // Before the breadcrumb: the sidebar button on a narrow window.
  lead?: ReactNode;
  titleRef?: Ref<HTMLDivElement>;
}) {
  const heading = useRef<HTMLElement | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  // The middle parts give way first when the breadcrumb does not fit: "VOL > ... > Page".
  useLayoutEffect(() => {
    const node = heading.current;
    if (!node) return;
    let widest = 0;
    const title = node.querySelector<HTMLElement>('.ds-page-title');
    const fit = () => {
      // The page's own name is cut, or the row is longer than its room.
      const overflowing =
        node.scrollWidth > node.clientWidth + 1 ||
        (title != null && title.scrollWidth > title.clientWidth + 1);
      if (overflowing) {
        setCollapsed(true);
        widest = node.clientWidth;
      } else if (node.clientWidth > widest + 24) setCollapsed(false);
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(fit);
    observer.observe(node);
    return () => observer.disconnect();
  }, [crumbs.length]);
  const foldable = crumbs.length > 1;
  return (
    <header className="ds-page-header" data-app-header="">
      {lead}
      <div className="ds-page-heading" ref={titleRef}>
        <nav
          className="ds-page-crumbs"
          aria-label={typeof title === 'string' ? title : undefined}
          ref={heading}
          data-collapsed={collapsed && foldable ? 'true' : undefined}
        >
          {crumbs.map((crumb, index) => (
            <Fragment key={`${index}:${crumb.label}`}>
              <span className="ds-page-crumb" data-crumb={index === 0 ? 'first' : 'middle'}>
                {crumb.href ? (
                  <Link href={crumb.href}>{crumb.label}</Link>
                ) : (
                  <span>{crumb.label}</span>
                )}
                <ChevronRight className="ds-page-crumb-sep" aria-hidden="true" />
              </span>
              {index === 0 && foldable && (
                <span className="ds-page-crumb-gap" aria-hidden="true">
                  <span>{'\u2026'}</span>
                  <ChevronRight className="ds-page-crumb-sep" />
                </span>
              )}
            </Fragment>
          ))}
          <h1 className="ds-page-title">{title}</h1>
        </nav>
      </div>
      <div className="ds-page-bar" ref={barRef} data-slot="app-page-bar">
        {bar}
      </div>
      <div className="ds-page-actions" ref={actionsRef} data-slot="app-header-page">
        {actions}
      </div>
    </header>
  );
}

// The page content with the one padding every page has. `bleed` lets a board or a
// canvas reach the edges (it still starts under the same header).
export function PageBody({
  children,
  bleed = false,
  reading = false,
  className,
}: {
  children: ReactNode;
  bleed?: boolean;
  // Docs: centred reading text, at most 760px wide.
  reading?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`ds-page-body ${bleed ? 'is-bleed' : ''} ${reading ? 'is-reading' : ''} ${className ?? ''}`}
    >
      {children}
    </div>
  );
}
