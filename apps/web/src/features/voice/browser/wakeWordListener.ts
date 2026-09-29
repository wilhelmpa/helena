import {
  recognitionConstructor,
  type BrowserRecognition,
  type RecognitionConstructor,
} from '@/utils/speechRecognition';
import { wakeWordRemainder } from '../utils/wakeWord';

export type WakeWordStatus = 'checking' | 'listening' | 'paused' | 'unavailable' | 'error';

type LocalRecognition = BrowserRecognition & { processLocally?: boolean };
type LocalConstructor = RecognitionConstructor & {
  available?: (options: { langs: string[]; processLocally: true }) => Promise<string>;
};

// The browser may use a remote service unless processLocally is explicitly required.
// No language pack is installed here: only a pack already on the device is accepted.
export async function startWakeWordListener(options: {
  onStatus: (status: WakeWordStatus) => void;
  onWake: (firstText: string) => void;
  isCancelled?: () => boolean;
}): Promise<() => void> {
  const Constructor = recognitionConstructor() as LocalConstructor | undefined;
  const language = 'de-DE';
  if (!Constructor?.available) {
    options.onStatus('unavailable');
    return () => {};
  }
  try {
    if (
      (await Constructor.available({ langs: [language], processLocally: true })) !== 'available'
    ) {
      options.onStatus('unavailable');
      return () => {};
    }
  } catch {
    options.onStatus('unavailable');
    return () => {};
  }
  if (options.isCancelled?.()) return () => {};

  let active = true;
  let recognition: LocalRecognition | null = null;
  let restart = 0;
  let settle = 0;
  let finalText = '';
  let interimText = '';
  const stop = () => {
    active = false;
    window.clearTimeout(restart);
    window.clearTimeout(settle);
    recognition?.abort();
    recognition = null;
  };
  const wake = () => {
    const remainder = wakeWordRemainder(`${finalText} ${interimText}`);
    if (remainder === null) return;
    stop();
    options.onWake(remainder);
  };
  const begin = () => {
    if (!active || options.isCancelled?.()) return;
    const next = new Constructor() as LocalRecognition;
    if (!('processLocally' in next)) {
      stop();
      options.onStatus('unavailable');
      return;
    }
    next.processLocally = true;
    next.lang = language;
    next.continuous = true;
    next.interimResults = true;
    next.onresult = (event) => {
      finalText = '';
      interimText = '';
      let wakeSeen = false;
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index]!;
        const transcript = result[0].transcript;
        if (result.isFinal && wakeWordRemainder(transcript) !== null) {
          finalText = transcript;
          interimText = '';
          wakeSeen = true;
        } else if (wakeSeen && result.isFinal) finalText += ` ${transcript}`;
        else if (wakeSeen) interimText += ` ${transcript}`;
      }
      window.clearTimeout(settle);
      if (wakeWordRemainder(finalText) !== null) settle = window.setTimeout(wake, 900);
    };
    next.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      stop();
      options.onStatus(event.error === 'language-not-supported' ? 'unavailable' : 'error');
    };
    next.onend = () => {
      if (!active) return;
      if (wakeWordRemainder(finalText) !== null) {
        wake();
        return;
      }
      finalText = '';
      interimText = '';
      restart = window.setTimeout(begin, 150);
    };
    recognition = next;
    try {
      next.start();
      options.onStatus('listening');
    } catch {
      stop();
      options.onStatus('error');
    }
  };
  begin();
  return stop;
}
