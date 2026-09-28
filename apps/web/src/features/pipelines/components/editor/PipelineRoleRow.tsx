'use client';

import { Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { PipelineRole, RoleMatch } from '@/lib/api/endpoints/pipelines';
import { usePipelineEditor } from '../../context/pipelineEditor';
import { removeRole, updateRole } from '../../utils/editorState';
import { roleIssues } from '../../utils/issueDisplay';
import PipelineIssueList from '../PipelineIssueList';
import { Box, Stack } from '@/design-system';

const MATCH_TYPES = ['coordinator', 'capability', 'template', 'none'] as const;

// A role and the rule that finds its agent in a project that names none for it.
export default function PipelineRoleRow({ role }: { role: PipelineRole }) {
  const t = useTranslations('pipelines.roles');
  const { editable, context, issues, change } = usePipelineEditor();
  const set = (next: PipelineRole) => change((current) => updateRole(current, role.key, next));
  const templates = context?.templates ?? [];
  const matchOf = (type: RoleMatch['type']): RoleMatch =>
    type === 'capability'
      ? { type, capability: '' }
      : type === 'template'
        ? { type, agentId: templates[0]?.id ?? 0 }
        : { type };
  const own = roleIssues(issues, role.key);

  if (!editable)
    return (
      <Box as="li" padY={2} className="flex flex-wrap items-baseline gap-x-3 text-sm">
        <span className="font-medium" dir="auto">
          {role.name}
        </span>
        <span className="text-muted-foreground">
          {t(`matchTypes.${role.match.type}`)}
          {role.match.type === 'capability' && `: ${role.match.capability}`}
        </span>
        <PipelineIssueList issues={own} className="w-full" />
      </Box>
    );

  return (
    <Box
      as="li"
      padY={2}
      className="grid items-start gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
    >
      <Input
        value={role.name}
        maxLength={80}
        dir="auto"
        aria-label={t('name')}
        onChange={(event) => set({ ...role, name: event.target.value })}
      />
      <Stack gap={2}>
        <Select
          value={role.match.type}
          onValueChange={(type) => set({ ...role, match: matchOf(type as RoleMatch['type']) })}
        >
          <SelectTrigger className="w-full" aria-label={t('match')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MATCH_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {t(`matchTypes.${type}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {role.match.type === 'capability' && (
          <Input
            value={role.match.capability}
            placeholder={t('capability')}
            aria-label={t('capability')}
            onChange={(event) =>
              set({ ...role, match: { type: 'capability', capability: event.target.value } })
            }
          />
        )}
        {role.match.type === 'template' && (
          <Select
            value={role.match.agentId ? String(role.match.agentId) : undefined}
            onValueChange={(id) =>
              set({ ...role, match: { type: 'template', agentId: Number(id) } })
            }
          >
            <SelectTrigger className="w-full" aria-label={t('templateAgent')}>
              <SelectValue placeholder={t('chooseAgent')} />
            </SelectTrigger>
            <SelectContent>
              {templates.map((agent) => (
                <SelectItem key={agent.id} value={String(agent.id)}>
                  {agent.name} (@{agent.username})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Stack>
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground hover:text-destructive"
        aria-label={t('remove')}
        title={t('remove')}
        onClick={() => change((current) => removeRole(current, role.key))}
      >
        <Trash2 />
      </Button>
      <PipelineIssueList issues={own} className="sm:col-span-3" />
    </Box>
  );
}
