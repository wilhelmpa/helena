'use client';

import { CheckCircle2, CircleAlert, Clock3, ServerCog } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { useProjectProvisioningQuery } from '@/services/projects.service';

export default function OrganizationProjectResources({ projectKey }: { projectKey: string }) {
  const t = useTranslations('organization.resources');
  const provisioning = useProjectProvisioningQuery(projectKey);

  if (provisioning.isPending) {
    return <p className="mb-4 text-sm text-muted-foreground">{t('loading')}</p>;
  }
  if (provisioning.isError) {
    return (
      <p className="mb-4 rounded-lg border border-destructive/40 p-3 text-sm text-destructive">
        {t('unavailable')}
      </p>
    );
  }

  const job = provisioning.data;
  const provisioned = new Set(job.result?.resources.map((resource) => resource.kind) ?? []);
  const Icon =
    job.status === 'succeeded' ? CheckCircle2 : job.status === 'failed' ? CircleAlert : Clock3;

  return (
    <section className="mb-4 rounded-lg border bg-muted/20 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <ServerCog className="size-4 text-muted-foreground" /> {t('title')}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">{t('description')}</p>
        </div>
        <Badge variant="outline" className="gap-1">
          <Icon className="size-3.5" /> {t(`status.${job.status}`)}
        </Badge>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {job.requestedResources.map((resource) => (
          <Badge key={resource} variant={provisioned.has(resource) ? 'secondary' : 'outline'}>
            {resource}
          </Badge>
        ))}
      </div>
      {job.result?.warnings?.map((warning) => (
        <p key={warning} className="mt-2 text-xs text-amber-700 dark:text-amber-400">
          {warning}
        </p>
      ))}
      {job.lastError ? <p className="mt-2 text-xs text-destructive">{job.lastError}</p> : null}
    </section>
  );
}
