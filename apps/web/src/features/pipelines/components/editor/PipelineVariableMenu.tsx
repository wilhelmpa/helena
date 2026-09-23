'use client';

import { Braces } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { byKey } from '@/utils/messageKey';
import { usePipelineEditor } from '../../context/pipelineEditor';
import { variablesAt } from '../../utils/variables';

// The variables valid in the step's texts: the task, the previous step's result once
// there is one, and each earlier step that leaves a result.
export default function PipelineVariableMenu({
  stepId,
  onInsert,
}: {
  stepId: string;
  onInsert: (variable: string) => void;
}) {
  const t = useTranslations('pipelines.inspector');
  const label = byKey(t);
  const { definition } = usePipelineEditor();
  const variables = variablesAt(definition.steps, stepId);
  const item = (variable: string) => (
    <DropdownMenuItem key={variable} onSelect={() => onInsert(variable)}>
      <span>{label(`variables.${variable.split('.').pop()}`)}</span>
      <code className="ms-auto text-xs text-muted-foreground" dir="ltr">
        {`{{${variable}}}`}
      </code>
    </DropdownMenuItem>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-muted-foreground">
          <Braces /> {t('insertVariable')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-72"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <DropdownMenuLabel>{t('variableGroups.task')}</DropdownMenuLabel>
        {variables.task.map(item)}
        {variables.previous.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t('variableGroups.previous')}</DropdownMenuLabel>
            {variables.previous.map(item)}
          </>
        )}
        {variables.steps.length > 0 && <DropdownMenuSeparator />}
        {variables.steps.map((step) => (
          <DropdownMenuSub key={step.id}>
            <DropdownMenuSubTrigger>
              <span className="truncate" dir="auto">
                {t('variableGroups.step', { name: step.name })}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-72">
              {step.variables.map(item)}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
