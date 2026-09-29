import type { SpeechInputError } from '@/components/ai-elements/speech-input';
import { ApiError } from '@/lib/api/core/client';
import { MicrophoneError } from '../browser/recorder';

export type DictationProblem =
  | 'limit'
  | 'nothing-heard'
  | 'blocked'
  | 'missing'
  | 'failed'
  | 'transcribe-failed'
  | 'recognition-failed';

export function dictationProblem(error: SpeechInputError, cause?: unknown): DictationProblem {
  if (error === 'limit') return 'limit';
  if (error === 'nothing-heard') return 'nothing-heard';
  if (error === 'blocked') return 'blocked';
  if (error === 'network') return 'recognition-failed';
  if (cause instanceof MicrophoneError) return cause.reason;
  if (cause instanceof ApiError || cause instanceof TypeError) return 'transcribe-failed';
  return 'failed';
}
