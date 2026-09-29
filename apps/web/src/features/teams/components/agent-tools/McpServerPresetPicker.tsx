import { Server } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { MCP_SERVER_PRESETS, type McpServerPresetKey } from '../../utils/mcpServerForm';

// Step one of adding a server: one of the presets, or a server described from scratch
// (null).
export function McpServerPresetPicker({
  onSelect,
}: {
  onSelect: (preset: McpServerPresetKey | null) => void;
}) {
  const t = useTranslations('teams.mcpServers');
  const options = [
    ...MCP_SERVER_PRESETS.map((preset) => ({
      key: preset.key,
      label: preset.label,
      hint: t(`presets.${preset.key}`),
    })),
    { key: null, label: t('custom'), hint: t('customHint') },
  ];
  return (
    <div className="space-y-1.5">
      {options.map((option) => (
        <button
          key={option.key ?? 'custom'}
          type="button"
          onClick={() => onSelect(option.key)}
          className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-start transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Server className="size-4" />
          </div>
          <span className="min-w-0">
            <span className="block text-sm font-medium">{option.label}</span>
            <span className="block text-xs text-muted-foreground">{option.hint}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
