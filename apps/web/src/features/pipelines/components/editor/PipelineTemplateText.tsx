'use client';

import { useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { DefinitionIssue } from '@/lib/api/endpoints/pipelines';
import { insertVariable } from '../../utils/variables';
import PipelineField from './PipelineField';
import PipelineVariableMenu from './PipelineVariableMenu';

// A step text that may hold {{…}} variables, with a menu that puts one in at the caret.
export default function PipelineTemplateText({
  id,
  label,
  stepId,
  value,
  maxLength,
  rows = 4,
  singleLine = false,
  placeholder,
  issues,
  onChange,
}: {
  id: string;
  label: string;
  stepId: string;
  value: string;
  maxLength: number;
  rows?: number;
  singleLine?: boolean;
  placeholder?: string;
  issues: DefinitionIssue[];
  onChange: (value: string) => void;
}) {
  const field = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  const insert = (variable: string) => {
    const element = field.current;
    const selection = {
      start: element?.selectionStart ?? value.length,
      end: element?.selectionEnd ?? value.length,
    };
    const next = insertVariable(value, variable, selection);
    onChange(next.text);
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(next.caret, next.caret);
    });
  };
  const shared = {
    id,
    ref: field,
    value,
    maxLength,
    placeholder,
    dir: 'auto' as const,
    onChange: (event: { target: { value: string } }) => onChange(event.target.value),
  };

  return (
    <PipelineField
      label={label}
      htmlFor={id}
      issues={issues}
      action={<PipelineVariableMenu stepId={stepId} onInsert={insert} />}
    >
      {singleLine ? <Input {...shared} /> : <Textarea {...shared} rows={rows} />}
    </PipelineField>
  );
}
