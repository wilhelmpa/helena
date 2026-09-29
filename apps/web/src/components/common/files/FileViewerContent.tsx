import { fileViewKind } from '@/utils/fileKinds';
import FileViewerFallback from './FileViewerFallback';
import FileViewerImage from './FileViewerImage';
import FileViewerOffice from './FileViewerOffice';
import FileViewerTable from './FileViewerTable';
import FileViewerText from './FileViewerText';
import type { ViewerFile } from './FileViewer';

// The body of the viewer for one kind of file.
export default function FileViewerContent({ file }: { file: ViewerFile }) {
  switch (fileViewKind(file.name, file.contentType)) {
    case 'pdf':
      // The browser's own PDF viewer; the api serves a PDF inline and unsandboxed.
      return <iframe src={file.url} title={file.name} className="ds-file-embed" />;
    case 'image':
      return <FileViewerImage url={file.url} name={file.name} />;
    case 'audio':
      return <audio src={file.url} controls className="ds-file-media" />;
    case 'video':
      return <video src={file.url} controls className="ds-file-media" />;
    case 'markdown':
    case 'text':
      return <FileViewerText url={file.url} name={file.name} sizeBytes={file.sizeBytes} />;
    case 'table':
      return <FileViewerTable url={file.url} name={file.name} sizeBytes={file.sizeBytes} />;
    case 'office':
      return <FileViewerOffice file={file} />;
    default:
      return (
        <FileViewerFallback
          name={file.name}
          contentType={file.contentType}
          sizeBytes={file.sizeBytes}
          url={file.url}
        />
      );
  }
}
