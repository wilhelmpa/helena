import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { McpServer } from '@/lib/api/endpoints/agentMcpServers';
import type { ResourcePermissions } from '@/lib/api/endpoints/roles';
import { useDeleteMcpServer, useMcpServersQuery } from '@/services/agentMcpServers.service';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/common/page/EmptyState';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import { McpServerDialog } from './McpServerDialog';
import { McpServerRow } from './McpServerRow';
import { ToolSectionHeader } from './ToolSectionHeader';

// The team's MCP server library. A Hermes agent starts the servers enabled on it, which
// is done on the agent's page.
export default function TeamMcpServers({
  teamId,
  permissions,
}: {
  teamId: number;
  permissions: ResourcePermissions;
}) {
  const t = useTranslations('teams.mcpServers');
  const servers = useMcpServersQuery(teamId).data;
  const [editing, setEditing] = useState<McpServer | 'new' | null>(null);
  const [deleting, setDeleting] = useState<McpServer | null>(null);
  const deleteServer = useDeleteMcpServer(teamId);

  return (
    <section className="space-y-3">
      <ToolSectionHeader
        title={t('title')}
        hint={t('hint')}
        action={
          permissions.create ? (
            <Button size="sm" className="h-8 gap-1.5" onClick={() => setEditing('new')}>
              <Plus className="size-3.5" />
              {t('add')}
            </Button>
          ) : undefined
        }
      />
      {!servers ? (
        <ListSkeleton rows={2} rowClassName="h-12" />
      ) : servers.length === 0 ? (
        <EmptyState title={t('empty')} description={t('emptyHint')} />
      ) : (
        <ul className="divide-y">
          {servers.map((server) => (
            <McpServerRow
              key={server.id}
              server={server}
              canEdit={permissions.edit}
              canDelete={permissions.delete}
              onEdit={() => setEditing(server)}
              onDelete={() => setDeleting(server)}
            />
          ))}
        </ul>
      )}

      {editing && (
        <McpServerDialog
          teamId={teamId}
          server={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={t('delete')}
          confirmLabel={t('delete')}
          onConfirm={async () => {
            await deleteServer.mutateAsync(deleting.id);
            setDeleting(null);
          }}
          onClose={() => setDeleting(null)}
        >
          <div className="text-sm text-muted-foreground">
            {t('deleteMessage', { name: deleting.name })}
          </div>
        </ConfirmDialog>
      )}
    </section>
  );
}
