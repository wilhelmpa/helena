import type { ChatSummary } from '@/lib/api/endpoints/agentChat';
import type { ChatFolder } from '@/lib/api/endpoints/userPreferences';

// The chats of the sidebar (owner, O87), in the order it shows them: the pinned chats on
// top, then the member's own folders (O4), then one section per agent — the agents in the
// order the place calls for (the home agent, the coordinator, the specialists), then any
// agent that only appears in a chat. A chat stands in one place only: pinned before filed
// in a folder before its agent's section. Each list keeps the order it arrives in (the
// server sends newest first). Pure, so the sidebar and the tests share it.

export interface ChatFolderSection {
  folder: ChatFolder;
  chats: ChatSummary[];
}

export interface ChatAgentSection {
  agent: { id: number; name: string };
  chats: ChatSummary[];
}

export interface ChatSections {
  pinned: ChatSummary[];
  folders: ChatFolderSection[];
  agents: ChatAgentSection[];
}

export function chatSections(
  chats: ChatSummary[],
  folders: ChatFolder[],
  agentOrder: number[],
): ChatSections {
  const pinned = chats.filter((chat) => chat.pinned);
  const folderOf = new Map<string, string>();
  for (const folder of folders) for (const id of folder.threads) folderOf.set(id, folder.id);
  const unpinned = chats.filter((chat) => !chat.pinned);
  const inFolder = (folder: ChatFolder) =>
    unpinned.filter((chat) => folderOf.get(chat.id) === folder.id);
  const rest = unpinned.filter((chat) => !folderOf.has(chat.id));

  const byAgent = new Map<number, ChatAgentSection>();
  for (const chat of rest) {
    const section = byAgent.get(chat.agent.id) ?? {
      agent: { id: chat.agent.id, name: chat.agent.name },
      chats: [],
    };
    section.chats.push(chat);
    byAgent.set(chat.agent.id, section);
  }
  const rank = (id: number) => {
    const index = agentOrder.indexOf(id);
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
  };
  // Array.prototype.sort is stable: agents outside the order keep their first appearance.
  const agents = [...byAgent.values()].sort((a, b) => rank(a.agent.id) - rank(b.agent.id));

  return {
    pinned,
    folders: folders.map((folder) => ({ folder, chats: inFolder(folder) })),
    agents,
  };
}

// The agents in the order of the chat list: the home agent first, then the coordinators,
// then everyone else, each group in the order the place gave them (contextAgents).
export function agentOrderByRole(
  agents: { id: number; agentRole: 'agent' | 'home' }[],
  roleOf: (agentId: number) => string | null | undefined,
): number[] {
  const rank = (agent: { id: number; agentRole: 'agent' | 'home' }) =>
    agent.agentRole === 'home' ? 0 : roleOf(agent.id) === 'coordinator' ? 1 : 2;
  return [...agents].sort((a, b) => rank(a) - rank(b)).map((agent) => agent.id);
}
