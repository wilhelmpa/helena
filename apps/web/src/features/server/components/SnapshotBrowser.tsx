'use client';

import { ListBox, Card } from '@/design-system';
import { useState } from 'react';
import { ArrowLeft, File, Folder, History, Link2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import StatusBadge from '@/components/common/page/StatusBadge';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { BackupListing } from '@/lib/api/endpoints/server';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/utils/dates';
import { useRestore, useSnapshotFolder, useStartRestore } from '../services/server.service';
import { formatDiskSize, parentPath, pathSteps, restoreTarget } from '../utils/serverFormat';

type Entry = BackupListing['entries'][number];

// A snapshot, folder by folder, and restoring one file or folder out of it. A copy lands in
// a new folder (the owner's own files under ~/Wiederhergestellt, everything else in the
// root-only restore folder); putting it back where it was first moves what is there aside,
// and needs the path typed again.
export default function SnapshotBrowser({
  snapshot,
  ownerHome,
  onClose,
}: {
  snapshot: string;
  ownerHome: string | null;
  onClose: () => void;
}) {
  const t = useTranslations('server.backup.browse');
  const [path, setPath] = useState(ownerHome ?? '/');
  const [restoring, setRestoring] = useState<Entry | null>(null);
  const folder = useSnapshotFolder(snapshot, path);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="large" className="flex max-h-[90vh] flex-col">
        <DialogHeader>
          <DialogTitle>{t('title', { snapshot: snapshot.slice(0, 8) })}</DialogTitle>
          <DialogDescription>{t('explain')}</DialogDescription>
        </DialogHeader>
        {restoring ? (
          <RestoreForm
            snapshot={snapshot}
            entry={restoring}
            ownerHome={ownerHome}
            onBack={() => setRestoring(null)}
          />
        ) : (
          <>
            <nav
              aria-label={t('path')}
              className="flex flex-wrap items-center gap-0.5 text-sm"
              dir="ltr"
            >
              {pathSteps(path).map((step, index, steps) => (
                <span key={step.path} className="flex items-center gap-0.5">
                  {index > 1 && <span className="text-muted-foreground">/</span>}
                  <button
                    type="button"
                    onClick={() => setPath(step.path)}
                    className={cn(
                      'rounded-sm px-1 hover:bg-sidebar-accent',
                      index === steps.length - 1 && 'font-medium',
                    )}
                  >
                    {step.name}
                  </button>
                </span>
              ))}
            </nav>
            <ListBox className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 overflow-y-auto">
                {folder.isPending ? (
                  <ListSkeleton rows={6} className="p-2" rowClassName="h-8" />
                ) : folder.isError ? (
                  <p className="p-3 text-sm text-muted-foreground">{t('notFound')}</p>
                ) : (
                  <ul className="divide-y divide-sidebar-border">
                    {path !== '/' && (
                      <li>
                        <button
                          type="button"
                          onClick={() => setPath(parentPath(path))}
                          className="flex h-9 w-full items-center gap-2 px-3 text-sm hover:bg-sidebar-accent"
                        >
                          <ArrowLeft className="size-4 text-muted-foreground" />
                          {t('up')}
                        </button>
                      </li>
                    )}
                    {(folder.data?.entries ?? []).map((entry) => (
                      <li key={entry.path} className="flex min-h-9 items-center gap-2 px-3 text-sm">
                        {entry.type === 'dir' ? (
                          <button
                            type="button"
                            onClick={() => setPath(entry.path)}
                            className="flex min-w-0 flex-1 items-center gap-2 text-start hover:underline"
                          >
                            <Folder className="size-4 shrink-0 text-muted-foreground" />
                            <span className="truncate" dir="auto">
                              {entry.name}
                            </span>
                          </button>
                        ) : (
                          <span className="flex min-w-0 flex-1 items-center gap-2">
                            {entry.type === 'symlink' ? (
                              <Link2 className="size-4 shrink-0 text-muted-foreground" />
                            ) : (
                              <File className="size-4 shrink-0 text-muted-foreground" />
                            )}
                            <span className="truncate" dir="auto">
                              {entry.name}
                            </span>
                          </span>
                        )}
                        <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                          {entry.type === 'file' ? formatDiskSize(entry.size) : ''}
                          {entry.mtime ? ` · ${formatDateTime(entry.mtime)}` : ''}
                        </span>
                        <Button variant="ghost" size="sm" onClick={() => setRestoring(entry)}>
                          <History />
                          <span className="sr-only sm:not-sr-only">{t('restore')}</span>
                        </Button>
                      </li>
                    ))}
                    {folder.data && folder.data.entries.length === 0 && (
                      <li className="p-3 text-sm text-muted-foreground">{t('empty')}</li>
                    )}
                  </ul>
                )}
              </div>
            </ListBox>
            {folder.data?.truncated && (
              <p className="text-xs text-muted-foreground">{t('truncated')}</p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RestoreForm({
  snapshot,
  entry,
  ownerHome,
  onBack,
}: {
  snapshot: string;
  entry: Entry;
  ownerHome: string | null;
  onBack: () => void;
}) {
  const t = useTranslations('server.backup.browse');
  const start = useStartRestore();
  const [mode, setMode] = useState<'copy' | 'original'>('copy');
  const [confirm, setConfirm] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useRestore(jobId);
  const target = restoreTarget(entry.path, ownerHome);

  if (jobId) {
    const state = job.data?.state ?? 'queued';
    return (
      <div className="space-y-3">
        <p className="flex items-center gap-2 text-sm">
          <StatusBadge
            status={state === 'done' ? 'success' : state === 'failed' ? 'danger' : 'running'}
            dotOnly
          />
          {t(`job.${state}`)}
        </p>
        {job.data?.location && (
          <p className="text-sm">
            {t('job.location')}{' '}
            <code className="font-mono text-xs" dir="ltr">
              {job.data.location}
            </code>
          </p>
        )}
        {job.data?.movedAside && (
          <p className="text-sm">
            {t('job.movedAside')}{' '}
            <code className="font-mono text-xs" dir="ltr">
              {job.data.movedAside}
            </code>
          </p>
        )}
        {job.data?.error && <p className="text-sm text-destructive">{job.data.error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onBack}>
            {t('back')}
          </Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm">
        {t('restoreWhat')}{' '}
        <code className="font-mono text-xs break-all" dir="ltr">
          {entry.path}
        </code>
      </p>
      <div role="radiogroup" aria-label={t('restoreWhat')} className="space-y-2">
        {(['copy', 'original'] as const).map((value) => (
          <Card
            as="button"
            type="button"
            role="radio"
            tone="inset"
            interactive
            selected={mode === value}
            pad="tight"
            gap={1}
            key={value}
            aria-checked={mode === value}
            onClick={() => setMode(value)}
            className="w-full text-sm"
          >
            <span className="block font-medium">{t(`mode.${value}`)}</span>
            <span className="block text-xs text-muted-foreground">
              {value === 'copy'
                ? target === 'home'
                  ? t('mode.copyHome')
                  : t('mode.copyRoot')
                : t('mode.originalExplain')}
            </span>
          </Card>
        ))}
      </div>
      {mode === 'original' && (
        <label className="block space-y-1 text-sm">
          <span className="text-xs text-muted-foreground">{t('confirmPath')}</span>
          <Input
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            placeholder={entry.path}
            dir="ltr"
            className="font-mono"
          />
        </label>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onBack}>
          {t('back')}
        </Button>
        <Button
          variant={mode === 'original' ? 'destructive' : 'default'}
          disabled={start.isPending || (mode === 'original' && confirm !== entry.path)}
          onClick={() =>
            start.mutate(
              {
                snapshot,
                path: entry.path,
                mode,
                ...(mode === 'original' ? { confirm } : {}),
              },
              { onSuccess: (created) => setJobId(created.id) },
            )
          }
        >
          {mode === 'original' ? t('startOriginal') : t('startCopy')}
        </Button>
      </DialogFooter>
    </div>
  );
}
