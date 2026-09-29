import { isDeepStrictEqual } from 'node:util';
import { parseDocument, type Document } from 'yaml';
import { VaultError } from './errors';

// A deliberately small Obsidian Bases dialect. Keep the YAML tree and original bytes:
// editing a supported field must not drop plugin keys, comments or unsupported views.
export interface BaseView {
  type: string;
  name?: string;
  filters?: unknown;
  order?: string[];
  sort?: unknown;
  limit?: number;
  [key: string]: unknown;
}

export interface BaseDefinition {
  filters?: unknown;
  formulas?: Record<string, unknown>;
  properties?: Record<string, unknown>;
  summaries?: Record<string, unknown>;
  views: BaseView[];
  [key: string]: unknown;
}

export interface ParsedBase {
  definition: BaseDefinition;
  original: string;
  document: Document;
  snapshot: BaseDefinition;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseBase(source: string): ParsedBase {
  if (Buffer.byteLength(source) > 2 * 1024 * 1024) throw new VaultError(413, 'Base is too large');
  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length)
    throw new VaultError(400, `Invalid Base YAML: ${document.errors[0]!.message}`);
  const value: unknown = document.toJS();
  if (!record(value) || !Array.isArray(value.views) || !value.views.every(record)) {
    throw new VaultError(400, 'A Base needs a views array');
  }
  if (value.views.length > 30) throw new VaultError(400, 'A Base has too many views');
  for (const view of value.views) {
    if (typeof view.type !== 'string') throw new VaultError(400, 'Each Base view needs a type');
  }
  const definition = value as BaseDefinition;
  return { definition, original: source, document, snapshot: structuredClone(definition) };
}

export function serializeBase(base: ParsedBase): string {
  if (isDeepStrictEqual(base.definition, base.snapshot)) return base.original;
  for (const key of Object.keys(base.snapshot)) {
    if (!(key in base.definition)) base.document.delete(key);
  }
  for (const [key, value] of Object.entries(base.definition)) {
    if (!isDeepStrictEqual(value, base.snapshot[key])) base.document.set(key, value);
  }
  return base.document.toString({ lineWidth: 0 });
}

export type BaseValues = Record<string, unknown>;
export interface BaseFile {
  path: string;
  name: string;
  folder: string;
  basename: string;
  ext: string;
  ctime: string | null;
  mtime: string | null;
}

export interface BaseItem {
  file: BaseFile;
  note: BaseValues;
  formula: BaseValues;
}

export class UnsupportedBaseExpression extends Error {
  constructor(public expression: string) {
    super(`Unsupported Base expression: ${expression}`);
  }
}

type Token = { kind: 'id' | 'string' | 'number' | 'op'; text: string };
const TOKEN =
  /\s*(?:([A-Za-z_][\w.]*)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(\d+(?:\.\d+)?)|(==|!=|<=|>=|&&|\|\||[()!,+*/<>-]))/y;

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  for (let offset = 0; offset < source.length;) {
    TOKEN.lastIndex = offset;
    const match = TOKEN.exec(source);
    if (!match) throw new UnsupportedBaseExpression(source);
    offset = TOKEN.lastIndex;
    tokens.push({
      kind: match[1] ? 'id' : match[2] ? 'string' : match[3] ? 'number' : 'op',
      text: match[1] ?? match[2] ?? match[3] ?? match[4]!,
    });
    if (tokens.length > 100) throw new UnsupportedBaseExpression(source);
  }
  return tokens;
}

const PRECEDENCE: Record<string, number> = {
  '||': 1,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '<': 3,
  '<=': 3,
  '>': 3,
  '>=': 3,
  '+': 4,
  '-': 4,
  '*': 5,
  '/': 5,
};

// Parse once before evaluating any row, so unsupported syntax cannot yield partial data.
export function compileBaseExpression(source: string): (item: BaseItem) => unknown {
  if (source.length > 4096) throw new UnsupportedBaseExpression(source.slice(0, 120));
  const tokens = tokenize(source.trim());
  let cursor = 0;
  const fail = (): never => {
    throw new UnsupportedBaseExpression(source);
  };
  const take = (symbol: string) => {
    if (tokens[cursor]?.text === symbol) {
      cursor += 1;
      return true;
    }
    return false;
  };
  type Expression = (item: BaseItem) => unknown;
  const parse = (minimum = 0): Expression => {
    const token = tokens[cursor++];
    if (!token) return fail();
    let left: Expression;
    if (token.text === '(') {
      left = parse();
      if (!take(')')) return fail();
    } else if (token.text === '!') {
      const value = parse(6);
      left = (item) => !value(item);
    } else if (token.text === '-') {
      const value = parse(6);
      left = (item) => -Number(value(item));
    } else if (token.kind === 'number') {
      const value = Number(token.text);
      left = () => value;
    } else if (token.kind === 'string') {
      let value: string;
      try {
        value =
          token.text[0] === '"'
            ? JSON.parse(token.text)
            : token.text.slice(1, -1).replace(/\\'/g, "'");
      } catch {
        return fail();
      }
      left = () => value;
    } else if (token.kind === 'id' && ['true', 'false', 'null'].includes(token.text)) {
      const value = token.text === 'null' ? null : token.text === 'true';
      left = () => value;
    } else if (token.kind === 'id' && take('(')) {
      const args: Expression[] = [];
      if (!take(')')) {
        do {
          args.push(parse());
        } while (take(','));
        if (!take(')')) return fail();
      }
      if (token.text === 'file.inFolder' && args.length === 1) {
        left = (item) => {
          const folder = String(args[0]!(item)).replace(/\/$/, '');
          return item.file.path.startsWith(`${folder}/`);
        };
      } else if (token.text === 'if' && args.length === 3) {
        left = (item) => (args[0]!(item) ? args[1]!(item) : args[2]!(item));
      } else if (token.text === 'contains' && args.length === 2) {
        left = (item) => {
          const container = args[0]!(item);
          const member = args[1]!(item);
          return Array.isArray(container)
            ? container.includes(member)
            : typeof container === 'string' && container.includes(String(member));
        };
      } else return fail();
    } else if (token.kind === 'id' && /^(file|note|formula)\.[A-Za-z_][\w.]*$/.test(token.text)) {
      const [namespace, ...key] = token.text.split('.');
      left = (item) => {
        let value: unknown = item[namespace as keyof BaseItem];
        for (const part of key) {
          if (!record(value) || !Object.hasOwn(value, part)) return null;
          value = value[part];
        }
        return value;
      };
    } else return fail();
    while (cursor < tokens.length) {
      const operator = tokens[cursor]!.text;
      const priority = PRECEDENCE[operator] ?? 0;
      if (priority <= minimum) break;
      cursor += 1;
      const right = parse(priority);
      const previous = left;
      left = (item) => {
        const a = previous(item);
        if (operator === '&&') return Boolean(a) && Boolean(right(item));
        if (operator === '||') return Boolean(a) || Boolean(right(item));
        const b = right(item);
        switch (operator) {
          case '==':
            return a === b;
          case '!=':
            return a !== b;
          case '<':
            return comparePair(a, b, '<');
          case '<=':
            return comparePair(a, b, '<=');
          case '>':
            return comparePair(a, b, '>');
          case '>=':
            return comparePair(a, b, '>=');
          case '+':
            return typeof a === 'number' && typeof b === 'number' ? a + b : `${a ?? ''}${b ?? ''}`;
          case '-':
            return numeric(a) && numeric(b) ? a - b : null;
          case '*':
            return numeric(a) && numeric(b) ? a * b : null;
          case '/':
            return numeric(a) && numeric(b) && b !== 0 ? a / b : null;
          default:
            return null;
        }
      };
    }
    return left;
  };
  const expression = parse();
  if (cursor !== tokens.length) return fail();
  return expression;
}

function numeric(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function comparePair(a: unknown, b: unknown, operator: '<' | '<=' | '>' | '>='): boolean {
  if (!(
    (typeof a === 'number' && typeof b === 'number') ||
    (typeof a === 'string' && typeof b === 'string')
  ))
    return false;
  switch (operator) {
    case '<':
      return a < b;
    case '<=':
      return a <= b;
    case '>':
      return a > b;
    case '>=':
      return a >= b;
  }
}

export function compileBaseFilter(value: unknown): (item: BaseItem) => boolean {
  if (value === undefined || value === null) return () => true;
  if (typeof value === 'string') {
    const expression = compileBaseExpression(value);
    return (item) => Boolean(expression(item));
  }
  if (!record(value) || Object.keys(value).length !== 1) {
    throw new UnsupportedBaseExpression(JSON.stringify(value));
  }
  if (Array.isArray(value.and)) {
    const filters = value.and.map(compileBaseFilter);
    return (item) => filters.every((filter) => filter(item));
  }
  if (Array.isArray(value.or)) {
    const filters = value.or.map(compileBaseFilter);
    return (item) => filters.some((filter) => filter(item));
  }
  if (value.not !== undefined) {
    const filter = compileBaseFilter(value.not);
    return (item) => !filter(item);
  }
  throw new UnsupportedBaseExpression(JSON.stringify(value));
}
