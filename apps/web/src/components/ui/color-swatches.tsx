import { cn } from '@/lib/utils';

// A grid of color swatches to pick one from, the one swatch picker of the app (settings
// colors, sticky notes). The chosen one carries a ring; each names its color for a
// screen reader, since the color alone is all it shows.
export function ColorSwatches({
  colors,
  value,
  onChange,
  labelOf = (color) => color,
  className,
}: {
  colors: readonly string[];
  value: string;
  onChange: (color: string) => void;
  labelOf?: (color: string) => string;
  className?: string;
}) {
  const selected = value.trim().toLowerCase();
  return (
    <div className={cn('grid grid-cols-8 gap-1.5', className)}>
      {colors.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={labelOf(color)}
          aria-pressed={selected === color.toLowerCase()}
          onClick={() => onChange(color)}
          className={cn(
            'size-6 cursor-pointer rounded-md ring-offset-background transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
            selected === color.toLowerCase() && 'ring-2 ring-ring ring-offset-2',
          )}
          style={{ backgroundColor: color }}
        />
      ))}
    </div>
  );
}
