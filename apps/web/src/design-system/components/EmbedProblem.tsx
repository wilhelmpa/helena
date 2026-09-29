'use client';

import { PlugZap, RefreshCw, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { FrameProblemReason } from '@/utils/frameProbe';
import { Button } from './Button';
import { EmptyState } from './Section';

// Ava's own view for an embedded tool that does not answer (Auftrag 116), in place of
// the browser's "This page couldn't load": what is down, why as far as it is known, and
// "Neu laden" / "Tab schließen". It says that it reconnects by itself, which it does
// (useFrameGuard). One view for code, terminals, the browser's desktop and previews.
export function EmbedProblem({
  tool,
  reason,
  status,
  retrying = true,
  onReload,
  onClose,
}: {
  // The tool's name, as its tab names it.
  tool: string;
  reason: FrameProblemReason;
  status?: number;
  retrying?: boolean;
  onReload: () => void;
  onClose?: () => void;
}) {
  const t = useTranslations('nav.workspace.frameProblem');
  return (
    <div className="ds-embed-problem" data-reason={reason}>
      <EmptyState
        icon={<PlugZap />}
        title={t('title', { tool })}
        action={
          <>
            <Button icon={<RefreshCw size={14} />} onClick={onReload}>
              {t('reload')}
            </Button>
            {onClose && (
              <Button variant="ghost" icon={<X size={14} />} onClick={onClose}>
                {t('close')}
              </Button>
            )}
          </>
        }
      >
        {reason === 'unreachable'
          ? t('reasons.unreachable')
          : reason === 'status'
            ? t('reasons.status', { status: status ?? 0 })
            : reason === 'forbidden'
              ? t('reasons.forbidden')
              : reason === 'timeout'
                ? t('reasons.timeout')
                : t('reasons.blocked')}
        {retrying && <span className="ds-embed-problem-retry">{t('retrying')}</span>}
      </EmptyState>
    </div>
  );
}
