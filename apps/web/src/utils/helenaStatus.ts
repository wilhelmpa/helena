import { useAgentWorkStates } from '@/hooks/useAgentWorkStates';

export const HELENA_STATUSES = [
  'idle',
  'listening',
  'thinking',
  'tool',
  'speaking',
  'waiting',
  'error',
  'throttled',
  'offline',
  'done',
] as const;

export type HelenaStatus = (typeof HELENA_STATUSES)[number];
export type VoicePhase =
  'off' | 'starting' | 'listening' | 'hearing' | 'transcribing' | 'thinking' | 'speaking';

export interface VoiceOrbAudio {
  phase: VoicePhase;
  micStream: MediaStream | null;
  outputAnalyser: AnalyserNode | null;
}

export interface StatusSignals {
  run?: string | null;
  chat?: string | null;
  voicePhase?: VoicePhase;
  tool?: string | boolean | null;
  awaitingChoice?: boolean;
  runtimeStatus?: 'online' | 'degraded' | 'offline' | null;
  budget?: 'ok' | 'throttled' | 'exhausted' | boolean | null;
}

// The first matching signal wins. Keep this order identical to ui-system.md §1.
export function deriveStatus({
  run,
  chat,
  voicePhase = 'off',
  tool,
  awaitingChoice = false,
  runtimeStatus,
  budget,
}: StatusSignals): HelenaStatus {
  if (runtimeStatus === 'offline') return 'offline';
  if (
    runtimeStatus === 'degraded' ||
    ['failed', 'sendFailed', 'lost', 'error'].includes(chat ?? '') ||
    ['failed', 'error'].includes(run ?? '')
  )
    return 'error';
  if (budget === true || budget === 'throttled' || budget === 'exhausted') return 'throttled';
  if (voicePhase === 'speaking') return 'speaking';
  if (voicePhase === 'listening' || voicePhase === 'hearing') return 'listening';
  if (awaitingChoice || run === 'waiting' || chat === 'queued') return 'waiting';
  if (tool) return 'tool';
  if (
    run === 'running' ||
    chat === 'thinking' ||
    chat === 'writing' ||
    chat === 'streaming' ||
    voicePhase === 'thinking' ||
    voicePhase === 'transcribing'
  )
    return 'thinking';
  if (run === 'done' || run === 'completed' || chat === 'answered') return 'done';
  return 'idle';
}

export interface AgentStatusOptions extends StatusSignals {
  chatId?: string | null;
}

export function useAgentStatus(agentId: number, options: AgentStatusOptions = {}): HelenaStatus {
  const work = useAgentWorkStates();
  const run =
    options.run !== undefined
      ? options.run
      : options.chatId === undefined
        ? work.get(agentId)
        : undefined;
  return deriveStatus({ ...options, run });
}
