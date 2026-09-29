'use client';

import { CheckCircle2, CircleAlert, Clock3, ServerCog } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { useProjectProvisioningQuery } from '@/services/projects.service';
import { useViewsQuery } from '@/services/views.service';
import { viewPath } from '@/utils/paths';
import { Box, Inline, Text } from '@/design-system';

// A requested "board" resource names a project view (see packages/db schema:
// project_view) by id, e.g. "board:9". The view may since have been renamed or
// deleted, so the id alone is what the provisioning job keeps as truth.
const BOARD_RESOURCE = /^board:([1-9][0-9]{0,9})$/;

export type RequestedResourceBadge =
  | { kind: 'board'; resource: string; boardId: number; name: string }
  | { kind: 'boardDeleted'; resource: string; boardId: number }
  | { kind: 'other'; resource: string };

// Turns one raw provisioning resource string into what the badge should show: a
// board's current name (linked), a fallback for a board that was since deleted, or
// the resource unchanged for every other kind (workspace, coordinator, terminal,
// files, browser). Pure so the id/name resolution is testable without rendering.
export function classifyRequestedResource(
  resource: string,
  boardNames: ReadonlyMap<number, string>,
): RequestedResourceBadge {
  const board = BOARD_RESOURCE.exec(resource);
  if (!board) return { kind: 'other', resource };
  const boardId = Number(board[1]);
  const name = boardNames.get(boardId);
  return name != null
    ? { kind: 'board', resource, boardId, name }
    : { kind: 'boardDeleted', resource, boardId };
}

export default function OrganizationProjectResources({ projectKey }: { projectKey: string }) {
  const t = useTranslations('organization.resources');
  const provisioning = useProjectProvisioningQuery(projectKey);
  // Resolves board resource ids to their current view name. Loaded alongside the
  // provisioning job so the badges below never render a raw "board:9" id.
  const views = useViewsQuery(projectKey);
  const boardNames = new Map((views.data ?? []).map((view) => [view.id, view.name]));

  if (provisioning.isPending) {
    return (
      <Text as="p" size="sm" tone="muted" className="mb-4">
        {t('loading')}
      </Text>
    );
  }
  if (provisioning.isError) {
    return (
      <Text
        as="p"
        size="sm"
        tone="danger"
        className="mb-4 rounded-md border border-destructive/40 p-3"
      >
        {t('unavailable')}
      </Text>
    );
  }

  const job = provisioning.data;
  const provisioned = new Set(job.result?.resources.map((resource) => resource.kind) ?? []);
  const Icon =
    job.status === 'succeeded' ? CheckCircle2 : job.status === 'failed' ? CircleAlert : Clock3;

  return (
    <Box as="section" marginBottom={4} pad={4} className="rounded-md border bg-card">
      <Inline gap={3} justify="between" wrap align="start">
        <div>
          <h2 className="flex items-center gap-2 text-md font-medium">
            <ServerCog className="size-4 text-muted-foreground" /> {t('title')}
          </h2>
          <Text as="p" size="xs" tone="muted" className="mt-1">
            {t('description')}
          </Text>
        </div>
        <Badge variant="outline" className="gap-1">
          <Icon className="size-3.5" /> {t(`status.${job.status}`)}
        </Badge>
      </Inline>
      <Inline gap={2} marginTop={3} wrap align="stretch">
        {job.requestedResources.map((resource) => {
          const badge = classifyRequestedResource(resource, boardNames);
          if (badge.kind === 'other') {
            return (
              <Badge key={resource} variant={provisioned.has(resource) ? 'secondary' : 'outline'}>
                {badge.resource}
              </Badge>
            );
          }
          if (badge.kind === 'boardDeleted') {
            return (
              <Badge key={resource} variant="outline" className="text-muted-foreground">
                {t('boardDeleted', { id: badge.boardId })}
              </Badge>
            );
          }
          return (
            <Link key={resource} href={viewPath(projectKey, badge.boardId)}>
              <Badge
                variant={provisioned.has(resource) ? 'secondary' : 'outline'}
                className="cursor-pointer hover:underline"
              >
                {badge.name}
              </Badge>
            </Link>
          );
        })}
      </Inline>
      {job.result?.warnings?.map((warning) => (
        <Text as="p" size="xs" tone="warning" key={warning} className="mt-2">
          {warning}
        </Text>
      ))}
      {job.lastError ? (
        <Text as="p" size="xs" tone="danger" className="mt-2">
          {job.lastError}
        </Text>
      ) : null}
    </Box>
  );
}
