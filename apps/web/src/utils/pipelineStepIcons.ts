import { Bot, GitBranch, Hourglass, ListChecks, ShieldCheck, type LucideIcon } from 'lucide-react';
import type { StepKind } from '@/lib/api/endpoints/pipelines';

// The icon of each kind of workflow step, in the builder and in the run timeline.
export const PIPELINE_STEP_ICONS: Record<StepKind, LucideIcon> = {
  agent: Bot,
  approval: ShieldCheck,
  condition: GitBranch,
  action: ListChecks,
  wait: Hourglass,
};
