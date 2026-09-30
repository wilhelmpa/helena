'use client';

import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useDisplayName } from '@/context/displayName';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger, TreeAction } from '@/design-system';
import Avatar from '@/components/common/Avatar';
import { useRouter } from 'next/navigation';
import { agentDisplayName } from '../../utils/agentChip';
import { chatHref } from '../../utils/chatHref';

// The "+" of one agent's section: a new chat with it.
export function SidebarChatNewInAgent({
  projectKey,
  agentId,
  name,
  hoverOnly = false,
}: {
  projectKey: string | null;
  agentId: number;
  name: string;
  // In an agent's group: left out on a touch screen, where the area's "+" does the same.
  hoverOnly?: boolean;
}) {
  const t = useTranslations('chatWorkspace');
  return (
    <TreeAction
      label={t('list.newChatWith', { name })}
      href={chatHref(projectKey, { agentId })}
      hoverOnly={hoverOnly}
    >
      <Plus />
    </TreeAction>
  );
}

// The "+" of the chat area: a new chat, with the agent to choose (the home agent, the
// coordinator, then the specialists — the order of the place).
export default function SidebarChatNew({
  projectKey,
  agents,
}: {
  projectKey: string | null;
  agents: AiAgent[];
}) {
  const t = useTranslations('chatWorkspace');
  const appName = useDisplayName();
  const router = useRouter();
  if (agents.length === 0) return null;
  if (agents.length === 1) {
    const only = agents[0]!;
    return (
      <SidebarChatNewInAgent
        projectKey={projectKey}
        agentId={only.id}
        name={agentDisplayName(only, appName)}
      />
    );
  }
  return (
    <Menu modal={false}>
      <MenuTrigger asChild>
        <button
          type="button"
          className="ds-tree-action"
          aria-label={t('list.newChat')}
          title={t('list.newChat')}
        >
          <Plus />
        </button>
      </MenuTrigger>
      <MenuContent align="start">
        <MenuLabel>{t('agents.newChatWith')}</MenuLabel>
        {agents.map((agent) => (
          <MenuItem
            key={agent.id}
            onSelect={() => router.push(chatHref(projectKey, { agentId: agent.id }))}
          >
            <Avatar name={agent.name} className="size-4" aria-hidden />
            {agentDisplayName(agent, appName)}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}
