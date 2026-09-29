import {
  File,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
} from 'lucide-react';
import { fileViewKind } from '@/utils/fileKinds';
import { folderIcon } from '@/utils/knowledgeFolders';
import { cn } from '@/lib/utils';

const ICONS = {
  pdf: FileText,
  image: FileImage,
  audio: FileAudio,
  video: FileVideo,
  markdown: FileText,
  text: FileCode,
  office: FileSpreadsheet,
  other: File,
} as const;

export default function FileKindIcon({
  name,
  contentType,
  folder,
  folderPath,
  className,
}: {
  name: string;
  contentType?: string | null;
  folder?: boolean;
  // A folder of a project's Wissen (relative to the project): Helena's own folders show
  // their symbol, a person's the normal folder.
  folderPath?: string;
  className?: string;
}) {
  if (folder) {
    const Icon = folderIcon(folderPath ?? name, folderPath !== undefined);
    return <Icon className={cn('text-muted-foreground', className)} />;
  }
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
