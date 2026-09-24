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
    <section className="space-y-3 border-t pt-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-md font-medium">{t('templates')}</h2>
          <p className="text-xs text-muted-foreground">{t('templatesHint')}</p>
        </div>
        {isOwner && (
          <Button type="button" size="sm" variant="outline" onClick={() => setCapturing(true)}>
            <Plus className="size-4" /> {t('captureTemplate')}
          </Button>
        )}
      </div>

      {templates.isPending ? (
        <ListSkeleton rows={2} rowClassName="h-20" />
      ) : templates.data?.length ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {templates.data.map((template) => (
            <article key={template.id} className="rounded-lg border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {template.kind === 'board' ? (
                      <FolderKanban className="size-4" />
                    ) : (
                      <LayoutTemplate className="size-4" />
                    )}
                    <h3 className="truncate text-sm font-medium">{template.name}</h3>
                    <Badge variant="outline">{t(`templateKind.${template.kind}`)}</Badge>
                  </div>
                  {template.description && (
                    <p className="mt-1 text-xs text-muted-foreground">{template.description}</p>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t('templateCounts', {
                      states: template.stateCount,
                      folders: template.folderCount,
                      views: template.viewCount,
                      workflows: template.workflowCount,
                    })}
                  </p>
                </div>
                {isOwner && (
                  <div className="flex shrink-0 gap-1">
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
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          {t('noTemplates')}
        </p>
      )}

      {capturing && (
        <Modal
          title={t('captureTemplate')}
          description={t('captureTemplateHint')}
          scope={projectKey}
          onClose={() => setCapturing(false)}
        >
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void saveTemplate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="template-name">{t('templateName')}</Label>
              <Input
                id="template-name"
                autoFocus
                required
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
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
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="template-description">{t('templateDescription')}</Label>
              <Textarea
                id="template-description"
                maxLength={500}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setCapturing(false)}>
                {tCommon('cancel')}
              </Button>
              <Button type="submit" disabled={!name.trim() || capture.isPending}>
                {capture.isPending ? t('creating') : t('captureTemplate')}
              </Button>
            </div>
          </form>
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
    </section>
  );
}
