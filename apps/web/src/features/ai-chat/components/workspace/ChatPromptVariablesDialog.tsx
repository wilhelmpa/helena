'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ChatPrompt } from '@/lib/api/endpoints/chatPrompts';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { promptVariables } from '../../utils/promptVariables';

// A saved prompt's `{{variables}}`, filled in before it lands in the composer. A
// variable left blank keeps its marker, so the member sees in the composer what is
// still missing rather than having it silently vanish.
export default function ChatPromptVariablesDialog({
  prompt,
  onClose,
  onConfirm,
}: {
  prompt: ChatPrompt;
  onClose: () => void;
  onConfirm: (values: Record<string, string>) => void;
}) {
  const t = useTranslations('chatWorkspace');
  const tCommon = useTranslations('common');
  const variables = promptVariables(prompt.content);
  const [values, setValues] = useState<Record<string, string>>({});

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{prompt.title}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            onConfirm(values);
          }}
        >
          {variables.map((name, index) => (
            <Field key={name}>
              <FieldLabel htmlFor={`prompt-var-${name}`}>{name}</FieldLabel>
              <Input
                id={`prompt-var-${name}`}
                dir="auto"
                autoFocus={index === 0}
                value={values[name] ?? ''}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [name]: event.target.value }))
                }
              />
            </Field>
          ))}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {tCommon('cancel')}
            </Button>
            <Button type="submit">{t('composer.insertPrompt')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
