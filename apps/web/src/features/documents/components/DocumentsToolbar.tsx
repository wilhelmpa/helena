'use client';

import type { ReactNode } from 'react';
import {
  PageActions,
  PageToolbar,
  PageToolbarSpacer,
  type PageAction,
} from '@/components/layout/PageToolbar';

// What the open note adds to the Docs header row: where it is (breadcrumbs), whether
// it is saved, its own actions (details panel) and its options menu.
export type NoteToolbarParts = {
  lead: ReactNode;
  status: ReactNode;
  actions: PageAction[];
  menu: ReactNode;
};

// The one header row of the Docs page (PageToolbar, docs/volition/ui-standard.md): the
// open note's breadcrumbs and save state, then the note's and the tree's actions, and
// "Neue Notiz" as the page's one primary action.
export default function DocumentsToolbar({
  note,
  actions,
  primary,
}: {
  note?: NoteToolbarParts;
  actions: PageAction[];
  primary?: Omit<PageAction, 'menuOnly'>;
}) {
  return (
    <PageToolbar>
      {note?.lead}
      <PageToolbarSpacer />
      {note?.status}
      <PageActions actions={[...(note?.actions ?? []), ...actions]} primary={primary} />
      {note?.menu}
    </PageToolbar>
  );
}
