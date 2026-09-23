import { useTranslations } from 'next-intl';
import type { McpTransport } from '@/lib/api/endpoints/agentMcpServers';
import type { IntegrationOption } from '@/lib/api/endpoints/integrations';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { McpServerFormValue } from '../../utils/mcpServerForm';
import { McpServerValueList } from './McpServerValueList';

const TRANSPORTS: McpTransport[] = ['stdio', 'http', 'sse'];

// The fields of a library server. A stdio server is a command Hermes starts with its
// environment; an http or sse server is a URL Hermes connects to with its headers.
export function McpServerFields({
  value,
  secrets,
  onChange,
}: {
  value: McpServerFormValue;
  secrets: IntegrationOption[];
  onChange: (patch: Partial<McpServerFormValue>) => void;
}) {
  const t = useTranslations('teams.mcpServers');
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="mcp-server-name">{t('name')}</Label>
        <Input
          id="mcp-server-name"
          dir="ltr"
          className="font-mono"
          value={value.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">{t('nameHint')}</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="mcp-server-description">{t('description')}</Label>
        <Input
          id="mcp-server-description"
          dir="auto"
          value={value.description}
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label>{t('transport')}</Label>
        <Select
          value={value.transport}
          onValueChange={(transport) => onChange({ transport: transport as McpTransport })}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TRANSPORTS.map((transport) => (
              <SelectItem key={transport} value={transport}>
                {t(`transports.${transport}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {value.transport === 'stdio' ? (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="mcp-server-command">{t('command')}</Label>
            <Input
              id="mcp-server-command"
              dir="ltr"
              className="font-mono"
              value={value.command}
              placeholder="npx"
              onChange={(e) => onChange({ command: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mcp-server-args">{t('args')}</Label>
            <Textarea
              id="mcp-server-args"
              dir="ltr"
              rows={3}
              className="font-mono text-xs"
              value={value.args}
              onChange={(e) => onChange({ args: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">{t('argsHint')}</p>
          </div>
          <McpServerValueList
            label={t('env')}
            rows={value.env}
            secrets={secrets}
            onChange={(env) => onChange({ env })}
          />
        </>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="mcp-server-url">{t('url')}</Label>
            <Input
              id="mcp-server-url"
              dir="ltr"
              className="font-mono"
              value={value.url}
              placeholder="https://"
              onChange={(e) => onChange({ url: e.target.value })}
            />
          </div>
          <McpServerValueList
            label={t('headers')}
            rows={value.headers}
            secrets={secrets}
            onChange={(headers) => onChange({ headers })}
          />
        </>
      )}
      <p className="text-xs text-muted-foreground">{t('secretHint')}</p>
    </div>
  );
}
