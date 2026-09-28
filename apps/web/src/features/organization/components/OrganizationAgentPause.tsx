'use client';

import { Pause, Play } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type { OrganizationAgent } from '@/lib/api/endpoints/organization';
import { usePauseAgent, useResumeAgent } from '../services/organization.service';
import { Inline, Text } from '@/design-system';

// Whether the agent takes new work, and the button that changes it.
export default function OrganizationAgentPause({
  teamId,
  agent,
}: {
  teamId: number;
  agent: OrganizationAgent;
}) {
  const t = useTranslations('organization.governance');
  const pause = usePauseAgent(teamId);
  const resume = useResumeAgent(teamId);
  const toggle = agent.pausedAt ? resume : pause;

  return (
    <Inline gap={2} justify="between" wrap align="start">
      <div className="min-w-0">
        <h4 className="text-sm font-medium">{t('title')}</h4>
        <Text as="p" size="xs" tone="muted" dir="auto">
          {agent.pausedAt ? agent.pauseReason : t('active')}
        </Text>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={toggle.isPending}
        onClick={() =>
          toggle.mutate(agent.id, {
            onSuccess: () =>
              toast.success(t(agent.pausedAt ? 'resumed' : 'paused', { name: agent.name })),
          })
        }
      >
        {agent.pausedAt ? <Play /> : <Pause />}
        {agent.pausedAt ? t('resume') : t('pause')}
      </Button>
    </Inline>
  );
}
