import { useTranslations } from 'next-intl';
import type { WidgetConfig } from '@/utils/dashboardWidgets';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { STATUS_FILTER } from './AgentRunsWidget';
import LimitSelect from './LimitSelect';
import { Inline } from '@/design-system';

// The run status filter and the row count.
export default function AgentRunsWidgetSettings({
  config,
  onConfigChange,
}: {
  config: WidgetConfig;
  onConfigChange: (config: WidgetConfig) => void;
}) {
  const t = useTranslations('dashboards.agentRuns');
  const status = config.runStatus ?? null;
  const limit = config.limit ?? 20;
  return (
    <Inline gap={2} wrap>
      <Select
        value={status ?? 'all'}
        onValueChange={(v) =>
          onConfigChange({ runStatus: v === 'all' ? null : (v as WidgetConfig['runStatus']) })
        }
      >
        <SelectTrigger size="sm" className="w-[130px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUS_FILTER.map((option) => (
            <SelectItem key={option} value={option}>
              {t(`filters.${option}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <LimitSelect value={limit} onChange={(next) => onConfigChange({ limit: next })} />
    </Inline>
  );
}
