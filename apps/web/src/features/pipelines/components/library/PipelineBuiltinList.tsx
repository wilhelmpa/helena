'use client';

import { Fragment } from 'react';
import { ArrowRight, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useBuiltinPipelines, useCreatePipelineTemplate } from '@/services/pipelines.service';
import { useNewPipeline } from '../../hooks/useNewPipeline';
import { flowSummary } from '../../utils/flowSummary';
import { Button, Card, Grid, Inline, Pill, Section, Stack, Text } from '@/design-system';

// The templates Helena ships, as examples: what starts one, its steps in order, and the
// button that copies it into the library in the reader's language (owner, O25).
export default function PipelineBuiltinList({
  teamId,
  canCreate,
}: {
  teamId: number;
  canCreate: boolean;
}) {
  const t = useTranslations('pipelines.library');
  const tTriggers = useTranslations('pipelines.triggers');
  const builtins = useBuiltinPipelines(teamId);
  const create = useCreatePipelineTemplate(teamId);
  const { builtin } = useNewPipeline();
  if (!builtins.data?.length) return null;

  return (
    <Section title={t('builtins')} description={t('builtinsHint')}>
      <Grid columns={2}>
        {builtins.data.map((template) => {
          const input = builtin(template);
          const flow = flowSummary(input.definition);
          return (
            <Card
              key={template.key}
              title={<span dir="auto">{input.name}</span>}
              meta={t('startsWhen', {
                trigger: tTriggers(input.definition.trigger.type as 'manual'),
              })}
            >
              <Stack gap={3}>
                <Text size="sm" tone="muted" dir="auto">
                  {input.description}
                </Text>
                <Inline gap={1} wrap aria-label={t('stepsLabel')}>
                  {flow.names.map((name, index) => (
                    <Fragment key={`${name}-${index}`}>
                      {index > 0 && (
                        <Text tone="faint">
                          <ArrowRight size={12} aria-hidden="true" />
                        </Text>
                      )}
                      <Pill>{name}</Pill>
                    </Fragment>
                  ))}
                  {flow.more > 0 && <Pill>{t('moreSteps', { count: flow.more })}</Pill>}
                </Inline>
                {canCreate && (
                  <Inline>
                    <Button
                      size="small"
                      icon={<Plus size={14} />}
                      disabled={create.isPending}
                      onClick={() =>
                        create.mutate(input, {
                          onSuccess: (created) => toast.success(t('added', { name: created.name })),
                        })
                      }
                    >
                      {t('addToLibrary')}
                    </Button>
                  </Inline>
                )}
              </Stack>
            </Card>
          );
        })}
      </Grid>
    </Section>
  );
}
