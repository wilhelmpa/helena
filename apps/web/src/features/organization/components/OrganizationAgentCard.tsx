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
    <div className="space-y-4 rounded-lg border p-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-medium" dir="auto">
            {agent.name}
          </h3>
          <AgentPausedBadge agent={agent} />
        </div>
        <p className="text-xs text-muted-foreground">
          @{agent.username} · {agent.kind}
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">{t('fields.roleTitle')}</span>
          <Input
            value={roleTitle}
            maxLength={100}
            onChange={(event) => setRoleTitle(event.target.value)}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">{t('fields.hermesAgentId')}</span>
          <Input
            value={runtimeAgentId}
            maxLength={128}
            placeholder={t('agents.hermesPlaceholder')}
            onChange={(event) => setRuntimeAgentId(event.target.value)}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">{t('fields.teamRole')}</span>
          <select
            className="h-9 w-full rounded-md border bg-background px-3"
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
          <span className="text-muted-foreground">{t('fields.capabilities')}</span>
          <Input
            value={capabilities}
            placeholder={t('agents.capabilitiesPlaceholder')}
            onChange={(event) => setCapabilities(event.target.value)}
          />
        </label>
        <p className="text-xs text-muted-foreground md:col-span-2">
          {t('agents.capabilitiesHint')}
        </p>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">{t('fields.department')}</span>
          <select
            className="h-9 w-full rounded-md border bg-background px-3"
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
          <span className="text-muted-foreground">{t('fields.reportsTo')}</span>
          <select
            className="h-9 w-full rounded-md border bg-background px-3"
            value={reportsToAgentId}
            onChange={(event) => setReportsToAgentId(event.target.value)}
          >
            <option value="">{t('values.none')}</option>
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
        <div className="space-y-2">
          <h4 className="text-sm font-medium">{t('agents.projectInstructions')}</h4>
          {agent.projects.map((project) => (
            <OrganizationAgentProjectInstruction
              key={project.id}
              teamId={teamId}
              agentId={agent.id}
              project={project}
            />
          ))}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={clear.isPending}
          onClick={() => clear.mutate(agent.id)}
        >
          {t('actions.clearAssignment')}
        </Button>
        <Button
          type="button"
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
      </div>
    </div>
  );
}
