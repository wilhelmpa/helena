'use client';

import { useTranslations } from 'next-intl';

// While the address is asked, before anything shows: a quiet line that appears only when
// it takes a moment.
export function EmbedConnecting({ tool }: { tool: string }) {
  const t = useTranslations('nav.workspace.frameProblem');
  return (
    <div className="ds-embed-connecting" role="status">
      {t('connecting', { tool })}
    </div>
  );
}
