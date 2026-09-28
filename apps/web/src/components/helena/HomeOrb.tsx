'use client';

import Orb from '@/components/helena/Orb';
import { useAgentStatus } from '@/utils/helenaStatus';
import { useChatWorkspaceScope } from '@/features/ai-chat/hooks/useChatWorkspaceScope';

// The Home agent's status as a small CSS orb (no WebGL): the chat button at the bottom
// right and the chat tool in the sidebar's tool row show the same orb, so the chat has
// one face wherever it is opened from.
export default function HomeOrb({
  size = 'medium',
  className,
}: {
  size?: 'medium' | 'small';
  className?: string;
}) {
  const home = useChatWorkspaceScope(null);
  const status = useAgentStatus(home.agents[0]?.id ?? 0);
  return <Orb state={status} size={size} className={className} />;
}
