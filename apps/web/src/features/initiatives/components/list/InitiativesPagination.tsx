import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Box, Inline, Text } from '@/design-system';

// The page numbers to show: always the first and last page, the current page and
// its immediate neighbors; every other run collapses to a single 'gap'.
function pageItems(page: number, pageCount: number): (number | 'gap')[] {
  const items: (number | 'gap')[] = [];
  for (let p = 1; p <= pageCount; p++) {
    if (p === 1 || p === pageCount || Math.abs(p - page) <= 1) {
      items.push(p);
    } else if (items[items.length - 1] !== 'gap') {
      items.push('gap');
    }
  }
  return items;
}

// Offset pagination for the initiatives list. Hidden when everything fits on one
// page.
export default function InitiativesPagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const t = useTranslations('initiatives.pagination');
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (pageCount <= 1) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <Box padX={4} padTop={2} padBottom={5} className="flex items-center justify-between">
      <Text as="span" size="xs" tone="muted" className="tabular-nums">
        {t('range', { from, to, total })}
      </Text>
      <Inline gap={1}>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label={t('previous')}
        >
          <ChevronLeft className="size-4" />
        </Button>
        {pageItems(page, pageCount).map((it, i) =>
          it === 'gap' ? (
            <Text as="span" size="xs" tone="muted" key={`gap-${i}`} className="px-1">
              …
            </Text>
          ) : (
            <Button
              key={it}
              variant={it === page ? 'secondary' : 'ghost'}
              size="icon-sm"
              className="text-xs tabular-nums"
              onClick={() => onPage(it)}
            >
              {it}
            </Button>
          ),
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={page >= pageCount}
          onClick={() => onPage(page + 1)}
          aria-label={t('next')}
        >
          <ChevronRight className="size-4" />
        </Button>
      </Inline>
    </Box>
  );
}
