import {
  Bell,
  Bot,
  CalendarClock,
  GitBranch,
  Hourglass,
  ListChecks,
  Network,
  ShieldCheck,
  Webhook,
  type LucideIcon,
} from 'lucide-react';
import type { RunStepKind } from '@/lib/api/endpoints/pipelines';

// The icon of each kind of workflow step, in the builder and in the run timeline.
export const PIPELINE_STEP_ICONS: Record<RunStepKind, LucideIcon> = {
  agent: Bot,
  approval: ShieldCheck,
  condition: GitBranch,
  action: ListChecks,
  wait: Hourglass,
  notify: Bell,
  webhook: Webhook,
  delegate: CalendarClock,
  agent_team: Network,
};
