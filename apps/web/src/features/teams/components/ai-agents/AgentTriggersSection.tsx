import { Fragment } from 'react';
import { Zap } from 'lucide-react';
import { useQueries } from '@tanstack/react-query';
import type { TeamProjectOption } from '@/lib/api/endpoints/teams';
import type { CustomField } from '@/lib/api/endpoints/customFields';
import { getProject } from '@/lib/api/endpoints/projects';
import { qk } from '@/services/queryKeys';
import { Switch } from '@/components/ui/switch';
import { isMemberField } from '@/utils/memberFields';
import type { AgentFormValue } from '../../utils/agentForm';
import { AgentDelayInput } from './AgentDelayInput';
import { AgentFormSection } from './AgentFormSection';
import { useTranslations } from 'next-intl';
import { SettingsGroup, SettingsRow } from '@/design-system';

// A member field an agent can be set into, with the project it belongs to: an agent
// works in several projects of its team, and each has its own fields.
type ProjectField = { field: CustomField; project: TeamProjectOption };

// What starts a run: a mention in a comment, being made an issue's delegate, or being
// set into a member custom field that holds agents. Every trigger but the mention
// carries the wait before the run starts, so one field can start at once while
// another leaves time to edit the issue.
export default function AgentTriggersSection({
  open,
  onOpenChange,
  value,
  onChange,
  projects,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: AgentFormValue;
  onChange: (patch: Partial<AgentFormValue>) => void;
  // The projects of the team, of which the agent works in the ones it is attached to.
  // Only those carry fields it can be set into.
  projects: TeamProjectOption[];
}) {
  const t = useTranslations('teams.agents');
  const attached = projects.filter((project) => value.projectIds.includes(project.id));
  // One scaffold read per attached project. A project the reader has open is already
  // in the cache, so opening the editor usually fetches only the rest.
  const scaffolds = useQueries({
    queries: attached.map((project) => ({
      queryKey: qk.project(project.key),
      queryFn: () => getProject(project.key),
    })),
  });
  const memberFields: ProjectField[] = scaffolds.flatMap((scaffold, index) =>
    (scaffold.data?.customFields ?? [])
      .filter((field) => isMemberField(field) && field.memberScope !== 'humans')
      .map((field) => ({ field, project: attached[index] })),
  );

  const enabled =
    [value.triggerOnMention, value.triggerOnAssign].filter(Boolean).length +
    memberFields.filter((f) => value.fieldTriggers.some((tr) => tr.fieldId === f.field.id)).length;

  function toggleField(id: number, on: boolean) {
    onChange({
      fieldTriggers: on
        ? [...value.fieldTriggers, { fieldId: id, delayMin: '0' }]
        : value.fieldTriggers.filter((tr) => tr.fieldId !== id),
    });
  }

  function setFieldDelay(id: number, delayMin: string) {
    onChange({
      fieldTriggers: value.fieldTriggers.map((tr) =>
        tr.fieldId === id ? { ...tr, delayMin } : tr,
      ),
    });
  }

  return (
    <AgentFormSection
      open={open}
      onOpenChange={onOpenChange}
      icon={Zap}
      title={t('triggers')}
      hint={t('triggersHint')}
      headerRight={`${enabled} / ${2 + memberFields.length}`}
    >
      <SettingsGroup>
        <SettingsRow label={t('onMention')} description={t('onMentionHint')}>
          <Switch
            aria-label={t('onMention')}
            checked={value.triggerOnMention}
            onCheckedChange={(v) => onChange({ triggerOnMention: v })}
          />
        </SettingsRow>
        <SettingsRow label={t('onDelegation')} description={t('onDelegationHint')}>
          <Switch
            aria-label={t('onDelegation')}
            checked={value.triggerOnAssign}
            onCheckedChange={(v) => onChange({ triggerOnAssign: v })}
          />
        </SettingsRow>
        {value.triggerOnAssign && (
          <AgentDelayInput
            id="agent-delegation-delay"
            value={value.delegationDelayMin}
            onChange={(v) => onChange({ delegationDelayMin: v })}
          />
        )}
        {memberFields.map(({ field, project }) => {
          const trigger = value.fieldTriggers.find((tr) => tr.fieldId === field.id);
          const label = t('onFieldSet', { field: `${project.key} · ${field.name}` });
          return (
            <Fragment key={field.id}>
              <SettingsRow label={label} description={t('onFieldSetHint')}>
                <Switch
                  aria-label={label}
                  checked={trigger != null}
                  onCheckedChange={(v) => toggleField(field.id, v)}
                />
              </SettingsRow>
              {trigger && (
                <AgentDelayInput
                  id={`agent-field-delay-${field.id}`}
                  value={trigger.delayMin}
                  onChange={(v) => setFieldDelay(field.id, v)}
                />
              )}
            </Fragment>
          );
        })}
      </SettingsGroup>
    </AgentFormSection>
  );
}
