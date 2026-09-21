import { PlugZap } from 'lucide-react';
import { useTranslations } from 'next-intl';

export default function WorkspaceUnavailable({ tool }: { tool: string }) {
  const t = useTranslations('nav.workspace');
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-8">
      <div className="max-w-sm text-center">
        <PlugZap className="mx-auto mb-3 size-8 text-muted-foreground" />
        <p className="text-sm font-medium">{t('unavailable', { tool })}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t('unavailableDescription')}</p>
      </div>
    </div>
  );
}
