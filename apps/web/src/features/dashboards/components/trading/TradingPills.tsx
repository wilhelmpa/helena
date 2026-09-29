'use client';

import { useTranslations } from 'next-intl';
import { Pill, type PillTone } from '@/design-system';

// One word and one colour per state, the same in every trading widget.
const ORDER_TONE: Record<string, PillTone> = {
  filled: 'success',
  partially_filled: 'accent',
  new: 'active',
  accepted: 'active',
  pending_new: 'active',
  held: 'active',
  canceled: 'neutral',
  expired: 'neutral',
  replaced: 'neutral',
  done_for_day: 'neutral',
  rejected: 'danger',
  suspended: 'warning',
  stopped: 'warning',
};

const ORDER_STATUSES = [
  'filled',
  'partially_filled',
  'new',
  'accepted',
  'pending_new',
  'held',
  'canceled',
  'expired',
  'replaced',
  'done_for_day',
  'rejected',
  'suspended',
  'stopped',
] as const;

export function OrderStatusPill({ status }: { status: string }) {
  const t = useTranslations('dashboards.trading.widgets.orders.status');
  const known = (ORDER_STATUSES as readonly string[]).includes(status)
    ? (status as (typeof ORDER_STATUSES)[number])
    : null;
  return <Pill tone={ORDER_TONE[status] ?? 'neutral'}>{known ? t(known) : status}</Pill>;
}

// Whether a strategy version may trade on the paper account: the owner's approval.
export function ApprovalPill({
  status,
}: {
  status: 'pending' | 'approved' | 'rejected' | null | undefined;
}) {
  const t = useTranslations('dashboards.trading.widgets.approval');
  if (!status) return <Pill tone="neutral">{t('none')}</Pill>;
  return (
    <Pill tone={status === 'approved' ? 'success' : status === 'pending' ? 'warning' : 'danger'}>
      {t(status)}
    </Pill>
  );
}

const STRATEGY_TONE: Record<string, PillTone> = {
  paper: 'success',
  trockenlauf: 'accent',
  entwurf: 'neutral',
};

export function StrategyStatusPill({ status }: { status: string }) {
  const t = useTranslations('dashboards.trading.widgets.strategies.status');
  const known = status === 'entwurf' || status === 'trockenlauf' || status === 'paper';
  return <Pill tone={STRATEGY_TONE[status] ?? 'neutral'}>{known ? t(status) : status}</Pill>;
}
