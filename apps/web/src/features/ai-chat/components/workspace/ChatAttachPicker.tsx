'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { FolderOpen, Paperclip, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import ChatVaultFilePicker from './ChatVaultFilePicker';

// Attaching a file: upload one from the device, straight into the vault's Chat
// Uploads folder, or point at a file already in the vault instead of uploading it
// again.
export default function ChatAttachPicker({
  scopeKey,
  onUpload,
  onPickVaultFile,
}: {
  scopeKey: string;
  onUpload: () => void;
  onPickVaultFile: (path: string, name: string) => void;
}) {
  const t = useTranslations('chatWorkspace');
  const [vaultOpen, setVaultOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon" aria-label={t('composer.attach')}>
            <Paperclip className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={onUpload}>
            <Upload className="size-4" /> {t('composer.uploadFile')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setVaultOpen(true)}>
            <FolderOpen className="size-4" /> {t('composer.fromVault')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {vaultOpen && (
        <ChatVaultFilePicker
          scopeKey={scopeKey}
          onClose={() => setVaultOpen(false)}
          onPick={(path, name) => {
            onPickVaultFile(path, name);
            setVaultOpen(false);
          }}
        />
      )}
    </>
  );
}
