import { Trash2, Wrench } from 'lucide-react';
import type { ConfiguredTool } from '@/lib/api/endpoints/agentTools';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useTranslations } from 'next-intl';
import { Td, Tr } from '@/design-system';

// One configured tool as a table row: the tool name with the integration and
// credential it runs on below, the token permissions it needs as badges, and a
// delete action gated by permission.
export function ToolConfigRow({
  tool,
  toolLabel,
  integrationLabel,
  scopes,
  canDelete,
  onDelete,
}: {
  tool: ConfiguredTool;
  toolLabel: string;
  integrationLabel: string;
  scopes: string[];
  canDelete: boolean;
  onDelete: () => void;
}) {
  const t = useTranslations('teams.tools');
  const on = tool.credentialLabel
    ? `${integrationLabel} · ${tool.credentialLabel}`
    : integrationLabel;
  return (
    <Tr className="group/item">
      <Td className="py-3 align-top whitespace-normal">
        <div className="flex min-w-0 items-start gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-sidebar-border bg-background text-muted-foreground">
            <Wrench className="size-4" />
          </div>
          <div className="flex min-w-0 flex-col gap-0.5 pt-0.5">
            <span className="truncate text-sm font-medium text-foreground">{toolLabel}</span>
            <span className="truncate text-xs text-muted-foreground">{on}</span>
          </div>
        </div>
      </Td>
      <Td className="py-3 pt-4 align-top whitespace-normal max-md:hidden">
        {scopes.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {scopes.map((s) => (
              <Badge key={s} variant="secondary" className="font-mono text-xs font-normal">
                {s}
              </Badge>
            ))}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">{t('noScopes')}</span>
        )}
      </Td>
      <Td className="pt-3 align-top">
        <div className="flex items-center justify-end gap-1">
          {canDelete && (
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground hover:text-destructive"
              onClick={onDelete}
              aria-label={t('delete')}
            >
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
      </Td>
    </Tr>
  );
}
