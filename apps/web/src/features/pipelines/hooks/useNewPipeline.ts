'use client';

import { useTranslations } from 'next-intl';
import type { BuiltinPipeline, PipelineInput } from '@/lib/api/endpoints/pipelines';
import { byKey } from '@/utils/messageKey';
import { localizeDefinition, starterDefinition } from '../utils/editorState';

// What a new workflow is created from, in the reader's language: the starter with one
// agent step, or a built-in template with its names translated.
export function useNewPipeline() {
  const t = useTranslations('pipelines');
  const text = byKey(t);
  const lookup = (key: string) =>
    t.has(key as Parameters<typeof t.has>[0]) ? text(key) : null;

  const starter = (name: string): PipelineInput => ({
    name,
    description: '',
    definition: starterDefinition({
      role: t('starter.role'),
      step: t('starter.step'),
      instruction: t('starter.instruction', {
        identifier: '{{task.identifier}}',
        title: '{{task.title}}',
        description: '{{task.description}}',
      }),
    }),
  });

  const builtin = (template: BuiltinPipeline): PipelineInput => {
    const prefix = `builtin.${template.key}`;
    return {
      name: lookup(`${prefix}.name`) ?? template.name,
      description: lookup(`${prefix}.description`) ?? template.description,
      definition: localizeDefinition(template.definition, {
        step: (id) => lookup(`${prefix}.steps.${id}`),
        role: (key) => lookup(`${prefix}.roles.${key}`),
      }),
    };
  };

  return { starter, builtin };
}
