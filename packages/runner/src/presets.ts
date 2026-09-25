import { cliArgv, cliPrompt, type CliCommand, type RuntimeTaskSettings } from '@helena/sdk';
import type { OutputFormat } from './config';

// A preset exists because several facts about a CLI have to agree: how its output is read,
// where the session it started is named, how an existing one is resumed, how the task and
// the system prompt reach it, and what it takes to run unattended. Wiring those into a
// shell command by hand can produce a combination that runs but silently never reports a
// session, or one that waits forever for an approval nobody is there to give.
//
// Anything else about the invocation — MCP servers, model, working directory — is the
// operator's, passed through `args` and the `--` tail.

export type PresetName = 'claude' | 'codex' | 'opencode' | 'antigravity' | 'copilot' | 'hermes';

// The settings a task passes to a preset's command line.
export type PresetTaskSettings = RuntimeTaskSettings;

// Claude Code asks Helena's policy engine before each tool call through a PreToolUse hook
// (the runner's `policy-hook`). At Autopilot level 0 it plans only: it proposes, it changes
// nothing.
function claudeAutopilotArgs({ autopilotLevel, policyHook }: PresetTaskSettings): string[] {
  return [
    ...(autopilotLevel === 0 ? ['--permission-mode', 'plan'] : []),
    ...(policyHook
      ? [
          '--settings',
          JSON.stringify({
            hooks: {
              PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: policyHook }] }],
            },
          }),
        ]
      : []),
  ];
}

// Codex filters what its shell commands inherit (shell_environment_policy): by default it
// drops every variable whose name contains KEY, SECRET or TOKEN. The variables Helena
// delivered for the work are meant for those commands (wrangler reads CLOUDFLARE_API_TOKEN),
// so they go through; every other such name in the command's environment stays out, as
// before. Names only: the values never reach a command line.
const CODEX_DEFAULT_EXCLUDES = /KEY|SECRET|TOKEN/i;

export function codexToolEnvArgs(toolEnv: PresetTaskSettings['toolEnv']): string[] {
  if (!toolEnv || toolEnv.delivered.length === 0) return [];
  const delivered = new Set(toolEnv.delivered);
  const hidden = [...new Set(toolEnv.present)]
    .filter((name) => CODEX_DEFAULT_EXCLUDES.test(name) && !delivered.has(name))
    .sort();
  return [
    '-c',
    'shell_environment_policy.ignore_default_excludes=true',
    ...(hidden.length > 0
      ? ['-c', `shell_environment_policy.exclude=${JSON.stringify(hidden)}`]
      : []),
  ];
}

// A preset is the command line of a runtime the runner starts as a one-shot CLI: the
// @helena/sdk CliCommand of a built-in runtime (see runtimes.ts), with one of the output
// formats agui.ts reads.
export interface Preset extends CliCommand {
  outputFormat: OutputFormat;
}

export const PRESETS: Record<PresetName, Preset> = {
  // stream-json carries the tool calls into the chat, and `session_id` rides on every line
  // of it, including the first. --verbose is required for stream-json under --print, and
  // --permission-mode auto has a classifier review each action, since nobody is there to
  // answer a prompt.
  claude: {
    bin: 'claude',
    outputFormat: 'claude-stream-json',
    promptVia: 'stdin',
    systemPromptFlag: '--append-system-prompt',
    head: (sessionId) => [
      '-p',
      ...(sessionId ? ['--resume', sessionId] : []),
      '--output-format',
      'stream-json',
      '--include-partial-messages',
      '--verbose',
      '--permission-mode',
      'auto',
    ],
    // The agent's model and reasoning in Helena (without them Claude Code uses its own),
    // and Helena's Autopilot: the policy hook and, at level 0, plan mode.
    taskArgs: (settings) => [
      ...(settings.model ? ['--model', settings.model] : []),
      ...(settings.thinkingLevel ? ['--effort', settings.thinkingLevel] : []),
      ...claudeAutopilotArgs(settings),
    ],
    tail: [],
  },

  // Resuming is a subcommand, and it accepts a narrower set of options than plain `exec` —
  // notably no --sandbox, --cd or --profile. An argument only `exec` takes would break
  // every message after the first, so the sandbox is set through `-c sandbox_mode=…`,
  // which both accept. The sandbox comes last, after the operator's arguments, so the one
  // Helena decided is the one that holds (execute.ts refuses a command without a sandbox
  // outside agent isolation).
  codex: {
    bin: 'codex',
    outputFormat: 'codex-jsonl',
    promptVia: 'stdin',
    head: (sessionId) => [...(sessionId ? ['exec', 'resume', sessionId] : ['exec']), '--json'],
    // Both `exec` and `exec resume` take -m and -c. Codex has no hook to ask Helena before a
    // tool call; at Autopilot level 0 its sandbox is read-only, so it can only propose.
    taskArgs: ({ model, thinkingLevel, sandbox, autopilotLevel, toolEnv }) => [
      ...(model ? ['-m', model] : []),
      ...(thinkingLevel ? ['-c', `model_reasoning_effort=${JSON.stringify(thinkingLevel)}`] : []),
      ...codexToolEnvArgs(toolEnv),
      '-c',
      `sandbox_mode=${JSON.stringify(autopilotLevel === 0 ? 'read-only' : (sandbox ?? 'workspace-write'))}`,
    ],
    tail: ['-'],
  },

  opencode: {
    bin: 'opencode',
    outputFormat: 'opencode-json',
    promptVia: 'arg',
    head: (sessionId) => [
      'run',
      '--format',
      'json',
      ...(sessionId ? ['--session', sessionId] : []),
    ],
    tail: [],
  },

  // --conversation resumes the conversation the stream names. --print-timeout is raised
  // well past its five-minute default, so the runner's own timeout is what ends a long
  // task.
  antigravity: {
    bin: 'agy',
    outputFormat: 'antigravity-stream-json',
    promptVia: 'arg',
    head: (sessionId) => [
      ...(sessionId ? ['--conversation', sessionId] : []),
      '--output-format',
      'stream-json',
      '--dangerously-skip-permissions',
      '--print-timeout',
      '24h',
    ],
    tail: ['-p'],
  },

  // --allow-all-tools is required for a run nobody is watching, and --no-ask-user turns
  // off the tool that would wait for an answer. The json output carries the tool calls,
  // and its closing `result` line names the session, which --session-id resumes. The
  // resume flag has to be this one: -r takes its value only as `-r=<id>`.
  copilot: {
    bin: 'copilot',
    outputFormat: 'copilot-json',
    promptVia: 'arg',
    head: (sessionId) => [
      '--allow-all-tools',
      '--no-ask-user',
      '--output-format',
      'json',
      ...(sessionId ? ['--session-id', sessionId] : []),
    ],
    tail: ['-p'],
  },

  hermes: {
    bin: 'hermes',
    outputFormat: 'hermes-stream-json',
    promptVia: 'stdin',
    head: (sessionId) => [
      'chat',
      '--format',
      'stream-json',
      '--query-file',
      '-',
      '--source',
      'tool',
      '--accept-hooks',
      ...(sessionId ? ['--resume', sessionId] : []),
    ],
    taskArgs: ({ model, thinkingLevel, provider, maxTurns, runBudgetSeconds, toolsets, image }) => [
      ...(provider ? ['--provider', provider] : []),
      ...(model ? ['--model', model] : []),
      ...(thinkingLevel ? ['--reasoning', thinkingLevel] : []),
      ...(maxTurns ? ['--max-turns', String(maxTurns)] : []),
      ...(runBudgetSeconds ? ['--run-budget', String(runBudgetSeconds)] : []),
      ...(toolsets ? ['--toolsets', toolsets.join(',')] : []),
      // Hermes attaches one image to a query; the others are named by path in the prompt.
      ...(image ? ['--image', image] : []),
    ],
    tail: [],
    sessionLost: (error) => error.includes('Session not found'),
    // Hermes' terminal keeps a snapshot of the shell's exported variables there
    // (tools/environments/base.py, hermes-snap-*.sh): the delivered ones would otherwise sit
    // in the profile's cache/terminal.
    scratchDirEnv: 'TERMINAL_TEMP_DIR',
  },
};

export const PRESET_NAMES = Object.keys(PRESETS) as PresetName[];

export function isPresetName(value: string): value is PresetName {
  return value in PRESETS;
}

// Without a flag for it, the run's context goes in front of the task. It is empty on a
// resumed session, which already holds it.
export const presetPrompt: (preset: CliCommand, systemPrompt: string, prompt: string) => string =
  cliPrompt;

// The operator's own arguments sit between what the preset needs in front and what it
// needs last, so a prompt passed as an argument stays at the end, a stdin marker is not
// separated from its command, and a repeated flag overrides the preset's.
export const presetArgv: (
  preset: CliCommand,
  sessionId: string | null,
  systemPrompt: string,
  extraArgs: string[],
  prompt: string,
  settings?: PresetTaskSettings,
) => string[] = cliArgv;
