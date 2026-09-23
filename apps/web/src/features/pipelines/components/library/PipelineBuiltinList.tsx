'use client';

import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useBuiltinPipelines, useCreatePipelineTemplate } from '@/services/pipelines.service';
import { useNewPipeline } from '../../hooks/useNewPipeline';

// The templates Plan ships. Adding one copies it into the library with its names in the
// reader's language.
export default function PipelineBuiltinList({
  teamId,
  canCreate,
}: {
  teamId: number;
  canCreate: boolean;
}) {
  const t = useTranslations('pipelines.library');
  const builtins = useBuiltinPipelines(teamId);
  const create = useCreatePipelineTemplate(teamId);
  const { builtin } = useNewPipeline();
  if (!builtins.data?.length) return null;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">{t('builtins')}</h2>
        <p className="text-xs text-muted-foreground">{t('builtinsHint')}</p>
      </div>
      <ul className="grid gap-3 md:grid-cols-2">
        {builtins.data.map((template) => {
          const input = builtin(template);
          return (
            <li key={template.key} className="flex flex-col gap-2 rounded-lg border bg-card p-3">
              <p className="font-medium">{input.name}</p>
              <p className="flex-1 text-sm text-muted-foreground">{input.description}</p>
              {canCreate && (
                <Button
                  size="sm"
                  variant="outline"
                  className="self-start"
                  disabled={create.isPending}
                  onClick={() =>
                    create.mutate(input, {
                      onSuccess: (created) => toast.success(t('added', { name: created.name })),
                    })
                  }
                >
                  <Plus /> {t('addToLibrary')}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
