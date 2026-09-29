import { PlugZap } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { EmptyState } from '@/design-system';

// A tool this instance has no address for: the same view as a tool that does not answer
// (EmbedProblem), without the ways to retry.
export default function WorkspaceUnavailable({ tool }: { tool: string }) {
  const t = useTranslations('nav.workspace');
  return (
    <div className="ds-embed-problem">
      <EmptyState icon={<PlugZap />} title={t('unavailable', { tool })}>
        {t('unavailableDescription')}
      </EmptyState>
    </div>
  );
}
