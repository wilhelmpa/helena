'use client';

import type { ReactNode } from 'react';
import { FileText, Folder } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import PillButton from '@/components/helena/PillButton';
import { useRelativeTime } from '@/context/relativeTimeContext';
import { getVaultDocument } from '@/lib/api/endpoints/knowledge';
import {
  fileRawUrl,
  listFiles,
  readFileText,
  type FileItem,
  type FileScope,
} from '@/lib/api/endpoints/projectFiles';
import { knowledgeKind, isCanvas, isDoc, isImage, isPdf } from '../utils/knowledgeKinds';

interface CanvasNode {
  id: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  text?: string;
  file?: string;
}

function CanvasThumbnail({ scope, item }: { scope: FileScope; item: FileItem }) {
  const t = useTranslations('files.knowledge');
  const canvas = useQuery({
    queryKey: ['knowledge-canvas-preview', scope, item.path],
    queryFn: () => readFileText(scope, item.path),
  });
  let nodes: CanvasNode[] = [];
  let edges: { fromNode: string; toNode: string }[] = [];
  if (canvas.data) {
    try {
      const parsed = JSON.parse(canvas.data.content) as {
        nodes?: CanvasNode[];
        edges?: typeof edges;
      };
      nodes = parsed.nodes ?? [];
      edges = parsed.edges ?? [];
    } catch {
      // A malformed file shows an empty thumbnail.
    }
  }
  const shown = nodes.slice(0, 6);
  const minX = shown.length ? Math.min(...shown.map((node) => node.x)) : 0;
  const minY = shown.length ? Math.min(...shown.map((node) => node.y)) : 0;
  const maxX = Math.max(...shown.map((node) => node.x + (node.width ?? 274)), minX + 1);
  const maxY = Math.max(...shown.map((node) => node.y + (node.height ?? 90)), minY + 1);
  const scale = Math.min(0.42, 264 / (maxX - minX), 150 / (maxY - minY));
  const box = (node: CanvasNode) => ({
    x: 18 + (node.x - minX) * scale,
    y: 24 + (node.y - minY) * scale,
    width: Math.max(56, (node.width ?? 274) * scale),
    height: Math.max(28, (node.height ?? 90) * scale),
  });
  return (
    <div className="relative h-full w-full">
      <svg aria-hidden="true" className="absolute inset-0 h-full w-full" viewBox="0 0 300 200">
        {edges.map((edge, index) => {
          const source = shown.find((node) => node.id === edge.fromNode);
          const target = shown.find((node) => node.id === edge.toNode);
          if (!source || !target) return null;
          const from = box(source);
          const to = box(target);
          const vertical = to.y > from.y + from.height;
          const sx = vertical ? from.x + from.width / 2 : from.x + from.width;
          const sy = vertical ? from.y + from.height : from.y + from.height / 2;
          const tx = vertical ? to.x + to.width / 2 : to.x;
          const ty = vertical ? to.y : to.y + to.height / 2;
          const d = vertical
            ? `M ${sx} ${sy} C ${sx} ${(sy + ty) / 2} ${tx} ${(sy + ty) / 2} ${tx} ${ty}`
            : `M ${sx} ${sy} C ${(sx + tx) / 2} ${sy} ${(sx + tx) / 2} ${ty} ${tx} ${ty}`;
          return (
            <path
              key={index}
              d={d}
              fill="none"
              strokeWidth="1"
              className="stroke-muted-foreground/40"
            />
          );
        })}
      </svg>
      {shown.map((node) => {
        const position = box(node);
        return (
          <div
            key={node.id}
            className="ds-canvas-thumb-node"
            style={{ left: position.x, top: position.y, width: position.width }}
          >
            {node.text?.split('\n')[0]?.replace(/^#+\s*/, '') ||
              node.file?.split('/').at(-1) ||
              t('card')}
          </div>
        );
      })}
    </div>
  );
}

function DocStart({ vault }: { vault: string | null }) {
  const doc = useQuery({
    queryKey: ['knowledge-folder-preview', vault],
    queryFn: () => getVaultDocument(vault!),
    enabled: !!vault,
  });
  // The first lines as plain reading text: headings without their marks, no frontmatter.
  const text = (doc.data?.body ?? '')
    .replace(/^---\n[\s\S]*?\n---\n?/, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_, target: string, alias: string) => alias || target)
    .slice(0, 900);
  return (
    <div className="h-full overflow-hidden [mask-image:linear-gradient(to_bottom,black_70%,transparent)] p-5 text-xs leading-6 whitespace-pre-wrap text-foreground/80">
      {text}
    </div>
  );
}

// The selected entry of a Wissen folder: a picture of it (PDF page, image, the start of
// a doc, a canvas miniature, a folder's facts) with its name and "Öffnen".
export default function KnowledgePreview({
  item,
  scope,
  vaultPath,
  label,
  location,
  onOpen,
}: {
  item: FileItem;
  scope: FileScope;
  vaultPath: string | null;
  label: string;
  // Where the entry lives, when the list mixes folders (the "Zuletzt geändert" overview).
  location?: ReactNode;
  onOpen: () => void;
}) {
  const t = useTranslations('files.knowledge');
  const relativeTime = useRelativeTime();
  const folder = useQuery({
    queryKey: ['knowledge-folder-count', scope, item.path],
    queryFn: () => listFiles(scope, item.path),
    enabled: item.kind === 'folder',
  });
  const kind = knowledgeKind(item);
  return (
    <div className="flex flex-col gap-3.5" data-knowledge-preview={kind}>
      <div className="ds-preview-frame">
        {item.kind === 'folder' ? (
          <div className="grid h-full place-items-center">
            <Folder size={40} strokeWidth={1.3} className="text-muted-foreground" />
          </div>
        ) : isImage(item.name) ? (
          // eslint-disable-next-line @next/next/no-img-element -- a vault file on the web origin, not a build asset
          <img src={fileRawUrl(scope, item.path)} alt="" className="h-full w-full object-contain" />
        ) : isPdf(item.name) ? (
          <object
            data={`${fileRawUrl(scope, item.path)}#page=1&toolbar=0&navpanes=0&view=FitH`}
            type="application/pdf"
            aria-label={item.name}
            className="h-full w-full"
          />
        ) : isDoc(item.name) ? (
          <DocStart vault={vaultPath} />
        ) : isCanvas(item.name) ? (
          <CanvasThumbnail scope={scope} item={item} />
        ) : (
          <div className="grid h-full place-items-center">
            <FileText size={38} strokeWidth={1.3} className="text-muted-foreground" />
          </div>
        )}
      </div>
      <p className="m-0 text-base break-words" dir="auto">
        {label}
      </p>
      <p className="m-0 text-xs leading-5 text-muted-foreground">
        {item.kind === 'folder'
          ? folder.data
            ? t('entries', { count: folder.data.items.length })
            : t('kinds.folder')
          : t(`kinds.${kind}`)}
        {item.updatedAt ? ` · ${relativeTime(item.updatedAt)}` : ''}
      </p>
      {location && (
        <div className="-mt-2 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          {location}
        </div>
      )}
      <PillButton className="h-8 min-h-8" onClick={onOpen}>
        {t('open')}
      </PillButton>
    </div>
  );
}
