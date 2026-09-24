import {
  createRegistry,
  type CliCommand,
  type CliRuntimeType,
  type RuntimeType,
  type RuntimeCapabilities,
  type RuntimeStreamParser,
} from '@helena/sdk';
import { PRESETS, PRESET_NAMES, type PresetName } from './presets';

// The runtimes this runner can drive, as a registry (@helena/sdk RuntimeType): the
// built-in presets, registered here as the internal plugin `helena.runtimes`, and those of
// the plugins its config names (see plugins.ts). Everything that used to look a preset up
// by name looks it up here.

export const BUILTIN_RUNTIMES_PLUGIN = 'helena.runtimes';

const LABELS: Record<PresetName, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  opencode: 'opencode',
  antigravity: 'Antigravity',
  copilot: 'GitHub Copilot CLI',
  hermes: 'Hermes',
};

// What each preset does beyond building its command line. `isolation` names the runtimes
// the isolation launcher has presets of its own for (launcher.json).
const CAPABILITIES: Record<PresetName, RuntimeCapabilities> = {
  claude: {
    sessions: true,
    chat: true,
    systemPrompt: true,
    modelSelection: false,
    mcp: true,
    isolation: true,
  },
  codex: {
    sessions: true,
    chat: true,
    systemPrompt: false,
    modelSelection: false,
    mcp: true,
    isolation: true,
  },
  opencode: {
    sessions: true,
    chat: true,
    systemPrompt: false,
    modelSelection: false,
    mcp: true,
    isolation: false,
  },
  antigravity: {
    sessions: true,
    chat: true,
    systemPrompt: false,
    modelSelection: false,
    mcp: true,
    isolation: false,
  },
  copilot: {
    sessions: true,
    chat: true,
    systemPrompt: false,
    modelSelection: false,
    mcp: true,
    isolation: false,
  },
  hermes: {
    sessions: true,
    chat: true,
    systemPrompt: false,
    modelSelection: true,
    mcp: true,
    isolation: true,
    images: true,
    toolsets: true,
  },
};

export function builtinRuntimes(): CliRuntimeType[] {
  return PRESET_NAMES.map((name) => ({
    id: name,
    label: LABELS[name],
    protocol: 'cli',
    capabilities: CAPABILITIES[name],
    command: PRESETS[name],
  }));
}

export const runtimes = createRegistry<RuntimeType>('runtime');
for (const adapter of builtinRuntimes()) runtimes.register(adapter, BUILTIN_RUNTIMES_PLUGIN);

export function runtimeOf(name: string | undefined): RuntimeType | undefined {
  return name ? runtimes.get(name) : undefined;
}

// The command line of a runtime the runner starts as a one-shot CLI.
export function cliCommandOf(name: string | undefined): CliCommand | undefined {
  const adapter = runtimeOf(name);
  return adapter?.protocol === 'cli' ? adapter.command : undefined;
}

// A plugin runtime with an output format of its own brings the parser for it; the
// built-in formats are read by agui.ts itself.
export function streamParserFor(format: string): RuntimeStreamParser | undefined {
  for (const adapter of runtimes.list()) {
    if (adapter.protocol === 'cli' && adapter.parser && adapter.command.outputFormat === format) {
      return adapter.parser();
    }
  }
  return undefined;
}

// The output formats a plugin runtime reads with its own parser.
export function pluginOutputFormats(): string[] {
  return runtimes
    .list()
    .flatMap((adapter) =>
      adapter.protocol === 'cli' && adapter.parser ? [adapter.command.outputFormat] : [],
    );
}
