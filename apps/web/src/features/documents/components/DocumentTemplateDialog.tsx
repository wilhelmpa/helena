'use client';

import { useRef, useState, type FormEvent } from 'react';
import { LayoutTemplate } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Modal from '@/components/common/overlay/Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  useCreateFromTemplateMutation,
  useNoteTemplatesQuery,
} from '@/services/everything.service';

// A new note from one of the templates in Templates/ (Tagesnotiz, Meeting, Entscheidung,
// Recherche, Projektbrief and the owner's own), with its {{title}} and {{date}} filled
// in, the way Obsidian's Templates plugin does it.
export default function DocumentTemplateDialog({
  folder,
  onCreated,
  onClose,
}: {
  folder: string;
  onCreated: (path: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations('knowledge.templates');
  const templates = useNoteTemplatesQuery();
  const create = useCreateFromTemplateMutation();
  const [template, setTemplate] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const chosen = template ?? templates.data?.[0]?.path ?? null;
  const trimmed = title.trim();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!chosen || !trimmed) return;
    create.mutate(
      { template: chosen, folder, title: trimmed },
      {
        onSuccess: (created) => {
          onClose();
          onCreated(created.path);
        },
      },
    );
  };

  const nameField = useRef<HTMLInputElement>(null);

  return (
    <Modal
      title={t('title')}
      onClose={onClose}
      // The name field is what the dialog is for; the template list comes before it.
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        nameField.current?.focus();
      }}
    >
      <form onSubmit={submit} className="space-y-4">
        {templates.isPending ? (
          <div className="space-y-1.5" aria-hidden>
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-4/5" />
          </div>
        ) : templates.data && templates.data.length > 0 ? (
          <ul className="space-y-px" role="radiogroup" aria-label={t('choose')}>
            {templates.data.map((item) => (
              <li key={item.path}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={chosen === item.path}
                  onClick={() => setTemplate(item.path)}
                  className={cn(
                    'flex h-8 w-full items-center gap-2 rounded-md px-2 text-start text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                    chosen === item.path && 'bg-accent',
                  )}
                >
                  <LayoutTemplate className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate" dir="auto">
                    {item.name}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t('none')}</p>
        )}
        <Input
          ref={nameField}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={t('namePlaceholder')}
          aria-label={t('name')}
          dir="auto"
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="submit" disabled={!chosen || !trimmed || create.isPending}>
            {t('create')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
