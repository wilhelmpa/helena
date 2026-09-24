import { describe, expect, it } from 'bun:test';
import { CanvasFormatError, canvasText, parseCanvas, serializeCanvas } from '../canvas';

// JSON Canvas 1.0 as the spec writes it (jsoncanvas.org/spec/1.0), with fields a newer
// app might add.
const sample = {
  nodes: [
    {
      id: 'a',
      type: 'text',
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      text: '# Idee\n\nSiehe [[Plan]]',
      color: '4',
    },
    {
      id: 'f',
      type: 'file',
      x: 0,
      y: 200,
      width: 400,
      height: 300,
      file: 'Projects/VOL/Docs/Plan.md',
      subpath: '#Ziele',
    },
    { id: 'l', type: 'link', x: 500, y: 0, width: 300, height: 200, url: 'https://jsoncanvas.org' },
    {
      id: 'g',
      type: 'group',
      x: -20,
      y: -20,
      width: 900,
      height: 600,
      label: 'Sprint',
      backgroundStyle: 'cover',
      futureField: true,
    },
  ],
  edges: [
    { id: 'e', fromNode: 'a', fromSide: 'bottom', toNode: 'f', toEnd: 'arrow', label: 'führt zu' },
  ],
  futureTopLevel: { kept: 1 },
};

describe('JSON Canvas', () => {
  it('reads the spec and keeps what it does not know', () => {
    const canvas = parseCanvas(JSON.stringify(sample));
    expect(canvas.nodes).toHaveLength(4);
    expect(JSON.parse(serializeCanvas(canvas))).toEqual(sample);
    expect(serializeCanvas(canvas)).toStartWith('{\n\t"nodes"');
  });

  it('treats an empty file as an empty canvas and refuses anything else', () => {
    expect(parseCanvas('')).toEqual({ nodes: [], edges: [] });
    expect(() => parseCanvas('{')).toThrow(CanvasFormatError);
    expect(() => parseCanvas(JSON.stringify({ nodes: [{ id: 'x', type: 'text' }] }))).toThrow(
      CanvasFormatError,
    );
  });

  it('gives the search the words of the cards and the notes they point at', () => {
    const text = canvasText(JSON.stringify(sample));
    expect(text).toContain('# Idee');
    expect(text).toContain('[[Projects/VOL/Docs/Plan]]');
    expect(text).toContain('https://jsoncanvas.org');
    expect(text).toContain('Sprint');
    expect(text).toContain('führt zu');
    expect(canvasText('nicht json')).toBe('');
  });
});
