'use client';

import Link from 'next/link';
import {
  CheckCircle2,
  Clock3,
  Copy,
  FolderOpen,
  Loader2,
  LockKeyhole,
  RotateCw,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { filesPath } from '@/utils/paths';
import {
  useDocumentMarkdownSyncQuery,
  useRetryDocumentMarkdownSync,
} from '../services/documents.service';
import { documentMarkdownPath, documentMarkdownSyncPresentation } from './documentMarkdownSync';

export default function DocumentMarkdownSyncStatus({
  projectKey,
  documentId,
  documentVersion,
  canRetry,
}: {
  projectKey: string;
  documentId: number;
  documentVersion: number;
  canRetry: boolean;
}) {
  const t = useTranslations('documents.markdownSync');
  const status = useDocumentMarkdownSyncQuery(projectKey, documentId, documentVersion);
  const retry = useRetryDocumentMarkdownSync(projectKey, documentId, documentVersion);
  const value = status.data;
  const path = value?.path ?? documentMarkdownPath(documentId);
  const state = value?.state ?? 'pending';
  const presentation = documentMarkdownSyncPresentation(state);
  const loading = status.isLoading && !value;

  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(path);
      toast.success(t('pathCopied'));
    } catch {
      toast.error(t('copyFailed'));
    }
  };

  const retrySync = async () => {
    try {
      await retry.mutateAsync();
    } catch {
      toast.error(t('retryFailed'));
    }
  };

  const statusIcon = loading ? (
    <Loader2 className="size-3.5 animate-spin" />
  ) : state === 'synced' ? (
    <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />
  ) : state === 'private_not_exported' ? (
    <LockKeyhole className="size-3.5 text-muted-foreground" />
  ) : (
    <Clock3 className="size-3.5 text-amber-600 dark:text-amber-400" />
  );

  return (
    <section className="mt-5 rounded-lg border bg-muted/20 p-3" aria-label={t('label')}>
      <div className="flex items-center justify-between gap-3">
        {presentation.canOpenFiles ? (
          <Link
            href={filesPath(projectKey)}
            title={t('openFiles')}
            className="flex min-w-0 items-center gap-2 rounded-sm text-xs font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {statusIcon}
            <span>{t(presentation.labelKey)}</span>
          </Link>
        ) : (
          <div className="flex min-w-0 items-center gap-2 text-xs font-medium">
            {statusIcon}
            <span>{loading ? t('checking') : t(presentation.labelKey)}</span>
          </div>
        )}
        {presentation.canRetry && canRetry && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={retry.isPending}
            onClick={() => void retrySync()}
          >
            {retry.isPending ? <Loader2 className="animate-spin" /> : <RotateCw />}
            {retry.isPending ? t('retrying') : t('retry')}
          </Button>
        )}
      </div>

      <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
        {loading ? t('checkingHint') : t(presentation.hintKey)}
      </p>

      <div className="mt-2 flex items-center gap-1 rounded-md border bg-background px-2 py-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            {presentation.canOpenFiles ? (
              <Link
                href={filesPath(projectKey)}
                className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm font-mono text-[11px] text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{path}</span>
              </Link>
            ) : (
              <span className="flex min-w-0 flex-1 items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                <span className="truncate">{path}</span>
              </span>
            )}
          </TooltipTrigger>
          <TooltipContent>{presentation.canOpenFiles ? t('openFiles') : path}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="shrink-0"
              aria-label={t('copyPath')}
              onClick={() => void copyPath()}
            >
              <Copy />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('copyPath')}</TooltipContent>
        </Tooltip>
      </div>
    </section>
  );
}
