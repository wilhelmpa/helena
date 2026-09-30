'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { usePermissions } from '@/hooks/usePermissions';
import {
  useProjectWorkflows,
  useUpdateProjectWorkflow,
} from '@/services/controlPlaneWorkflows.service';
import { qk } from '@/services/queryKeys';
import { revScope } from '@/utils/revScopes';
import ControlPlaneWorkflowConfiguration from './ControlPlaneWorkflowConfiguration';
import ControlPlaneWorkflowRuntime from './ControlPlaneWorkflowRuntime';

import { Box, Card, EmptyState, Inline, Notice, Section, Stack, Text } from '@/design-system';

export function ControlPlaneWorkflowPanel({
  projectId,
  projectKey,
}: {
  projectId: number;
  projectKey: string;
}) {
  const t = useTranslations('settings.actions.controlPlane');
  const { can } = usePermissions();
  const workflows = useProjectWorkflows(projectKey);
  const update = useUpdateProjectWorkflow(projectKey);
  // A link to one run (workflowRunPath) opens its workflow and marks the run.
  const searchParams = useSearchParams();
  const linkedWorkflow = searchParams.get('workflow');
  const [expanded, setExpanded] = useState<string | null>(linkedWorkflow);
  const editable = can('actions', 'edit');
  useLiveRefresh({
    scope: revScope.controlPlane(projectId),
    targets: [qk.controlPlaneWorkflows(projectKey)],
  });

  return (
    <Section title={t('title')}>
      {workflows.isPending ? (
        <Text as="p" size="sm" tone="muted">
          {t('loading')}
        </Text>
      ) : workflows.isError ? (
        <Notice tone="danger" title={t('unavailable')}>
          {workflows.error instanceof Error ? workflows.error.message : null}
        </Notice>
      ) : !workflows.data?.length ? (
        <EmptyState boxed>{t('empty')}</EmptyState>
      ) : (
        <Stack gap={3}>
          {workflows.data?.map((workflow) => (
            <Card as="article" key={workflow.id}>
              <Inline gap={3} align="start" wrap className="flex flex-wrap items-start">
                <button
                  type="button"
                  className="min-w-0 flex-1 text-start"
                  onClick={() => setExpanded(expanded === workflow.id ? null : workflow.id)}
                >
                  <Inline gap={2} wrap className="flex flex-wrap items-center">
                    <h3 className="text-sm font-medium">
                      {workflow.id === 'agent-team' ? t('agentTeamName') : workflow.name}
                    </h3>
                    {workflow.externalEffects && (
                      <Badge variant="secondary">{t('approvalRequired')}</Badge>
                    )}
                    {workflow.triggers.map((trigger) => (
                      <Badge key={trigger} variant="outline">
                        {trigger === 'delegation' ? t('triggerDelegation') : trigger}
                      </Badge>
                    ))}
                  </Inline>
                  <Box as="p" marginTop={1}>
                    <Text as="span" size="sm" tone="muted">
                      {workflow.id === 'agent-team'
                        ? t('agentTeamDescription')
                        : workflow.description}
                    </Text>
                  </Box>
                </button>
                {editable ? (
                  <Inline gap={2} className="flex items-center">
                    <Label htmlFor={`${workflow.id}-enabled`} className="text-xs">
                      {t('enabled')}
                    </Label>
                    <Switch
                      id={`${workflow.id}-enabled`}
                      checked={workflow.assignment.enabled}
                      disabled={update.isPending}
                      onCheckedChange={(enabled) =>
                        update.mutate({
                          workflowId: workflow.id,
                          assignment: {
                            ...workflow.assignment,
                            enabled,
                            capabilityRefs: enabled
                              ? workflow.capabilityRefs
                              : workflow.assignment.capabilityRefs,
                          },
                        })
                      }
                    />
                  </Inline>
                ) : (
                  <Badge variant="outline">
                    {workflow.assignment.enabled ? t('enabled') : t('disabled')}
                  </Badge>
                )}
              </Inline>
              {workflow.capabilityRefs.length > 0 && (
                <Box as="p" marginTop={2}>
                  <Text as="span" size="xs" tone="muted">
                    {t('capabilities')}: {workflow.capabilityRefs.join(', ')}
                  </Text>
                </Box>
              )}
              {expanded === workflow.id && workflow.assignment.enabled && (
                <Stack gap={4} marginTop={4} padTop={4} className="border-t">
                  <ControlPlaneWorkflowConfiguration
                    projectKey={projectKey}
                    workflow={workflow}
                    editable={editable}
                  />
                  <ControlPlaneWorkflowRuntime
                    projectId={projectId}
                    projectKey={projectKey}
                    workflow={workflow}
                    editable={editable}
                    markedRunId={linkedWorkflow === workflow.id ? searchParams.get('run') : null}
                  />
                </Stack>
              )}
            </Card>
          ))}
        </Stack>
      )}
    </Section>
  );
}
