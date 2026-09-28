import type { ReactNode } from 'react';
import { Overlay } from '@/design-system/layout/Overlay';
import { formatSize } from '@/utils/fileSize';
import FileViewerContent from './FileViewerContent';

export interface ViewerFile {
  name: string;
  contentType: string | null;
  sizeBytes: number | null;
  // Opens the file in the page.
  url: string;
  // Where the file is in the vault, for the extracted text; null outside the vault.
  vaultPath: string | null;
}

// Looks at a file without leaving the page, in the one overlay on the right (owner 28.09.:
// a file preview opens like a task or a run): a PDF in the browser's viewer, images with
// zoom, audio and video, text highlighted, an office file's extracted text. `actions` are
// the buttons the caller offers for it (download, open elsewhere, link).
export default function FileViewer({
  file,
  actions,
  onClose,
}: {
  file: ViewerFile;
  actions: ReactNode;
  onClose: () => void;
}) {
  return (
    <Overlay
      label={file.name}
      tabs={[{ id: 'file', label: file.name }]}
      onClose={onClose}
      closeOnOutsideClick
      className="ds-file-overlay"
    >
      <div className="ds-file-preview">
        <div className="ds-file-preview-bar">
          {file.sizeBytes !== null && (
            <span className="ds-file-preview-size">{formatSize(file.sizeBytes)}</span>
          )}
          <span className="ds-file-preview-actions">{actions}</span>
        </div>
        <div className="ds-file-preview-body">
          <FileViewerContent file={file} />
        </div>
      </div>
    </Overlay>
  );
}
