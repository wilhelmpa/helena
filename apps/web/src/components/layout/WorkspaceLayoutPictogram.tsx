'use client';

import type { WorkspaceLayout } from '@/extensions/workspaceLayouts';
import { panelTool } from '@/extensions/panelTools';
import { cn } from '@/lib/utils';

// A small picture of a workspace layout, drawn from its areas, so a plugin's layout gets
// one too: the page as lines of text, each tool as a filled box with the tool's icon (the
// main area without a fixed tool as a plain box). Areas on the page side come first, the
// panel's after them, as on screen. `icon` draws it at the size of the header's icons.
const WIDTH = 40;
const HEIGHT = 26;
const GAP = 2;

function weight(layout: WorkspaceLayout, index: number): number {
  const area = layout.areas[index]!;
  const hasPage = layout.areas.some((entry) => entry.shows === 'page');
  if (area.side === 'panel') {
    const panel = layout.areas.filter((entry) => entry.side === 'panel').length;
    const pageSide = layout.areas.some((entry) => entry.side === 'page');
    return (pageSide ? 3 : 6) / panel;
  }
  if (area.shows === 'page' || !hasPage) return 3;
  return 2;
}

export default function WorkspaceLayoutPictogram({
  layout,
  icon = false,
  className,
}: {
  layout: WorkspaceLayout;
  icon?: boolean;
  className?: string;
}) {
  const ordered = [
    ...layout.areas.map((area, index) => ({ area, index })).filter((x) => x.area.side === 'page'),
    ...layout.areas.map((area, index) => ({ area, index })).filter((x) => x.area.side === 'panel'),
  ];
  const total = ordered.reduce((sum, { index }) => sum + weight(layout, index), 0);
  const room = WIDTH - GAP * (ordered.length + 1);
  let x = GAP;
  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      // Sized inline: a menu row sizes the icons in it to 16px through a class.
      style={icon ? { width: 24, height: 16 } : { width: 44, height: 28 }}
      className={cn('shrink-0', className)}
      aria-hidden="true"
    >
      <rect
        x="0.5"
        y="0.5"
        width={WIDTH - 1}
        height={HEIGHT - 1}
        rx="3"
        className="fill-none stroke-current opacity-50"
      />
      {ordered.map(({ area, index }) => {
        const width = (room * weight(layout, index)) / total;
        const left = x;
        x += width + GAP;
        const top = GAP;
        const height = HEIGHT - GAP * 2;
        if (area.shows === 'page') {
          return (
            <g key={area.id} className="stroke-current opacity-60">
              {!icon &&
                [0, 1, 2].map((line) => (
                  <line
                    key={line}
                    x1={left + 2}
                    x2={left + width * (line === 2 ? 0.55 : 0.85)}
                    y1={top + 4 + line * 4}
                    y2={top + 4 + line * 4}
                    strokeWidth="1.2"
                    strokeLinecap="round"
                  />
                ))}
            </g>
          );
        }
        const Icon = area.tool && area.shows === 'tool' ? panelTool(area.tool)?.Icon : undefined;
        const glyph = Math.min(width - 1.5, height - 4, 10);
        return (
          <g key={area.id}>
            <rect
              x={left}
              y={top}
              width={width}
              height={height}
              rx="1.5"
              className="fill-current opacity-25"
            />
            {Icon && !icon && glyph >= 5 ? (
              // The tool's icon (24 units) scaled into the box by a nested viewport.
              <svg
                x={left + (width - glyph) / 2}
                y={top + (height - glyph) / 2}
                width={glyph}
                height={glyph}
                style={{ width: glyph, height: glyph }}
                viewBox="0 0 24 24"
              >
                <Icon className="size-6" />
              </svg>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
