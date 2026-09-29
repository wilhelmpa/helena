'use client';

import { useMemo, useState } from 'react';
import { Bot, Copy, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import type { Organization } from '@/lib/api/endpoints/organization';
import { setAgentAssignment } from '@/lib/api/endpoints/organization';
import { addMember } from '@/lib/api/endpoints/members';
import { useAiAgentsQuery, useCopyAiAgentTemplate } from '@/services/aiAgents.service';
import { qk } from '@/services/queryKeys';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import AgentKeyValue from '@/features/teams/components/ai-agents/AgentKeyValue';
import {
  Button,
  Dialog,
  EmptyState,
  Field,
  Inline,
  List,
  ListRow,
  Segmented,
  Stack,
  Text,
} from '@/design-system';
import { teamMemberCandidates, type MemberSource } from '../teamMembers';

// "Mitglied hinzufügen" of the Team page (owner, O23/O57): in the tree and in the ring, on
// Helena's page and on a project's, an agent joins a project's team — an agent of the pool
// that does not work there yet, or a new copy of a template — and reports to the agent
// chosen here (the project's coordinator by default), so it sits in the chain at once.
export default function AddTeamMemberDialog({
  organization,
  projectId,
  onClose,
}: {
  organization: Organization;
  // The project of the page; on Helena's page the reader picks one.
  projectId?: number;
  onClose: () => void;
}) {
  const t = useTranslations('organization.addMember');
  const tCommon = useTranslations('common');
  const teamId = organization.teamId;
  const queryClient = useQueryClient();
  const agentsQuery = useAiAgentsQuery(teamId);
  const agents = useMemo(() => agentsQuery.data ?? [], [agentsQuery.data]);
  const copy = useCopyAiAgentTemplate(teamId);
  const [source, setSource] = useState<MemberSource>('pool');
  const [chosenProject, setChosenProject] = useState<number | null>(
    projectId ?? organization.projects[0]?.id ?? null,
  );
  const [picked, setPicked] = useState<number | null>(null);
  const [managerId, setManagerId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const project = organization.projects.find((item) => item.id === chosenProject) ?? null;
  const candidates = useMemo(
    () => teamMemberCandidates(organization, agents, chosenProject, source),
    [organization, agents, chosenProject, source],
  );
  const manager = managerId ?? candidates.defaultManagerId;

  const choose = (next: MemberSource) => {
    setSource(next);
    setPicked(null);
  };

  async function add() {
    if (!project || picked == null) return;
    setSaving(true);
    try {
      let agentId = picked;
      // An external copy's key exists only in this answer: shown once before closing.
      let key: string | null = null;
      if (source === 'template') {
        const created = await copy.mutateAsync({ templateId: picked, projectId: project.id });
        agentId = created.agent.id;
        key = created.apiKey ?? null;
      } else {
        const agent = agents.find((item) => item.id === picked);
        if (!agent) return;
        await addMember(project.key, { userId: agent.userId, role: 'member' });
      }
      if (manager != null && manager !== agentId)
        await setAgentAssignment(teamId, agentId, { reportsToAgentId: manager });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.organization(teamId) }),
        queryClient.invalidateQueries({ queryKey: qk.teamAiAgents(teamId) }),
        queryClient.invalidateQueries({ queryKey: qk.members(project.key) }),
      ]);
      toast.success(t('added', { project: project.name }));
      if (key) setApiKey(key);
      else onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('failed'));
    } finally {
      setSaving(false);
    }
  }

  if (apiKey)
    return (
      <Dialog title={t('title')} onClose={onClose}>
        <Stack gap={4}>
          <Inline gap={2} align="start">
            <TriangleAlert aria-hidden="true" size={16} />
            <Text size="sm">{t('keyOnce')}</Text>
          </Inline>
          <AgentKeyValue apiKey={apiKey} />
          <Inline justify="end">
            <Button variant="primary" onClick={onClose}>
              {tCommon('done')}
            </Button>
          </Inline>
        </Stack>
      </Dialog>
    );

  return (
    <Dialog title={t('title')} description={t('description')} onClose={onClose}>
      <Stack gap={4}>
        <Segmented<MemberSource>
          label={t('source')}
          value={source}
          onChange={choose}
          options={[
            { value: 'pool', label: t('fromPool'), icon: <Bot size={14} aria-hidden="true" /> },
            {
              value: 'template',
              label: t('fromTemplate'),
              icon: <Copy size={14} aria-hidden="true" />,
            },
          ]}
        />
        {projectId == null && (
          <Field label={t('project')} htmlFor="add-member-project">
            <Select
              value={chosenProject != null ? String(chosenProject) : undefined}
              onValueChange={(value) => {
                setChosenProject(Number(value));
                setPicked(null);
                setManagerId(null);
              }}
            >
              <SelectTrigger id="add-member-project">
                <SelectValue placeholder={t('chooseProject')} />
              </SelectTrigger>
              <SelectContent>
                {organization.projects.map((item) => (
                  <SelectItem key={item.id} value={String(item.id)}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
        {candidates.options.length === 0 ? (
          <EmptyState icon={source === 'pool' ? <Bot /> : <Copy />} fill={false}>
            {source === 'pool' ? t('poolEmpty') : t('templatesEmpty')}
          </EmptyState>
        ) : (
          // The list scrolls on its own, so the choice below and the buttons stay in view.
          <div className="max-h-72 overflow-y-auto">
            <List label={source === 'pool' ? t('fromPool') : t('fromTemplate')}>
              {candidates.options.map((option) => (
                <ListRow
                  key={option.id}
                  icon={source === 'pool' ? <Bot /> : <Copy />}
                  title={option.name}
                  subtitle={option.detail || undefined}
                  meta={option.meta || undefined}
                  selected={picked === option.id}
                  onSelect={() => setPicked(option.id)}
                />
              ))}
            </List>
          </div>
        )}
        {candidates.managers.length > 0 && (
          <Field label={t('reportsTo')} hint={t('reportsToHint')} htmlFor="add-member-manager">
            <Select
              value={manager != null ? String(manager) : undefined}
              onValueChange={(value) => setManagerId(Number(value))}
            >
              <SelectTrigger id="add-member-manager">
                <SelectValue placeholder={t('reportsTo')} />
              </SelectTrigger>
              <SelectContent>
                {candidates.managers.map((item) => (
                  <SelectItem key={item.id} value={String(item.id)}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
        <Inline justify="end" gap={2}>
          <Button onClick={onClose} disabled={saving}>
            {tCommon('cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={picked == null || project == null || saving}
            onClick={() => void add()}
          >
            {saving ? tCommon('saving') : t('add')}
          </Button>
        </Inline>
      </Stack>
    </Dialog>
  );
}
