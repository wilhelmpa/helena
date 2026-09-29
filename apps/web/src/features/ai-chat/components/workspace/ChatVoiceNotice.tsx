'use client';

import { useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { Text } from '@/design-system';
import { Marker, MarkerContent } from '@/components/ui/marker';
import {
  subscribeVoiceFallback,
  voiceFallbackActive,
} from '@/features/voice/browser/voiceFallback';
import { useVoice } from '@/features/voice/hooks/useVoice';

// Which voice reads, when it is not the one that was chosen: Helena's local voice could not be
// reached, so the browser's reads — or, with "Nur lokal", nothing does. Shown while something is
// read or would be (a conversation, "read everything"), and while the browser's voice took over
// in the middle of an answer; never as a surprise, and gone as soon as Helena's voice is back.
export default function ChatVoiceNotice({ active }: { active: boolean }) {
  const t = useTranslations('chatWorkspace.composer');
  const voice = useVoice();
  const fellBack = useSyncExternalStore(subscribeVoiceFallback, voiceFallbackActive, () => false);
  const notice = fellBack ? 'browser' : active ? voice.speakerNotice : null;
  if (!notice) return null;
  return (
    <Marker role="status">
      <MarkerContent>
        <Text size="xs" tone="muted">
          {notice === 'browser' ? t('voiceFallback') : t('voiceDown')}
        </Text>
      </MarkerContent>
    </Marker>
  );
}
