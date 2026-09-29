import type { WidgetConfig, WidgetInstance, WidgetType } from '@/utils/dashboardWidgets';
import StatWidgetSettings from './widgets/StatWidgetSettings';
import BreakdownWidgetSettings from './widgets/BreakdownWidgetSettings';
import ThroughputWidgetSettings from './widgets/ThroughputWidgetSettings';
import PulseWidgetSettings from './widgets/PulseWidgetSettings';
import RecentIssuesWidgetSettings from './widgets/RecentIssuesWidgetSettings';
import ActivityFeedWidgetSettings from './widgets/ActivityFeedWidgetSettings';
import AgentRunsWidgetSettings from './widgets/AgentRunsWidgetSettings';
import WidgetDaysSettings from './widgets/WidgetDaysSettings';
import TradingConnectionChoice from './trading/TradingConnectionChoice';

// Widget types with nothing to configure. The header hides its settings button for
// them, so the popover is never empty.
const WITHOUT_SETTINGS: WidgetType[] = ['agent_workload', 'plugin'];

// The account choice of the trading widgets that read the paper account.
const TRADING_DATA = ['account', 'positions', 'orders', 'history', 'strategies', 'decisions'];
export function isTradingDataWidget(widget: Pick<WidgetInstance, 'type' | 'config'>): boolean {
  const id = widget.config?.pluginWidgetId ?? '';
  return (
    widget.type === 'plugin' &&
    TRADING_DATA.some((entry) => id === `plugin:helena.trading:${entry}`)
  );
}

export function hasWidgetSettings(widget: Pick<WidgetInstance, 'type' | 'config'>): boolean {
  return !WITHOUT_SETTINGS.includes(widget.type) || isTradingDataWidget(widget);
}

// The settings controls for a given type, shown in the widget's header popover
// while editing. Config changes flow back through onConfigChange (merged into the
// widget).
export default function WidgetSettings({
  widget,
  onConfigChange,
}: {
  widget: WidgetInstance;
  onConfigChange: (config: WidgetConfig) => void;
}) {
  const config = widget.config ?? {};
  if (isTradingDataWidget(widget))
    return (
      <TradingConnectionChoice
        value={config.credentialId}
        onChange={(credentialId) => onConfigChange({ credentialId })}
      />
    );
  switch (widget.type) {
    case 'stat':
      return <StatWidgetSettings config={config} onConfigChange={onConfigChange} />;
    case 'breakdown':
      return <BreakdownWidgetSettings config={config} onConfigChange={onConfigChange} />;
    case 'throughput':
      return <ThroughputWidgetSettings config={config} onConfigChange={onConfigChange} />;
    case 'pulse':
      return <PulseWidgetSettings config={config} onConfigChange={onConfigChange} />;
    case 'recent_issues':
      return <RecentIssuesWidgetSettings config={config} onConfigChange={onConfigChange} />;
    case 'activity_feed':
      return <ActivityFeedWidgetSettings config={config} onConfigChange={onConfigChange} />;
    case 'agent_runs':
      return <AgentRunsWidgetSettings config={config} onConfigChange={onConfigChange} />;
    case 'agent_health':
    case 'webhook_health':
    case 'agent_costs':
      return <WidgetDaysSettings config={config} onConfigChange={onConfigChange} />;
    default:
      return null;
  }
}
