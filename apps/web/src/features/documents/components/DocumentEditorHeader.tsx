import { ArrowLeft, PanelRight } from 'lucide-react';
import type { VaultDocument } from '@/lib/api/endpoints/knowledge';
import { cn } from '@/lib/utils';
import { PAGE_CONTROL_CLASS } from '@/components/layout/PageToolbar';
import type { NoteSaveStatus } from '../utils/noteDraft';
import DocumentBreadcrumbs from './DocumentBreadcrumbs';
import type { DocumentEditorDialog } from './DocumentEditorDialogs';
import DocumentOptionsMenu from './DocumentOptionsMenu';
import DocumentSaveStatus from './DocumentSaveStatus';
import type { NoteToolbarParts } from './DocumentsToolbar';

// The open note's parts of the Docs header row: on a phone a back arrow to the tree,
// the breadcrumbs, the save state, the details panel toggle and the note's menu.
export function noteToolbarParts({
  root,
  document,
  status,
  dirty,
  editable,
  inspectorOpen,
  labels,
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
  labels: { back: string; openDetails: string; closeDetails: string };
  onBack: () => void;
  onRetrySave: () => void;
  onToggleInspector: () => void;
  onOpenDialog: (dialog: DocumentEditorDialog) => void;
}): NoteToolbarParts {
  return {
    lead: (
      <>
        <button
          type="button"
          aria-label={labels.back}
          onClick={onBack}
          className={cn(PAGE_CONTROL_CLASS, 'w-8 justify-center px-0 md:hidden')}
        >
          <ArrowLeft className="rtl:rotate-180" aria-hidden="true" />
        </button>
        <DocumentBreadcrumbs root={root} path={document.path} />
      </>
    ),
    status: (
      <DocumentSaveStatus status={status} dirty={dirty} editable={editable} onRetry={onRetrySave} />
    ),
    actions: [
      {
        id: 'details',
        label: inspectorOpen ? labels.closeDetails : labels.openDetails,
        icon: PanelRight,
        onClick: onToggleInspector,
      },
    ],
    menu: (
      <DocumentOptionsMenu document={document} canEdit={editable} onOpenDialog={onOpenDialog} />
    ),
  };
}
