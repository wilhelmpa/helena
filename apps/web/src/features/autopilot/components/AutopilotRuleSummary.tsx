'use client';

import { Check, Hand } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { LevelRule } from '@/lib/api/endpoints/autopilot';

// "Agenten in diesem Projekt dürfen …": what the chosen level lets the agents do on their
// own and what they bring to a person first, straight from the policy engine's rules.
export default function AutopilotRuleSummary({ rules }: { rules: LevelRule[] }) {
  const t = useTranslations('autopilot');
  const phrase = (rule: LevelRule) =>
    rule.scope
      ? `${t(`category.${rule.category}`)} (${t(`scope.${rule.scope}`)})`
      : t(`category.${rule.category}`);
  const free = rules.filter((rule) => rule.outcome === 'allow');
  const ask = rules.filter((rule) => rule.outcome !== 'allow');
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <RuleList icon={<Check className="size-4 text-status-success" />} title={t('summaryMay')}>
        {free.map((rule) => (
          <li key={`${rule.category}:${rule.scope}`}>{phrase(rule)}</li>
        ))}
      </RuleList>
      {ask.length > 0 && (
        <RuleList icon={<Hand className="size-4 text-status-waiting" />} title={t('summaryAsk')}>
          {ask.map((rule) => (
            <li key={`${rule.category}:${rule.scope}`}>{phrase(rule)}</li>
          ))}
        </RuleList>
      )}
    </div>
  );
}

function RuleList({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {icon}
        {title}
      </p>
      <ul className="list-disc space-y-0.5 ps-9 text-sm marker:text-muted-foreground/50">
        {children}
      </ul>
    </div>
  );
}
