import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ActionDef, ActionEffect, WorkflowDefinition } from '@/lib/api/endpoints/actions';
import type { CustomField } from '@/lib/api/endpoints/customFields';
import type { ProjectDetail } from '@/lib/api/endpoints/projects';
import type { FilterSet } from '@/utils/filters';
import { isEmptyEffect } from '@/utils/actions';
import { usePreviewAction } from '@/services/actions.service';
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
import { SettingsActionIconPicker } from './SettingsActionIconPicker';
import { WorkflowGraphEditor } from './WorkflowGraphEditor';

import { Stack, Inline, Text, Notice, Card } from '@/design-system';

export function SettingsActionDialog({
  actionId,
  projectKey,
  project,
  customFields,
  mode,
  initialName,
  initialIcon,
  initialWorkflow,
  saving,
  onSave,
  onClose,
}: {
  actionId?: number;
  projectKey: string;
  project: ProjectDetail;
  customFields: CustomField[];
  mode: 'new' | 'edit';
  initialName: string;
  initialIcon: string;
  initialWorkflow: WorkflowDefinition;
  saving: boolean;
  onSave: (input: {
    name: string;
    icon: string;
    trigger: ActionDef['trigger'];
    condition: FilterSet;
    effect: ActionEffect;
    workflow: WorkflowDefinition;
  }) => void;
  onClose: () => void;
}) {
  const t = useTranslations('settings.actions');
  const tCommon = useTranslations('common');
  const [name, setName] = useState(initialName);
  const [icon, setIcon] = useState(initialIcon);
  const [workflow, setWorkflow] = useState(initialWorkflow);
  const [issueId, setIssueId] = useState(project.issues[0]?.id ?? 0);
  const preview = usePreviewAction();
  const actionNodes = workflow.nodes.filter((node) => node.type === 'action');
  const isValid = name.trim().length > 0 && actionNodes.some((node) => !isEmptyEffect(node.config));

  function submit() {
    if (!isValid) return;
    const triggerNode = workflow.nodes.find((node) => node.type === 'trigger');
    const conditionNode = workflow.nodes.find((node) => node.type === 'condition');
    const actionNode = workflow.nodes.find((node) => node.type === 'action');
    if (!triggerNode || !actionNode) return;
    onSave({
      name: name.trim(),
      icon,
      trigger: triggerNode.config.trigger,
      condition: conditionNode?.config ?? { conditions: [] },
      effect: actionNode.config,
      workflow,
    });
  }

  return (
    <Modal
      title={t(mode === 'edit' ? 'dialogEdit' : 'dialogNew')}
      description={t('workflowHint')}
      scope={projectKey}
      onClose={onClose}
      wide
    >
      <Stack
        as="form"
        gap={4}

        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Stack gap={2}>
          <Label htmlFor="action-name">{tCommon('name')}</Label>
          <Inline gap={2} align="stretch" className="flex">
            <SettingsActionIconPicker value={icon} onChange={setIcon} />
            <Input
              id="action-name"
              autoFocus
              required
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('namePlaceholder')}
              className="h-9"
            />
          </Inline>
        </Stack>

        <Stack gap={2}>
          <Label>{t('workflow')}</Label>
          <WorkflowGraphEditor
            workflow={workflow}
            project={project}
            customFields={customFields}
            onChange={(next) => {
              setWorkflow(next);
              preview.reset();
            }}
          />
          {!isValid && (
            <Text as="p" size="sm" tone="muted">
              {t('workflowNeedsAction')}
            </Text>
          )}
        </Stack>

        <Card tone="inset" as="section" pad="tight" gap={2}>
          <div>
            <h3 className="text-sm font-medium">{t('testWorkflow')}</h3>
            <Text as="p" size="xs" tone="muted">
              {t('testWorkflowHint')}
            </Text>
          </div>
          {actionId && project.issues.length > 0 ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Select value={String(issueId)} onValueChange={(value) => setIssueId(Number(value))}>
                <SelectTrigger className="min-w-0 flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {project.issues.slice(0, 100).map((issue) => (
                    <SelectItem key={issue.id} value={String(issue.id)}>
                      {issue.identifier} · {issue.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                disabled={!isValid || preview.isPending || issueId < 1}
                onClick={() => preview.mutate({ actionId, issueId, workflow })}
              >
                {preview.isPending ? t('testing') : t('testWorkflow')}
              </Button>
            </div>
          ) : (
            <Text as="p" size="sm" tone="muted">
              {actionId ? t('testNeedsIssue') : t('testAfterSave')}
            </Text>
          )}
          {preview.data && (
            <Notice>
              {t('testResult', {
                steps: preview.data.path.length,
                actions: preview.data.effects.length,
              })}
            </Notice>
          )}
          {preview.error && <Notice tone="danger">{preview.error.message}</Notice>}
        </Card>

        <Inline
          gap={2}
          align="stretch"
          justify="end"
          padTop={4}
          className="flex justify-end border-t border-border/50"
        >
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            {tCommon('cancel')}
          </Button>
          <Button type="submit" disabled={!isValid || saving}>
            {saving
              ? mode === 'edit'
                ? tCommon('saving')
                : t('creating')
              : t(mode === 'edit' ? 'save' : 'create')}
          </Button>
        </Inline>
      </Stack>
    </Modal>
  );
}
