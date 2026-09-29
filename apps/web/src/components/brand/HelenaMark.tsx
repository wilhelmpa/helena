import type { CSSProperties } from 'react';
import { DISC_RADIUS, orbStops, type OrbScheme } from '@helena/brand';
import { cn } from '@/lib/utils';

const gradient = (scheme: OrbScheme) => `linear-gradient(45deg, ${orbStops(scheme).join(', ')})`;
// The disc's share of the box, as in the 100×100 icon grid (packages/brand).
const DISC_INSET = `${50 - DISC_RADIUS.bare}%`;

// The AVA mark, the app's voice orb (packages/brand).
//   small (default) a disc in the orb's violet-to-pink gradient: at sidebar and form
//                   sizes (up to 48px) the particle render would only be noise. Deeper
//                   colours in the light theme, brighter in the dark one.
//   large           the particle render itself (public/brand/orb-*.png), for the sign-in
//                   panel and About at 80px and more.
// `onInk` keeps the dark-surface version in both themes (BrandHero's ink panel).
export default function HelenaMark({
  className,
  detail,
  onInk = false,
}: {
  className?: string;
  detail?: 'small' | 'large';
  onInk?: boolean;
}) {
  if (detail === 'large') {
    return (
      <span
        aria-hidden="true"
        className={cn(
          'inline-block bg-contain bg-center bg-no-repeat',
          onInk
            ? 'bg-[url(/brand/orb-dark.png)]'
            : 'bg-[url(/brand/orb-light.png)] dark:bg-[url(/brand/orb-dark.png)]',
          className,
        )}
      />
    );
  }
  const style = {
    '--ava-orb-light': gradient('light'),
    '--ava-orb-dark': gradient('dark'),
    inset: DISC_INSET,
  } as CSSProperties;
  return (
    <span aria-hidden="true" className={cn('relative inline-block', className)}>
      <span
        style={style}
        className={cn(
          'absolute rounded-full',
          onInk
            ? 'bg-(image:--ava-orb-dark)'
            : 'bg-(image:--ava-orb-light) dark:bg-(image:--ava-orb-dark)',
        )}
      />
    </span>
  );
}
