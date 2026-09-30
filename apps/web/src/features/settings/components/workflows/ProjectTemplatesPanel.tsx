'use client';

import { useState } from 'react';
import { FolderKanban, LayoutTemplate, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ProjectDetail } from '@/lib/api/endpoints/projects';
import type { ProjectTemplate } from '@/lib/api/endpoints/projectTemplates';
import {
  useApplyProjectTemplate,
  useCaptureProjectTemplate,
  useDeleteProjectTemplate,
  useProjectTemplates,
} from '@/services/projectTemplates.service';
import Modal from '@/components/common/overlay/Modal';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { Badge } from '@/components/ui/badge';
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
import { Textarea } from '@/components/ui/textarea';
import SettingsConfirmDeleteDialog from '@/features/settings/components/crud/SettingsConfirmDeleteDialog';

import { Box, Card, EmptyState, Grid, Inline, Section, Stack, Text } from '@/design-system';

export function ProjectTemplatesPanel({ project }: { project: ProjectDetail }) {
  const t = useTranslations('settings.actions');
  const tCommon = useTranslations('common');
  const projectKey = project.project.key;
  const templates = useProjectTemplates(projectKey);
  const capture = useCaptureProjectTemplate(projectKey);
  const apply = useApplyProjectTemplate(projectKey);
  const remove = useDeleteProjectTemplate(projectKey);
  const [capturing, setCapturing] = useState(false);
  const [deleting, setDeleting] = useState<ProjectTemplate | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<ProjectTemplate['kind']>('board');
  const isOwner = project.viewer.role === 'owner';

  async function saveTemplate() {
    if (!name.trim()) return;
    await capture.mutateAsync({ name: name.trim(), description: description.trim(), kind });
    setName('');
    setDescription('');
    setCapturing(false);
  }

  return (
    <Section
      title={t('templates')}
      description={t('templatesHint')}
      actions={
        isOwner ? (
          <Button type="button" size="sm" variant="outline" onClick={() => setCapturing(true)}>
            <Plus className="size-4" /> {t('captureTemplate')}
          </Button>
        ) : undefined
      }
    >
      {templates.isPending ? (
        <ListSkeleton rows={2} rowClassName="h-20" />
      ) : templates.data?.length ? (
        <Grid columns={2}>
          {templates.data.map((template) => (
            <Card as="article" key={template.id}>
              <Inline
                gap={3}
                align="start"
                justify="between"
                className="flex items-start justify-between"
              >
                <div className="min-w-0">
                  <Inline gap={2} className="flex items-center">
                    {template.kind === 'board' ? (
                      <FolderKanban className="size-4" />
                    ) : (
                      <LayoutTemplate className="size-4" />
                    )}
                    <h3 className="truncate text-sm font-medium">{template.name}</h3>
                    <Badge variant="outline">{t(`templateKind.${template.kind}`)}</Badge>
                  </Inline>
                  {template.description && (
                    <Box as="p" marginTop={1}>
                      <Text as="span" size="xs" tone="muted">
                        {template.description}
                      </Text>
                    </Box>
                  )}
                  <Box as="p" marginTop={2}>
                    <Text as="span" size="xs" tone="muted">
                      {t('templateCounts', {
                        states: template.stateCount,
                        folders: template.folderCount,
                        views: template.viewCount,
                        workflows: template.workflowCount,
                      })}
                    </Text>
                  </Box>
                </div>
                {isOwner && (
                  <Inline gap={1} align="stretch" className="flex shrink-0">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={apply.isPending}
                      onClick={() => apply.mutate(template.id)}
                    >
                      {t('applyTemplate')}
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-8"
                      onClick={() => setDeleting(template)}
                      aria-label={t('deleteTemplate')}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </Inline>
                )}
              </Inline>
            </Card>
          ))}
        </Grid>
      ) : (
        <EmptyState boxed>{t('noTemplates')}</EmptyState>
      )}

      {capturing && (
        <Modal
          title={t('captureTemplate')}
          description={t('captureTemplateHint')}
          scope={projectKey}
          onClose={() => setCapturing(false)}
        >
          <Stack
            as="form"
            gap={4}

            onSubmit={(event) => {
              event.preventDefault();
              void saveTemplate();
            }}
          >
            <Stack gap={2}>
              <Label htmlFor="template-name">{t('templateName')}</Label>
              <Input
                id="template-name"
                autoFocus
                required
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Stack>
            <Stack gap={2}>
              <Label htmlFor="template-kind">{t('templateType')}</Label>
              <Select
                value={kind}
                onValueChange={(value) => setKind(value as ProjectTemplate['kind'])}
              >
                <SelectTrigger id="template-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="board">{t('templateKind.board')}</SelectItem>
                  <SelectItem value="project">{t('templateKind.project')}</SelectItem>
                </SelectContent>
              </Select>
            </Stack>
            <Stack gap={2}>
              <Label htmlFor="template-description">{t('templateDescription')}</Label>
              <Textarea
                id="template-description"
                maxLength={500}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </Stack>
            <Inline gap={2} align="stretch" justify="end" className="flex justify-end">
              <Button type="button" variant="ghost" onClick={() => setCapturing(false)}>
                {tCommon('cancel')}
              </Button>
              <Button type="submit" disabled={!name.trim() || capture.isPending}>
                {capture.isPending ? t('creating') : t('captureTemplate')}
              </Button>
            </Inline>
          </Stack>
        </Modal>
      )}

      {deleting && (
        <SettingsConfirmDeleteDialog
          title={t('deleteTemplateTitle', { name: deleting.name })}
          confirmLabel={t('deleteTemplate')}
          message={t('deleteTemplateMessage')}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await remove.mutateAsync(deleting.id);
            setDeleting(null);
          }}
        />
      )}
    </Section>
  );
}
