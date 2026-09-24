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
    <section className="space-y-3">
      <h2 className="text-md font-medium">{t('title')}</h2>
      {workflows.isPending ? (
        <p className="text-sm text-muted-foreground">{t('loading')}</p>
      ) : workflows.isError ? (
        <p className="rounded-md border border-destructive/40 bg-card p-3 text-sm text-destructive">
          {t('unavailable')}
          {workflows.error instanceof Error && workflows.error.message ? (
            <span className="mt-1 block text-xs text-muted-foreground">
              {workflows.error.message}
            </span>
          ) : null}
        </p>
      ) : !workflows.data?.length ? (
        <p className="rounded-md border border-dashed bg-card p-4 text-sm text-muted-foreground">
          {t('empty')}
        </p>
      ) : (
        <div className="space-y-3">
          {workflows.data?.map((workflow) => (
            <article key={workflow.id} className="rounded-md border bg-card p-4">
              <div className="flex flex-wrap items-start gap-3">
                <button
                  type="button"
                  className="min-w-0 flex-1 text-start"
                  onClick={() => setExpanded(expanded === workflow.id ? null : workflow.id)}
                >
                  <div className="flex flex-wrap items-center gap-2">
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
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {workflow.id === 'agent-team'
                      ? t('agentTeamDescription')
                      : workflow.description}
                  </p>
                </button>
                {editable ? (
                  <div className="flex items-center gap-2">
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
                  </div>
                ) : (
                  <Badge variant="outline">
                    {workflow.assignment.enabled ? t('enabled') : t('disabled')}
                  </Badge>
                )}
              </div>
              {workflow.capabilityRefs.length > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {t('capabilities')}: {workflow.capabilityRefs.join(', ')}
                </p>
              )}
              {expanded === workflow.id && workflow.assignment.enabled && (
                <div className="mt-4 space-y-4 border-t pt-4">
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
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
