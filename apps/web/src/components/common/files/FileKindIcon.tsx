import {
  File,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
} from 'lucide-react';
import { fileViewKind } from '@/utils/fileKinds';
import { cn } from '@/lib/utils';

const ICONS = {
  pdf: FileText,
  image: FileImage,
  audio: FileAudio,
  video: FileVideo,
  markdown: FileText,
  text: FileCode,
  table: FileSpreadsheet,
  office: FileSpreadsheet,
  other: File,
} as const;

export default function FileKindIcon({
  name,
  contentType,
  folder,
  className,
}: {
  name: string;
  contentType?: string | null;
  folder?: boolean;
  className?: string;
}) {
  if (folder) return <Folder className={cn('text-amber-500', className)} />;
  const kind = fileViewKind(name, contentType);
  const Icon = ICONS[kind];
  return (
    <Icon
      className={cn(
        kind === 'pdf'
          ? 'text-red-500'
          : kind === 'markdown'
            ? 'text-blue-500'
            : 'text-muted-foreground',
        className,
      )}
    />
  );
}
