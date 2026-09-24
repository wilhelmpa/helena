'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, BookmarkCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  browserBookmarks,
  browserBookmarksQueryKey,
  saveBrowserBookmarks,
  type BrowserBookmark,
  type BrowserTab,
} from '@/utils/browserControl';

// The project browser's bookmarks (owner, 2026-09-24: "Bookmarks für die Tabs"): the star
// keeps or drops the page in front, and each bookmark opens in a new tab. They belong to
// the project's browser, so the owner and its agents' view share them on every device.
export default function WorkspaceBrowserBookmarks({
  base,
  current,
  onOpen,
}: {
  base: string;
  current: BrowserTab | null;
  onOpen: (url: string) => void;
}) {
  const t = useTranslations('nav.workspace.browserBar');
  const queryClient = useQueryClient();
  const queryKey = browserBookmarksQueryKey(base);
  const bookmarks = useQuery({ queryKey, queryFn: () => browserBookmarks(base) });
  const save = useMutation({
    mutationFn: (next: BrowserBookmark[]) => saveBrowserBookmarks(base, next),
    onSuccess: (next) => queryClient.setQueryData(queryKey, next),
  });
  const list = bookmarks.data ?? [];
  const pageUrl = current?.url && /^https?:/.test(current.url) ? current.url : null;
  const saved = pageUrl ? list.some((bookmark) => bookmark.url === pageUrl) : false;

  function toggleCurrent() {
    if (!pageUrl) return;
    save.mutate(
      saved
        ? list.filter((bookmark) => bookmark.url !== pageUrl)
        : [...list, { url: pageUrl, title: current?.title || pageUrl }],
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
          title={t('bookmarks')}
          aria-label={t('bookmarks')}
        >
          {saved ? <BookmarkCheck /> : <Bookmark />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuItem disabled={!pageUrl || save.isPending} onSelect={toggleCurrent}>
          {saved ? <BookmarkCheck /> : <Bookmark />}
          {saved ? t('removeBookmark') : t('bookmarkPage')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t('bookmarks')}</DropdownMenuLabel>
        {list.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">{t('noBookmarks')}</div>
        ) : (
          list.map((bookmark) => (
            <DropdownMenuItem
              key={bookmark.url}
              onSelect={() => onOpen(bookmark.url)}
              title={bookmark.url}
            >
              <span className="min-w-0 flex-1 truncate">{bookmark.title}</span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
