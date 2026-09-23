import { useTranslations } from 'next-intl';
import { Checkbox } from '@/components/ui/checkbox';
import { isHermesToolset, toggleToolset } from '../../utils/agentAbilities';
import { TeamSettingState } from '../TeamSettingState';

// The Hermes toolsets of the agent's profile. A toolset switched off lands in the runtime
// policy's toolDeny, and the runner leaves it out of the agent's chats and runs.
export default function AgentToolsetList({
  toolsets,
  denied,
  canEdit,
  onChange,
}: {
  toolsets: string[];
  denied: string[];
  canEdit: boolean;
  onChange: (denied: string[]) => void;
}) {
  const t = useTranslations('teams.agents.abilities');

  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-medium">{t('toolsets')}</p>
        <p className="text-xs text-muted-foreground">
          {canEdit ? t('toolsetsHint') : t('toolsetsReadOnly')}
        </p>
      </div>
      {toolsets.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noToolsets')}</p>
      ) : (
        <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {toolsets.map((name) => {
            const on = !denied.includes(name);
            const label = (
              <span className="min-w-0">
                <span className="font-mono text-[13px]">{name}</span>
                {isHermesToolset(name) && (
                  <span className="block text-xs text-muted-foreground">
                    {t(`toolset.${name}`)}
                  </span>
                )}
              </span>
            );
            return (
              <li key={name}>
                {canEdit ? (
                  <label className="flex cursor-pointer items-start gap-2">
                    <Checkbox
                      className="mt-0.5"
                      checked={on}
                      onCheckedChange={(checked) =>
                        onChange(toggleToolset(denied, name, checked === true))
                      }
                    />
                    {label}
                  </label>
                ) : (
                  <div className="flex items-start justify-between gap-4">
                    {label}
                    <TeamSettingState on={on} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
