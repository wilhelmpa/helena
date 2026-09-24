'use client';

import type { WorkspaceContentProps } from '@/extensions/panelTools';
import { useComposeDraft } from '@/hooks/useMailCompose';
import ComposeDraftList from './components/ComposeDraftList';
import ComposeForm from './components/ComposeForm';
import { useComposeTeam } from './hooks/useComposeTeam';

// The mail tool of the right-side panel: the draft being written, or the open drafts
// and a new mail when there is none. The inbox, a task and the thread's draft list
// open a draft here (hooks/useMailCompose).
export default function MailComposeWorkspace({ projectKey }: WorkspaceContentProps) {
  const draftId = useComposeDraft();
  const teamId = useComposeTeam(projectKey);
  if (draftId != null) return <ComposeForm key={draftId} draftId={draftId} />;
  return <ComposeDraftList teamId={teamId} projectKey={projectKey} />;
}
