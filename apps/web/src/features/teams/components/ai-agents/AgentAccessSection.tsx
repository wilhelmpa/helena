import { Shield } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AgentFormValue } from '../../utils/agentForm';
import { AgentFormSection } from './AgentFormSection';
import { useTranslations } from 'next-intl';
import { SettingsGroup, SettingsRow } from '@/design-system';

// Who may give an external agent work: its owner alone, or any member of the team. What
// the agent may do once it has the work is the role its membership carries in each
// project it works in, set from that project's member list, so it is not part of this
// form.
export default function AgentAccessSection({
  open,
  onOpenChange,
  value,
  onChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: AgentFormValue;
  onChange: (patch: Partial<AgentFormValue>) => void;
}) {
  const t = useTranslations('teams.agents');

  return (
    <AgentFormSection
      open={open}
      onOpenChange={onOpenChange}
      icon={Shield}
      title={t('access')}
      hint={t('accessHint')}
    >
      <SettingsGroup>
        <SettingsRow
          label={t('runnerScope')}
          description={
            value.runnerScope === 'owner' ? t('runnerScopeOwnerHint') : t('runnerScopeTeamHint')
          }
        >
          <Select
            value={value.runnerScope}
            onValueChange={(v) => onChange({ runnerScope: v as AgentFormValue['runnerScope'] })}
          >
            <SelectTrigger className="min-w-[150px]" aria-label={t('runnerScope')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="owner">{t('runnerScopeOwner')}</SelectItem>
              <SelectItem value="team">{t('runnerScopeTeam')}</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
      </SettingsGroup>
    </AgentFormSection>
  );
}
