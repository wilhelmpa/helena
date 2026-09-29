import type { LocalAiEvalResult } from '@helena/sdk';
import { median } from '@helena/sdk';
import { runAgent } from './agent';
import type { AgentRuntimeConfig, SkillEntry } from './config';
import { MemorySink } from './events';
import { MemorySessionStore } from './session';
import type { AgentTool } from './tools/types';

const scenarios = [
  [
    'coder',
    'brainstorming',
    'Design a new export feature; explore requirements and alternatives before implementation.',
    'requirements',
    'compare_alternatives',
  ],
  [
    'coder',
    'writing-plans',
    'Write an implementation plan for the approved three-stage CSV export specification.',
    'read_specification',
    'sequence_plan',
  ],
  [
    'coder',
    'test-driven-development',
    'Implement the agreed decimal-comma parser with a failing test first.',
    'red_test',
    'green_test',
  ],
  [
    'coder',
    'systematic-debugging',
    'Investigate the failing decimal-comma test; find the root cause before fixing it.',
    'reproduce_failure',
    'isolate_cause',
  ],
  [
    'coder',
    'verification-before-completion',
    'Verify the implemented CSV export before claiming completion.',
    'run_verification',
    'check_evidence',
  ],
  [
    'coder',
    'requesting-code-review',
    'Prepare the finished implementation for code review before handover.',
    'collect_diff',
    'request_review',
  ],
  [
    'reviewer',
    'review-ablauf',
    'Review a proposed change for regressions and support findings with evidence.',
    'inspect_diff',
    'validate_findings',
  ],
  [
    'content-seo',
    'seo-content',
    'Create a search-oriented article outline based on search intent and source evidence.',
    'search_intent',
    'source_outline',
  ],
  [
    'finance',
    'belege-und-buchhaltung',
    'Check a synthetic invoice for required fields and reconcile its totals.',
    'invoice_fields',
    'reconcile_totals',
  ],
  [
    'trading',
    'technische-analyse',
    'Analyze a synthetic price chart with scenario invalidation and risk, without placing orders.',
    'inspect_chart',
    'risk_scenario',
  ],
  [
    'coordinator',
    'ziele-in-aufgaben-zerlegen',
    'Break a project goal into ordered tasks with dependencies and acceptance criteria.',
    'inspect_goal',
    'plan_dependencies',
  ],
  [
    'assistant',
    'assistenz-mail-und-termine',
    'Prepare a reply and appointment proposal from a synthetic invitation; do not send it.',
    'inspect_invitation',
    'draft_proposal',
  ],
  [
    'browser-operator',
    'helena-browser-decisions',
    'Inspect a synthetic web form and verify its state before choosing the next action.',
    'inspect_page',
    'verify_target',
  ],
] as const;

const controls = [
  'coder',
  'reviewer',
  'content-seo',
  'finance',
  'trading',
  'coordinator',
  'assistant',
  'browser-operator',
];
export const SKILL_USAGE_CASES = [
  ...scenarios.flatMap(([role, skill, prompt, ...steps]) =>
    ['baseline', 'changed-input', 'distractors'].map((variant) => ({
      id: `${role}-${skill}-${variant}`,
      role,
      skill,
      prompt: `${prompt} Dataset: ${variant}.`,
      steps: [...steps],
    })),
  ),
  ...controls.map((role) => ({
    id: `${role}-no-skill`,
    role,
    skill: null,
    prompt: 'Reply with exactly ACK. This is a connectivity check.',
    steps: [] as string[],
  })),
];

export function usageSkills(): SkillEntry[] {
  return scenarios.map(([, name, description, ...steps]) => ({
    name,
    description,
    whenToUse: description,
    markdown: `# ${name}\nFor the matching synthetic task: load refs/procedure.txt. Then perform its steps in order through perform_step. Each tool response is evidence; do not merely describe the steps. Never perform these steps for unrelated tasks.`,
    files: [
      {
        path: 'refs/procedure.txt',
        content: `Call perform_step twice, in this order: ${steps.join(', ')}. Each call must include evidenceKey "fixture-${name}". After both succeed, report the observed result briefly.`,
      },
    ],
  }));
}

export async function runSkillUsageEval(options: {
  config: AgentRuntimeConfig;
  env: Record<string, string | undefined>;
  signal: AbortSignal;
  record?: (id: string, evidence: unknown) => Promise<void>;
  caseIds?: readonly string[];
}): Promise<LocalAiEvalResult> {
  const cases: LocalAiEvalResult['cases'] = [];
  let outputTokens = 0;
  let durationMs = 0;
  const selected = SKILL_USAGE_CASES.filter(
    (entry) => !options.caseIds || options.caseIds.includes(entry.id),
  );
  if (!selected.length) throw new Error('No matching skill-usage cases');
  for (const entry of selected) {
    if (options.signal.aborted) throw new Error('Skill usage evaluation aborted');
    const sink = new MemorySink();
    const performed: string[] = [];
    const tool: AgentTool = {
      name: 'perform_step',
      description:
        'Execute one synthetic domain procedure step and return evidence. Use procedure instructions for the step and evidenceKey.',
      readOnly: true,
      inputSchema: {
        type: 'object',
        properties: { step: { type: 'string' }, evidenceKey: { type: 'string' } },
        required: ['step', 'evidenceKey'],
      },
      execute: async (input) => {
        if (
          !entry.skill ||
          input.step !== entry.steps[performed.length] ||
          input.evidenceKey !== `fixture-${entry.skill}`
        )
          return { text: 'Invalid procedure step or evidence key.', isError: true };
        performed.push(String(input.step));
        return { text: `Verified ${input.step}: synthetic evidence ${performed.length}.` };
      },
    };
    const started = Date.now();
    const result = await runAgent({
      config: {
        ...options.config,
        instructions: `Role: ${entry.role}. Execute the requested synthetic task using its procedure tools; no external effects.`,
        skills: usageSkills(),
        memory: { enabled: false },
        policy: 'allow',
        escalation: { mode: 'never' },
        tools: {
          profile: entry.role === 'coder' ? 'coder-lite' : 'assistent',
          core: ['perform_step'],
        },
        limits: { maxTurns: 9, runBudgetSeconds: 120, maxOutputTokens: 1500 },
      },
      prompt: entry.prompt,
      extraTools: [tool],
      sink,
      helena: null,
      sessions: new MemorySessionStore(),
      env: { ...options.env, VOLITION_HALOGEN_PRIORITY: 'background' },
      signal: options.signal,
    });
    const calls = sink.of('tool-call');
    const loads = calls
      .filter((call) => call.name === 'load_skill')
      .map((call) => JSON.parse(call.input) as { name: string; file?: string });
    const correctSkill = entry.skill
      ? loads.some((call) => call.name === entry.skill && !call.file)
      : loads.length === 0;
    const noUnnecessarySkill = loads.every((call) => call.name === entry.skill);
    const followed =
      performed.length === entry.steps.length &&
      (entry.skill
        ? calls[0]?.name === 'load_skill' &&
          loads.some((call) => call.file === 'refs/procedure.txt')
        : result.text.trim() === 'ACK');
    const errors = sink.of('tool-result').filter((event) => event.isError).length;
    const pass =
      result.status === 'success' && correctSkill && noUnnecessarySkill && followed && errors === 0;
    const latencyMs = Date.now() - started;
    outputTokens += result.spend.outputTokens;
    durationMs += latencyMs;
    cases.push({
      id: entry.id,
      passed: pass,
      latencyMs,
      detail: `loaded=${correctSkill}; followed=${followed}; noExtra=${noUnnecessarySkill}; errors=${errors}`,
    });
    await options.record?.(entry.id, {
      case: entry,
      pass,
      correctSkill,
      noUnnecessarySkill,
      followed,
      errors,
      performed,
      result,
      events: sink.events,
    });
  }
  return {
    cases,
    score: cases.filter((entry) => entry.passed).length / cases.length,
    latencyMsP50: median(cases.map((entry) => entry.latencyMs ?? NaN)),
    tokensPerSecond: durationMs ? (outputTokens * 1000) / durationMs : null,
  };
}
