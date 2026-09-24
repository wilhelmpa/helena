// The built-in tools of Claude Code and Codex that Helena switches per agent, the way it
// switches Hermes' toolsets: the runner reports them as the agent's toolsets, the owner
// turns one off on the agent's Abilities (runtime policy toolDeny), and the runner leaves
// it out of every run and chat answer. A few are withheld from every agent because Helena
// does that work itself.
//
// The names are the runtimes' own: Claude Code's tool names as its stream names them on
// the opening line (2.1.281), Codex' feature flags as `codex features list` names them
// (0.156.1). A name a later version drops is harmless: Claude Code ignores an unknown
// tool name in --disallowedTools, and Codex an unknown -c features key.

// Claude Code's tools an owner may turn off.
export const CLAUDE_TOOLS = [
  'Bash',
  'Edit',
  'NotebookEdit',
  'Read',
  'Skill',
  'Task',
  'WebFetch',
  'WebSearch',
  'Write',
] as const;

// Never given: Claude Code's own scheduler (Helena schedules work as routines, the way the
// runner withholds Hermes' cronjob toolset), and its agent-team messaging, which would
// reach agents Helena does not know of.
export const CLAUDE_WITHHELD_TOOLS = [
  'CronCreate',
  'CronDelete',
  'CronList',
  'ScheduleWakeup',
  'SendMessage',
  'ListAgents',
] as const;

// Codex' built-in abilities an owner may turn off. `web_search` is a setting of its own;
// the others are features.
export const CODEX_TOOLS = [
  'shell_tool',
  'view_image',
  'web_search',
  'multi_agent',
  'image_generation',
] as const;

// Codex features no agent gets: ChatGPT apps and plugins would hand the agent connectors
// of the account it is signed in with, and Codex' own browser and computer use would
// bypass Helena's project browser.
export const CODEX_WITHHELD_FEATURES = [
  'apps',
  'plugins',
  'remote_plugin',
  'browser_use',
  'browser_use_external',
  'browser_use_full_cdp_access',
  'computer_use',
  'in_app_browser',
] as const;

const FEATURE = /^[a-z0-9_]+$/;

// --disallowedTools for what the owner turned off and what is withheld.
export function claudeToolArgs(denied: readonly string[]): string[] {
  const off = [...CLAUDE_WITHHELD_TOOLS, ...CLAUDE_TOOLS.filter((name) => denied.includes(name))];
  return off.flatMap((name) => ['--disallowedTools', name]);
}

// -c overrides for what the owner turned off and what is withheld. Both `codex exec` and
// `codex exec resume` take -c.
export function codexToolArgs(denied: readonly string[]): string[] {
  const features = [
    ...CODEX_WITHHELD_FEATURES,
    ...CODEX_TOOLS.filter((name) => name !== 'web_search' && denied.includes(name)),
  ].filter((name) => FEATURE.test(name));
  return [
    ...features.flatMap((name) => ['-c', `features.${name}=false`]),
    ...(denied.includes('web_search') ? ['-c', 'web_search="disabled"'] : []),
  ];
}

// The toolsets the runner reports for the agent, which the Abilities section lists.
export function cliToolsets(runtime: 'claude' | 'codex'): string[] {
  return [...(runtime === 'claude' ? CLAUDE_TOOLS : CODEX_TOOLS)];
}
