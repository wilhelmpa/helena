'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import Modal from '@/components/common/overlay/Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { CredentialEntry } from '@/lib/api/endpoints/credentials';
import { useStartClone } from '@/services/access.service';
import { useAiAgentsQuery } from '@/services/aiAgents.service';
import { useProjectsQuery } from '@/services/projects.service';
import { useViewFoldersQuery } from '@/services/views.service';

// "Repo in Bereichsordner klonen": the runner of an agent of the project clones the
// repository with this SSH key into an area's folder of the workspace.
export function CloneDialog({
  teamId,
  entry,
  onClose,
}: {
  teamId: number;
  entry: CredentialEntry;
  onClose: () => void;
}) {
  const t = useTranslations('access.clone');
  const tCommon = useTranslations('common');
  const projects = (useProjectsQuery().data ?? []).filter(
    (project) =>
      project.teamId === teamId && (entry.projectId === null || project.id === entry.projectId),
  );
  const [projectId, setProjectId] = useState<number | null>(
    entry.projectId ?? projects[0]?.id ?? null,
  );
  const project = projects.find((item) => item.id === projectId) ?? null;
  const areas = useViewFoldersQuery(project?.key ?? null).data ?? [];
  const agents = (useAiAgentsQuery(teamId).data ?? []).filter(
    (agent) =>
      agent.kind === 'external' &&
      !agent.template &&
      agent.projects.some((item) => item.id === projectId),
  );
  const [areaId, setAreaId] = useState<string>('root');
  const [agentId, setAgentId] = useState<string>('any');
  const [url, setUrl] = useState('');
  const start = useStartClone(teamId);

  async function submit() {
    if (projectId === null) return;
    try {
      const started = await start.mutateAsync({
        id: entry.id,
        input: {
          projectId,
          areaId: areaId === 'root' ? null : Number(areaId),
          url: url.trim(),
          agentId: agentId === 'any' ? undefined : Number(agentId),
        },
      });
      toast.success(t('started', { agent: started.agentName, name: started.name }));
      onClose();
    } catch {
      // Toasted by the request layer.
    }
  }

  return (
    <Modal title={t('title', { name: entry.label })} description={t('hint')} onClose={onClose}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (projectId !== null && url.trim()) void submit();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="clone-url">{t('url')}</Label>
          <Input
            id="clone-url"
            dir="ltr"
            placeholder="git@github.com:owner/repo.git"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>{t('project')}</Label>
            <Select
              value={projectId === null ? '' : String(projectId)}
              onValueChange={(value) => {
                setProjectId(Number(value));
                setAreaId('root');
                setAgentId('any');
              }}
            >
              <SelectTrigger aria-label={t('project')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {projects.map((item) => (
                  <SelectItem key={item.id} value={String(item.id)}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t('area')}</Label>
            <Select value={areaId} onValueChange={setAreaId}>
              <SelectTrigger aria-label={t('area')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="root">{t('workspaceRoot')}</SelectItem>
                {areas.map((area) => (
                  <SelectItem key={area.id} value={String(area.id)}>
                    {area.name} ({area.folder})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>{t('agent')}</Label>
          <Select value={agentId} onValueChange={setAgentId}>
            <SelectTrigger aria-label={t('agent')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">{t('anyAgent')}</SelectItem>
              {agents.map((agent) => (
                <SelectItem key={agent.id} value={String(agent.id)}>
                  {agent.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button type="submit" disabled={projectId === null || !url.trim() || start.isPending}>
            {t('start')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
