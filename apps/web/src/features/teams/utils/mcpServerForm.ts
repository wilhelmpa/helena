import type {
  McpServer,
  McpServerInput,
  McpServerValue,
  McpServerValueInput,
  McpTransport,
} from '@/lib/api/endpoints/agentMcpServers';
import type { IntegrationOption } from '@/lib/api/endpoints/integrations';

// One environment variable or header in the form. A secret row takes its value from the
// team secret `credentialId` names, and has none while no secret is picked.
export interface McpValueRow {
  name: string;
  secret: boolean;
  value: string;
  credentialId: number | null;
}

export interface McpServerFormValue {
  name: string;
  description: string;
  transport: McpTransport;
  command: string;
  // One argument per line.
  args: string;
  url: string;
  env: McpValueRow[];
  headers: McpValueRow[];
}

// The rules the API applies, so the form can say what is missing before it is sent.
const NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const HEADER_NAME = /^[A-Za-z0-9-]{1,128}$/;
const HTTP_URL = /^https?:\/\/\S+$/;

// Hermes expands ${VAR} with its own environment, so the API refuses it in a literal.
const EXPANSION = '${';

export type McpServerPresetKey = 'shopify-dev' | 'jev-browser';

// The servers the owner adds most, as the packages document them. Their descriptions
// are messages under `teams.mcpServers.presets`.
export const MCP_SERVER_PRESETS: {
  key: McpServerPresetKey;
  label: string;
  value: Omit<McpServerFormValue, 'description'>;
}[] = [
  {
    key: 'shopify-dev',
    label: 'Shopify Dev MCP',
    value: {
      name: 'shopify-dev',
      transport: 'stdio',
      command: 'npx',
      args: '-y\n@shopify/dev-mcp@latest',
      url: '',
      env: [],
      headers: [],
    },
  },
  {
    key: 'jev-browser',
    label: 'Jev Browser',
    value: {
      name: 'jev-browser',
      transport: 'stdio',
      command: 'npx',
      args: '-y\n@jkudish/jev-browser',
      url: '',
      env: [{ name: 'TYPESAFE_API_KEY', secret: true, value: '', credentialId: null }],
      headers: [],
    },
  },
];

export function emptyMcpServerValue(): McpServerFormValue {
  return {
    name: '',
    description: '',
    transport: 'stdio',
    command: '',
    args: '',
    url: '',
    env: [],
    headers: [],
  };
}

// A preset, with each of its secret rows set to the team's secret of the same name when
// there is one.
export function presetValue(
  key: McpServerPresetKey,
  description: string,
  secrets: IntegrationOption[],
): McpServerFormValue {
  const preset = MCP_SERVER_PRESETS.find((entry) => entry.key === key)!;
  const withSecret = (row: McpValueRow): McpValueRow =>
    row.secret
      ? { ...row, credentialId: secrets.find((s) => s.label === row.name)?.id ?? null }
      : row;
  return {
    ...preset.value,
    description,
    env: preset.value.env.map(withSecret),
    headers: preset.value.headers.map(withSecret),
  };
}

// A secret deleted since has no label, and has to be picked again.
function rowOf(value: McpServerValue): McpValueRow {
  return value.credentialId === null
    ? { name: value.name, secret: false, value: value.value ?? '', credentialId: null }
    : {
        name: value.name,
        secret: true,
        value: '',
        credentialId: value.credentialLabel === null ? null : value.credentialId,
      };
}

export function mcpServerValue(server: McpServer): McpServerFormValue {
  return {
    name: server.name,
    description: server.description,
    transport: server.transport,
    command: server.command ?? '',
    args: server.args.join('\n'),
    url: server.url ?? '',
    env: server.env.map(rowOf),
    headers: server.headers.map(rowOf),
  };
}

function argsOf(text: string): string[] {
  return text
    .split('\n')
    .map((arg) => arg.trim())
    .filter(Boolean);
}

function rowsValid(rows: McpValueRow[], name: RegExp, caseInsensitive: boolean): boolean {
  const names = rows.map((row) => (caseInsensitive ? row.name.toLowerCase() : row.name).trim());
  return (
    new Set(names).size === names.length &&
    rows.every(
      (row) =>
        name.test(row.name.trim()) &&
        (row.secret ? row.credentialId !== null : !row.value.includes(EXPANSION)),
    )
  );
}

export function isMcpServerFormValid(v: McpServerFormValue): boolean {
  if (!NAME.test(v.name)) return false;
  if (v.transport === 'stdio') {
    return (
      v.command.trim() !== '' &&
      !`${v.command}\n${v.args}`.includes(EXPANSION) &&
      rowsValid(v.env, ENV_NAME, false)
    );
  }
  return (
    HTTP_URL.test(v.url.trim()) &&
    !v.url.includes(EXPANSION) &&
    rowsValid(v.headers, HEADER_NAME, true)
  );
}

function inputRows(rows: McpValueRow[]): McpServerValueInput[] {
  return rows.map((row) =>
    row.secret
      ? { name: row.name.trim(), credentialId: row.credentialId! }
      : { name: row.name.trim(), value: row.value },
  );
}

// The body of a create or an update. The fields the transport does not use are sent
// empty, which is how the API stores them.
export function toMcpServerInput(v: McpServerFormValue): McpServerInput {
  const stdio = v.transport === 'stdio';
  return {
    name: v.name,
    description: v.description.trim(),
    transport: v.transport,
    command: stdio ? v.command.trim() : null,
    args: stdio ? argsOf(v.args) : [],
    url: stdio ? null : v.url.trim(),
    env: stdio ? inputRows(v.env) : [],
    headers: stdio ? [] : inputRows(v.headers),
  };
}
