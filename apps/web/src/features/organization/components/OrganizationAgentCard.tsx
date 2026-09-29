'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AgentPausedBadge } from '@/components/common/agent-chat/AgentPausedBadge';
import type {
  AgentTeamRole,
  OrganizationAgent,
  OrganizationDepartment,
} from '@/lib/api/endpoints/organization';
import { parseCapabilities } from '../capabilities';
import { useClearAgentAssignment, useSetAgentAssignment } from '../services/organization.service';
import OrganizationAgentGovernance from './OrganizationAgentGovernance';
import OrganizationAgentProjectInstruction from './OrganizationAgentProjectInstruction';
import { Inline, Stack, Text } from '@/design-system';

export default function OrganizationAgentCard({
  teamId,
  agent,
  agents,
  departments,
}: {
  teamId: number;
  agent: OrganizationAgent;
  agents: OrganizationAgent[];
  departments: OrganizationDepartment[];
}) {
  const t = useTranslations('organization');
  const save = useSetAgentAssignment(teamId);
  const clear = useClearAgentAssignment(teamId);
  const [roleTitle, setRoleTitle] = useState(agent.roleTitle);
  const [runtimeAgentId, setRuntimeAgentId] = useState(agent.runtimeAgentId ?? '');
  const [departmentId, setDepartmentId] = useState(agent.departmentId?.toString() ?? '');
  const [reportsToAgentId, setReportsToAgentId] = useState(
    agent.reportsToAgentId?.toString() ?? '',
  );
  const [role, setRole] = useState<AgentTeamRole | ''>(agent.role ?? '');
  const [capabilities, setCapabilities] = useState(agent.capabilities.join(', '));

  return (
    <Stack gap={4} pad={4} className="rounded-md border bg-card">
      <div>
        <Inline gap={2} wrap>
          <h3 className="text-md font-medium" dir="auto">
            {agent.name}
          </h3>
          <AgentPausedBadge agent={agent} />
        </Inline>
        <Text as="p" size="xs" tone="muted">
          @{agent.username} · {agent.kind}
        </Text>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <Text as="span" size="xs" tone="muted" className="block">
            {t('fields.roleTitle')}
          </Text>
          <Input
            value={roleTitle}
            maxLength={100}
            onChange={(event) => setRoleTitle(event.target.value)}
          />
        </label>
        <label className="space-y-1 text-sm">
          <Text as="span" size="xs" tone="muted" className="block">
            {t('fields.hermesAgentId')}
          </Text>
          <Input
            value={runtimeAgentId}
            maxLength={128}
            placeholder={t('agents.hermesPlaceholder')}
            onChange={(event) => setRuntimeAgentId(event.target.value)}
          />
        </label>
        <label className="space-y-1 text-sm">
          <Text as="span" size="xs" tone="muted" className="block">
            {t('fields.teamRole')}
          </Text>
          <select
            className="ds-field ds-select-native w-full"
            value={role}
            onChange={(event) => setRole(event.target.value as AgentTeamRole | '')}
          >
            <option value="">{t('roles.pool')}</option>
            <option value="coordinator">{t('roles.coordinator')}</option>
            <option value="specialist">{t('roles.specialist')}</option>
            <option value="reviewer">{t('roles.reviewer')}</option>
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <Text as="span" size="xs" tone="muted" className="block">
            {t('fields.capabilities')}
          </Text>
          <Input
            value={capabilities}
            placeholder={t('agents.capabilitiesPlaceholder')}
            onChange={(event) => setCapabilities(event.target.value)}
          />
        </label>
        <Text as="p" size="xs" tone="muted" className="md:col-span-2">
          {t('agents.capabilitiesHint')}
        </Text>
        <label className="space-y-1 text-sm">
          <Text as="span" size="xs" tone="muted" className="block">
            {t('fields.department')}
          </Text>
          <select
            className="ds-field ds-select-native w-full"
            value={departmentId}
            onChange={(event) => setDepartmentId(event.target.value)}
          >
            <option value="">{t('values.none')}</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <Text as="span" size="xs" tone="muted" className="block">
            {t('fields.reportsTo')}
          </Text>
          <select
            className="ds-field ds-select-native w-full"
            value={reportsToAgentId}
            onChange={(event) => setReportsToAgentId(event.target.value)}
          >
            <option value="">{t('values.none')}</option>
            {/* A project's organization leaves out the Home agent its coordinator reports to. */}
            {agent.reportsToAgentId != null &&
              !agents.some((candidate) => candidate.id === agent.reportsToAgentId) && (
                <option value={agent.reportsToAgentId}>{t('values.outsideProject')}</option>
              )}
            {agents
              .filter((candidate) => candidate.id !== agent.id)
              .map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
          </select>
        </label>
      </div>
      <OrganizationAgentGovernance teamId={teamId} agent={agent} />
      {agent.projects.length > 0 && (
        <Stack gap={2}>
          <h4 className="text-sm font-medium">{t('agents.projectInstructions')}</h4>
          {agent.projects.map((project) => (
            <OrganizationAgentProjectInstruction
              key={project.id}
              teamId={teamId}
              agentId={agent.id}
              project={project}
            />
          ))}
        </Stack>
      )}
      <Inline gap={2} justify="end" align="stretch">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={clear.isPending}
          onClick={() => clear.mutate(agent.id)}
        >
          {t('actions.clearAssignment')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={save.isPending}
          onClick={() =>
            save.mutate(
              {
                id: agent.id,
                input: {
                  roleTitle,
                  runtimeAgentId: runtimeAgentId || null,
                  departmentId: departmentId ? Number(departmentId) : null,
                  reportsToAgentId: reportsToAgentId ? Number(reportsToAgentId) : null,
                  role: role || null,
                  capabilities: parseCapabilities(capabilities),
                },
              },
              { onSuccess: () => toast.success(t('agents.saved', { name: agent.name })) },
            )
          }
        >
          {t('actions.save')}
        </Button>
      </Inline>
    </Stack>
  );
}
