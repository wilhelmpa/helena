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
    : data?.variant === 'straight'
      ? getStraightPath({ sourceX, sourceY, targetX, targetY })[0]
      : getSmoothStepPath({
          sourceX,
          sourceY,
          targetX,
          targetY,
          sourcePosition,
          targetPosition,
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
          strokeWidth: active ? 2 : data?.strong ? 1.5 : data?.task ? 1 : 1.25,
          strokeOpacity: data?.dimmed
            ? 0.12
            : active
              ? 0.9
              : data?.task
                ? 0.5
                : data?.accent
                  ? 0.42
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
