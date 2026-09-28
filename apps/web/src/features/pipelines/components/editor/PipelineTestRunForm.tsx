'use client';

import { useState } from 'react';
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
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import type { Pipeline } from '@/lib/api/endpoints/pipelines';
import { cn } from '@/lib/utils';
import { useIssueSearchQuery } from '@/services/issues.service';
import { useTeamProjectOptionsQuery } from '@/services/teams.service';
import PipelineField from './PipelineField';
import { Box, Stack, Text } from '@/design-system';

// The task a test run works on, found by search. A template can run in any project of
// the team, so its project is picked first.
export default function PipelineTestRunForm({
  pipeline,
  pending,
  onStart,
}: {
  pipeline: Pipeline;
  pending: boolean;
  onStart: (issueId: number) => void;
}) {
  const t = useTranslations('pipelines.testRun');
  const [projectKey, setProjectKey] = useState(pipeline.projectKey);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<number | null>(null);
  const projects = useTeamProjectOptionsQuery(pipeline.teamId).data ?? [];
  const search = useIssueSearchQuery(projectKey, useDebouncedValue(query, 250), {
    enabled: true,
  });
  const hits = query.trim() ? (search.data ?? []) : [];

  return (
    <Stack gap={4}>
      {pipeline.projectId === null && (
        <PipelineField label={t('project')}>
          <Select
            value={projectKey ?? undefined}
            onValueChange={(key) => {
              setProjectKey(key);
              setPicked(null);
            }}
          >
            <SelectTrigger className="w-full" aria-label={t('project')}>
              <SelectValue placeholder={t('chooseProject')} />
            </SelectTrigger>
            <SelectContent>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.key}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PipelineField>
      )}
      {projectKey && (
        <PipelineField label={t('task')} htmlFor="test-run-search">
          <Input
            id="test-run-search"
            value={query}
            placeholder={t('search')}
            onChange={(event) => setQuery(event.target.value)}
          />
          <ul className="max-h-60 overflow-y-auto rounded-md border">
            {hits.length === 0 ? (
              <Box as="li" padX={3} padY={2} className="text-sm text-muted-foreground">
                {query.trim() ? t('noMatches') : t('typeToSearch')}
              </Box>
            ) : (
              hits.map((hit) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    className={cn(
                      'flex w-full items-baseline gap-2 px-3 py-1.5 text-start text-sm hover:bg-accent',
                      picked === hit.id && 'bg-accent',
                    )}
                    onClick={() => setPicked(hit.id)}
                  >
                    <Text as="span" size="xs" tone="muted" className="shrink-0 font-mono" dir="ltr">
                      {hit.identifier}
                    </Text>
                    <span className="truncate" dir="auto">
                      {hit.title}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </PipelineField>
      )}
      <div className="flex justify-end">
        <Button disabled={picked === null || pending} onClick={() => picked && onStart(picked)}>
          {t('start')}
        </Button>
      </div>
    </Stack>
  );
}
