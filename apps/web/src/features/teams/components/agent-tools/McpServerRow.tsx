import { KeyRound, Pencil, Server, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { McpServer } from '@/lib/api/endpoints/agentMcpServers';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

// One server of the library: its name and transport, what Hermes starts or connects to,
// and the secrets its values come from.
export function McpServerRow({
  server,
  canManage,
  onEdit,
  onDelete,
}: {
  server: McpServer;
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations('teams.mcpServers');
  const target =
    server.transport === 'stdio' ? [server.command, ...server.args].join(' ') : server.url;
  const secrets = [...server.env, ...server.headers].filter((value) => value.credentialId !== null);

  return (
    <li className="flex items-start gap-3 py-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Server className="size-4" />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-mono text-sm font-medium">{server.name}</span>
          <Badge variant="secondary" className="text-xs font-normal">
            {t(`transports.${server.transport}`)}
          </Badge>
        </div>
        {server.description && (
          <p className="text-xs text-muted-foreground">{server.description}</p>
        )}
        <p dir="ltr" className="truncate font-mono text-xs text-muted-foreground">
          {target}
        </p>
        {secrets.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {secrets.map((value) => (
              <Badge
                key={value.name}
                variant="outline"
                className={`gap-1 font-mono text-xs font-normal ${
                  value.credentialLabel === null ? 'text-destructive' : ''
                }`}
              >
                <KeyRound className="size-3" />
                {value.name} · {value.credentialLabel ?? t('missingSecret')}
              </Badge>
            ))}
          </div>
        )}
      </div>
      {canManage && (
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground"
            onClick={onEdit}
            aria-label={t('edit')}
          >
            <Pencil className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-destructive"
            onClick={onDelete}
            aria-label={t('delete')}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      )}
    </li>
  );
}
