'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { ProjectWorkflow } from '@/lib/api/endpoints/controlPlaneWorkflows';
import { useUpdateProjectWorkflow } from '@/services/controlPlaneWorkflows.service';
import ControlPlaneAgentTeamPolicy from './ControlPlaneAgentTeamPolicy';
import { agentTeamPolicyConfiguration, agentTeamPolicyDraft } from './agentTeamPolicy';

import { Box, Text, Stack } from '@/design-system';

export default function ControlPlaneWorkflowConfiguration({
  projectKey,
  workflow,
  editable,
}: {
  projectKey: string;
  workflow: ProjectWorkflow;
  editable: boolean;
}) {
  const t = useTranslations('settings.actions.controlPlane');
  const update = useUpdateProjectWorkflow(projectKey);
  const [instructions, setInstructions] = useState(
    workflow.assignment.configuration.instructions ?? '',
  );
  const [retryLimit, setRetryLimit] = useState(
    workflow.assignment.configuration.retryLimit?.toString() ?? '3',
  );
  const agentTeam = workflow.id === 'agent-team';
  const [policy, setPolicy] = useState(() =>
    agentTeamPolicyDraft(workflow.assignment.configuration),
  );

  useEffect(() => {
    setInstructions(workflow.assignment.configuration.instructions ?? '');
    setRetryLimit(workflow.assignment.configuration.retryLimit?.toString() ?? '3');
    setPolicy(agentTeamPolicyDraft(workflow.assignment.configuration));
  }, [workflow.assignment.configuration]);

  if (!editable) {
    return (
      <Box pad={3} className="grid gap-3 rounded-md border bg-background text-sm sm:grid-cols-2">
        <div>
          <Text as="p" size="xs" tone="muted" className="font-medium">
            {t('instructions')}
          </Text>
          <Box as="p" marginTop={1} className="whitespace-pre-wrap">
            {instructions || t('notConfigured')}
          </Box>
        </div>
        <div>
          <Text as="p" size="xs" tone="muted" className="font-medium">
            {t('retryLimit')}
          </Text>
          <Box as="p" marginTop={1}>
            {retryLimit}
          </Box>
        </div>
        {agentTeam && (
          <>
            <div>
              <Text as="p" size="xs" tone="muted" className="font-medium">
                {t('agentTeam.result')}
              </Text>
              <Box as="p" marginTop={1}>
                {policy.autonomy === 'done'
                  ? t('agentTeam.autonomyDone')
                  : t('agentTeam.autonomyReview')}
                {' · '}
                {policy.reviewRequired ? t('agentTeam.reviewed') : t('agentTeam.notReviewed')}
              </Box>
            </div>
            <div>
              <Text as="p" size="xs" tone="muted" className="font-medium">
                {t('agentTeam.maxTurns')} · {t('agentTeam.budgetMinutes')}
              </Text>
              <Box as="p" marginTop={1}>
                {policy.maxTurns || t('agentTeam.noLimit')} ·{' '}
                {policy.budgetMinutes || t('agentTeam.noLimit')}
              </Box>
            </div>
          </>
        )}
      </Box>
    );
  }

  return (
    <Box
      as="form"
      pad={3}
      className="grid gap-3 rounded-md border bg-background sm:grid-cols-[1fr_8rem_auto]"
      onSubmit={(event) => {
        event.preventDefault();
        update.mutate(
          {
            workflowId: workflow.id,
            assignment: {
              ...workflow.assignment,
              configuration: {
                ...workflow.assignment.configuration,
                instructions: instructions.trim() || undefined,
                retryLimit: Math.max(0, Number.parseInt(retryLimit, 10) || 0),
                ...(agentTeam ? agentTeamPolicyConfiguration(policy) : {}),
              },
            },
          },
          { onSuccess: () => toast.success(t('configurationSaved', { name: workflow.name })) },
        );
      }}
    >
      <Stack gap={1}>
        <Label htmlFor={`${workflow.id}-instructions`}>{t('instructions')}</Label>
        <Textarea
          id={`${workflow.id}-instructions`}
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          placeholder={t('instructionsPlaceholder')}
        />
      </Stack>
      <Stack gap={1}>
        <Label htmlFor={`${workflow.id}-retry-limit`}>{t('retryLimit')}</Label>
        <Input
          id={`${workflow.id}-retry-limit`}
          type="number"
          min={0}
          max={20}
          value={retryLimit}
          onChange={(event) => setRetryLimit(event.target.value)}
        />
      </Stack>
      {agentTeam && (
        <ControlPlaneAgentTeamPolicy id={workflow.id} value={policy} onChange={setPolicy} />
      )}
      <Button
        className="self-end sm:col-start-3"
        variant="outline"
        size="sm"
        type="submit"
        disabled={update.isPending}
      >
        {t('saveConfiguration')}
      </Button>
    </Box>
  );
}
