'use client';

import {
  BaseEdge,
  getSmoothStepPath,
  getStraightPath,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';
import { useSyncExternalStore } from 'react';
import { useMediaQuery } from '@/hooks/useMediaQuery';

export type FlowEdge = Edge<
  {
    active: boolean;
    accent?: string;
    rail?: boolean;
    // The height of the shared line all reports of a leader hang from (tree view).
    busY?: number;
    variant?: 'straight' | 'step';
    strong?: boolean;
    task?: boolean;
    dimmed?: boolean;
  },
  'flow'
>;

function subscribeVisibility(onChange: () => void) {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}

// Whether the tab is visible; a hidden tab stops the moving delegation dots.
function usePageVisible() {
  return useSyncExternalStore(
    subscribeVisibility,
    () => !document.hidden,
    () => true,
  );
}

// A tree line: straight down from the leader to the shared line of its row, along it, and
// straight down to the report – every report of a row hangs from the same line, so one sees
// at a glance whose they are (owner 29.09.).
export function busPath(sx: number, sy: number, tx: number, ty: number, busY: number): string {
  if (Math.abs(tx - sx) < 1) return `M ${sx},${sy} L ${tx},${ty}`;
  const dir = tx > sx ? 1 : -1;
  const r = Math.max(0, Math.min(8, Math.abs(tx - sx) / 2, busY - sy, ty - busY));
  return (
    `M ${sx},${sy} L ${sx},${busY - r} Q ${sx},${busY} ${sx + dir * r},${busY} ` +
    `L ${tx - dir * r},${busY} Q ${tx},${busY} ${tx},${busY + r} L ${tx},${ty}`
  );
}

// A reporting line. A running delegation lights the line up and sends a dot of light
// from the manager to the agent; reduced motion keeps the lit line without the dot.
export default function OrganizationFlowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps<FlowEdge>) {
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const visible = usePageVisible();
  const active = Boolean(data?.active);
  const path = data?.rail
    ? `M ${sourceX},${sourceY} L ${sourceX},${targetY - 6} Q ${sourceX},${targetY} ${sourceX + 6},${targetY} L ${targetX},${targetY}`
    : data?.busY != null
      ? busPath(sourceX, sourceY, targetX, targetY, data.busY)
      : data?.variant === 'straight'
        ? getStraightPath({ sourceX, sourceY, targetX, targetY })[0]
        : getSmoothStepPath({
            sourceX,
            sourceY,
            targetX,
            targetY,
            sourcePosition,
            targetPosition,
            // An SVG path corner, not a CSS radius.
            borderRadius: 10,
            // One bus per parent (owner 28.09.): straight down, then every line to the
            // same level runs along one shared height just below the parent, then down to
            // each child — never a separate midpoint per child.
            centerY: targetY > sourceY + 40 ? sourceY + 24 : undefined,
          })[0];
  const color = active ? 'var(--status-listening)' : (data?.accent ?? 'var(--org-edge)');
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        className="organization-edge"
        style={{
          stroke: color,
          // Clear lines (owner, O71: the 1px lanes were too faint).
          strokeWidth: active ? 2.5 : data?.strong ? 2.5 : data?.task ? 1.5 : 2,
          strokeOpacity: data?.dimmed
            ? 0.12
            : active
              ? 0.95
              : data?.task
                ? 0.6
                : data?.accent
                  ? 0.7
                  : 1,
          strokeDasharray: data?.task ? '2 4' : active && reduced ? '4 5' : undefined,
          transition: 'stroke-opacity 200ms ease',
        }}
      />
      {active && !reduced && visible && (
        <circle r={3.5} className="organization-edge-dot" style={{ fill: color }}>
          <animateMotion dur="1.6s" repeatCount="indefinite" path={path} />
        </circle>
      )}
    </>
  );
}
