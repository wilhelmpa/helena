import { useTranslations } from 'next-intl';
import { fileViewKind } from '@/utils/fileKinds';
import FileViewerImage from './FileViewerImage';
import FileViewerOffice from './FileViewerOffice';
import FileViewerText from './FileViewerText';
import type { ViewerFile } from './FileViewer';

// The body of the viewer for one kind of file.
export default function FileViewerContent({ file }: { file: ViewerFile }) {
  const t = useTranslations('files.viewer');
  switch (fileViewKind(file.name, file.contentType)) {
    case 'pdf':
      // The browser's own PDF viewer; the api serves a PDF inline and unsandboxed.
      return (
        <iframe
          src={file.url}
          title={file.name}
          className="min-h-[70vh] w-full flex-1 rounded-md border"
        />
      );
    case 'image':
      return <FileViewerImage url={file.url} name={file.name} />;
    case 'audio':
      return <audio src={file.url} controls className="w-full" />;
    case 'video':
      return <video src={file.url} controls className="max-h-[70vh] w-full rounded-md" />;
    case 'markdown':
    case 'text':
      return <FileViewerText url={file.url} name={file.name} sizeBytes={file.sizeBytes} />;
    case 'office':
      return <FileViewerOffice vaultPath={file.vaultPath} />;
    default:
      return <p className="text-sm text-muted-foreground">{t('noPreview')}</p>;
  }
}
