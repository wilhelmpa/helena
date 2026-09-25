'use client';

import { useTranslations } from 'next-intl';
import type { ReflectionView } from '@/lib/api/endpoints/agents';
import { shortModel } from '@/features/local-ai/utils/localAi';

// The follow-up turn in which the agent kept what the run taught it: why it happened,
// how it went, and what it saved.
export default function ReflectionBlock({ reflection }: { reflection: ReflectionView }) {
  const t = useTranslations('teams.agents.reflection');
  const reason = t(
    reflection.reason === 'failure'
      ? 'reasonFailure'
      : reflection.reason === 'rework'
        ? 'reasonRework'
        : 'reasonComplex',
  );
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <span>{t('title')}</span>
        <span>·</span>
        <span>{t(reflection.status)}</span>
        <span>·</span>
        <span>{reason}</span>
        {reflection.model && (
          <>
            <span>·</span>
            <span>{t('local', { model: shortModel(reflection.model) })}</span>
          </>
        )}
        {reflection.tokens !== undefined && (
          <>
            <span>·</span>
            <span>{t('tokens', { count: reflection.tokens })}</span>
          </>
        )}
      </div>
      <div className="rounded-md bg-muted/50 p-2.5 text-xs">
        {reflection.saved.length > 0 ? (
          <ul className="list-inside list-disc space-y-0.5">
            {reflection.saved.map((item, index) => (
              <li key={index}>
                {t(item.tool === 'memory' ? 'toolMemory' : 'toolSkill')} · {item.action} ·{' '}
                {item.target}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">
            {reflection.status === 'failed' && reflection.error
              ? reflection.error
              : t('nothingSaved')}
          </p>
        )}
        {reflection.summary && <p className="mt-1 text-muted-foreground">{reflection.summary}</p>}
      </div>
    </div>
  );
}
