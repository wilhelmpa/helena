import { BANDS, MARK_GRID, MARK_RADIUS, TILE, markLayers } from '@helena/brand';

// The Helena mark (packages/brand): Helena's torch as pixel art on a 16-pixel grid on
// Hermes' ink tile, the same drawing as the favicon and the app icons. Hermes carries
// the caduceus, Helena the torch. The tile is ink in both themes, so the art keeps
// Hermes' gold, amber and bronze everywhere. `detail` "large" adds the Hermes shadow
// hairlines; use it from 64px up. Sizes that are whole multiples of 16px, or of 8px on
// a 2× screen (16, 24, 32, 48, 80), keep the pixels crisp. Decorative; the caller sets
// the size through `className`.
export default function HelenaMark({
  className,
  detail = 'small',
}: {
  className?: string;
  detail?: 'small' | 'large';
}) {
  return (
    <svg
      viewBox={`0 0 ${MARK_GRID} ${MARK_GRID}`}
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <rect width={MARK_GRID} height={MARK_GRID} rx={MARK_RADIUS} fill={TILE} />
      <g shapeRendering={detail === 'small' ? 'crispEdges' : undefined}>
        {markLayers(detail).map((layer, i) => (
          <path key={i} d={layer.d} fill={BANDS.dark[layer.color]} />
        ))}
      </g>
    </svg>
  );
}
