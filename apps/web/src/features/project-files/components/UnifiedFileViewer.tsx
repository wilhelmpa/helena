import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import Modal, { useModalFullscreen } from '@/components/common/overlay/Modal';
import FileViewerContent from '@/components/common/files/FileViewerContent';
import type { ViewerFile } from '@/components/common/files/FileViewer';
import { Button } from '@/components/ui/button';
import WebLinkScope from '@/components/common/WebLinkScope';
import type { FileScope } from '@/lib/api/endpoints/projectFiles';
import SilverBulletFrame from './SilverBulletFrame';
import VaultTextEditor from './VaultTextEditor';
import FileReferences from './FileReferences';
import { vaultFilePath } from '../utils/vaultFilePath';

export default function UnifiedFileViewer({
  file,
  scope,
  path,
  notesUrl,
  canEdit,
  actions,
  onClose,
}: {
  file: ViewerFile;
  scope: FileScope;
  path: string;
  notesUrl: string;
  canEdit: boolean;
  actions: ReactNode;
  onClose: () => void;
}) {
  const t = useTranslations('files.unified');
  const fullscreen = useModalFullscreen();
  const editable =
    /\.(md|markdown|txt)$/i.test(file.name) && !(scope.kind === 'project' && scope.root === 'code');
  const [notes, setNotes] = useState(!!notesUrl && /\.md$/i.test(file.name));
  const [dirty, setDirty] = useState(false);
  const canLeave = () => !dirty || window.confirm(t('discard'));
  const leave = (action: () => void) => {
    if (canLeave()) action();
  };
  return (
    <WebLinkScope projectKey={scope.kind === 'project' ? scope.projectKey : null}>
      <Modal title={file.name} onClose={() => leave(onClose)} wide="xl" {...fullscreen}>
        <div
          className="contents"
          onClickCapture={(event) => {
            const anchor = (event.target as Element).closest('a[href^="/"]');
            if (anchor && !canLeave()) {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
        >
          <div className="flex flex-wrap items-center gap-1.5 pb-3">
            {actions}
            {notesUrl && (
              <Button
                size="sm"
                variant={notes ? 'default' : 'outline'}
                onClick={() => leave(() => setNotes(true))}
              >
                {t('silverBullet')}
              </Button>
            )}
            {(editable || notes) && (
              <Button
                size="sm"
                variant={!notes ? 'default' : 'outline'}
                onClick={() => setNotes(false)}
              >
                {editable ? t('editor') : t('preview')}
              </Button>
            )}
          </div>
          <FileReferences scope={scope} path={path} />
          {notes ? (
            <SilverBulletFrame url={notesUrl} />
          ) : editable ? (
            <VaultTextEditor
              key={vaultFilePath(scope, path) ?? path}
              scope={scope}
              path={path}
              canEdit={canEdit}
              onDirty={setDirty}
              vaultPath={vaultFilePath(scope, path) ?? undefined}
              beforeNavigate={canLeave}
            />
          ) : (
            <FileViewerContent file={file} />
          )}
        </div>
      </Modal>
    </WebLinkScope>
  );
}
