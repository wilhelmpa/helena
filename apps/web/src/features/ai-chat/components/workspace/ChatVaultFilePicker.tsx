'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ChevronRight, File, Folder } from 'lucide-react';
import { listFiles, type FileScope } from '@/lib/api/endpoints/projectFiles';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { chatUploadScope, chatVaultPath } from '../../utils/chatVaultPaths';

// A small folder browser to attach a file already in the vault instead of uploading it
// again. Starts where a chat's attachments are allowed to come from: the project's own
// vault for a project chat, Home's for a Home chat (see resolveAttachments on the API).
export default function ChatVaultFilePicker({
  scopeKey,
  onClose,
  onPick,
}: {
  scopeKey: string;
  onClose: () => void;
  onPick: (path: string, name: string) => void;
}) {
  const t = useTranslations('chatWorkspace');
  const scope: FileScope = chatUploadScope(scopeKey);
  const [path, setPath] = useState('');
  const list = useQuery({
    queryKey: ['chatWorkspace', 'vaultBrowse', scopeKey, path],
    queryFn: () => listFiles(scope, path),
  });
  const crumbs = path ? path.split('/') : [];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="small">
        <DialogHeader>
          <DialogTitle>{t('composer.fromVault')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
          <button type="button" className="hover:underline" onClick={() => setPath('')}>
            {t('composer.vaultRoot')}
          </button>
          {crumbs.map((segment, index) => (
            <span key={index} className="flex items-center gap-1">
              <ChevronRight className="size-3.5 rtl:rotate-180" />
              <button
                type="button"
                className="hover:underline"
                onClick={() => setPath(crumbs.slice(0, index + 1).join('/'))}
              >
                {segment}
              </button>
            </span>
          ))}
        </div>
        <div className="max-h-80 space-y-0.5 overflow-y-auto">
          {list.isLoading &&
            Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-8 w-full" />
            ))}
          {list.data?.items.map((item) => (
            <Button
              key={item.path}
              type="button"
              variant="ghost"
              className="w-full justify-start gap-2 px-2"
              onClick={() =>
                item.kind === 'folder'
                  ? setPath(item.path)
                  : onPick(chatVaultPath(scopeKey, item.path), item.name)
              }
            >
              {item.kind === 'folder' ? (
                <Folder className="size-4 shrink-0 text-muted-foreground" />
              ) : (
                <File className="size-4 shrink-0 text-muted-foreground" />
              )}
              <span dir="auto" className="truncate">
                {item.name}
              </span>
            </Button>
          ))}
          {list.data?.items.length === 0 && (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              {t('composer.vaultEmpty')}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
