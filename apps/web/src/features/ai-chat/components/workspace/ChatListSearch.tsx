'use client';

import { Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { SearchField } from '@/design-system';

// Searches every one of the caller's chats by title and message text, server side (see
// GET /chats?q=). Two characters or fewer search nothing, which the API enforces too —
// short queries would match nearly every conversation.
export default function ChatListSearch({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useTranslations('chatWorkspace');
  return (
    <SearchField
      className="ds-chat-list-search"
      icon={<Search aria-hidden="true" />}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={t('list.search')}
      aria-label={t('list.search')}
      dir="auto"
    />
  );
}
