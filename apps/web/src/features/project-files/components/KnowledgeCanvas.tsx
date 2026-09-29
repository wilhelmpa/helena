'use client';
/* eslint-disable no-restricted-syntax, better-tailwindcss/no-restricted-classes, react-hooks/set-state-in-effect -- WissenLeinwand.dc.html bestimmt Darstellung; die Datei wird einmal nach dem Query-Ergebnis initialisiert. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Background,
  BackgroundVariant,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import {
  FileText,
  Link2,
  ListTodo,
  Minus,
  MousePointer2,
  Plus,
  Spline,
  StickyNote,
  type LucideIcon,
} from 'lucide-react';
import { IconButton, Page, Pill } from '@/design-system';
import FilePickerDialog from '@/components/common/files/FilePickerDialog';
import IssuePickerDialog from '@/components/common/overlay/IssuePickerDialog';
import {
  readFileText,
  saveFileText,
  type FileItem,
  type FileScope,
} from '@/lib/api/endpoints/projectFiles';
import { filesPath, homeFilesPath, issueIdentifierPath } from '@/utils/paths';
import { uuid } from '@/utils/uuid';
import type { FileActions } from '../hooks/useFileActions';
import type { FilePermissions } from './FileBrowser';
import FileItemMenu from './FileItemMenu';

type CanvasRecord = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  file?: string;
  url?: string;
  color?: string;
  [key: string]: unknown;
};
type CanvasJson = {
  nodes: CanvasRecord[];
  edges: { id: string; fromNode: string; toNode: string; [key: string]: unknown }[];
  [key: string]: unknown;
};
type CardData = {
  title: string;
  body: string;
  href?: string;
  color: string;
  edit: (id: string, field: 'title' | 'body', value: string) => void;
  editable: boolean;
  // The accessible names of a card's two fields.
  labels: { title: string; body: string };
};
type CardNode = Node<CardData, 'card'>;
const borderColors = ['#645274', '#395e50', '#65483d', '#6b562b'];

function CanvasCard({ id, data }: NodeProps<CardNode>) {
  return (
    <div
      className="group h-full w-full rounded-xl border bg-card px-4 py-3.5 shadow-sm"
      style={{ borderColor: data.color }}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="left"
        className="!size-1.5 !border-0 !bg-muted-foreground !opacity-0 group-hover:!opacity-100"
      />
      <Handle
        type="target"
        position={Position.Top}
        id="top"
        className="!size-1.5 !border-0 !bg-muted-foreground !opacity-0 group-hover:!opacity-100"
      />
      {data.href ? (
        <Link
          href={data.href}
          className="nodrag block truncate text-[14px] font-medium text-foreground hover:text-brand"
        >
          {data.title}
        </Link>
      ) : (
        <input
          aria-label={data.labels.title}
          readOnly={!data.editable}
          value={data.title}
          onChange={(event) => data.edit(id, 'title', event.target.value)}
          className="nodrag w-full bg-transparent text-[14px] font-medium text-foreground outline-none"
        />
      )}
      {data.href ? (
        <p className="mt-1 text-xs text-muted-foreground">{data.body}</p>
      ) : (
        <textarea
          aria-label={data.labels.body}
          readOnly={!data.editable}
          value={data.body}
          onChange={(event) => data.edit(id, 'body', event.target.value)}
          className="nodrag nowheel mt-1 h-[42px] w-full resize-none bg-transparent text-xs leading-[1.6] text-muted-foreground outline-none"
        />
      )}
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        className="!size-1.5 !border-0 !bg-muted-foreground !opacity-0 group-hover:!opacity-100"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        className="!size-1.5 !border-0 !bg-muted-foreground !opacity-0 group-hover:!opacity-100"
      />
    </div>
  );
}

const CANVAS_TOOLS = ['select', 'card', 'doc', 'task', 'connect'] as const;
type CanvasTool = (typeof CANVAS_TOOLS)[number];
// One icon per tool (owner, O53: a canvas has its own heading and symbols).
const TOOL_ICONS: Record<CanvasTool, LucideIcon> = {
  select: MousePointer2,
  card: StickyNote,
  doc: FileText,
  task: ListTodo,
  connect: Spline,
};

function splitText(text: string) {
  const match = /^# ([^\n]+)(?:\n+|$)/.exec(text);
  return match
    ? { title: match[1]!, body: text.slice(match[0].length) }
    : { title: text.split('\n')[0] || '', body: text.split('\n').slice(1).join('\n') };
}

function toHref(record: CanvasRecord, scope: FileScope) {
  if (record.type === 'file' && record.file) {
    const canonical = record.file.replace(/^\//, '');
    if (scope.kind === 'project') {
      const relative = canonical.startsWith(`Projects/${scope.projectKey}/`)
        ? canonical.slice(`Projects/${scope.projectKey}/`.length)
        : canonical;
      return filesPath(scope.projectKey, relative.split('/').slice(0, -1).join('/'), {
        file: relative,
      });
    }
    const root =
      scope.root === 'private' ? 'Private' : scope.root === 'templates' ? 'Templates' : 'Home';
    const relative = canonical.startsWith(`${root}/`)
      ? canonical.slice(root.length + 1)
      : canonical;
    return homeFilesPath(relative.split('/').slice(0, -1).join('/'), {
      root: scope.root === 'home' ? undefined : scope.root,
      file: relative,
    });
  }
  if (record.type === 'link' && record.url?.startsWith('/')) return record.url;
  return undefined;
}

function CanvasSurface({
  scope,
  path,
  editable,
  item,
  actions,
  can,
  compact = false,
}: {
  scope: FileScope;
  path: string;
  name: string;
  editable: boolean;
  item: FileItem;
  actions?: FileActions;
  can: FilePermissions;
  // In the preview on the right: the overlay's head names the canvas and holds its
  // actions, so the canvas shows only its surface and its tools.
  compact?: boolean;
}) {
  const file = useQuery({
    queryKey: ['knowledge-canvas', scope, path],
    queryFn: () => readFileText(scope, path),
  });
  const [original, setOriginal] = useState<CanvasJson | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<CardNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const t = useTranslations('files.canvas');
  const labels = useMemo(() => ({ title: t('cardTitle'), body: t('cardBody') }), [t]);
  const [tool, setTool] = useState<CanvasTool>('select');
  const [picker, setPicker] = useState<'file' | 'link' | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const generation = useRef(0);
  const markDirty = useCallback(() => {
    generation.current += 1;
    setDirty(true);
  }, []);
  const revision = useRef<string | null>(null);
  const { screenToFlowPosition, zoomIn, zoomOut, getZoom, setViewport } = useReactFlow();
  const [zoom, setZoom] = useState(100);
  useEffect(() => {
    if (window.innerWidth < 640) void setViewport({ x: -55, y: 100, zoom: 1 });
  }, [setViewport]);
  const edit = useCallback(
    (id: string, field: 'title' | 'body', value: string) => {
      setNodes((current) =>
        current.map((node) =>
          node.id === id ? { ...node, data: { ...node.data, [field]: value } } : node,
        ),
      );
      markDirty();
    },
    [setNodes, markDirty],
  );
  const nodeTypes = useMemo(() => ({ card: CanvasCard }), []);
  useEffect(() => {
    if (!file.data || original) return;
    try {
      const parsed = JSON.parse(file.data.content) as CanvasJson;
      if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges))
        throw new Error('Invalid Canvas');
      setOriginal(parsed);
      revision.current = file.data.etag;
      setNodes(
        parsed.nodes.map((record) => {
          const text = splitText(record.text ?? '');
          return {
            id: record.id,
            type: 'card',
            position: { x: record.x, y: record.y },
            style: { width: record.width || 274, height: record.height || 90 },
            data: {
              title:
                record.type === 'text'
                  ? text.title
                  : record.file?.split('/').at(-1)?.replace(/\.md$/i, '') ||
                    record.url ||
                    t('link'),
              body:
                record.type === 'text'
                  ? text.body
                  : record.type === 'file'
                    ? t('linkedDoc')
                    : t('linkedTask'),
              href: toHref(record, scope),
              color:
                record.color && /^#[\da-f]{6}$/i.test(record.color)
                  ? record.color
                  : borderColors[0]!,
              edit,
              editable,
              labels,
            },
          };
        }),
      );
      setEdges(
        parsed.edges.map((edge) => {
          const source = parsed.nodes.find((node) => node.id === edge.fromNode);
          const target = parsed.nodes.find((node) => node.id === edge.toNode);
          const vertical = !!source && !!target && target.y > source.y + source.height * 1.5;
          return {
            id: edge.id,
            source: edge.fromNode,
            target: edge.toNode,
            sourceHandle: vertical ? 'bottom' : 'right',
            targetHandle: vertical ? 'top' : 'left',
            style: { stroke: 'var(--line-strong)', strokeWidth: 1.2 },
            type: 'default',
          };
        }),
      );
    } catch {
      toast.error(t('readFailed'));
    }
  }, [file.data, original, setNodes, setEdges, scope, edit, editable, labels, t]);
  const save = useCallback(async () => {
    if (!original || !revision.current || !dirty) return;
    const old = new Map(original.nodes.map((node) => [node.id, node]));
    const oldEdges = new Map(original.edges.map((edge) => [edge.id, edge]));
    const next: CanvasJson = {
      ...original,
      nodes: nodes.map((node) => {
        const before = old.get(node.id);
        return {
          ...before,
          id: node.id,
          type: before?.type ?? (node.data.href ? 'link' : 'text'),
          x: Math.round(node.position.x),
          y: Math.round(node.position.y),
          width: Math.round(Number(node.style?.width) || 274),
          height: Math.round(Number(node.style?.height) || 90),
          color: node.data.color,
          ...(!node.data.href
            ? { text: `# ${node.data.title}\n\n${node.data.body}`.trimEnd() }
            : {}),
        } as CanvasRecord;
      }),
      edges: edges.map((edge) => ({
        ...oldEdges.get(edge.id),
        id: edge.id,
        fromNode: edge.source,
        toNode: edge.target,
      })),
    };
    const savingGeneration = generation.current;
    setSaving(true);
    try {
      const saved = await saveFileText(
        scope,
        path,
        JSON.stringify(next, null, 2) + '\n',
        revision.current,
      );
      revision.current = saved.etag;
      setOriginal(next);
      if (generation.current === savingGeneration) setDirty(false);
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }, [original, nodes, edges, dirty, scope, path, t]);
  useEffect(() => {
    if (!dirty || saving) return;
    const timer = window.setTimeout(() => void save(), 800);
    return () => clearTimeout(timer);
  }, [dirty, saving, save]);
  const add = (kind: 'text' | 'file' | 'link', value = '') => {
    if (kind !== 'text' && !value) return;
    const center = document.querySelector('[data-knowledge-canvas]')?.getBoundingClientRect();
    const position = screenToFlowPosition({
      x: (center?.left ?? 0) + (center?.width ?? 900) / 2,
      y: (center?.top ?? 0) + (center?.height ?? 600) / 2,
    });
    const id = uuid();
    const root =
      scope.kind === 'project'
        ? `Projects/${scope.projectKey}`
        : scope.root === 'private'
          ? 'Private'
          : scope.root === 'templates'
            ? 'Templates'
            : 'Home';
    const canonical = `${root}/${value.replace(/^\//, '')}`;
    const href =
      kind === 'file'
        ? toHref({ id, type: 'file', file: canonical, x: 0, y: 0, width: 274, height: 90 }, scope)
        : kind === 'link'
          ? issueIdentifierPath(value)
          : undefined;
    setNodes((current) => [
      ...current,
      {
        id,
        type: 'card',
        position,
        style: { width: 274, height: 90 },
        data: {
          title:
            kind === 'text'
              ? t('newCard')
              : kind === 'file'
                ? value.split('/').at(-1)!.replace(/\.md$/i, '')
                : value,
          body: kind === 'file' ? t('linkedDoc') : kind === 'link' ? t('linkedTask') : '',
          href,
          color: borderColors[current.length % borderColors.length]!,
          edit,
          editable,
          labels,
        },
      },
    ]);
    if (kind !== 'text')
      setOriginal(
        (before) =>
          before && {
            ...before,
            nodes: [
              ...before.nodes,
              {
                id,
                type: kind,
                x: position.x,
                y: position.y,
                width: 274,
                height: 90,
                ...(kind === 'file' ? { file: canonical } : { url: href }),
              },
            ],
          },
      );
    markDirty();
  };
  const connect = useCallback(
    (connection: Connection) => {
      setEdges((current) => addEdge({ ...connection, style: { stroke: 'var(--line-strong)' } }, current));
      markDirty();
    },
    [setEdges, markDirty],
  );
  const counts = t('counts', { cards: nodes.length, links: edges.length });
  const surface = (
    <div
      data-knowledge-canvas
      data-project-knowledge
      className="relative min-h-0 flex-1 overflow-hidden bg-background text-foreground"
    >
      <span className="sr-only" role="status">
        {saving ? t('saving') : t('saved')}
      </span>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={(changes) => {
          onNodesChange(changes);
          if (
            changes.some(
              (change) =>
                (change.type === 'position' && !change.dragging) || change.type === 'remove',
            )
          )
            markDirty();
        }}
        onEdgesChange={(changes) => {
          onEdgesChange(changes);
          if (changes.some((change) => change.type === 'remove')) markDirty();
        }}
        onConnect={connect}
        nodesDraggable={editable}
        nodesConnectable={editable && tool === 'connect'}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        // In the narrow preview every card should be in sight.
        fitView={compact}
        fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
        proOptions={{ hideAttribution: true }}
        className="!bg-background"
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--line-strong)" />
      </ReactFlow>
      <div className="ds-canvas-toolbar" data-compact={compact ? '' : undefined}>
        {CANVAS_TOOLS.map((key) => (
          <button
            key={key}
            type="button"
            disabled={!original || (!editable && key !== 'select')}
            onClick={() => {
              setTool(key);
              if (key === 'card') add('text');
              if (key === 'doc') setPicker('file');
              if (key === 'task') {
                if (scope.kind === 'project') setPicker('link');
                else {
                  const identifier = window.prompt(t('taskPrompt'))?.trim();
                  if (identifier) add('link', identifier);
                }
              }
            }}
            aria-pressed={tool === key}
            className="ds-canvas-tool"
          >
            {(() => {
              const Icon = TOOL_ICONS[key];
              return <Icon size={14} aria-hidden="true" />;
            })()}
            <span className="ds-canvas-tool-label">{t(`tools.${key}`)}</span>
          </button>
        ))}
        <span className="ds-canvas-toolbar-divider" aria-hidden="true" />
        <IconButton
          size="small"
          label={t('zoomOut')}
          onClick={() => {
            void zoomOut();
            setZoom(Math.round((getZoom() * 100) / 1.2));
          }}
        >
          <Minus size={14} aria-hidden="true" />
        </IconButton>
        <span className="ds-canvas-zoom">{`${zoom} %`}</span>
        <IconButton
          size="small"
          label={t('zoomIn')}
          onClick={() => {
            void zoomIn();
            setZoom(Math.round(getZoom() * 120));
          }}
        >
          <Plus size={14} aria-hidden="true" />
        </IconButton>
      </div>
      {picker === 'file' && (
        <FilePickerDialog
          scope={scope}
          mode="file"
          title={t('tools.doc')}
          confirmLabel={t('insert')}
          initialPath={path.split('/').slice(0, -1).join('/')}
          accept={(entry) => /\.(md|markdown)$/i.test(entry.name)}
          onPick={(picked) => {
            add('file', picked);
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      )}
      {picker === 'link' && scope.kind === 'project' && (
        <IssuePickerDialog
          projectKey={scope.projectKey}
          title={t('tools.task')}
          prompt={t('findTask')}
          onPick={(hit) => {
            add('link', hit.identifier);
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
  if (compact || !actions) return surface;
  // The canvas as a page: the header names it (breadcrumb · title, O16/O53), its counts,
  // "copy link" and the file menu sit on the right like every page's actions.
  return (
    <Page
      variant="bleed"
      actions={
        <>
          <Pill>{counts}</Pill>
          <IconButton label={t('share')} onClick={() => void actions.copyPath(item)}>
            <Link2 size={15} />
          </IconButton>
          <FileItemMenu item={item} actions={actions} can={can} />
        </>
      }
    >
      {surface}
    </Page>
  );
}

// A JSON Canvas file of Wissen: cards, linked docs and tasks, connections.
export default function KnowledgeCanvas(props: {
  scope: FileScope;
  path: string;
  name: string;
  editable: boolean;
  item: FileItem;
  actions?: FileActions;
  can: FilePermissions;
  compact?: boolean;
}) {
  return (
    <ReactFlowProvider>
      <CanvasSurface {...props} />
    </ReactFlowProvider>
  );
}
