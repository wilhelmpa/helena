import { useTranslations } from 'next-intl';
import { Checkbox } from '@/components/ui/checkbox';
import { agentRole, type AgentGroup } from '../../utils/credentialForm';

// The agents of one project, or the Home agent, as checkboxes.
export function CredentialAgentGroup({
  group,
  selected,
  onToggle,
}: {
  group: AgentGroup;
  selected: Set<number>;
  onToggle: (agentId: number, on: boolean) => void;
}) {
  const t = useTranslations('credentials');
  return (
    <section className="space-y-1">
      <div className="border-b pb-1 text-xs font-medium text-muted-foreground">
        {group.project?.name ?? t('roles.home')}
      </div>
      <ul>
        {group.agents.map((agent) => (
          <li key={agent.id}>
            <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-1 py-1.5 hover:bg-muted/40">
              <Checkbox
                checked={selected.has(agent.id)}
                onCheckedChange={(on) => onToggle(agent.id, on === true)}
              />
              <span className="min-w-0 flex-1 truncate text-sm">{agent.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {t(`roles.${agentRole(agent)}`)}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}
