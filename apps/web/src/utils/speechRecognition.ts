// The browser's own speech recognition (Web Speech API: Chrome, Edge, Safari; Firefox has
// none), shared by dictation (components/ai-elements/speech-input) and the conversation mode
// (features/voice). Chrome and Safari send the audio to their vendor to recognize it.

export interface RecognitionResultList {
  length: number;
  [index: number]: { isFinal: boolean; 0: { transcript: string } };
}

export interface BrowserRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: (() => void) | null;
  onerror: ((event: Event & { error: string }) => void) | null;
  onresult:
    ((event: Event & { resultIndex: number; results: RecognitionResultList }) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

export type RecognitionConstructor = new () => BrowserRecognition;

export function normalizeRecognizedName(text: string): string {
  return text.replace(/(?<![\p{L}\p{N}])(?:Eywa|Ewa|Aiwa)(?![\p{L}\p{N}])/giu, 'Ava');
}

export function recognitionConstructor(): RecognitionConstructor | undefined {
  if (typeof window === 'undefined') return undefined;
  const speech = window as typeof window & {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return speech.SpeechRecognition ?? speech.webkitSpeechRecognition;
}

// The page's locale fixes the recognition language ("de" → "de-DE").
export function recognitionLanguage(): string {
  const page = document.documentElement.lang;
  if (page && page.includes('-')) return page;
  const regions: Record<string, string> = {
    de: 'de-DE',
    en: 'en-US',
    es: 'es-ES',
    fr: 'fr-FR',
    pt: 'pt-BR',
    ru: 'ru-RU',
    uk: 'uk-UA',
    zh: 'zh-CN',
    ar: 'ar-SA',
    id: 'id-ID',
  };
  return (page && regions[page]) || 'de-DE';
}
