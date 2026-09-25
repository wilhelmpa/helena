'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { copyText } from '@/utils/clipboard';
import type { ConversationProblem } from '../browser/conversationController';

// Every way voice can fail, said once and precisely — never a button that silently does nothing.
// On plain http the message names the one thing that helps today (Chrome's flag for this origin,
// with its address to copy: a page cannot open chrome:// itself) and what fixes it for good
// (HTTPS).

export type VoiceProblem = ConversationProblem | 'nothing-heard' | 'limit' | 'echo';

export const CHROME_FLAG = 'chrome://flags/#unsafely-treat-insecure-origin-as-secure';

export function useVoiceProblem(): (problem: VoiceProblem, detail?: { seconds?: number }) => void {
  const t = useTranslations('chatWorkspace.voice.problems');
  return useCallback(
    (problem, detail) => {
      switch (problem) {
        case 'insecure':
          toast.info(t('insecureTitle'), {
            description: t('insecure', { origin: window.location.origin, flag: CHROME_FLAG }),
            duration: 20_000,
            action: {
              label: t('copyFlag'),
              onClick: () => {
                void copyText(CHROME_FLAG).then(
                  () => toast.success(t('flagCopied')),
                  () => {},
                );
              },
            },
          });
          return;
        case 'local-only-down':
          toast.info(t('localOnlyDownTitle'), {
            description: t('localOnlyDown'),
            duration: 10_000,
          });
          return;
        case 'unsupported':
          toast.info(t('unsupportedTitle'), { description: t('unsupported'), duration: 12_000 });
          return;
        case 'blocked':
          toast.error(t('blocked'), { duration: 10_000 });
          return;
        case 'missing':
          toast.error(t('missing'));
          return;
        case 'failed':
          toast.error(t('failed'));
          return;
        case 'transcribe-failed':
          toast.error(t('transcribeFailed'));
          return;
        case 'recognition-failed':
          toast.error(t('recognitionFailed'), { duration: 10_000 });
          return;
        case 'voice-failed':
          toast.info(t('voiceFailed'));
          return;
        case 'nothing-heard':
          toast.info(t('nothingHeard'));
          return;
        case 'limit':
          toast.info(t('limit', { seconds: detail?.seconds ?? 120 }));
          return;
        case 'echo':
          toast.info(t('echoTitle'), { description: t('echo'), duration: 12_000 });
          return;
      }
    },
    [t],
  );
}
