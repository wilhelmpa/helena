'use client';

import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { SectionLabel } from '@/components/common/page/RowList';
import { Button } from '@/components/ui/button';
import { useBuiltinPipelines, useCreatePipelineTemplate } from '@/services/pipelines.service';
import { useNewPipeline } from '../../hooks/useNewPipeline';
import { Stack, Text } from '@/design-system';

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
            <Stack
              as="li"
              gap={2}
              padX={3}
              padY={3}
              key={template.key}
              className="rounded-md border bg-card"
            >
              <Text as="p" size="md" className="font-medium" dir="auto">
                {input.name}
              </Text>
              <Text as="p" size="sm" tone="muted" className="flex-1" dir="auto">
                {input.description}
              </Text>
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
            </Stack>
          );
        })}
      </ul>
    </section>
  );
}
