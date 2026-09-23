'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { ChevronRight, Download, File, FileText, Folder, FolderOpen, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { WorkspacePageHeader } from '@/components/layout/WorkspaceHeader';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { usePermissions } from '@/hooks/usePermissions';
import { downloadProjectFile } from '@/lib/api/endpoints/projectFiles';
import {
  useCreateProjectText,
  useProjectFilesQuery,
  useProjectTextQuery,
} from './services/projectFiles.service';
import { projectFileChild, projectFileParent } from './projectFilePath';

export default function ProjectFilesPage() {
  const t = useTranslations('documents.files');
  const params = useParams<{ projectKey: string }>();
  const projectKey = params.projectKey;
  const { can } = usePermissions();
  const canCreate = can('documents', 'create');
  const [path, setPath] = useState('');
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [filename, setFilename] = useState('');
  const [content, setContent] = useState('');
  const [downloadFailed, setDownloadFailed] = useState(false);
  const files = useProjectFilesQuery(projectKey, path);
  const preview = useProjectTextQuery(projectKey, previewPath);
  const create = useCreateProjectText(projectKey);
  const crumbs = path.split('/').filter(Boolean);

  const submit = async () => {
    const name = filename.trim();
    if (!name) return;
    await create.mutateAsync({ path: projectFileChild(path, name), content });
    setCreating(false);
    setFilename('');
    setContent('');
  };

  const download = async (filePath: string) => {
    setDownloadFailed(false);
    try {
      await downloadProjectFile(projectKey, filePath);
    } catch {
      setDownloadFailed(true);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <section className="flex min-w-0 flex-1 flex-col">
        <WorkspacePageHeader
          title={t('title')}
          description={t('description')}
          actions={
            canCreate ? (
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus className="size-4" />
                {t('newText')}
              </Button>
            ) : null
          }
        />

        <nav
          className="flex min-h-11 items-center gap-1 overflow-x-auto border-b px-4 text-sm md:px-6"
          aria-label={t('breadcrumb')}
        >
          <button
            type="button"
            className="rounded px-1.5 py-1 font-medium hover:bg-accent"
            onClick={() => {
              setPath('');
              setPreviewPath(null);
            }}
          >
            {projectKey}
          </button>
          {crumbs.map((crumb, index) => {
            const target = crumbs.slice(0, index + 1).join('/');
            return (
              <span key={target} className="flex items-center gap-1">
                <ChevronRight className="size-3.5 text-muted-foreground" />
                <button
                  type="button"
                  className="rounded px-1.5 py-1 hover:bg-accent"
                  onClick={() => {
                    setPath(target);
                    setPreviewPath(null);
                  }}
                >
                  {crumb}
                </button>
              </span>
            );
          })}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
          {downloadFailed ? (
            <p className="mb-3 text-sm text-destructive" role="alert">
              {t('downloadError')}
            </p>
          ) : null}
          {path ? (
            <button
              type="button"
              className="mb-2 flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
              onClick={() => {
                setPath(projectFileParent(path));
                setPreviewPath(null);
              }}
            >
              <FolderOpen className="size-4 text-muted-foreground" />
              {t('parent')}
            </button>
          ) : null}
          {files.isPending ? (
            <p className="text-sm text-muted-foreground">{t('loading')}</p>
          ) : files.isError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4">
              <p className="text-sm text-destructive">{t('loadError')}</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => files.refetch()}>
                {t('retry')}
              </Button>
            </div>
          ) : files.data.items.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <Folder className="mx-auto size-8 text-muted-foreground" />
              <p className="mt-3 text-sm text-muted-foreground">{t('empty')}</p>
            </div>
          ) : (
            <ul className="divide-y rounded-lg border">
              {files.data.items.map((item) => (
                <li key={item.path} className="flex items-center gap-3 px-3 py-2.5">
                  {item.kind === 'folder' ? (
                    <Folder className="size-4 shrink-0 text-amber-500" />
                  ) : item.previewable ? (
                    <FileText className="size-4 shrink-0 text-blue-500" />
                  ) : (
                    <File className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:underline"
                    onClick={() => {
                      if (item.kind === 'folder') {
                        setPath(item.path);
                        setPreviewPath(null);
                      } else if (item.previewable) {
                        setPreviewPath(item.path);
                      } else {
                        void download(item.path);
                      }
                    }}
                  >
                    {item.name}
                  </button>
                  {item.sizeBytes != null ? (
                    <span className="text-xs text-muted-foreground">
                      {t('bytes', { count: item.sizeBytes })}
                    </span>
                  ) : null}
                  {item.kind === 'file' ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      title={t('download')}
                      onClick={() => void download(item.path)}
                    >
                      <Download className="size-4" />
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {previewPath ? (
        <aside className="flex w-[min(46%,680px)] min-w-80 flex-col border-s bg-card">
          <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold">{previewPath.split('/').at(-1)}</h2>
              <p className="truncate text-xs text-muted-foreground">{previewPath}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setPreviewPath(null)}>
              {t('close')}
            </Button>
          </header>
          <div className="min-h-0 flex-1 overflow-auto p-4">
            {preview.isPending ? (
              <p className="text-sm text-muted-foreground">{t('loadingPreview')}</p>
            ) : preview.isError ? (
              <p className="text-sm text-destructive">{t('previewError')}</p>
            ) : (
              <pre className="font-mono text-sm leading-6 break-words whitespace-pre-wrap">
                {preview.data.content}
              </pre>
            )}
          </div>
        </aside>
      ) : null}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('createTitle')}</DialogTitle>
            <DialogDescription>{t('createDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={filename}
              onChange={(event) => setFilename(event.target.value)}
              placeholder={t('filenamePlaceholder')}
              aria-label={t('filename')}
            />
            <Textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder={t('contentPlaceholder')}
              className="min-h-56 font-mono"
              aria-label={t('content')}
            />
            {create.isError ? (
              <p className="text-sm text-destructive">{create.error.message}</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>
              {t('cancel')}
            </Button>
            <Button disabled={!filename.trim() || create.isPending} onClick={() => void submit()}>
              {create.isPending ? t('creating') : t('create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
