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

// A list that mixes projects (Home) names the project of a chat at the end of its row —
// only where the projects differ: the chats of one project's agent all say the same
// (owner, O100: chips only when needed). A project's own sidebar never does.
export function mixesProjects(chats: ChatSummary[], inProject: boolean): boolean {
  if (inProject) return false;
  return new Set(chats.map((chat) => chat.project?.key ?? '')).size > 1;
}

// The chats of a group as shown: the first few, the rest folded into a "further n" row — but
// all of them once the reader opened the group or the open chat is among the folded ones.
export function foldedChats(
  chats: ChatSummary[],
  limit: number,
  open: boolean,
  holdsActive: (chats: ChatSummary[]) => boolean,
): { shown: ChatSummary[]; hidden: number } {
  const showAll = open || holdsActive(chats.slice(limit));
  const shown = showAll ? chats : chats.slice(0, limit);
  return { shown, hidden: chats.length - shown.length };
}

// One agent of the chat list's tree (owner, O109): its own chats, the agents reporting to it
// that have chats (or lead to one), and the number of chats of the whole branch.
export interface ChatAgentNode {
  agent: { id: number; name: string };
  chats: ChatSummary[];
  children: ChatAgentNode[];
  total: number;
}

// The chat list as the organisation chart: the home agent on top, the coordinators below it,
// each with its specialists (reportsTo). An agent without chats is left out — unless a report
// of it has some, then it stays as the row that holds them. `known` names the agents the place
// offers (the ones that may head a branch); one it does not know ends the chain, so a project
// shows only its own branch. Agents outside every chain keep the order they came in.
export function chatAgentTree(
  sections: ChatAgentSection[],
  organization: { id: number; name: string; reportsToAgentId: number | null }[],
  known: ReadonlySet<number>,
): ChatAgentNode[] {
  const info = new Map(organization.map((agent) => [agent.id, agent]));
  const nodes = new Map<number, ChatAgentNode>();
  const order: number[] = [];
  const node = (id: number, name: string): ChatAgentNode => {
    let entry = nodes.get(id);
    if (!entry) {
      entry = { agent: { id, name }, chats: [], children: [], total: 0 };
      nodes.set(id, entry);
      order.push(id);
    }
    return entry;
  };
  for (const section of sections) node(section.agent.id, section.agent.name).chats = section.chats;
  const parentOf = (id: number): number | null => {
    const parent = info.get(id)?.reportsToAgentId ?? null;
    return parent != null && parent !== id && known.has(parent) ? parent : null;
  };
  // The ancestors that lead to a chat join the tree (a cycle in reportsTo ends the walk).
  for (const section of sections) {
    const seen = new Set<number>([section.agent.id]);
    for (let id = parentOf(section.agent.id); id != null && !seen.has(id); id = parentOf(id)) {
      seen.add(id);
      node(id, info.get(id)?.name ?? String(id));
    }
  }
  const roots: ChatAgentNode[] = [];
  for (const id of order) {
    const entry = nodes.get(id)!;
    let parent = parentOf(id);
    // Never hang a node under its own descendant: a cycle is cut at the first agent.
    for (let cursor = parent, hops = 0; cursor != null; cursor = parentOf(cursor)) {
      if (cursor === id || ++hops > order.length) {
        parent = null;
        break;
      }
    }
    const holder = parent == null ? undefined : nodes.get(parent);
    if (holder) holder.children.push(entry);
    else roots.push(entry);
  }
  const count = (entry: ChatAgentNode): number => {
    entry.total = entry.chats.length + entry.children.reduce((sum, child) => sum + count(child), 0);
    return entry.total;
  };
  roots.forEach(count);
  return roots;
}
