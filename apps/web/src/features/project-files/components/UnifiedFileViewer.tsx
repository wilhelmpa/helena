import { useCallback, useState, type ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import FileViewerContent from '@/components/common/files/FileViewerContent';
import type { ViewerFile } from '@/components/common/files/FileViewer';
import WebLinkScope from '@/components/common/WebLinkScope';
import type { FileScope } from '@/lib/api/endpoints/projectFiles';
import VaultTextEditor from './VaultTextEditor';
import FileReferences from './FileReferences';
import { vaultFilePath } from '../utils/vaultFilePath';

export default function UnifiedFileViewer({
  file,
  scope,
  path,
  canEdit,
  actions,
  onClose,
  onDirty,
  sourceOnly = false,
}: {
  file: ViewerFile;
  scope: FileScope;
  path: string;
  canEdit: boolean;
  actions: ReactNode;
  onClose: () => void;
  onDirty?: (dirty: boolean) => void;
  sourceOnly?: boolean;
}) {
  const t = useTranslations('files.unified');
  const files = useTranslations('files');
  const editable =
    /\.(md|markdown|txt)$/i.test(file.name) && !(scope.kind === 'project' && scope.root === 'code');
  const markdownSource = sourceOnly && /\.md$/i.test(file.name) && !!vaultFilePath(scope, path);
  const [dirty, setDirty] = useState(false);
  const reportDirty = useCallback(
    (value: boolean) => {
      setDirty(value);
      onDirty?.(value);
    },
    [onDirty],
  );
  const canLeave = () => !dirty || window.confirm(t('discard'));
  const leave = (action: () => void) => {
    if (canLeave()) action();
  };
  return (
    <WebLinkScope projectKey={scope.kind === 'project' ? scope.projectKey : null}>
      <section
        data-file-preview
        aria-label={file.name}
        className="flex min-h-0 min-w-0 flex-1 flex-col gap-3"
      >
        <div
          className="flex min-h-0 flex-1 flex-col gap-3"
          onClickCapture={(event) => {
            const anchor = (event.target as Element).closest('a[href^="/"]');
            if (anchor && !canLeave()) {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
        >
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b pb-3">
            <Button variant="outline" size="sm" onClick={() => leave(onClose)}>
              <ArrowLeft className="size-4 rtl:rotate-180" />
              {files('actions.showInFolder')}
            </Button>
            <h2 className="min-w-0 flex-1 font-medium break-words" dir="auto">
              {file.name}
            </h2>
            {!markdownSource && actions}
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
            {!markdownSource && <FileReferences scope={scope} path={path} />}
            {editable ? (
              <VaultTextEditor
                key={vaultFilePath(scope, path) ?? path}
                scope={scope}
                path={path}
                canEdit={canEdit}
                onDirty={reportDirty}
                vaultPath={vaultFilePath(scope, path) ?? undefined}
                beforeNavigate={canLeave}
                sourceOnly={markdownSource}
              />
            ) : (
              <FileViewerContent file={file} />
            )}
          </div>
        </div>
      </section>
    </WebLinkScope>
  );
}
