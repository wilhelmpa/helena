import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useFileDragZone } from '@/hooks/useFileDragZone';
import type { FileScope } from '@/lib/api/endpoints/projectFiles';
import { baseName } from '@/utils/vaultLinks';
import { useMoveFile, useUploadFiles } from '../services/projectFiles.service';
import { moveTarget } from '../utils/fileDrag';
import { useFileEntryDrag } from './useFileEntryDrag';

// What arrives in the open folder by dragging: files from the computer are uploaded
// into it, and entries dropped on a folder move there.
export function useFileTransfers({
  scope,
  folder,
  rootLabel,
  canUpload,
  canMove,
}: {
  scope: FileScope;
  folder: string;
  rootLabel: string;
  canUpload: boolean;
  canMove: boolean;
}) {
  const t = useTranslations('files');
  const upload = useUploadFiles(scope);
  const move = useMoveFile(scope);

  const drag = useFileEntryDrag(canMove, (entry, target) => {
    const to = moveTarget(entry, target);
    if (!to) return;
    move.mutate(
      { from: entry, to },
      {
        onSuccess: () =>
          toast.success(t('moved', { folder: target ? baseName(target) : rootLabel })),
      },
    );
  });

  const sendFiles = (files: File[]) => {
    if (!canUpload || files.length === 0) return;
    upload.mutate(
      { folder, files },
      { onSuccess: (created) => toast.success(t('uploaded', { count: created.length })) },
    );
  };
  const zone = useFileDragZone((files) => sendFiles(Array.from(files)));

  return {
    drag,
    sendFiles,
    uploading: upload.isPending,
    draggedFiles: zone.draggedFiles,
    dropHandlers: canUpload ? zone.dragHandlers : {},
  };
}
