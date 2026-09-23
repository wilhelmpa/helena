'use client';

import { Bot } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';

export default function MemberAgentBadge() {
  const t = useTranslations('members');

  return (
    <Badge variant="secondary" className="gap-1 px-1.5 py-0 text-xs font-medium">
      <Bot className="size-3" />
      {t('aiAgent')}
    </Badge>
  );
}
