import { ArrowLeft, PanelRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { VaultDocument } from '@/lib/api/endpoints/knowledge';
import { Button } from '@/components/ui/button';
import type { NoteSaveStatus } from '../utils/noteDraft';
import DocumentBreadcrumbs from './DocumentBreadcrumbs';
import type { DocumentEditorDialog } from './DocumentEditorDialogs';
import DocumentOptionsMenu from './DocumentOptionsMenu';
import DocumentSaveStatus from './DocumentSaveStatus';

export default function DocumentEditorHeader({
  root,
  document,
  status,
  dirty,
  editable,
  inspectorOpen,
  onBack,
  onRetrySave,
  onToggleInspector,
  onOpenDialog,
}: {
  root: string;
  document: VaultDocument;
  status: NoteSaveStatus;
  dirty: boolean;
  editable: boolean;
  inspectorOpen: boolean;
  onBack: () => void;
  onRetrySave: () => void;
  onToggleInspector: () => void;
  onOpenDialog: (dialog: DocumentEditorDialog) => void;
}) {
  const t = useTranslations('documents');
  const inspectorLabel = inspectorOpen ? t('closeDetails') : t('openDetails');

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-background/90 px-2.5 backdrop-blur-md md:px-4">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="shrink-0 md:hidden"
        aria-label={t('backToDocuments')}
        onClick={onBack}
      >
        <ArrowLeft className="rtl:rotate-180" />
      </Button>

      <DocumentBreadcrumbs root={root} path={document.path} />

      <div className="ms-auto flex shrink-0 items-center gap-0.5">
        <DocumentSaveStatus
          status={status}
          dirty={dirty}
          editable={editable}
          onRetry={onRetrySave}
        />
        <Button
          type="button"
          variant={inspectorOpen ? 'secondary' : 'ghost'}
          size="icon-sm"
          aria-label={inspectorLabel}
          aria-pressed={inspectorOpen}
          title={inspectorLabel}
          onClick={onToggleInspector}
        >
          <PanelRight />
        </Button>
        <DocumentOptionsMenu document={document} canEdit={editable} onOpenDialog={onOpenDialog} />
      </div>
    </header>
  );
}
