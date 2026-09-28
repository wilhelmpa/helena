'use client';
/* eslint-disable react/jsx-no-literals, no-restricted-syntax, better-tailwindcss/no-restricted-classes, react-hooks/set-state-in-effect -- WissenLeinwand.dc.html bestimmt Darstellung; die Datei wird einmal nach dem Query-Ergebnis initialisiert. */

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
};
type CardNode = Node<CardData, 'card'>;
const borderColors = ['#645274', '#395e50', '#65483d', '#6b562b'];

function CanvasCard({ id, data }: NodeProps<CardNode>) {
  return (
    <div
      className="group h-full w-full rounded-[17px] border bg-[#111014] px-4 py-3.5 shadow-[0_5px_18px_#0005]"
      style={{ borderColor: data.color }}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="left"
        className="!size-1.5 !border-0 !bg-[#8b8595] !opacity-0 group-hover:!opacity-100"
      />
      <Handle
        type="target"
        position={Position.Top}
        id="top"
        className="!size-1.5 !border-0 !bg-[#8b8595] !opacity-0 group-hover:!opacity-100"
      />
      {data.href ? (
        <Link
          href={data.href}
          className="nodrag block truncate text-[14px] font-medium text-[#eeeaf6] hover:text-[#bdaaff]"
        >
          {data.title}
        </Link>
      ) : (
        <input
          aria-label="Kartentitel"
          readOnly={!data.editable}
          value={data.title}
          onChange={(event) => data.edit(id, 'title', event.target.value)}
          className="nodrag w-full bg-transparent text-[14px] font-medium text-[#eeeaf6] outline-none"
        />
      )}
      {data.href ? (
        <p className="mt-1 text-xs text-[#96919f]">{data.body}</p>
      ) : (
        <textarea
          aria-label="Kartentext"
          readOnly={!data.editable}
          value={data.body}
          onChange={(event) => data.edit(id, 'body', event.target.value)}
          className="nodrag nowheel mt-1 h-[42px] w-full resize-none bg-transparent text-xs leading-[1.6] text-[#96919f] outline-none"
        />
      )}
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        className="!size-1.5 !border-0 !bg-[#8b8595] !opacity-0 group-hover:!opacity-100"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        className="!size-1.5 !border-0 !bg-[#8b8595] !opacity-0 group-hover:!opacity-100"
      />
    </div>
  );
}

function splitText(text: string) {
  const match = /^# ([^\n]+)(?:\n+|$)/.exec(text);
  return match
    ? { title: match[1]!, body: text.slice(match[0].length) }
    : { title: text.split('\n')[0] || 'Karte', body: text.split('\n').slice(1).join('\n') };
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
  name,
  editable,
  item,
  actions,
  can,
}: {
  scope: FileScope;
  path: string;
  name: string;
  editable: boolean;
  item: FileItem;
  actions: FileActions;
  can: FilePermissions;
}) {
  const file = useQuery({
    queryKey: ['knowledge-canvas', scope, path],
    queryFn: () => readFileText(scope, path),
  });
  const [original, setOriginal] = useState<CanvasJson | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<CardNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [tool, setTool] = useState('Auswählen');
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
                    'Verknüpfung',
              body:
                record.type === 'text'
                  ? text.body
                  : record.type === 'file'
                    ? 'Doc · verknüpft'
                    : 'Aufgabe · verknüpft',
              href: toHref(record, scope),
              color:
                record.color && /^#[\da-f]{6}$/i.test(record.color)
                  ? record.color
                  : borderColors[0]!,
              edit,
              editable,
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
            style: { stroke: '#ffffff45', strokeWidth: 1.2 },
            type: 'default',
          };
        }),
      );
    } catch {
      toast.error('Leinwand konnte nicht gelesen werden');
    }
  }, [file.data, original, setNodes, setEdges, scope, edit, editable]);
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
      toast.error('Leinwand konnte nicht gespeichert werden');
    } finally {
      setSaving(false);
    }
  }, [original, nodes, edges, dirty, scope, path]);
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
              ? 'Neue Karte'
              : kind === 'file'
                ? value.split('/').at(-1)!.replace(/\.md$/i, '')
                : value,
          body: kind === 'file' ? 'Doc · verknüpft' : kind === 'link' ? 'Aufgabe · verknüpft' : '',
          href,
          color: borderColors[current.length % borderColors.length]!,
          edit,
          editable,
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
      setEdges((current) => addEdge({ ...connection, style: { stroke: '#ffffff45' } }, current));
      markDirty();
    },
    [setEdges, markDirty],
  );
  return (
    <div
      data-knowledge-canvas
      data-project-knowledge
      className="relative min-h-0 flex-1 overflow-hidden bg-[#050507] text-[#eeeaf6]"
    >
      <div className="pointer-events-none absolute inset-s-9 top-6 z-10 max-sm:inset-s-4">
        <p className="font-mono text-[10px] tracking-[.23em] text-[#7ee0b8]">
          WISSEN / {path.split('/').slice(0, -1).join(' / ').toUpperCase() || 'LEINWÄNDE'}
        </p>
        <h1 className="mt-2 text-[27px] font-[520] tracking-[-.03em]">
          {name.replace(/\.canvas$/i, '')}
        </h1>
      </div>
      <div className="absolute inset-e-9 top-8 z-10 flex items-center gap-2 text-xs text-[#8b8595] max-sm:inset-s-4 max-sm:inset-e-auto max-sm:top-28">
        <span className="rounded-full bg-[#111014] px-3 py-2">
          {nodes.length} Karten · {edges.length} Verbindungen
        </span>
        <button
          type="button"
          onClick={() => void actions.copyPath(item)}
          className="rounded-full border border-[#ffffff12] bg-[#111014] px-3 py-2 text-[#cfc6da]"
        >
          Teilen
        </button>
        <FileItemMenu item={item} actions={actions} can={can} />
        <span className="sr-only">{saving ? 'speichert …' : 'gespeichert'}</span>
      </div>
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
        nodesConnectable={editable && tool === 'Verbinden'}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        proOptions={{ hideAttribution: true }}
        className="!bg-[#050507]"
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#24202b" />
      </ReactFlow>
      <div className="absolute inset-s-1/2 bottom-6 z-10 flex max-w-[calc(100%-20px)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-2xl border border-[#ffffff0d] bg-[#111014] p-1.5 text-xs text-[#96919f] shadow-[0_8px_28px_#0008]">
        {['Auswählen', 'Karte', 'Doc einfügen', 'Aufgabe einfügen', 'Verbinden'].map((label) => (
          <button
            key={label}
            type="button"
            disabled={!original || (!editable && label !== 'Auswählen')}
            onClick={() => {
              setTool(label);
              if (label === 'Karte') add('text');
              if (label === 'Doc einfügen') setPicker('file');
              if (label === 'Aufgabe einfügen') {
                if (scope.kind === 'project') setPicker('link');
                else {
                  const identifier = window.prompt('Aufgabenkennung, z. B. TRADE-123')?.trim();
                  if (identifier) add('link', identifier);
                }
              }
            }}
            className={`shrink-0 rounded-xl px-3 py-2 ${tool === label ? 'bg-[#26212d] text-[#eeeaf6]' : 'hover:text-[#eeeaf6]'}`}
          >
            {label}
          </button>
        ))}
        <span className="mx-2 h-6 w-px bg-[#ffffff14]" />
        <button
          type="button"
          aria-label="Verkleinern"
          onClick={() => {
            void zoomOut();
            setZoom(Math.round((getZoom() * 100) / 1.2));
          }}
        >
          −
        </button>
        <span className="px-1 font-mono">{zoom} %</span>
        <button
          type="button"
          aria-label="Vergrößern"
          onClick={() => {
            void zoomIn();
            setZoom(Math.round(getZoom() * 120));
          }}
        >
          +
        </button>
      </div>
      {picker === 'file' && (
        <FilePickerDialog
          scope={scope}
          mode="file"
          title="Doc einfügen"
          confirmLabel="Einfügen"
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
          title="Aufgabe einfügen"
          prompt="Aufgabe suchen"
          onPick={(hit) => {
            add('link', hit.identifier);
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

export default function KnowledgeCanvas(props: {
  scope: FileScope;
  path: string;
  name: string;
  editable: boolean;
  item: FileItem;
  actions: FileActions;
  can: FilePermissions;
}) {
  return (
    <ReactFlowProvider>
      <CanvasSurface {...props} />
    </ReactFlowProvider>
  );
}
