export type AgentOrbState = 'idle' | 'thinking' | 'tool' | 'waiting' | 'error' | 'done';

export type VoiceOrbPhase =
  'off' | 'starting' | 'listening' | 'hearing' | 'transcribing' | 'thinking' | 'speaking';

export interface VoiceOrbAudio {
  phase: VoiceOrbPhase;
  micStream: MediaStream | null;
  outputAnalyser: AnalyserNode | null;
}

export function chatOrbState(
  activity: string,
  tool: string | null,
  awaitingChoice: boolean,
): AgentOrbState | null {
  if (awaitingChoice) return 'waiting';
  if (activity === 'failed' || activity === 'sendFailed' || activity === 'lost') return 'error';
  if (activity === 'thinking' || activity === 'writing') return tool ? 'tool' : 'thinking';
  if (activity === 'queued') return 'waiting';
  if (activity === 'answered') return 'done';
  return null;
}

export function agentOrbState(
  label: string | undefined,
  runtimeStatus?: 'online' | 'degraded' | 'offline',
): AgentOrbState {
  if (label === 'waiting') return 'waiting';
  if (runtimeStatus === 'degraded') return 'error';
  if (label === 'running') return 'thinking';
  return 'idle';
}

export const shipnotesState: Record<
  AgentOrbState,
  'listening' | 'thinking' | 'searching' | 'done'
> = {
  idle: 'listening',
  thinking: 'thinking',
  tool: 'searching',
  waiting: 'listening',
  error: 'listening',
  done: 'done',
};
