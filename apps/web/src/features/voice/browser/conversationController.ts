import { ApiError } from '@/lib/api/core/client';
import {
  conversationStep,
  initialConversation,
  looksLikeEcho,
  type ConversationEffect,
  type ConversationEvent,
  type ConversationState,
} from '../utils/conversation';
import { nextSpeechChunks, settledTail } from '../utils/speechChunks';
import { turnTimings, type TurnMarks, type TurnTimings } from '../utils/turnTimings';
import type { Listener, Speaker } from '../utils/voiceEngine';
import { encodeWav16, isSilent } from '../utils/wav';
import { startRecognitionEar } from './recognitionEar';
import { MicrophoneError } from './recorder';
import { createEarcon, type Earcon } from './earcon';
import { stopSpeaking } from './speak';
import { createBrowserSpeaker, createLocalSpeaker, type VoiceSpeaker } from './speakers';
import { DEFAULT_PAUSE_MS } from '../utils/voiceSettings';
import { startVadEar, type ConversationEar, type EarEvents } from './vadListener';

// Runs the conversation mode (utils/conversation.ts is its turn-taking): owns the ear (the voice
// detector or the browser's recognition) and the voice, writes utterances down, reads each new
// answer as it streams, and tells the chat what to send. Framework-free; useConversation feeds it
// the chat's messages and renders its state.

export type ConversationProblem =
  | 'insecure'
  | 'local-only-down'
  | 'unsupported'
  | 'blocked'
  | 'missing'
  | 'failed'
  | 'transcribe-failed'
  | 'recognition-failed'
  | 'voice-failed';

// The parts of a chat message the conversation reads.
export interface ConversationMessage {
  id: string;
  role: string;
  text: string;
}

export interface ConversationDeps {
  onState(state: ConversationState): void;
  // What was understood, to show for a moment.
  onHeard(text: string): void;
  onLevel(level: number): void;
  onStream?(stream: MediaStream | null): void;
  onOutputAnalyser?(analyser: AnalyserNode | null): void;
  onProblem(problem: ConversationProblem): void;
  send(text: string): void;
  // What was said; `dropped` when something was heard but it was not the owner's words
  // (noise, a line Whisper invents on silence, another language).
  transcribe(
    wav: Blob,
    language: string | null,
  ): Promise<{ text: string; dropped?: string | null }>;
  // Speech was heard but not understood (the model wrote another language): say so.
  onMisheard?(): void;
  // Lokale KI's answer may have changed (a refusal came back).
  refreshStatus(): void;
  // Where the time of the last turn went (the owner stopped speaking → the answer is heard).
  onTimings?(timings: TurnTimings): void;
}

interface Utterance {
  samples: Float32Array | null;
  text: string | null;
  // What was being read when it ended: what an echo would repeat.
  reading: string;
}

// If a sent message is not taken up (the chat refused it) the conversation does not wait on.
const SEND_TIMEOUT_MS = 10_000;
// When an answer has not started this long after a turn was sent, a soft chime says "heard you,
// working on it" (the agent's runtime takes seconds; the voice reply is quicker than this).
const WAITING_CHIME_MS = 1_600;
// A finished-looking last sentence of a streaming answer is read once the text has been quiet
// this long (speechChunks.settledTail): the runner sends text every 150 ms while it comes.
const TAIL_QUIET_MS = 300;

function pageLanguage(): string | null {
  const lang = (document.documentElement.lang || '').slice(0, 2).toLowerCase();
  return /^[a-z]{2}$/.test(lang) ? lang : null;
}

export class ConversationController {
  private state: ConversationState = initialConversation;
  private ear: ConversationEar | null = null;
  private voice: VoiceSpeaker | null = null;
  private speaker: Speaker = { engine: 'none' };
  private listener: Listener = { engine: 'none', blocker: 'unsupported' };
  private utterances: Utterance[] = [];
  // The answer being read and how far.
  private reading: { id: string; offset: number; dropped: boolean } | null = null;
  // The messages there were before the conversation started: never read.
  private baseline = new Set<string>();
  private messages: ConversationMessage[] = [];
  private busy = false;
  private queued = 0;
  private sawBusy = false;
  private sendTimer = 0;
  // A new conversation (or its end) makes everything still on its way from the last one stale.
  private generation = 0;
  private tailTimer = 0;
  private chimeTimer = 0;
  private earcon: Earcon | null = null;
  // How long a pause ends a turn, and how fast the browser's voice reads (the owner's settings).
  private pauseMs = DEFAULT_PAUSE_MS;
  private speed = 1;
  // The turn being timed: from the end of the owner's speech to the first sound of the answer.
  private marks: TurnMarks | null = null;

  constructor(private readonly deps: ConversationDeps) {}

  get snapshot(): ConversationState {
    return this.state;
  }

  setEngines(listener: Listener, speaker: Speaker): void {
    const listenerChanged = listener.engine !== this.listener.engine;
    this.listener = listener;
    this.speaker = speaker;
    if (this.state.active !== 'on' || !listenerChanged) return;
    // Lokale KI changed while talking (local went down in "prefer", or came back): the ear
    // follows. A voice keeps reading what it has; the next answer uses the new one.
    void this.openEar();
  }

  // The owner's voice settings; a changed pause applies from the next conversation.
  configure(options: { pauseMs?: number; speed?: number }): void {
    if (options.pauseMs) this.pauseMs = options.pauseMs;
    if (options.speed) this.speed = options.speed;
  }

  // Starts from a click: the voice is unlocked before anything waits.
  start(messages: ConversationMessage[], busy: boolean): void {
    if (this.state.active !== 'off') return;
    if (this.listener.engine === 'none') {
      this.deps.onProblem(this.listener.blocker);
      return;
    }
    stopSpeaking();
    this.generation += 1;
    this.messages = messages;
    this.busy = busy;
    this.baseline = new Set(messages.map((message) => message.id));
    this.reading = null;
    this.utterances = [];
    this.voice = this.createVoice(this.speaker);
    this.voice?.unlock();
    this.earcon = createEarcon();
    this.dispatch({ type: 'start' });
    void this.openEar().then((opened) => {
      if (opened) this.dispatch({ type: 'ready' });
    });
  }

  stop(): void {
    this.dispatch({ type: 'stop' });
  }

  dismissNotice(): void {
    this.dispatch({ type: 'noticeSeen' });
  }

  // "Unterbrechen": stop reading this answer and listen.
  interrupt(): void {
    this.dispatch({ type: 'interrupt' });
  }

  // The chat moved on: new messages, an answer streaming or done, messages waiting to be sent.
  update(messages: ConversationMessage[], busy: boolean, queued: number): void {
    this.messages = messages;
    this.busy = busy;
    this.queued = queued;
    if (this.state.active === 'off') return;
    if (busy) this.sawBusy = true;
    if (this.state.awaitingAnswer && this.sawBusy && !busy && queued === 0) {
      window.clearTimeout(this.sendTimer);
      this.dispatch({ type: 'answerEnded' });
    }
    this.readAnswer();
  }

  // ── Effects ──────────────────────────────────────────────────────────────────────────

  private dispatch(event: ConversationEvent): void {
    const step = conversationStep(this.state, event);
    this.state = step.state;
    this.deps.onState(step.state);
    for (const effect of step.effects) this.run(effect);
  }

  private run(effect: ConversationEffect): void {
    switch (effect.type) {
      case 'transcribe':
        void this.writeDown(this.utterances.shift());
        return;
      case 'discardUtterance':
        this.utterances.shift();
        return;
      case 'send':
        if (this.marks && !this.marks.sentAt) this.marks.sentAt = performance.now();
        window.clearTimeout(this.chimeTimer);
        this.chimeTimer = window.setTimeout(() => {
          if (this.state.awaitingAnswer && !this.state.speaking && !this.state.userSpeaking)
            this.earcon?.play();
        }, WAITING_CHIME_MS);
        this.sawBusy = this.busy;
        window.clearTimeout(this.sendTimer);
        this.sendTimer = window.setTimeout(() => {
          if (this.state.awaitingAnswer && !this.sawBusy && !this.busy && this.queued === 0)
            this.dispatch({ type: 'answerEnded' });
        }, SEND_TIMEOUT_MS);
        this.deps.send(effect.text);
        return;
      case 'pauseReading':
        this.voice?.pause();
        return;
      case 'resumeReading':
        this.voice?.resume();
        return;
      case 'dropReading':
        this.voice?.clear();
        if (this.reading) this.reading.dropped = true;
        return;
      case 'stopAll':
        this.generation += 1;
        this.deps.onStream?.(null);
        this.deps.onOutputAnalyser?.(null);
        window.clearTimeout(this.sendTimer);
        window.clearTimeout(this.tailTimer);
        window.clearTimeout(this.chimeTimer);
        this.earcon?.close();
        this.earcon = null;
        this.marks = null;
        void this.ear?.destroy();
        this.ear = null;
        this.voice?.destroy();
        this.voice = null;
        this.utterances = [];
        this.reading = null;
        return;
    }
  }

  private async openEar(): Promise<boolean> {
    const generation = this.generation;
    this.deps.onStream?.(null);
    await this.ear?.destroy();
    this.ear = null;
    const listener = this.listener;
    if (listener.engine === 'none') {
      this.deps.onProblem(listener.blocker);
      this.stop();
      return false;
    }
    const events: EarEvents = {
      onSpeechStart: () => this.dispatch({ type: 'speechStart' }),
      onMisfire: () => this.dispatch({ type: 'speechMisfire' }),
      onUtterance: (samples, text) => {
        if (generation !== this.generation) return;
        // A new turn is timed from the moment the owner stopped speaking: the ear decides a
        // pause (its `pauseMs`) after that.
        const now = performance.now();
        this.marks = { stoppedAt: now - (this.ear?.pauseMs ?? 0), heardAt: now };
        this.utterances.push({ samples, text, reading: this.voice?.reading() ?? '' });
        this.dispatch({ type: 'speechEnd' });
      },
      onLevel: (level) => this.deps.onLevel(level),
      onStream: (stream) => {
        if (generation === this.generation) this.deps.onStream?.(stream);
      },
      onError: (reason) => {
        if (generation !== this.generation) return;
        this.deps.onProblem(reason === 'network' ? 'recognition-failed' : reason);
        this.stop();
      },
    };
    try {
      const ear =
        listener.engine === 'local'
          ? await startVadEar(events, this.pauseMs)
          : startRecognitionEar(events);
      if (generation !== this.generation) {
        void ear.destroy();
        return false;
      }
      this.ear = ear;
      ear.setGuarded(this.voice?.busy() ?? false);
      return true;
    } catch (error) {
      if (generation === this.generation) {
        // startVadEar reported a microphone refusal itself.
        if (!(error instanceof MicrophoneError)) this.deps.onProblem('failed');
        this.stop();
      }
      return false;
    }
  }

  private createVoice(speaker: Speaker): VoiceSpeaker | null {
    const events = {
      onStart: () => {
        this.ear?.setGuarded(true);
        this.dispatch({ type: 'speakerStarted' });
      },
      onIdle: () => {
        this.ear?.setGuarded(false);
        this.dispatch({ type: 'speakerIdle' });
      },
      onAudible: () => this.heard(),
      onAnalyser: (analyser: AnalyserNode | null) => this.deps.onOutputAnalyser?.(analyser),
      onError: (text: string) => this.voiceFailed(text),
    };
    if (speaker.engine === 'local') return createLocalSpeaker(events);
    if (speaker.engine === 'browser') return createBrowserSpeaker(events, { rate: this.speed });
    return null;
  }

  // Helena's voice failed on a piece: in "prefer" the browser's voices read on (from that piece),
  // in "only" the answer stays unread. Said once.
  private voiceFailed(text: string): void {
    const failed = this.voice;
    if (!failed || failed.engine !== 'local') return;
    this.deps.onProblem('voice-failed');
    const rest = [text, ...failed.drain()];
    failed.destroy();
    const fallback = this.speaker.engine === 'local' ? this.speaker.fallback : null;
    this.speaker = fallback ? { engine: 'browser' } : { engine: 'none' };
    this.voice = this.createVoice(this.speaker);
    for (const piece of rest) this.voice?.enqueue(piece);
    this.deps.refreshStatus();
  }

  private async writeDown(utterance: Utterance | undefined): Promise<void> {
    const generation = this.generation;
    const finish = (text: string) => {
      if (generation !== this.generation) return;
      if (this.marks && !this.marks.transcribedAt) this.marks.transcribedAt = performance.now();
      const echo =
        this.state.readingPaused && text !== '' && looksLikeEcho(text, utterance?.reading ?? '');
      if (text && !echo) this.deps.onHeard(text);
      this.dispatch({ type: 'transcribed', text, echo });
    };
    if (!utterance) return finish('');
    if (utterance.text !== null) return finish(utterance.text);
    const samples = utterance.samples;
    if (!samples || isSilent(samples)) return finish('');
    try {
      const wav = new Blob([encodeWav16(samples) as BlobPart], { type: 'audio/wav' });
      const result = await this.deps.transcribe(wav, pageLanguage());
      if (result.dropped === 'other-language' && generation === this.generation)
        this.deps.onMisheard?.();
      finish(result.text);
    } catch (error) {
      if (generation !== this.generation) return;
      this.deps.onProblem('transcribe-failed');
      if (error instanceof ApiError && error.code?.startsWith('voice-local'))
        this.deps.refreshStatus();
      this.dispatch({ type: 'transcribeFailed' });
    }
  }

  // Hands the newest answer's next complete sentences to the voice.
  private readAnswer(): void {
    window.clearTimeout(this.tailTimer);
    if (this.state.active !== 'on' || !this.voice) return;
    const index = this.messages.findLastIndex(
      (message) => message.role === 'assistant' && !this.baseline.has(message.id),
    );
    if (index < 0) return;
    const message = this.messages[index]!;
    if (this.reading?.id !== message.id)
      this.reading = { id: message.id, offset: 0, dropped: false };
    if (this.reading.dropped) return;
    if (message.text.trim() && this.marks?.sentAt && !this.marks.answerAt) {
      this.marks.answerAt = performance.now();
      window.clearTimeout(this.chimeTimer);
    }
    const streaming = this.busy && index === this.messages.length - 1;
    this.handOver(message.text, !streaming);
    // A last sentence that looks finished is read after a short quiet, not when the answer is
    // closed (which comes a second or two after its text).
    if (streaming && settledTail(message.text, this.reading.offset)) {
      const { id } = message;
      const length = message.text.length;
      this.tailTimer = window.setTimeout(() => {
        const current = this.messages.find((candidate) => candidate.id === id);
        if (!current || current.text.length !== length || this.reading?.id !== id) return;
        if (this.reading.dropped) return;
        this.handOver(current.text, true);
      }, TAIL_QUIET_MS);
    }
  }

  private handOver(text: string, final: boolean): void {
    if (!this.reading || !this.voice) return;
    const next = nextSpeechChunks(text, this.reading.offset, final, pageLanguage() ?? 'de');
    this.reading.offset = next.offset;
    for (const chunk of next.chunks) this.voice.enqueue(chunk);
  }

  // The first sound of an answer: the turn's time is complete.
  private heard(): void {
    const marks = this.marks;
    if (!marks?.answerAt) return;
    this.marks = null;
    this.deps.onTimings?.(turnTimings({ ...marks, audibleAt: performance.now() }));
  }
}
