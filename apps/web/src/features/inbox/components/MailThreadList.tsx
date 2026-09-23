'use client';

import { useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTranslations } from 'next-intl';
import type { MailThreadRow as Row } from '@/lib/api/endpoints/mail';
import { cn } from '@/lib/utils';
import MailThreadRow from './MailThreadRow';

const ROW_HEIGHT = 76;

// A long inbox renders only the rows on screen; the next page loads when the reader
// nears the end of the ones loaded.
export default function MailThreadList({
  className,
  rows,
  selectedId,
  showProject,
  loading,
  error,
  hasMore,
  loadingMore,
  onLoadMore,
  onSelect,
}: {
  className?: string;
  rows: Row[];
  selectedId: number | null;
  showProject: boolean;
  loading: boolean;
  error: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onSelect: (threadId: number) => void;
}) {
  const t = useTranslations('mail.inbox');
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    getItemKey: (index) => rows[index]!.id,
  });
  const items = virtualizer.getVirtualItems();
  const lastIndex = items.at(-1)?.index ?? 0;

  useEffect(() => {
    if (hasMore && !loadingMore && lastIndex >= rows.length - 10) onLoadMore();
  }, [hasMore, loadingMore, lastIndex, rows.length, onLoadMore]);

  const selectedIndex = rows.findIndex((row) => row.id === selectedId);
  useEffect(() => {
    if (selectedIndex >= 0) virtualizer.scrollToIndex(selectedIndex, { align: 'auto' });
  }, [selectedIndex, virtualizer]);

  return (
    <div ref={scrollRef} className={cn('min-h-0 flex-col overflow-y-auto', className)}>
      {loading ? (
        <p className="p-4 text-sm text-muted-foreground">{t('loading')}</p>
      ) : error ? (
        <p className="p-4 text-sm text-destructive">{t('loadError')}</p>
      ) : rows.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {items.map((item) => {
            const row = rows[item.index]!;
            return (
              <div
                key={item.key}
                className="absolute inset-x-0 top-0"
                style={{ height: item.size, transform: `translateY(${item.start}px)` }}
              >
                <MailThreadRow
                  row={row}
                  selected={row.id === selectedId}
                  showProject={showProject}
                  onSelect={() => onSelect(row.id)}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
