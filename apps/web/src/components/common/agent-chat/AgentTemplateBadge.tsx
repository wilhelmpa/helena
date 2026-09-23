'use client';

import { LayoutTemplate } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';

// A pool template runs nowhere and has no runner, by design (a project adds a copy of
// it instead) — that is not the same thing as "offline" (a runner that should be
// connected but is not), so it must never render with the same warning-shaped status
// anywhere an agent's presence is shown. `copyCount`, when the caller already has the
// team's agent list at hand, adds "· 3 Kopien" so the badge doubles as a quick answer
// to "is this template actually used".
export function AgentTemplateBadge({ copyCount }: { copyCount?: number }) {
  const t = useTranslations('teams.agents');
  return (
    <Badge variant="secondary" className="shrink-0 gap-1 text-muted-foreground">
      <LayoutTemplate className="size-3" />
      {t('template')}
      {copyCount != null && (
        <span className="text-muted-foreground/70">
          · {t('templateCopyCount', { count: copyCount })}
        </span>
      )}
    </Badge>
  );
}
