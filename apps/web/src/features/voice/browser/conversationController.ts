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
import { createResilientSpeaker, type SpeakerEvents, type VoiceSpeaker } from './speakers';
import { DEFAULT_PAUSE_MS } from '../utils/voiceSettings';
import { BRIDGES, preloadedPhrases, spokenLanguage, toolUpdate } from '../utils/voicePhrases';
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
  openEar?(events: EarEvents, pauseMs: number): Promise<ConversationEar>;
  speakerFactory?(speaker: Speaker, events: SpeakerEvents, speed: number): VoiceSpeaker | null;
  bridgeDelayMs?: number;
  progressIntervalMs?: number;
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
const TAIL_QUIET_MS = 0;
const BRIDGE_DELAY_MS = 120;
const PROGRESS_INTERVAL_MS = 6_000;

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
  private reading: { id: string; offset: number; dropped: boolean; chunks: number } | null = null;
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
  private bridgeTimer = 0;
  private bridgeDueAt = 0;
  private bridgeActive = false;
  private bridgeSinceAnswer = false;
  private bridgeIndex = -1;
  private bridgeText: string | null = null;
  private progressTimer = 0;
  private lastProgressAt = 0;
  private activeTool: string | null = null;
  private answerReading = false;
  // The answer whose voice failure was reported already.
  private voiceProblemFor: string | null = null;
  private progressEnabled = true;
  private readFullAnswers = true;
  private earcon: Earcon | null = null;
  // How long a pause ends a turn, and how fast the browser's voice reads (the owner's settings).
  private pauseMs = DEFAULT_PAUSE_MS;
  private speed = 1;
  private replyOnly = false;
  private immediateResponse = true;
  private bridgeEnabled = true;
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
    if (this.replyOnly || this.state.active !== 'on' || !listenerChanged) return;
    // Lokale KI changed while talking (local went down in "prefer", or came back): the ear
    // follows. A voice keeps reading what it has; the next answer uses the new one.
    void this.openEar();
  }

  // The owner's voice settings; a changed pause applies from the next conversation.
  configure(options: {
    pauseMs?: number;
    speed?: number;
    immediateResponse?: boolean;
    bridgeEnabled?: boolean;
    progressEnabled?: boolean;
    readFullAnswers?: boolean;
  }): void {
    if (options.pauseMs) this.pauseMs = options.pauseMs;
    if (options.speed) this.speed = options.speed;
    if (options.immediateResponse !== undefined) this.immediateResponse = options.immediateResponse;
    if (options.bridgeEnabled !== undefined) this.bridgeEnabled = options.bridgeEnabled;
    if (options.progressEnabled !== undefined) this.progressEnabled = options.progressEnabled;
    if (options.readFullAnswers !== undefined) this.readFullAnswers = options.readFullAnswers;
    if (!this.progressEnabled) window.clearTimeout(this.progressTimer);
  }

  // Starts from a click: the voice is unlocked before anything waits.
  start(messages: ConversationMessage[], busy: boolean, wakeText?: string): void {
    if (this.replyOnly) this.stop();
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
    this.bridgeActive = false;
    this.bridgeSinceAnswer = false;
    this.answerReading = false;
    this.activeTool = null;
    this.voice = this.createVoice(this.speaker);
    this.voice?.unlock();
    this.voice?.preload(preloadedPhrases(pageLanguage() ?? 'de'));
    this.earcon = createEarcon();
    if (wakeText !== undefined) this.earcon.play();
    this.dispatch({ type: 'start' });
    void this.openEar().then((opened) => {
      if (!opened) return;
      this.dispatch({ type: 'ready' });
      if (wakeText?.trim()) {
        this.deps.onHeard(wakeText);
        this.utterances.push({ samples: null, text: wakeText, reading: '' });
        this.dispatch({ type: 'speechStart' });
        this.dispatch({ type: 'speechEnd' });
      }
    });
  }

  prepareReply(): void {
    if (this.state.active !== 'off') return;
    this.voice ??= this.createVoice(this.speaker);
    this.voice?.unlock();
    this.voice?.preload(preloadedPhrases(pageLanguage() ?? 'de'));
  }

  followReply(messages: ConversationMessage[]): void {
    if (this.state.active !== 'off') return;
    stopSpeaking();
    this.replyOnly = true;
    this.generation += 1;
    this.messages = messages;
    this.baseline = new Set(messages.map((message) => message.id));
    this.sawBusy = false;
    this.reading = null;
    this.bridgeSinceAnswer = false;
    this.answerReading = false;
    this.prepareReply();
    const now = performance.now();
    this.marks = { stoppedAt: now, heardAt: now, sentAt: now };
    performance.mark('volition-voice-speech-ended', { startTime: now });
    this.state = { ...initialConversation, active: 'on', awaitingAnswer: true };
    this.bridgeDueAt = now + (this.deps.bridgeDelayMs ?? BRIDGE_DELAY_MS);
    this.lastProgressAt = now;
    this.scheduleBridge();
    this.scheduleProgress();
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
  update(
    messages: ConversationMessage[],
    busy: boolean,
    queued: number,
    tool: string | null = null,
  ): void {
    this.messages = messages;
    this.busy = busy;
    this.queued = queued;
    this.activeTool = tool;
    if (this.state.active === 'off') return;
    if (busy) this.sawBusy = true;
    if (this.state.awaitingAnswer && this.sawBusy && !busy && queued === 0) {
      window.clearTimeout(this.sendTimer);
      this.dispatch({ type: 'answerEnded' });
    }
    this.readAnswer();
    if (this.replyOnly && !this.state.awaitingAnswer && !busy && !this.voice?.busy()) this.stop();
    this.scheduleProgress();
  }

  // ── Effects ──────────────────────────────────────────────────────────────────────────

  private dispatch(event: ConversationEvent): void {
    const step = conversationStep(this.state, event);
    this.state = step.state;
    if (!this.replyOnly) this.deps.onState(step.state);
    for (const effect of step.effects) this.run(effect);
  }

  private run(effect: ConversationEffect): void {
    switch (effect.type) {
      case 'transcribe':
        void this.writeDown(this.utterances.shift());
        return;
      case 'send':
        // Until the new message arrives, the chat still contains the previous reply.
        // It must neither stop this turn's bridge nor mark its first answer text.
        this.baseline = new Set(this.messages.map((message) => message.id));
        if (this.marks && !this.marks.sentAt) this.marks.sentAt = performance.now();
        window.clearTimeout(this.chimeTimer);
        if (!this.immediateResponse || !this.bridgeEnabled)
          this.chimeTimer = window.setTimeout(() => {
            if (this.state.awaitingAnswer && !this.state.speaking && !this.state.userSpeaking)
              this.earcon?.play();
          }, WAITING_CHIME_MS);
        this.scheduleBridge();
        this.answerReading = false;
        this.lastProgressAt = performance.now();
        this.scheduleProgress();
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
        this.bridgeActive = false;
        window.clearTimeout(this.progressTimer);
        if (this.reading) this.reading.dropped = true;
        return;
      case 'stopAll':
        this.replyOnly = false;
        this.generation += 1;
        this.deps.onStream?.(null);
        this.deps.onOutputAnalyser?.(null);
        window.clearTimeout(this.sendTimer);
        window.clearTimeout(this.tailTimer);
        window.clearTimeout(this.chimeTimer);
        window.clearTimeout(this.bridgeTimer);
        window.clearTimeout(this.progressTimer);
        this.earcon?.close();
        this.earcon = null;
        this.marks = null;
        void this.ear?.destroy();
        this.ear = null;
        this.voice?.destroy();
        this.voice = null;
        this.utterances = [];
        this.reading = null;
        this.bridgeActive = false;
        this.bridgeSinceAnswer = false;
        this.bridgeText = null;
        this.activeTool = null;
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
      onSpeechStart: () => {
        window.clearTimeout(this.bridgeTimer);
        this.dispatch({ type: 'speechStart' });
      },
      onMisfire: () => this.dispatch({ type: 'speechMisfire' }),
      onUtterance: (samples, text) => {
        if (generation !== this.generation) return;
        // A new turn is timed from the moment the owner stopped speaking: the ear decides a
        // pause (its `pauseMs`) after that.
        const now = performance.now();
        this.marks = { stoppedAt: now - (this.ear?.pauseMs ?? 0), heardAt: now };
        performance.mark('volition-voice-speech-ended', {
          startTime: Math.max(0, this.marks.stoppedAt),
        });
        this.bridgeDueAt = this.marks.stoppedAt + (this.deps.bridgeDelayMs ?? BRIDGE_DELAY_MS);
        this.scheduleBridge();
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
      const ear = this.deps.openEar
        ? await this.deps.openEar(events, this.pauseMs)
        : listener.engine === 'local'
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
    const events: SpeakerEvents = {
      onStart: () => {
        this.ear?.setGuarded(true);
        this.dispatch({ type: 'speakerStarted' });
      },
      onIdle: () => {
        const wasBridge = this.bridgeActive;
        this.bridgeActive = false;
        this.ear?.setGuarded(false);
        this.dispatch({ type: 'speakerIdle' });
        if (this.replyOnly && !wasBridge && !this.state.awaitingAnswer && !this.busy) this.stop();
      },
      onAudible: (text) => {
        this.recordFirstTone();
        if (text === this.bridgeText || preloadedPhrases(pageLanguage() ?? 'de').includes(text))
          return;
        this.bridgeActive = false;
        this.bridgeSinceAnswer = false;
        this.heard();
      },
      onAnalyser: (analyser: AnalyserNode | null) => this.deps.onOutputAnalyser?.(analyser),
      onError: (text: string) => this.voiceFailed(text),
    };
    if (this.deps.speakerFactory) return this.deps.speakerFactory(speaker, events, this.speed);
    if (speaker.engine === 'none') return null;
    // Helena's voice, kept: a failed piece is asked for again, and the browser's voice reads
    // only where Helena's stays unreachable (said in the composer), until the next answer.
    return createResilientSpeaker(events, { speaker, rate: this.speed });
  }

  // The voice gave up on a piece (Helena's asked for again and, without a browser fallback, still
  // failing — or the browser's own voice failed): said once per answer. It does not change voices
  // (createResilientSpeaker does that, visibly, and only when Helena's stays unreachable).
  private voiceFailed(_text: string): void {
    if (!this.voice) return;
    const answer = this.reading?.id ?? '';
    if (this.voiceProblemFor === answer) return;
    this.voiceProblemFor = answer;
    this.deps.onProblem('voice-failed');
    // The rest of this answer stays unread (Helena's voice, no fallback): the voice is idle.
    if (this.voice.engine === 'local') this.voice.drain();
    this.dispatch({ type: 'error' });
    this.deps.refreshStatus();
  }

  private async writeDown(utterance: Utterance | undefined): Promise<void> {
    const generation = this.generation;
    const finish = (text: string) => {
      if (generation !== this.generation) return;
      if (this.marks && !this.marks.transcribedAt) this.marks.transcribedAt = performance.now();
      performance.mark('volition-voice-transcribed');
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
      window.clearTimeout(this.bridgeTimer);
      if (this.bridgeActive) {
        this.voice?.clear();
        this.bridgeActive = false;
      }
      this.deps.onProblem('transcribe-failed');
      this.dispatch({ type: 'error' });
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
    if (this.reading?.id !== message.id) {
      this.reading = { id: message.id, offset: 0, dropped: false, chunks: 0 };
      // Helena's voice is tried again from every new answer, also after a fallback.
      this.voice.renew?.();
    }
    if (this.reading.dropped) return;
    if (message.text.trim() && this.marks?.sentAt && !this.marks.answerAt) {
      this.marks.answerAt = performance.now();
      performance.mark('volition-voice-first-text');
      window.clearTimeout(this.chimeTimer);
      window.clearTimeout(this.bridgeTimer);
      window.clearTimeout(this.progressTimer);
      this.dispatch({ type: 'answerStarted' });
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
    if (next.chunks.length) {
      this.answerReading = true;
      window.clearTimeout(this.progressTimer);
      // A preface must never hold the real answer behind the rest of its audio.
      if (this.bridgeActive) this.voice.clear();
    }
    for (const chunk of next.chunks) {
      if (!this.readFullAnswers && this.reading.chunks >= 3) {
        this.reading.dropped = true;
        break;
      }
      this.reading.chunks += 1;
      this.voice.enqueue(chunk);
    }
  }

  private scheduleBridge(): void {
    window.clearTimeout(this.bridgeTimer);
    if (!this.immediateResponse || !this.bridgeEnabled || this.bridgeSinceAnswer) return;
    const generation = this.generation;
    this.bridgeTimer = window.setTimeout(
      () => {
        if (
          generation !== this.generation ||
          this.state.active !== 'on' ||
          this.state.userSpeaking ||
          this.state.readingPaused ||
          this.state.speaking ||
          this.marks?.answerAt ||
          !this.voice
        )
          return;
        this.bridgeActive = true;
        this.bridgeSinceAnswer = true;
        const phrases = BRIDGES[spokenLanguage(pageLanguage() ?? 'de')];
        this.bridgeIndex = (this.bridgeIndex + 1) % phrases.length;
        this.bridgeText = phrases[this.bridgeIndex]!;
        this.dispatch({ type: 'waiting' });
        this.voice.enqueue(this.bridgeText);
      },
      Math.max(0, this.bridgeDueAt - performance.now()),
    );
  }

  private scheduleProgress(): void {
    window.clearTimeout(this.progressTimer);
    if (
      !this.progressEnabled ||
      !this.state.awaitingAnswer ||
      this.answerReading ||
      !this.activeTool
    )
      return;
    const generation = this.generation;
    const interval = this.deps.progressIntervalMs ?? PROGRESS_INTERVAL_MS;
    this.progressTimer = window.setTimeout(
      () => {
        if (
          generation !== this.generation ||
          !this.progressEnabled ||
          !this.state.awaitingAnswer ||
          this.answerReading
        )
          return;
        if (
          !this.state.userSpeaking &&
          !this.state.readingPaused &&
          this.voice &&
          this.activeTool
        ) {
          this.voice.enqueue(toolUpdate(this.activeTool, pageLanguage() ?? 'de'));
        }
        this.lastProgressAt = performance.now();
        this.scheduleProgress();
      },
      Math.max(0, interval - (performance.now() - this.lastProgressAt)),
    );
  }

  // The first sound of an answer: the turn's time is complete.
  private recordFirstTone(): void {
    if (!this.marks || this.marks.firstSoundAt) return;
    this.marks.firstSoundAt = performance.now();
    this.marks.firstSoundKind = this.bridgeActive ? 'bridge' : 'answer';
    performance.mark('volition-voice-first-tone');
  }

  private heard(): void {
    const marks = this.marks;
    if (!marks?.answerAt) return;
    this.marks = null;
    if (this.immediateResponse && this.bridgeEnabled) {
      const phrases = BRIDGES[spokenLanguage(pageLanguage() ?? 'de')];
      this.voice?.warm?.(phrases[(this.bridgeIndex + 1) % phrases.length]!);
    }
    this.deps.onTimings?.(turnTimings({ ...marks, audibleAt: performance.now() }));
  }
}
