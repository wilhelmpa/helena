import type { CanvasEdge, CanvasNode, CanvasTextNode, JsonCanvas } from '@repo/vault';

// A board as the web app draws it (React Flow stickers and connections) and as it is
// stored for a public board (JSON Canvas 1.0 in the vault). A sticker is a text node:
// its title is the first line as a Markdown heading, its body the rest, its color a hex
// color (JSON Canvas also allows the presets "1"–"6", mapped to the sticker palette).
// Nodes Helena does not draw (files, links, groups from Obsidian) and fields it does
// not know are kept when Helena saves the board.

export interface StickerData {
  title: string;
  body: string;
  color: string;
}

export interface StickerNode {
  id: string;
  type: 'sticker';
  position: { x: number; y: number };
  width?: number;
  height?: number;
  data: StickerData;
}

export interface StickerEdge {
  id: string;
  source: string;
  target: string;
}

export interface StickerCanvas {
  nodes: StickerNode[];
  edges: StickerEdge[];
}

const DEFAULT_WIDTH = 260;
const DEFAULT_HEIGHT = 220;
const DEFAULT_COLOR = '#FFF9B1';

// JSON Canvas presets: 1 red, 2 orange, 3 yellow, 4 green, 5 cyan, 6 purple.
const PRESETS: Record<string, string> = {
  '1': '#F7C1D9',
  '2': '#FFD59E',
  '3': '#FFF9B1',
  '4': '#D5F692',
  '5': '#A8E6D8',
  '6': '#D0BFFF',
};

function stickerColor(color: string | undefined): string {
  if (!color) return DEFAULT_COLOR;
  if (PRESETS[color]) return PRESETS[color];
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toUpperCase() : DEFAULT_COLOR;
}

const HEADING = /^#\s+(.+?)\s*(?:\n+|$)/;

export function splitStickerText(text: string): { title: string; body: string } {
  const match = HEADING.exec(text);
  if (!match) return { title: '', body: text };
  return { title: match[1]!.trim(), body: text.slice(match[0].length) };
}

export function stickerText(data: StickerData): string {
  const title = data.title.replace(/\n+/g, ' ').trim();
  const body = data.body.replace(/^\n+/, '');
  if (!title) return body;
  return body ? `# ${title}\n\n${body}` : `# ${title}`;
}

const round = (value: number) => Math.round(value);

export function toStickers(canvas: JsonCanvas): StickerCanvas {
  const nodes = (canvas.nodes ?? [])
    .filter((node): node is CanvasTextNode => node.type === 'text')
    .map((node) => {
      const { title, body } = splitStickerText(node.text);
      return {
        id: node.id,
        type: 'sticker' as const,
        position: { x: node.x, y: node.y },
        width: node.width,
        height: node.height,
        data: { title, body, color: stickerColor(node.color) },
      };
    });
  const shown = new Set(nodes.map((node) => node.id));
  const edges = (canvas.edges ?? [])
    .filter((edge) => shown.has(edge.fromNode) && shown.has(edge.toNode))
    .map((edge) => ({ id: edge.id, source: edge.fromNode, target: edge.toNode }));
  return { nodes, edges };
}

// The board after a save from the web: its stickers become the canvas's text nodes
// (keeping each node's unknown fields), every other node stays as it was, and the edges
// between stickers are the ones the web sent, while edges that touch another node stay.
export function mergeStickers(existing: JsonCanvas, next: StickerCanvas): JsonCanvas {
  const before = new Map((existing.nodes ?? []).map((node) => [node.id, node]));
  const stickers: CanvasNode[] = next.nodes.map((sticker) => {
    const previous = before.get(sticker.id);
    const kept = previous?.type === 'text' ? previous : {};
    return {
      ...kept,
      id: sticker.id,
      type: 'text',
      x: round(sticker.position.x),
      y: round(sticker.position.y),
      width: round(sticker.width ?? DEFAULT_WIDTH),
      height: round(sticker.height ?? DEFAULT_HEIGHT),
      color: stickerColor(sticker.data.color),
      text: stickerText(sticker.data),
    } as CanvasTextNode;
  });
  const others = (existing.nodes ?? []).filter((node) => node.type !== 'text');
  const textIds = new Set(stickers.map((node) => node.id));
  const previousEdges = new Map((existing.edges ?? []).map((edge) => [edge.id, edge]));
  const stickerEdges: CanvasEdge[] = next.edges
    .filter((edge) => textIds.has(edge.source) && textIds.has(edge.target))
    .map((edge) => ({
      ...(previousEdges.get(edge.id) ?? {}),
      id: edge.id,
      fromNode: edge.source,
      toNode: edge.target,
    }));
  const otherIds = new Set(others.map((node) => node.id));
  const keptEdges = (existing.edges ?? []).filter(
    (edge) =>
      (otherIds.has(edge.fromNode) || otherIds.has(edge.toNode)) &&
      (otherIds.has(edge.fromNode) || textIds.has(edge.fromNode)) &&
      (otherIds.has(edge.toNode) || textIds.has(edge.toNode)),
  );
  return { ...existing, nodes: [...others, ...stickers], edges: [...keptEdges, ...stickerEdges] };
}

// The UI's canvas as it arrives: anything that is not a list of stickers is taken as an
// empty board rather than written into a file.
export function asStickerCanvas(value: unknown): StickerCanvas {
  const record = (value ?? {}) as { nodes?: unknown; edges?: unknown };
  const nodes = Array.isArray(record.nodes) ? record.nodes : [];
  const edges = Array.isArray(record.edges) ? record.edges : [];
  return {
    nodes: nodes
      .filter(
        (node): node is StickerNode =>
          !!node &&
          typeof node === 'object' &&
          typeof (node as StickerNode).id === 'string' &&
          typeof (node as StickerNode).position?.x === 'number' &&
          typeof (node as StickerNode).position?.y === 'number',
      )
      .map((node) => ({
        id: node.id,
        type: 'sticker',
        position: { x: node.position.x, y: node.position.y },
        width: typeof node.width === 'number' ? node.width : undefined,
        height: typeof node.height === 'number' ? node.height : undefined,
        data: {
          title: typeof node.data?.title === 'string' ? node.data.title : '',
          body: typeof node.data?.body === 'string' ? node.data.body : '',
          color: typeof node.data?.color === 'string' ? node.data.color : DEFAULT_COLOR,
        },
      })),
    edges: edges
      .filter(
        (edge): edge is StickerEdge =>
          !!edge &&
          typeof edge === 'object' &&
          typeof (edge as StickerEdge).id === 'string' &&
          typeof (edge as StickerEdge).source === 'string' &&
          typeof (edge as StickerEdge).target === 'string',
      )
      .map((edge) => ({ id: edge.id, source: edge.source, target: edge.target })),
  };
}
