import { type AgentEscalationPolicy } from '#modules/agents/core/service';
import { LOCAL_PROFILES } from '#modules/local-ai/npu-profile';
import { DECISION_THRESHOLDS, LOCAL_ONLY_CLASSES } from '../../scripts/decision-profile';

export const MODEL_ROLES = [
  'home',
  'coordinator',
  'coder',
  'reviewer',
  'planning',
  'research',
  'content',
  'assistant',
  'finance',
  'trading',
  'browser',
  'support',
  'devops',
  'general',
] as const;
export type ModelRole = (typeof MODEL_ROLES)[number];
export const ROLE_REASONING: Record<ModelRole, 'high' | 'medium'> = {
  home: 'high',
  coordinator: 'high',
  coder: 'high',
  reviewer: 'high',
  planning: 'high',
  finance: 'high',
  trading: 'high',
  devops: 'high',
  research: 'medium',
  content: 'medium',
  assistant: 'medium',
  support: 'medium',
  general: 'medium',
  browser: 'medium',
};
export const CLOUD_AGENT_MODELS = {
  codex: 'gpt-6.1-sol',
  claude: 'claude-sonnet-5-5',
} as const;

export const MODEL_COLUMNS = [
  'runtime',
  'model',
  'reasoning',
  'escalation',
  'browser',
  'decision',
  'device',
] as const;
export type ModelColumn = (typeof MODEL_COLUMNS)[number];
export type DecisionValue = {
  backend: 'jev' | 'gpu' | 'npu' | 'jev-local' | 'local-jev';
  threshold: number;
  fallback: 'gpu' | 'coordinator' | 'none';
  privateData: boolean;
};
export type ModelValues = {
  runtime: 'helena' | 'claude' | 'codex' | 'hermes' | 'command' | 'webhook';
  model: string;
  reasoning: 'low' | 'medium' | 'high' | 'xhigh';
  escalation: AgentEscalationPolicy;
  browser: 'standard' | 'jev' | 'combined';
  decision: DecisionValue;
  device: 'gpu' | 'npu' | 'cloud' | 'cpu';
};
export type ClassPlacement = {
  backend?: string;
  device: 'gpu' | 'npu' | 'cpu' | 'cloud' | 'vulkan';
  model: string;
  eval: 'passed' | 'failed' | 'untested';
  score?: number;
  decision?: DecisionValue;
};
export type ModelSchema = {
  id: string;
  name: string;
  description: string;
  profile: (typeof LOCAL_PROFILES)[number]['id'];
  roles: Record<string, ModelValues>;
  classes: Record<string, ClassPlacement>;
  npuSlots: number;
  gpuSlots: number;
  speechRecognition: 'cpu' | 'npu';
  jevPrivate: boolean;
};

const localModel = 'volition-local-default';
const localEscalation: AgentEscalationPolicy = {
  target: 'codex',
  model: 'gpt-6.1-sol',
  afterFailures: 2,
  onResumeLimit: true,
  onRequest: true,
  maxDepth: 1,
};
const cloudEscalation: AgentEscalationPolicy = {
  target: 'codex',
  model: 'gpt-6.1-sol',
  afterFailures: 0,
  onResumeLimit: false,
  onRequest: false,
  maxDepth: 0,
};
const thresholds = DECISION_THRESHOLDS;
const localOnly = new Set(Object.keys(LOCAL_ONLY_CLASSES));
const coordinatorFallback = new Set(['tasks.triage', 'agents.routing']);
const privateClasses = new Set([
  'helena.mail',
  'helena.receipts',
  'helena.trading.rules',
  'helena.trading.routing',
]);
const decisionClasses = [...Object.keys(thresholds), ...localOnly];
const chatClasses = [
  'triage',
  'routines',
  'hermes-helpers',
  'summaries',
  'reflection',
  'voice-reply',
  'coordinator-triage',
];

function classes(profile: ModelSchema['profile']): Record<string, ClassPlacement> {
  const placements: Record<string, ClassPlacement> = {};
  for (const id of chatClasses) {
    const npu =
      profile === 'local-27b-npu' && ['triage', 'routines', 'hermes-helpers'].includes(id);
    placements[id] = {
      device: npu ? 'npu' : 'gpu',
      model: npu ? 'qwen3.5:2b' : localModel,
      eval: npu ? 'passed' : profile === 'local-27b-npu' ? 'untested' : 'passed',
      ...(npu ? { score: id === 'triage' ? 0.94 : 1 } : {}),
    };
  }
  for (const id of decisionClasses) {
    const local = localOnly.has(id);
    const decision: DecisionValue = {
      backend: local ? 'gpu' : 'jev-local',
      threshold: local ? 0.8 : thresholds[id]!,
      fallback: local ? 'none' : coordinatorFallback.has(id) ? 'coordinator' : 'gpu',
      privateData: privateClasses.has(id),
    };
    placements[id] = {
      device: local ? 'gpu' : 'cloud',
      model: local ? localModel : 'jev-1.13.0',
      eval: 'passed',
      decision,
    };
  }
  placements.embeddings = { device: 'vulkan', model: 'Qwen3-Embedding-0.6B', eval: 'passed' };
  placements.tts = { device: 'gpu', model: 'configured-tts', eval: 'passed' };
  placements.stt = { device: 'cpu', model: 'whisper', eval: 'passed' };
  return placements;
}

function roles(kind: 'local' | 'mixed' | 'codex' | 'claude'): Record<string, ModelValues> {
  const values: Record<string, ModelValues> = {};
  for (const role of MODEL_ROLES) {
    const runtime =
      kind === 'local'
        ? 'helena'
        : kind === 'claude'
          ? 'claude'
          : kind === 'codex'
            ? 'codex'
            : ['coder', 'reviewer', 'devops'].includes(role)
              ? 'codex'
              : ['planning', 'finance', 'content'].includes(role)
                ? 'claude'
                : 'helena';
    const model = runtime === 'helena' ? localModel : CLOUD_AGENT_MODELS[runtime];
    values[role] = {
      runtime,
      model,
      reasoning: ROLE_REASONING[role],
      escalation:
        runtime === 'helena'
          ? { ...localEscalation }
          : {
              ...cloudEscalation,
              ...(runtime === 'claude' && { target: 'claude', model: 'claude-opus-5-5' }),
            },
      browser: 'jev',
      decision: { backend: 'jev-local', threshold: 0.8, fallback: 'gpu', privateData: false },
      device: runtime === 'helena' ? 'gpu' : 'cloud',
    };
  }
  return values;
}

export const MODEL_TEMPLATES: Record<string, ModelSchema> = {
  'nur-lokal': {
    id: 'nur-lokal',
    name: 'Nur lokal',
    description:
      'Local default for agent runs; configured escalation after two failures, at the resume limit or on request.',
    profile: 'local-halogen',
    roles: roles('local'),
    classes: classes('local-halogen'),
    npuSlots: 0,
    gpuSlots: 4,
    speechRecognition: 'cpu',
    jevPrivate: true,
  },
  gemischt: {
    id: 'gemischt',
    name: 'Gemischt',
    description: 'Local routine work, Codex coding and Claude planning and content.',
    profile: 'local-halogen',
    roles: roles('mixed'),
    classes: classes('local-halogen'),
    npuSlots: 0,
    gpuSlots: 4,
    speechRecognition: 'cpu',
    jevPrivate: true,
  },
  'nur-codex': {
    id: 'nur-codex',
    name: 'Nur Codex',
    description: 'Codex for agent runs.',
    profile: 'local-halogen',
    roles: roles('codex'),
    classes: classes('local-halogen'),
    npuSlots: 0,
    gpuSlots: 4,
    speechRecognition: 'cpu',
    jevPrivate: true,
  },
  'nur-claude': {
    id: 'nur-claude',
    name: 'Nur Claude',
    description: 'Claude for agent runs.',
    profile: 'local-halogen',
    roles: roles('claude'),
    classes: classes('local-halogen'),
    npuSlots: 0,
    gpuSlots: 4,
    speechRecognition: 'cpu',
    jevPrivate: true,
  },
};
export const LOCAL_PROFILE_TEMPLATES = LOCAL_PROFILES.map((profile) => ({
  ...profile,
  classes: classes(profile.id),
  gpuSlots: 4,
  npuSlots: profile.npu ? 1 : 0,
  speechRecognition: 'cpu' as const,
}));
export const COMBO_EVAL_CANDIDATES = {
  triage: { npu2b: 0.94 },
  routines: { npu2b: 1 },
  'hermes-helpers': { npu2b: 1 },
  summaries: { npu2b: 0.5 },
  reflection: { npu2b: 0.83 },
  'voice-reply': { npu2b: 0.33 },
  'coordinator-triage': { npu2b: 0.6 },
  embeddings: { npuEmbed: 0.2, vulkan: 0.9 },
} as const;
