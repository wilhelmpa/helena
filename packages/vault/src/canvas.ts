import { z } from 'zod';

// JSON Canvas 1.0 (https://jsoncanvas.org/spec/1.0/, MIT, by Obsidian): the open file
// format Helena's note boards are stored in, so a board is a `.canvas` file in the vault
// that Obsidian and other canvas apps open, git versions and agents read. There is no
// maintained validating library, so the spec is written down here; unknown fields are
// kept, so a file written by a newer app survives a round trip through Helena.

const color = z.string().max(32);

const nodeBase = {
  id: z.string().min(1).max(200),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  color: color.optional(),
};

export const canvasTextNode = z.looseObject({
  ...nodeBase,
  type: z.literal('text'),
  text: z.string(),
});

export const canvasFileNode = z.looseObject({
  ...nodeBase,
  type: z.literal('file'),
  file: z.string(),
  subpath: z.string().optional(),
});

export const canvasLinkNode = z.looseObject({
  ...nodeBase,
  type: z.literal('link'),
  url: z.string(),
});

export const canvasGroupNode = z.looseObject({
  ...nodeBase,
  type: z.literal('group'),
  label: z.string().optional(),
  background: z.string().optional(),
  backgroundStyle: z.enum(['cover', 'ratio', 'repeat']).optional(),
});

export const canvasNode = z.discriminatedUnion('type', [
  canvasTextNode,
  canvasFileNode,
  canvasLinkNode,
  canvasGroupNode,
]);

const side = z.enum(['top', 'right', 'bottom', 'left']);
const end = z.enum(['none', 'arrow']);

export const canvasEdge = z.looseObject({
  id: z.string().min(1).max(200),
  fromNode: z.string(),
  fromSide: side.optional(),
  fromEnd: end.optional(),
  toNode: z.string(),
  toSide: side.optional(),
  toEnd: end.optional(),
  color: color.optional(),
  label: z.string().optional(),
});

export const jsonCanvas = z.looseObject({
  nodes: z.array(canvasNode).optional(),
  edges: z.array(canvasEdge).optional(),
});

export type CanvasNode = z.infer<typeof canvasNode>;
export type CanvasTextNode = z.infer<typeof canvasTextNode>;
export type CanvasEdge = z.infer<typeof canvasEdge>;
export type JsonCanvas = z.infer<typeof jsonCanvas>;

export const EMPTY_CANVAS: JsonCanvas = { nodes: [], edges: [] };

export class CanvasFormatError extends Error {}

// Reads a .canvas file. An empty file is an empty canvas (Obsidian writes one for a new
// canvas); anything that is not JSON Canvas is an error.
export function parseCanvas(content: string): JsonCanvas {
  if (!content.trim()) return { nodes: [], edges: [] };
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new CanvasFormatError('The file is not JSON');
  }
  const result = jsonCanvas.safeParse(value);
  if (!result.success) throw new CanvasFormatError('The file is not JSON Canvas 1.0');
  return result.data;
}

// Writes a canvas the way Obsidian does: tab-indented JSON.
export function serializeCanvas(canvas: JsonCanvas): string {
  return `${JSON.stringify(canvas, null, '\t')}\n`;
}

// The words of a canvas, for the search index: its text nodes, group labels, the files
// and pages it points at, and its edge labels.
export function canvasText(content: string): string {
  let canvas: JsonCanvas;
  try {
    canvas = parseCanvas(content);
  } catch {
    return '';
  }
  const parts: string[] = [];
  for (const node of canvas.nodes ?? []) {
    if (node.type === 'text') parts.push(node.text);
    else if (node.type === 'group' && node.label) parts.push(node.label);
    else if (node.type === 'file') parts.push(`[[${node.file.replace(/\.md$/i, '')}]]`);
    else if (node.type === 'link') parts.push(node.url);
  }
  for (const edge of canvas.edges ?? []) if (edge.label) parts.push(edge.label);
  return parts.join('\n\n');
}
