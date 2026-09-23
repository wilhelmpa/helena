import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { IntegrationOption } from '@/lib/api/endpoints/integrations';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type { McpValueRow } from '../../utils/mcpServerForm';
import { McpServerValueRow } from './McpServerValueRow';

// The environment variables of a stdio server, or the headers of a remote one.
export function McpServerValueList({
  label,
  rows,
  secrets,
  onChange,
}: {
  label: string;
  rows: McpValueRow[];
  secrets: IntegrationOption[];
  onChange: (rows: McpValueRow[]) => void;
}) {
  const t = useTranslations('teams.mcpServers');
  const usesSecret = rows.some((row) => row.secret);
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {rows.map((row, index) => (
        <McpServerValueRow
          key={index}
          row={row}
          secrets={secrets}
          onChange={(next) => onChange(rows.map((r, i) => (i === index ? next : r)))}
          onRemove={() => onChange(rows.filter((_, i) => i !== index))}
        />
      ))}
      {usesSecret && secrets.length === 0 && (
        <p className="text-xs text-muted-foreground">{t('noSecrets')}</p>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 gap-1 px-2 text-xs"
        onClick={() =>
          onChange([...rows, { name: '', secret: false, value: '', credentialId: null }])
        }
      >
        <Plus className="size-3.5" />
        {t('addValue')}
      </Button>
    </div>
  );
}
