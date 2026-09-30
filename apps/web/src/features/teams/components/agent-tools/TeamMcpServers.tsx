import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { McpServer } from '@/lib/api/endpoints/agentMcpServers';
import { useDeleteMcpServer, useMcpServersQuery } from '@/services/agentMcpServers.service';
import { Button } from '@/components/ui/button';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import { McpServerDialog } from './McpServerDialog';
import { McpServerRow } from './McpServerRow';
import { Card, EmptyState, Section } from '@/design-system';

// The team's MCP server library. A Hermes agent starts the servers enabled on it, which
// is done on the agent's page. A server runs a command with the team's secrets, so only the
// team's owners and managers change the library.
export default function TeamMcpServers({
  teamId,
  canManage,
}: {
  teamId: number;
  canManage: boolean;
}) {
  const t = useTranslations('teams.mcpServers');
  const servers = useMcpServersQuery(teamId).data;
  const [editing, setEditing] = useState<McpServer | 'new' | null>(null);
  const [deleting, setDeleting] = useState<McpServer | null>(null);
  const deleteServer = useDeleteMcpServer(teamId);

  return (
    <Section
      title={t('title')}
      description={canManage ? t('hint') : `${t('hint')} ${t('managerOnly')}`}
      actions={
        canManage ? (
          <Button variant="outline" size="sm" onClick={() => setEditing('new')}>
            <Plus className="size-3.5" />
            {t('add')}
          </Button>
        ) : undefined
      }
    >
      {!servers ? (
        <ListSkeleton rows={2} rowClassName="h-12" />
      ) : servers.length === 0 ? (
        <EmptyState boxed title={t('empty')}>
          {t('emptyHint')}
        </EmptyState>
      ) : (
        <Card as="ul" pad="none" className="divide-y overflow-hidden">
          {servers.map((server) => (
            <McpServerRow
              key={server.id}
              server={server}
              canManage={canManage}
              onEdit={() => setEditing(server)}
              onDelete={() => setDeleting(server)}
            />
          ))}
        </Card>
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
    </Section>
  );
}
