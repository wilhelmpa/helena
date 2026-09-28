'use client';

import { useTranslations } from 'next-intl';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { PipelineContextAgent, ProjectPipeline } from '@/lib/api/endpoints/pipelines';
import { Inline, Stack, Text } from '@/design-system';

const AUTO = 'auto';

// The agent of each role in the project: one the project names, or the one the role's
// own rule finds.
export default function PipelineRoleMapping({
  entry,
  agents,
  editable,
  onChange,
}: {
  entry: ProjectPipeline;
  agents: PipelineContextAgent[];
  editable: boolean;
  onChange: (roles: Record<string, number>) => void;
}) {
  const t = useTranslations('pipelines.project');
  const automatic = (role: ProjectPipeline['resolvedRoles'][number]) =>
    role.source === 'mapping'
      ? t('automaticPlain')
      : t('automatic', { agent: role.agent ? `@${role.agent.username}` : t('nobody') });

  const set = (key: string, value: string) => {
    const roles = { ...entry.roles };
    if (value === AUTO) delete roles[key];
    else roles[key] = Number(value);
    onChange(roles);
  };

  return (
    <Stack gap={2}>
      <Text as="p" size="xs" className="font-medium">
        {t('roles')}
      </Text>
      <div className="grid gap-2 sm:grid-cols-2">
        {entry.resolvedRoles.map((role) => {
          const mapped = entry.roles[role.key];
          return (
            <Inline gap={2} key={role.key} className="text-sm">
              <span className="w-32 shrink-0 truncate text-muted-foreground" dir="auto">
                {role.name}
              </span>
              {editable ? (
                <Select
                  value={mapped === undefined ? AUTO : String(mapped)}
                  onValueChange={(value) => set(role.key, value)}
                >
                  <SelectTrigger size="sm" className="min-w-0 flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={AUTO}>{automatic(role)}</SelectItem>
                    {agents.map((agent) => (
                      <SelectItem key={agent.id} value={String(agent.id)}>
                        {agent.name} (@{agent.username})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <span className="truncate">
                  {role.agent ? `${role.agent.name} (@${role.agent.username})` : t('nobody')}
                </span>
              )}
            </Inline>
          );
        })}
      </div>
    </Stack>
  );
}
