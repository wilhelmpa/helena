import { Server } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { McpServer } from '@/lib/api/endpoints/agentMcpServers';
import { Checkbox } from '@/components/ui/checkbox';
import { teamSectionPath } from '@/utils/paths';
import { TeamSettingState } from '../TeamSettingState';
import { AgentEmptyNotice } from './AgentEmptyNotice';

// The servers of the team's library, each on or off for the agent. They are saved with
// the form.
export default function AgentLibraryMcpServers({
  teamId,
  servers,
  selected,
  canEdit,
  onToggle,
}: {
  teamId: number;
  servers: McpServer[];
  selected: number[];
  canEdit: boolean;
  onToggle: (id: number, on: boolean) => void;
}) {
  const t = useTranslations('teams.agents');

  if (servers.length === 0) {
    return canEdit ? (
      <AgentEmptyNotice
        icon={Server}
        title={t('abilities.noLibraryMcpServers')}
        hint={t('abilities.noLibraryMcpServersHint')}
        href={teamSectionPath(teamId, 'agent-tools')}
        linkLabel={t('goToTools')}
      />
    ) : null;
  }

  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-medium">{t('abilities.libraryMcpServers')}</p>
        <p className="text-xs text-muted-foreground">
          {canEdit
            ? t('abilities.libraryMcpServersHint')
            : t('abilities.libraryMcpServersReadOnly')}
        </p>
      </div>
      <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {servers.map((server) => {
          const on = selected.includes(server.id);
          const label = (
            <span className="min-w-0">
              <span className="font-mono text-[13px]">{server.name}</span>
              {server.description && (
                <span className="block text-xs text-muted-foreground">{server.description}</span>
              )}
            </span>
          );
          return (
            <li key={server.id}>
              {canEdit ? (
                <label className="flex cursor-pointer items-start gap-2">
                  <Checkbox
                    className="mt-0.5"
                    checked={on}
                    onCheckedChange={(checked) => onToggle(server.id, checked === true)}
                  />
                  {label}
                </label>
              ) : (
                <div className="flex items-start justify-between gap-4">
                  {label}
                  <TeamSettingState on={on} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
