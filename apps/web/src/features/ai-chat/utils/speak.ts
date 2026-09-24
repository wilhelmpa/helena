import { speechText } from './speechText';

// Reading text aloud with the browser's speech synthesis, shared by the per-message
// button and the composer's "read answers aloud" mode: one utterance at a time, in
// the page's language, with the best matching voice.

export const canSpeak = () =>
  typeof window !== 'undefined' &&
  'speechSynthesis' in window &&
  'SpeechSynthesisUtterance' in window;

function pickVoice(lang: string): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  const short = lang.slice(0, 2).toLowerCase();
  return (
    voices.find((voice) => voice.lang.toLowerCase() === lang.toLowerCase()) ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith(short))
  );
}

// Speaks `markdown` (without its Markdown) and calls `onEnd` when it finished, failed or
// was replaced by another. Returns false when there is nothing to say.
export function speak(markdown: string, onEnd?: () => void): boolean {
  if (!canSpeak()) return false;
  const text = speechText(markdown);
  if (!text) return false;
  window.speechSynthesis.cancel();
  const lang = document.documentElement.lang || navigator.language || 'de-DE';
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  const voice = pickVoice(lang);
  if (voice) utterance.voice = voice;
  if (onEnd) {
    utterance.onend = onEnd;
    utterance.onerror = onEnd;
  }
  window.speechSynthesis.speak(utterance);
  return true;
}

export function stopSpeaking() {
  if (canSpeak()) window.speechSynthesis.cancel();
}
