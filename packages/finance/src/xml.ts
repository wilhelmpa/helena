import { XMLParser } from 'fast-xml-parser';

/**
 * Small accessors over fast-xml-parser's object tree. The parser runs with namespace prefixes
 * removed, attributes kept (prefix "@_"), no value coercion and no entity processing: entity
 * expansion stays off so a hostile DOCTYPE cannot blow up memory, and the five predefined
 * entities plus numeric references are decoded here instead.
 */
export type XmlNode = string | XmlObject;
export interface XmlObject {
  [key: string]: XmlNode | XmlNode[] | undefined;
}

export function parseXml(xml: string, arrayTags: readonly string[]): XmlObject {
  const arrays = new Set(arrayTags);
  const parser = new XMLParser({
    removeNSPrefix: true,
    ignoreAttributes: false,
    parseTagValue: false,
    processEntities: false,
    isArray: (name, _path, _leaf, isAttribute) => !isAttribute && arrays.has(name),
  });
  const parsed: unknown = parser.parse(xml.replace(/^\uFEFF/, ''));
  return isObject(parsed) ? parsed : {};
}

export function isObject(value: unknown): value is XmlObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Every child element with that name, as an array (empty when absent). */
export function children(node: XmlNode | undefined, name: string): XmlNode[] {
  if (!node || !isObject(node)) return [];
  const value = node[name];
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** Walks a path of element names and returns the first match at every step. */
export function child(node: XmlNode | undefined, ...path: string[]): XmlNode | undefined {
  let current: XmlNode | undefined = node;
  for (const name of path) {
    current = children(current, name)[0];
    if (current === undefined) return undefined;
  }
  return current;
}

/** All nodes reachable over the path, fanning out over repeated elements at every step. */
export function all(node: XmlNode | undefined, ...path: string[]): XmlNode[] {
  let level: XmlNode[] = node === undefined ? [] : [node];
  for (const name of path) level = level.flatMap((n) => children(n, name));
  return level;
}

/** The trimmed text content of the node at the path, or null when it is absent or empty. */
export function text(node: XmlNode | undefined, ...path: string[]): string | null {
  const target = path.length ? child(node, ...path) : node;
  if (target === undefined) return null;
  const raw = typeof target === 'string' ? target : target['#text'];
  if (typeof raw !== 'string') return null;
  const value = decodeEntities(raw).trim();
  return value === '' ? null : value;
}

/** An attribute of the node at the path (attributes are stored with the "@_" prefix). */
export function attr(node: XmlNode | undefined, name: string, ...path: string[]): string | null {
  const target = path.length ? child(node, ...path) : node;
  if (!target || !isObject(target)) return null;
  const value = target[`@_${name}`];
  return typeof value === 'string' && value.trim() !== '' ? decodeEntities(value).trim() : null;
}

/** The first non-null text over several alternative paths. */
export function firstText(node: XmlNode | undefined, ...paths: string[][]): string | null {
  for (const path of paths) {
    const value = text(node, ...path);
    if (value !== null) return value;
  }
  return null;
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeEntities(value: string): string {
  if (!value.includes('&')) return value;
  return value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (match, ref: string) => {
    if (ref.startsWith('#x')) return safeCodePoint(parseInt(ref.slice(2), 16)) ?? match;
    if (ref.startsWith('#')) return safeCodePoint(parseInt(ref.slice(1), 10)) ?? match;
    return NAMED[ref] ?? match;
  });
}

function safeCodePoint(code: number): string | null {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return null;
  return String.fromCodePoint(code);
}
