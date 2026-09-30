import type { CSSProperties, ElementType, HTMLAttributes, ReactNode, Ref } from 'react';
import type { Space } from './Layout';

// THE box of a page (docs/ui-framework.md §19, owner 30.09.: "gleiche Boxen"): surface-1, radius
// 12, the card shadow, 16px inside, 12px between its parts. Every card, tile, form group and
// info block on a page is this one component; a page never draws a box with border/bg classes.
//
//   title      13/520, the box's name; `eyebrow` instead is the small mono label of a widget
//              ("LÄUFT GERADE") - a figure tile or dashboard section, not a form card
//   meta       12px under the head; actions stand at the right of the head
//   pad        'normal' 16 (default), 'tight' 12 (a card inside a chart or a grid of small
//              cards), 'roomy' 24 (a document), 'list' 4 (rows with a hover fill of their own,
//              like ListBox padded), 'none' (a table that has its own cells)
//   gap        the distance between the parts inside (Space, default 12px)
//   tone       'inset' is a box in a box: surface-2, radius 8, no shadow, no frame of its own;
//              'node' is a fixed-size card of a chart (the org chart's agent): the same box, its
//                     content centred, the same side padding, `selected` draws the accent ring;
//              'popover' is the box that floats over a page (hover card): the overlay shadow
//   as         the element (section, article, li, a - a link card)
export type CardPad = 'none' | 'list' | 'tight' | 'normal' | 'roomy';
export type CardTone = 'default' | 'inset' | 'node' | 'popover';

export function Card({
  as: Tag = 'div',
  title,
  eyebrow,
  meta,
  actions,
  children,
  className,
  interactive = false,
  selected = false,
  pad = 'normal',
  gap,
  tone = 'default',
  layout = 'column',
  headingAs,
  style,
  tooltip,
  ...props
}: Omit<HTMLAttributes<HTMLElement>, 'title' | 'style'> & {
  as?: ElementType;
  title?: ReactNode;
  eyebrow?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  interactive?: boolean;
  selected?: boolean;
  pad?: CardPad;
  gap?: Space;
  tone?: CardTone;
  // The head's element where it is a real heading of the page (a dashboard section: 'h2').
  headingAs?: 'h2' | 'h3';
  // A row card (a media object: a mark beside its text) instead of a column.
  layout?: 'column' | 'row';
  style?: CSSProperties;
  // The native tooltip of the whole card (`title` is the head).
  tooltip?: string;
  // A link card or a button card keeps its element's own attributes.
  href?: string;
  type?: string;
  disabled?: boolean;
  // A dragged or measured card (React 19: a ref is a prop).
  ref?: Ref<HTMLElement>;
  onClick?: HTMLAttributes<HTMLElement>['onClick'];
}) {
  const head = title ?? eyebrow;
  const Heading: ElementType = headingAs ?? 'div';
  return (
    <Tag
      className={`ds-card ${interactive ? 'is-interactive' : ''} ${selected && tone !== 'node' ? 'is-selected' : ''} ${className ?? ''}`}
      data-pad={pad === 'normal' ? undefined : pad}
      data-tone={tone === 'default' ? undefined : tone}
      data-selected={tone === 'node' && selected ? '' : undefined}
      data-layout={layout === 'column' ? undefined : layout}
      title={tooltip}
      style={gap === undefined ? style : { gap: gap === 0 ? 0 : `var(--space-${gap})`, ...style }}
      {...props}
    >
      {(head || actions) && (
        <div className="ds-card-head">
          {title ? <Heading className="ds-card-title">{title}</Heading> : null}
          {!title && eyebrow ? (
            <Heading className="ds-card-eyebrow ds-mono-label">{eyebrow}</Heading>
          ) : null}
          {actions && <div className="ds-card-actions">{actions}</div>}
        </div>
      )}
      {meta && <div className="ds-card-meta">{meta}</div>}
      {children}
    </Tag>
  );
}
