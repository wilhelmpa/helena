import { lstat, mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { error, text, type AgentTool, type ToolOutput } from './types';

// Files of the working folder. Every path stays below it: a path is resolved against it, and
// the real path of what exists (symlinks followed) must still lie inside, so a link cannot
// lead out. Inside Helena's agent isolation the folder is the project's workspace and the
// command runs as the project's user, which is the real boundary; this check keeps an eval or
// an operator's own runner to the folder as well.

const READ_LIMIT = 60_000;
const LIST_LIMIT = 400;
const SEARCH_LIMIT = 100;
const SKIP_DIRS = new Set(['.git', 'node_modules', '.next', 'dist', '.venv', '__pycache__']);

export class PathError extends Error {}

async function nearestExisting(path: string): Promise<string> {
  let current = path;
  for (;;) {
    try {
      return await realpath(current);
    } catch {
      const parent = dirname(current);
      if (parent === current) throw new PathError('path not found');
      current = parent;
    }
  }
}

// The absolute path of `input` inside `workdir`, or a PathError.
export async function insideWorkdir(workdir: string, input: string): Promise<string> {
  if (!input || input.includes('\0')) throw new PathError('empty path');
  const root = await realpath(workdir);
  const target = resolve(root, isAbsolute(input) ? input : join('.', input));
  const within = (path: string) => path === root || path.startsWith(root + sep);
  if (!within(target)) throw new PathError(`${input} is outside the working folder`);
  const real = await nearestExisting(target);
  if (!within(real)) throw new PathError(`${input} leads outside the working folder`);
  return target;
}

function relativeName(workdir: string, path: string): string {
  return relative(workdir, path) || '.';
}

async function guarded(action: () => Promise<ToolOutput>): Promise<ToolOutput> {
  try {
    return await action();
  } catch (err) {
    if (err instanceof PathError) return error(err.message);
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') return error('No such file or folder.');
    if (code === 'EISDIR') return error('That is a folder.');
    if (code === 'EACCES' || code === 'EPERM') return error('Not allowed.');
    return error(err instanceof Error ? err.message.slice(0, 300) : 'failed');
  }
}

const readFileTool: AgentTool = {
  name: 'read_file',
  description:
    'Read a text file of the working folder. Lines are numbered. Use offset/limit (lines) for long files.',
  readOnly: true,
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path relative to the working folder' },
      offset: { type: 'integer', description: 'First line (1-based)' },
      limit: { type: 'integer', description: 'Number of lines' },
    },
    required: ['path'],
  },
  execute: (input, ctx) =>
    guarded(async () => {
      const path = await insideWorkdir(ctx.workdir, text(input.path));
      const content = await readFile(path, 'utf8');
      const lines = content.split('\n');
      const offset = Math.max(1, Number(input.offset) || 1);
      const limit = Math.max(1, Number(input.limit) || lines.length);
      const slice = lines.slice(offset - 1, offset - 1 + limit);
      let out = slice.map((line, index) => `${offset + index}\t${line}`).join('\n');
      if (out.length > READ_LIMIT) out = `${out.slice(0, READ_LIMIT)}\n… (cut, use offset/limit)`;
      return { text: out || '(empty file)' };
    }),
};

const writeFileTool: AgentTool = {
  name: 'write_file',
  description: 'Create or replace a file of the working folder with the given content.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      content: { type: 'string' },
    },
    required: ['path', 'content'],
  },
  question: (input) => ({ tool: 'write_file', path: text(input.path) }),
  execute: (input, ctx) =>
    guarded(async () => {
      const path = await insideWorkdir(ctx.workdir, text(input.path));
      const existing = await lstat(path).catch(() => null);
      if (existing?.isSymbolicLink()) return error('Refusing to write through a symbolic link.');
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, text(input.content));
      return {
        text: `Wrote ${relativeName(ctx.workdir, path)} (${text(input.content).length} chars).`,
        changed: true,
      };
    }),
};

const editFileTool: AgentTool = {
  name: 'edit_file',
  description:
    'Replace an exact piece of text in a file. old_text must occur exactly once unless replace_all is true. Read the file first.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      old_text: { type: 'string' },
      new_text: { type: 'string' },
      replace_all: { type: 'boolean' },
    },
    required: ['path', 'old_text', 'new_text'],
  },
  question: (input) => ({ tool: 'patch', path: text(input.path) }),
  execute: (input, ctx) =>
    guarded(async () => {
      const path = await insideWorkdir(ctx.workdir, text(input.path));
      const existing = await lstat(path);
      if (existing.isSymbolicLink()) return error('Refusing to write through a symbolic link.');
      const content = await readFile(path, 'utf8');
      const oldText = text(input.old_text);
      if (!oldText) return error('old_text is empty.');
      const count = content.split(oldText).length - 1;
      if (count === 0)
        return error('old_text was not found. Read the file and copy the text exactly.');
      if (count > 1 && input.replace_all !== true) {
        return error(`old_text occurs ${count} times. Give more context or set replace_all.`);
      }
      const next =
        input.replace_all === true
          ? content.split(oldText).join(text(input.new_text))
          : content.replace(oldText, () => text(input.new_text));
      await writeFile(path, next);
      return {
        text: `Edited ${relativeName(ctx.workdir, path)} (${count} change).`,
        changed: true,
      };
    }),
};

async function walk(
  root: string,
  dir: string,
  depth: number,
  visit: (path: string, isDir: boolean) => boolean,
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const path = join(dir, entry.name);
    const isDir = entry.isDirectory();
    if (!visit(path, isDir)) return;
    if (isDir && depth > 0 && !SKIP_DIRS.has(entry.name)) await walk(root, path, depth - 1, visit);
  }
}

const listFilesTool: AgentTool = {
  name: 'list_files',
  description: 'List files and folders of the working folder (folders end with /).',
  readOnly: true,
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Folder, default the working folder' },
      depth: { type: 'integer', description: 'How deep, default 2' },
    },
  },
  execute: (input, ctx) =>
    guarded(async () => {
      const dir = await insideWorkdir(ctx.workdir, text(input.path) || '.');
      const info = await stat(dir);
      if (!info.isDirectory()) return error('That is a file.');
      const lines: string[] = [];
      const depth = Math.min(Math.max(Number(input.depth) || 2, 0), 6);
      await walk(dir, dir, depth, (path, isDir) => {
        lines.push(`${relativeName(ctx.workdir, path)}${isDir ? '/' : ''}`);
        return lines.length < LIST_LIMIT;
      });
      return {
        text: lines.length
          ? lines.join('\n') + (lines.length >= LIST_LIMIT ? '\n… (more)' : '')
          : '(empty)',
      };
    }),
};

const searchFilesTool: AgentTool = {
  name: 'search_files',
  description:
    'Search the text of the files in the working folder for a regular expression. Returns file:line: text.',
  readOnly: true,
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string' },
      path: { type: 'string', description: 'Folder to search, default the working folder' },
    },
    required: ['pattern'],
  },
  execute: (input, ctx) =>
    guarded(async () => {
      let pattern: RegExp;
      try {
        pattern = new RegExp(text(input.pattern), 'i');
      } catch {
        return error('Invalid regular expression.');
      }
      const dir = await insideWorkdir(ctx.workdir, text(input.path) || '.');
      const files: string[] = [];
      await walk(dir, dir, 12, (path, isDir) => {
        if (!isDir) files.push(path);
        return files.length < 5000;
      });
      const hits: string[] = [];
      for (const file of files) {
        if (ctx.signal.aborted || hits.length >= SEARCH_LIMIT) break;
        const info = await stat(file).catch(() => null);
        if (!info || info.size > 2_000_000) continue;
        const content = await readFile(file, 'utf8').catch(() => '');
        if (content.includes('\0')) continue;
        content.split('\n').forEach((line, index) => {
          if (hits.length < SEARCH_LIMIT && pattern.test(line)) {
            hits.push(`${relativeName(ctx.workdir, file)}:${index + 1}: ${line.slice(0, 200)}`);
          }
        });
      }
      return { text: hits.length ? hits.join('\n') : 'No match.' };
    }),
};

export const FILE_TOOLS: AgentTool[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  listFilesTool,
  searchFilesTool,
];
