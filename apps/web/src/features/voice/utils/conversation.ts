// The conversation mode's turn-taking, as a pure state machine (the hook useConversation runs
// its effects): the owner speaks, what was said is written down and sent, the answer is read
// aloud sentence by sentence while it streams, then Helena listens again. Speaking while an
// answer is read interrupts it (barge-in).
//
// Barge-in and echo: with loudspeakers the microphone also hears the voice reading the answer.
// Browsers cancel echo for audio the page plays itself. Reading pauses as soon as speech starts;
// transcription decides whether to resume an echo or discard the reading for a new request.

export type ConversationPhase =
  | 'off'
  // Loading the voice detector, asking for the microphone.
  | 'starting'
  // Waiting for the owner.
  | 'listening'
  // The owner is speaking.
  | 'hearing'
  // Writing down what was said.
  | 'transcribing'
  // Sent; the agent works on the answer and there is nothing to read yet.
  | 'thinking'
  | 'waiting'
  | 'error'
  // Reading the answer aloud.
  | 'speaking';

export interface ConversationState {
  active: 'off' | 'starting' | 'on';
  // The owner is speaking now.
  userSpeaking: boolean;
  // Utterances being written down now.
  transcribing: number;
  // Written down but not sent yet: the owner went on speaking before it was done.
  pendingText: string;
  // A message was sent and its answer has not ended yet.
  awaitingAnswer: boolean;
  waiting: boolean;
  error: boolean;
  // The voice is reading (or has pieces queued).
  speaking: boolean;
  // Reading paused because the owner seemed to start speaking; decided by what was said.
  readingPaused: boolean;
  // Something the owner should know about (shown once).
  notice: 'echo' | null;
}

export type ConversationEvent =
  | { type: 'start' }
  | { type: 'ready' }
  | { type: 'stop' }
  // The voice detector (or the browser's recognition) heard speech begin, or drop out as noise.
  | { type: 'speechStart' }
  | { type: 'speechMisfire' }
  // An utterance ended and goes to be written down.
  | { type: 'speechEnd' }
  // What it said; `echo` when the words are the ones being read aloud.
  | { type: 'transcribed'; text: string; echo: boolean }
  | { type: 'transcribeFailed' }
  // The answer to the sent message ended (complete, stopped or failed).
  | { type: 'answerEnded' }
  | { type: 'waiting' }
  | { type: 'answerStarted' }
  | { type: 'error' }
  | { type: 'speakerStarted' }
  | { type: 'speakerIdle' }
  // The owner pressed "Unterbrechen": stop reading this answer.
  | { type: 'interrupt' }
  | { type: 'noticeSeen' };

export type ConversationEffect =
  // Write the finished utterance down (the hook holds its audio).
  | { type: 'transcribe' }
  | { type: 'send'; text: string }
  | { type: 'pauseReading' }
  | { type: 'resumeReading' }
  // Stop reading this answer for good (the owner interrupted it).
  | { type: 'dropReading' }
  | { type: 'stopAll' };

export const initialConversation: ConversationState = {
  active: 'off',
  userSpeaking: false,
  transcribing: 0,
  pendingText: '',
  awaitingAnswer: false,
  waiting: false,
  error: false,
  speaking: false,
  readingPaused: false,
  notice: null,
};

export function conversationPhase(state: ConversationState): ConversationPhase {
  if (state.active !== 'on') return state.active;
  if (state.userSpeaking) return 'hearing';
  if (state.speaking && !state.readingPaused) return 'speaking';
  if (state.error) return 'error';
  if (state.transcribing > 0) return 'transcribing';
  if (state.waiting) return 'waiting';
  if (state.awaitingAnswer) return 'thinking';
  return 'listening';
}

type Step = { state: ConversationState; effects: ConversationEffect[] };

// Sends what was written down once nothing more is on its way.
function flush(state: ConversationState, effects: ConversationEffect[]): Step {
  if (state.transcribing > 0 || state.userSpeaking || !state.pendingText.trim()) {
    return { state, effects };
  }
  return {
    state: { ...state, pendingText: '', awaitingAnswer: true, waiting: false },
    effects: [...effects, { type: 'send', text: state.pendingText.trim() }],
  };
}

// A paused reading goes on, or ends for good.
function settleReading(state: ConversationState, resume: boolean): Step {
  if (!state.readingPaused) return { state, effects: [] };
  return resume
    ? { state: { ...state, readingPaused: false }, effects: [{ type: 'resumeReading' }] }
    : {
        state: { ...state, readingPaused: false, speaking: false },
        effects: [{ type: 'dropReading' }],
      };
}

export function conversationStep(state: ConversationState, event: ConversationEvent): Step {
  if (event.type === 'start') {
    if (state.active !== 'off') return { state, effects: [] };
    return { state: { ...initialConversation, active: 'starting' }, effects: [] };
  }
  if (event.type === 'stop') {
    if (state.active === 'off') return { state, effects: [] };
    return { state: initialConversation, effects: [{ type: 'stopAll' }] };
  }
  if (state.active === 'off') return { state, effects: [] };

  switch (event.type) {
    case 'ready':
      return { state: { ...state, active: 'on' }, effects: [] };

    case 'speechStart': {
      if (state.userSpeaking) return { state, effects: [] };
      if (state.speaking && !state.readingPaused) {
        return {
          state: { ...state, userSpeaking: true, readingPaused: true, error: false },
          effects: [{ type: 'pauseReading' }],
        };
      }
      return { state: { ...state, userSpeaking: true, error: false }, effects: [] };
    }

    case 'speechMisfire': {
      const next = { ...state, userSpeaking: false };
      // Noise, not words: the reading goes on.
      const settled = settleReading(next, true);
      return flush(settled.state, settled.effects);
    }

    case 'speechEnd': {
      return {
        state: { ...state, userSpeaking: false, transcribing: state.transcribing + 1 },
        effects: [{ type: 'transcribe' }],
      };
    }

    case 'transcribed': {
      const text = event.text.trim();
      const next: ConversationState = {
        ...state,
        transcribing: Math.max(0, state.transcribing - 1),
      };
      if (event.echo) {
        // The microphone heard the reading: resume it and keep accepting later interruptions.
        const settled = settleReading({ ...next, notice: 'echo' }, true);
        return flush(settled.state, settled.effects);
      }
      if (!text) {
        const settled = settleReading(next, true);
        return flush(settled.state, settled.effects);
      }
      if (/^stopp[.!?]?$/iu.test(text)) {
        return { state: initialConversation, effects: [{ type: 'stopAll' }] };
      }
      const settled = settleReading(next, false);
      return flush(
        {
          ...settled.state,
          pendingText: settled.state.pendingText ? `${settled.state.pendingText} ${text}` : text,
        },
        settled.effects,
      );
    }

    case 'transcribeFailed': {
      const next = { ...state, transcribing: Math.max(0, state.transcribing - 1) };
      const settled = settleReading(next, true);
      return flush(settled.state, settled.effects);
    }

    case 'answerEnded':
      return { state: { ...state, awaitingAnswer: false, waiting: false }, effects: [] };

    case 'waiting':
      return { state: { ...state, waiting: true }, effects: [] };

    case 'answerStarted':
      return { state: { ...state, waiting: false }, effects: [] };

    case 'error':
      return { state: { ...state, error: true, waiting: false }, effects: [] };

    case 'speakerStarted':
      return { state: { ...state, speaking: true }, effects: [] };

    case 'speakerIdle':
      // A paused reading is not idle: it waits for the decision.
      if (state.readingPaused) return { state, effects: [] };
      return { state: { ...state, speaking: false }, effects: [] };

    case 'interrupt':
      if (!state.speaking) return { state, effects: [] };
      return {
        state: { ...state, speaking: false, readingPaused: false },
        effects: [{ type: 'dropReading' }],
      };

    case 'noticeSeen':
      return { state: { ...state, notice: null }, effects: [] };
  }
  return { state, effects: [] };
}

// ── Echo ─────────────────────────────────────────────────────────────────────────────────

function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 1);
}

// Whether what the microphone "heard" is the text being read aloud: most of its words are the
// reading's words. Whisper and the browser both mishear a little, so it is a share, not equality.
export function looksLikeEcho(heard: string, reading: string): boolean {
  const said = words(heard);
  if (said.length === 0) return false;
  const read = new Set(words(reading));
  if (read.size === 0) return false;
  const shared = said.filter((word) => read.has(word)).length;
  return said.length <= 2 ? shared === said.length : shared / said.length >= 0.6;
}
