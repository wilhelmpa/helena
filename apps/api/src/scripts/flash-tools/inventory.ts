import { readFile, writeFile } from 'node:fs/promises';
import { toMcpTool } from '@helena/sdk';
import { BROWSER_TOOLS } from '../../../../../packages/browser-gateway/src/tools';
import {
  clarifyTool,
  findToolsTool,
  memoryTool,
  sessionSearchTool,
  skillTool,
} from '../../../../../packages/agent-runtime/src/tools/builtin';
import { FILE_TOOLS } from '../../../../../packages/agent-runtime/src/tools/files';
import { shellTool } from '../../../../../packages/agent-runtime/src/tools/shell';
import { app } from '../../app';
import { routeTools, withoutFields } from '../../mcp/generate';
import { registries } from '../../shared/helena';

type Schema = Record<string, unknown>;
type SourceTool = {
  group: string;
  name: string;
  description: string;
  inputSchema: Schema;
};

function schemaFacts(schema: Schema) {
  const enums: Record<string, unknown[]> = {};
  const nestedObjects: string[] = [];
  const visit = (value: unknown, path: string): void => {
    if (!value || typeof value !== 'object') return;
    const node = value as Schema;
    if (Array.isArray(node.enum)) enums[path || '$'] = node.enum;
    if (path && (node.type === 'object' || node.properties)) nestedObjects.push(path);
    for (const [key, child] of Object.entries((node.properties ?? {}) as Schema))
      visit(child, path ? `${path}.${key}` : key);
    if (node.items) visit(node.items, `${path}[]`);
    for (const union of ['oneOf', 'anyOf', 'allOf'])
      if (Array.isArray(node[union]))
        node[union].forEach((child: unknown, index: number) =>
          visit(child, `${path}.${union}[${index}]`),
        );
  };
  visit(schema, '');
  return {
    schemaBytes: Buffer.byteLength(JSON.stringify(schema)),
    required: Array.isArray(schema.required) ? schema.required : [],
    enums,
    nestedObjects,
  };
}

export function inventory(external: SourceTool[] = []) {
  const routes = routeTools(app);
  const routeNames = new Set(routes.map((entry) => entry.name));
  const source: SourceTool[] = [
    ...routes.map((entry) => ({
      group: entry.name === 'decide' ? 'decide' : 'helena-mcp',
      name: entry.name,
      description: entry.description,
      inputSchema: (entry.pathParams.includes('teamId')
        ? withoutFields(entry.inputSchema, ['teamId'])
        : entry.inputSchema) as unknown as Schema,
    })),
    ...registries.tools
      .list()
      .filter((entry) => !routeNames.has(entry.name))
      .map((entry) => {
        const tool = toMcpTool(entry);
        return {
          group: entry.connector ? 'configured-connector' : 'helena-plugin',
          name: tool.name,
          description: tool.description ?? '',
          inputSchema: tool.inputSchema as Schema,
        };
      }),
    ...BROWSER_TOOLS.map((entry) => ({
      group: 'browser-gateway',
      name: entry.name,
      description: entry.description,
      inputSchema: entry.inputSchema as Schema,
    })),
    ...FILE_TOOLS.map((entry) => ({
      group: entry.name === 'search_files' ? 'search' : 'files-git',
      name: entry.name,
      description: entry.description,
      inputSchema: entry.inputSchema as Schema,
    })),
    ...[
      clarifyTool,
      findToolsTool(() => []),
      skillTool([]),
      memoryTool({} as Parameters<typeof memoryTool>[0]),
      sessionSearchTool({} as Parameters<typeof sessionSearchTool>[0]),
    ].map((entry) => ({
      group: entry.name === 'search_sessions' ? 'search' : 'runtime-meta',
      name: entry.name,
      description: entry.description,
      inputSchema: entry.inputSchema as Schema,
    })),
    ...[shellTool({ timeoutMs: 300_000 })].map((entry) => ({
      group: 'shell-git',
      name: entry.name,
      description: entry.description,
      inputSchema: entry.inputSchema as Schema,
    })),
    ...external,
  ];
  return source
    .map((entry) => ({
      group: entry.group,
      name: entry.name,
      descriptionChars: entry.description.length,
      offeredDescriptionChars: Math.min(entry.description.length, 2000),
      ...schemaFacts(entry.inputSchema),
    }))
    .sort(
      (left, right) => left.group.localeCompare(right.group) || left.name.localeCompare(right.name),
    );
}

if (import.meta.main) {
  const output = process.argv[2];
  if (!output) throw new Error('Usage: bun inventory.ts OUTPUT.json [EXTERNAL_TOOLS.json]');
  const external = process.argv[3]
    ? (JSON.parse(await readFile(process.argv[3], 'utf8')) as SourceTool[])
    : [];
  await writeFile(output, JSON.stringify(inventory(external), null, 2) + '\n');
  process.exit(0);
}
