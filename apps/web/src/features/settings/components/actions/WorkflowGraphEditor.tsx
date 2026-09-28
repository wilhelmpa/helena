'use client';

import type { ReactNode } from 'react';
import { GitBranch, Play, Plus, Trash2, Zap } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { CustomField } from '@/lib/api/endpoints/customFields';
import type { ProjectDetail } from '@/lib/api/endpoints/projects';
import type {
  ActionEffect,
  WorkflowBranch,
  WorkflowDefinition,
  WorkflowNode,
} from '@/lib/api/endpoints/actions';
import type { FilterSet } from '@/utils/filters';
import FilterBar from '@/components/layout/FilterBar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SettingsEffectEditor } from './SettingsEffectEditor';
import { uuid } from '@/utils/uuid';

export function WorkflowGraphEditor({
  workflow,
  project,
  customFields,
  onChange,
}: {
  workflow: WorkflowDefinition;
  project: ProjectDetail;
  customFields: CustomField[];
  onChange: (workflow: WorkflowDefinition) => void;
}) {
  const t = useTranslations('settings.actions');
  const trigger = workflow.nodes.find((node) => node.type === 'trigger');
  if (!trigger) return null;

  function updateNode(nodeId: string, config: WorkflowNode['config']) {
    onChange({
      ...workflow,
      nodes: workflow.nodes.map((node) =>
        node.id === nodeId ? ({ ...node, config } as WorkflowNode) : node,
      ),
    });
  }

  function addNode(source: string, branch: WorkflowBranch, type: 'condition' | 'action') {
    if (workflow.nodes.length >= 24 || edgeFrom(source, branch)) return;
    const id = `node-${uuid().slice(0, 8)}`;
    const sourceNode = workflow.nodes.find((node) => node.id === source)!;
    const position = {
      x: sourceNode.position.x + (branch === 'false' ? 260 : 0),
      y: sourceNode.position.y + 180,
    };
    const node: WorkflowNode =
      type === 'condition'
        ? { id, type, config: { conditions: [] }, position }
        : { id, type, config: {}, position };
    onChange({
      ...workflow,
      nodes: [...workflow.nodes, node],
      edges: [...workflow.edges, { id: `edge-${uuid().slice(0, 8)}`, source, target: id, branch }],
    });
  }

  function removeLeaf(nodeId: string) {
    if (workflow.edges.some((edge) => edge.source === nodeId)) return;
    const node = workflow.nodes.find((candidate) => candidate.id === nodeId);
    const actionCount = workflow.nodes.filter((candidate) => candidate.type === 'action').length;
    if (!node || node.type === 'trigger' || (node.type === 'action' && actionCount === 1)) return;
    onChange({
      ...workflow,
      nodes: workflow.nodes.filter((candidate) => candidate.id !== nodeId),
      edges: workflow.edges.filter((edge) => edge.target !== nodeId),
    });
  }

  function edgeFrom(source: string, branch: WorkflowBranch) {
    return workflow.edges.find((edge) => edge.source === source && edge.branch === branch);
  }

  function child(source: string, branch: WorkflowBranch) {
    const edge = edgeFrom(source, branch);
    return edge ? workflow.nodes.find((node) => node.id === edge.target) : undefined;
  }

  function addButtons(source: string, branch: WorkflowBranch) {
    return (
      <div className="flex flex-wrap justify-center gap-1.5">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => addNode(source, branch, 'condition')}
        >
          <Plus className="size-3.5" /> {t('addConditionStep')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => addNode(source, branch, 'action')}
        >
          <Plus className="size-3.5" /> {t('addActionStep')}
        </Button>
      </div>
    );
  }

  function renderNode(node: WorkflowNode, branchLabel?: string): ReactNode {
    const outgoing = workflow.edges.some((edge) => edge.source === node.id);
    const removable =
      node.type !== 'trigger' &&
      !outgoing &&
      (node.type !== 'action' ||
        workflow.nodes.filter((candidate) => candidate.type === 'action').length > 1);
    const icon =
      node.type === 'trigger' ? (
        <Play className="size-4" />
      ) : node.type === 'condition' ? (
        <GitBranch className="size-4" />
      ) : (
        <Zap className="size-4" />
      );
    return (
      <div key={node.id} className="min-w-0 space-y-3">
        {branchLabel && (
          <div className="flex justify-center">
            <Badge variant="outline">{branchLabel}</Badge>
          </div>
        )}
        <div className="rounded-lg border bg-background p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              {icon}
              {t(`nodeType.${node.type}`)}
            </div>
            {removable && (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-7"
                onClick={() => removeLeaf(node.id)}
                aria-label={t('removeStep')}
              >
                <Trash2 className="size-3.5" />
              </Button>
            )}
          </div>
          {node.type === 'trigger' && (
            <Select
              value={node.config.trigger}
              onValueChange={(trigger) =>
                updateNode(node.id, {
                  trigger: trigger as 'manual' | 'issue_state_changed' | 'issue_comment_added',
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">{t('triggerManual')}</SelectItem>
                <SelectItem value="issue_state_changed">{t('triggerStateChanged')}</SelectItem>
                <SelectItem value="issue_comment_added">{t('triggerCommentAdded')}</SelectItem>
              </SelectContent>
            </Select>
          )}
          {node.type === 'condition' && (
            <FilterBar
              filters={node.config as FilterSet}
              onChange={(config) => updateNode(node.id, config)}
              project={project}
              customFields={customFields}
            />
          )}
          {node.type === 'action' && (
            <SettingsEffectEditor
              effect={node.config as ActionEffect}
              project={project}
              onChange={(config) => updateNode(node.id, config)}
            />
          )}
        </div>
        {node.type === 'condition' ? (
          <div className="grid gap-4 md:grid-cols-2">
            {(['true', 'false'] as const).map((branch) => {
              const next = child(node.id, branch);
              return (
                <div key={branch} className="space-y-3 border-t pt-3">
                  {next ? (
                    renderNode(next, t(`branch.${branch}`))
                  ) : (
                    <div className="space-y-2">
                      <div className="text-center text-xs text-muted-foreground">
                        {t(`branch.${branch}`)}
                      </div>
                      {addButtons(node.id, branch)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : child(node.id, 'always') ? (
          <div className="border-t pt-3">{renderNode(child(node.id, 'always')!)}</div>
        ) : (
          <div className="border-t pt-3">{addButtons(node.id, 'always')}</div>
        )}
      </div>
    );
  }

  return <div className="rounded-lg bg-muted/20 p-3 md:p-4">{renderNode(trigger)}</div>;
}
