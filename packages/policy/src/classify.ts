import { categoryFromAnnotations as sdkCategoryFromAnnotations } from '@helena/sdk';
import { ACTION_CATEGORIES, actionRank, type ActionCategory, type ActionScope } from './categories';
import { isHelenaMcpServer, isOrderToolName, mentionsLiveTradingHost } from './trading';

// How a tool call becomes an action category (docs/helena-decisions/policy-engine.md).
// Every tool is or becomes an MCP tool, so the MCP tool annotations are the basis; the
// tables below only name what a hint cannot say, and shell commands, which carry no
// annotations, are classified by what they run and where.

export interface Classified {
  category: ActionCategory;
  scope: ActionScope;
}

// MCP ToolAnnotations (spec 2025-06-18). Absent hints take the spec's defaults: not read
// only, destructive and open world.
export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

// An explicit category wins; then what the annotations say (@helena/sdk, D-C1): read only
// → read, destructive → delete, open world → send, otherwise write. An unannotated tool is
// therefore an outward action.
export function categoryFromAnnotations(
  annotations: ToolAnnotations | null | undefined,
  explicit?: ActionCategory | null,
): ActionCategory {
  return explicit ?? sdkCategoryFromAnnotations(annotations ?? undefined);
}

// ---------------------------------------------------------------------------------------
// Shell commands

// Programs that only read, whatever their arguments (redirections aside).
const READ_PROGRAMS = new Set([
  'ls',
  'll',
  'cat',
  'head',
  'tail',
  'less',
  'more',
  'grep',
  'egrep',
  'fgrep',
  'rg',
  'ag',
  'pwd',
  'wc',
  'echo',
  'printf',
  'which',
  'type',
  'file',
  'stat',
  'du',
  'df',
  'tree',
  'diff',
  'cmp',
  'sort',
  'uniq',
  'cut',
  'tr',
  'jq',
  'yq',
  'date',
  'whoami',
  'id',
  'uname',
  'hostname',
  'env',
  'printenv',
  'basename',
  'dirname',
  'realpath',
  'readlink',
  'nl',
  'column',
  'true',
  'false',
  'test',
  '[',
  'cd',
  'sleep',
  'md5sum',
  'sha256sum',
  'shasum',
  'xxd',
  'hexdump',
  'strings',
  'ps',
  'free',
  'uptime',
  'man',
  'awk',
  'sed',
]);

// git subcommands that only read.
const GIT_READ = new Set([
  'status',
  'log',
  'diff',
  'show',
  'blame',
  'ls-files',
  'ls-tree',
  'rev-parse',
  'describe',
  'shortlog',
  'grep',
  'reflog',
  'cat-file',
  'fetch',
]);

const PUBLISH_COMMANDS: RegExp[] = [
  /^git push\b/,
  /^(npm|pnpm|yarn|bun) publish\b/,
  /^(docker|podman) push\b/,
  /^gh (release|pr|repo|gist) create\b/,
  /^gh pr merge\b/,
  /^(vercel|netlify|fly|flyctl|railway|firebase)\b.*\b(deploy|--prod)\b/,
  /^vercel\b/,
  /^wrangler (deploy|publish|pages)\b/,
  /^(twine upload|cargo publish|gem push|helm push|dotnet nuget push)\b/,
  /^kubectl (apply|create|delete|rollout)\b/,
  /^terraform (apply|destroy)\b/,
];

const SEND_COMMANDS: RegExp[] = [
  /^(mail|mailx|sendmail|mutt|msmtp|swaks)\b/,
  /^(scp|sftp|ftp)\b/,
  /^rsync\b.*\s[^\s/]+:/,
  /^(nc|ncat|netcat|telnet)\b/,
  /^(curl|wget|http|https|xh)\b.*(\s-(X|-request)\s*(POST|PUT|PATCH|DELETE)\b|\s(-d|--data\S*|-F|--form|-T|--upload-file|--post-data|--post-file)\b)/i,
];

const CREDENTIAL_COMMANDS: RegExp[] = [
  /^(ssh-keygen|ssh-add|ssh-copy-id|gpg|passwd|chpasswd|htpasswd|security|keyctl)\b/,
  /^gh (auth|secret|ssh-key)\b/,
  /^git config\b.*\bcredential/,
  /^(aws|gcloud|az) (configure|auth|login)\b/,
  /^(npm|pnpm|yarn) (login|adduser|token)\b/,
  /^(docker|podman) login\b/,
  /^(op|bw|pass|vault) /,
];

const DELETE_COMMANDS: RegExp[] = [
  /^(rm|rmdir|unlink|shred|srm|trash|truncate)\b/,
  /^git (clean|rm)\b/,
  /^git reset\b.*--hard\b/,
  /^git (checkout|restore)\b.*(\s--\s|\s\.$|--force|-f\b)/,
  /^git branch\b.*\s-(D|d|-delete)\b/,
  /^git stash (drop|clear)\b/,
  /^find\b.*\s-delete\b/,
  /^(dropdb|dropuser)\b/,
  /^(psql|mysql|sqlite3)\b.*\b(drop|delete|truncate)\b/i,
  /^docker (rm|rmi|system prune|volume rm)\b/,
];

const EXECUTE_EXTERNAL_COMMANDS: RegExp[] = [
  /^(sudo|su|doas|pkexec)\b/,
  /^(systemctl|service|journalctl --vacuum|shutdown|reboot|halt|poweroff|mount|umount|mkfs\S*|fdisk|parted|dd|iptables|nft|ufw|crontab|at|launchctl)\b/,
  /^(apt|apt-get|dpkg|yum|dnf|pacman|brew|snap|flatpak|port)\b/,
  /^(npm|pnpm|yarn|bun) (install|add|i)\b.*\s(-g|--global)\b/,
  /^pip3? install\b(?!.*(-r|--requirement|\s-e\s|\s\.))/,
  /^(kill|pkill|killall)\b/,
  /^chown\b/,
  /^(ssh|mosh)\b/,
  /^(docker|podman) (run|exec|compose)\b/,
];

// Splits a command line into its simple commands: at ;, &&, ||, | and newlines, outside
// quotes. Good enough to find the programs; it is not a shell parser.
export function simpleCommands(command: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (let index = 0; index < command.length; index++) {
    const char = command[index]!;
    if (quote) {
      if (char === quote) quote = null;
      current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    const two = command.slice(index, index + 2);
    if (two === '&&' || two === '||') {
      parts.push(current);
      current = '';
      index++;
      continue;
    }
    // A lone & sends a command to the background; in `2>&1` or `&>` it is a redirection.
    const redirect =
      char === '&' &&
      (command[index - 1] === '>' || command[index - 1] === '<' || command[index + 1] === '>');
    if (char === ';' || char === '|' || char === '\n' || (char === '&' && !redirect)) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts
    .map((part) => part.trim().replace(/^[({\s]+/, ''))
    .map((part) =>
      // Leading variable assignments and wrappers that only change how a command runs.
      part
        .replace(/^(\w+=("[^"]*"|'[^']*'|\S*)\s+)+/, '')
        .replace(/^(env|nice|nohup|time|timeout \S+|xargs( -\S+)*|exec)\s+/, ''),
    )
    .filter(Boolean);
}

function words(command: string): string[] {
  return (
    command.match(/"[^"]*"|'[^']*'|\S+/g)?.map((word) => word.replace(/^["']|["']$/g, '')) ?? []
  );
}

// The paths a command names, for its scope: absolute ones, home-relative ones and ones that
// climb out with "..".
function pathsOf(command: string): string[] {
  return words(command)
    .slice(1)
    .map((word) => word.replace(/^[0-9]*[<>]+&?/, ''))
    .filter((word) => !word.startsWith('-') || word.includes('='))
    .map((word) => word.replace(/^-[^=]*=/, ''))
    .filter(
      (word) =>
        word.startsWith('/') ||
        word.startsWith('~') ||
        word.startsWith('$HOME') ||
        word.split('/').includes('..'),
    );
}

const SAFE_ROOTS = ['/tmp/', '/dev/null', '/dev/stdout', '/dev/stderr', '/var/tmp/'];

// Whether a command stays in the workspace: everything it names by path lies below the
// workspace (or a temporary directory), and it does not climb out with "..".
function scopeOf(command: string, workspace: string | null | undefined): ActionScope {
  const root = workspace ? workspace.replace(/\/+$/, '') + '/' : null;
  for (const path of pathsOf(command)) {
    if (path.startsWith('~') || path.startsWith('$HOME')) return 'external';
    if (path.split('/').includes('..')) {
      if (!root || !path.startsWith('/')) return 'external';
    }
    if (path.startsWith('/')) {
      const normal = path.endsWith('/') ? path : `${path}/`;
      if (SAFE_ROOTS.some((safe) => normal.startsWith(safe) || path === safe)) continue;
      if (root && normal.startsWith(root) && !path.split('/').includes('..')) continue;
      return 'external';
    }
  }
  return 'workspace';
}

function writesByRedirect(command: string): boolean {
  // `>` or `>>` to anything but a file descriptor or /dev/null, or tee.
  return /(^|[^0-9&<])>>?\s*(?!&|\/dev\/null)\S/.test(command) || /^tee\b/.test(command);
}

const RANK = Object.fromEntries(ACTION_CATEGORIES.map((c) => [c, actionRank(c)])) as Record<
  ActionCategory,
  number
>;

// The subcommand of a git call, past its global options (-C <dir>, -c <key=value>, ...).
function gitSubcommand(args: string[]): string {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === '-C' || arg === '-c' || arg === '--git-dir' || arg === '--work-tree') {
      index++;
      continue;
    }
    if (!arg.startsWith('-')) return arg;
  }
  return '';
}

function classifyOne(command: string, workspace: string | null | undefined): Classified {
  const scope = scopeOf(command, workspace);
  const [program = ''] = words(command);
  const sub = gitSubcommand(words(command).slice(1));
  const base = program.split('/').pop() ?? program;
  const rest = words(command).slice(1);
  const line =
    base === 'git' && sub
      ? ['git', ...rest.slice(rest.indexOf(sub))].join(' ')
      : [base, ...rest].join(' ');
  if (CREDENTIAL_COMMANDS.some((re) => re.test(line))) return { category: 'credentials', scope };
  if (PUBLISH_COMMANDS.some((re) => re.test(line)))
    return { category: 'publish', scope: 'external' };
  if (SEND_COMMANDS.some((re) => re.test(line))) return { category: 'send', scope: 'external' };
  if (DELETE_COMMANDS.some((re) => re.test(line))) return { category: 'delete', scope };
  if (EXECUTE_EXTERNAL_COMMANDS.some((re) => re.test(line)))
    return { category: 'execute', scope: 'external' };
  if (/^(ba|z|da|k)?sh\s+-c\b/.test(line)) return { category: 'execute', scope };
  if (writesByRedirect(command)) return { category: 'write', scope };
  if (base === 'git' && GIT_READ.has(sub)) return { category: 'read', scope };
  if (base === 'git' && sub === 'branch' && words(command).length === 2)
    return { category: 'read', scope };
  if (base === 'sed' && /\s-i\b|--in-place/.test(command)) return { category: 'write', scope };
  if (base === 'find' && /\s-(exec|execdir|ok|delete|fprint)/.test(command))
    return { category: 'write', scope };
  if (READ_PROGRAMS.has(base)) return { category: 'read', scope };
  return { category: 'write', scope };
}

// The category of a shell command line: the weightiest of its simple commands, and outside
// the workspace when any of them is. `dangerous` is Hermes' own verdict
// (tools/approval_detection.detect_dangerous_command); a dangerous command is at least a
// risky execution.
export function classifyShell(
  command: string,
  options: { workspace?: string | null; dangerous?: boolean } = {},
): Classified {
  let result: Classified = { category: 'read', scope: 'workspace' };
  // Code piped into a shell runs whatever it downloaded or generated.
  if (/\|\s*(sudo\s+)?(ba|z|da|k)?sh\b/.test(command)) {
    result = { category: 'execute', scope: 'external' };
  }
  // A broker's or an exchange's trading API moves money (trading.ts): a person decides.
  if (mentionsLiveTradingHost(command)) return { category: 'pay', scope: 'external' };
  for (const part of simpleCommands(command)) {
    const one = classifyOne(part, options.workspace);
    if (RANK[one.category] > RANK[result.category]) result = { ...one, scope: result.scope };
    if (one.scope === 'external') result = { ...result, scope: 'external' };
  }
  // A command Hermes flags as dangerous that looked like a mere change is a risky execution;
  // one already classified as outward (send, publish) or weightier keeps its category.
  if (options.dangerous && RANK[result.category] <= RANK.write) {
    result = { ...result, category: 'execute' };
  }
  return result;
}

// ---------------------------------------------------------------------------------------
// Runtime tools

// Hermes' own tools (toolsets.py _HERMES_CORE_TOOLS). terminal and execute_code are
// classified by what they run; an MCP tool by its server's annotations.
export const HERMES_TOOL_CATEGORY: Record<string, ActionCategory> = {
  web_search: 'read',
  web_extract: 'read',
  read_file: 'read',
  search_files: 'read',
  vision_analyze: 'read',
  skills_list: 'read',
  skill_view: 'read',
  session_search: 'read',
  browser_navigate: 'read',
  browser_snapshot: 'read',
  browser_scroll: 'read',
  browser_back: 'read',
  browser_get_images: 'read',
  browser_vision: 'read',
  browser_console: 'read',
  browser_vault_list: 'read',
  ha_list_entities: 'read',
  ha_get_state: 'read',
  ha_list_services: 'read',
  kanban_show: 'read',
  kanban_list: 'read',
  kanban_attachments: 'read',
  todo_list: 'report',
  memory: 'report',
  clarify: 'report',
  delegate_task: 'report',
  write_file: 'write',
  patch: 'write',
  skill_manage: 'write',
  image_generate: 'write',
  text_to_speech: 'write',
  browser_click: 'write',
  browser_type: 'write',
  browser_press: 'write',
  browser_dialog: 'write',
  browser_vault_unlock: 'write',
  browser_vault_fill: 'write',
  browser_vault_enter_code: 'write',
  browser_vault_save_login: 'credentials',
  browser_cdp: 'execute',
  browser_exec: 'execute',
  // Polls, reads and stops the processes the agent's own terminal started.
  process_manage: 'write',
  execute_code: 'execute',
  computer_use: 'execute',
  ha_call_service: 'execute',
  manage_connections: 'credentials',
  cronjob_manage: 'execute',
};

// Claude Code's built-in tools.
export const CLAUDE_TOOL_CATEGORY: Record<string, ActionCategory> = {
  Read: 'read',
  Glob: 'read',
  Grep: 'read',
  LS: 'read',
  WebFetch: 'read',
  WebSearch: 'read',
  NotebookRead: 'read',
  TodoWrite: 'report',
  Task: 'report',
  Agent: 'report',
  ExitPlanMode: 'report',
  Write: 'write',
  Edit: 'write',
  MultiEdit: 'write',
  NotebookEdit: 'write',
  KillShell: 'execute',
  BashOutput: 'read',
};

// The browser gateway's tools (hub/agent-browser-mcp packages/browser-gateway/src/tools.ts).
// A click that submits, sends or pays cannot be told from the click; the gateway asks the
// engine with the category the agent declares for it (its `intent` argument) when that is
// weightier than this default.
export const BROWSER_GATEWAY_TOOL_CATEGORY: Record<string, ActionCategory> = {
  browser_status: 'read',
  browser_snapshot: 'read',
  browser_screenshot: 'read',
  browser_tabs: 'read',
  browser_console: 'read',
  browser_network: 'read',
  browser_downloads: 'read',
  browser_navigate: 'read',
  browser_back: 'read',
  browser_reload: 'read',
  browser_hover: 'read',
  browser_scroll: 'read',
  browser_acquire: 'report',
  browser_release: 'report',
  browser_handover: 'report',
  browser_click: 'write',
  browser_type: 'write',
  browser_select: 'write',
  browser_drag: 'write',
  browser_press: 'write',
  browser_dialog: 'write',
  browser_login: 'write',
  browser_login_code: 'write',
  browser_upload: 'send',
  // The gateway's own names for these (packages/browser-gateway): without them the browser
  // tools reached through Hermes' MCP were unknown and counted as send, so reading a page
  // with browser_wait_for or browser_find needed an approval at level 1 (2026-09-24).
  browser_take_screenshot: 'read',
  browser_console_messages: 'read',
  browser_network_requests: 'read',
  browser_navigate_back: 'read',
  browser_wait_for: 'read',
  browser_find: 'read',
  browser_press_key: 'write',
  browser_select_option: 'write',
  browser_fill_form: 'write',
  browser_handle_dialog: 'write',
  browser_file_upload: 'send',
  // The fast path (docs/helena-decisions/browser-task.md §3.2): browser_task is a change in the
  // project's browser before it runs; the gateway then decides each of its actions like the
  // step tool it stands for (a submit is a send). browser_check and browser_choose only read.
  browser_task: 'write',
  browser_check: 'read',
  browser_choose: 'read',
  // The browser-harness MCP server (Chrome DevTools into the project browser) that agents use
  // until the gateway replaces it. Its tools carry no annotations.
  browser_goto: 'read',
  browser_new_tab: 'read',
  browser_page_info: 'read',
  browser_list_tabs: 'read',
  browser_current_tab: 'read',
  browser_switch_tab: 'read',
  browser_close_tab: 'read',
  browser_ensure_real_tab: 'read',
  browser_wait: 'read',
  browser_wait_for_load: 'read',
  browser_wait_for_element: 'read',
  browser_http_get: 'read',
  browser_start_recording: 'read',
  browser_stop_recording: 'read',
  browser_fill: 'write',
  browser_js: 'write',
  browser_cdp: 'execute',
  browser_upload_file: 'send',
};

// The step types of a workflow (hub/native-engine). An agent task's own actions are
// decided one by one while it runs; the step itself is work in the project.
export const WORKFLOW_STEP_CATEGORY: Record<string, ActionCategory> = {
  'agent-task': 'write',
  wait: 'read',
  condition: 'read',
  notification: 'report',
  webhook: 'send',
  'mail-send': 'send',
};

function fileScope(path: unknown, workspace: string | null | undefined): ActionScope {
  if (typeof path !== 'string' || !path) return 'workspace';
  return scopeOf(`x ${path}`, workspace);
}

// A tool call a runtime is about to make, as the runner or the approval guard reports it.
export interface ToolCall {
  runtime: 'hermes' | 'claude' | 'codex' | 'gateway' | string;
  tool: string;
  // The shell command of a terminal / Bash call, the code of an execute_code call.
  command?: string | null;
  // The file a file tool writes.
  path?: string | null;
  // An MCP tool: its server, its annotations as far as the runtime knows them, and the
  // category it declares in `_meta` under "helena/action".
  mcp?: {
    server: string;
    annotations?: ToolAnnotations | null;
    action?: ActionCategory | null;
  } | null;
  // Hermes' own verdict on a terminal command.
  dangerous?: boolean;
  // The directory the runtime works in, which counts as the workspace.
  workspace?: string | null;
  // The category the caller declares, for a tool whose default says too little (a browser
  // click that submits a payment). Only ever makes a call weightier.
  intent?: ActionCategory | null;
}

// The category and scope of a tool call. An unknown tool counts as a write in the
// workspace: it changes something, and nothing says it leaves.
export function classifyToolCall(call: ToolCall): Classified {
  const base = baseCategory(call);
  if (call.intent && RANK[call.intent] > RANK[base.category]) {
    return { category: call.intent, scope: base.scope };
  }
  return base;
}

function baseCategory(call: ToolCall): Classified {
  const workspace = call.workspace ?? null;
  if (call.mcp) {
    const table = call.mcp.server.includes('browser') ? BROWSER_GATEWAY_TOOL_CATEGORY : null;
    // The tool as its server names it: Claude Code calls it mcp__<server>__<tool>, Hermes
    // mcp_<server>_<tool> with the server's name made safe.
    const hermesPrefix = `mcp_${call.mcp.server.replace(/[^A-Za-z0-9]/g, '_')}_`;
    const bare = call.tool.startsWith(hermesPrefix)
      ? call.tool.slice(hermesPrefix.length)
      : call.tool.replace(/^.*__/, '');
    // An order, a closed position or a withdrawal through anyone's server but Helena's own
    // (whose paper tools carry their category) is money moving (trading.ts).
    if (!isHelenaMcpServer(call.mcp.server) && isOrderToolName(bare)) {
      return { category: 'pay', scope: 'external' };
    }
    const known = table?.[call.tool] ?? table?.[bare];
    const category = known ?? categoryFromAnnotations(call.mcp.annotations, call.mcp.action);
    return {
      category,
      scope: category === 'read' || category === 'write' ? 'workspace' : 'external',
    };
  }
  if (call.runtime === 'gateway') {
    return { category: BROWSER_GATEWAY_TOOL_CATEGORY[call.tool] ?? 'write', scope: 'external' };
  }
  const isShell =
    (call.runtime === 'hermes' && call.tool === 'terminal') ||
    (call.runtime === 'claude' && call.tool === 'Bash') ||
    call.tool === 'shell';
  if (isShell && call.command) {
    return classifyShell(call.command, { workspace, dangerous: call.dangerous });
  }
  if (call.runtime === 'hermes' && call.tool === 'execute_code') {
    if (mentionsLiveTradingHost(call.command)) return { category: 'pay', scope: 'external' };
    return { category: 'execute', scope: 'workspace' };
  }
  const table = call.runtime === 'claude' ? CLAUDE_TOOL_CATEGORY : HERMES_TOOL_CATEGORY;
  const category = table[call.tool] ?? 'write';
  const scope = category === 'write' ? fileScope(call.path, workspace) : 'workspace';
  return { category, scope };
}
