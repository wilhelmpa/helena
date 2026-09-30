import { CornerDownRight, Hourglass, Replace, type LucideIcon } from 'lucide-react';
import type { FollowupMode } from '@/lib/api/endpoints/agentFollowups';

// One icon per steering mode, shared by the composer's picker and the transcript's notes.
const ICONS: Record<FollowupMode, LucideIcon> = {
  inject: CornerDownRight,
  after: Hourglass,
  replace: Replace,
};

export default function FollowupIcon({
  mode,
  className,
}: {
  mode: FollowupMode;
  className?: string;
}) {
  const Icon = ICONS[mode];
  return <Icon className={className} aria-hidden="true" />;
}
