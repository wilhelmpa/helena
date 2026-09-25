'use client';

import { AudioLines } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { shortModel } from '@/features/local-ai/utils/localAi';

// Under an answer Helena's voice reply gave instead of the agent (a spoken question the
// conversation itself answered, docs/helena-decisions/voice-2.md §4): which fast local model
// said it, so nobody takes it for the agent's own answer.
export default function VoiceReplyLine({ model }: { model: string | null | undefined }) {
  const t = useTranslations('chatWorkspace.voice');
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <AudioLines className="size-3.5 shrink-0" aria-hidden />
      <span>{t('replyLine', { model: model ? shortModel(model) : '—' })}</span>
    </span>
  );
}
