import { createContext, useContext } from 'react';
import type { HeaderLayout, IssueOpenMode } from '@/lib/api/endpoints/userPreferences';
import type { CustomField } from '@/lib/api/endpoints/customFields';
import type { ProjectDetail } from '@/lib/api/endpoints/projects';
import type { WorkspaceToolId } from '@/utils/workspaceTools';
import type { HeaderExtraStore } from '@/utils/headerExtraStore';
import type { View } from '@/lib/api/endpoints/views';
import type { NewIssueDefaults } from '@/utils/project';
import type { useViewEditor } from '@/hooks/useViewEditor';
import type { WorkspaceLayoutChoice } from './workspaceLayout';

// What the Shell layout provides to its child pages (the work items view and the
// settings pages) through React context. The Shell owns the project data, the
// view editor and the project-level overlays; children read them here instead of
// re-querying.
export type ShellContext = {
  project: ProjectDetail | null;
  filteredProject: ProjectDetail | null;
  views: View[];
  editor: ReturnType<typeof useViewEditor>;
  customFields: CustomField[];
  // Opens an issue. Without `mode` the account's issueOpenMode preference decides
  // between the side panel and the issue page; pass it to force one of them.
  onOpenIssue: (id: number, mode?: IssueOpenMode) => void;
  onAddIssue: (defaults: NewIssueDefaults) => void;
  workspaceTool?: WorkspaceToolId | null;
  onOpenWorkspaceTool?: (tool: WorkspaceToolId) => void;
  // Opens the chat panel on a new conversation with the agent.
  onChatWithAgent: (agentId: number) => void;
  // Opens the chat panel on one of the reader's conversations. The request is held
  // until the panel has opened it.
  onOpenChatThread: (agentId: number, threadId: string | null) => void;
  // The chat tool is open in the panel: the chat list of the sidebar then opens a chat there,
  // instead of taking the page away from the reader (owner, O87).
  chatPanelOpen: boolean;
  chatThreadRequest: ChatThreadRequest | null;
  onChatThreadHandled: () => void;
  // The account's header layout preference, and the child page's way of putting
  // content into the Shell's single-row header (its view tabs/filter bar, for the
  // one it renders itself when the layout is 'classic'). See useShellHeaderExtra.
  headerLayout: HeaderLayout;
  headerExtra: HeaderExtraStore;
  // The workspace layouts and the chosen one, for the header's layout menu and the
  // command palette (context/workspaceLayout).
  workspaceLayout?: WorkspaceLayoutChoice;
  // The task open in front of the reader (the side panel, else the task page), which the
  // chat in the panel names as its context (owner, 28.09., O50).
  currentIssue?: { identifier: string; title: string } | null;
};

// `threadId` null: a new conversation with the agent.
export type ChatThreadRequest = { agentId: number; threadId: string | null };

export const ShellCtx = createContext<ShellContext | null>(null);

export function useShell(): ShellContext {
  const ctx = useContext(ShellCtx);
  if (!ctx) throw new Error('useShell must be used within the project Shell');
  return ctx;
}
