'use client';

import { useQuery } from '@tanstack/react-query';
import { Mail } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { getProjectMailAccount } from '@/lib/api/endpoints/connections';

export default function SettingsMailAccount({ projectKey }: { projectKey: string }) {
  const t = useTranslations('connections');
  const query = useQuery({
    queryKey: ['projects', projectKey, 'mail-account'],
    queryFn: () => getProjectMailAccount(projectKey),
  });

  if (!query.data && !query.isError) return null;

  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-base font-medium">
        <Mail className="size-4" /> {t('mail.title')}
      </h2>
      {query.isError ? (
        <p className="text-sm text-destructive">{t('loadError')}</p>
      ) : query.data ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{query.data.account}</p>
            <p className="text-xs text-muted-foreground">Gmail</p>
          </div>
          <div className="flex gap-2">
            <Badge variant="outline">{t('status.configured')}</Badge>
            <Badge variant={query.data.connectionStatus === 'connected' ? 'secondary' : 'outline'}>
              {t(`status.${query.data.connectionStatus}`)}
            </Badge>
          </div>
        </div>
      ) : null}
    </section>
  );
}
