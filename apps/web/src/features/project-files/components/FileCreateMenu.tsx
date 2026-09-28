import { useRef } from 'react';
import { useRouter } from 'next/navigation';
import { FilePlus, FolderPlus, Plus, StickyNote, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { PAGE_CONTROL_CLASS, PAGE_PRIMARY_CLASS } from '@/components/layout/PageToolbar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { notesPath } from '@/utils/paths';

export default function FileCreateMenu({
  onNewFile,
  onNewFolder,
  onUpload,
  projectKey,
  uploading,
}: {
  onNewFile: () => void;
  onNewFolder: () => void;
  onUpload: (files: File[]) => void;
  projectKey?: string | null;
  uploading: boolean;
}) {
  const t = useTranslations('files.toolbar');
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={cn(PAGE_CONTROL_CLASS, PAGE_PRIMARY_CLASS)}>
            <Plus /> {'Neu'}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onNewFile}>
            <FilePlus /> {'Doc'}
          </DropdownMenuItem>
          {projectKey && (
            <DropdownMenuItem
              onSelect={() => router.push(`${notesPath(projectKey)}&create=canvas`)}
            >
              <StickyNote /> {'Leinwand'}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={onNewFolder}>
            <FolderPlus /> {t('newFolder')}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={uploading} onSelect={() => input.current?.click()}>
            <Upload /> {t('upload')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        ref={input}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          onUpload(Array.from(event.target.files ?? []));
          event.target.value = '';
        }}
      />
    </>
  );
}
