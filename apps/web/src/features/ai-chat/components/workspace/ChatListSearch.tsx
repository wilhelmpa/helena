'use client';

import { Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';

// Searches every one of the caller's chats by title and message text, server side (see
// GET /chats?q=). Two characters or fewer search nothing, which the API enforces too —
// short queries would match nearly every conversation.
export default function ChatListSearch({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const t = useTranslations('chatWorkspace');

  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t('list.search')}
        aria-label={t('list.search')}
        className="ps-8"
        dir="auto"
      />
    </div>
  );
}
