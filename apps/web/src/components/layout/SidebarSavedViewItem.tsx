'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, Star } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { View, ViewFolder } from '@/lib/api/endpoints/views';
import { enableViewShare, disableViewShare } from '@/lib/api/endpoints/share';
import { usePermissions } from '@/hooks/usePermissions';
import { useReorderViews, useSetViewFavorite, useUpdateView } from '@/services/views.service';
import { qk } from '@/services/queryKeys';
import { shareViewPath, viewPath } from '@/utils/paths';
import ShareDialog from '@/components/common/share/ShareDialog';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export default function SidebarSavedViewItem({
  view,
  views,
  folders,
  projectKey,
  onEdit,
  onDelete,
}: {
  view: View;
  views: View[];
  folders: ViewFolder[];
  projectKey: string;
  onEdit: (view: View) => void;
  onDelete: (view: View) => Promise<void>;
}) {
  const t = useTranslations('views');
  const common = useTranslations('common');
  const { can } = usePermissions();
  const pathname = usePathname();
  const qc = useQueryClient();
  const favorite = useSetViewFavorite(projectKey);
  const update = useUpdateView(projectKey);
  const reorder = useReorderViews(projectKey);
  const [sharing, setSharing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const href = viewPath(projectKey, view.id);
  const siblings = views
    .filter((item) => item.folderId === view.folderId)
    .sort((a, b) => a.position - b.position || a.id - b.id);
  const index = siblings.findIndex((item) => item.id === view.id);

  function move(delta: number) {
    const ordered = siblings.map((item) => item.id);
    const [id] = ordered.splice(index, 1);
    ordered.splice(index + delta, 0, id!);
    reorder.mutate({ folderId: view.folderId, orderedIds: ordered });
  }

  async function enableShare(extended: boolean) {
    const { token } = await enableViewShare(view.id, extended);
    await qc.invalidateQueries({ queryKey: qk.views(projectKey) });
    return token;
  }

  async function disableShare() {
    await disableViewShare(view.id);
    await qc.invalidateQueries({ queryKey: qk.views(projectKey) });
  }

  return (
    <div className="helena-saved-view">
      <Link
        href={href}
        className={`helena-tree-link helena-tree-child ${pathname === href ? 'is-active' : ''}`}
        aria-current={pathname === href ? 'page' : undefined}
      >
        <span className="min-w-0 flex-1 truncate">{view.name}</span>
        {view.favorite && (
          <Star size={12} className="fill-current text-amber-500" aria-label={t('favorite')} />
        )}
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="helena-tree-toggle"
            aria-label={t('options')}
            title={t('options')}
          >
            <MoreHorizontal size={14} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuItem
            onSelect={() => favorite.mutate({ id: view.id, favorite: !view.favorite })}
          >
            {view.favorite ? t('unfavorite') : t('favorite')}
          </DropdownMenuItem>
          {can('views', 'edit') && (
            <>
              <DropdownMenuItem onSelect={() => onEdit(view)}>{common('edit')}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setSharing(true)}>
                {view.shareToken ? t('shared') : t('share')}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={index <= 0} onSelect={() => move(-1)}>
                {t('moveViewUp')}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={index >= siblings.length - 1} onSelect={() => move(1)}>
                {t('moveViewDown')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>{t('moveToFolder')}</DropdownMenuLabel>
              {[{ id: null, name: t('noFolder') }, ...folders].map((folder) => (
                <DropdownMenuItem
                  key={folder.id ?? 'none'}
                  disabled={view.folderId === folder.id}
                  onSelect={() => update.mutate({ id: view.id, input: { folderId: folder.id } })}
                >
                  {folder.name}
                </DropdownMenuItem>
              ))}
            </>
          )}
          {can('views', 'delete') && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
                {common('delete')}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <ShareDialog
        open={sharing}
        onOpenChange={setSharing}
        title={t('shareBoard')}
        token={view.shareToken}
        extended={view.shareExtended}
        enable={enableShare}
        disable={disableShare}
        pathForToken={shareViewPath}
      />
      {deleting && (
        <ConfirmDialog
          title={t('deleteView')}
          confirmLabel={common('delete')}
          onConfirm={async () => {
            await onDelete(view);
            setDeleting(false);
          }}
          onClose={() => setDeleting(false)}
        >
          {t('deleteViewConfirm', { name: view.name })}
        </ConfirmDialog>
      )}
    </div>
  );
}
