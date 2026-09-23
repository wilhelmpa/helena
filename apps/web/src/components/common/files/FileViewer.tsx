import type { ReactNode } from 'react';
import Modal, { useModalFullscreen } from '@/components/common/overlay/Modal';
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

// Looks at a file without leaving the page: a PDF in the browser's viewer, images with
// zoom, audio and video, text highlighted, an office file's extracted text. `actions`
// are the buttons the caller offers for it (download, open elsewhere, link).
export default function FileViewer({
  file,
  actions,
  onClose,
}: {
  file: ViewerFile;
  actions: ReactNode;
  onClose: () => void;
}) {
  const fullscreen = useModalFullscreen();
  return (
    <Modal
      title={file.name}
      description={file.sizeBytes !== null ? formatSize(file.sizeBytes) : undefined}
      onClose={onClose}
      wide="xl"
      {...fullscreen}
    >
      <div className="flex flex-wrap items-center gap-1.5 pb-3">{actions}</div>
      <div className="flex min-h-0 flex-1 flex-col">
        <FileViewerContent file={file} />
      </div>
    </Modal>
  );
}
