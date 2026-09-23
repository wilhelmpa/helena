import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { IntegrationOption } from '@/lib/api/endpoints/integrations';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { McpValueRow } from '../../utils/mcpServerForm';

// One environment variable or header: its name, and a literal value or one of the
// team's secrets.
export function McpServerValueRow({
  row,
  secrets,
  onChange,
  onRemove,
}: {
  row: McpValueRow;
  secrets: IntegrationOption[];
  onChange: (row: McpValueRow) => void;
  onRemove: () => void;
}) {
  const t = useTranslations('teams.mcpServers');
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_7rem_minmax(0,1.3fr)_auto] items-center gap-2">
      <Input
        dir="ltr"
        className="font-mono text-xs"
        value={row.name}
        placeholder={t('valueName')}
        aria-label={t('valueName')}
        onChange={(e) => onChange({ ...row, name: e.target.value })}
      />
      <Select
        value={row.secret ? 'secret' : 'value'}
        onValueChange={(kind) => onChange({ ...row, secret: kind === 'secret' })}
      >
        <SelectTrigger className="w-full" aria-label={t('valueKind')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="value">{t('literal')}</SelectItem>
          <SelectItem value="secret">{t('secret')}</SelectItem>
        </SelectContent>
      </Select>
      {row.secret ? (
        <Select
          value={row.credentialId === null ? '' : String(row.credentialId)}
          onValueChange={(id) => onChange({ ...row, credentialId: Number(id) })}
        >
          <SelectTrigger className="w-full" aria-label={t('secret')}>
            <SelectValue placeholder={t('chooseSecret')} />
          </SelectTrigger>
          <SelectContent>
            {secrets.map((secret) => (
              <SelectItem key={secret.id} value={String(secret.id)}>
                {secret.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          dir="ltr"
          autoComplete="off"
          className="font-mono text-xs"
          value={row.value}
          placeholder={t('literal')}
          aria-label={t('literal')}
          onChange={(e) => onChange({ ...row, value: e.target.value })}
        />
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 text-muted-foreground"
        onClick={onRemove}
        aria-label={t('removeValue')}
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}
