import { BRAND_VARIANT, wordmarkArt, type WordmarkSize } from '@helena/brand';
import { cn } from '@/lib/utils';

// The Helena wordmark (packages/brand). In the fackel and monogramm variants it is
// HELENA in ANSI Shadow, the block capitals of Hermes Agent's banner, drawn as paths
// in the theme's gold/amber/bronze bands (--helena-gold/-amber/-bronze in globals.css)
// or in the text colour; in the funke variant it is "Helena" set in DM Sans.
//   compact  the app's chrome (sidebar, share header): 21px tall, 75px wide, where the
//            art's units fall on whole device pixels of a 2× screen
//   full     sign-in panel and other large places; the caller sets the width
// `label` names it for assistive technology where it is the only text; next to a
// visible name it stays decorative.
export default function HelenaWordmark({
  size = 'compact',
  className,
  label,
}: {
  size?: WordmarkSize;
  className?: string;
  label?: string;
}) {
  const art = wordmarkArt(BRAND_VARIANT, size);
  const a11y = label
    ? ({ role: 'img', 'aria-label': label } as const)
    : ({ 'aria-hidden': true } as const);
  if (art.kind === 'type') {
    return (
      <span
        {...a11y}
        className={cn(
          'font-brand-type leading-none font-[650] tracking-[-0.025em] whitespace-nowrap',
          size === 'compact' ? 'text-[19px]' : 'text-[56px]',
          className,
        )}
      >
        {art.text}
      </span>
    );
  }
  const { width, height, rows } = art.art;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      {...a11y}
      className={cn(size === 'compact' ? 'h-[21px] w-auto' : 'h-auto w-[300px]', className)}
    >
      {rows.map((row, i) => (
        <path
          key={i}
          d={row.d}
          fill={art.tone === 'text' ? 'currentColor' : `var(--helena-${row.band})`}
        />
      ))}
    </svg>
  );
}
