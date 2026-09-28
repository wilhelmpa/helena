'use client';

import {
  useCallback,
  useEffect,
  useRef,
  type FocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { Maximize } from 'lucide-react';
import {
  ControlButton,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  getNodesBounds,
  useNodesInitialized,
  useReactFlow,
  useStore,
  type Edge,
  type Node,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import OrganizationFlowEdge from './OrganizationFlowEdge';
import OrganizationChartNode from './OrganizationChartNode';
import {
  OrganizationRingGroup,
  OrganizationRingHub,
  OrganizationRingPill,
  OrganizationRingTask,
} from './OrganizationRingNodes';

const nodeTypes: NodeTypes = {
  agent: OrganizationChartNode,
  hub: OrganizationRingHub,
  group: OrganizationRingGroup,
  pill: OrganizationRingPill,
  task: OrganizationRingTask,
};
const edgeTypes = { flow: OrganizationFlowEdge };
const PADDING = 32;
// How long a click waits for a second one before it counts as a single click.
const DOUBLE_CLICK_MS = 240;

export interface ChartHover {
  node: Node;
  // The node's box, relative to the chart area.
  rect: { left: number; top: number; width: number; height: number };
  // The chart area's size, to keep the card inside it.
  width: number;
  height: number;
}

interface FlowProps {
  view: 'tree' | 'ring';
  nodes: Node[];
  edges: Edge[];
  orbits: number[];
  // Changes only when the chart itself changes (view, level), never on a click, so
  // opening an agent never moves or zooms the chart.
  fitKey: string;
  // A single click (or Enter) on a node.
  onActivate: (node: Node) => void;
  // A double click (or Shift+Enter): open the node's own ring.
  onDrill: (node: Node) => void;
  onPaneClick: () => void;
  onHover: (hover: ChartHover | null) => void;
  label: string;
}

export default function OrganizationChartFlow(props: FlowProps) {
  return (
    <ReactFlowProvider>
      <Flow {...props} />
    </ReactFlowProvider>
  );
}

function Flow({
  view,
  nodes,
  edges,
  orbits,
  fitKey,
  onActivate,
  onDrill,
  onPaneClick,
  onHover,
  label,
}: FlowProps) {
  const t = useTranslations('organization.chart');
  const flow = useReactFlow();
  const { resolvedTheme } = useTheme();
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const initialized = useNodesInitialized();
  const width = useStore((state) => state.width);
  const height = useStore((state) => state.height);
  // The viewport can only be set once React Flow's pan and zoom is attached.
  const panZoomReady = useStore((state) => state.panZoom != null);
  const fitted = useRef<string | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const pending = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);

  // Fit the whole chart, but never below a readable zoom: a tall tree is shown from its
  // top and can be panned, instead of shrinking forty cards to dots.
  const fit = useCallback(
    (animate: boolean): boolean => {
      if (!width || !height || nodes.length === 0) return false;
      // The nodes React Flow has measured (a node it never lays out — hidden, off the
      // ring — must not keep the chart from fitting at all).
      const internals = nodes
        .map((node) => flow.getInternalNode(node.id))
        .filter((node): node is NonNullable<typeof node> => node != null && !!node.measured.width);
      if (internals.length === 0) return false;
      const bounds = getNodesBounds(internals);
      const minimum = view === 'ring' ? 0.3 : 0.5;
      const zoom = Math.min(
        1,
        Math.max(
          minimum,
          Math.min(
            (width - PADDING * 2) / Math.max(1, bounds.width),
            (height - PADDING * 2) / Math.max(1, bounds.height),
          ),
        ),
      );
      const x = (width - bounds.width * zoom) / 2 - bounds.x * zoom;
      const y =
        bounds.height * zoom > height - PADDING * 2
          ? PADDING - bounds.y * zoom
          : (height - bounds.height * zoom) / 2 - bounds.y * zoom;
      void flow.setViewport({ x, y, zoom }, { duration: animate && !reduced ? 320 : 0 });
      return true;
    },
    [flow, height, nodes, reduced, view, width],
  );

  // Fit again when the chart's place changes size (the page settling, the window), not
  // only on a new view: a fit into a stage that was still growing leaves the chart off.
  useEffect(() => {
    const key = `${fitKey}:${Math.round(width)}x${Math.round(height)}:${initialized ? 'all' : 'some'}`;
    if (!panZoomReady || !width || !height || fitted.current === key) return;
    const sameView = fitted.current?.startsWith(`${fitKey}:`) ?? false;
    if (fit(fitted.current != null && !sameView)) fitted.current = key;
  }, [fit, fitKey, height, initialized, panZoomReady, width]);

  useEffect(
    () => () => {
      if (pending.current) clearTimeout(pending.current.timer);
    },
    [],
  );

  const hoverFor = useCallback((element: HTMLElement, node: Node): ChartHover | null => {
    const box = container.current?.getBoundingClientRect();
    if (!box) return null;
    const rect = element.getBoundingClientRect();
    return {
      node,
      rect: {
        left: rect.left - box.left,
        top: rect.top - box.top,
        width: rect.width,
        height: rect.height,
      },
      width: box.width,
      height: box.height,
    };
  }, []);

  const nodeOf = (target: EventTarget | null) => {
    const element = (target as HTMLElement | null)?.closest<HTMLElement>('.react-flow__node');
    const node = element ? flow.getNode(element.dataset.id ?? '') : undefined;
    return element && node ? { element, node } : null;
  };

  // A card reached with the keyboard is brought into view and shows its info card; a
  // click never pans.
  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (!target.matches(':focus-visible')) return;
    const found = nodeOf(target);
    const box = container.current?.getBoundingClientRect();
    if (!found || !box) return;
    const rect = found.element.getBoundingClientRect();
    const inside =
      rect.left >= box.left &&
      rect.right <= box.right &&
      rect.top >= box.top &&
      rect.bottom <= box.bottom;
    if (!inside) {
      const internal = flow.getInternalNode(found.node.id);
      if (internal)
        void flow.setCenter(
          internal.internals.positionAbsolute.x + (internal.measured.width ?? 0) / 2,
          internal.internals.positionAbsolute.y + (internal.measured.height ?? 0) / 2,
          { zoom: flow.getZoom(), duration: 0 },
        );
    }
    onHover(hoverFor(found.element, found.node));
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' || !event.shiftKey) return;
    const found = nodeOf(event.target);
    if (!found) return;
    event.preventDefault();
    onDrill(found.node);
  };

  return (
    // Keys and focus come from the focusable nodes inside; the frame only listens.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      ref={container}
      className={`organization-flow relative size-full ${view === 'ring' ? 'organization-flow-ring' : ''}`}
      onFocus={onFocus}
      onBlur={() => onHover(null)}
      onKeyDown={onKeyDown}
    >
      <ReactFlow
        // The first fit is React Flow's own (it knows when the nodes are measured); later
        // fits on a new view or a resized stage come from the effect above.
        fitView
        fitViewOptions={{ padding: 0.08, minZoom: view === 'ring' ? 0.3 : 0.5, maxZoom: 1 }}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        autoPanOnNodeFocus={false}
        // Nodes stay clickable only with a click handler: without one React Flow sets
        // pointer-events: none on every node and the pane swallows the click.
        onNodeClick={(_, node) => {
          if (node.type === 'group' || node.type === 'task') {
            onActivate(node);
            return;
          }
          if (pending.current?.id === node.id) return;
          if (pending.current) clearTimeout(pending.current.timer);
          pending.current = {
            id: node.id,
            timer: setTimeout(() => {
              pending.current = null;
              onActivate(node);
            }, DOUBLE_CLICK_MS),
          };
        }}
        onNodeDoubleClick={(_, node) => {
          if (pending.current) clearTimeout(pending.current.timer);
          pending.current = null;
          onDrill(node);
        }}
        onNodeMouseEnter={(event, node) =>
          onHover(hoverFor(event.currentTarget as HTMLElement, node))
        }
        onNodeMouseLeave={() => onHover(null)}
        onMoveStart={() => onHover(null)}
        onPaneClick={onPaneClick}
        zoomOnDoubleClick={false}
        minZoom={0.15}
        maxZoom={1.6}
        colorMode={resolvedTheme === 'dark' ? 'dark' : 'light'}
        style={{ background: 'transparent' }}
        proOptions={{ hideAttribution: true }}
        aria-label={label}
        ariaLabelConfig={{
          'controls.ariaLabel': t('controls'),
          'controls.zoomIn.ariaLabel': t('zoomIn'),
          'controls.zoomOut.ariaLabel': t('zoomOut'),
          'controls.fitView.ariaLabel': t('fit'),
        }}
      >
        {view === 'ring' && orbits.length > 0 && (
          <ViewportPortal>
            <div className="organization-orbits" aria-hidden="true">
              {orbits.map((radius, index) => (
                <svg
                  key={radius}
                  className={`organization-orbit ${index % 2 ? 'organization-orbit-reverse' : ''}`}
                  style={{
                    left: -radius - 2,
                    top: -radius - 2,
                    width: radius * 2 + 4,
                    height: radius * 2 + 4,
                  }}
                  viewBox={`0 0 ${radius * 2 + 4} ${radius * 2 + 4}`}
                >
                  <circle
                    cx={radius + 2}
                    cy={radius + 2}
                    r={radius}
                    fill="none"
                    strokeWidth={1}
                    strokeDasharray="2 10"
                  />
                </svg>
              ))}
            </div>
          </ViewportPortal>
        )}
        <Controls showInteractive={false} showFitView={false} position="top-left">
          <ControlButton onClick={() => fit(true)} title={t('fit')} aria-label={t('fit')}>
            <Maximize />
          </ControlButton>
        </Controls>
      </ReactFlow>
    </div>
  );
}
