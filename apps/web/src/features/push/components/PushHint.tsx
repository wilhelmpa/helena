'use client';

import { useTranslations } from 'next-intl';
import { BellOff, Lock, Share, TriangleAlert } from 'lucide-react';
import type { PushSupport } from '../utils/pushSupport';

export type PushHintKind = Exclude<PushSupport, 'supported'> | 'noKey';

const ICONS = {
  insecure: Lock,
  'ios-install': Share,
  unsupported: TriangleAlert,
  denied: BellOff,
  noKey: TriangleAlert,
} as const;

const KEYS = {
  insecure: 'insecure',
  'ios-install': 'iosInstall',
  unsupported: 'unsupported',
  denied: 'denied',
  noKey: 'noKey',
} as const;

// Why push cannot be switched on here, and what to do: one row at the top of the card.
export default function PushHint({ kind }: { kind: PushHintKind }) {
  const t = useTranslations('account.notifications.hints');
  const Icon = ICONS[kind];
  const key = KEYS[kind];
  return (
    <div className="flex gap-3 px-4 py-3" role="note">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium">{t(`${key}.title`)}</p>
        <p className="text-xs text-muted-foreground">{t(`${key}.body`)}</p>
      </div>
    </div>
  );
}
