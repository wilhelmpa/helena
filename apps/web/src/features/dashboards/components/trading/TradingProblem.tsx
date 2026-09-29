'use client';

import { CircleAlert, PlugZap } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, EmptyState } from '@/design-system';
import type { TradingProblem as Problem } from '../../utils/tradingErrors';
import TradingConnectionChoice from './TradingConnectionChoice';

// What a widget shows when it has no numbers: the reason in plain words and, where the reader
// can do something about it, that one thing (choose the paper account; try again). Never a raw
// server sentence and never an empty box.
export default function TradingProblem({
  problem,
  credentialId,
  onCredentialChange,
  onRetry,
  retrying,
}: {
  problem: Problem;
  credentialId: number | undefined;
  onCredentialChange: (id: number) => void;
  onRetry: () => void;
  retrying: boolean;
}) {
  const t = useTranslations('dashboards.trading.widgets.problem');
  const connectionProblem = problem.kind === 'selectConnection' || problem.kind === 'noConnection';
  const text =
    problem.kind === 'provider'
      ? problem.status
        ? t('provider', { status: problem.status })
        : t('providerDown')
      : t(problem.kind);
  return (
    <EmptyState
      fill={false}
      icon={connectionProblem ? <PlugZap /> : <CircleAlert />}
      title={t(connectionProblem ? 'connectionTitle' : 'title')}
      action={
        problem.kind === 'selectConnection' ? (
          <TradingConnectionChoice value={credentialId} onChange={onCredentialChange} />
        ) : problem.kind === 'noConnection' || problem.kind === 'notPaper' ? undefined : (
          <Button size="small" onClick={onRetry} disabled={retrying}>
            {retrying ? t('retrying') : t('retry')}
          </Button>
        )
      }
    >
      {text}
    </EmptyState>
  );
}
