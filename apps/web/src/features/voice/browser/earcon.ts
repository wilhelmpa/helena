// A soft two-note chime the conversation plays when an answer takes a moment (the agent works;
// docs/helena-decisions/voice-2.md §4.4): hands-free, the owner does not look at the screen, and
// silence after a question reads as "not heard". Web Audio in the page, quiet and short; its
// context is created from the click that starts the conversation, so it may play later.

export interface Earcon {
  play(): void;
  close(): void;
}

export function createEarcon(): Earcon {
  let context: AudioContext | null = null;
  try {
    context = new AudioContext();
    void context.resume();
  } catch {
    context = null;
  }
  return {
    play() {
      if (!context) return;
      const now = context.currentTime + 0.02;
      for (const [offset, frequency] of [
        [0, 660],
        [0.14, 880],
      ] as const) {
        const tone = context.createOscillator();
        const gain = context.createGain();
        tone.type = 'sine';
        tone.frequency.value = frequency;
        gain.gain.setValueAtTime(0, now + offset);
        gain.gain.linearRampToValueAtTime(0.06, now + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.22);
        tone.connect(gain).connect(context.destination);
        tone.start(now + offset);
        tone.stop(now + offset + 0.25);
      }
    },
    close() {
      void context?.close();
      context = null;
    },
  };
}
