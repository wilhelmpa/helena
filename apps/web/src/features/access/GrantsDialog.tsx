'use client';

import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import Modal from '@/components/common/overlay/Modal';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Grant, GrantAccess, GrantInput } from '@/lib/api/endpoints/access';
import { useAiAgentsQuery } from '@/services/aiAgents.service';
import { useProjectsQuery } from '@/services/projects.service';
import { useSetGrants } from '@/services/access.service';
import { grantableAgentGroups } from '@/features/teams/utils/credentialForm';

interface Row {
  agentId: number | null;
  projectId: number | null;
  service: string | null;
  access: GrantAccess;
}

// Subjects are keyed "a<id>" (an agent) or "p<id>" (every agent of a project).
const keyOf = (row: Pick<Row, 'agentId' | 'projectId'>) =>
  row.agentId !== null ? `a${row.agentId}` : `p${row.projectId}`;

// Who may use a credential or a connector account: single agents or every agent of a
// project, for every service of an account or one, to read only or to write as well.
// A credential of one project is granted only there. The one grant editor of the access
// center, for website logins as for Google accounts.
export function GrantsDialog({
  teamId,
  target,
  services,
  onClose,
}: {
  teamId: number;
  target: { id: number; label: string; projectId: number | null; grants: Grant[] };
  // The services of an account, with their labels; none for a plain credential.
  services: { id: string; label: string }[];
  onClose: () => void;
}) {
  const t = useTranslations('access.grants');
  const tCommon = useTranslations('common');
  const agents = useAiAgentsQuery(teamId).data;
  const projects = useProjectsQuery().data;
  const save = useSetGrants(teamId);
  const [rows, setRows] = useState<Row[]>(() =>
    target.grants.map(({ agentId, projectId, service, access }) => ({
      agentId,
      projectId,
      service,
      access,
    })),
  );
  const [adding, setAdding] = useState<string>('');
  const withAccess = services.length > 0;

  const subjects = useMemo(() => {
    const teamProjects = (projects ?? []).filter(
      (project) =>
        project.teamId === teamId && (target.projectId === null || project.id === target.projectId),
    );
    // The Home agent first, then each project with its coordinator ahead.
    const grantable = grantableAgentGroups(agents ?? [], target.projectId).flatMap(
      (group) => group.agents,
    );
    return {
      projects: teamProjects.map((project) => ({
        key: `p${project.id}`,
        label: project.name,
        project,
      })),
      agents: grantable.map((agent) => ({ key: `a${agent.id}`, label: agent.name, agent })),
    };
  }, [agents, projects, teamId, target.projectId]);

  const labelOf = (row: Row) => {
    if (row.agentId !== null) {
      return (
        subjects.agents.find((entry) => entry.agent.id === row.agentId)?.label ?? `#${row.agentId}`
      );
    }
    const project = subjects.projects.find((entry) => entry.project.id === row.projectId);
    return t('projectSubject', { name: project?.label ?? `#${row.projectId}` });
  };

  const update = (index: number, patch: Partial<Row>) =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  function add() {
    if (!adding) return;
    const id = Number(adding.slice(1));
    const row: Row = {
      agentId: adding.startsWith('a') ? id : null,
      projectId: adding.startsWith('p') ? id : null,
      service: null,
      access: 'write',
    };
    setRows((current) => [...current, row]);
    setAdding('');
  }

  async function submit() {
    const grants: GrantInput[] = rows.map((row) => ({
      agentId: row.agentId,
      projectId: row.projectId,
      service: withAccess ? row.service : null,
      access: withAccess ? row.access : 'write',
    }));
    try {
      await save.mutateAsync({ id: target.id, grants });
      toast.success(t('saved', { name: target.label }));
      onClose();
    } catch {
      // The failure is toasted by the request layer; the rows stay as they were edited.
    }
  }

  const loading = !agents || !projects;

  return (
    <Modal
      title={t('title', { name: target.label })}
      description={t('hint')}
      onClose={onClose}
      wide
    >
      <div className="flex min-h-0 flex-col gap-4">
        {loading ? (
          <ListSkeleton rows={3} rowClassName="h-9" />
        ) : (
          <>
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('empty')}</p>
            ) : (
              <ul className="divide-y overflow-y-auto rounded-md border border-sidebar-border bg-card">
                {rows.map((row, index) => (
                  <li
                    key={`${keyOf(row)}-${row.service ?? ''}-${index}`}
                    className="flex flex-wrap items-center gap-2 px-3 py-2"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm">{labelOf(row)}</span>
                    {withAccess && (
                      <>
                        <Select
                          value={row.service ?? '*'}
                          onValueChange={(value) =>
                            update(index, { service: value === '*' ? null : value })
                          }
                        >
                          <SelectTrigger size="sm" className="w-36" aria-label={t('service')}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="*">{t('allServices')}</SelectItem>
                            {services.map((service) => (
                              <SelectItem key={service.id} value={service.id}>
                                {service.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select
                          value={row.access}
                          onValueChange={(value) => update(index, { access: value as GrantAccess })}
                        >
                          <SelectTrigger size="sm" className="w-40" aria-label={t('who')}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="read">{t('access.read')}</SelectItem>
                            <SelectItem value="write">{t('access.write')}</SelectItem>
                          </SelectContent>
                        </Select>
                      </>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 text-muted-foreground"
                      aria-label={t('remove')}
                      onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center gap-2">
              <Select value={adding} onValueChange={setAdding}>
                <SelectTrigger size="sm" className="min-w-0 flex-1" aria-label={t('who')}>
                  <SelectValue placeholder={t('who')} />
                </SelectTrigger>
                <SelectContent>
                  {subjects.projects.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>{t('projects')}</SelectLabel>
                      {subjects.projects.map((entry) => (
                        <SelectItem key={entry.key} value={entry.key}>
                          {t('projectSubject', { name: entry.label })}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                  {subjects.agents.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>{t('agents')}</SelectLabel>
                      {subjects.agents.map((entry) => (
                        <SelectItem key={entry.key} value={entry.key}>
                          {entry.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                </SelectContent>
              </Select>
              <Button type="button" size="sm" variant="outline" disabled={!adding} onClick={add}>
                <Plus />
                {t('add')}
              </Button>
            </div>
          </>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            {tCommon('cancel')}
          </Button>
          <Button onClick={submit} disabled={loading || save.isPending}>
            {tCommon('save')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
