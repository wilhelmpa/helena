'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { File } from 'lucide-react';
import { listAttachableKnowledge } from '@/lib/api/endpoints/everything';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';

// Minimal composer integration for the server's searchable knowledge picker. Claude's
// design-system work owns the final appearance and localized subtype labels.
export default function ChatVaultFilePicker({
  scopeKey,
  onClose,
  onPick,
}: {
  scopeKey: string;
  onClose: () => void;
  onPick: (ref: string, title: string, source: string, href: string) => void;
}) {
  const t = useTranslations('chatWorkspace');
  const tSource = useTranslations('knowledge.source');
  const tPicker = useTranslations('knowledge.picker');
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('');
  const list = useQuery({
    queryKey: ['chatWorkspace', 'knowledgePicker', scopeKey, search, kind],
    queryFn: ({ signal }) =>
      listAttachableKnowledge(search, { kind: kind || undefined, limit: 50 }, signal),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="small">
        <DialogHeader>
          <DialogTitle>{t('composer.attach')}</DialogTitle>
        </DialogHeader>
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label={tPicker('search')}
          placeholder={tPicker('search')}
        />
        <select
          value={kind}
          onChange={(event) => setKind(event.target.value)}
          aria-label={tPicker('kind')}
        >
          <option value="">{tPicker('all')}</option>
          {(
            [
              'vault',
              'canvas',
              'issue',
              'goal',
              'initiative',
              'receipt',
              'mail',
              'chat',
              'comment',
              'run',
            ] as const
          ).map((kind) => (
            <option key={kind} value={kind}>
              {kind === 'canvas' ? tSource('board') : tSource(kind)}
            </option>
          ))}
          <option value="file">{tPicker('file')}</option>
          <option value="doc">{tPicker('doc')}</option>
          <option value="journal">{tPicker('journal')}</option>
          <option value="template">{tPicker('template')}</option>
          <option value="note">{tPicker('note')}</option>
          <option value="image">{tPicker('image')}</option>
          <option value="browser_image">{tPicker('browserImage')}</option>
          <option value="chat_file">{tPicker('chatFile')}</option>
        </select>
        <div className="max-h-80 space-y-0.5 overflow-y-auto">
          {list.isLoading &&
            Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-8 w-full" />
            ))}
          {list.data?.items.map((item) => (
            <Button
              key={item.ref}
              type="button"
              variant="ghost"
              className="w-full justify-start gap-2 px-2"
              onClick={() => onPick(item.ref, item.title, item.source, item.href)}
            >
              <File className="size-4 shrink-0 text-muted-foreground" />
              <span dir="auto" className="truncate">
                {item.title}
              </span>
            </Button>
          ))}
          {list.data?.items.length === 0 && (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              {t('composer.vaultEmpty')}
            </p>
          )}
          {list.isError && <p role="alert">{tPicker('unavailable')}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
