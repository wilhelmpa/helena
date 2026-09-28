'use client';

import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { SectionLabel } from '@/components/common/page/RowList';
import { Button } from '@/components/ui/button';
import { useBuiltinPipelines, useCreatePipelineTemplate } from '@/services/pipelines.service';
import { useNewPipeline } from '../../hooks/useNewPipeline';

// The templates Helena ships. Adding one copies it into the library with its names in
// the reader's language.
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
    <section className="min-w-0">
      <SectionLabel>{t('builtins')}</SectionLabel>
      <ul className="grid gap-2 md:grid-cols-2">
        {builtins.data.map((template) => {
          const input = builtin(template);
          return (
            <li
              key={template.key}
              className="flex flex-col gap-1.5 rounded-md border bg-card px-3 py-2.5"
            >
              <p className="text-md font-medium" dir="auto">
                {input.name}
              </p>
              <p className="flex-1 text-sm text-muted-foreground" dir="auto">
                {input.description}
              </p>
              {canCreate && (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-1 self-start"
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
