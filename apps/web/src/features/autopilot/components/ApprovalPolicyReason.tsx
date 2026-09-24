'use client';

import { useTranslations } from 'next-intl';
import type { ApprovalRequest } from '@/lib/api/endpoints/approvals';
import type { AutopilotLevel, PolicyReason } from '@/lib/api/endpoints/autopilot';
import AutopilotLevelBadge from './AutopilotLevelBadge';

const REASONS: PolicyReason[] = [
  'always-allowed',
  'level-allows',
  'approved',
  'level-requires-approval',
  'hard-block',
  'budget-exhausted',
  'policy',
];

// Why a request needs a person, as Helena's policy engine put it when the agent asked: the
// level that applied and the reason ("Stufe 1 (Mit Freigabe) verlangt dafür eine Freigabe.").
export default function ApprovalPolicyReason({ request }: { request: ApprovalRequest }) {
  const t = useTranslations('autopilot');
  const reason = request.policyReason as PolicyReason | null | undefined;
  const level = request.autopilotLevel;
  if (!reason || !REASONS.includes(reason) || level == null || level < 0 || level > 3) return null;
  const name = t(`level.${level as AutopilotLevel}.name`);
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <AutopilotLevelBadge level={level} />
      <span>{t(`reason.${reason}`, { level, name })}</span>
    </p>
  );
}
