'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { CornerDownLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

// A quick way to answer the question the agent just ended its turn on, without
// scrolling down to the composer. Sends the same way a typed message would; the
// composer stays available too, this is a shortcut, not a second input.
export default function ChatClarificationCard({ onReply }: { onReply: (text: string) => void }) {
  const t = useTranslations('chatWorkspace');
  const [value, setValue] = useState('');

  function submit() {
    const text = value.trim();
    if (!text) return;
    onReply(text);
    setValue('');
  }

  return (
    <div className="w-full max-w-md space-y-2 rounded-lg border border-dashed bg-muted/40 p-3">
      <p className="text-xs font-medium text-muted-foreground">
        {t('messages.clarificationLabel')}
      </p>
      <Textarea
        dir="auto"
        rows={2}
        value={value}
        placeholder={t('messages.clarificationPlaceholder')}
        aria-label={t('messages.clarificationPlaceholder')}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <div className="flex justify-end">
        <Button size="sm" disabled={!value.trim()} onClick={submit}>
          <CornerDownLeft className="size-3.5" /> {t('messages.reply')}
        </Button>
      </div>
    </div>
  );
}
