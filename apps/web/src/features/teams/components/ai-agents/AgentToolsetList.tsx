import { useTranslations } from 'next-intl';
import { Switch } from '@/components/ui/switch';
import { SettingsGroup, SettingsRow } from '@/design-system';
import { isHermesToolset, toggleToolset } from '../../utils/agentAbilities';
import { TeamSettingState } from '../TeamSettingState';

// The Hermes toolsets, or the MCP servers, of the agent's profile. One switched off lands
// in the runtime policy's toolDeny, and the runner leaves it out of the agent's chats and
// runs.
export default function AgentToolsetList({
  title,
  hint,
  empty,
  toolsets,
  denied,
  canEdit,
  onChange,
}: {
  title: string;
  hint: string;
  empty: string;
  toolsets: string[];
  denied: string[];
  canEdit: boolean;
  onChange: (denied: string[]) => void;
}) {
  const t = useTranslations('teams.agents.abilities');

  const row = (name: string) => {
    const on = !denied.includes(name);
    const described = isHermesToolset(name) ? t(`toolset.${name}`) : undefined;
    return (
      <SettingsRow
        key={name}
        label={<span className="font-mono text-xs">{name}</span>}
        description={described}
      >
        {canEdit ? (
          <Switch
            aria-label={name}
            checked={on}
            onCheckedChange={(checked) => onChange(toggleToolset(denied, name, checked))}
          />
        ) : (
          <TeamSettingState on={on} />
        )}
      </SettingsRow>
    );
  };
  // Six rows at a glance, the rest folded (docs/design-system.md §4).
  const shown = toolsets.slice(0, 6);
  const rest = toolsets.slice(6);

  return (
    <SettingsGroup
      title={title}
      description={hint}
      advancedLabel={t('moreToolsets', { count: rest.length })}
      advanced={rest.length ? rest.map(row) : undefined}
    >
      {toolsets.length === 0 ? <SettingsRow label={empty} /> : shown.map(row)}
    </SettingsGroup>
  );
}
