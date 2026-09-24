import { ArrowDownWideNarrow, ArrowUpNarrowWide } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { PAGE_CONTROL_CLASS, usePageToolbarRoom } from '@/components/layout/PageToolbar';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { FileSort, FileSortKey } from '../utils/fileSort';

const KEYS: FileSortKey[] = ['name', 'modified', 'size'];

export default function FileSortMenu({
  sort,
  onChange,
}: {
  sort: FileSort;
  onChange: (sort: FileSort) => void;
}) {
  const t = useTranslations('files.toolbar');
  const room = usePageToolbarRoom();
  const Icon = sort.descending ? ArrowDownWideNarrow : ArrowUpNarrowWide;
  const label = { name: t('sortName'), modified: t('sortModified'), size: t('sortSize') };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={PAGE_CONTROL_CLASS} aria-label={t('sort')}>
          <Icon aria-hidden="true" />
          {room.actions ? <span>{label[sort.key]}</span> : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {KEYS.map((key) => (
          <DropdownMenuCheckboxItem
            key={key}
            checked={sort.key === key}
            onCheckedChange={() => onChange({ ...sort, key })}
          >
            {label[key]}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={!sort.descending}
          onCheckedChange={() => onChange({ ...sort, descending: false })}
        >
          {t('ascending')}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={sort.descending}
          onCheckedChange={() => onChange({ ...sort, descending: true })}
        >
          {t('descending')}
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
