'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { OrganizationAgentProject } from '@/lib/api/endpoints/organization';
import { useSetAgentProjectInstructions } from '../services/organization.service';
import { Card } from '@/design-system';

export default function OrganizationAgentProjectInstruction({
  teamId,
  agentId,
  project,
}: {
  teamId: number;
  agentId: number;
  project: OrganizationAgentProject;
}) {
  const t = useTranslations('organization');
  const save = useSetAgentProjectInstructions(teamId);
  const [instructions, setInstructions] = useState(project.instructions);

  return (
    <Card
      as="form"
      tone="inset"
      pad="tight"
      gap={2}
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate({ agentId, projectId: project.id, instructions });
      }}
    >
      <div className="text-sm font-medium">
        {project.key} · {project.name}
      </div>
      <Textarea
        value={instructions}
        maxLength={500}
        placeholder={t('agents.projectInstructionsPlaceholder')}
        onChange={(event) => setInstructions(event.target.value)}
      />
      <div className="flex justify-end">
        <Button type="submit" variant="outline" size="sm" disabled={save.isPending}>
          {t('actions.saveInstructions')}
        </Button>
      </div>
    </Card>
  );
}
