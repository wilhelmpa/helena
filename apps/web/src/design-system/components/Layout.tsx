import type { CSSProperties, ElementType, HTMLAttributes, ReactNode } from 'react';

// Layout primitives (docs/ui-framework.md §Abstände). Features and routes place things
// with these instead of Tailwind spacing classes (p-4, gap-2, space-y-3 …), which eslint
// rejects there: every distance comes from the one scale in tokens.css.
//
//   Space  0 · 1 (4px) · 2 (8) · 3 (12) · 4 (16) · 5 (24) · 6 (32) · 7 (48)
export type Space = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

const space = (value: Space | undefined) =>
  value === undefined ? undefined : value === 0 ? '0' : `var(--space-${value})`;

type Align = 'start' | 'center' | 'end' | 'stretch' | 'baseline';
type Justify = 'start' | 'center' | 'end' | 'between';

type BoxProps = Omit<HTMLAttributes<HTMLElement>, 'style'> & {
  as?: ElementType;
  // Padding on all sides, or per axis.
  pad?: Space;
  padX?: Space;
  padY?: Space;
  // Takes the remaining room of a flex parent and may shrink below its content.
  grow?: boolean;
  children?: ReactNode;
  style?: CSSProperties;
};

function boxStyle({ pad, padX, padY, grow }: BoxProps): CSSProperties {
  return {
    ...(pad !== undefined ? { padding: space(pad) } : {}),
    ...(padX !== undefined ? { paddingInline: space(padX) } : {}),
    ...(padY !== undefined ? { paddingBlock: space(padY) } : {}),
    ...(grow ? { flex: '1 1 0%', minWidth: 0, minHeight: 0 } : {}),
  };
}

function strip<T extends BoxProps>(props: T) {
  const { pad: _pad, padX: _padX, padY: _padY, grow: _grow, ...rest } = props;
  return rest;
}

// A plain block with padding from the scale.
export function Box(props: BoxProps) {
  const { as: Tag = 'div', style, className, ...rest } = strip(props);
  return <Tag className={className} style={{ ...boxStyle(props), ...style }} {...rest} />;
}

// Children under each other, `gap` apart.
export function Stack({ gap = 3, align, ...props }: BoxProps & { gap?: Space; align?: Align }) {
  const { as: Tag = 'div', style, className, ...rest } = strip(props);
  return (
    <Tag
      className={`ds-stack ${className ?? ''}`}
      style={{
        gap: space(gap),
        ...(align
          ? { alignItems: align === 'start' || align === 'end' ? `flex-${align}` : align }
          : {}),
        ...boxStyle(props),
        ...style,
      }}
      {...rest}
    />
  );
}

// Children side by side on one line (or wrapping), `gap` apart, centred vertically.
export function Inline({
  gap = 2,
  align = 'center',
  justify = 'start',
  wrap = false,
  ...props
}: BoxProps & { gap?: Space; align?: Align; justify?: Justify; wrap?: boolean }) {
  const { as: Tag = 'div', style, className, ...rest } = strip(props);
  return (
    <Tag
      className={`ds-inline ${className ?? ''}`}
      style={{
        gap: space(gap),
        alignItems: align === 'start' || align === 'end' ? `flex-${align}` : align,
        justifyContent:
          justify === 'between'
            ? 'space-between'
            : justify === 'start' || justify === 'end'
              ? `flex-${justify}`
              : justify,
        flexWrap: wrap ? 'wrap' : 'nowrap',
        ...boxStyle(props),
        ...style,
      }}
      {...rest}
    />
  );
}

// A responsive grid of cards: as many columns of at least `min` as fit (the dashboard,
// a gallery), a fixed number of equal columns, or `split` (a main column and a side
// column, 2:1). Every fixed layout becomes one column below 900px.
export function Grid({
  gap = 4,
  min = 'card',
  columns,
  split = false,
  ...props
}: BoxProps & {
  gap?: Space;
  min?: 'tile' | 'card' | 'wide';
  columns?: 2 | 3 | 4;
  split?: boolean;
}) {
  const { as: Tag = 'div', style, className, ...rest } = strip(props);
  return (
    <Tag
      className={`ds-grid ${className ?? ''}`}
      data-min={columns || split ? undefined : min}
      data-cols={columns}
      data-split={split ? '' : undefined}
      style={{ gap: space(gap), ...boxStyle(props), ...style }}
      {...rest}
    />
  );
}

// Text on the type scale (docs/design-system.md §2): 11 mono label, 12 meta, 13 standard,
// 15 reading, 18 section title. Tone picks one of the three text levels or a status.
export type TextSize = 'xs' | 'sm' | 'md' | 'lg';
export type TextTone = 'default' | 'muted' | 'faint' | 'accent' | 'danger' | 'success' | 'warning';

export function Text({
  as: Tag = 'span',
  size = 'sm',
  tone = 'default',
  weight,
  mono = false,
  truncate = false,
  tabular = false,
  className,
  ...props
}: Omit<HTMLAttributes<HTMLElement>, 'color'> & {
  as?: ElementType;
  size?: TextSize;
  tone?: TextTone;
  weight?: 'regular' | 'medium' | 'semibold';
  mono?: boolean;
  truncate?: boolean;
  tabular?: boolean;
}) {
  return (
    <Tag
      className={`ds-text ${className ?? ''}`}
      data-size={size}
      data-tone={tone}
      data-weight={weight}
      data-mono={mono ? '' : undefined}
      data-truncate={truncate ? '' : undefined}
      data-tabular={tabular ? '' : undefined}
      {...props}
    />
  );
}
